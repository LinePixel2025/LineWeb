/**
 * LineWeb 主题服务：目录视图、积分购买、佩戴与卸下。
 *
 * 事务边界：
 * - 购买的「查重 → 扣积分 → 写解锁记录 → 自动佩戴」必须在同一个事务里完成，
 *   否则并发请求可能重复扣分；唯一约束 `(userId, themeKey)` 是最后一道兜底。
 * - 事务回滚时 spendPointsTx 写入的 PointsLedger 与 User.points 一起回滚，不会出现「扣了分没主题」。
 */

import prisma from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import {
  DEFAULT_THEME_KEY,
  THEMES,
  THEME_KEYS,
  getTheme,
  isThemeKey,
  resolveEquippedTheme,
  themeRarityLabel,
  type ThemeDef,
  type ThemeMode,
  type ThemeRarity,
} from '../lib/themes.js'
import { spendPointsTx } from './pointsService.js'

export interface ThemeCatalogItemDto {
  key: string
  name: string
  tagline: string
  description: string
  price: number
  rarity: ThemeRarity
  rarityLabel: string
  swatches: [string, string, string, string]
  previewGradient: string
  defaultMode: ThemeMode
  /** 默认主题（免费、不可购买、永远已拥有） */
  isDefault: boolean
  owned: boolean
  equipped: boolean
  /** 余额是否够买（已拥有时同样为 false，前端据此禁用「购买」按钮） */
  affordable: boolean
}

export interface ThemesViewDto {
  catalog: ThemeCatalogItemDto[]
  /** 已拥有主题 key（含 default，不含目录里已下架的旧 key） */
  owned: string[]
  /** 当前佩戴的主题 key（未知 / 未解锁的库值已回退为 default） */
  equipped: string
  /** 积分余额 */
  balance: number
  /** balance 的别名（早期客户端按 points 命名，保留避免破坏） */
  points: number
  defaultTheme: string
}

export interface BuyThemeResultDto {
  balance: number
  owned: string[]
  equipped: string
  theme: ThemeCatalogItemDto
}

/** Prisma 唯一约束冲突（P2002）：并发购买时由数据库兜底 */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const code = (err as { code?: unknown }).code
  return code === 'P2002'
}

/** 读取用户余额与佩戴 key；用户不存在直接 404 */
async function loadThemeUser(userId: number): Promise<{ points: number; equippedThemeKey: string | null }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { points: true, equippedThemeKey: true },
  })
  if (!user) throw new AppError('用户不存在', 404)
  return user
}

/**
 * 已解锁的 key 集合（只保留目录里仍然存在的 key）。
 * 管理员将来若把某个主题从目录移除，旧解锁记录仍留在库里但不再出现在 owned 中，
 * 这样客户端不会拿到一个没有 CSS 定义的 key。
 */
async function loadOwnedKeys(userId: number): Promise<Set<string>> {
  const rows = await prisma.themeUnlock.findMany({
    where: { userId },
    select: { themeKey: true },
  })
  const owned = new Set<string>([DEFAULT_THEME_KEY])
  for (const row of rows) {
    if (isThemeKey(row.themeKey)) owned.add(row.themeKey)
  }
  return owned
}

/**
 * 实际生效的佩戴 key：
 * 库里可能存着未知 key，或者拥有记录被清理（例如管理员手工删表），两种都回退默认主题，
 * 避免前端按「已佩戴一个不存在的主题」渲染。
 */
function resolveViewEquipped(equippedThemeKey: string | null, owned: Set<string>): string {
  const key = resolveEquippedTheme(equippedThemeKey)
  if (key === DEFAULT_THEME_KEY) return DEFAULT_THEME_KEY
  return owned.has(key) ? key : DEFAULT_THEME_KEY
}

