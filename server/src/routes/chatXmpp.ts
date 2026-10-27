import { Router, type Request, type Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { config } from '../config/index.js'
import { AppError } from '../middleware/errorHandler.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { authenticate } from '../middleware/auth.js'
import { receiveMultipartImage } from '../lib/multipartImage.js'
import {
  getUserBrief,
  ensureMutualFriendship,
  listFriendRequests,
  listFriends,
} from '../services/chatService.js'
import {
  callBrowserApi,
  fetchState,
  issueTicket,
  linewebIdOf,
  parseNekoJid,
  sessionHashOf,
  toNekoId,
  type LineWebUserLike,
} from '../services/nekoChat.js'
import {
  buildChatView,
  resolveUsers,
  searchDirectory,
  type ChatBootstrapView,
} from '../services/nekoChatView.js'
import { ensureNekoAccounts } from '../services/nekoAccountSync.js'
import { isAllowedOutboundStanza } from '../services/nekoChatGuard.js'

/**
 * 聊天 XMPP 网关（挂载于 /api/chat/xmpp）
 *
 * 浏览器只与 LineWeb 同源交互：这里负责
 *   1. 下发一次性票据与过滤后的聊天状态（好友关系以 LineWeb Prisma 为准）
 *   2. 透传群管理 / 撤回 / 图片上传 / 长轮询到 neko 的 /chat/*（附带可信代理身份头）
 * 消息收发走 /ws/xmpp 字节级中继（见 services/nekoWsProxy.ts），不经过本路由。
 */
const router = Router()
router.use(authenticate)

/** 聊天写操作限流：每用户 5 分钟 120 次（长轮询/上传单独豁免） */
const chatWriteLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.userId ?? ipKeyGenerator(req.ip ?? '')),
  message: { error: '操作过于频繁，请稍后再试' },
})

/** 图片上限与 neko 一致（8MB，按魔数判定类型） */
const UPLOAD_MAX_BYTES = 8 * 1024 * 1024
const STANZA_MAX_BYTES = 256 * 1024

function currentUserId(req: Request): number {
  const userId = req.user?.userId
  if (!userId) throw new AppError('未登录', 401)
  return userId
}

/** 原始登录令牌（用于轮询会话绑定；beare 头优先） */
function rawToken(req: Request): string {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) return header.slice(7).trim()
  return typeof req.query.token === 'string' ? req.query.token : ''
}

async function currentUser(req: Request): Promise<LineWebUserLike> {
  return getUserBrief(currentUserId(req))
}

async function currentSessionHash(req: Request): Promise<string> {
  const token = rawToken(req)
  return token ? sessionHashOf(token) : `user:${currentUserId(req)}`
}

/** 图片魔数（与 neko 一致，不信任请求头） */
function sniffImageMime(buf: Buffer): string {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return ''
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  const head = buf.toString('ascii', 0, 6)
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif'
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return ''
}

/** 当前用户的完整聊天状态（Prisma 好友 + neko 状态 → 过滤后的出口口径） */
async function loadChatView(req: Request): Promise<ChatBootstrapView> {
  const user = await currentUser(req)
  const [state, friends, requests] = await Promise.all([
    fetchState(user),
    listFriends(user.id),
    listFriendRequests(user.id),
  ])
  return buildChatView({
    me: { id: user.id, username: user.username },
    state,
    friends: friends.friends,
    requestsIn: requests.incoming,
    requestsOut: requests.outgoing,
    allowNative: config.nekoChatAllowNative,
  })
}

async function friendIdSet(userId: number): Promise<Set<number>> {
  const friends = await listFriends(userId)
  return new Set(friends.friends.map((friend) => friend.id))
}

function parseRoomId(req: Request): number {
  const id = Number.parseInt(req.params.id ?? '', 10)
  if (!Number.isInteger(id) || id <= 0) throw new AppError('无效的群聊', 400)
  return id
}

// === 状态与票据 ===

