import prisma from '../lib/prisma.js'
import type { Prisma, PointsShopItem } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import {
  DEFAULT_POINTS_CONFIG,
  applyDailyCap,
  applyDailyLossCap,
  checkinReward,
  computeGamePoints,
  getTodayDateKey,
  getTodayDayStart,
  getYesterdayDateKey,
  normalizePointsConfig,
  parseShopPayload,
  sanitizeAvatarFrame,
  sanitizeTitleColor,
  sanitizeTitleIcon,
  type AvatarFrameStyle,
  type CheckinRule,
  type PointsConfigDto,
} from '../lib/pointsRules.js'
import type { GameKey } from '../lib/gameStatsRules.js'
import { leaderTitleDto, type LeaderTitleDto } from '../lib/gameLeaderTitles.js'

type Db = Prisma.TransactionClient

export interface PointsMutation {
  /** 实际变动（扣分最多扣到 0） */
  delta: number
  /** 变动后余额 */
  balance: number
}

export interface UserTitleDto {
  id: number
  name: string
  color: string
  icon: string
}

/** 头像框（只在 LineWeb 站内展示，不同步 neko） */
export interface UserAvatarFrameDto {
  id: number
  name: string
  frame: AvatarFrameStyle
  color: string
}

export interface CheckinStatusDto {
  /** 今天是否已签到 */
  checkedInToday: boolean
  /** 当前连签天数（今日未签时为截至昨日仍有效的连签） */
  streak: number
  /** 今日签到获得的积分（未签为 0） */
  todayPoints: number
  /** 今天签到（或明天签到）能拿多少 */
  nextPoints: number
}

export interface CheckinResultDto extends CheckinStatusDto {
  /** 本次实际到账积分 */
  awarded: number
  balance: number
  note: string
}

export interface PointsProfileDto {
  /** 便于客户端判断「这个头像是不是我自己」以套用本人头像框 */
  userId: number
  balance: number
  earned: number
  rank: number
  title: UserTitleDto | null
  avatarFrame: UserAvatarFrameDto | null
  /** 已购商品 key（客户端用于解锁表情包） */
  ownedKeys: string[]
  checkin: CheckinStatusDto
  /** 当前持有的单机榜一传说称号（可能多个，随时可能因被超越而消失） */
  leaderTitles: LeaderTitleDto[]
}

const DEFAULT_SHOP_SEED_FLAG = 'points.shop.seeded'
/** 头像框是后加的默认商品，单独打标记：只补框，不复活管理员已删除的其它商品 */
const DEFAULT_FRAME_SEED_FLAG = 'points.shop.frames.seeded'

interface DefaultShopItem {
  key: string
  type: 'title' | 'emoji' | 'avatar_frame'
  name: string
  description: string
  cost: number
  rarity: 'common' | 'rare' | 'epic' | 'legendary'
  payload: Record<string, unknown>
  sortOrder: number
}

