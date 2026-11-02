/**
 * 搜打撤交易行服务（玩家间买卖仓库里的搜打撤材料）。
 *
 * 规则（镜像 petMarketService 的事务骨架）：
 *   - 整单出售：挂单带 amount 与整单总价 price，不支持部分购买；
 *   - 数量预留制：上架时把 listedAmount 原子预留（同物品可有多条挂单），
 *     恒有 amount >= listedAmount，任何写路径都必须带守卫条件并写后复核；
 *   - 挂单价必须落在「目录总价值 × 0.5–1.5」（含端点）；
 *   - 成交后买家扣积分并收到物品（受买家仓库容量约束，装不下整笔拒绝）、卖家到账 95%（5% 手续费，最低 1），写 RaidMarketTrade；
 *   - 不能购买自己的挂单。
 */

import prisma from '../lib/prisma.js'
import type { Prisma, RaidInventoryItem } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import { RAID_LOOT_MAP } from '../lib/petRaid.js'
import {
  RAID_MARKET_FEE_RATE,
  raidMarketFee,
  raidMarketSellerProceeds,
  validateRaidListingPrice,
} from '../lib/raidStorage.js'
import { awardPointsTx, spendPointsTx } from './pointsService.js'
import { getRaidStorageSummaryTx } from './raidStorageService.js'

type Db = Prisma.TransactionClient

/* ============================================================
   DTO
   ============================================================ */

export interface RaidMarketListingDto {
  id: number
  sellerId: number
  sellerName: string
  itemKey: string
  itemName: string
  emoji: string
  rarity: string
  /** 单件目录价值快照 */
  value: number
  amount: number
  /** 整单总价（积分） */
  price: number
  /** 单件均价 = ceil(price / amount) */
  unitPrice: number
  createdAt: string
  isMine: boolean
}

export interface RaidMarketTradeDto {
  id: number
  itemKey: string
  itemName: string
  emoji: string
  amount: number
  price: number
  fee: number
  sellerName: string
  buyerName: string
  createdAt: string
}

export interface RaidMarketViewDto {
  balance: number
  feeRate: number
  listings: RaidMarketListingDto[]
  myListings: RaidMarketListingDto[]
  trades: RaidMarketTradeDto[]
}

export interface RaidMarketBuyResultDto {
  balance: number
  fee: number
  proceeds: number
  item: {
    itemKey: string
    itemName: string
    amount: number
    price: number
  }
}

const TRADE_HISTORY_LIMIT = 20
const LISTING_PAGE_LIMIT = 100

/* ============================================================
   工具
   ============================================================ */

function listingDto(
  row: {
    id: number
    sellerId: number
    itemKey: string
    itemName: string
    rarity: string
    value: number
    amount: number
    price: number
    createdAt: Date
    seller?: { username: string }
  },
  viewerId: number,
): RaidMarketListingDto {
  return {
    id: row.id,
    sellerId: row.sellerId,
    sellerName: row.seller?.username ?? (row.sellerId === viewerId ? '我' : '卖家'),
    itemKey: row.itemKey,
    itemName: row.itemName,
    emoji: RAID_LOOT_MAP.get(row.itemKey)?.emoji ?? '📦',
    rarity: row.rarity,
    value: row.value,
    amount: row.amount,
    price: row.price,
    unitPrice: Math.ceil(row.price / Math.max(1, row.amount)),
    createdAt: row.createdAt.toISOString(),
    isMine: row.sellerId === viewerId,
  }
}

/** 挂单时的目录快照（防目录调整影响历史挂单） */
function snapshotOf(itemKey: string): { itemName: string; rarity: string; value: number } {
  const entry = RAID_LOOT_MAP.get(itemKey)
  if (!entry) throw new AppError('没有这件物品', 404)
  return { itemName: entry.name, rarity: entry.rarity, value: entry.value }
}

/** 仓库物品行守卫扣减（出售 / 取消预留共用）：成功后复核不变式，行清零则删除 */
async function releaseReservedTx(
  tx: Db,
  row: RaidInventoryItem,
  amount: number,
  options: { consumeAmount: boolean },
): Promise<void> {
  const guarded = await tx.raidInventoryItem.updateMany({
    where: {
      id: row.id,
      amount: { gte: amount },
      listedAmount: { gte: amount },
    },
    data: {
      ...(options.consumeAmount ? { amount: { decrement: amount } } : {}),
      listedAmount: { decrement: amount },
    },
  })
  if (guarded.count !== 1) {
    throw new AppError('卖家仓库数据异常，交易已回滚', 409)
  }
  // 写后复核：listedAmount <= amount 不变式
  const after = await tx.raidInventoryItem.findUnique({ where: { id: row.id } })
  if (!after || after.listedAmount > after.amount || after.listedAmount < 0) {
    throw new AppError('仓库数据异常，交易已回滚', 500)
  }
  if (after.amount === 0 && after.listedAmount === 0) {
    await tx.raidInventoryItem.delete({ where: { id: after.id } })
  }
}