// GET /api/chat/xmpp/bootstrap — 一次性票据 + 过滤后的初始状态
router.get(
  '/bootstrap',
  asyncHandler(async (req: Request, res: Response) => {
    const user = await currentUser(req)
    const [ticket, view] = await Promise.all([issueTicket(user), loadChatView(req)])
    res.json({
      ticket,
      ...view,
      wsPath: config.nekoChatWsPath,
      historyLimit: view.historyLimit || config.nekoChatHistoryLimit,
    })
  }),
)

// GET /api/chat/xmpp/ticket — 重连前换新票据（neko 票据一次性）
router.get(
  '/ticket',
  asyncHandler(async (req: Request, res: Response) => {
    const user = await currentUser(req)
    res.json({ ticket: await issueTicket(user) })
  }),
)

// GET /api/chat/xmpp/state — 轮询降级 / 重连后刷新状态
router.get(
  '/state',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await loadChatView(req))
  }),
)

// === 联系人搜索与反查 ===

const directorySchema = z.object({
  q: z.string().trim().min(1).max(50),
})

// GET /api/chat/xmpp/directory?q= — 搜索可发起会话的人（原生用户；lw_* 只回好友）
router.get(
  '/directory',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = directorySchema.safeParse(req.query)
    if (!parsed.success) throw new AppError('请输入 1-50 个字符的搜索词', 400)
    const user = await currentUser(req)
    const [state, friendIds] = await Promise.all([fetchState(user), friendIdSet(user.id)])
    res.json({
      users: searchDirectory(
        state,
        toNekoId(user.id),
        friendIds,
        parsed.data.q,
        config.nekoChatAllowNative,
      ),
    })
  }),
)

// GET /api/chat/xmpp/users?jids=a@wlxx,b@wlxx — 陌生来信反查
router.get(
  '/users',
  asyncHandler(async (req: Request, res: Response) => {
    const raw = String(req.query.jids || '')
    const usernames = raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => parseNekoJid(value)?.localpart || value)
      .slice(0, 20)
    if (usernames.length === 0) {
      res.json({ users: [] })
      return
    }
    const user = await currentUser(req)
    const [state, friendIds] = await Promise.all([fetchState(user), friendIdSet(user.id)])
    res.json({
      users: resolveUsers(state, toNekoId(user.id), friendIds, usernames, config.nekoChatAllowNative),
    })
  }),
)

// === neko 原生好友 ===

/**
 * LineWeb↔LineWeb 仍以 Prisma 为准；neko 原生账号的好友关系走 neko 自带好友系统。
 * 原生账号的私聊受 NEKO_CHAT_ALLOW_NATIVE 约束（nekoChatGuard），因此好友相关操作也在同一开关下。
 */
function assertNativeAllowed(): void {
  if (!config.nekoChatAllowNative) {
    throw new AppError('当前未开启与 neko 原生账号聊天', 403)
  }
}

const nativeTargetSchema = z.object({
  nekoId: z.number().int().positive(),
})

// POST /api/chat/xmpp/friends/request — 向 neko 原生账号发起好友申请
router.post(
  '/friends/request',
  chatWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = nativeTargetSchema.safeParse(req.body || {})
    if (!parsed.success) throw new AppError('无效的用户', 400)
    assertNativeAllowed()
    const nekoId = parsed.data.nekoId
    if (linewebIdOf(nekoId) !== null) {
      throw new AppError('LineWeb 用户请使用站内好友申请', 400)
    }
    const user = await currentUser(req)
    if (nekoId === toNekoId(user.id)) throw new AppError('不能添加自己为好友', 400)

    const state = await fetchState(user)
    const target = state.users.find((item) => item.id === nekoId)
    if (
      !target
      || target.username === state.systemUsername
      || target.username === state.fileHelperUsername
    ) {
      throw new AppError('用户不存在', 404)
    }

    const sessionHash = await currentSessionHash(req)
    const result = await callBrowserApi<{ ok: boolean; state?: string }>(
      'POST',
      '/chat/friends/request',
      { user, sessionHash, body: { userId: nekoId } },
    )
    res.json(result ?? { ok: true })
  }),
)

