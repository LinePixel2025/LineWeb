import prisma from '../lib/prisma.js'

/**
 * 屏幕时间数据服务
 *
 * 认证已统一为账号登录令牌（见 middleware/auth.ts）：
 * 不再有独立的屏幕时间 Token，第三方设备通过账号登录后使用同一 JWT 推送。
 */

export async function pushScreenTime(userId: number, totalSeconds: number, date: string, reportedAt: Date = new Date()) {
  return prisma.screenTimeLog.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date, totalSeconds, reportedAt },
    update: { totalSeconds, reportedAt },
  })
}

export async function getTodayScreenTime(userId: number, date: string) {
  const log = await prisma.screenTimeLog.findUnique({
    where: { userId_date: { userId, date } },
  })
  if (!log) {
    return { totalSeconds: 0, date, dailyGoalSeconds: null, reportedAt: null, updatedAt: null }
  }
  return {
    totalSeconds: log.totalSeconds,
    dailyGoalSeconds: log.dailyGoalSeconds,
    date: log.date,
    reportedAt: log.reportedAt.toISOString(),
    updatedAt: log.updatedAt.toISOString(),
  }
}

export async function setDailyGoal(userId: number, date: string, goalSeconds: number | null) {
  return prisma.screenTimeLog.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date, totalSeconds: 0, dailyGoalSeconds: goalSeconds, reportedAt: new Date() },
    update: { dailyGoalSeconds: goalSeconds },
  })
}

export async function getDailyGoal(userId: number, date: string) {
  const log = await prisma.screenTimeLog.findUnique({
    where: { userId_date: { userId, date } },
    select: { dailyGoalSeconds: true },
  })
  return { dailyGoalSeconds: log?.dailyGoalSeconds ?? null, date }
}

export async function getScreenTimeRange(userId: number, from: string, to: string) {
  const logs = await prisma.screenTimeLog.findMany({
    where: { userId, date: { gte: from, lte: to } },
    orderBy: { date: 'asc' },
    select: {
      date: true,
      totalSeconds: true,
      dailyGoalSeconds: true,
    },
  })
  return logs
}