/** 默认商店目录：只在首次初始化时写入一次，之后管理员可自由增删改 */
const DEFAULT_SHOP_ITEMS: readonly DefaultShopItem[] = [
  { key: 'title_newbie', type: 'title', name: '新手上路', description: '刚在 LineWeb 落下第一锄头。', cost: 100, rarity: 'common', payload: { icon: '🐣', color: '#57606a' }, sortOrder: 10 },
  { key: 'title_farmer', type: 'title', name: '种田好手', description: '农场里的第一波收成，值得纪念。', cost: 300, rarity: 'common', payload: { icon: '🌾', color: '#1a7f37' }, sortOrder: 20 },
  { key: 'title_night_owl', type: 'title', name: '夜猫子', description: '凌晨的农场，只有你和月亮。', cost: 400, rarity: 'rare', payload: { icon: '🌙', color: '#6639ba' }, sortOrder: 30 },
  { key: 'title_gambler', type: 'title', name: '牌桌老手', description: '斗地主、UNO、骗子酒馆轮着来。', cost: 500, rarity: 'rare', payload: { icon: '🃏', color: '#8250df' }, sortOrder: 40 },
  { key: 'title_gomoku_master', type: 'title', name: '五子棋痴', description: '十五路棋盘上的执念。', cost: 500, rarity: 'rare', payload: { icon: '⚫', color: '#24292f' }, sortOrder: 50 },
  { key: 'title_thief', type: 'title', name: '偷菜大盗', description: '来无影去无踪，菜园里的传说。', cost: 800, rarity: 'epic', payload: { icon: '🥷', color: '#bc4c00' }, sortOrder: 60 },
  { key: 'title_rich', type: 'title', name: '积分富翁', description: '余额四位数，走路都带风。', cost: 1500, rarity: 'epic', payload: { icon: '💰', color: '#9a6700' }, sortOrder: 70 },
  { key: 'title_farm_tycoon', type: 'title', name: '农场大亨', description: '十八块地全部种满星之果。', cost: 2500, rarity: 'legendary', payload: { icon: '🚜', color: '#1a7f37' }, sortOrder: 80 },
  { key: 'title_legend', type: 'title', name: '全服传说', description: 'LineWeb 游戏大厅的顶点。', cost: 5000, rarity: 'legendary', payload: { icon: '👑', color: '#bf3989' }, sortOrder: 90 },
  { key: 'emoji_nailong', type: 'emoji', name: '奶龙表情包', description: '解锁聊天表情商店的「奶龙」整套表情。', cost: 400, rarity: 'rare', payload: { pack: 'nailong' }, sortOrder: 100 },
  { key: 'emoji_felyne', type: 'emoji', name: '呆猫表情包', description: '解锁聊天表情商店的「呆猫」整套表情。', cost: 400, rarity: 'rare', payload: { pack: 'felyne' }, sortOrder: 110 },
  { key: 'emoji_twemoji', type: 'emoji', name: '经典 Twemoji', description: '解锁聊天表情商店的「经典表情」整套表情。', cost: 200, rarity: 'common', payload: { pack: 'twemoji' }, sortOrder: 120 },
]

/** 头像框：LineWeb 站内展示（头像外圈），不同步到 neko */
const DEFAULT_FRAME_ITEMS: readonly DefaultShopItem[] = [
  { key: 'frame_gold', type: 'avatar_frame', name: '鎏金边框', description: '低调的金色描边，适合在排行榜里安静发光。', cost: 800, rarity: 'rare', payload: { frame: 'gold', color: '#d4a72c' }, sortOrder: 200 },
  { key: 'frame_neon', type: 'avatar_frame', name: '霓虹边框', description: '赛博感的冷色流光，跑酷与 2048 玩家的最爱。', cost: 1500, rarity: 'epic', payload: { frame: 'neon', color: '#1f6feb' }, sortOrder: 210 },
  { key: 'frame_sakura', type: 'avatar_frame', name: '樱花边框', description: '春日限定的粉樱花瓣，绕着头像缓缓飘落。', cost: 2500, rarity: 'epic', payload: { frame: 'sakura', color: '#bf3989' }, sortOrder: 220 },
  { key: 'frame_galaxy', type: 'avatar_frame', name: '星河边框', description: '旋转的星云与细碎星尘，农场大亨的专属光环。', cost: 4000, rarity: 'legendary', payload: { frame: 'galaxy', color: '#6639ba' }, sortOrder: 230 },
]

/* ============================================================
   配置
   ============================================================ */

export async function getPointsConfig(): Promise<PointsConfigDto> {
  const row = await prisma.pointsConfig.findUnique({ where: { id: 1 } })
  if (!row) return normalizePointsConfig(DEFAULT_POINTS_CONFIG)
  try {
    return normalizePointsConfig(JSON.parse(row.config))
  } catch {
    console.warn('[points] 积分配置 JSON 损坏，回退默认值')
    return normalizePointsConfig(DEFAULT_POINTS_CONFIG)
  }
}

/**
 * 深合并管理员提交的规则：只覆盖传入的字段，其余保留当前值。
 * 这样旧版前端整包提交（缺少新字段）也不会把新配置重置成默认值。
 */
