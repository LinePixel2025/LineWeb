/**
 * 启动时执行的一次性系统迁移（幂等，失败只告警不阻塞启动）。
 *
 * 2026-11-03：全局限额 600 → 8000 次/15min。Prisma 的 @default 只影响新用户，
 * 这里把仍为旧默认值 600 的存量账号回填到 8000；管理员手工调过的其他值不覆盖。
 * 2026-11-07：银行活期结算水位从「日期键」换成「40 分钟槽号」，把存量
 * lastInterestDateKey（YYYY-MM-DD）换算成该日的 epoch 槽号回填。
 * 2026-11-07：游戏门票机制下线，把存量仓库与容器里的 game_ticket 按原价 40 积分/张退还并清行。
 */

import prisma from '../lib/prisma.js'
import type { Prisma } from '@prisma/client'
import { dateKeyToUtc } from '../lib/stockMarket.js'
import { awardPointsTx } from './pointsService.js'

const RATE_LIMIT_BACKFILL_KEY = 'system.rateLimit.backfill8000'
const BANK_SLOT_BACKFILL_KEY = 'system.bank.slotBackfill'
const GAME_TICKET_REFUND_KEY = 'system.gameTicket.refund'

/** 40 分钟结算槽宽（毫秒）——与 bankRules.ts 的 SETTLEMENT_PERIOD_MS 保持一致（迁移只跑一次，独立成常量防循环依赖） */
const SETTLEMENT_PERIOD_MS = 40 * 60 * 1000
/** 门票原价（积分/张）——原 raidRun.ts GAME_TICKET_PRICE，机制下线后按原价退还 */
const GAME_TICKET_PRICE = 40

/** 单个迁移的兜底：失败只告警，不阻塞后续迁移与启动 */
async function runMigration(name: string, marker: string, body: () => Promise<string | void>) {
  try {
    const done = await prisma.siteSetting.findUnique({ where: { key: marker } })
    if (done) return
    const summary = await body()
    await prisma.siteSetting.upsert({
      where: { key: marker },
      create: { key: marker, value: typeof summary === 'string' ? summary : '1' },
      update: { value: typeof summary === 'string' ? summary : '1' },
    })
    if (summary) console.log(`[Migration] ${name}：${summary}`)
  } catch (error) {
    console.error(`[Migration] ${name} 失败（不阻塞启动）：`, error)
  }
}

async function backfillRateLimit(): Promise<string | void> {
  const updated = await prisma.user.updateMany({
    where: { apiRateLimit: 600 },
    data: { apiRateLimit: 8000 },
  })
  return `已把 ${updated.count} 个账号的 API 限额从 600 回填为 8000 次/15min`
}

/**
 * 旧按日结算水位 → 40 分钟槽号。lastInterestSlot=0 是「未初始化」哨兵：
 * 只有迁移前的存量行（或异常行）才是 0，新账户在建行时直接写当前槽号。
 * 日期键换算成该日 UTC 0 点（= 上海当天 08:00）的 epoch 槽号——dateKeyToUtc 的既有口径
 * 与 fund NAV 沿用的「dateKey = UTC 日界」约定一致；回填偏差最多半天（≈12 槽），
 * 对年化 2% 的活期利息影响不足 1 分，不做额外时区修正。
 */
async function backfillBankSlots(): Promise<string | void> {
  const rows = await prisma.bankAccount.findMany({
    where: { lastInterestSlot: 0, lastInterestDateKey: { not: '' } },
    select: { id: true, lastInterestDateKey: true },
  })
  for (const row of rows) {
    const epochMs = dateKeyToUtc(row.lastInterestDateKey)
    if (!Number.isFinite(epochMs)) continue // 坏数据交给银行服务的「无效水位 → 当前槽」兜底
    const slot = Math.floor(epochMs / SETTLEMENT_PERIOD_MS)
    await prisma.bankAccount.updateMany({
      where: { id: row.id, lastInterestSlot: 0 },
      data: { lastInterestSlot: slot },
    })
  }
  return `已把 ${rows.length} 个银行账户的按日结息水位换算为 40 分钟槽号`
}

/** 单行退还：CAS 删行（count!==1 视为已被处理）→ 原价发分；amount<=0 直接清行 */
async function refundTicketRows(
  rows: { id: number; userId: number; amount: number }[],
  removeRow: (tx: Prisma.TransactionClient, id: number) => Prisma.PrismaPromise<{ count: number }>,
  label: string,
  state: { refunded: number; failed: number },
): Promise<void> {
  for (const row of rows) {
    if (row.amount <= 0) {
      await prisma.$transaction((tx) => removeRow(tx, row.id))
      continue
    }
    try {
      await prisma.$transaction(async (tx) => {
        const removed = await removeRow(tx, row.id)
        if (removed.count !== 1) return // 并发已被处理，跳过
        await awardPointsTx(tx, row.userId, {
          amount: GAME_TICKET_PRICE * row.amount,
          reason: 'game_ticket_refund',
          game: null,
          note: `门票机制下线，按原价 ${GAME_TICKET_PRICE} 积分/张退还 ×${row.amount}`,
        })
        state.refunded += 1
      })
    } catch (error) {
      state.failed += 1
      console.error(`[Migration] 门票退还失败（${label} userId=${row.userId}）：`, error)
    }
  }
}

/**
 * 存量游戏门票按原价 40 积分/张退还并清行。**仓库（raid_inventory_items）与容器
 * （raid_bag_items，背包/胸挂/安全箱）两表都要处理**——门票上线期间玩家可以把
 * game_ticket 取进容器，只扫仓库会留下目录外死物且漏退款。
 * 任一行失败则整体抛错：runMigration 不写完成标记，下次启动自动重试（防部分失败永久丢失退款）。
 */
async function refundGameTickets(): Promise<string | void> {
  const state = { refunded: 0, failed: 0 }
  const inventoryRows = await prisma.raidInventoryItem.findMany({ where: { itemKey: 'game_ticket' } })
  await refundTicketRows(
    inventoryRows,
    (tx, id) => tx.raidInventoryItem.deleteMany({ where: { id } }),
    '仓库',
    state,
  )
  const bagRows = await prisma.raidBagItem.findMany({ where: { itemKey: 'game_ticket' } })
  await refundTicketRows(
    bagRows,
    (tx, id) => tx.raidBagItem.deleteMany({ where: { id } }),
    '容器',
    state,
  )
  if (state.failed > 0) {
    throw new Error(`门票退还迁移有 ${state.failed} 行失败，下次启动重试`)
  }
  return `已退还存量游戏门票 ${state.refunded} 行（仓库 ${inventoryRows.length} 行 + 容器 ${bagRows.length} 行）`
}

export async function runStartupMigrations(): Promise<void> {
  await runMigration('API 限额回填 8000', RATE_LIMIT_BACKFILL_KEY, backfillRateLimit)
  await runMigration('银行结息水位槽位化', BANK_SLOT_BACKFILL_KEY, backfillBankSlots)
  await runMigration('存量游戏门票原价退还', GAME_TICKET_REFUND_KEY, refundGameTickets)
}
