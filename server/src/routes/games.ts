import { Router, type Request } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { AppError } from '../middleware/errorHandler.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { authenticate } from '../middleware/auth.js'
import {
  gameInviteCreateSchema,
  gameInviteRespondSchema,
  gameMoveSchema,
  gameStartSchema,
  gameSyncQuerySchema,
  doudizhuActionSchema,
  snakeActionSchema,
  minesweeperActionSchema,
  jumpActionSchema,
} from '../config/index.js'
import { markGamePresence } from '../services/gamePresence.js'
import {
  applyGameMove,
  cancelGameInvite,
  createGameInvite,
  getActiveGameMatch,
  getGameMatch,
  getGameSync,
  leaveGameMatch,
  listGameFriends,
  listGameInvites,
  respondGameInvite,
  resignGameMatch,
  startGameMatch,
} from '../services/gameService.js'
import {
  applyDoudizhuAction,
  cancelDoudizhuInvite,
  createDoudizhuInvite,
  getActiveDoudizhuMatch,
  getDoudizhuMatch,
  getDoudizhuSync,
  leaveDoudizhuMatch,
  listDoudizhuFriends,
  listDoudizhuInvites,
  respondDoudizhuInvite,
  resignDoudizhuMatch,
  startDoudizhuMatch,
} from '../services/gameDoudizhuService.js'
import {
  applySnakeAction,
  cancelSnakeInvite,
  createSnakeInvite,
  getActiveSnakeMatch,
  getSnakeMatch,
  getSnakeSync,
  leaveSnakeMatch,
  listSnakeFriends,
  listSnakeInvites,
  resignSnakeMatch,
  respondSnakeInvite,
  startSnakeMatch,
} from '../services/gameSnakeService.js'
import {
  applyMinesweeperAction,
  cancelMinesweeperInvite,
  createMinesweeperInvite,
  getActiveMinesweeperMatch,
  getMinesweeperMatch,
  getMinesweeperSync,
  leaveMinesweeperMatch,
  listMinesweeperFriends,
  listMinesweeperInvites,
  resignMinesweeperMatch,
  respondMinesweeperInvite,
  startMinesweeperMatch,
} from '../services/gameMinesweeperService.js'
import {
  applyJumpAction,
  cancelJumpInvite,
  createJumpInvite,
  getActiveJumpMatch,
  getJumpMatch,
  getJumpSync,
  leaveJumpMatch,
  listJumpFriends,
  listJumpInvites,
  resignJumpMatch,
  respondJumpInvite,
  startJumpMatch,
} from '../services/gameJumpService.js'

/**
 * 游戏联机 REST 路由（挂载于 /api/games）：
 *   2048（2–10 人竞速）+ 斗地主（3 人）+ 贪吃蛇（2–8 人大地图）
 *   + 扫雷（2–4 人轮流点）+ 跳一跳（2–6 人轮流跳）
 *
 * 全部端点要求账号登录令牌（router 内 authenticate 兜底）；没有公开端点。
 * 第三方应用令牌 / 下载票据不可用（全局认证白名单会拒绝 /games/*）。
 *
 * 限流（每用户，未认证回退 IP）：
 *   - 移动 / 动作：900 次 / 5 分钟（对局中高频操作）
 *   - sync：1800 次 / 5 分钟（轮询降级最多 2 秒一次）
 *   - presence：120 次 / 5 分钟（20 秒心跳）
 *   - 其它写操作（邀请 / 响应 / 取消 / 认输）：60 次 / 5 分钟
 * 上述三个高频端点同时在 index.ts 的全局 apiLimiter 中按精确路径豁免（否则会被 600/15min 卡住）。
 */
const router = Router()
router.use(authenticate)

/**
 * 按用户限流。express-rate-limit v8 要求自定义 keyGenerator 在回退到请求 IP 时
 * 必须调用 ipKeyGenerator（IPv6 归一化），否则创建 limiter 时直接抛校验错误。
 */
function userKeyGenerator(req: Request): string {
  return String(req.user?.userId ?? ipKeyGenerator(req.ip ?? ''))
}

const moveLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 900,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  message: { error: '操作过于频繁，请稍后再试' },
})

const syncLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 1800,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  message: { error: '同步过于频繁，请稍后再试' },
})

const presenceLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  message: { error: '在线心跳过于频繁，请稍后再试' },
})

const gameWriteLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  message: { error: '操作过于频繁，请稍后再试' },
})

/** 当前登录用户 id（authenticate 已保证存在；集中处理类型与兜底） */
function currentUserId(req: Request): number {
  const userId = req.user?.userId
  if (!userId) throw new AppError('未登录', 401)
  return userId
}