function mergePointsConfig(base: PointsConfigDto, input: unknown): Record<string, unknown> {
  const patch = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const patchGames = patch.games && typeof patch.games === 'object'
    ? patch.games as Record<string, unknown>
    : {}
  const games: Record<string, unknown> = { ...base.games }
  for (const key of Object.keys(games)) {
    const row = patchGames[key]
    if (row && typeof row === 'object') {
      games[key] = { ...(games[key] as Record<string, unknown>), ...(row as Record<string, unknown>) }
    }
  }
  const take = (key: keyof PointsConfigDto) => (
    patch[key] && typeof patch[key] === 'object'
      ? { ...(base[key] as Record<string, unknown>), ...(patch[key] as Record<string, unknown>) }
      : base[key]
  )
  return {
    games,
    farm: take('farm'),
    checkin: take('checkin'),
    leaderTitle: take('leaderTitle'),
  }
}

export async function savePointsConfig(input: unknown, adminId: number): Promise<PointsConfigDto> {
  const current = await getPointsConfig()
  const config = normalizePointsConfig(mergePointsConfig(current, input))
  await prisma.pointsConfig.upsert({
    where: { id: 1 },
    create: { id: 1, config: JSON.stringify(config), updatedBy: adminId },
    update: { config: JSON.stringify(config), updatedBy: adminId },
  })
  return config
}

/* ============================================================
   商店目录
   ============================================================ */

async function ensureDefaultShop(): Promise<void> {
  await seedShopItems(DEFAULT_SHOP_SEED_FLAG, DEFAULT_SHOP_ITEMS)
  await seedShopItems(DEFAULT_FRAME_SEED_FLAG, DEFAULT_FRAME_ITEMS)
}

/** 幂等播种：同一批商品只补一次，已存在（或被管理员删掉）的 key 不受影响 */
async function seedShopItems(flag: string, items: readonly DefaultShopItem[]): Promise<void> {
  const seeded = await prisma.siteSetting.findUnique({ where: { key: flag } })
  if (seeded) return
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      await tx.pointsShopItem.upsert({
        where: { key: item.key },
        create: {
          key: item.key,
          type: item.type,
          name: item.name,
          description: item.description,
          cost: item.cost,
          rarity: item.rarity,
          payload: JSON.stringify(item.payload),
          sortOrder: item.sortOrder,
        },
        update: {},
      })
    }
    await tx.siteSetting.upsert({
      where: { key: flag },
      create: { key: flag, value: '1' },
      update: { value: '1' },
    })
  })
}

export function toUserTitleDto(item: { id: number; type: string; name: string; payload: string | null } | null): UserTitleDto | null {
  if (!item || item.type !== 'title') return null
  const payload = parseShopPayload(item.payload)
  return {
    id: item.id,
    name: item.name,
    color: sanitizeTitleColor(payload.color),
    icon: sanitizeTitleIcon(payload.icon),
  }
}

/** 商品的 payload.frame 必须命中白名单，否则当作「不是头像框」 */
export function toUserAvatarFrameDto(
  item: { id: number; type: string; name: string; payload: string | null } | null,
): UserAvatarFrameDto | null {
  if (!item || item.type !== 'avatar_frame') return null
  const payload = parseShopPayload(item.payload)
  const frame = sanitizeAvatarFrame(payload.frame)
  if (!frame) return null
  return {
    id: item.id,
    name: item.name,
    frame,
    color: sanitizeTitleColor(payload.color, '#57606a'),
  }
}

/**
 * 批量取「LineWeb 用户 id → 已佩戴称号」。
 *
 * 聊天等出口场景只关心少量用户，按 id 精确查询避免扫全表；
 * 没有佩戴称号的用户不会出现在 Map 里（调用方按 null 处理）。
 */
export async function getTitleMapForLineWebIds(
  ids: readonly number[],
): Promise<Map<number, UserTitleDto>> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))]
  if (unique.length === 0) return new Map()
  const rows = await prisma.user.findMany({
    where: { id: { in: unique }, equippedTitleId: { not: null } },
    select: {
      id: true,
      equippedTitle: { select: { id: true, type: true, name: true, payload: true } },
    },
  })
  const map = new Map<number, UserTitleDto>()
  for (const row of rows) {
    const title = toUserTitleDto(row.equippedTitle)
    if (title) map.set(row.id, title)
  }
  return map
}