const friendRespondSchema = z.object({
  requestId: z.number().int().positive(),
  accept: z.boolean(),
})

// POST /api/chat/xmpp/friends/respond — 接受 / 拒绝 neko 好友申请
router.post(
  '/friends/respond',
  chatWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = friendRespondSchema.safeParse(req.body || {})
    if (!parsed.success) throw new AppError('无效的好友申请', 400)
    assertNativeAllowed()
    const user = await currentUser(req)
    const state = await fetchState(user)
    const entry = state.friendRequestsIn.find((item) => item.requestId === parsed.data.requestId)
    if (!entry) throw new AppError('好友申请不存在或已处理', 404)

    const sessionHash = await currentSessionHash(req)
    const result = await callBrowserApi('POST', '/chat/friends/respond', {
      user,
      sessionHash,
      body: { requestId: parsed.data.requestId, accept: parsed.data.accept },
    })

    // 申请方是 `lw_*`（用原生客户端操作的 LineWeb 账号）时，补齐 Prisma 双向好友，
    // 否则站内好友列表、游戏邀请等依赖 Prisma 的功能会看不到这层关系。
    if (parsed.data.accept) {
      const peerLinewebId = linewebIdOf(entry.userId)
      if (peerLinewebId !== null && peerLinewebId !== user.id) {
        try {
          await ensureMutualFriendship(user.id, peerLinewebId)
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err)
          console.warn(`[chatXmpp] 补齐 Prisma 好友关系失败：${detail}`)
        }
      }
    }

    res.json(result ?? { ok: true })
  }),
)

// POST /api/chat/xmpp/friends/remove — 删除 neko 原生好友
router.post(
  '/friends/remove',
  chatWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = nativeTargetSchema.safeParse(req.body || {})
    if (!parsed.success) throw new AppError('无效的用户', 400)
    assertNativeAllowed()
    const nekoId = parsed.data.nekoId
    if (linewebIdOf(nekoId) !== null) {
      throw new AppError('LineWeb 好友请使用站内删除', 400)
    }
    const user = await currentUser(req)
    const sessionHash = await currentSessionHash(req)
    const result = await callBrowserApi('POST', '/chat/friends/remove', {
      user,
      sessionHash,
      body: { userId: nekoId },
    })
    res.json(result ?? { ok: true })
  }),
)

// === 群聊 ===

const roomCreateSchema = z.object({
  name: z.string().trim().min(1, '群名不能为空').max(30, '群名最长 30 个字符'),
  memberIds: z.array(z.number().int().positive()).min(1, '至少选择一位联系人').max(49),
})

// POST /api/chat/xmpp/rooms — 建群（先把 LineWeb 成员工补齐到 neko，再建 room + 加人）
router.post(
  '/rooms',
  chatWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = roomCreateSchema.safeParse(req.body || {})
    if (!parsed.success) {
      throw new AppError(parsed.error.issues[0]?.message || '输入数据无效', 400)
    }
    const user = await currentUser(req)
    const sessionHash = await currentSessionHash(req)
    const memberIds = [...new Set(parsed.data.memberIds.filter((id) => id !== toNekoId(user.id)))]
    // LineWeb 账号必须在 neko 侧存在才能入群（原生 nekoId 直接使用）
    const linewebIds = memberIds
      .map((id) => linewebIdOf(id))
      .filter((id): id is number => id !== null)
    await ensureNekoAccounts(linewebIds)

    const created = await callBrowserApi<{ ok: boolean; roomId: number }>('POST', '/chat/rooms', {
      user,
      sessionHash,
      body: { name: parsed.data.name },
    })
    if (!created?.roomId) throw new AppError('群聊创建失败', 503)
    try {
      await callBrowserApi('POST', `/chat/rooms/${created.roomId}/members`, {
        user,
        sessionHash,
        body: { addIds: memberIds },
      })
    } catch (err) {
      // 加人失败则解散刚建的群，避免留下只有群主一人的空群
      await callBrowserApi('POST', `/chat/rooms/${created.roomId}/disband`, { user, sessionHash }).catch(() => {})
      throw err
    }
    res.json({ ok: true, roomId: created.roomId })
  }),
)

