/**
 * 游戏门票服务（2026-11-04）。
 *
 * 门票本体 = 搜打撤仓库里的 `game_ticket`（RaidInventoryItem，(userId, itemKey) 唯一），
 * 余额只从数据库读，绝不相信客户端上报；价格口径全部转引
 * `lib/gameTicketRules.ts` / `lib/raidRun.ts`，本文件不重述任何数字。
 *
 * 两条独立通道：
 *   1) 单机（本次改造的重点）——单机页历史上没有任何「服务端开局」调用，
 *      所以新增 session：`startSoloSession` 扣 1 张票并落一条 open 的 GameSession，
 *      `POST /api/game-stats/result` 必须带上这个 sessionId 才结算，
 *      于是「不付票就刷积分」被从根上堵死。
 *   2) 联机——`consumeTicketsForMatch` 由 routes/games.ts 的三个开局端点调用
 *      （本服务不 import 任何游戏状态机，避免环依赖）。
 *
 * 不跑定时器：悬空超过 6 小时的单机会话在本人下次开局时惰性结算（与 crisis / bank /
 * pet / redpacket 的「读时结算」约定一致）。
 *
 * 幂等：所有票据动作先写 GameTicketLog（dedupKey 唯一索引），撞 P2002 即视为
 * 「已经做过」静默跳过；会话关闭一律走 `updateMany({ status: 'open' })` 的 CAS，
 * 所以 20 积分返还只可能落地一次。
 *
 * 积分返还走 `awardPointsTx` 且 **game: null**（对齐 leader_bonus / crisis_payment）：
 * `awardGamePointsTx` 的每日上限是按台账 `game = <游戏>` 聚合正数流水算的，
 * 门票返还若带上 game 就会 (a) 被当日上限截断、(b) 反过来挤占该游戏当日的正向额度。
 * 记 game: null 后，这 20 分既不受上限约束，也不吃上限额度。
 */

import prisma from '../lib/prisma.js'
import type { Prisma } from '@prisma/client'
import type { FeatureKey } from '../lib/features.js'
import { AppError } from '../middleware/errorHandler.js'
import { isFeatureEnabled } from './featureService.js'
import { awardPointsTx } from './pointsService.js'
import {
  MAX_TICKET_NOTE_LENGTH,
  ONLINE_TICKET_VARIANT,
  SESSION_STATUS_CLOSED,
  SESSION_STATUS_OPEN,
  SOLO_TICKET_VARIANT,
  TICKET_ERROR_CODE,
  TICKET_ITEM_KEY,
  TICKET_NET_COST_PER_MATCH,
  TICKET_PRICE,
  TICKET_REFUND_POINTS,
  TICKET_REFUND_REASON,
  TICKET_RECYCLE_VALUE,
  type TicketAction,
  type TicketGameKey,
  type TicketVariant,
  consumeOnlineDedupKey,
  consumeSoloDedupKey,
  formatMissingTicketMessage,
  isStaleSoloSession,
  isTicketExemptRole,
  normalizeMatchId,
  normalizeTicketAmount,
  normalizeTicketGame,
  normalizeUserIds,
  normalizeSessionId,
  returnOnlineDedupKey,
  refundOnlineDedupKey,
  refundSoloDedupKey,
  STALE_SOLO_SESSION_MS,
  TICKET_GAME_KEYS,
  ticketDeltaForAction,
  ticketVariantOf,
} from '../lib/gameTicketRules.js'

type Db = Prisma.TransactionClient

/**
 * 严格度开关的键名。主代理会把 `gameTicket` 加进 lib/features.ts 的 FEATURE_KEYS；
 * 在那之前 `effectiveFeatureEnabled` 对未知键返回 true（`map[key] !== false`），
 * 也就是「默认开启」，加键后默认值同样是 true，行为连续。
 */
const GAME_TICKET_FEATURE_KEY = 'gameTicket' as FeatureKey

/* ============================================================
   开关与余额
   ============================================================ */

/**
 * 门票系统是否生效（= 单机上报战绩是否必须有会话）。
 * 走 featureService.isFeatureEnabled：管理员恒为 true（所以管理员也走会话核销），
 * 但管理员免票（见 isTicketExemptRole），不会被自己的开关锁死在「无票不能开局」。
 */
export async function isTicketEnforced(role?: string): Promise<boolean> {
  return isFeatureEnabled(GAME_TICKET_FEATURE_KEY, role)
}

