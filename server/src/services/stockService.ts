/**
 * 模拟股市交易服务：用统一积分按实时价买入 / 卖出虚构股票。
 *
 * - 买入：扣积分（含 0.3% 手续费）后按成交时实时价折算份额，可分批加仓（成本累加）；
 * - 卖出：支持部分卖出（shares 缺省 = 整仓，向后兼容），成本按份额等比分摊，
 *   整仓清仓删除持仓行；到账积分 = 毛收入 − 0.3% 手续费；
 * - 行情每 3 秒推进一个 tick（stockTicks.ts），玩家交易会小幅影响价格
 *   （买入推高 / 卖出压低，10 分钟半衰期衰减），冲击状态经 SiteSetting 持久化，
 *   重启后恢复；内存中的冲击状态是真相源，DB 只用于重启恢复；
 * - 每日分红：隔夜未变动的持仓按「市值 × dividendYield」发放积分（stock_dividend），
 *   结算水位 lastDividendDate 保证每人每天最多一次、并发也只发一次；
 * - 成交记录：买卖各写一行 StockTrade（append-only），卖出时把已实现盈亏累加进
 *   StockAccount.realizedPoints，供账户条与成交记录页展示；
 * - 所有积分变动写 PointsLedger（reason = stock_buy / stock_sell / stock_dividend），可审计。
 */

import prisma from '../lib/prisma.js'
import type { Prisma } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import { getTodayDateKey, getTodayDayStart } from '../lib/pointsRules.js'
import { STOCK_DEFINITIONS } from '../lib/stockMarket.js'
import {
  IMPACT_STATE_SETTING_KEY,
  applyTradeImpactDelta,
  getLiveQuote,
  getLiveQuoteByCode,
  loadImpactStateFromJson,
  markImpactPersisted,
  serializeImpactState,
} from '../lib/stockTicks.js'
import {
  STOCK_MAX_INVEST,
  STOCK_MIN_INVEST,
  isOvernightHolding,
  positionMarketValue,
  positionProfit,
  positionProfitPct,
  quoteStockBuy,
  quoteStockSell,
  splitCostForShares,
  stockDailyDividend,
  totalAssets,
} from '../lib/stockTrading.js'
import { awardPointsTx, spendPointsTx } from './pointsService.js'

export interface StockHoldingDto {
  code: string
  name: string
  sector: string
  color: string
  price: number
  prevClose: number
  changePct: number
  /** 持有份额 */
  shares: number
  /** 累计投入积分（含买入手续费） */
  costPoints: number
  /** 按现价计算的市值（整数积分） */
  marketValue: number
  /** 浮动盈亏（积分） */
  profit: number
  profitPct: number
  /** 每日分红收益率（0.008 = 0.8%/日） */
  dividendYield: number
  /** 今日预计分红（当前市值 × 分红收益率，整数积分） */
  todayDividend: number
  /** 是否隔夜持仓（当天没买卖过 → 今日可结算分红） */
  overnight: boolean
}

export interface StockAccountSummaryDto {
  /** 累计已发放分红（积分） */
  totalDividends: number
  /** 累计已实现盈亏（卖出到账 − 分摊成本，可正可负） */
  realizedPoints: number
  /** 总资产 = 积分余额 + 持仓市值 */
  totalAssets: number
  /** 今日预计分红（全部持仓按当前市值估算，含当日买入的部分，仅供展示） */
  todayDividend: number
}

export interface StockPortfolioDto {
  dateKey: string
  balance: number
  account: StockAccountSummaryDto
  summary: {
    costPoints: number
    marketValue: number
    profit: number
    profitPct: number
    positions: number
    /** 已实现盈亏（卖出结算的累计值） */
    realizedProfit: number
  }
  holdings: StockHoldingDto[]
}

/* ============================================================
   冲击状态恢复（进程内一次性）
   ============================================================ */

let impactLoadPromise: Promise<void> | null = null

/**
 * 重启后从 SiteSetting 恢复股价冲击状态（进程内一次性；失败不阻塞行情，重置为 0 不重试）。
 * 用 in-flight Promise 保证并发首请求共享同一次加载，避免加载完成前以 impact=0 成交、
 * 随后又被恢复逻辑 clear() 抹掉交易冲击。
 */