function toCatalogItem(theme: ThemeDef, owned: Set<string>, equipped: string, balance: number): ThemeCatalogItemDto {
  const isDefault = theme.key === DEFAULT_THEME_KEY
  const isOwned = isDefault || owned.has(theme.key)
  return {
    key: theme.key,
    name: theme.name,
    tagline: theme.tagline,
    description: theme.description,
    price: theme.price,
    rarity: theme.rarity,
    rarityLabel: themeRarityLabel(theme.rarity),
    swatches: [...theme.swatches],
    previewGradient: theme.previewGradient,
    defaultMode: theme.defaultMode,
    isDefault,
    owned: isOwned,
    equipped: theme.key === equipped,
    affordable: !isOwned && !isDefault && balance >= theme.price,
  }
}

/** 组装商店视图（目录全量下发，前端负责筛选与排序） */
export async function getThemesView(userId: number): Promise<ThemesViewDto> {
  const [user, owned] = await Promise.all([loadThemeUser(userId), loadOwnedKeys(userId)])
  const equipped = resolveViewEquipped(user.equippedThemeKey, owned)
  const catalog = THEMES.map((theme) => toCatalogItem(theme, owned, equipped, user.points))
  return {
    catalog,
    owned: THEME_KEYS.filter((key) => owned.has(key)),
    equipped,
    balance: user.points,
    points: user.points,
    defaultTheme: DEFAULT_THEME_KEY,
  }
}

/**
 * 购买主题（成功后自动佩戴）。
 * 错误口径：未知 key → 404；默认主题 → 400；已拥有 → 409；余额不足 → 400（spendPointsTx 抛出）。
 */
export async function buyTheme(userId: number, key: string): Promise<BuyThemeResultDto> {
  const theme = getTheme(key)
  if (!theme) throw new AppError('没有这个主题', 404)
  if (theme.key === DEFAULT_THEME_KEY) throw new AppError('默认主题无需购买', 400)

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.themeUnlock.findUnique({
        where: { userId_themeKey: { userId, themeKey: theme.key } },
        select: { id: true },
      })
      if (existing) throw new AppError('已经拥有这个主题', 409)

      await spendPointsTx(tx, userId, theme.price, {
        reason: 'theme_purchase',
        note: `主题·${theme.name}`,
        game: null,
      })
      // price 存快照：将来调价不影响历史流水的对账口径
      await tx.themeUnlock.create({ data: { userId, themeKey: theme.key, price: theme.price } })
      await tx.user.update({ where: { id: userId }, data: { equippedThemeKey: theme.key } })
    })
  } catch (err) {
    // 并发购买同一主题：两个请求都通过了事务内查重，后到的那个被唯一约束拦下
    if (isUniqueViolation(err)) throw new AppError('已经拥有这个主题', 409)
    throw err
  }

  const view = await getThemesView(userId)
  const item = view.catalog.find((entry) => entry.key === theme.key)
  if (!item) throw new AppError('主题已下架', 404)
  return { balance: view.balance, owned: view.owned, equipped: view.equipped, theme: item }
}

/**
 * 佩戴主题。
 * default 不需要拥有（同时清空库值）；其它主题必须已解锁，否则 403。
 */
export async function equipTheme(userId: number, key: string): Promise<ThemesViewDto> {
  const theme = getTheme(key)
  if (!theme) throw new AppError('没有这个主题', 404)

  if (theme.key === DEFAULT_THEME_KEY) {
    await prisma.user.update({ where: { id: userId }, data: { equippedThemeKey: null } })
    return getThemesView(userId)
  }

  const unlocked = await prisma.themeUnlock.findUnique({
    where: { userId_themeKey: { userId, themeKey: theme.key } },
    select: { id: true },
  })
  if (!unlocked) throw new AppError('还没有解锁这个主题', 403)

  await prisma.user.update({ where: { id: userId }, data: { equippedThemeKey: theme.key } })
  return getThemesView(userId)
}

/** 卸下主题（恢复默认） */
export async function unequipTheme(userId: number): Promise<ThemesViewDto> {
  // 先确认用户存在：update 一个不存在的 id 会抛 P2025，提示不如「用户不存在」清楚
  await loadThemeUser(userId)
  await prisma.user.update({ where: { id: userId }, data: { equippedThemeKey: null } })
  return getThemesView(userId)
}