/** 当前门票余额（仓库里的 game_ticket 数量；管理员按「免票」展示为 Infinity 之外的真实库存） */
export async function getTicketAmount(userId: number, tx: Db = prisma): Promise<number> {
  const row = await tx.raidInventoryItem.findUnique({
    where: { userId_itemKey: { userId, itemKey: TICKET_ITEM_KEY } },
    select: { amount: true },
  })
  return normalizeTicketAmount(row?.amount)
}

async function isExemptUserTx(tx: Db, userId: number): Promise<boolean> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true } })
  return isTicketExemptRole(user?.role)
}

async function isExemptUser(userId: number): Promise<boolean> {
  return isExemptUserTx(prisma, userId)
}

export interface TicketStatusDto {
  /** 门票系统是否生效（关闭时前端完全不做门票拦截） */
  enabled: boolean
  /** 仓库里的门票数量 */
  tickets: number
  /** 管理员免票 */
  exempt: boolean
  price: number
  refundPoints: number
  recycleValue: number
  netCostPerMatch: number
  /** 需要门票的游戏 key（大厅卡片据此显示「本局需 1 张门票」） */
  games: readonly string[]
  /** 当前仍未结算的单机会话数（正常应为 0–1） */
  openSessions: number
}

export async function getTicketStatus(userId: number, role?: string): Promise<TicketStatusDto> {
  const [enabled, tickets, exempt, openSessions] = await Promise.all([
    isTicketEnforced(role),
    getTicketAmount(userId),
    isExemptUser(userId),
    prisma.gameSession.count({ where: { userId, variant: SOLO_TICKET_VARIANT, status: SESSION_STATUS_OPEN } }),
  ])
  return {
    enabled,
    tickets,
    exempt,
    price: TICKET_PRICE,
    refundPoints: TICKET_REFUND_POINTS,
    recycleValue: TICKET_RECYCLE_VALUE,
    netCostPerMatch: TICKET_NET_COST_PER_MATCH,
    games: TICKET_GAME_KEYS,
    openSessions,
  }
}

/* ============================================================
   票据台账原语
   ============================================================ */

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002'
}

/** 扣 1 张票（条件更新防并发超扣，与 spendPointsTx 的反超扣写法同构） */
async function spendTicketTx(tx: Db, userId: number, count: number): Promise<void> {
  if (count <= 0) return
  // listedAmount 恒为 0（搜打撤交易行已整体删除），因此 amount 就是可扣票数
  const result = await tx.raidInventoryItem.updateMany({
    where: { userId, itemKey: TICKET_ITEM_KEY, amount: { gte: count } },
    data: { amount: { decrement: count } },
  })
  if (result.count === 0) {
    throw new AppError(
      `没有游戏门票：门票 ${TICKET_PRICE} 积分一张，打完必返 ${TICKET_REFUND_POINTS} 积分，可在搜打撤官方商店购买`,
      400,
      TICKET_ERROR_CODE,
    )
  }
}

/** 退 1 张票（回落到仓库；行不存在则新建） */
async function addTicketTx(tx: Db, userId: number, count: number): Promise<void> {
  if (count <= 0) return
  await tx.raidInventoryItem.upsert({
    where: { userId_itemKey: { userId, itemKey: TICKET_ITEM_KEY } },
    create: { userId, itemKey: TICKET_ITEM_KEY, amount: count },
    update: { amount: { increment: count } },
  })
}

interface TicketMoveArgs {
  userId: number
  action: TicketAction
  game: string
  variant: TicketVariant
  dedupKey: string
  sessionId?: number | null
  matchId?: string | null
  points?: number
  /** 管理员免票：台账照写（幂等锚），但不动仓库票数 */
  exempt: boolean
}

/**
 * 写一条票据台账并同步仓库票数。
 * 返回 false 表示 dedupKey 已存在（跨重启的「已经做过」），调用方按幂等跳过处理。
 *
 * 台账本身不带备注列：动作语义全在 action / tickets / points / dedupKey 四个字段上，
 * 面向玩家的中文说明写在积分台账（PointsLedger.note）里。
 */