function ensureImpactLoaded(): Promise<void> {
  if (!impactLoadPromise) {
    impactLoadPromise = (async () => {
      try {
        const row = await prisma.siteSetting.findUnique({ where: { key: IMPACT_STATE_SETTING_KEY } })
        loadImpactStateFromJson(row?.value ?? null, Date.now())
      } catch (error) {
        loadImpactStateFromJson(null, Date.now())
        console.warn('[stockService] 读取股价冲击状态失败，已重置为 0：', error)
      }
    })()
  }
  return impactLoadPromise
}

/** 把当前冲击状态写进 SiteSetting（必须在交易事务内调用） */
async function persistImpactTx(tx: Prisma.TransactionClient, nowMs: number): Promise<void> {
  const value = serializeImpactState(nowMs)
  await tx.siteSetting.upsert({
    where: { key: IMPACT_STATE_SETTING_KEY },
    update: { value },
    create: { key: IMPACT_STATE_SETTING_KEY, value },
  })
  markImpactPersisted()
}

/* ============================================================
   每日分红
   ============================================================ */

/**
 * 结算当日分红（幂等：同一用户同一天最多发一次）。
 *
 * 分两段而不是「一个长事务」是刻意的：
 * 1. 先用 updateMany 的谓词原子抢占结算水位（lastDividendDate != today → today），
 *    抢不到就说明别的请求已经在结算 → 直接返回。这条条件更新是「不重复发钱」的唯一保证，
 *    即使进程被多副本部署也成立；
 * 2. 抢占成功后再开事务发放积分并累加 totalDividends。事务内的锁序是
 *    User → StockAccount（awardPointsTx 先锁用户行，再更新账户行），
 *    与买入 / 卖出事务（User → Holding → SiteSetting → StockAccount）同向，
 *    不会出现「结算持账户锁等用户、交易持用户锁等账户」的环。
 *    发放失败时把水位退回 null，下一次请求会重试 —— 否则当天分红会永久丢失。
 *    极端情况下进程若恰好死在「抢占成功、发放之前」，当天分红会丢失一次（次日自动恢复）；
 *    这是为了换取「绝不重复发钱」而刻意选择的方向（多给不可回滚，少给可由用户重试补回）。
 *
 * 参与分红的条件：持仓的 updatedAt 早于当日 0 点（Asia/Shanghai）。
 * 当天买入 / 加仓 / 部分卖出的持仓 updatedAt 会被刷新到当天，因此当天不计息，
 * 避免「早上买入、晚上领分红」的套利。
 *
 * @returns 本次实际发放的积分（0 = 已结算过 / 没有隔夜持仓）
 */