/** 校验输入，失败时抛 400（错误文案取 Zod 的第一条 issue） */
function parseInput<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new AppError(issue?.message ? `输入数据无效：${issue.message}` : '输入数据无效', 400)
  }
  return parsed.data as z.infer<S>
}

/** 解析正整数路径参数（邀请 id / 对局 id） */
function parseIdParam(raw: string | undefined, name: string): number {
  const value = Number.parseInt(raw ?? '', 10)
  if (!Number.isInteger(value) || value <= 0) throw new AppError(`无效的${name}`, 400)
  return value
}

/** 当前服务器时间（ISO 字符串） */
function nowIso(): string {
  return new Date().toISOString()
}

// === 好友大厅 ===

router.get('/2048/friends', asyncHandler(async (req, res) => {
  const data = await listGameFriends(currentUserId(req))
  res.json(data)
}))

// === 邀请 ===

router.get('/2048/invites', (req, res) => {
  res.json(listGameInvites(currentUserId(req)))
})

router.post('/2048/invites', gameWriteLimiter, asyncHandler(async (req, res) => {
  const body = parseInput(gameInviteCreateSchema, req.body)
  const data = await createGameInvite(currentUserId(req), body.friendId)
  res.status(201).json(data)
}))

router.post('/2048/invites/:id/respond', gameWriteLimiter, (req, res) => {
  const inviteId = parseIdParam(req.params.id, '邀请 ID')
  const body = parseInput(gameInviteRespondSchema, req.body)
  res.json(respondGameInvite(currentUserId(req), inviteId, body.action))
})

router.delete('/2048/invites/:id', gameWriteLimiter, (req, res) => {
  const inviteId = parseIdParam(req.params.id, '邀请 ID')
  res.json(cancelGameInvite(currentUserId(req), inviteId))
})

// === 轮询降级：统一同步 + 在线心跳 ===

router.get('/2048/sync', syncLimiter, (req, res) => {
  const query = parseInput(gameSyncQuerySchema, req.query)
  res.json(getGameSync(currentUserId(req), query.matchId))
})

router.post('/2048/presence', presenceLimiter, (req, res) => {
  markGamePresence(currentUserId(req))
  res.json({ ok: true, serverTime: nowIso() })
})

// === 对局 ===

// 注意：/matches/active 必须注册在 /matches/:id 之前，否则 "active" 会被当成 id 解析
router.get('/2048/matches/active', (req, res) => {
  res.json({ match: getActiveGameMatch(currentUserId(req)) })
})

router.get('/2048/matches/:id', (req, res) => {
  const matchId = parseIdParam(req.params.id, '对局 ID')
  res.json({ match: getGameMatch(currentUserId(req), matchId) })
})

router.post('/2048/matches/:id/start', gameWriteLimiter, (req, res) => {
  const matchId = parseIdParam(req.params.id, '对局 ID')
  const body = parseInput(gameStartSchema, req.body ?? {})
  res.json(startGameMatch(currentUserId(req), matchId, body.durationMinutes))
})

router.post('/2048/matches/:id/leave', gameWriteLimiter, (req, res) => {
  const matchId = parseIdParam(req.params.id, '对局 ID')
  res.json(leaveGameMatch(currentUserId(req), matchId))
})

router.post('/2048/matches/:id/moves', moveLimiter, (req, res) => {
  const matchId = parseIdParam(req.params.id, '对局 ID')
  const body = parseInput(gameMoveSchema, req.body)
  res.json(applyGameMove(currentUserId(req), matchId, body.direction))
})

router.post('/2048/matches/:id/resign', gameWriteLimiter, (req, res) => {
  const matchId = parseIdParam(req.params.id, '对局 ID')
  res.json(resignGameMatch(currentUserId(req), matchId))
})

// ============================================================
// 斗地主好友联机（3 人房间：邀请 → 叫分 → 出牌；服务端权威，
// 手牌对其他玩家不可见，DTO 按观看者裁剪）
// ============================================================

// === 好友大厅 ===

router.get('/doudizhu/friends', asyncHandler(async (req, res) => {
  const data = await listDoudizhuFriends(currentUserId(req))
  res.json(data)
}))

// === 邀请 ===

router.get('/doudizhu/invites', (req, res) => {
  res.json(listDoudizhuInvites(currentUserId(req)))
})

router.post('/doudizhu/invites', gameWriteLimiter, asyncHandler(async (req, res) => {
  const body = parseInput(gameInviteCreateSchema, req.body)
  const data = await createDoudizhuInvite(currentUserId(req), body.friendId)
  res.status(201).json(data)
}))