async function ticketMoveTx(tx: Db, args: TicketMoveArgs): Promise<boolean> {
  const tickets = args.exempt ? 0 : ticketDeltaForAction(args.action)
  try {
    await tx.gameTicketLog.create({
      data: {
        userId: args.userId,
        action: args.action,
        game: args.game,
        variant: args.variant,
        sessionId: args.sessionId ?? null,
        matchId: args.matchId ?? null,
        tickets,
        points: args.points ?? 0,
        dedupKey: args.dedupKey.slice(0, 191),
      },
    })
  } catch (err) {
    if (isUniqueViolation(err)) return false
    throw err
  }
  if (tickets < 0) await spendTicketTx(tx, args.userId, -tickets)
  else if (tickets > 0) await addTicketTx(tx, args.userId, tickets)
  return true
}

/* ============================================================
   单机会话
   ============================================================ */

/** 关闭会话（CAS）并返还 20 积分；重复调用只会落地一次 */
async function closeAndRefundSoloTx(tx: Db, session: { id: number; userId: number; game: string }): Promise<number> {
  const closedAt = new Date()
  const cas = await tx.gameSession.updateMany({
    where: { id: session.id, status: SESSION_STATUS_OPEN },
    data: { status: SESSION_STATUS_CLOSED, refunded: true, closedAt },
  })
  // 抢不到说明并发的另一路已经结算，绝不二次返还
  if (cas.count === 0) return 0

  const booked = await ticketMoveTx(tx, {
    userId: session.userId,
    action: 'refund',
    game: session.game,
    variant: SOLO_TICKET_VARIANT,
    sessionId: session.id,
    points: TICKET_REFUND_POINTS,
    dedupKey: refundSoloDedupKey(session.id),
    exempt: false,
  })
  if (!booked) return 0

  await awardPointsTx(tx, session.userId, {
    amount: TICKET_REFUND_POINTS,
    reason: TICKET_REFUND_REASON,
    // 见文件头：game 必须为 null，否则会被该游戏的每日上限截断并反过来吃掉上限额度
    game: null,
    note: `门票返还 · ${session.game} 单机（${TICKET_REFUND_POINTS} 积分）`.slice(0, MAX_TICKET_NOTE_LENGTH),
  })
  return TICKET_REFUND_POINTS
}

/**
 * 惰性结算悬空单机会话（不跑定时器）：把本人超过 6 小时仍未结算的 open 会话关闭并返还。
 * 只在本人下次开局时执行，成本一次 findMany。
 */
async function settleStaleSoloSessionsTx(tx: Db, userId: number, now: number): Promise<number> {
  const cutoff = new Date(now - STALE_SOLO_SESSION_MS)
  const stale = await tx.gameSession.findMany({
    where: { userId, variant: SOLO_TICKET_VARIANT, status: SESSION_STATUS_OPEN, startedAt: { lte: cutoff } },
    take: 20,
    orderBy: { startedAt: 'asc' },
  })
  let refunded = 0
  for (const session of stale) {
    if (!isStaleSoloSession(session.startedAt.getTime(), now)) continue
    refunded += await closeAndRefundSoloTx(tx, session)
  }
  return refunded
}

export interface SoloSessionStartDto {
  /** 门票系统未生效且客户端仍来开局时才会是 null（正常情况下都有会话） */
  sessionId: number
  ticketsLeft: number
  balance: number
  exempt: boolean
  refundedStale: number
}

/** 单机开局：扣 1 张门票并建立会话（管理员免票仍建会话，保证 /result 口径统一） */
export async function startSoloSession(
  userId: number,
  rawGame: unknown,
  rawVariant: unknown = SOLO_TICKET_VARIANT,
): Promise<SoloSessionStartDto> {
  const game: TicketGameKey | null = normalizeTicketGame(rawGame)
  if (!game) throw new AppError('该玩法不需要门票', 400)
  const variant = ticketVariantOf(rawVariant) ?? SOLO_TICKET_VARIANT
  if (variant !== SOLO_TICKET_VARIANT) {
    throw new AppError('联机对局的门票在服务端开局时自动扣除', 400)
  }

  const now = Date.now()
  const result = await prisma.$transaction(async (tx) => {
    const exempt = await isExemptUserTx(tx, userId)
    const refundedStale = await settleStaleSoloSessionsTx(tx, userId, now)
    const session = await tx.gameSession.create({
      data: {
        userId,
        game,
        variant: SOLO_TICKET_VARIANT,
        status: SESSION_STATUS_OPEN,
        startedAt: new Date(now),
        note: exempt ? '管理员免票' : null,
      },
    })
    await ticketMoveTx(tx, {
      userId,
      action: 'consume',
      game,
      variant: SOLO_TICKET_VARIANT,
      sessionId: session.id,
      dedupKey: consumeSoloDedupKey(session.id),
      exempt,
    })
    const user = await tx.user.findUnique({ where: { id: userId }, select: { points: true } })
    const ticketsLeft = await getTicketAmount(userId, tx)
    return {
      sessionId: session.id,
      ticketsLeft,
      balance: user?.points ?? 0,
      exempt,
      refundedStale,
    }
  })
  return result
}