async function settleDividends(userId: number, now: number = Date.now()): Promise<number> {
  const dateKey = getTodayDateKey(now)
  const dayStartMs = getTodayDayStart(now).getTime()

  // 快路径：当天已结算（绝大多数请求只读一次账户行就走）
  const existing = await prisma.stockAccount.findUnique({
    where: { userId },
    select: { lastDividendDate: true },
  })
  if (existing?.lastDividendDate === dateKey) return 0

  // 先算分红再抢占水位：读持仓 / 取报价失败时水位保持不动，下一次请求还能重试；
  // 反过来的话一次偶发读失败就会把当天分红永久吞掉。
  const rows = await prisma.stockHolding.findMany({ where: { userId } })
  const breakdown: Array<{ name: string; amount: number }> = []
  let total = 0
  for (const row of rows) {
    if (!isOvernightHolding(row.updatedAt, dayStartMs)) continue
    const definition = STOCK_DEFINITIONS.find((item) => item.code === row.code)
    const quote = getLiveQuoteByCode(row.code, now)
    if (!definition || !quote) continue
    const amount = stockDailyDividend(positionMarketValue(row.shares, quote.price), definition.dividendYield)
    if (amount <= 0) continue
    total += amount
    breakdown.push({ name: definition.name, amount })
  }

  // 首访 / 老账号可能还没有账户行：先确保存在（update 为空即纯 no-op，只为拿到一行）
  await prisma.stockAccount.upsert({
    where: { userId },
    update: {},
    create: { userId },
  })

  // 条件抢占结算水位（SQL NULL 不参与 != 比较，所以要显式带上 null 分支）
  const claimed = await prisma.stockAccount.updateMany({
    where: {
      userId,
      OR: [{ lastDividendDate: null }, { lastDividendDate: { not: dateKey } }],
    },
    data: { lastDividendDate: dateKey },
  })
  if (claimed.count === 0) return 0

  // 没有可发的分红：水位已经写好，直接返回（避免每次请求重复读持仓）
  if (total <= 0) return 0

  try {
    const awarded = await prisma.$transaction(async (tx) => {
      // 每只持仓一条台账（note 形如「星尘科技 每日分红」），便于玩家在积分流水里追溯来源；
      // awardPointsTx 每次都先锁同一行 User，后续几条只是复用已持有的行锁，不会改变锁序
      let totalAwarded = 0
      for (const item of breakdown) {
        const result = await awardPointsTx(tx, userId, {
          amount: item.amount,
          reason: 'stock_dividend',
          note: `${item.name} 每日分红`,
        })
        totalAwarded += result.delta
      }
      if (totalAwarded > 0) {
        await tx.stockAccount.update({
          where: { userId },
          data: { totalDividends: { increment: totalAwarded } },
        })
      }
      return totalAwarded
    })
    return awarded
  } catch (error) {
    // 发放失败（DB 抖动 / 用户被删等）：退回水位让下一次请求重试，页面不至于整体 500
    try {
      await prisma.stockAccount.updateMany({
        where: { userId, lastDividendDate: dateKey },
        data: { lastDividendDate: null },
      })
    } catch {
      // 回滚水位是尽力而为：失败也不影响本次抛错后的其它目录读取
    }
    console.warn('[stockService] 分红结算失败，已退回水位待重试：', error)
    return 0
  }
}

/* ============================================================
   持仓 / 账户
   ============================================================ */

/**
 * 持仓行 → DTO。overnight 由 updatedAt 与当日 0 点比较得出：
 * 前端据此标「今日不计息」，todayDividend 则只是按当前市值估算的展示值。
 */
function holdingDtoOf(
  row: { code: string; shares: number; costPoints: number; updatedAt: Date },
  dayStartMs: number,
  now: number,
): StockHoldingDto | null {
  const quote = getLiveQuoteByCode(row.code, now)
  if (!quote) return null
  const marketValue = positionMarketValue(row.shares, quote.price)
  return {
    code: row.code,
    name: quote.name,
    sector: quote.sector,
    color: quote.color,
    price: quote.price,
    prevClose: quote.prevClose,
    changePct: quote.changePct,
    shares: Math.round(row.shares * 10_000) / 10_000,
    costPoints: row.costPoints,
    marketValue,
    profit: positionProfit(marketValue, row.costPoints),
    profitPct: positionProfitPct(marketValue, row.costPoints),
    dividendYield: quote.dividendYield,
    todayDividend: stockDailyDividend(marketValue, quote.dividendYield),
    overnight: isOvernightHolding(row.updatedAt, dayStartMs),
  }
}

/** 当前用户持仓 + 账户汇总（按市值倒序，报价用实时价；读取前先结算当日分红） */
export async function getStockPortfolio(userId: number): Promise<StockPortfolioDto> {
  const dateKey = getTodayDateKey()
  await ensureImpactLoaded()
  const now = Date.now()
  await settleDividends(userId, now)
  const dayStartMs = getTodayDayStart(now).getTime()

  const [user, rows, account] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { points: true } }),
    prisma.stockHolding.findMany({ where: { userId } }),
    prisma.stockAccount.findUnique({ where: { userId } }),
  ])

  const holdings: StockHoldingDto[] = []
  for (const row of rows) {
    const dto = holdingDtoOf(row, dayStartMs, now)
    if (dto) holdings.push(dto)
  }
  holdings.sort((a, b) => b.marketValue - a.marketValue)

  const totalCost = holdings.reduce((sum, row) => sum + row.costPoints, 0)
  const totalValue = holdings.reduce((sum, row) => sum + row.marketValue, 0)
  const todayDividend = holdings.reduce((sum, row) => sum + row.todayDividend, 0)
  const balance = user?.points ?? 0

  return {
    dateKey,
    balance,
    account: {
      totalDividends: account?.totalDividends ?? 0,
      realizedPoints: account?.realizedPoints ?? 0,
      totalAssets: totalAssets(balance, totalValue),
      todayDividend,
    },
    summary: {
      costPoints: totalCost,
      marketValue: totalValue,
      profit: totalValue - totalCost,
      profitPct: positionProfitPct(totalValue, totalCost),
      positions: holdings.length,
      realizedProfit: account?.realizedPoints ?? 0,
    },
    holdings,
  }
}

