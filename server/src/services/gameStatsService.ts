import prisma from '../lib/prisma.js'
import type { Prisma } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import {
  buildSoloDelta,
  clampImportRecord,
  isGameKey,
  isKnownVariant,
  mergeCounters,
  validateSoloResult,
  type GameKey,
  type GameStatCounters,
  type SoloResultInput,
} from '../lib/gameStatsRules.js'
import {
  getLeaderboardMetric,
  leaderboardWhere,
  SOLO_LEADER_VARIANTS,
  type LeaderboardMetric,
} from '../lib/gameLeaderboard.js'
import type { GameEndResult } from './gameStatsHooks.js'
import { awardGamePointsTx, effectiveTitleDto, getPointsConfig } from './pointsService.js'
import { leaderTitleDto } from '../lib/gameLeaderTitles.js'
import { scheduleLeaderRecompute } from './gameLeaderTitleService.js'

type StatRow = {
  id: number
  userId: number
  game: string
  variant: string
  games: number
  wins: number
  losses: number
  draws: number
  deaths: number
  scoreTotal: number
  bestScore: number
  bestTimeMs: number | null
  bestCombo: number
  bestCoins: number
  bestDistance: number
  totalJumps: number
  offsetSum: number
  offsetCount: number
  createdAt: Date
  updatedAt: Date
}

function countersOf(row: StatRow | null): GameStatCounters | null {
  if (!row) return null
  return {
    games: row.games,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    deaths: row.deaths,
    scoreTotal: row.scoreTotal,
    bestScore: row.bestScore,
    bestTimeMs: row.bestTimeMs,
    bestCombo: row.bestCombo,
    bestCoins: row.bestCoins,
    bestDistance: row.bestDistance,
    totalJumps: row.totalJumps,
    offsetSum: row.offsetSum,
    offsetCount: row.offsetCount,
  }
}

function upsertPayload(userId: number, game: string, variant: string, merged: GameStatCounters) {
  return {
    userId,
    game,
    variant,
    ...merged,
  }
}

export async function listStats(userId: number): Promise<StatRow[]> {
  return prisma.gameStat.findMany({
    where: { userId },
    orderBy: [{ game: 'asc' }, { variant: 'asc' }],
  })
}

export async function recordSoloResult(
  userId: number,
  input: SoloResultInput,
): Promise<{ stat: StatRow; points: { delta: number; balance: number; gross: number; capped: boolean } }> {
  const error = validateSoloResult(input)
  if (error) throw new AppError(error, 400)
  const delta = buildSoloDelta(input)
  const pointsConfig = await getPointsConfig()
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.gameStat.findUnique({
      where: { userId_game_variant: { userId, game: input.game, variant: input.variant } },
    })
    const merged = mergeCounters(countersOf(existing), delta)
    const stat = await tx.gameStat.upsert({
      where: { userId_game_variant: { userId, game: input.game, variant: input.variant } },
      create: upsertPayload(userId, input.game, input.variant, merged),
      update: merged,
    })
    // 统一积分：所有游戏共用一套余额，按管理员配置的胜负/参与/表现加成结算
    const points = await awardGamePointsTx(
      tx,
      userId,
      input.game as GameKey,
      { outcome: input.outcome, score: input.score },
      { config: pointsConfig },
    )
    return { stat, points }
  })
  // 榜一称号在事务提交后再算（2 秒防抖），失败不影响战绩与积分
  scheduleLeaderRecompute(input.game)
  return result
}

export async function importStats(
  userId: number,
  records: unknown[],
): Promise<{ imported: boolean; stats: StatRow[] }> {
  if (records.length > 100) throw new AppError('一次最多导入 100 条记录', 400)
  const parsed = records.map((record) => clampImportRecord(record))
  if (parsed.some((record) => record === null)) throw new AppError('导入记录格式无效', 400)

  const imported = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { gameStatsImportedAt: true },
    })
    if (!user || user.gameStatsImportedAt) return false

    for (const record of parsed) {
      if (!record) continue
      const existing = await tx.gameStat.findUnique({
        where: { userId_game_variant: { userId, game: record.game, variant: record.variant } },
      })
      const merged = mergeCounters(countersOf(existing), record.delta)
      await tx.gameStat.upsert({
        where: { userId_game_variant: { userId, game: record.game, variant: record.variant } },
        create: upsertPayload(userId, record.game, record.variant, merged),
        update: merged,
      })
    }
    await tx.user.update({
      where: { id: userId },
      data: { gameStatsImportedAt: new Date() },
    })
    return true
  })

  return { imported, stats: await listStats(userId) }
}

/** 联机结算写入；失败只告警，绝不向游戏 finish 流程抛错 */
export async function recordOnlineMatchResult(payload: GameEndResult): Promise<void> {
  if (!isGameKey(payload.game) || !isKnownVariant(payload.game, 'online')) return
  try {
    const pointsConfig = await getPointsConfig()
    await prisma.$transaction(async (tx) => {
      for (const result of payload.results) {
        const delta: Parameters<typeof mergeCounters>[1] = { games: 1 }
        if (result.outcome === 'win') delta.wins = 1
        else if (result.outcome === 'loss') delta.losses = 1
        else delta.draws = 1

        if (payload.game === 'doudizhu') {
          if (result.scoreDelta !== undefined) delta.scoreTotal = result.scoreDelta
        } else if (
          payload.game === '2048' ||
          payload.game === 'snake' ||
          payload.game === 'jump' ||
          payload.game === 'parkour'
        ) {
          if (result.score !== undefined) {
            delta.scoreTotal = result.score
            delta.bestScore = result.score
          }
          if (payload.game === 'parkour') {
            if (result.distanceM !== undefined) delta.bestDistance = result.distanceM
            if (result.coins !== undefined) delta.bestCoins = result.coins
            if (result.maxCombo !== undefined) delta.bestCombo = result.maxCombo
          }
        }

        const existing = await tx.gameStat.findUnique({
          where: { userId_game_variant: { userId: result.userId, game: payload.game, variant: 'online' } },
        })
        const merged = mergeCounters(countersOf(existing), delta)
        await tx.gameStat.upsert({
          where: { userId_game_variant: { userId: result.userId, game: payload.game, variant: 'online' } },
          create: upsertPayload(result.userId, payload.game, 'online', merged),
          update: merged,
        })

        await awardGamePointsTx(
          tx,
          result.userId,
          payload.game as GameKey,
          { outcome: result.outcome, score: result.score },
          { config: pointsConfig },
        )
      }
    })
  } catch (err) {
    console.warn('[gameStats] 联机战绩写入失败：', err instanceof Error ? err.message : err)
  }
}

