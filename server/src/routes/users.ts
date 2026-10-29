import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import prisma from '../lib/prisma.js'
import { parsePagination, parseId, getErrorMessage, getErrorStatus } from '../lib/utils.js'
import busboy from 'busboy'
import { adminSetAvatar } from '../services/avatarService.js'
import { sendCommand, isNodeConnected } from '../services/storageTunnel.js'
import { updateUserSchema, updateUserQuotaSchema, updateUserStatusSchema, updateUserRateLimitSchema } from '../config/index.js'
import { authenticate, requireCapability } from '../middleware/auth.js'
import { deactivateNekoAccount, ensureNekoAccount } from '../services/nekoAccountSync.js'
import { syncLineWebBigGroupMember } from '../services/nekoBigGroup.js'
import { invalidateUserTokens } from '../services/authService.js'

const router = Router()

/** 单个用户的存储配额上限（10 TiB），下调/上调均不允许越界 */
const MAX_STORAGE_QUOTA_BYTES = 10995116277760n

/** BigInt 配额 → 字符串（BigInt 不能直接 JSON 序列化） */
function serializeQuota(quota: bigint): string {
  return quota.toString()
}

// 所有路由需要 user:manage 能力（admin 自动具备）
router.use(authenticate, requireCapability('user:manage'))

// 列出用户（分页）— 附带空间配额与已用空间
router.get('/', async (req: Request, res: Response) => {
  const { page, limit, skip } = parsePagination(req.query)
  const statusQuery = typeof req.query.status === 'string' ? req.query.status : ''
  if (statusQuery && !['pending', 'active', 'rejected'].includes(statusQuery)) {
    res.status(400).json({ error: '无效的审核状态' })
    return
  }
  const where = statusQuery ? { status: statusQuery } : {}

  const [users, total, statusGroups, usageGroups, chatImageGroups] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        apiRateLimit: true,
        canAccessDrive: true,
        storageQuota: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count({ where }),
    prisma.user.groupBy({ by: ['status'], _count: { _all: true } }),
    // 单次 groupBy 汇总所有用户的已用空间，避免逐用户 N+1
    prisma.driveFile.groupBy({
      by: ['uploadedById'],
      where: { isFolder: false },
      _sum: { size: true },
    }),
    // 聊天图片同样占用网盘配额（与 driveQuota.getDriveUsage 口径一致，撤回后不计）
    prisma.message.groupBy({
      by: ['senderId'],
      where: { type: 'image', recalledAt: null, imageSize: { not: null } },
      _sum: { imageSize: true },
    }),
  ])

  const counts = { pending: 0, active: 0, rejected: 0 }
  for (const row of statusGroups) {
    if (row.status in counts) counts[row.status as keyof typeof counts] = row._count._all
  }

  const usageByUser = new Map<number, bigint>()
  for (const row of usageGroups) {
    if (row.uploadedById !== null) {
      usageByUser.set(row.uploadedById, row._sum.size ?? 0n)
    }
  }
  for (const row of chatImageGroups) {
    usageByUser.set(row.senderId, (usageByUser.get(row.senderId) ?? 0n) + (row._sum.imageSize ?? 0n))
  }

  res.json({
    users: users.map(user => ({
      ...user,
      storageQuota: serializeQuota(user.storageQuota),
      storageUsed: serializeQuota(usageByUser.get(user.id) ?? 0n),
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    counts,
  })
})

// 待审核数量（管理端角标）— 必须放在 /:id 之前
router.get('/pending-count', async (_req: Request, res: Response) => {
  const pending = await prisma.user.count({ where: { status: 'pending' } })
  res.json({ pending })
})

// 查看单个用户
router.get('/:id', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效的用户 ID' })
    return
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      status: true,
      apiRateLimit: true,
      canAccessDrive: true,
      storageQuota: true,
      createdAt: true,
    },
  })

  if (!user) {
    res.status(404).json({ error: '用户不存在' })
    return
  }

  res.json({ ...user, storageQuota: serializeQuota(user.storageQuota) })
})

