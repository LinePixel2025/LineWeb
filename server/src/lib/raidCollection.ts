/**
 * 藏品室纯规则（2026-11-15）。
 *
 * 与 raidRun.ts 一样不依赖 Prisma，供服务层与自检脚本共用：
 *   - 展位固定 12 个（0..11），可空；
 *   - 藏品是唯一收集品，重复获得只折算积分；
 *   - 收集进度按「已获得 / 目录总数」计算。
 */

import { RAID_ITEMS, type RaidItemDef } from './raidRun.js'

export const RAID_COLLECTION_SLOTS = 12

export interface DisplaySlotInput {
  slot: number
  itemKey: string
  note?: string
}

export interface NormalizedDisplaySlot {
  slot: number
  itemKey: string
  note: string
}

export const COLLECTIBLE_CATALOG: readonly RaidItemDef[] = RAID_ITEMS.filter(
  (item) => item.kind === 'collectible',
)

/** 第一个空展位；全满返回 null */
export function firstFreeDisplaySlot(usedSlots: readonly number[]): number | null {
  const used = new Set(usedSlots.filter((slot) => Number.isInteger(slot) && slot >= 0 && slot < RAID_COLLECTION_SLOTS))
  for (let slot = 0; slot < RAID_COLLECTION_SLOTS; slot += 1) {
    if (!used.has(slot)) return slot
  }
  return null
}

/**
 * 校验并规范化布展输入。
 * 错误以中文消息抛出，由路由层转成 400；不合法时绝不部分落库。
 */
export function normalizeDisplaySlots(
  raw: readonly DisplaySlotInput[],
  ownedKeys: ReadonlySet<string>,
): NormalizedDisplaySlot[] {
  if (raw.length > RAID_COLLECTION_SLOTS) {
    throw new Error(`最多只能展出 ${RAID_COLLECTION_SLOTS} 件藏品`)
  }
  const slots = new Set<number>()
  const keys = new Set<string>()
  const result: NormalizedDisplaySlot[] = []
  for (const entry of raw) {
    const slot = Number(entry.slot)
    if (!Number.isInteger(slot) || slot < 0 || slot >= RAID_COLLECTION_SLOTS) {
      throw new Error(`展位必须是 0–${RAID_COLLECTION_SLOTS - 1} 的整数`)
    }
    if (slots.has(slot)) throw new Error(`展位 ${slot} 重复`)
    if (!ownedKeys.has(entry.itemKey)) throw new Error('只能展出自己已收藏的藏品')
    if (keys.has(entry.itemKey)) throw new Error('同一件藏品不能占用两个展位')
    const note = typeof entry.note === 'string' ? entry.note.trim().slice(0, 40) : ''
    slots.add(slot)
    keys.add(entry.itemKey)
    result.push({ slot, itemKey: entry.itemKey, note })
  }
  return result.sort((a, b) => a.slot - b.slot)
}

/** 收集进度（0–100，保留整数） */
export function collectionCompletionPct(owned: number, total: number = COLLECTIBLE_CATALOG.length): number {
  if (!Number.isFinite(total) || total <= 0) return 0
  const safeOwned = Math.max(0, Math.min(total, Math.trunc(owned) || 0))
  return Math.round((safeOwned / total) * 100)
}

/** 重复藏品的折算积分：优先用目录里的 duplicatePoints，缺省按稀有度兜底 */
export function collectibleDuplicatePoints(def: RaidItemDef | null | undefined): number {
  if (!def) return 0
  const configured = Number(def.duplicatePoints)
  if (Number.isInteger(configured) && configured > 0) return configured
  switch (def.rarity) {
    case 'mythic': return 800
    case 'legendary': return 400
    case 'epic': return 200
    case 'rare': return 100
    default: return 50
  }
}

/** 目录中是否存在某个藏品 key */
export function isCollectibleKey(itemKey: string): boolean {
  return COLLECTIBLE_CATALOG.some((item) => item.key === itemKey)
}