function itemDto(
  item: PointsShopItem,
  ownedIds: Set<number>,
  equipped: { titleId: number | null; frameId: number | null },
) {
  return {
    id: item.id,
    key: item.key,
    type: item.type,
    name: item.name,
    description: item.description,
    cost: item.cost,
    rarity: item.rarity,
    payload: parseShopPayload(item.payload),
    isActive: item.isActive,
    sortOrder: item.sortOrder,
    owned: ownedIds.has(item.id),
    equipped:
      (item.type === 'title' && equipped.titleId === item.id)
      || (item.type === 'avatar_frame' && equipped.frameId === item.id),
  }
}

export async function listShop(userId: number) {
  await ensureDefaultShop()
  const [items, owned, user] = await Promise.all([
    prisma.pointsShopItem.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    }),
    prisma.userPointsItem.findMany({ where: { userId }, select: { itemId: true } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { points: true, pointsEarned: true, equippedTitleId: true, equippedAvatarFrameId: true },
    }),
  ])
  const ownedIds = new Set(owned.map((row) => row.itemId))
  const equipped = {
    titleId: user?.equippedTitleId ?? null,
    frameId: user?.equippedAvatarFrameId ?? null,
  }
  return {
    balance: user?.points ?? 0,
    earned: user?.pointsEarned ?? 0,
    equippedTitleId: equipped.titleId,
    equippedAvatarFrameId: equipped.frameId,
    items: items.map((item) => itemDto(item, ownedIds, equipped)),
  }
}

/* ============================================================
   每日签到
   ============================================================ */

/**
 * 计算签到状态（纯查询，不写库）。
 *
 * 连签口径：昨日有记录时，今日签到后的天数是「昨日连签 + 1」；
 * 今日未签且昨日也断签时，本次签到从 1 重新开始。
 */
function buildCheckinStatus(
  rule: CheckinRule,
  todayRow: { streak: number; points: number } | null,
  yesterdayRow: { streak: number } | null,
): CheckinStatusDto {
  if (todayRow) {
    return {
      checkedInToday: true,
      streak: todayRow.streak,
      todayPoints: todayRow.points,
      nextPoints: checkinReward(todayRow.streak + 1, rule),
    }
  }
  const streak = yesterdayRow?.streak ?? 0
  return {
    checkedInToday: false,
    streak,
    todayPoints: 0,
    nextPoints: checkinReward(streak + 1, rule),
  }
}

async function getCheckinStatus(
  userId: number,
  config?: PointsConfigDto,
  now: number = Date.now(),
): Promise<CheckinStatusDto> {
  const rule = (config ?? await getPointsConfig()).checkin
  const rows = await prisma.dailyCheckin.findMany({
    where: { userId, dateKey: { in: [getTodayDateKey(now), getYesterdayDateKey(now)] } },
    select: { dateKey: true, streak: true, points: true },
  })
  const today = getTodayDateKey(now)
  const yesterday = getYesterdayDateKey(now)
  return buildCheckinStatus(
    rule,
    rows.find((row) => row.dateKey === today) ?? null,
    rows.find((row) => row.dateKey === yesterday) ?? null,
  )
}

/** 每日签到：连签天数决定奖励，重复签到 409 */
export async function checkin(userId: number, now: number = Date.now()): Promise<CheckinResultDto> {
  const config = await getPointsConfig()
  const rule = config.checkin
  const today = getTodayDateKey(now)
  const yesterday = getYesterdayDateKey(now)

  return prisma.$transaction(async (tx) => {
    const prev = await tx.dailyCheckin.findFirst({
      where: { userId, dateKey: yesterday },
      select: { streak: true },
    })
    const streak = (prev?.streak ?? 0) + 1
    const amount = checkinReward(streak, rule)
    const note = `连续签到 ${streak} 天`
    try {
      await tx.dailyCheckin.create({ data: { userId, dateKey: today, streak, points: amount } })
    } catch (error) {
      // 唯一键兜底：并发 / 重复提交时只允许一条当日记录
      if ((error as { code?: string }).code === 'P2002') {
        throw new AppError('今天已经签到过了', 409, 'CHECKIN_DONE')
      }
      throw error
    }
    const result = await awardPointsTx(tx, userId, { amount, reason: 'checkin', note })
    return {
      checkedInToday: true,
      streak,
      todayPoints: amount,
      nextPoints: checkinReward(streak + 1, rule),
      awarded: result.delta,
      balance: result.balance,
      note,
    }
  })
}