type LeaderboardRow = StatRow & {
  user: {
    username: string
    equippedTitle: { id: number; type: string; name: string; payload: string | null; rarity: string } | null
    equippedLeaderTitle: { id: number; game: string; userId: number; effect?: string } | null
  }
}

function metricValue(row: StatRow, metric: LeaderboardMetric): number {
  switch (metric.metric) {
    case 'bestTimeMs': return row.bestTimeMs ?? 0
    case 'bestDistance': return row.bestDistance
    case 'scoreTotal': return row.scoreTotal
    case 'wins': return row.wins
    case 'bestScore':
    default: return row.bestScore
  }
}

function secondaryOf(row: StatRow) {
  return {
    games: row.games,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    scoreTotal: row.scoreTotal,
    bestScore: row.bestScore,
    bestTimeMs: row.bestTimeMs,
    bestDistance: row.bestDistance,
  }
}

function entryOf(row: LeaderboardRow, metric: LeaderboardMetric, rank: number, meId: number) {
  return {
    rank,
    userId: row.userId,
    username: row.user.username,
    value: metricValue(row, metric),
    secondary: secondaryOf(row),
    title: effectiveTitleDto({ id: row.userId, equippedTitle: row.user.equippedTitle, equippedLeaderTitle: row.user.equippedLeaderTitle }),
    isMe: row.userId === meId,
  }
}

export async function getLeaderboard(params: {
  userId: number
  game: string
  variant: string
  limit: number
  page: number
}) {
  const metric = getLeaderboardMetric(params.game, params.variant)
  if (!metric) throw new AppError('无效的排行榜参数', 400)

  const base = leaderboardWhere(metric) as Prisma.GameStatWhereInput
  const orderBy: Prisma.GameStatOrderByWithRelationInput[] = [
    { [metric.metric]: metric.order },
    { updatedAt: 'asc' },
  ]
  const skip = (params.page - 1) * params.limit

  const [total, rows, meRow] = await Promise.all([
    prisma.gameStat.count({ where: base }),
    prisma.gameStat.findMany({
      where: base,
      include: {
        user: {
          select: {
            username: true,
            equippedTitle: { select: { id: true, type: true, name: true, payload: true, rarity: true } },
            equippedLeaderTitle: { select: { id: true, game: true, userId: true, effect: true } },
          },
        },
      },
      orderBy,
      skip,
      take: params.limit,
    }),
    prisma.gameStat.findUnique({
      where: {
        userId_game_variant: {
          userId: params.userId,
          game: params.game,
          variant: params.variant,
        },
      },
      include: {
        user: {
          select: {
            username: true,
            equippedTitle: { select: { id: true, type: true, name: true, payload: true, rarity: true } },
            equippedLeaderTitle: { select: { id: true, game: true, userId: true, effect: true } },
          },
        },
      },
    }),
  ])

  const rankOf = async (row: StatRow) => {
    const value = metricValue(row, metric)
    const better: Prisma.GameStatWhereInput = {
      ...base,
      [metric.metric]: metric.order === 'desc' ? { gt: value } : { lt: value },
    }
    const betterCount = await prisma.gameStat.count({ where: better })
    return betterCount + 1
  }

  const entries = await Promise.all(
    rows.map(async (row) => entryOf(row, metric, await rankOf(row), params.userId)),
  )

  let me = null
  if (meRow && meRow.games > 0) {
    const qualifies = !metric.positiveOnly
      || (metric.metric === 'bestTimeMs' && meRow.bestTimeMs !== null)
      || (metric.metric === 'wins' && meRow.wins > 0)
      || (metric.metric === 'bestDistance' && meRow.bestDistance > 0)
      || (metric.metric === 'bestScore' && meRow.bestScore > 0)
    if (qualifies && (metric.metric !== 'bestTimeMs' || meRow.bestTimeMs !== null)) {
      me = entryOf(meRow, metric, await rankOf(meRow), params.userId)
    }
  }

  // 只有单机代表变体的榜一携带传说称号（扫雷取「困难」档）
  const soloVariant = SOLO_LEADER_VARIANTS[params.game as GameKey]
  const titleRow = soloVariant === params.variant
    ? await prisma.gameLeaderTitle.findUnique({ where: { game: params.game } })
    : null
  const attachTitle = <T extends { userId: number }>(entry: T) => ({
    ...entry,
    leaderTitle: titleRow && entry.userId === titleRow.userId ? leaderTitleDto(titleRow) : null,
  })

  return {
    entries: entries.map(attachTitle),
    me: me ? attachTitle(me) : null,
    total,
    game: params.game,
    variant: params.variant,
    metric: metric.metric,
    label: metric.label,
    unit: metric.unit,
  }
}
