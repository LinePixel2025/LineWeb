/**
 * 宠物交易行服务（玩家间装备 / 技能交易）。
 *
 * 规则：
 *   - 只能挂自己拥有、未绑定、未穿戴、未在售的装备 / 技能；挂单会自动下架已穿戴项
 *   - 挂单价必须在参考价 50%–150%
 *   - 成交后买家扣积分、卖家到账 95%（5% 手续费），所有权转移
 *   - 参考价随成交变化：newRef = oldRef×0.7 + 成交价×0.3，在售多时下压、无在售时上浮；
 *     读取时按 7 天半衰期惰性回归基础价
 */

import prisma from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { cleanLoadout } from '../lib/petCatalog.js'
import {
  PET_EQUIPMENT_MAP,
  equipmentPower,
} from '../lib/petEquipment.js'
import {
  PET_SKILL_MAP,
  skillPower,
} from '../lib/petSkills.js'
import {
  decayRefPrice,
  nextRefPrice,
  petMarketFee,
  petMarketSellerProceeds,
  refPriceChangePct,
  validateListingPrice,
} from '../lib/petMarket.js'
import { awardPointsTx, spendPointsTx } from './pointsService.js'

export type PetMarketItemType = 'equipment' | 'skill'

export interface PetMarketItemDto {
  itemType: PetMarketItemType
  key: string
  name: string
  emoji: string
  description: string
  slot: string | null
  rarity: string
  basePrice: number
  refPrice: number
  changePct: number
  trades: number
  activeListings: number
  shopable: boolean
  power: number
}

export interface PetMarketListingDto {
  id: number
  sellerId: number
  sellerName: string
  sellerAvatarVersion: number | null
  itemType: PetMarketItemType
  itemKey: string
  name: string
  emoji: string
  slot: string | null
  rarity: string
  price: number
  refPrice: number
  changePct: number
  power: number
  createdAt: string
  isMine: boolean
}

export interface PetMarketTradeDto {
  id: number
  itemType: PetMarketItemType
  itemKey: string
  name: string
  emoji: string
  price: number
  fee: number
  buyerName: string
  sellerName: string
  createdAt: string
}

export interface PetMarketViewDto {
  balance: number
  feeRate: number
  items: PetMarketItemDto[]
  listings: PetMarketListingDto[]
  myListings: PetMarketListingDto[]
  trades: PetMarketTradeDto[]
}

const TRADE_HISTORY_LIMIT = 20

function itemBasePrice(itemType: PetMarketItemType, key: string): number {
  if (itemType === 'equipment') return PET_EQUIPMENT_MAP.get(key)?.price ?? 0
  return PET_SKILL_MAP.get(key)?.price ?? 0
}

function itemMeta(itemType: PetMarketItemType, key: string): {
  name: string
  emoji: string
  description: string
  slot: string | null
  rarity: string
  power: number
  shopable: boolean
} | null {
  if (itemType === 'equipment') {
    const item = PET_EQUIPMENT_MAP.get(key)
    if (!item) return null
    return {
      name: item.name,
      emoji: item.emoji,
      description: item.description,
      slot: item.slot,
      rarity: item.rarity,
      power: equipmentPower(item),
      shopable: item.shopable,
    }
  }
  const skill = PET_SKILL_MAP.get(key)
  if (!skill || skill.key === 'basic_attack') return null
  return {
    name: skill.name,
    emoji: skill.emoji,
    description: skill.description,
    slot: null,
    rarity: skill.kind,
    power: skillPower(skill),
    shopable: true,
  }
}

/** 读取参考价（惰性回归基础价，不写库） */
async function readRefPrice(
  itemType: PetMarketItemType,
  key: string,
  now = Date.now(),
): Promise<{ refPrice: number; basePrice: number; trades: number }> {
  const basePrice = Math.max(1, itemBasePrice(itemType, key))
  const row = await prisma.petMarketPrice.findUnique({
    where: { itemType_itemKey: { itemType, itemKey: key } },
  })
  if (!row) return { refPrice: basePrice, basePrice, trades: 0 }
  return {
    refPrice: decayRefPrice(row.refPrice, basePrice, row.updatedAt.getTime(), now),
    basePrice,
    trades: row.trades,
  }
}

