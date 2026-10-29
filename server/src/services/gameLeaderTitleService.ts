/**
 * 单机榜一传说称号：每个游戏至多一位持有者，由服务端自动重算。
 *
 * 触发时机：
 * - 单机战绩写入后 2 秒（同游戏合并，避免刷榜时反复重算）
 * - 服务启动 30 秒后全量重算一次（兜底历史数据 / 线上库直改）
 *
 * 发奖口径：只有「换人」时发一次，且同一用户同一游戏同一自然日最多一次
 * （以 PointsLedger 当天是否已有同说明的榜一奖励为依据）。
 * 奖励落在 `game: null` 的流水上，因此不占用游戏的每日获得 / 输分上限。
 */

import prisma from '../lib/prisma.js'
import type { Prisma } from '@prisma/client'
import { GAME_KEYS, type GameKey } from '../lib/gameStatsRules.js'
import { leaderboardWhere, soloLeaderMetric } from '../lib/gameLeaderboard.js'
import { leaderBonusNote, leaderTitleDto, type LeaderTitleDto } from '../lib/gameLeaderTitles.js'
import { getTodayDayStart } from '../lib/pointsRules.js'
import { awardPointsTx, getPointsConfig } from './pointsService.js'

export type { LeaderTitleDto }

/** 某个用户当前持有的全部传说称号（资料页、顶栏兜底展示） */
export async function listUserLeaderTitles(userId: number): Promise<LeaderTitleDto[]> {
  const rows = await prisma.gameLeaderTitle.findMany({
    where: { userId },
    orderBy: { game: 'asc' },
  })
  return rows
    .filter((row) => (GAME_KEYS as readonly string[]).includes(row.game))
    .map(leaderTitleDto)
}

export interface LeaderRecomputeResult {
  game: string
  /** 当前榜一；无有效成绩时为 null */
  userId: number | null
  /** 是否发生了换人（或称号被收回） */
  changed: boolean
}

/**
 * 重算单个游戏的榜一称号。
 * 读取「单机代表变体」的榜首；换人时在同一事务里改写称号并发奖。
 */
export async function recomputeLeaderTitle(
  game: GameKey,
  options?: { now?: number },
): Promise<LeaderRecomputeResult> {
  const metric = soloLeaderMetric(game)
  if (!metric) return { game, userId: null, changed: false }

  const where = leaderboardWhere(metric) as Prisma.GameStatWhereInput
  const orderBy: Prisma.GameStatOrderByWithRelationInput[] = [
    { [metric.metric]: metric.order },
    { updatedAt: 'asc' },
  ]
  const [top, current] = await Promise.all([
    prisma.gameStat.findFirst({ where, orderBy, select: { userId: true } }),
    prisma.gameLeaderTitle.findUnique({ where: { game } }),
  ])

  if (!top) {
    if (!current) return { game, userId: null, changed: false }
    await prisma.gameLeaderTitle.delete({ where: { game } }).catch(() => undefined)
    return { game, userId: null, changed: true }
  }

  if (current?.userId === top.userId) return { game, userId: top.userId, changed: false }

  const config = await getPointsConfig()
  const reward = config.leaderTitle.rewardPoints
  const note = leaderBonusNote(game)
  const dayStart = getTodayDayStart(options?.now)

  await prisma.$transaction(async (tx) => {
    // 称号转给新榜一：原佩戴者的佩戴关系必须清掉，避免继续显示别人的称号
    if (current) {
      await tx.user.updateMany({
        where: { equippedLeaderTitleId: current.id },
        data: { equippedLeaderTitleId: null },
      })
    }
    await tx.gameLeaderTitle.upsert({
      where: { game },
      create: { game, userId: top.userId },
      update: { userId: top.userId, awardedAt: new Date() },
    })
    if (reward <= 0) return
    // 同一用户同一游戏每天只发一次：反复换人也只领一次奖励
    const already = await tx.pointsLedger.findFirst({
      where: {
        userId: top.userId,
        reason: 'leader_bonus',
        note,
        createdAt: { gte: dayStart },
      },
      select: { id: true },
    })
    if (already) return
    await awardPointsTx(tx, top.userId, { amount: reward, reason: 'leader_bonus', game: null, note })
  })

  return { game, userId: top.userId, changed: true }
}

/** 启动兜底：全量重算（串行，避免同时打满数据库） */
export async function recomputeAllLeaderTitles(): Promise<void> {
  for (const game of GAME_KEYS) {
    try {
      await recomputeLeaderTitle(game)
    } catch (err) {
      console.warn(`[leaderTitle] 重算 ${game} 失败：`, err instanceof Error ? err.message : err)
    }
  }
}

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()
const RECOMPUTE_DELAY_MS = 2000

/** 单机战绩写入后调用：同游戏 2 秒内的多次触发合并成一次 */
export function scheduleLeaderRecompute(game: string): void {
  if (!(GAME_KEYS as readonly string[]).includes(game)) return
  const existing = pendingTimers.get(game)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    pendingTimers.delete(game)
    void recomputeLeaderTitle(game as GameKey).catch((err) => {
      console.warn(`[leaderTitle] 异步重算 ${game} 失败：`, err instanceof Error ? err.message : err)
    })
  }, RECOMPUTE_DELAY_MS)
  if (typeof timer.unref === 'function') timer.unref()
  pendingTimers.set(game, timer)
}
