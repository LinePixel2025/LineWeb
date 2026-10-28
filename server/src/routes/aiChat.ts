import { Router, type Request, type Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { AppError } from '../middleware/errorHandler.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { authenticate, requireCapability } from '../middleware/auth.js'
import { aiChatConfigUpdateSchema, aiChatMessageSchema } from '../config/index.js'
import { maskApiKey } from '../services/aiService.js'
import {
  assertAiChatReady,
  deriveConversationTitle,
  getAiChatConfig,
  getDailyUsage,
  getShanghaiDayStart,
  getTodayDateKey,
  streamAiChatReply,
  toMessageDto,
  updateAiChatConfig,
} from '../services/aiChatService.js'
import { isWebSearchConfigured } from '../services/webSearch.js'
import {
  AI_IMAGE_MAX_BYTES,
  claimAiChatImages,
  collectConversationImagePaths,
  deleteAiChatImage,
  getAiChatImageSource,
  uploadAiChatImage,
} from '../services/aiChatImageService.js'
import { ChatImageLimitError, chatImageLimitBody } from '../services/chatImageService.js'
import { getDriveQuota, formatQuotaSize } from '../services/driveQuota.js'
import { isNodeConnected, sendCommand, streamRead } from '../services/storageTunnel.js'
import { receiveMultipartImage } from '../lib/multipartImage.js'
import prisma from '../lib/prisma.js'

/**
 * AI 对话（DeepSeek）路由（挂载于 /api/ai-chat）
 *
 * 全部端点要求账号登录令牌：
 *   - 本路由不在 index.ts 的 publicApiPaths 白名单，全局 authenticate 中间件已兜底，
 *     router 内再声明一次以保证独立于挂载方式
 *   - 不加入 appScopes 端点白名单，第三方应用令牌一律 403
 *
 * 每日配额：见 aiChatService.getDailyUsage（Asia/Shanghai 0 点重置，dailyLimit=0 不限）。
 */
const router = Router()
router.use(authenticate)

/**
 * AI 对话写操作限流：每用户（未认证回退 IP）5 分钟 120 次，只挂在 POST/DELETE。
 * 与 chatWriteLimiter 同参 —— express-rate-limit v8 回退 IP 必须调 ipKeyGenerator。
 */
const aiChatWriteLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.userId ?? ipKeyGenerator(req.ip ?? '')),
  message: { error: '操作过于频繁，请稍后再试' },
  skip: (req) => req.user?.role === 'admin',
})

/** 当前登录用户 id（authenticate 已保证存在；集中处理类型与兜底） */
function currentUserId(req: Request): number {
  const userId = req.user?.userId
  if (!userId) throw new AppError('未登录', 401)
  return userId
}

/** 校验请求体，失败时抛 400（错误文案取 Zod 的第一条 issue） */
function parseInput<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new AppError(issue?.message ? `输入数据无效：${issue.message}` : '输入数据无效', 400)
  }
  return parsed.data as z.infer<S>
}

/** 解析正整数路径参数 */
function parseIdParam(raw: string | undefined, name: string): number {
  const value = Number.parseInt(raw ?? '', 10)
  if (!Number.isInteger(value) || value <= 0) throw new AppError(`无效的${name}`, 400)
  return value
}

/** 校验会话属主（非属主/不存在一律 404，不泄露存在性） */
async function assertConversationOwner(conversationId: number, userId: number) {
  const conversation = await prisma.aiConversation.findFirst({
    where: { id: conversationId, userId },
  })
  if (!conversation) throw new AppError('会话不存在', 404)
  return conversation
}

// === 额度 ===

// GET /api/ai-chat/quota — 功能开关 + 当日已用/剩余提问次数
router.get('/quota', asyncHandler(async (req: Request, res: Response) => {
  const usage = await getDailyUsage(currentUserId(req))
  // 管理员不受每日提问上限约束
  res.json(req.user?.role === 'admin' ? { ...usage, unlimited: true, remaining: null } : usage)
}))

// === 会话 ===

// GET /api/ai-chat/conversations — 我的会话列表（最近活跃优先）
router.get('/conversations', asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const conversations = await prisma.aiConversation.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  })
  res.json({ conversations })
}))