// 更新用户（角色 / 密码）
router.put('/:id', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效的用户 ID' })
    return
  }

  const parsed = updateUserSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '输入数据无效', details: parsed.error.flatten() })
    return
  }

  // 自保护：不能修改自己的角色
  if (req.user!.userId === id && parsed.data.role) {
    res.status(400).json({ error: '不能修改自己的角色' })
    return
  }

  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) {
    res.status(404).json({ error: '用户不存在' })
    return
  }

  const data: { role?: string; password?: string } = {}
  if (parsed.data.role) data.role = parsed.data.role
  if (parsed.data.password) {
    data.password = await bcrypt.hash(parsed.data.password, 12)
  }

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      status: true,
      apiRateLimit: true,
      canAccessDrive: true,
      createdAt: true,
    },
  })

  res.json(updated)
})

// 审核用户（通过 / 拒绝）
router.put('/:id/status', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效的用户 ID' })
    return
  }

  const parsed = updateUserStatusSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '输入数据无效', details: parsed.error.flatten() })
    return
  }

  if (req.user!.userId === id) {
    res.status(400).json({ error: '不能修改自己的审核状态' })
    return
  }

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, status: true } })
  if (!user) {
    res.status(404).json({ error: '用户不存在' })
    return
  }

  const target = parsed.data.status
  const allowed =
    (user.status === 'pending' && (target === 'active' || target === 'rejected')) ||
    (user.status === 'rejected' && target === 'active')
  if (!allowed) {
    res.status(409).json({ error: '当前审核状态不允许该操作' })
    return
  }

  await prisma.user.update({ where: { id }, data: { status: target } })

  if (target === 'rejected') {
    await invalidateUserTokens(id)
    void deactivateNekoAccount(id)
    void syncLineWebBigGroupMember(id, false)
  } else {
    // 审核通过：补建聊天账号并加入 LineWeb 大群（失败不阻塞审批，周期对账会自愈）
    void ensureNekoAccount(id).then(() => syncLineWebBigGroupMember(id, true))
  }

  res.json({ id, status: target })
})

// 调整用户的 API 限额（0=不限业务配额）
router.put('/:id/rate-limit', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效的用户 ID' })
    return
  }

  const parsed = updateUserRateLimitSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '输入数据无效', details: parsed.error.flatten() })
    return
  }

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } })
  if (!user) {
    res.status(404).json({ error: '用户不存在' })
    return
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { apiRateLimit: parsed.data.apiRateLimit },
    select: { id: true, apiRateLimit: true, role: true },
  })

  res.json({ ...updated, unlimited: updated.role === 'admin' || updated.apiRateLimit === 0 })
})

// 调整用户的网盘空间配额（字节字符串 → BigInt，0 ~ 10 TiB）
router.put('/:id/quota', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效的用户 ID' })
    return
  }

  const parsed = updateUserQuotaSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '输入数据无效', details: parsed.error.flatten() })
    return
  }

  let storageQuota: bigint
  try {
    storageQuota = BigInt(parsed.data.storageQuotaBytes)
  } catch {
    res.status(400).json({ error: '配额必须是合法的字节数' })
    return
  }
  if (storageQuota < 0n || storageQuota > MAX_STORAGE_QUOTA_BYTES) {
    res.status(400).json({ error: '配额超出允许范围（0 ~ 10 TiB）' })
    return
  }

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } })
  if (!user) {
    res.status(404).json({ error: '用户不存在' })
    return
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { storageQuota },
    select: { id: true, storageQuota: true },
  })

  res.json({ id: updated.id, storageQuota: serializeQuota(updated.storageQuota) })
})

// 切换用户的网盘访问权限
router.put('/:id/drive-access', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效的用户 ID' })
    return
  }

  const { canAccessDrive } = req.body as { canAccessDrive?: boolean }
  if (typeof canAccessDrive !== 'boolean') {
    res.status(400).json({ error: '请提供 canAccessDrive 布尔值' })
    return
  }

  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) {
    res.status(404).json({ error: '用户不存在' })
    return
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { canAccessDrive },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      canAccessDrive: true,
    },
  })

  // 网盘权限以数据库为唯一事实来源，逐请求从 req.user 读取，无需清缓存

  res.json(updated)
})