/** 批次读取全部参考价（市场页 / 挂单校验共用） */
async function readAllRefPrices(
  now = Date.now(),
): Promise<Map<string, { refPrice: number; trades: number }>> {
  const rows = await prisma.petMarketPrice.findMany()
  const map = new Map<string, { refPrice: number; trades: number }>()
  for (const row of rows) {
    const base = Math.max(1, itemBasePrice(row.itemType as PetMarketItemType, row.itemKey))
    map.set(`${row.itemType}:${row.itemKey}`, {
      refPrice: decayRefPrice(row.refPrice, base, row.updatedAt.getTime(), now),
      trades: row.trades,
    })
  }
  return map
}

function refOf(
  prices: Map<string, { refPrice: number; trades: number }>,
  itemType: PetMarketItemType,
  key: string,
): number {
  return prices.get(`${itemType}:${key}`)?.refPrice ?? Math.max(1, itemBasePrice(itemType, key))
}

function tradesOf(
  prices: Map<string, { refPrice: number; trades: number }>,
  itemType: PetMarketItemType,
  key: string,
): number {
  return prices.get(`${itemType}:${key}`)?.trades ?? 0
}

/** 交易行视图：在售挂单 + 我的挂单 + 最近成交 + 全部可交易物品的参考价 */
export async function getPetMarketView(userId: number): Promise<PetMarketViewDto> {
  const now = Date.now()
  const [user, listings, myListings, trades, prices, counts] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { points: true } }),
    prisma.petMarketListing.findMany({
      where: { status: 'active' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      include: { seller: { select: { id: true, username: true, avatarVersion: true } } },
    }),
    prisma.petMarketListing.findMany({
      where: { sellerId: userId, status: 'active' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    }),
    prisma.petMarketTrade.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: TRADE_HISTORY_LIMIT,
      include: {
        buyer: { select: { username: true } },
        seller: { select: { username: true } },
      },
    }),
    readAllRefPrices(now),
    prisma.petMarketListing.groupBy({
      by: ['itemType', 'itemKey'],
      where: { status: 'active' },
      _count: { _all: true },
    }),
  ])

  const countMap = new Map(
    counts.map((row) => [`${row.itemType}:${row.itemKey}`, row._count._all]),
  )

  const items: PetMarketItemDto[] = []
  for (const item of PET_EQUIPMENT_MAP.values()) {
    if (item.bound || item.price <= 0) continue
    const refPrice = refOf(prices, 'equipment', item.key)
    items.push({
      itemType: 'equipment',
      key: item.key,
      name: item.name,
      emoji: item.emoji,
      description: item.description,
      slot: item.slot,
      rarity: item.rarity,
      basePrice: item.price,
      refPrice,
      changePct: refPriceChangePct(refPrice, item.price),
      trades: tradesOf(prices, 'equipment', item.key),
      activeListings: countMap.get(`equipment:${item.key}`) ?? 0,
      shopable: item.shopable,
      power: equipmentPower(item),
    })
  }
  for (const skill of PET_SKILL_MAP.values()) {
    if (skill.key === 'basic_attack') continue
    const refPrice = refOf(prices, 'skill', skill.key)
    items.push({
      itemType: 'skill',
      key: skill.key,
      name: skill.name,
      emoji: skill.emoji,
      description: skill.description,
      slot: null,
      rarity: skill.kind,
      basePrice: skill.price,
      refPrice,
      changePct: refPriceChangePct(refPrice, skill.price),
      trades: tradesOf(prices, 'skill', skill.key),
      activeListings: countMap.get(`skill:${skill.key}`) ?? 0,
      shopable: true,
      power: skillPower(skill),
    })
  }

  const toListing = (
    row: {
      id: number
      sellerId: number
      itemType: string
      itemKey: string
      price: number
      createdAt: Date
      seller: { username: string; avatarVersion: number | null }
    },
  ): PetMarketListingDto | null => {
    const meta = itemMeta(row.itemType as PetMarketItemType, row.itemKey)
    if (!meta) return null
    const refPrice = refOf(prices, row.itemType as PetMarketItemType, row.itemKey)
    return {
      id: row.id,
      sellerId: row.sellerId,
      sellerName: row.seller.username,
      sellerAvatarVersion: row.seller.avatarVersion,
      itemType: row.itemType as PetMarketItemType,
      itemKey: row.itemKey,
      name: meta.name,
      emoji: meta.emoji,
      slot: meta.slot,
      rarity: meta.rarity,
      price: row.price,
      refPrice,
      changePct: refPriceChangePct(row.price, refPrice),
      power: meta.power,
      createdAt: row.createdAt.toISOString(),
      isMine: row.sellerId === userId,
    }
  }

  const myListingRows = new Map(myListings.map((row) => [row.id, row]))
  const myListingDtos = myListings
    .map((row) => toListing({ ...row, seller: { username: '我', avatarVersion: null } }))
    .filter((row): row is PetMarketListingDto => !!row)

  const listingDtos = listings
    .map((row) => toListing(row))
    .filter((row): row is PetMarketListingDto => !!row)
    .map((row) => (myListingRows.has(row.id) ? { ...row, isMine: true } : row))

  return {
    balance: user?.points ?? 0,
    feeRate: 0.05,
    items,
    listings: listingDtos,
    myListings: myListingDtos,
    trades: trades.map((trade) => {
      const meta = itemMeta(trade.itemType as PetMarketItemType, trade.itemKey)
      return {
        id: trade.id,
        itemType: trade.itemType as PetMarketItemType,
        itemKey: trade.itemKey,
        name: meta?.name ?? trade.itemKey,
        emoji: meta?.emoji ?? '🎁',
        price: trade.price,
        fee: trade.fee,
        buyerName: trade.buyer.username,
        sellerName: trade.seller.username,
        createdAt: trade.createdAt.toISOString(),
      }
    }),
  }
}