// GET /api/ai-chat/conversations/:id/messages?before=&take=30 — 历史消息（游标分页，升序返回）
router.get('/conversations/:id/messages', asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const conversationId = parseIdParam(req.params.id, '会话 ID')
  await assertConversationOwner(conversationId, userId)

  const takeRaw = Number.parseInt(String(req.query.take ?? '30'), 10)
  const take = Number.isFinite(takeRaw) && takeRaw > 0 ? Math.min(takeRaw, 50) : 30
  const beforeRaw = Number.parseInt(String(req.query.before ?? ''), 10)
  const before = Number.isInteger(beforeRaw) && beforeRaw > 0 ? beforeRaw : undefined

  const rows = await prisma.aiMessage.findMany({
    where: { conversationId, ...(before ? { id: { lt: before } } : {}) },
    orderBy: { id: 'desc' },
    take: take + 1,
    include: { images: true },
  })
  const hasMore = rows.length > take
  const page = rows.slice(0, take).reverse()

  res.json({ messages: page.map(toMessageDto), hasMore })
}))

// DELETE /api/ai-chat/conversations/:id — 删除会话（级联消息与图片行，节点文件 best-effort）
router.delete('/conversations/:id', aiChatWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const conversationId = parseIdParam(req.params.id, '会话 ID')
  await assertConversationOwner(conversationId, userId)

  // 先收集图片路径，级联删除行后逐个清理节点文件
  const imagePaths = await collectConversationImagePaths(conversationId)
  await prisma.aiConversation.delete({ where: { id: conversationId } })

  if (isNodeConnected()) {
    for (const path of imagePaths) {
      await sendCommand({ type: 'delete_file', path }).catch(() => {})
    }
  }
  res.json({ ok: true })
}))

// === 图片附件 ===

// POST /api/ai-chat/images — 上传附件（multipart/form-data，字段名 file）
router.post('/images', aiChatWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = currentUserId(req)

    if (!isNodeConnected()) {
      throw new AppError('存储节点未接入，暂时无法上传图片', 503)
    }

    // === 配额预检：空间已满直接 413（drive:all 不受限） ===
    const quota = await getDriveQuota(req.user!)
    if (!quota.unlimited && quota.remaining !== null && quota.remaining <= 0n) {
      throw new ChatImageLimitError('网盘空间不足', 'QUOTA_EXCEEDED', {
        quota: quota.quota ?? undefined,
        used: quota.used,
        remaining: 0n,
      })
    }

    // 单张允许的原始上限 = min(10 MiB, 剩余空间)；配额更小时以配额为准
    const hardLimitBytes = BigInt(AI_IMAGE_MAX_BYTES)
    const remainingBytes = quota.unlimited ? null : quota.remaining
    const quotaLimited = remainingBytes !== null && remainingBytes < hardLimitBytes
    const effectiveLimitBytes = quotaLimited && remainingBytes !== null ? remainingBytes : hardLimitBytes

    const file = await receiveMultipartImage(req, Number(effectiveLimitBytes))
    if (file.limitHit) {
      if (quotaLimited && remainingBytes !== null) {
        throw new ChatImageLimitError(
          `网盘空间不足（剩余 ${formatQuotaSize(remainingBytes)}）`,
          'QUOTA_EXCEEDED',
          { quota: quota.quota ?? undefined, used: quota.used, remaining: 0n },
        )
      }
      throw new ChatImageLimitError(
        `图片大小超过限制 (${formatQuotaSize(hardLimitBytes)})`,
        'IMAGE_TOO_LARGE',
      )
    }

    const image = await uploadAiChatImage({
      userId,
      buffer: file.buffer,
      mimeType: file.mimeType,
      quota,
    })

    res.status(201).json({
      id: image.id,
      width: image.width,
      height: image.height,
      size: image.size,
    })
  } catch (err) {
    // 大小/配额类错误按 drive.ts 的 413 响应体返回（errorHandler 不认识该错误类型）
    if (err instanceof ChatImageLimitError) {
      if (!res.headersSent) res.status(413).json(chatImageLimitBody(err))
      return
    }
    throw err
  }
}))

