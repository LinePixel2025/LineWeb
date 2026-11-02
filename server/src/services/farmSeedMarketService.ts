/**
 * 玩家间种子交易（农场种子市场）。
 *
 * 口径：
 *   - 挂单即托管：种子从卖家 FarmItem 扣除，成交后进入买家仓库，取消原路返还；
 *   - 整单总价用积分结算，卖家支付 5% 手续费（最低 1 积分），买家不额外收费；
 *   - 每人最多 20 条在售挂单；同一作物可挂多条（价格不同）；
 *   - 不做过期扫描：挂单一直有效，卖家可随时下架（退款）。
 */

import prisma from '../lib/prisma.js'
import type { FarmItem, FarmSeedListing, Prisma, User } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import { FARM_CROPS, getCrop, type CropDef } from '../lib/farmCrops.js'
import {
  awardPointsTx,
  effectiveTitleDto,
  spendPointsTx,
  type UserTitleDto,
} from './pointsService.js'

export const SEED_MARKET_FEE_RATE = 0.05
export const SEED_MARKET_MAX_LISTINGS = 20
export const SEED_MARKET_MAX_COUNT = 99
export const SEED_MARKET_MAX_PRICE = 1_000_000

export interface SeedListingDto {
  id: number
  crop: CropDef
  count: number
  price: number
  /** 每颗种子的单价（展示用，四舍五入到 2 位） */
  unitPrice: number
  status: string
  seller: { id: number; username: string; title: UserTitleDto | null }
  buyer: { id: number; username: string } | null
  isMine: boolean
  soldAt: string | null
  createdAt: string
}

export interface SeedMarketView {
  listings: SeedListingDto[]
  myListings: SeedListingDto[]
  recentSold: SeedListingDto[]
  mySeeds: Array<{ key: string; name: string; emoji: string; count: number; tier: number }>
  catalog: readonly CropDef[]
  feeRate: number
  maxListings: number
  maxCount: number
  maxPrice: number
}

type ListingWithUsers = FarmSeedListing & {
  seller: Pick<User, 'id' | 'username'> & {
    equippedTitle?: { id: number; type: string; name: string; payload: string | null; rarity: string } | null
    equippedLeaderTitle?: { id: number; game: string; userId: number; effect: string } | null
  }
  buyer?: Pick<User, 'id' | 'username'> | null
}

function titleOf(row: ListingWithUsers): UserTitleDto | null {
  const seller = row.seller
  if (!seller.equippedTitle && !seller.equippedLeaderTitle) return null
  return effectiveTitleDto({
    id: seller.id,
    equippedTitle: seller.equippedTitle ?? null,
    equippedLeaderTitle: seller.equippedLeaderTitle ?? null,
  })
}

function listingDto(row: ListingWithUsers, viewerId: number): SeedListingDto | null {
  const crop = getCrop(row.cropKey)
  if (!crop) return null
  return {
    id: row.id,
    crop,
    count: row.count,
    price: row.price,
    unitPrice: Math.round((row.price / Math.max(1, row.count)) * 100) / 100,
    status: row.status,
    seller: { id: row.seller.id, username: row.seller.username, title: titleOf(row) },
    buyer: row.buyer ? { id: row.buyer.id, username: row.buyer.username } : null,
    isMine: row.sellerId === viewerId,
    soldAt: row.soldAt ? row.soldAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }
}

const sellerSelect = {
  id: true,
  username: true,
  equippedTitle: { select: { id: true, type: true, name: true, payload: true, rarity: true } },
  equippedLeaderTitle: { select: { id: true, game: true, userId: true, effect: true } },
} as const