router.post('/doudizhu/invites/:id/respond', gameWriteLimiter, (req, res) => {
  const inviteId = parseIdParam(req.params.id, '邀请 ID')
  const body = parseInput(gameInviteRespondSchema, req.body)
  res.json(respondDoudizhuInvite(currentUserId(req), inviteId, body.action))
})

router.delete('/doudizhu/invites/:id', gameWriteLimiter, (req, res) => {
  const inviteId = parseIdParam(req.params.id, '邀请 ID')
  res.json(cancelDoudizhuInvite(currentUserId(req), inviteId))
})

// === 轮询降级：统一同步 + 在线心跳（presence 与 2048 共用同一 TTL 存储） ===

router.get('/doudizhu/sync', syncLimiter, (req, res) => {
  const query = parseInput(gameSyncQuerySchema, req.query)
  res.json(getDoudizhuSync(currentUserId(req), query.matchId))
})

router.post('/doudizhu/presence', presenceLimiter, (req, res) => {
  markGamePresence(currentUserId(req))
  res.json({ ok: true, serverTime: nowIso() })
})

// === 对局 ===

router.get('/doudizhu/matches/active', (req, res) => {
  res.json({ match: getActiveDoudizhuMatch(currentUserId(req)) })
})

router.get('/doudizhu/matches/:id', (req, res) => {
  const matchId = parseIdParam(req.params.id, '对局 ID')
  res.json({ match: getDoudizhuMatch(currentUserId(req), matchId) })
})

router.post('/doudizhu/matches/:id/start', gameWriteLimiter, (req, res) => {
  const matchId = parseIdParam(req.params.id, '对局 ID')
  res.json(startDoudizhuMatch(currentUserId(req), matchId))
})

router.post('/doudizhu/matches/:id/leave', gameWriteLimiter, (req, res) => {
  const matchId = parseIdParam(req.params.id, '对局 ID')
  res.json(leaveDoudizhuMatch(currentUserId(req), matchId))
})

router.post('/doudizhu/matches/:id/actions', moveLimiter, (req, res) => {
  const matchId = parseIdParam(req.params.id, '对局 ID')
  const body = parseInput(doudizhuActionSchema, req.body)
  res.json(applyDoudizhuAction(currentUserId(req), matchId, body))
})

router.post('/doudizhu/matches/:id/resign', gameWriteLimiter, (req, res) => {
  const matchId = parseIdParam(req.params.id, '对局 ID')
  res.json(resignDoudizhuMatch(currentUserId(req), matchId))
})

// ============================================================
// 贪吃蛇 / 扫雷 / 跳一跳：端点形状完全一致，用同一个工厂挂载
// ============================================================

/**
 * 三款后加游戏的 REST 形状与 2048 / 斗地主同构（friends / invites / sync /
 * presence / matches / start / leave / actions / resign），差异只在动作体，
 * 因此用泛型 bundle 挂载一次即可，避免 30+ 个 handler 重复。
 * 2048 与斗地主的既有写法保持原样（它们的 start / moves 形状不同）。
 */
interface GameEndpointBundle<A> {
  /** 路由前缀（如 'snake' → /api/games/snake） */
  base: string
  listFriends: (userId: number) => Promise<unknown>
  listInvites: (userId: number) => unknown
  createInvite: (userId: number, friendId: number) => Promise<unknown>
  respondInvite: (userId: number, inviteId: number, action: 'accept' | 'decline') => unknown
  cancelInvite: (userId: number, inviteId: number) => unknown
  sync: (userId: number, matchId?: number) => unknown
  getActiveMatch: (userId: number) => unknown
  getMatch: (userId: number, matchId: number) => unknown
  startMatch: (userId: number, matchId: number) => unknown
  leaveMatch: (userId: number, matchId: number) => unknown
  applyAction: (userId: number, matchId: number, body: A) => unknown
  resignMatch: (userId: number, matchId: number) => unknown
  actionSchema: z.ZodType<A>
}