export interface StockBuyResult {
  balance: number
  /** 该股票的每日分红收益率（买入面板顺手展示「日息 0.8%」） */
  dividendYield: number
  holding: StockHoldingDto
  trade: {
    code: string
    name: string
    price: number
    points: number
    fee: number
    shares: number
  }
}

/**
 * 买入（可分批加仓）：积分不足 / 金额越界由 spendPointsTx 与参数校验拦截。
 * 锁序：User（spend）→ Holding（upsert）→ SiteSetting（冲击落盘）→ StockTrade（append）。
 */
export async function buyStock(userId: number, code: string, points: number): Promise<StockBuyResult> {
  const normalized = code.trim().toUpperCase()
  await ensureImpactLoaded()
  const now = Date.now()
  // 先结算当日分红：避免「今天先卖出再分红」漏发 / 重复发
  await settleDividends(userId, now)
  const quote = getLiveQuoteByCode(normalized, now)
  if (!quote) throw new AppError('没有这只股票', 404)

  const budget = Math.trunc(points)
  if (!Number.isFinite(budget) || budget <= 0) throw new AppError('投入积分必须是正整数', 400)
  if (budget < STOCK_MIN_INVEST) throw new AppError(`单笔最少投入 ${STOCK_MIN_INVEST} 积分`, 400)
  if (budget > STOCK_MAX_INVEST) throw new AppError(`单笔最多投入 ${STOCK_MAX_INVEST} 积分`, 400)

  const quoted = quoteStockBuy(budget, quote.price)
  if (quoted.shares <= 0) throw new AppError('投入积分不足以买入任何份额', 400)

  // 事务前快照内存冲击：事务回滚时恢复，避免「幽灵冲击」被下次成功交易持久化
  // （并发窗口内其它交易的冲击可能被一并回滚，量级 ≤ clamp 上限且 10 分钟半衰期自愈，可接受）
  const impactSnapshot = serializeImpactState(now)
  try {
    return await prisma.$transaction(async (tx) => {
      const spend = await spendPointsTx(tx, userId, budget, {
        reason: 'stock_buy',
        note: `${quote.name}（${quote.code}）买入 ${quoted.shares.toFixed(2)} 份`,
      })
      const row = await tx.stockHolding.upsert({
        where: { userId_code: { userId, code: quote.code } },
        create: {
          userId,
          code: quote.code,
          shares: quoted.shares,
          costPoints: budget,
        },
        update: {
          shares: { increment: quoted.shares },
          costPoints: { increment: budget },
        },
      })
      // 成交记录（append-only）：points = 本笔投入积分（含手续费）
      await tx.stockTrade.create({
        data: {
          userId,
          code: quote.code,
          side: 'buy',
          shares: quoted.shares,
          price: quote.price,
          points: budget,
          fee: quoted.fee,
          profit: null,
        },
      })
      // 买入推高价格并把冲击状态落盘（与积分变动同事务，保证台账与行情冲击一致）
      applyTradeImpactDelta(quote.code, budget, now)
      await persistImpactTx(tx, now)

      const marketValue = positionMarketValue(row.shares, quote.price)
      const dayStartMs = getTodayDayStart(now).getTime()
      return {
        balance: spend.balance,
        dividendYield: quote.dividendYield,
        holding: {
          code: quote.code,
          name: quote.name,
          sector: quote.sector,
          color: quote.color,
          price: quote.price,
          prevClose: quote.prevClose,
          changePct: quote.changePct,
          shares: Math.round(row.shares * 10_000) / 10_000,
          costPoints: row.costPoints,
          marketValue,
          profit: positionProfit(marketValue, row.costPoints),
          profitPct: positionProfitPct(marketValue, row.costPoints),
          dividendYield: quote.dividendYield,
          todayDividend: stockDailyDividend(marketValue, quote.dividendYield),
          // 刚加过仓 → updatedAt 是今天，今日不计息
          overnight: isOvernightHolding(row.updatedAt, dayStartMs),
        },
        trade: {
          code: quote.code,
          name: quote.name,
          price: quote.price,
          points: budget,
          fee: quoted.fee,
          shares: Math.round(quoted.shares * 10_000) / 10_000,
        },
      }
    })
  } catch (error) {
    loadImpactStateFromJson(impactSnapshot, Date.now())
    throw error
  }
}