/* ============================================================
   余额 / 流水 / 排行榜
   ============================================================ */

export async function getPointsProfile(userId: number): Promise<PointsProfileDto> {
  const [user, owned, checkinStatus, leaderRows] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { points: true, pointsEarned: true, equippedTitle: true, equippedAvatarFrame: true },
    }),
    prisma.userPointsItem.findMany({
      where: { userId },
      select: { item: { select: { key: true } } },
    }),
    getCheckinStatus(userId),
    prisma.gameLeaderTitle.findMany({
      where: { userId },
      orderBy: { game: 'asc' },
      select: { id: true, game: true, awardedAt: true },
    }),
  ])
  if (!user) throw new AppError('用户不存在', 404)
  const rank = await prisma.user.count({
    where: { points: { gt: user.points } },
  }) + 1
  return {
    userId,
    balance: user.points,
    earned: user.pointsEarned,
    rank,
    title: toUserTitleDto(user.equippedTitle),
    avatarFrame: toUserAvatarFrameDto(user.equippedAvatarFrame),
    ownedKeys: owned.map((row) => row.item.key),
    checkin: checkinStatus,
    leaderTitles: leaderRows.map(leaderTitleDto),
  }
}

export async function listPointsLedger(userId: number, limit: number, page: number) {
  const take = Math.min(50, Math.max(1, limit))
  const skip = (Math.max(1, page) - 1) * take
  const [total, rows] = await Promise.all([
    prisma.pointsLedger.count({ where: { userId } }),
    prisma.pointsLedger.findMany({
      where: { userId },
      orderBy: { id: 'desc' },
      skip,
      take,
    }),
  ])
  return { entries: rows, total, page: Math.max(1, page), limit: take }
}

export async function getPointsLeaderboard(params: {
  userId: number
  metric: 'balance' | 'earned'
  limit: number
  page: number
}) {
  const metric = params.metric === 'earned' ? 'pointsEarned' : 'points'
  const take = Math.min(50, Math.max(1, params.limit))
  const skip = (Math.max(1, params.page) - 1) * take
  const base: Prisma.UserWhereInput = { status: 'active', [metric]: { gt: 0 } }
  const orderBy: Prisma.UserOrderByWithRelationInput[] = [
    { [metric]: 'desc' },
    { points: 'desc' },
    { createdAt: 'asc' },
  ]

  const [total, rows, meRow] = await Promise.all([
    prisma.user.count({ where: base }),
    prisma.user.findMany({
      where: base,
      orderBy,
      skip,
      take,
      select: {
        id: true,
        username: true,
        points: true,
        pointsEarned: true,
        equippedTitle: true,
        equippedAvatarFrame: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: params.userId },
      select: {
        id: true,
        username: true,
        points: true,
        pointsEarned: true,
        equippedTitle: true,
        equippedAvatarFrame: true,
      },
    }),
  ])

  const entryOf = (row: NonNullable<typeof meRow>, rank: number) => ({
    rank,
    userId: row.id,
    username: row.username,
    value: metric === 'pointsEarned' ? row.pointsEarned : row.points,
    balance: row.points,
    earned: row.pointsEarned,
    title: toUserTitleDto(row.equippedTitle),
    avatarFrame: toUserAvatarFrameDto(row.equippedAvatarFrame),
    isMe: row.id === params.userId,
  })

  const valueOf = (row: { points: number; pointsEarned: number }) =>
    metric === 'pointsEarned' ? row.pointsEarned : row.points

  const entries = await Promise.all(rows.map(async (row) => {
    const better = await prisma.user.count({
      where: { status: 'active', [metric]: { gt: valueOf(row) } },
    })
    return entryOf(row, better + 1)
  }))

  let me = null
  if (meRow && valueOf(meRow) > 0) {
    const better = await prisma.user.count({
      where: { status: 'active', [metric]: { gt: valueOf(meRow) } },
    })
    me = entryOf(meRow, better + 1)
  }

  return { entries, me, total, metric: params.metric }
}