// GET /api/ai-chat/images/:id/image — 读取附件（仅属主；支持 ?token= 直链）
router.get('/images/:id/image', asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const imageId = parseIdParam(req.params.id, '图片 ID')
  const image = await getAiChatImageSource(userId, imageId)
  if (!image) throw new AppError('图片不存在', 404)

  if (!isNodeConnected()) {
    throw new AppError('存储节点未接入，暂时无法读取图片', 503)
  }

  // 覆盖全局认证中间件设置的 Cache-Control: no-store —— 图片内容不可变，可长期缓存
  res.setHeader('Content-Type', 'image/webp')
  res.setHeader('Content-Disposition', 'inline')
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
  res.setHeader('Content-Length', image.size.toString())

  try {
    for await (const chunk of streamRead(image.imagePath)) {
      if (!res.write(chunk)) {
        await new Promise<void>(resolve => res.once('drain', resolve))
      }
    }
    res.end()
  } catch (err) {
    console.error('读取 AI 对话图片失败:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: '读取图片失败' })
      return
    }
    if (!res.writableEnded) res.destroy(err instanceof Error ? err : undefined)
  }
}))

// DELETE /api/ai-chat/images/:id — 撤销未发送的附件
router.delete('/images/:id', aiChatWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const imageId = parseIdParam(req.params.id, '图片 ID')
  await deleteAiChatImage(userId, imageId)
  res.json({ ok: true })
}))

// === 发消息（SSE 流式回复） ===

// POST /api/ai-chat/messages — 发送消息并流式接收回复
// 请求体: { conversationId?, content, imageIds?, thinking? }
// SSE 事件: { meta } → { reasoning }* → { delta }* → { done, ... } | { error }
router.post('/messages', aiChatWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const parsed = parseInput(aiChatMessageSchema, req.body)
  const content = parsed.content.trim()
  const imageIds: number[] = parsed.imageIds ?? []
  const search = parsed.search ?? false
  if (!content && imageIds.length === 0) {
    throw new AppError('消息内容不能为空', 400)
  }
  if (search && !content) {
    throw new AppError('联网搜索需要输入文字问题', 400)
  }

  // === 就绪与配额检查（在 SSE 头之前，保证前端能收到普通 JSON 错误） ===
  const config = await assertAiChatReady()
  if (search && !isWebSearchConfigured(config)) {
    throw new AppError('联网搜索未配置，请联系管理员', 503)
  }
  let usage = await getDailyUsage(userId)
  if (req.user?.role === 'admin') {
    usage = { ...usage, unlimited: true, remaining: null }
  }
  if (!usage.unlimited && usage.remaining !== null && usage.remaining <= 0) {
    res.status(429).json({
      error: '今日提问次数已用完，请明天再来',
      quota: {
        dailyLimit: usage.dailyLimit,
        used: usage.used,
        remaining: 0,
        unlimited: false,
      },
    })
    return
  }

  // === 会话与消息落库 ===
  let conversationId: number
  if (parsed.conversationId) {
    const conversation = await assertConversationOwner(parsed.conversationId, userId)
    conversationId = conversation.id
  } else {
    const created = await prisma.aiConversation.create({
      data: {
        userId,
        title: deriveConversationTitle(content, imageIds.length > 0),
      },
    })
    conversationId = created.id
  }

  // 事务：配额复核 + user 消息 + 认领附件（数量不符即整体回滚）。
  // 配额复核放进事务，封住「并发请求同时通过外层检查」的窗口（SQLite 写串行下严格成立）。
  const userMessage = await prisma.$transaction(async (tx) => {
    if (!usage.unlimited) {
      const usedInTx = await tx.aiMessage.count({
        where: {
          conversation: { userId },
          role: 'user',
          counted: true,
          createdAt: { gte: getShanghaiDayStart(getTodayDateKey()) },
        },
      })
      if (usedInTx >= usage.dailyLimit) {
        throw new AppError('今日提问次数已用完，请明天再来', 429)
      }
    }
    const message = await tx.aiMessage.create({
      data: {
        conversationId,
        role: 'user',
        content,
        counted: true,
      },
    })
    if (imageIds.length > 0) {
      const claimed = await claimAiChatImages(tx, userId, imageIds, message.id)
      if (claimed !== imageIds.length) {
        throw new AppError('图片附件无效或已被使用', 400)
      }
    }
    return message
  })

  const userImageRows = await prisma.aiChatImage.findMany({
    where: { messageId: userMessage.id },
    select: { id: true, imagePath: true },
    orderBy: { id: 'asc' },
  })

  // === SSE 响应 ===
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // 禁用 nginx 缓冲
  res.flushHeaders()

  const send = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
  }

  // 客户端断开检测（fetch 被 abort / 页面关闭时触发 close，但 writableEnded 仍为 false）
  let clientGone = false
  res.on('close', () => { clientGone = true })

  // 本条消息此刻已计入配额：剩余 = 发送前剩余 - 1（不限次为 null）
  const remainingAfter = usage.unlimited ? null : Math.max((usage.remaining ?? 0) - 1, 0)

  // meta：先下发会话 id 与最新剩余次数
  send({
    meta: {
      conversationId,
      userMessageId: userMessage.id,
      remaining: remainingAfter,
      unlimited: usage.unlimited,
    },
  })

  await streamAiChatReply(
    {
      config,
      conversationId,
      userMessageId: userMessage.id,
      userContent: content,
      userImageRows,
      thinking: parsed.thinking ?? false,
      search,
    },
    {
      onChunk: (delta) => {
        if (!clientGone) send({ delta })
      },
      onReasoning: (delta) => {
        if (!clientGone) send({ reasoning: delta })
      },
      onSearch: (event) => {
        if (!clientGone) send({ search: event })
      },
      onDone: (result) => {
        if (clientGone) return
        send({
          done: true,
          assistantMessageId: result.assistantMessageId,
          model: result.model,
          partial: result.partial,
          conversationId,
          remaining: remainingAfter,
          unlimited: usage.unlimited,
        })
        res.end()
      },
      onError: (message) => {
        if (clientGone) return
        // 上游失败已由服务层退还配额（counted=false），剩余次数与发送前一致
        send({ error: message })
        res.end()
      },
      isAborted: () => clientGone || res.writableEnded,
    },
  )
}))

