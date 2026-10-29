/**
 * 聊天治理：封禁 / 解封记录与 30 秒内存缓存。
 *
 * 口径：LineWeb 不解析 neko 的 XMPP 字节流，封禁的含义是「禁止使用聊天入口」——
 * 所有 /api/chat* 与 /ws/xmpp 握手都会被拒绝；已建立的 WS 连接在封禁时主动断开。
 * 管理员永远不受封禁影响（与功能开关一致）。
 */

import prisma from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'

export interface ChatBanState {
  reason: string
  bannedBy: number | null
  createdAt: string
}

export interface ChatBanRow extends ChatBanState {
  userId: number
  username: string
  active: boolean
  liftedAt: string | null
}

const CACHE_MS = 30_000
const cache = new Map<number, { at: number; ban: ChatBanState | null }>()

function toState(row: {
  reason: string
  bannedBy: number | null
  createdAt: Date
}): ChatBanState {
  return { reason: row.reason, bannedBy: row.bannedBy, createdAt: row.createdAt.toISOString() }
}

/** 查询某账号当前是否被禁止使用聊天（带 30 秒缓存；活动封禁才生效） */
export async function getActiveChatBan(userId: number): Promise<ChatBanState | null> {
  const hit = cache.get(userId)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ban
  const row = await prisma.chatBan.findUnique({ where: { userId } })
  const ban = row && row.active ? toState(row) : null
  cache.set(userId, { at: Date.now(), ban })
  return ban
}

/** 封禁 / 解封后立刻生效 */
export function invalidateChatBanCache(userId: number): void {
  cache.delete(userId)
}

export function clearChatBanCache(): void {
  cache.clear()
}

/** 封禁列表（含已解封记录，默认只看生效中的） */
export async function listChatBans(options: { includeLifted?: boolean } = {}): Promise<ChatBanRow[]> {
  const rows = await prisma.chatBan.findMany({
    where: options.includeLifted ? {} : { active: true },
    orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
    take: 200,
    include: { user: { select: { username: true } } },
  })
  return rows.map((row) => ({
    userId: row.userId,
    username: row.user?.username ?? `#${row.userId}`,
    reason: row.reason,
    bannedBy: row.bannedBy,
    createdAt: row.createdAt.toISOString(),
    active: row.active,
    liftedAt: row.liftedAt ? row.liftedAt.toISOString() : null,
  }))
}

/**
 * 禁止某账号使用聊天；已是生效中则更新原因（幂等）。
 * 返回是否为新封禁（用于提示「已断开 N 条连接」）。
 */
export async function banChatUser(params: {
  userId: number
  reason: string
  bannedBy: number
}): Promise<{ created: boolean; ban: ChatBanRow }> {
  const { userId, reason, bannedBy } = params
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, role: true },
  })
  if (!target) throw new AppError('用户不存在', 404)
  if (target.role === 'admin') throw new AppError('不能封禁管理员账号', 400)

  const existing = await prisma.chatBan.findUnique({ where: { userId } })
  const created = !existing || !existing.active
  const row = await prisma.chatBan.upsert({
    where: { userId },
    create: { userId, reason, bannedBy, active: true },
    update: { reason, bannedBy, active: true, liftedAt: null },
  })
  invalidateChatBanCache(userId)

  return {
    created,
    ban: {
      userId,
      username: target.username,
      reason: row.reason,
      bannedBy: row.bannedBy,
      createdAt: row.createdAt.toISOString(),
      active: true,
      liftedAt: null,
    },
  }
}

/** 解封；没有封禁记录时视为已解封（幂等） */
export async function liftChatBan(userId: number): Promise<{ lifted: boolean }> {
  const existing = await prisma.chatBan.findUnique({ where: { userId } })
  if (!existing || !existing.active) {
    invalidateChatBanCache(userId)
    return { lifted: false }
  }
  await prisma.chatBan.update({
    where: { userId },
    data: { active: false, liftedAt: new Date() },
  })
  invalidateChatBanCache(userId)
  return { lifted: true }
}