/** 读取我的宠物装配（用于判断装备是否已穿戴） */
async function loadPetLoadout(ownerId: number): Promise<{
  petId: number
  equipped: string
  equipmentKeys: string[]
  skillKeys: string[]
}> {
  const pet = await prisma.pet.findUnique({
    where: { userId: ownerId },
    include: {
      equipments: { select: { itemKey: true } },
      skills: { select: { skillKey: true } },
    },
  })
  if (!pet) throw new AppError('还没有宠物', 404)
  if (pet.status !== 'alive') throw new AppError('宠物已经离家出走了', 409)
  return {
    petId: pet.id,
    equipped: pet.equipped,
    equipmentKeys: pet.equipments.map((row) => row.itemKey),
    skillKeys: pet.skills.map((row) => row.skillKey),
  }
}

/** 挂单：装备 / 技能 */
export async function createListing(
  userId: number,
  itemType: PetMarketItemType,
  itemKey: string,
  price: number,
): Promise<PetMarketListingDto> {
  const now = Date.now()
  const meta = itemMeta(itemType, itemKey)
  if (!meta) throw new AppError('没有这件物品', 404)
  if (itemType === 'equipment') {
    const item = PET_EQUIPMENT_MAP.get(itemKey)
    if (!item || item.bound) throw new AppError('绑定装备不能交易', 400)
  }

  const activeBattle = await prisma.petBattle.count({
    where: { status: 'active', OR: [{ challengerId: userId }, { opponentId: userId }] },
  })
  if (activeBattle > 0) throw new AppError('对战进行中不能挂单', 409)

  const pet = await loadPetLoadout(userId)
  const owned = itemType === 'equipment'
    ? await prisma.petEquipment.findUnique({
      where: { petId_itemKey: { petId: pet.petId, itemKey } },
    })
    : await prisma.petSkill.findUnique({
      where: { petId_skillKey: { petId: pet.petId, skillKey: itemKey } },
    })
  if (!owned) throw new AppError('还没有这件物品', 400)
  if (itemType === 'equipment' && (owned as { bound?: boolean }).bound) {
    throw new AppError('绑定装备不能交易', 400)
  }

  const existing = await prisma.petMarketListing.count({
    where: {
      status: 'active',
      itemType,
      itemKey,
      ...(itemType === 'equipment' ? { equipmentId: owned.id } : { skillId: owned.id }),
    },
  })
  if (existing > 0) throw new AppError('这件物品已经在交易行里了', 409)

  const { refPrice } = await readRefPrice(itemType, itemKey, now)
  const priceError = validateListingPrice(price, refPrice)
  if (priceError) throw new AppError(priceError, 400)

  // 已穿戴的装备/技能先自动卸下，避免「在售物品还提供战斗属性」
  const loadout = cleanLoadout(pet.equipped, pet.equipmentKeys, pet.skillKeys)
  if (itemType === 'equipment') {
    const definition = PET_EQUIPMENT_MAP.get(itemKey)
    if (definition && loadout[definition.slot] === itemKey) loadout[definition.slot] = null
  } else {
    loadout.skills = loadout.skills.filter((key) => key !== itemKey)
  }

  const listing = await prisma.$transaction(async (tx) => {
    // 事务内复核所有权（可能在上面的读取与这里之间被战斗掉落/卖出）
    const current = itemType === 'equipment'
      ? await tx.petEquipment.findUnique({
        where: { id: owned.id },
        select: { petId: true, listed: true },
      })
      : await tx.petSkill.findUnique({
        where: { id: owned.id },
        select: { petId: true, listed: true },
      })
    if (!current || current.petId !== pet.petId) {
      throw new AppError('这件物品已经不属于你了', 409)
    }
    // 用 listed 标记原子抢占：并发双击/双标签只会有一条挂单成功
    const claimed = itemType === 'equipment'
      ? await tx.petEquipment.updateMany({
        where: { id: owned.id, listed: false },
        data: { listed: true },
      })
      : await tx.petSkill.updateMany({
        where: { id: owned.id, listed: false },
        data: { listed: true },
      })
    if (claimed.count === 0) throw new AppError('这件物品已经在交易行里了', 409)
    await tx.pet.update({ where: { id: pet.petId }, data: { equipped: JSON.stringify(loadout) } })
    return tx.petMarketListing.create({
      data: {
        sellerId: userId,
        itemType,
        itemKey,
        ...(itemType === 'equipment' ? { equipmentId: owned.id } : { skillId: owned.id }),
        price,
        status: 'active',
      },
      include: { seller: { select: { id: true, username: true, avatarVersion: true } } },
    })
  })

  return {
    id: listing.id,
    sellerId: userId,
    sellerName: listing.seller.username,
    sellerAvatarVersion: listing.seller.avatarVersion,
    itemType,
    itemKey,
    name: meta.name,
    emoji: meta.emoji,
    slot: meta.slot,
    rarity: meta.rarity,
    price,
    refPrice,
    changePct: refPriceChangePct(price, refPrice),
    power: meta.power,
    createdAt: listing.createdAt.toISOString(),
    isMine: true,
  }
}