export interface SoloSessionSettleDto {
  refundedPoints: number
}

/**
 * 单机局终核销（在 recordSoloResult 的事务内调用）。
 * 会话不属于本人 / 已核销 / 游戏不匹配 / 未提供 → 一律 400 + TICKET_REQUIRED，
 * 客户端据此弹出门票说明并把这一局当作「未计战绩」处理。
 */
export async function settleSoloSessionTx(
  tx: Db,
  userId: number,
  rawSessionId: unknown,
  game: string,
): Promise<SoloSessionSettleDto> {
  const sessionId = normalizeSessionId(rawSessionId)
  if (sessionId === null) {
    throw new AppError('本局未消耗游戏门票，战绩与积分不记录', 400, TICKET_ERROR_CODE)
  }
  const session = await tx.gameSession.findFirst({
    where: { id: sessionId, userId },
    select: { id: true, userId: true, game: true, status: true, variant: true },
  })
  if (!session) throw new AppError('对局会话不存在', 400, TICKET_ERROR_CODE)
  if (session.variant !== SOLO_TICKET_VARIANT) {
    throw new AppError('联机对局请按联机结算流程上报', 400, TICKET_ERROR_CODE)
  }
  if (session.status !== SESSION_STATUS_OPEN) {
    throw new AppError('本局门票已核销，请重新开始一局', 400, TICKET_ERROR_CODE)
  }
  if (session.game !== game) throw new AppError('对局会话与上报的游戏不一致', 400, TICKET_ERROR_CODE)
  return { refundedPoints: await closeAndRefundSoloTx(tx, session) }
}

export interface SoloSessionCloseDto {
  closed: boolean
  refundedPoints: number
  ticketsLeft: number
}

/**
 * 显式结束一局（玩家中途离开页面时由前端调用，服务端不跑定时器）。
 * 语义与悬空结算一致：会话关闭 + 返还 20 积分；门票已经在开局时扣掉，不退。
 * 对已关闭 / 不存在的会话返回 closed:false，幂等。
 */
export async function closeSoloSession(userId: number, rawSessionId: unknown): Promise<SoloSessionCloseDto> {
  const sessionId = normalizeSessionId(rawSessionId)
  if (sessionId === null) {
    return { closed: false, refundedPoints: 0, ticketsLeft: await getTicketAmount(userId) }
  }
  const outcome = await prisma.$transaction(async (tx) => {
    const session = await tx.gameSession.findFirst({
      where: { id: sessionId, userId, status: SESSION_STATUS_OPEN },
      select: { id: true, userId: true, game: true },
    })
    if (!session) return { closed: false, refundedPoints: 0 }
    return { closed: true, refundedPoints: await closeAndRefundSoloTx(tx, session) }
  })
  return {
    closed: outcome.closed,
    refundedPoints: outcome.refundedPoints,
    ticketsLeft: await getTicketAmount(userId),
  }
}

/* ============================================================
   联机对局（供 routes/games.ts 的三个开局端点调用）
   ============================================================ */

export interface MatchTicketResultDto {
  /** 实际扣票的用户（管理员免票也在内，只是台账 tickets = 0） */
  consumed: number[]
  /** 门票系统未生效 / 该玩法不需要门票时为 true（调用方无需再判开关） */
  skipped: boolean
  ticketsLeft: Record<string, number>
}

/**
 * 联机开局扣票（事务自持，不在调用方事务里）。
 *
 * 语义 = 先全量预检「在座每位都有 ≥1 张票」，缺票直接 400 且文案点名缺票的人；
 * 预检通过后在一个事务里逐人扣票 —— 任一步失败整笔回滚，绝不会出现「有人扣了有人没扣」。
 * `startMatch` 自身抛错时调用方再调 `returnTicketsForMatch` 回滚（同一组幂等键，可重复调用）。
 */