// 群成员增删：addIds 为 neko id，LineWeb 成员先补建账号
router.post(
  '/rooms/:id/members',
  chatWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const roomId = parseRoomId(req)
    const user = await currentUser(req)
    const sessionHash = await currentSessionHash(req)
    const body = (req.body || {}) as { addIds?: unknown; removeIds?: unknown }
    const normalize = (value: unknown): number[] =>
      Array.isArray(value)
        ? [...new Set(value.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
        : []
    const addIds = normalize(body.addIds).filter((id) => id !== toNekoId(user.id))
    const removeIds = normalize(body.removeIds)
    await ensureNekoAccounts(
      addIds.map((id) => linewebIdOf(id)).filter((id): id is number => id !== null),
    )
    const result = await callBrowserApi('POST', `/chat/rooms/${roomId}/members`, {
      user,
      sessionHash,
      body: { addIds, removeIds },
    })
    res.json(result ?? { ok: true })
  }),
)

/** 群管理通用透传：路径片段 → /chat/rooms/:id/<action> */
function roomAction(action: string, transform?: (body: Record<string, unknown>) => unknown) {
  return asyncHandler(async (req: Request, res: Response) => {
    const roomId = parseRoomId(req)
    const user = await currentUser(req)
    const sessionHash = await currentSessionHash(req)
    const body = (req.body || {}) as Record<string, unknown>
    const result = await callBrowserApi('POST', `/chat/rooms/${roomId}/${action}`, {
      user,
      sessionHash,
      body: transform ? transform(body) : body,
    })
    res.json(result ?? { ok: true })
  })
}

const roomNameSchema = z.object({
  name: z.string().trim().min(1, '群名不能为空').max(30, '群名最长 30 个字符'),
})

router.post(
  '/rooms/:id/name',
  chatWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = roomNameSchema.safeParse(req.body || {})
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || '输入数据无效', 400)
    const roomId = parseRoomId(req)
    const user = await currentUser(req)
    const sessionHash = await currentSessionHash(req)
    const result = await callBrowserApi('POST', `/chat/rooms/${roomId}/name`, {
      user,
      sessionHash,
      body: { name: parsed.data.name },
    })
    res.json(result ?? { ok: true })
  }),
)

router.post('/rooms/:id/leave', chatWriteLimiter, roomAction('leave'))
router.post('/rooms/:id/role', chatWriteLimiter, roomAction('role'))
router.post('/rooms/:id/transfer', chatWriteLimiter, roomAction('transfer'))
router.post('/rooms/:id/mute', chatWriteLimiter, roomAction('mute'))
router.post('/rooms/:id/mute-all', chatWriteLimiter, roomAction('mute-all'))
router.post('/rooms/:id/mute-notify', chatWriteLimiter, roomAction('mute-notify'))
router.post('/rooms/:id/announcement', chatWriteLimiter, roomAction('announcement'))
router.post('/rooms/:id/disband', chatWriteLimiter, roomAction('disband'))

// === 置顶 / 撤回 ===

const pinSchema = z.object({
  kind: z.enum(['friend', 'room']),
  id: z.number().int().positive(),
  pinned: z.boolean(),
})

router.post(
  '/pins',
  chatWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = pinSchema.safeParse(req.body || {})
    if (!parsed.success) throw new AppError('无效的会话', 400)
    const user = await currentUser(req)
    const sessionHash = await currentSessionHash(req)
    const result = await callBrowserApi('POST', '/chat/pins', {
      user,
      sessionHash,
      body: parsed.data,
    })
    res.json(result ?? { ok: true })
  }),
)

const recallSchema = z.object({ id: z.number().int().positive() })