// 管理员设置用户头像
router.put('/:id/avatar', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效的用户 ID' })
    return
  }

  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) {
    res.status(404).json({ error: '用户不存在' })
    return
  }

  let fileBuffer: Buffer | null = null
  let fileMimeType = ''

  try {
    await new Promise<void>((resolve, reject) => {
      const bb = busboy({ headers: req.headers })
      bb.on('file', (_fieldname, stream, info) => {
        fileMimeType = info.mimeType
        const chunks: Buffer[] = []
        stream.on('data', (chunk: Buffer) => chunks.push(chunk))
        stream.on('end', () => { fileBuffer = Buffer.concat(chunks) })
      })
      bb.on('finish', () => resolve())
      bb.on('error', (err: Error) => reject(err))
      req.pipe(bb)
    })
  } catch {
    res.status(400).json({ error: '文件解析失败' })
    return
  }

  if (!fileBuffer) {
    res.status(400).json({ error: '请提供头像文件' })
    return
  }

  try {
    const avatarPath = await adminSetAvatar(id, fileBuffer, fileMimeType)
    res.json({ avatarPath })
  } catch (err: unknown) {
    const status = getErrorStatus(err)
    res.status(status).json({ error: getErrorMessage(err) })
  }
})

// 删除用户（级联删除其评论和文章）
router.delete('/:id', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效的用户 ID' })
    return
  }

  // 自保护：不能删除自己
  if (req.user!.userId === id) {
    res.status(400).json({ error: '不能删除自己' })
    return
  }

  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) {
    res.status(404).json({ error: '用户不存在' })
    return
  }

  // 删除存储节点上的头像文件（如果存在）
  if (user.avatarPath && isNodeConnected()) {
    await sendCommand({ type: 'delete_file', path: user.avatarPath }).catch(() => {})
  }

  // 删除该用户作为发送者的聊天图片文件（best-effort，失败不影响账号删除）
  if (isNodeConnected()) {
    const imageMessages = await prisma.message.findMany({
      where: { senderId: id, type: 'image', imagePath: { not: null } },
      select: { imagePath: true },
    })
    for (const image of imageMessages) {
      if (!image.imagePath) continue
      await sendCommand({ type: 'delete_file', path: image.imagePath }).catch(() => {})
    }
  }

  // 记录该用户参与的会话，删除用户后清理「没有任何成员」的孤儿会话
  // （好友关系 / 成员 / 消息由数据库 onDelete: Cascade 自动清理）
  const memberships = await prisma.conversationMember.findMany({
    where: { userId: id },
    select: { conversationId: true },
  })
  const conversationIds = [...new Set(memberships.map(m => m.conversationId))]

  // 使用事务：先删除评论，再删除文章，最后删除用户
  await prisma.$transaction([
    prisma.comment.deleteMany({ where: { authorId: id } }),
    prisma.post.deleteMany({ where: { authorId: id } }),
    prisma.user.delete({ where: { id } }),
  ])

  // 清理孤儿会话（所有成员都已不存在）：避免私聊/群聊留下无成员的记录
  if (conversationIds.length > 0) {
    const orphanConversations = await prisma.conversation.findMany({
      where: { id: { in: conversationIds }, members: { none: {} } },
      select: { id: true },
    }).catch(() => [])
    const orphanIds = orphanConversations.map(conversation => conversation.id)
    if (orphanIds.length > 0) {
      await prisma.conversation.deleteMany({ where: { id: { in: orphanIds } } }).catch(() => {})
    }
  }

  // 停用 neko 聊天账号并踢线（聊天记录保留，账号不可再登录），并移出 LineWeb 大群
  await deactivateNekoAccount(id)
  void syncLineWebBigGroupMember(id, false)

  res.json({ message: '已删除' })
})

export default router