/* ============================================================
   视图
   ============================================================ */

export async function getRaidMarketView(userId: number): Promise<RaidMarketViewDto> {
  const [user, listings, myListings, trades] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { points: true } }),
    prisma.raidMarketListing.findMany({
      where: { status: 'active' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LISTING_PAGE_LIMIT,
      include: { seller: { select: { username: true } } },
    }),
    prisma.raidMarketListing.findMany({
      where: { sellerId: userId, status: 'active' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LISTING_PAGE_LIMIT,
    }),
    prisma.raidMarketTrade.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: TRADE_HISTORY_LIMIT,
    }),
  ])

  // RaidMarketTrade 不建 User 关系（append-only 快照表），批量查一次用户名
  const userIds = new Set<number>()
  for (const trade of trades) {
    userIds.add(trade.sellerId)
    userIds.add(trade.buyerId)
  }
  const users = userIds.size > 0
    ? await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, username: true } })
    : []
  const nameOf = new Map(users.map((row) => [row.id, row.username]))

  const myIds = new Set(myListings.map((row) => row.id))
  return {
    balance: user?.points ?? 0,
    feeRate: RAID_MARKET_FEE_RATE,
    listings: listings
      .map((row) => listingDto(row, userId))
      .map((row) => (myIds.has(row.id) ? { ...row, isMine: true } : row)),
    myListings: myListings.map((row) => listingDto({ ...row, seller: undefined }, userId)),
    trades: trades.map((trade) => ({
      id: trade.id,
      itemKey: trade.itemKey,
      itemName: trade.itemName,
      emoji: RAID_LOOT_MAP.get(trade.itemKey)?.emoji ?? '📦',
      amount: trade.amount,
      price: trade.price,
      fee: trade.fee,
      sellerName: nameOf.get(trade.sellerId) ?? '未知用户',
      buyerName: nameOf.get(trade.buyerId) ?? '未知用户',
      createdAt: trade.createdAt.toISOString(),
    })),
  }
}

/* ============================================================
   上架
   ============================================================ */

export async function listRaidItem(
  userId: number,
  itemKey: string,
  amount: number,
  price: number,
): Promise<RaidMarketListingDto> {
  // 非事务前置校验（物品存在 / 价格区间），事务内再复核仓库持有量
  const snapshot = snapshotOf(itemKey)
  try {
    validateRaidListingPrice(itemKey, amount, price)
  } catch (error) {
    throw new AppError(error instanceof Error ? error.message : '挂单参数不合法', 400)
  }

  const listing = await prisma.$transaction(async (tx) => {
    const row = await tx.raidInventoryItem.findUnique({
      where: { userId_itemKey: { userId, itemKey } },
    })
    if (!row || row.amount < amount) {
      throw new AppError(`仓库里没有这么多「${snapshot.itemName}」`, 400)
    }
    const freeAmount = row.amount - row.listedAmount
    if (freeAmount < amount) {
      throw new AppError(`「${snapshot.itemName}」可上架的只剩 ${freeAmount} 件（${row.listedAmount} 件已在售）`, 400)
    }

    // 原子预留：amount 必须仍能覆盖「listedAmount + 本次预留量」
    const reserved = await tx.raidInventoryItem.updateMany({
      where: { id: row.id, amount: { gte: row.listedAmount + amount } },
      data: { listedAmount: { increment: amount } },
    })
    if (reserved.count !== 1) throw new AppError('仓库数量已变化，请重试', 409)
    // 写后复核：listedAmount <= amount 不变式
    const after = await tx.raidInventoryItem.findUnique({ where: { id: row.id } })
    if (!after || after.listedAmount > after.amount) {
      throw new AppError('仓库数据异常，挂单已回滚', 500)
    }

    return tx.raidMarketListing.create({
      data: {
        sellerId: userId,
        itemKey,
        itemName: snapshot.itemName,
        rarity: snapshot.rarity,
        value: snapshot.value,
        amount,
        price,
        status: 'active',
      },
      include: { seller: { select: { username: true } } },
    })
  })

  return listingDto(listing, userId)
}

/* ============================================================
   购买
   ============================================================ */