// === 管理配置 ===

/** 搜索 Key 的脱敏展示（DeepSeek / 博查 / Tavily 的 Key 前缀各异，只露末 4 位） */
function maskSearchKey(key: string): string {
  if (!key) return ''
  if (key.length <= 4) return '****'
  return `…${key.slice(-4)}`
}

/** 脱敏值（含省略号或全星号）视为未修改 */
function isMaskedValue(value: string): boolean {
  return value.includes('…') || value === '****'
}

function toConfigResponse(config: {
  id: number
  provider: string
  model: string
  apiKey: string
  baseUrl: string | null
  systemPrompt: string
  dailyLimit: number
  isEnabled: boolean
  searchEnabled: boolean
  searchProvider: string
  searchApiKey: string
  updatedAt: Date
}) {
  return {
    id: config.id,
    provider: config.provider,
    model: config.model,
    apiKey: maskApiKey(config.apiKey),
    baseUrl: config.baseUrl,
    systemPrompt: config.systemPrompt,
    dailyLimit: config.dailyLimit,
    isEnabled: config.isEnabled,
    searchEnabled: config.searchEnabled,
    searchProvider: config.searchProvider,
    searchApiKey: maskSearchKey(config.searchApiKey),
    updatedAt: config.updatedAt,
  }
}

// GET /api/ai-chat/config — 获取 AI 对话配置（API Key 脱敏）
router.get('/config', authenticate, requireCapability('ai:configure'), asyncHandler(async (_req: Request, res: Response) => {
  const config = await getAiChatConfig()
  res.json(toConfigResponse(config))
}))

// PUT /api/ai-chat/config — 更新 AI 对话配置
router.put('/config', authenticate, requireCapability('ai:configure'), asyncHandler(async (req: Request, res: Response) => {
  const parsed = parseInput(aiChatConfigUpdateSchema, req.body)

  // 如果 apiKey / searchApiKey 传入的是脱敏后的值，说明未修改，剔除该字段
  const data: Record<string, unknown> = { ...parsed }
  if (typeof data.apiKey === 'string' && data.apiKey.startsWith('sk-…')) {
    delete data.apiKey
  }
  if (typeof data.searchApiKey === 'string' && isMaskedValue(data.searchApiKey)) {
    delete data.searchApiKey
  }

  const config = await updateAiChatConfig(data)
  res.json(toConfigResponse(config))
}))

export default router