export async function consumeTicketsForMatch(
  rawGame: unknown,
  rawMatchId: unknown,
  rawUserIds: unknown,
): Promise<MatchTicketResultDto> {
  const empty: MatchTicketResultDto = { consumed: [], skipped: true, ticketsLeft: {} }
  const game = normalizeTicketGame(rawGame)
  if (!game) return empty
  const matchId = normalizeMatchId(rawMatchId)
  if (matchId === null) throw new AppError('无效的对局 ID', 400)
  const userIds = normalizeUserIds(rawUserIds)
  if (userIds.length === 0) throw new AppError('对局里没有可扣票的玩家', 400)

  // 开关关闭 → 与门票上线前逐字一致：不扣票、不建记录
  if (!(await isTicketEnforced())) return empty

  const [users, rows] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, role: true },
    }),
    prisma.raidInventoryItem.findMany({
      where: { userId: { in: userIds }, itemKey: TICKET_ITEM_KEY },
      select: { userId: true, amount: true },
    }),
  ])
  const userById = new Map(users.map((user) => [user.id, user]))
  const amountById = new Map(rows.map((row) => [row.userId, normalizeTicketAmount(row.amount)]))

  const missing: string[] = []
  for (const userId of userIds) {
    const user = userById.get(userId)
    if (!user) {
      missing.push(`用户#${userId}`)
      continue
    }
    if (isTicketExemptRole(user.role)) continue
    if ((amountById.get(userId) ?? 0) < 1) missing.push(user.username)
  }
  if (missing.length > 0) throw new AppError(formatMissingTicketMessage(missing), 400, TICKET_ERROR_CODE)

  const consumed = await prisma.$transaction(async (tx) => {
    const ids: number[] = []
    for (const userId of userIds) {
      const exempt = isTicketExemptRole(userById.get(userId)?.role)
      await ticketMoveTx(tx, {
        userId,
        action: 'consume',
        game,
        variant: ONLINE_TICKET_VARIANT,
        matchId,
        dedupKey: consumeOnlineDedupKey(game, matchId, userId),
        exempt,
      })
      ids.push(userId)
    }
    return ids
  })

  const ticketsLeft = await ticketAmountsFor(userIds)
  return { consumed, skipped: false, ticketsLeft }
}

async function ticketAmountsFor(userIds: readonly number[]): Promise<Record<string, number>> {
  const rows = await prisma.raidInventoryItem.findMany({
    where: { userId: { in: [...userIds] }, itemKey: TICKET_ITEM_KEY },
    select: { userId: true, amount: true },
  })
  const map: Record<string, number> = {}
  for (const userId of userIds) map[String(userId)] = 0
  for (const row of rows) map[String(row.userId)] = normalizeTicketAmount(row.amount)
  return map
}

export interface MatchTicketReturnDto {
  returned: number[]
  skipped: boolean
}

/**
 * 联机未开局退票（开局端点 startMatch 抛错时的补偿，以及 routes/games.ts 注册的
 * 「无胜负早退」监听都会调它；两处叠加由 r:o 幂等键兜住，可重复调用）。
 *
 * 只退还**确实扣过票**的人：没有 c:o 记录（门票开关上线前的旧对局、已经退过票的
 * 对局）一律跳过，否则「等一个房间自然过期」就能白刷门票。
 * 退完后删除 c:o 记录：房主重试开局时可以重新扣票（否则幂等键会让重试变成免费局）。
 */
export async function returnTicketsForMatch(
  rawGame: unknown,
  rawMatchId: unknown,
  rawUserIds: unknown,
): Promise<MatchTicketReturnDto> {
  const game = normalizeTicketGame(rawGame)
  const matchId = normalizeMatchId(rawMatchId)
  const userIds = normalizeUserIds(rawUserIds)
  if (!game || matchId === null || userIds.length === 0) return { returned: [], skipped: true }

  const returned = await prisma.$transaction(async (tx) => {
    const ids: number[] = []
    for (const userId of userIds) {
      const consumeKey = consumeOnlineDedupKey(game, matchId, userId)
      const paid = await tx.gameTicketLog.findUnique({
        where: { dedupKey: consumeKey },
        select: { id: true, tickets: true },
      })
      if (!paid) continue
      const booked = await ticketMoveTx(tx, {
        userId,
        action: 'return',
        game,
        variant: ONLINE_TICKET_VARIANT,
        matchId,
        dedupKey: returnOnlineDedupKey(game, matchId, userId),
        // 免票（管理员）的 c:o 记录 tickets = 0：写一条同形状的 r:o 记录，不动仓库
        exempt: paid.tickets === 0,
      })
      if (!booked) continue
      // 扣票记录作废（见函数注释）：房主重试开局时才能重新扣票
      await tx.gameTicketLog.delete({ where: { id: paid.id } })
      ids.push(userId)
    }
    return ids
  })
  return { returned, skipped: false }
}