export interface StockSellResult {
  balance: number
  code: string
  name: string
  /** 本次卖出份额 */
  shares: number
  price: number
  gross: number
  fee: number
  proceeds: number
  /** 本次卖出部分分摊的成本（整仓 = 全部成本） */
  costPoints: number
  /** 本次已实现盈亏（到手 - 分摊成本） */
  profit: number
  /** 卖出后剩余份额（整仓为 0） */
  remainingShares: number
  /** 是否整仓清仓 */
  closed: boolean
}

/**
 * 卖出持仓（无持仓 404）：shares 缺省 = 整仓（向后兼容），支持部分卖出；
 * 到账积分写入台账，卖出按毛收入压低价格并把冲击状态落盘；
 * 同时写成交记录并把已实现盈亏累加进 StockAccount.realizedPoints。
 * 锁序与 buy 一致（User → Holding → SiteSetting → StockAccount）；持仓扣减用条件更新防并发超卖。
 */
export async function sellStock(userId: number, code: string, shares?: number): Promise<StockSellResult> {
  const normalized = code.trim().toUpperCase()
  await ensureImpactLoaded()
  const now = Date.now()
  // 先结算当日分红：卖出会刷新 updatedAt，若不先结算，隔夜持仓当天的分红会被吞掉
  await settleDividends(userId, now)
  const quote = getLiveQuoteByCode(normalized, now)
  if (!quote) throw new AppError('没有这只股票', 404)

  // 事务前快照内存冲击：事务回滚时恢复，避免「幽灵冲击」被下次成功交易持久化
  // （并发窗口内其它交易的冲击可能被一并回滚，量级 ≤ clamp 上限且 10 分钟半衰期自愈，可接受）
  const impactSnapshot = serializeImpactState(now)
  try {
    return await prisma.$transaction(async (tx) => {
      const holding = await tx.stockHolding.findUnique({
        where: { userId_code: { userId, code: quote.code } },
      })
      if (!holding) throw new AppError('你没有这只股票的持仓', 400)

      // 卖出份额：缺省 = 整仓；指定时必须为正且不超过持仓（1e-9 容差吸收浮点累计误差）
      let sellShares = holding.shares
      if (shares !== undefined) {
        if (!(shares > 0)) throw new AppError('卖出份额必须大于 0', 400)
        if (shares > holding.shares * (1 + 1e-9)) throw new AppError('卖出份额超过持仓', 400)
        sellShares = Math.min(shares, holding.shares)
      }

      const quoted = quoteStockSell(sellShares, quote.price)
      const costPortion = splitCostForShares(holding.costPoints, sellShares, holding.shares)

      // 锁序统一为 User → Holding → SiteSetting（与 buy 相同，避免 User↔SiteSetting 成环死锁）：
      // 先记到账积分，随后的持仓条件更新失败会抛 409 整体回滚，award 随之回滚
      const award = quoted.proceeds > 0
        ? await awardPointsTx(tx, userId, {
          amount: quoted.proceeds,
          reason: 'stock_sell',
          note: `${quote.name}（${quote.code}）卖出 ${sellShares.toFixed(2)} 份`,
        })
        : { delta: 0, balance: (await tx.user.findUnique({ where: { id: userId }, select: { points: true } }))?.points ?? 0 }

      // 条件更新防并发超卖（仿 spendPointsTx）：where shares >= sellShares 由行锁 + 谓词重评
      // 保证原子性，两笔并发卖出只有一笔能成功，失败方 409（整体回滚，含上面的到账积分）
      let remainingShares = 0
      let closed = true
      if (holding.shares - sellShares <= 1e-9) {
        const deleted = await tx.stockHolding.deleteMany({
          where: { id: holding.id, shares: { gte: sellShares } },
        })
        if (deleted.count === 0) throw new AppError('持仓已变化，请刷新后重试', 409)
      } else {
        const updated = await tx.stockHolding.updateMany({
          where: { id: holding.id, shares: { gte: sellShares } },
          data: {
            shares: { decrement: sellShares },
            costPoints: { decrement: costPortion },
          },
        })
        if (updated.count === 0) throw new AppError('持仓已变化，请刷新后重试', 409)
        // 回读取更新后的权威剩余份额（并发买入可能已在读取与更新之间加仓）
        const refreshed = await tx.stockHolding.findUnique({ where: { id: holding.id }, select: { shares: true } })
        remainingShares = Math.max(0, refreshed?.shares ?? 0)
        closed = remainingShares <= 1e-9
      }

      applyTradeImpactDelta(quote.code, -quoted.gross, now)
      await persistImpactTx(tx, now)

      // 已实现盈亏 = 到账 − 分摊成本（可正可负）；账户行 upsert 兜住首访 / 老账号
      const realized = quoted.proceeds - costPortion
      await tx.stockAccount.upsert({
        where: { userId },
        create: { userId, realizedPoints: realized },
        update: { realizedPoints: { increment: realized } },
      })
      // 成交记录（append-only）：points = 本笔到账积分，profit = 本笔已实现盈亏
      await tx.stockTrade.create({
        data: {
          userId,
          code: quote.code,
          side: 'sell',
          shares: sellShares,
          price: quote.price,
          points: quoted.proceeds,
          fee: quoted.fee,
          profit: realized,
        },
      })

      return {
        balance: award.balance,
        code: quote.code,
        name: quote.name,
        shares: Math.round(sellShares * 10_000) / 10_000,
        price: quote.price,
        gross: quoted.gross,
        fee: quoted.fee,
        proceeds: quoted.proceeds,
        costPoints: costPortion,
        profit: realized,
        remainingShares: Math.round(remainingShares * 10_000) / 10_000,
        closed,
      }
    })
  } catch (error) {
    loadImpactStateFromJson(impactSnapshot, Date.now())
    throw error
  }
}

