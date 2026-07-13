import crypto from 'crypto'
import prisma from '../lib/prisma.js'

const TOKEN_PREFIX = 'st_'
const TOKEN_BYTES = 32

export function generateScreenTimeToken(): string {
  return TOKEN_PREFIX + crypto.randomBytes(TOKEN_BYTES).toString('hex')
}

export function hashScreenTimeToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function maskToken(token: string): string {
  if (token.length <= 12) return token
  return `${token.slice(0, 6)}...${token.slice(-6)}`
}

export async function createScreenTimeToken(userId: number, name: string, expiresAt?: Date | null) {
  const fullToken = generateScreenTimeToken()
  const tokenHash = hashScreenTimeToken(fullToken)
  const record = await prisma.screenTimeToken.create({
    data: {
      userId,
      token: tokenHash,
      name,
      expiresAt,
    },
    select: {
      id: true,
      name: true,
      expiresAt: true,
      createdAt: true,
    },
  })
  return { ...record, token: fullToken }
}

export async function listScreenTimeTokens(userId: number) {
  const tokens = await prisma.screenTimeToken.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, token: true, name: true, expiresAt: true, createdAt: true },
  })
  return tokens.map(t => ({
    id: t.id,
    name: t.name,
    token: maskToken(t.token),
    expiresAt: t.expiresAt,
    createdAt: t.createdAt,
  }))
}

export async function deleteScreenTimeToken(userId: number, tokenId: number) {
  await prisma.screenTimeToken.deleteMany({
    where: { id: tokenId, userId },
  })
}

export async function verifyScreenTimeToken(token: string) {
  if (!token.startsWith(TOKEN_PREFIX)) return null
  const tokenHash = hashScreenTimeToken(token)
  const record = await prisma.screenTimeToken.findUnique({
    where: { token: tokenHash },
  })
  if (!record) return null
  if (record.expiresAt && record.expiresAt < new Date()) return null
  return record
}

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
    return { totalSeconds: 0, date, reportedAt: null, updatedAt: null }
  }
  return {
    totalSeconds: log.totalSeconds,
    date: log.date,
    reportedAt: log.reportedAt.toISOString(),
    updatedAt: log.updatedAt.toISOString(),
  }
}
