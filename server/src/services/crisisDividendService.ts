/**
 * 公共银行每日随机分红：每分钟由定时器调用，内部自行判断跨日，当天只发一次。
 *
 * 流程（算式在 lib/crisisRules.ts 的 DIVIDEND_* / dividendPctOf / dividendDrawOf）：
 * 1. 读危机参数，dividendEnabled 关闭直接返回；
 * 2. Asia/Shanghai 日界：SiteSetting `crisis.dividend.lastDate` 已是今天 → 已发过；
 * 3. 事务内 CAS 抢锁（把 lastDate 翻成今天）防并发双发 → 读池 → 按当日确定比例抽取
 *    → 人均不足 1 分跳过（锁照抢、明细照写，当天不再试）→ 逐人发分 → 写明细 JSON。
 *
 * 并发口径：
 * - 抢锁失败 / create 撞 P2002 = 别的实例已经发过，静默返回；
 * - 扣池 CAS 不中 → 抛错回滚整个事务（含锁），下一分钟自然重试；
 * - 函数整体不抛出：定时器兜底路径，任何异常只 console.error。
 */
import prisma from '../lib/prisma.js'
import { getTodayDateKey } from '../lib/pointsRules.js'
import { awardPointsTx } from './pointsService.js'
import { getCrisisRules } from './crisisService.js'
import { CRISIS_DIVIDEND_REASON, dividendDrawOf, dividendPctOf } from '../lib/crisisRules.js'
import type { Prisma } from '@prisma/client'

/** SiteSetting key：当日已发放的标记（值 = dateKey） */
const LAST_DATE_KEY = 'crisis.dividend.lastDate'
/** SiteSetting key：最近一次发放明细 JSON（前端公共银行动态卡的数据源） */
const LAST_RESULT_KEY = 'crisis.dividend.last'

/** Prisma 唯一约束冲突（P2002）：并发抢锁以数据库唯一键兜底（与 crisisService 同口径） */
function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: unknown }).code === 'P2002'
}

export interface CrisisDividendRecord {
  /** 发放日（Asia/Shanghai YYYY-MM-DD） */
  dateKey: string
  /** 当日抽取比例（%，一位小数） */
  pct: number
  /** 从公共银行抽出的总积分（0 = 当日人均不足 1 分未发放） */
  total: number
  /** 每人发放积分（0 = 未发放） */
  perUser: number
  /** 参与人数（全站 active 用户，含管理员） */
  userCount: number
  /** 落库时刻（ISO） */
  at: string
  /** true = 当日人均不足 1 分，跳过发放（锁已占，当天不再试） */
  skipped?: boolean
}

/** 读明细 JSON（GET /api/crisis/pool 的 dividend 字段出口；解析失败一律 null） */
export async function getCrisisDividendRecord(): Promise<CrisisDividendRecord | null> {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: LAST_RESULT_KEY } })
    if (!row?.value) return null
    const parsed: unknown = JSON.parse(row.value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    if (typeof record.dateKey !== 'string' || typeof record.pct !== 'number') return null
    return {
      dateKey: record.dateKey,
      pct: record.pct,
      total: typeof record.total === 'number' ? record.total : 0,
      perUser: typeof record.perUser === 'number' ? record.perUser : 0,
      userCount: typeof record.userCount === 'number' ? record.userCount : 0,
      at: typeof record.at === 'string' ? record.at : '',
      skipped: record.skipped === true ? true : undefined,
    }
  } catch {
    return null
  }
}

/** 写明细 JSON（事务内；JSON.stringify 失败不可能发生，字段全部是可序列化标量） */
async function writeLastResultTx(tx: Prisma.TransactionClient, record: CrisisDividendRecord): Promise<void> {
  await tx.siteSetting.upsert({
    where: { key: LAST_RESULT_KEY },
    create: { key: LAST_RESULT_KEY, value: JSON.stringify(record) },
    update: { value: JSON.stringify(record) },
  })
}

/**
 * 执行每日分红（幂等，可随时调用）。
 * 返回本次真正发放的明细；未到日界 / 已发过 / 关闭 / 跳过 / 失败返回 null。
 */