/* ============================================================
   积分变动（必须在事务内调用）
   ============================================================ */

/** 增加 / 扣除积分；扣分最多扣到 0（积分不出现负数） */
export async function awardPointsTx(
  tx: Db,
  userId: number,
  input: { amount: number; reason: string; game?: string | null; note?: string | null },
): Promise<PointsMutation> {
  const amount = Math.trunc(input.amount)
  const user = await tx.user.findUnique({ where: { id: userId }, select: { points: true } })
  if (!user) throw new AppError('用户不存在', 404)
  const delta = amount < 0 ? Math.max(amount, -user.points) : amount
  if (delta === 0) return { delta: 0, balance: user.points }

  const updated = await tx.user.update({
    where: { id: userId },
    data: {
      points: { increment: delta },
      ...(delta > 0 ? { pointsEarned: { increment: delta } } : {}),
    },
    select: { points: true },
  })
  await tx.pointsLedger.create({
    data: {
      userId,
      amount: delta,
      balance: updated.points,
      reason: input.reason,
      game: input.game ?? null,
      note: input.note ?? null,
    },
  })
  return { delta, balance: updated.points }
}

/** 消费积分：余额不足直接 400（条件更新避免并发超扣） */
export async function spendPointsTx(
  tx: Db,
  userId: number,
  amount: number,
  input: { reason: string; note?: string | null; game?: string | null },
): Promise<PointsMutation> {
  const cost = Math.max(0, Math.trunc(amount))
  if (cost === 0) {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { points: true } })
    return { delta: 0, balance: user?.points ?? 0 }
  }
  const result = await tx.user.updateMany({
    where: { id: userId, points: { gte: cost } },
    data: { points: { decrement: cost } },
  })
  if (result.count === 0) throw new AppError('积分不足', 400)
  const user = await tx.user.findUnique({ where: { id: userId }, select: { points: true } })
  const balance = user?.points ?? 0
  await tx.pointsLedger.create({
    data: {
      userId,
      amount: -cost,
      balance,
      reason: input.reason,
      game: input.game ?? null,
      note: input.note ?? null,
    },
  })
  return { delta: -cost, balance }
}

/* ============================================================
   游戏积分
   ============================================================ */

export interface GamePointsResult {
  delta: number
  balance: number
  /** 理论积分（未套上限） */
  gross: number
  /** 是否命中每日上限 */
  capped: boolean
}

/**
 * 单机 / 联机统一发放入口。
 * 必须传入事务客户端；配置可在外部读取一次后通过 config 传入，避免每局重复查库。
 */
export async function awardGamePointsTx(
  tx: Db,
  userId: number,
  game: GameKey,
  input: { outcome?: 'win' | 'loss' | 'draw'; score?: number },
  options?: { config?: PointsConfigDto; now?: number },
): Promise<GamePointsResult> {
  const config = options?.config ?? await getPointsConfig()
  const rule = config.games[game]
  if (!rule) return { delta: 0, balance: 0, gross: 0, capped: false }

  const gross = computeGamePoints(game, rule, input)
  const dayStart = getTodayDayStart(options?.now)
  let amount = gross
  if (gross > 0) {
    const agg = await tx.pointsLedger.aggregate({
      where: { userId, game, amount: { gt: 0 }, createdAt: { gte: dayStart } },
      _sum: { amount: true },
    })
    amount = applyDailyCap(gross, agg._sum.amount ?? 0, rule.dailyCap)
  } else if (gross < 0) {
    // 输分上限按「今日该游戏已扣的绝对值」截断；达到上限后不再扣分，但仍可继续游戏
    const agg = await tx.pointsLedger.aggregate({
      where: { userId, game, amount: { lt: 0 }, createdAt: { gte: dayStart } },
      _sum: { amount: true },
    })
    amount = applyDailyLossCap(gross, Math.abs(agg._sum.amount ?? 0), rule.dailyLossCap)
  }
  const capped = amount !== gross

  if (amount === 0) {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { points: true } })
    return { delta: 0, balance: user?.points ?? 0, gross, capped }
  }
  const result = await awardPointsTx(tx, userId, { amount, reason: 'game_result', game })
  return { ...result, gross, capped }
}

