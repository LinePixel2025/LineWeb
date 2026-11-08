/**
 * 搜打撤官方商店（替代原玩家交易行）。
 *
 * 口径（2026-11-04 调整）：
 *   - 装备全档上架：1–3 级按目录价平价出售，4 级及以上按目录价 ×2，且需要相应仓库等级
 *     （gearStorageGate：4→Lv.3、5→Lv.4、6→Lv.5、t7/t8 背包→Lv.6）；
 *   - 装备是「实例物品」：同一 key 可以重复购买 / 重复开箱，每次都是一行独立耐久的新实例，
 *     不再「已拥有即拒卖」、也不再自动把重复件折成积分，想变现就在装备页手动回收；
 *   - 买消耗品 / 箱子进入仓库，可再取到背包 / 胸挂 / 安全箱带进对局；
 *   - 玩家出售物品走仓库页的「回收」，按 raidSellPrice 结算（材料 100% / 消耗品 60% / 箱子 70%）。
 */

import prisma from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import {
  RAID_GEARS,
  RAID_GEAR_MAP,
  RAID_ITEMS,
  RAID_RARITY_LABELS,
  gearStorageGate,
  getRaidGear,
  getRaidItem,
  raidShopGearPrice,
  raidShopItemPrice,
  type RaidGearDef,
  type RaidItemDef,
} from '../lib/raidRun.js'
import { spendPointsTx } from './pointsService.js'
import { ensureRaidStorage, ensureRaidStorageTx } from './raidCommon.js'

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
  /** 已持有的实例件数（重复购买是允许的，这个数字只用来提示） */
  ownedCount: number
  /** 购买所需的仓库等级，0 = 无门槛 */
  storageLevelRequired: number
  /** 当前仓库等级还不够买（前端置灰并说明要升到几级） */
  locked: boolean
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
  const [user, owned, storage] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { points: true } }),
    prisma.raidGear.findMany({ where: { userId }, select: { gearKey: true } }),
    ensureRaidStorage(userId),
  ])
  // 装备是实例物品：同一个 key 可以有多件，所以这里统计的是件数而不是「有没有」
  const ownedCounts = new Map<string, number>()
  for (const row of owned) {
    ownedCounts.set(row.gearKey, (ownedCounts.get(row.gearKey) ?? 0) + 1)
  }
  const storageLevel = Math.max(1, Math.trunc(storage.level))
  return {
    points: user?.points ?? 0,
    gear: RAID_GEARS
      .filter((gear) => gear.shopable)
      .map((gear) => {
        const required = gearStorageGate(gear.tier)
        return {
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
          ownedCount: ownedCounts.get(gear.key) ?? 0,
          storageLevelRequired: required,
          locked: storageLevel < required,
        }
      }),
    items: RAID_ITEMS
      // 退役物品（旧型号撤离信号弹）只为旧库存保留目录数据，不再出现在商店。
      .filter((item) => !item.retired && SHOP_ITEM_KINDS.has(item.kind))
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
    if (!def.shopable) throw new AppError('这件装备不在商店出售', 400)
    const required = gearStorageGate(def.tier)
    const price = gearPrice(def)
    await prisma.$transaction(async (tx) => {
      // 门槛按仓库等级而不是「有没有买过」：装备是实例物品，重复购买就是多一件
      const storage = await ensureRaidStorageTx(tx, userId)
      if (Math.max(1, Math.trunc(storage.level)) < required) {
        throw new AppError(`这件 ${def.tier} 级装备需要仓库 Lv.${required}，请先升级仓库`, 400, 'RAID_STORAGE_LOCKED')
      }
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
      balance: await balanceOf(userId),
      points: price,
      view: await getRaidShopView(userId),
    }
  }

  const def = getRaidItem(input.key)
  if (!def) throw new AppError('商店里没有这件物品', 404)
  if (def.retired) throw new AppError('这件物品已停产，不再出售', 400)
  if (!SHOP_ITEM_KINDS.has(def.kind)) {
    throw new AppError('这件物品不在商店出售', 400)
  }
  const amount = Math.max(1, Math.min(99, Math.trunc(input.amount ?? 1)))
  const unit = itemPrice(def)
  const total = unit * amount
  await prisma.$transaction(async (tx) => {
    await spendPointsTx(tx, userId, total, {
      reason: 'raid_shop',
      note: `购买 ${def.name} ×${amount}`,
    })
    await tx.raidInventoryItem.upsert({
      where: { userId_itemKey: { userId, itemKey: def.key } },
      create: { userId, itemKey: def.key, amount },
      update: { amount: { increment: amount } },
    })
  })
  return {
    kind: 'item',
    key: def.key,
    name: def.name,
    emoji: def.emoji,
    amount,
    spent: total,
    balance: await balanceOf(userId),
    points: total,
    view: await getRaidShopView(userId),
  }
}

/** 事务提交后重新读余额（事务内的 mutation.balance 在并发下可能是旧值） */
async function balanceOf(userId: number): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { points: true } })
  return user?.points ?? 0
}

/** 商店展示用品质文案（客户端可自行映射，但服务端也下发一份保证一致） */
export function rarityLabel(rarity: string): string {
  return RAID_RARITY_LABELS[rarity as keyof typeof RAID_RARITY_LABELS] ?? '普通'
}

export { RAID_GEAR_MAP }
