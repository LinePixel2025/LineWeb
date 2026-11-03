/**
 * 搜打撤官方商店（替代原玩家交易行）。
 *
 * 口径：
 *   - 只卖 1–3 级装备（4–6 级只能靠搜打撤掉落 / 开箱），消耗品按目录价值 140% 出售；
 *   - 买装备直接生成一件满耐久的新装备（同一 key 只能持有一件，重复购买报错）；
 *   - 买消耗品进入仓库，可再取到背包 / 胸挂 / 安全箱带进对局；
 *   - 玩家出售物品走仓库页的「回收」，按 raidSellPrice 结算（材料 100% / 消耗品 60% / 箱子 70%）。
 */

import prisma from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import {
  RAID_GEARS,
  RAID_GEAR_MAP,
  RAID_ITEMS,
  RAID_RARITY_LABELS,
  getRaidGear,
  getRaidItem,
  raidShopGearPrice,
  raidShopItemPrice,
  type RaidGearDef,
  type RaidItemDef,
} from '../lib/raidRun.js'
import { spendPointsTx } from './pointsService.js'

export interface RaidShopGearDto {
  key: string
  name: string
  emoji: string
  slot: string
  tier: number
  rarity: string
  price: number
  description: string
  defense: number
  maxDurability: number
  speedBonus: number
  slots: number
  owned: boolean
}

export interface RaidShopItemDto {
  key: string
  name: string
  emoji: string
  rarity: string
  kind: string
  price: number
  stackMax: number
  description: string
}

export interface RaidShopViewDto {
  points: number
  gear: RaidShopGearDto[]
  items: RaidShopItemDto[]
}

/** 商店售价：装备用目录价；消耗品按目录价值 140% 向上取整（纯函数在 lib/raidRun.ts） */
function itemPrice(def: RaidItemDef): number {
  return raidShopItemPrice(def.key)
}

function gearPrice(def: RaidGearDef): number {
  return raidShopGearPrice(def.key)
}

const SHOP_ITEM_KINDS = new Set(['consumable', 'gear_cache', 'skill_cache'])

export async function getRaidShopView(userId: number): Promise<RaidShopViewDto> {
  const [user, owned] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { points: true } }),
    prisma.raidGear.findMany({ where: { userId }, select: { gearKey: true } }),
  ])
  const ownedKeys = new Set(owned.map((row) => row.gearKey))
  return {
    points: user?.points ?? 0,
    gear: RAID_GEARS
      .filter((gear) => gear.shopable)
      .map((gear) => ({
        key: gear.key,
        name: gear.name,
        emoji: gear.emoji,
        slot: gear.slot,
        tier: gear.tier,
        rarity: gear.rarity,
        price: gearPrice(gear),
        description: gear.description,
        defense: gear.defense ?? 0,
        maxDurability: gear.maxDurability ?? 0,
        speedBonus: gear.speedBonus ?? 0,
        slots: gear.slots ?? 0,
        owned: ownedKeys.has(gear.key),
      })),
    items: RAID_ITEMS
      .filter((item) => SHOP_ITEM_KINDS.has(item.kind))
      .map((item) => ({
        key: item.key,
        name: item.name,
        emoji: item.emoji,
        rarity: item.rarity,
        kind: item.kind,
        price: itemPrice(item),
        stackMax: item.stackMax,
        description: item.description,
      })),
  }
}

export interface RaidShopBuyInput {
  kind: 'gear' | 'item'
  key: string
  amount?: number
}

export interface RaidShopBuyResult {
  kind: 'gear' | 'item'
  key: string
  name: string
  emoji: string
  amount: number
  spent: number
  balance: number
  points: number
  view: RaidShopViewDto
}

export async function buyRaidShopItem(
  userId: number,
  input: RaidShopBuyInput,
): Promise<RaidShopBuyResult> {
  if (input.kind === 'gear') {
    const def = getRaidGear(input.key)
    if (!def) throw new AppError('商店里没有这件装备', 404)
    if (!def.shopable || def.tier > 3) {
      throw new AppError('高级装备只在搜打撤中掉落，商店不出售', 400)
    }
    const price = gearPrice(def)
    const result = await prisma.$transaction(async (tx) => {
      const owned = await tx.raidGear.findUnique({
        where: { userId_gearKey: { userId, gearKey: def.key } },
      })
      if (owned) throw new AppError('已经拥有这件装备了', 400)
      const mutation = await spendPointsTx(tx, userId, price, {
        reason: 'raid_shop',
        note: `购买装备 ${def.name}`,
      })
      await tx.raidGear.create({
        data: {
          userId,
          gearKey: def.key,
          slot: def.slot,
          durability: def.maxDurability ?? 0,
          maxDurability: def.maxDurability ?? 0,
          equipped: false,
          acquiredVia: 'shop',
        },
      })
      return mutation
    })
    return {
      kind: 'gear',
      key: def.key,
      name: def.name,
      emoji: def.emoji,
      amount: 1,
      spent: price,
      balance: result.balance,
      points: price,
      view: await getRaidShopView(userId),
    }
  }

  const def = getRaidItem(input.key)
  if (!def) throw new AppError('商店里没有这件物品', 404)
  if (!SHOP_ITEM_KINDS.has(def.kind)) throw new AppError('这件物品不在商店出售', 400)
  const amount = Math.max(1, Math.min(99, Math.trunc(input.amount ?? 1)))
  const unit = itemPrice(def)
  const total = unit * amount
  const result = await prisma.$transaction(async (tx) => {
    const mutation = await spendPointsTx(tx, userId, total, {
      reason: 'raid_shop',
      note: `购买 ${def.name} ×${amount}`,
    })
    await tx.raidInventoryItem.upsert({
      where: { userId_itemKey: { userId, itemKey: def.key } },
      create: { userId, itemKey: def.key, amount },
      update: { amount: { increment: amount } },
    })
    return mutation
  })
  return {
    kind: 'item',
    key: def.key,
    name: def.name,
    emoji: def.emoji,
    amount,
    spent: total,
    balance: result.balance,
    points: total,
    view: await getRaidShopView(userId),
  }
}

/** 商店展示用品质文案（客户端可自行映射，但服务端也下发一份保证一致） */
export function rarityLabel(rarity: string): string {
  return RAID_RARITY_LABELS[rarity as keyof typeof RAID_RARITY_LABELS] ?? '普通'
}

export { RAID_GEAR_MAP }