function mountGameEndpoints<A>(bundle: GameEndpointBundle<A>): void {
  const base = `/${bundle.base}`

  router.get(`${base}/friends`, asyncHandler(async (req, res) => {
    res.json(await bundle.listFriends(currentUserId(req)))
  }))

  router.get(`${base}/invites`, (req, res) => {
    res.json(bundle.listInvites(currentUserId(req)))
  })

  router.post(`${base}/invites`, gameWriteLimiter, asyncHandler(async (req, res) => {
    const body = parseInput(gameInviteCreateSchema, req.body)
    res.status(201).json(await bundle.createInvite(currentUserId(req), body.friendId))
  }))

  router.post(`${base}/invites/:id/respond`, gameWriteLimiter, (req, res) => {
    const inviteId = parseIdParam(req.params.id, '邀请 ID')
    const body = parseInput(gameInviteRespondSchema, req.body)
    res.json(bundle.respondInvite(currentUserId(req), inviteId, body.action))
  })

  router.delete(`${base}/invites/:id`, gameWriteLimiter, (req, res) => {
    const inviteId = parseIdParam(req.params.id, '邀请 ID')
    res.json(bundle.cancelInvite(currentUserId(req), inviteId))
  })

  router.get(`${base}/sync`, syncLimiter, (req, res) => {
    const query = parseInput(gameSyncQuerySchema, req.query)
    res.json(bundle.sync(currentUserId(req), query.matchId))
  })

  // presence 存储跨游戏共享，三款游戏都只写心跳
  router.post(`${base}/presence`, presenceLimiter, (req, res) => {
    markGamePresence(currentUserId(req))
    res.json({ ok: true, serverTime: nowIso() })
  })

  // 注意：/matches/active 必须注册在 /matches/:id 之前，否则 "active" 会被当成 id 解析
  router.get(`${base}/matches/active`, (req, res) => {
    res.json({ match: bundle.getActiveMatch(currentUserId(req)) })
  })

  router.get(`${base}/matches/:id`, (req, res) => {
    const matchId = parseIdParam(req.params.id, '对局 ID')
    res.json({ match: bundle.getMatch(currentUserId(req), matchId) })
  })

  router.post(`${base}/matches/:id/start`, gameWriteLimiter, (req, res) => {
    const matchId = parseIdParam(req.params.id, '对局 ID')
    res.json(bundle.startMatch(currentUserId(req), matchId))
  })

  router.post(`${base}/matches/:id/leave`, gameWriteLimiter, (req, res) => {
    const matchId = parseIdParam(req.params.id, '对局 ID')
    res.json(bundle.leaveMatch(currentUserId(req), matchId))
  })

  router.post(`${base}/matches/:id/actions`, moveLimiter, (req, res) => {
    const matchId = parseIdParam(req.params.id, '对局 ID')
    const body = parseInput(bundle.actionSchema, req.body)
    res.json(bundle.applyAction(currentUserId(req), matchId, body))
  })

  router.post(`${base}/matches/:id/resign`, gameWriteLimiter, (req, res) => {
    const matchId = parseIdParam(req.params.id, '对局 ID')
    res.json(bundle.resignMatch(currentUserId(req), matchId))
  })
}

mountGameEndpoints({
  base: 'snake',
  listFriends: listSnakeFriends,
  listInvites: listSnakeInvites,
  createInvite: createSnakeInvite,
  respondInvite: respondSnakeInvite,
  cancelInvite: cancelSnakeInvite,
  sync: getSnakeSync,
  getActiveMatch: getActiveSnakeMatch,
  getMatch: getSnakeMatch,
  startMatch: startSnakeMatch,
  leaveMatch: leaveSnakeMatch,
  applyAction: applySnakeAction,
  resignMatch: resignSnakeMatch,
  actionSchema: snakeActionSchema,
})

mountGameEndpoints({
  base: 'minesweeper',
  listFriends: listMinesweeperFriends,
  listInvites: listMinesweeperInvites,
  createInvite: createMinesweeperInvite,
  respondInvite: respondMinesweeperInvite,
  cancelInvite: cancelMinesweeperInvite,
  sync: getMinesweeperSync,
  getActiveMatch: getActiveMinesweeperMatch,
  getMatch: getMinesweeperMatch,
  startMatch: startMinesweeperMatch,
  leaveMatch: leaveMinesweeperMatch,
  applyAction: applyMinesweeperAction,
  resignMatch: resignMinesweeperMatch,
  actionSchema: minesweeperActionSchema,
})

mountGameEndpoints({
  base: 'jump',
  listFriends: listJumpFriends,
  listInvites: listJumpInvites,
  createInvite: createJumpInvite,
  respondInvite: respondJumpInvite,
  cancelInvite: cancelJumpInvite,
  sync: getJumpSync,
  getActiveMatch: getActiveJumpMatch,
  getMatch: getJumpMatch,
  startMatch: startJumpMatch,
  leaveMatch: leaveJumpMatch,
  applyAction: applyJumpAction,
  resignMatch: resignJumpMatch,
  actionSchema: jumpActionSchema,
})

export default router