/* ============================================================
   成交记录
   ============================================================ */

export interface StockTradeDto {
  id: number
  code: string
  name: string
  color: string
  sector: string
  side: 'buy' | 'sell'
  shares: number
  price: number
  /** 买入 = 投入积分（含手续费）；卖出 = 到账积分 */
  points: number
  fee: number
  /** 仅卖出行有值：本笔已实现盈亏 */
  profit: number | null
  createdAt: string
}

/** 最近成交记录（按时间倒序，默认 50 条，最多 100） */
export async function getStockTrades(userId: number, limit = 50): Promise<StockTradeDto[]> {
  const take = Math.min(100, Math.max(1, Math.trunc(limit) || 50))
  const rows = await prisma.stockTrade.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
  })
  const definitions = new Map(STOCK_DEFINITIONS.map((definition) => [definition.code, definition]))
  return rows.map((row) => {
    const definition = definitions.get(row.code)
    return {
      id: row.id,
      code: row.code,
      name: definition?.name ?? row.code,
      color: definition?.color ?? '#57606a',
      sector: definition?.sector ?? '未知',
      side: row.side === 'sell' ? 'sell' : 'buy',
      shares: Math.round(row.shares * 10_000) / 10_000,
      price: Math.round(row.price * 100) / 100,
      points: row.points,
      fee: row.fee,
      profit: row.profit,
      createdAt: row.createdAt.toISOString(),
    }
  })
}

/* ============================================================
   总资产排行榜
   ============================================================ */

export interface StockLeaderEntryDto {
  rank: number
  userId: number
  username: string
  avatarVersion: number
  /** 总资产 = 积分余额 + 持仓实时市值 */
  totalAssets: number
  marketValue: number
  /** 持仓浮动盈亏（市值 − 成本） */
  profit: number
  isMe: boolean
}