function recallHandler(path: string) {
  return asyncHandler(async (req: Request, res: Response) => {
    const parsed = recallSchema.safeParse(req.body || {})
    if (!parsed.success) throw new AppError('无效的消息', 400)
    const user = await currentUser(req)
    const sessionHash = await currentSessionHash(req)
    const result = await callBrowserApi('POST', path, {
      user,
      sessionHash,
      body: { id: parsed.data.id },
    })
    res.json(result ?? { ok: true })
  })
}

// 撤回窗口由 neko 固定为 5 分钟，且只能撤回自己的消息
router.post('/messages/recall', chatWriteLimiter, recallHandler('/chat/messages/recall'))
// 群主/管理员撤回群内任意消息（层级校验在 neko 侧）
router.post('/messages/admin-recall', chatWriteLimiter, recallHandler('/chat/messages/admin-recall'))

// === 图片上传 ===

router.post(
  '/uploads',
  asyncHandler(async (req: Request, res: Response) => {
    const user = await currentUser(req)
    const sessionHash = await currentSessionHash(req)
    const file = await receiveMultipartImage(req, UPLOAD_MAX_BYTES)
    if (file.limitHit) throw new AppError('图片不能超过 8MB', 413)
    const mime = sniffImageMime(file.buffer)
    if (!mime) throw new AppError('仅支持 PNG/JPEG/GIF/WebP 图片', 415)
    const result = await callBrowserApi<{ ok: boolean; url: string; mime: string }>(
      'POST',
      '/chat/uploads',
      { user, sessionHash, raw: file.buffer, contentType: mime, timeoutMs: 30000 },
    )
    if (!result?.url) throw new AppError('图片上传失败', 503)
    const id = result.url.split('/').filter(Boolean).pop() || ''
    res.json({ ok: true, url: result.url, id, mime: result.mime || mime })
  }),
)

// === HTTP 长轮询降级（无 WebSocket 时使用） ===

router.post(
  '/http-session',
  asyncHandler(async (req: Request, res: Response) => {
    const user = await currentUser(req)
    const sessionHash = await currentSessionHash(req)
    const result = await callBrowserApi<{ sessionId: string }>('POST', '/chat/http-session', {
      user,
      sessionHash,
      body: {},
    })
    res.json(result)
  }),
)

router.post(
  '/http-stanza',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body || {}) as { sessionId?: unknown; stanza?: unknown }
    if (typeof body.stanza !== 'string' || Buffer.byteLength(body.stanza) > STANZA_MAX_BYTES) {
      throw new AppError('stanza 无效', 400)
    }
    const userId = currentUserId(req)
    // 与 /ws/xmpp 中继同一份好友校验：轮询模式不能绕过单聊好友关系
    const verdict = await isAllowedOutboundStanza(userId, body.stanza)
    if (!verdict.allowed) {
      throw new AppError('对方不是你的好友，无法发送私聊', 403)
    }
    const user = await currentUser(req)
    const sessionHash = await currentSessionHash(req)
    await callBrowserApi('POST', '/chat/http-stanza', {
      user,
      sessionHash,
      body: { sessionId: body.sessionId, stanza: body.stanza },
    })
    res.status(204).end()
  }),
)

router.post(
  '/http-close',
  asyncHandler(async (req: Request, res: Response) => {
    const user = await currentUser(req)
    const sessionHash = await currentSessionHash(req)
    await callBrowserApi('POST', '/chat/http-close', {
      user,
      sessionHash,
      body: { sessionId: (req.body || {}).sessionId },
    })
    res.status(204).end()
  }),
)

// 长轮询会挂 25 秒，上游超时给足余量；压缩必须排除（见 index.ts）
router.get(
  '/http-poll',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = String(req.query.sessionId || '')
    if (!sessionId) throw new AppError('缺少 sessionId', 400)
    const user = await currentUser(req)
    const sessionHash = await currentSessionHash(req)
    const result = await callBrowserApi('GET', `/chat/http-poll?sessionId=${encodeURIComponent(sessionId)}`, {
      user,
      sessionHash,
      timeoutMs: 45000,
    })
    res.json(result ?? {})
  }),
)

export default router