/** 购买挂单 */
export async function buyListing(userId: number, listingId: number): Promise<{
  balance: number
  listing: PetMarketListingDto
  fee: number
}> {
  const now = Date.now()
  let result: Awaited<ReturnType<typeof buyListingTx>>
  try {
    result = await buyListingTx(userId, listingId, now)
  } catch (error) {
    // 挂单指向的物品已易主：事务回滚后单独把这条过期挂单下架，避免一直挂在列表里
    if (error instanceof AppError && error.message.includes('挂单已失效')) {
      await prisma.petMarketListing.updateMany({
        where: { id: listingId, status: 'active' },
        data: { status: 'cancelled' },
      }).catch(() => {})
    }
    throw error
  }
  return result
}

async function buyListingTx(userId: number, listingId: number, now: number) {
  return prisma.$transaction(async (tx) => {
    const listing = await tx.petMarketListing.findUnique({
      where: { id: listingId },
      include: { seller: { select: { id: true, username: true, avatarVersion: true } } },
    })
    if (!listing) throw new AppError('挂单不存在', 404)
    if (listing.status !== 'active') throw new AppError('这件物品已经卖出或下架了', 409)
    if (listing.sellerId === userId) throw new AppError('不能购买自己的挂单', 400)

    const buyerPet = await tx.pet.findUnique({ where: { userId } })
    const sellerPet = await tx.pet.findUnique({ where: { userId: listing.sellerId } })
    if (!buyerPet || buyerPet.status !== 'alive') throw new AppError('你还没有可交易的宠物', 400)
    if (!sellerPet) throw new AppError('卖家的宠物不存在', 409)

    const itemType = listing.itemType as PetMarketItemType
    const meta = itemMeta(itemType, listing.itemKey)
    if (!meta) throw new AppError('物品已被移除', 409)

    const duplicate = itemType === 'equipment'
      ? await tx.petEquipment.findUnique({
        where: { petId_itemKey: { petId: buyerPet.id, itemKey: listing.itemKey } },
      })
      : await tx.petSkill.findUnique({
        where: { petId_skillKey: { petId: buyerPet.id, skillKey: listing.itemKey } },
      })
    if (duplicate) throw new AppError('你已经拥有这件物品了', 409)

    // 挂单必须仍指向卖家当前拥有的物品（防止装备被战斗掉落后旧挂单继续成交）
    if (itemType === 'equipment') {
      const equipment = listing.equipmentId
        ? await tx.petEquipment.findUnique({ where: { id: listing.equipmentId } })
        : null
      if (!equipment || equipment.petId !== sellerPet.id) {
        throw new AppError('卖家已经不再拥有这件装备，挂单已失效', 409)
      }
    } else {
      const skill = listing.skillId
        ? await tx.petSkill.findUnique({ where: { id: listing.skillId } })
        : null
      if (!skill || skill.petId !== sellerPet.id) {
        throw new AppError('卖家已经不再拥有这个技能，挂单已失效', 409)
      }
    }

    const claimed = await tx.petMarketListing.updateMany({
      where: { id: listingId, status: 'active' },
      data: { status: 'sold', buyerId: userId, soldAt: new Date() },
    })
    if (claimed.count === 0) throw new AppError('这件物品已经卖出或下架了', 409)

    const fee = petMarketFee(listing.price)
    const proceeds = petMarketSellerProceeds(listing.price)
    const spend = await spendPointsTx(tx, userId, listing.price, {
      reason: 'pet_market_buy',
      note: `交易行购买 ${meta.name}`,
      game: null,
    })
    if (proceeds > 0) {
      await awardPointsTx(tx, listing.sellerId, {
        amount: proceeds,
        reason: 'pet_market_sell',
        note: `交易行卖出 ${meta.name}`,
        game: null,
      })
    }

    if (itemType === 'equipment') {
      await tx.petEquipment.update({
        where: { id: listing.equipmentId! },
        data: { petId: buyerPet.id, acquiredVia: 'market', bound: false, listed: false },
      })
    } else {
      await tx.petSkill.update({
        where: { id: listing.skillId! },
        data: { petId: buyerPet.id, acquiredVia: 'market', listed: false },
      })
    }

    // 防御：卖家装配里若还引用该物品，顺手摘掉
    const sellerEquipments = await tx.petEquipment.findMany({
      where: { petId: sellerPet.id },
      select: { itemKey: true },
    })
    const sellerSkills = await tx.petSkill.findMany({
      where: { petId: sellerPet.id },
      select: { skillKey: true },
    })
    const sellerLoadout = cleanLoadout(
      sellerPet.equipped,
      sellerEquipments.map((row) => row.itemKey),
      sellerSkills.map((row) => row.skillKey),
    )
    if (itemType === 'equipment') {
      const definition = PET_EQUIPMENT_MAP.get(listing.itemKey)
      if (definition && sellerLoadout[definition.slot] === listing.itemKey) {
        sellerLoadout[definition.slot] = null
        await tx.pet.update({ where: { id: sellerPet.id }, data: { equipped: JSON.stringify(sellerLoadout) } })
      }
    } else if (sellerLoadout.skills.includes(listing.itemKey)) {
      sellerLoadout.skills = sellerLoadout.skills.filter((key) => key !== listing.itemKey)
      await tx.pet.update({ where: { id: sellerPet.id }, data: { equipped: JSON.stringify(sellerLoadout) } })
    }

    const refRow = await tx.petMarketPrice.findUnique({
      where: { itemType_itemKey: { itemType, itemKey: listing.itemKey } },
    })
    const basePrice = Math.max(1, itemBasePrice(itemType, listing.itemKey))
    const currentRef = refRow
      ? decayRefPrice(refRow.refPrice, basePrice, refRow.updatedAt.getTime(), now)
      : basePrice
    const activeListings = await tx.petMarketListing.count({
      where: { status: 'active', itemType, itemKey: listing.itemKey },
    })
    const refAfter = nextRefPrice(currentRef, basePrice, listing.price, activeListings)
    await tx.petMarketPrice.upsert({
      where: { itemType_itemKey: { itemType, itemKey: listing.itemKey } },
      update: { refPrice: refAfter, basePrice, trades: { increment: 1 } },
      create: { itemType, itemKey: listing.itemKey, refPrice: refAfter, basePrice, trades: 1 },
    })
    await tx.petMarketTrade.create({
      data: {
        listingId,
        sellerId: listing.sellerId,
        buyerId: userId,
        itemType,
        itemKey: listing.itemKey,
        price: listing.price,
        fee,
        refPriceAfter: refAfter,
      },
    })

    return {
      balance: spend.balance,
      fee,
      listing: {
        id: listing.id,
        sellerId: listing.sellerId,
        sellerName: listing.seller.username,
        sellerAvatarVersion: listing.seller.avatarVersion,
        itemType,
        itemKey: listing.itemKey,
        name: meta.name,
        emoji: meta.emoji,
        slot: meta.slot,
        rarity: meta.rarity,
        price: listing.price,
        refPrice: refAfter,
        changePct: refPriceChangePct(listing.price, refAfter),
        power: meta.power,
        createdAt: listing.createdAt.toISOString(),
        isMine: false,
      } satisfies PetMarketListingDto,
    }
  })
}

/** 下架挂单（仅卖家、仅 active） */
export async function cancelListing(userId: number, listingId: number): Promise<void> {
  const row = await prisma.petMarketListing.findUnique({ where: { id: listingId } })
  if (!row) throw new AppError('挂单不存在', 404)
  if (row.sellerId !== userId) throw new AppError('只能下架自己的挂单', 403)
  if (row.status !== 'active') throw new AppError('挂单已经结束', 409)
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.petMarketListing.updateMany({
      where: { id: listingId, status: 'active' },
      data: { status: 'cancelled' },
    })
    if (claimed.count === 0) throw new AppError('挂单已经结束', 409)
    if (row.equipmentId) {
      await tx.petEquipment.updateMany({ where: { id: row.equipmentId }, data: { listed: false } })
    }
    if (row.skillId) {
      await tx.petSkill.updateMany({ where: { id: row.skillId }, data: { listed: false } })
    }
  })
}