/* ============================================================
   商店购买 / 称号佩戴
   ============================================================ */

export async function buyShopItem(userId: number, itemId: number) {
  await ensureDefaultShop()
  return prisma.$transaction(async (tx) => {
    const item = await tx.pointsShopItem.findUnique({ where: { id: itemId } })
    if (!item) throw new AppError('商品不存在', 404)
    if (!item.isActive) throw new AppError('该商品已下架', 400)

    const owned = await tx.userPointsItem.findUnique({
      where: { userId_itemId: { userId, itemId } },
    })
    if (owned) throw new AppError('你已经拥有这件商品', 409)

    const spend = await spendPointsTx(tx, userId, item.cost, {
      reason: 'shop_purchase',
      note: item.name,
    })
    await tx.userPointsItem.create({ data: { userId, itemId } })

    let equippedTitleId: number | null = null
    let avatarFrame: UserAvatarFrameDto | null = null
    if (item.type === 'title') {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { equippedTitleId: true } })
      equippedTitleId = user?.equippedTitleId ?? null
      // 还没有称号时自动佩戴第一个，避免买完看不到效果
      if (!equippedTitleId) {
        await tx.user.update({ where: { id: userId }, data: { equippedTitleId: item.id } })
        equippedTitleId = item.id
      }
    } else if (item.type === 'avatar_frame') {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { equippedAvatarFrameId: true } })
      // 头一个头像框同样自动佩戴
      if (!user?.equippedAvatarFrameId) {
        await tx.user.update({ where: { id: userId }, data: { equippedAvatarFrameId: item.id } })
        avatarFrame = toUserAvatarFrameDto(item)
      }
    }

    return {
      balance: spend.balance,
      item: { id: item.id, key: item.key, type: item.type, name: item.name },
      equippedTitleId,
      title: item.type === 'title' && equippedTitleId === item.id ? toUserTitleDto(item) : null,
      avatarFrame,
    }
  })
}

export async function setEquippedTitle(userId: number, itemId: number | null) {
  return prisma.$transaction(async (tx) => {
    if (itemId === null) {
      await tx.user.update({ where: { id: userId }, data: { equippedTitleId: null } })
      return { title: null }
    }
    const owned = await tx.userPointsItem.findUnique({
      where: { userId_itemId: { userId, itemId } },
      include: { item: true },
    })
    if (!owned) throw new AppError('尚未拥有该称号', 400)
    if (owned.item.type !== 'title') throw new AppError('该商品不是称号', 400)
    await tx.user.update({ where: { id: userId }, data: { equippedTitleId: itemId } })
    return { title: toUserTitleDto(owned.item) }
  })
}

/** 佩戴 / 卸下头像框（只影响 LineWeb 站内展示） */
export async function setEquippedAvatarFrame(userId: number, itemId: number | null) {
  return prisma.$transaction(async (tx) => {
    if (itemId === null) {
      await tx.user.update({ where: { id: userId }, data: { equippedAvatarFrameId: null } })
      return { avatarFrame: null }
    }
    const owned = await tx.userPointsItem.findUnique({
      where: { userId_itemId: { userId, itemId } },
      include: { item: true },
    })
    if (!owned) throw new AppError('尚未拥有该头像框', 400)
    const frame = toUserAvatarFrameDto(owned.item)
    if (!frame) throw new AppError('该商品不是头像框', 400)
    await tx.user.update({ where: { id: userId }, data: { equippedAvatarFrameId: itemId } })
    return { avatarFrame: frame }
  })
}