function mySeedRows(items: FarmItem[]) {
  return items
    .filter((item) => item.kind === 'seed' && item.count > 0)
    .map((item) => {
      const crop = getCrop(item.itemKey)
      return crop
        ? { key: crop.key, name: crop.name, emoji: crop.emoji, count: item.count, tier: crop.tier }
        : null
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => a.tier - b.tier)
}

export async function getSeedMarketView(userId: number): Promise<SeedMarketView> {
  const [active, mine, recent, farm] = await Promise.all([
    prisma.farmSeedListing.findMany({
      where: { status: 'active' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 80,
      include: { seller: { select: sellerSelect } },
    }),
    prisma.farmSeedListing.findMany({
      where: { sellerId: userId, status: 'active' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { seller: { select: sellerSelect } },
    }),
    prisma.farmSeedListing.findMany({
      where: { status: 'sold' },
      orderBy: [{ soldAt: 'desc' }, { id: 'desc' }],
      take: 12,
      include: {
        seller: { select: sellerSelect },
        buyer: { select: { id: true, username: true } },
      },
    }),
    prisma.farm.findUnique({
      where: { userId },
      select: { items: true },
    }),
  ])

  return {
    listings: active.map((row) => listingDto(row as ListingWithUsers, userId)).filter(
      (row): row is SeedListingDto => row !== null,
    ),
    myListings: mine.map((row) => listingDto(row as ListingWithUsers, userId)).filter(
      (row): row is SeedListingDto => row !== null,
    ),
    recentSold: recent.map((row) => listingDto(row as ListingWithUsers, userId)).filter(
      (row): row is SeedListingDto => row !== null,
    ),
    mySeeds: mySeedRows(farm?.items ?? []),
    catalog: FARM_CROPS,
    feeRate: SEED_MARKET_FEE_RATE,
    maxListings: SEED_MARKET_MAX_LISTINGS,
    maxCount: SEED_MARKET_MAX_COUNT,
    maxPrice: SEED_MARKET_MAX_PRICE,
  }
}

export interface CreateSeedListingResult {
  view: SeedMarketView
  listing: SeedListingDto
}

export async function createSeedListing(
  userId: number,
  cropKey: string,
  count: number,
  price: number,
): Promise<CreateSeedListingResult> {
  const crop = getCrop(cropKey)
  if (!crop) throw new AppError('未知的作物', 400)
  if (!Number.isInteger(count) || count < 1 || count > SEED_MARKET_MAX_COUNT) {
    throw new AppError(`挂单数量需在 1–${SEED_MARKET_MAX_COUNT} 之间`, 400)
  }
  if (!Number.isInteger(price) || price < 1 || price > SEED_MARKET_MAX_PRICE) {
    throw new AppError(`挂单总价需在 1–${SEED_MARKET_MAX_PRICE} 积分之间`, 400)
  }

  const created = await prisma.$transaction(async (tx) => {
    const farm = await tx.farm.findUnique({
      where: { userId },
      include: { items: true },
    })
    if (!farm) throw new AppError('还没有农场，先开一块地吧', 404)

    const activeCount = await tx.farmSeedListing.count({
      where: { sellerId: userId, status: 'active' },
    })
    if (activeCount >= SEED_MARKET_MAX_LISTINGS) {
      throw new AppError(`最多同时挂 ${SEED_MARKET_MAX_LISTINGS} 条种子，先下架一些吧`, 400)
    }

    const seed = farm.items.find((item) => item.kind === 'seed' && item.itemKey === crop.key)
    if (!seed || seed.count < count) {
      throw new AppError(`「${crop.name}」种子不足（现有 ${seed?.count ?? 0} 颗）`, 400)
    }

    if (seed.count === count) {
      await tx.farmItem.delete({ where: { id: seed.id } })
    } else {
      await tx.farmItem.update({ where: { id: seed.id }, data: { count: { decrement: count } } })
    }

    return tx.farmSeedListing.create({
      data: { sellerId: userId, cropKey: crop.key, count, price },
      include: { seller: { select: sellerSelect } },
    })
  })

  const listing = listingDto(created as ListingWithUsers, userId)
  if (!listing) throw new AppError('挂单创建失败', 500)
  return { view: await getSeedMarketView(userId), listing }
}

export interface BuySeedListingResult {
  view: SeedMarketView
  listing: SeedListingDto
  balance: number
  fee: number
  sellerProceeds: number
}

export async function buySeedListing(userId: number, listingId: number): Promise<BuySeedListingResult> {
  const result = await prisma.$transaction(async (tx) => {
    const listing = await tx.farmSeedListing.findUnique({
      where: { id: listingId },
      include: { seller: { select: { id: true, username: true } } },
    })
    if (!listing) throw new AppError('这条挂单不存在', 404)
    if (listing.status !== 'active') throw new AppError('这条挂单已经不能买了', 409)
    if (listing.sellerId === userId) throw new AppError('不能买自己的种子', 400)
    const crop = getCrop(listing.cropKey)
    if (!crop) throw new AppError('挂单作物已失效', 400)

    const buyerFarm = await tx.farm.findUnique({ where: { userId }, select: { id: true } })
    if (!buyerFarm) throw new AppError('你还没有农场，先开一块地吧', 404)

    const claimed = await tx.farmSeedListing.updateMany({
      where: { id: listing.id, status: 'active' },
      data: { status: 'sold', buyerId: userId, soldAt: new Date() },
    })
    if (claimed.count !== 1) throw new AppError('这条挂单刚刚被买走了', 409)

    const spend = await spendPointsTx(tx, userId, listing.price, {
      reason: 'farm_seed_buy',
      game: 'farm',
      note: `买入 ${crop.name}种子 ×${listing.count}`,
    })
    const fee = Math.max(1, Math.floor(listing.price * SEED_MARKET_FEE_RATE))
    const proceeds = Math.max(0, listing.price - fee)
    const award = proceeds > 0
      ? await awardPointsTx(tx, listing.sellerId, {
        amount: proceeds,
        reason: 'farm_seed_sell',
        game: 'farm',
        note: `卖出 ${crop.name}种子 ×${listing.count}（手续费 ${fee}）`,
      })
      : null

    await tx.farmItem.upsert({
      where: { farmId_kind_itemKey: { farmId: buyerFarm.id, kind: 'seed', itemKey: crop.key } },
      create: { farmId: buyerFarm.id, kind: 'seed', itemKey: crop.key, count: listing.count },
      update: { count: { increment: listing.count } },
    })

    const sold = await tx.farmSeedListing.findUnique({
      where: { id: listing.id },
      include: {
        seller: { select: sellerSelect },
        buyer: { select: { id: true, username: true } },
      },
    })
    return {
      listing: sold ? listingDto(sold as ListingWithUsers, userId) : null,
      balance: spend.balance,
      sellerBalance: award?.balance ?? null,
      fee,
      sellerProceeds: proceeds,
    }
  })

  if (!result.listing) throw new AppError('挂单状态异常', 500)
  return {
    view: await getSeedMarketView(userId),
    listing: result.listing,
    balance: result.balance,
    fee: result.fee,
    sellerProceeds: result.sellerProceeds,
  }
}

export async function cancelSeedListing(userId: number, listingId: number): Promise<SeedMarketView> {
  await prisma.$transaction(async (tx) => {
    const listing = await tx.farmSeedListing.findUnique({ where: { id: listingId } })
    if (!listing) throw new AppError('这条挂单不存在', 404)
    if (listing.sellerId !== userId) throw new AppError('只能下架自己的挂单', 403)
    if (listing.status !== 'active') throw new AppError('这条挂单已经不能下架了', 409)
    const crop = getCrop(listing.cropKey)
    if (!crop) throw new AppError('挂单作物已失效', 400)

    const claimed = await tx.farmSeedListing.updateMany({
      where: { id: listing.id, status: 'active' },
      data: { status: 'cancelled' },
    })
    if (claimed.count !== 1) throw new AppError('这条挂单已经不能下架了', 409)

    const farm = await tx.farm.findUnique({ where: { userId }, select: { id: true } })
    if (!farm) throw new AppError('农场不存在', 404)
    await tx.farmItem.upsert({
      where: { farmId_kind_itemKey: { farmId: farm.id, kind: 'seed', itemKey: crop.key } },
      create: { farmId: farm.id, kind: 'seed', itemKey: crop.key, count: listing.count },
      update: { count: { increment: listing.count } },
    })
  })
  return getSeedMarketView(userId)
}

/** 供路由校验用 */
export function isSeedListingStatus(value: string): boolean {
  return value === 'active' || value === 'sold' || value === 'cancelled'
}

export type SeedMarketTx = Prisma.TransactionClient
