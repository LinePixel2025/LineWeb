import prisma from '../lib/prisma.js'
import type { Prisma, PointsShopItem } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import {
  DEFAULT_POINTS_CONFIG,
  applyDailyCap,
  computeGamePoints,
  getTodayDayStart,
  normalizePointsConfig,
  parseShopPayload,
  sanitizeTitleColor,
  sanitizeTitleIcon,
  type PointsConfigDto,
} from '../lib/pointsRules.js'
import type { GameKey } from '../lib/gameStatsRules.js'

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

export interface PointsProfileDto {
  balance: number
  earned: number
  rank: number
  title: UserTitleDto | null
  /** 已购商品 key（客户端用于解锁表情包） */
  ownedKeys: string[]
}

const DEFAULT_SHOP_SEED_FLAG = 'points.shop.seeded'

interface DefaultShopItem {
  key: string
  type: 'title' | 'emoji'
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

export async function savePointsConfig(input: unknown, adminId: number): Promise<PointsConfigDto> {
  const config = normalizePointsConfig(input)
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
  const seeded = await prisma.siteSetting.findUnique({ where: { key: DEFAULT_SHOP_SEED_FLAG } })
  if (seeded) return
  await prisma.$transaction(async (tx) => {
    for (const item of DEFAULT_SHOP_ITEMS) {
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
      where: { key: DEFAULT_SHOP_SEED_FLAG },
      create: { key: DEFAULT_SHOP_SEED_FLAG, value: '1' },
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

function itemDto(item: PointsShopItem, ownedIds: Set<number>, equippedTitleId: number | null) {
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
    equipped: item.type === 'title' && equippedTitleId === item.id,
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
      select: { points: true, pointsEarned: true, equippedTitleId: true },
    }),
  ])
  const ownedIds = new Set(owned.map((row) => row.itemId))
  return {
    balance: user?.points ?? 0,
    earned: user?.pointsEarned ?? 0,
    equippedTitleId: user?.equippedTitleId ?? null,
    items: items.map((item) => itemDto(item, ownedIds, user?.equippedTitleId ?? null)),
  }
}

/* ============================================================
   余额 / 流水 / 排行榜
   ============================================================ */

export async function getPointsProfile(userId: number): Promise<PointsProfileDto> {
  const [user, owned] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { points: true, pointsEarned: true, equippedTitle: true },
    }),
    prisma.userPointsItem.findMany({
      where: { userId },
      select: { item: { select: { key: true } } },
    }),
  ])
  if (!user) throw new AppError('用户不存在', 404)
  const rank = await prisma.user.count({
    where: { points: { gt: user.points } },
  }) + 1
  return {
    balance: user.points,
    earned: user.pointsEarned,
    rank,
    title: toUserTitleDto(user.equippedTitle),
    ownedKeys: owned.map((row) => row.item.key),
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
  const agg = await tx.pointsLedger.aggregate({
    where: { userId, game, amount: { gt: 0 }, createdAt: { gte: dayStart } },
    _sum: { amount: true },
  })
  const amount = applyDailyCap(gross, agg._sum.amount ?? 0, rule.dailyCap)
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
    if (item.type === 'title') {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { equippedTitleId: true } })
      equippedTitleId = user?.equippedTitleId ?? null
      // 还没有称号时自动佩戴第一个，避免买完看不到效果
      if (!equippedTitleId) {
        await tx.user.update({ where: { id: userId }, data: { equippedTitleId: item.id } })
        equippedTitleId = item.id
      }
    }

    return {
      balance: spend.balance,
      item: { id: item.id, key: item.key, type: item.type, name: item.name },
      equippedTitleId,
      title: item.type === 'title' && equippedTitleId === item.id ? toUserTitleDto(item) : null,
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