export async function runDailyDividend(): Promise<CrisisDividendRecord | null> {
  try {
    const rules = await getCrisisRules()
    if (!rules.dividendEnabled) return null

    const today = getTodayDateKey()
    // 快速路径：当天已发过直接返回，省一次事务
    const marker = await prisma.siteSetting.findUnique({ where: { key: LAST_DATE_KEY } })
    if (marker?.value === today) return null

    // 逐人发分是 3 查询/人的交互事务，默认 5s 超时在千级用户量会必然回滚（锁随事务回滚、
    // 下分钟重试再超时，当天永远发不出）——放宽到 120s，当前站点规模（百人级）远够
    const issued = await prisma.$transaction(
      async (tx): Promise<CrisisDividendRecord | null> => {
      // a. CAS 抢锁：把标记翻成今天；count === 0 说明行不存在（首次运行），create 撞 P2002 = 别人已发
      const claim = await tx.siteSetting.updateMany({
        where: { key: LAST_DATE_KEY, value: { not: today } },
        data: { value: today },
      })
      if (claim.count === 0) {
        try {
          await tx.siteSetting.create({ data: { key: LAST_DATE_KEY, value: today } })
        } catch (err) {
          if (isUniqueViolation(err)) return null
          throw err
        }
      }

      // b. 读池子行（upsert 兜底建 0 行，与 crisisService.ensurePoolRow 同口径；并发下不会撞主键）
      const pool = await tx.crisisPool.upsert({
        where: { id: 1 },
        create: { id: 1, total: BigInt(0) },
        update: {},
      })
      const pct = dividendPctOf(today)
      const draw = dividendDrawOf(Number(pool.total), pct)

      // d. 全站 active 用户（含管理员）；人均不足 1 分（draw < 人数）跳过发放但锁已抢，当天不再试
      const users = await tx.user.findMany({ where: { status: 'active' }, select: { id: true } })
      const perUser = users.length > 0 ? Math.floor(draw / users.length) : 0
      if (perUser < 1) {
        await writeLastResultTx(tx, {
          dateKey: today,
          pct: Math.round(pct * 10) / 10,
          total: 0,
          perUser: 0,
          userCount: users.length,
          at: new Date().toISOString(),
          skipped: true,
        })
        return null
      }

      // c. CAS 扣池：只扣「实际发放额」（perUser × 人数）——抽取额按 floor 均分后的
      //    尾差（draw − 发放额）留在池子里，防止积分凭空蒸发。
      //    不中（池子被并发放贷抽干）→ 抛错回滚整个事务（锁也回滚），下分钟重试
      const issuedTotal = perUser * users.length
      const deducted = await tx.crisisPool.updateMany({
        where: { id: 1, total: { gte: BigInt(issuedTotal) } },
        data: { total: { decrement: BigInt(issuedTotal) } },
      })
      if (deducted.count !== 1) {
        throw new Error(`[crisisDividend] 扣池失败：公共银行余额不足 issued=${issuedTotal}`)
      }

      // e. 逐人发分（统一台账 reason=crisis_dividend，前端积分流水按 reason 映射文案）
      for (const user of users) {
        await awardPointsTx(tx, user.id, {
          amount: perUser,
          reason: CRISIS_DIVIDEND_REASON,
          game: null,
          note: '公共银行每日分红',
        })
      }

      // f. 写明细（前端「公共银行动态」卡与 /api/crisis/pool 的 dividend 字段共用）；
      //    total 记实际发放总额（= perUser × 人数），pct 仅作当日抽取比例的展示口径
      const record: CrisisDividendRecord = {
        dateKey: today,
        pct: Math.round(pct * 10) / 10,
        total: issuedTotal,
        perUser,
        userCount: users.length,
        at: new Date().toISOString(),
      }
      await writeLastResultTx(tx, record)
      return record
      },
      { timeout: 120_000, maxWait: 10_000 },
    )

    if (issued) {
      console.log(
        `[crisisDividend] ${issued.dateKey} 分红完成：比例 ${issued.pct}%，发放 ${issued.total} 分，` +
          `人均 ${issued.perUser} 分 × ${issued.userCount} 人`,
      )
    }
    return issued
  } catch (err) {
    // 定时器兜底路径：任何失败只记日志，下一分钟自然重试（锁未抢到时当天会被再次尝试）
    console.error('[crisisDividend] 每日分红执行失败：', err instanceof Error ? err.message : err)
    return null
  }
}