export interface MatchPlayerOutcome {
  userId: number
  outcome?: string
}

/**
 * 联机局终每人返还 20 积分（在调用方事务内执行）。
 * 只返给确实付过门票的人（c:o 记录在），未付票（门票开关上线前的对局 / 已退票）不返。
 */
export async function refundMatchPointsTx(
  tx: Db,
  rawGame: unknown,
  rawMatchId: unknown,
  results: readonly (MatchPlayerOutcome | number | null | undefined)[],
): Promise<number[]> {
  const game = normalizeTicketGame(rawGame)
  const matchId = normalizeMatchId(rawMatchId)
  if (!game || matchId === null) return []
  const userIds = normalizeUserIds(
    (Array.isArray(results) ? results : []).map((item) =>
      typeof item === 'number' ? item : item && typeof item === 'object' ? (item as MatchPlayerOutcome).userId : null,
    ),
  )

  const refunded: number[] = []
  for (const userId of userIds) {
    const paid = await tx.gameTicketLog.findUnique({
      where: { dedupKey: consumeOnlineDedupKey(game, matchId, userId) },
      select: { id: true },
    })
    if (!paid) continue
    const booked = await ticketMoveTx(tx, {
      userId,
      action: 'refund',
      game,
      variant: ONLINE_TICKET_VARIANT,
      matchId,
      points: TICKET_REFUND_POINTS,
      dedupKey: refundOnlineDedupKey(game, matchId, userId),
      exempt: false,
    })
    if (!booked) continue
    await awardPointsTx(tx, userId, {
      amount: TICKET_REFUND_POINTS,
      reason: TICKET_REFUND_REASON,
      game: null,
      note: `门票返还 · ${game} 联机对局（${TICKET_REFUND_POINTS} 积分）`.slice(0, MAX_TICKET_NOTE_LENGTH),
    })
    refunded.push(userId)
  }
  return refunded
}

/** refundMatchPointsTx 的自持事务版（供路由 / 监听器直接调用） */
export async function refundMatchPoints(
  rawGame: unknown,
  rawMatchId: unknown,
  results: readonly (MatchPlayerOutcome | number | null | undefined)[],
): Promise<number[]> {
  const game = normalizeTicketGame(rawGame)
  const matchId = normalizeMatchId(rawMatchId)
  if (!game || matchId === null) return []
  return prisma.$transaction((tx) => refundMatchPointsTx(tx, game, matchId, results))
}

/**
 * 从各游戏开局端点的返回 DTO 里取在座玩家 id（全部游戏都是
 * `{ match: { players: [{ userId }] } }` 或 `{ players: [...] }` 形状）。
 * 认不出来的形状返回空数组，调用方据此报「对局里没有可扣票的玩家」。
 */
export function seatedUserIdsFromMatchDto(dto: unknown): number[] {
  const root = dto && typeof dto === 'object' ? (dto as Record<string, unknown>) : {}
  const candidates: unknown[] = []
  const match = root.match
  if (match && typeof match === 'object') candidates.push((match as Record<string, unknown>).players)
  candidates.push(root.players)
  for (const list of candidates) {
    if (!Array.isArray(list)) continue
    const ids: number[] = []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      const raw = row.userId ?? row.id
      if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) ids.push(raw)
    }
    if (ids.length > 0) return normalizeUserIds(ids)
  }
  return []
}

/* ============================================================
   概览（GET /api/game-stats/tickets 之外的调试 / 自描述口径）
   ============================================================ */

export const TICKET_ECONOMICS = {
  itemKey: TICKET_ITEM_KEY,
  price: TICKET_PRICE,
  refundPoints: TICKET_REFUND_POINTS,
  recycleValue: TICKET_RECYCLE_VALUE,
  netCostPerMatch: TICKET_NET_COST_PER_MATCH,
} as const