export async function buyRaidListing(userId: number, listingId: number): Promise<RaidMarketBuyResultDto> {
  return prisma.$transaction(async (tx) => {
    const listing = await tx.raidMarketListing.findUnique({ where: { id: listingId } })
    if (!listing) throw new AppError('挂单不存在', 404)
    if (listing.status !== 'active') throw new AppError('这件物品已被买走或已下架', 409)
    if (listing.sellerId === userId) throw new AppError('不能购买自己的挂单', 400)

    // 原子抢占挂单：并发购买只有一笔成功
    const claimed = await tx.raidMarketListing.updateMany({
      where: { id: listing.id, status: 'active' },
      data: { status: 'sold', buyerId: userId, soldAt: new Date() },
    })
    if (claimed.count === 0) throw new AppError('这件物品已被买走或已下架', 409)

    const sellerRow = await tx.raidInventoryItem.findUnique({
      where: { userId_itemKey: { userId: listing.sellerId, itemKey: listing.itemKey } },
    })
    if (!sellerRow) throw new AppError('卖家已经不再持有这件物品，交易已回滚', 409)
    // 守卫扣减卖家库存与预留（交易成交后物品从卖家仓库消失）
    await releaseReservedTx(tx, sellerRow, listing.amount, { consumeAmount: true })

    // 买家入库：与撤离入仓同一容量口径，仓库装不下则整笔交易拒绝（事务回滚）
    const buyerStorage = await getRaidStorageSummaryTx(tx, userId)
    if (buyerStorage.used + listing.amount > buyerStorage.capacity) {
      throw new AppError('你的仓库空间不足，先升级仓库或清理一些物品吧', 400)
    }
    await tx.raidInventoryItem.upsert({
      where: { userId_itemKey: { userId, itemKey: listing.itemKey } },
      create: { userId, itemKey: listing.itemKey, amount: listing.amount },
      update: { amount: { increment: listing.amount } },
    })

    const spend = await spendPointsTx(tx, userId, listing.price, {
      reason: 'raid_market_buy',
      note: `交易行购买 ${listing.itemName}×${listing.amount}`,
    })
    const fee = raidMarketFee(listing.price)
    const proceeds = raidMarketSellerProceeds(listing.price)
    if (proceeds > 0) {
      await awardPointsTx(tx, listing.sellerId, {
        amount: proceeds,
        reason: 'raid_market_sell',
        note: `交易行卖出 ${listing.itemName}×${listing.amount}（手续费 ${fee}）`,
      })
    }

    await tx.raidMarketTrade.create({
      data: {
        listingId: listing.id,
        sellerId: listing.sellerId,
        buyerId: userId,
        itemKey: listing.itemKey,
        itemName: listing.itemName,
        amount: listing.amount,
        price: listing.price,
        fee,
      },
    })

    return {
      balance: spend.balance,
      fee,
      proceeds,
      item: {
        itemKey: listing.itemKey,
        itemName: listing.itemName,
        amount: listing.amount,
        price: listing.price,
      },
    }
  })
}

/* ============================================================
   下架
   ============================================================ */

export async function cancelRaidListing(userId: number, listingId: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const listing = await tx.raidMarketListing.findUnique({ where: { id: listingId } })
    if (!listing) throw new AppError('挂单不存在', 404)
    if (listing.sellerId !== userId) throw new AppError('只能下架自己的挂单', 403)
    if (listing.status !== 'active') throw new AppError('挂单已经结束', 409)

    // 原子抢占：并发下架 / 购买只有一方成功
    const claimed = await tx.raidMarketListing.updateMany({
      where: { id: listing.id, status: 'active' },
      data: { status: 'cancelled' },
    })
    if (claimed.count === 0) throw new AppError('挂单已经结束', 409)

    // 释放预留：与其余写路径一致走守卫原子递减 + 复核，不能用快照差值整值覆盖
    // （并发下同物品行的 listedAmount 可能已被另一笔上架/购买改写，覆盖写会丢更新错账）
    const row = await tx.raidInventoryItem.findUnique({
      where: { userId_itemKey: { userId: listing.sellerId, itemKey: listing.itemKey } },
    })
    if (row) {
      const released = await tx.raidInventoryItem.updateMany({
        where: { id: row.id, listedAmount: { gte: listing.amount } },
        data: { listedAmount: { decrement: listing.amount } },
      })
      if (released.count !== 1) {
        throw new AppError('挂单预留状态已变化，请刷新后重试', 409)
      }
      const after = await tx.raidInventoryItem.findUnique({ where: { id: row.id } })
      if (after && after.amount === 0 && after.listedAmount === 0) {
        await tx.raidInventoryItem.delete({ where: { id: row.id } })
      }
    }
  })
}