export interface StockLeaderboardDto {
  dateKey: string
  /** 前 N 名（默认 20，最多 50） */
  entries: StockLeaderEntryDto[]
  /** 我自己（可能不在前 N） */
  me: StockLeaderEntryDto | null
}

/** 候选池大小：先按积分取前 50 人再算持仓，避免为了排行榜全表扫描 StockHolding */
const LEADER_CANDIDATE_POOL = 50

/**
 * 总资产排行榜：积分余额 + 持仓实时市值。
 *
 * 实现口径：先取「积分最高的 50 个 active 用户」（+ 本人，即使不在前 50）作为候选池，
 * 一次性批量读候选池的持仓、用同一时刻的实时报价算市值，再按总资产排序。
 * 这是近似榜（理论上积分靠后但持仓极多的人可能被漏掉），换来的是一次排行榜
 * 只读 1 次用户表 + 1 次持仓表，50 人规模下开销可忽略。
 */
export async function getStockLeaderboard(
  currentUserId: number,
  limit = 20,
): Promise<StockLeaderboardDto> {
  const dateKey = getTodayDateKey()
  await ensureImpactLoaded()
  const now = Date.now()
  const take = Math.min(LEADER_CANDIDATE_POOL, Math.max(1, Math.trunc(limit) || 20))

  const rows = await prisma.user.findMany({
    where: { status: 'active' },
    orderBy: [{ points: 'desc' }, { id: 'asc' }],
    take: LEADER_CANDIDATE_POOL,
    select: { id: true, username: true, avatarVersion: true, points: true },
  })
  let candidates = rows
  if (!rows.some((row) => row.id === currentUserId)) {
    const me = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { id: true, username: true, avatarVersion: true, points: true },
    })
    // 自己被封禁 / 不存在时不强行入榜，me 返回 null
    if (me) candidates = [...rows, me]
  }

  const holdings = await prisma.stockHolding.findMany({
    where: { userId: { in: candidates.map((row) => row.id) } },
    select: { userId: true, code: true, shares: true, costPoints: true },
  })
  // 同一时刻取 12 只报价，保证所有人用同一套价格算市值
  const prices = new Map(STOCK_DEFINITIONS.map((definition) => [
    definition.code,
    getLiveQuote(definition, dateKey, now).price,
  ]))
  const totals = new Map<number, { marketValue: number; costPoints: number }>()
  for (const row of holdings) {
    const price = prices.get(row.code)
    if (!price) continue
    const current = totals.get(row.userId) ?? { marketValue: 0, costPoints: 0 }
    current.marketValue += positionMarketValue(row.shares, price)
    current.costPoints += row.costPoints
    totals.set(row.userId, current)
  }

  const ranked = candidates
    .map((row) => {
      const total = totals.get(row.id) ?? { marketValue: 0, costPoints: 0 }
      return {
        rank: 0,
        userId: row.id,
        username: row.username,
        avatarVersion: row.avatarVersion,
        totalAssets: totalAssets(row.points, total.marketValue),
        marketValue: total.marketValue,
        profit: total.marketValue - total.costPoints,
        isMe: row.id === currentUserId,
        /** 仅排序用，不对外下发 */
        balance: row.points,
      }
    })
    .filter((entry) => entry.totalAssets > 0)
    .sort((a, b) => b.totalAssets - a.totalAssets || b.balance - a.balance || a.userId - b.userId)

  ranked.forEach((entry, index) => {
    entry.rank = index + 1
  })

  const toDto = (entry: (typeof ranked)[number]): StockLeaderEntryDto => ({
    rank: entry.rank,
    userId: entry.userId,
    username: entry.username,
    avatarVersion: entry.avatarVersion,
    totalAssets: entry.totalAssets,
    marketValue: entry.marketValue,
    profit: entry.profit,
    isMe: entry.isMe,
  })

  const meEntry = ranked.find((entry) => entry.isMe)
  return {
    dateKey,
    entries: ranked.slice(0, take).map(toDto),
    me: meEntry ? toDto(meEntry) : null,
  }
}
