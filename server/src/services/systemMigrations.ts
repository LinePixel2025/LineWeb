/**
 * 启动时执行的一次性系统迁移（幂等，失败只告警不阻塞启动）。
 *
 * 2026-11-03：全局限额 600 → 8000 次/15min。Prisma 的 @default 只影响新用户，
 * 这里把仍为旧默认值 600 的存量账号回填到 8000；管理员手工调过的其他值不覆盖。
 */

import prisma from '../lib/prisma.js'

const RATE_LIMIT_BACKFILL_KEY = 'system.rateLimit.backfill8000'

export async function runStartupMigrations(): Promise<void> {
  const marker = await prisma.siteSetting.findUnique({ where: { key: RATE_LIMIT_BACKFILL_KEY } })
  if (marker) return
  const updated = await prisma.user.updateMany({
    where: { apiRateLimit: 600 },
    data: { apiRateLimit: 8000 },
  })
  await prisma.siteSetting.upsert({
    where: { key: RATE_LIMIT_BACKFILL_KEY },
    create: { key: RATE_LIMIT_BACKFILL_KEY, value: String(updated.count) },
    update: { value: String(updated.count) },
  })
  if (updated.count > 0) {
    console.log(`[Migration] 已把 ${updated.count} 个账号的 API 限额从 600 回填为 8000 次/15min`)
  }
}
