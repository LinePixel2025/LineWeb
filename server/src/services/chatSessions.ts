import crypto from 'crypto'
import prisma from '../lib/prisma.js'
import { directJidOf, toNekoUsername } from '../lib/chatIdentity.js'
import { elementOf, serialize } from '../lib/stanzaXml.js'

/**
 * 自建聊天会话注册表（/ws/xmpp 与 HTTP 长轮询共用）
 *
 *   - Sink：出站写入抽象（WS 直接 send，长轮询写队列并唤醒挂起的 poll）
 *   - ChatSession：一条聊天连接（含 XMPP 流握手状态），注册进 registry 后才能收发
 *   - 票据：SASL PLAIN 用的一次性凭据（bootstrap/ticket 下发，内存 TTL 120 秒）
 *   - presence：首个绑定会话上线 / 末个会话下线时向好友与同群成员广播
 */

export interface ChatSink {
  /** 发送一帧 XML 文本（发送失败自行吞掉） */
  send(xml: string): void
  /** 关闭底层连接（长轮询会话=作废队列） */
  close(code?: number, reason?: string): void
}

export interface ChatSession {
  id: string
  userId: number
  kind: 'ws' | 'http'
  sink: ChatSink
  /** XMPP 流状态：auth 已通过 / bind 已完成 */
  authed: boolean
  bound: boolean
  resource: string
  lastActivity: number
  closed: boolean
}

const sessionsById = new Map<string, ChatSession>()
const sessionsByUser = new Map<number, Set<string>>()

const SESSION_MAX_PER_USER = 16

export function registerSession(session: ChatSession): void {
  sessionsById.set(session.id, session)
  let set = sessionsByUser.get(session.userId)
  if (!set) {
    set = new Set()
    sessionsByUser.set(session.userId, set)
  }
  set.add(session.id)
  // 防御：同一账号挂起过多会话（>16）时回收最旧的，避免泄漏
  if (set.size > SESSION_MAX_PER_USER) {
    const oldest = set.values().next().value
    if (oldest && oldest !== session.id) {
      const stale = sessionsById.get(oldest)
      if (stale) {
        removeSession(stale)
        try {
          stale.sink.close(4000, 'too many sessions')
        } catch { /* ignore */ }
      }
    }
  }
}

export function removeSession(session: ChatSession): void {
  if (session.closed) return
  session.closed = true
  sessionsById.delete(session.id)
  const set = sessionsByUser.get(session.userId)
  if (set) {
    set.delete(session.id)
    if (set.size === 0) sessionsByUser.delete(session.userId)
  }
}

export function getSession(sessionId: string): ChatSession | null {
  return sessionsById.get(sessionId) ?? null
}

/** 该用户当前所有会话（含未完成握手的） */
export function sessionsOf(userId: number): ChatSession[] {
  const ids = sessionsByUser.get(userId)
  if (!ids) return []
  const result: ChatSession[] = []
  for (const id of ids) {
    const session = sessionsById.get(id)
    if (session) result.push(session)
  }
  return result
}

/** 是否有已完成绑定的聊天会话（聊天页在线判定） */
export function isUserChatOnline(userId: number): boolean {
  return sessionsOf(userId).some((session) => session.bound)
}

/** 给单个用户的所有会话投递一帧 */
export function sendToUserSessions(userId: number, xml: string): void {
  for (const session of sessionsOf(userId)) {
    try {
      session.sink.send(xml)
    } catch { /* ignore */ }
  }
}

/** 给多个用户的所有会话投递同一帧（自动去重，序列化一次） */
export function sendToUsersSessions(userIds: Iterable<number>, xml: string): void {
  const payload = xml
  for (const userId of new Set(userIds)) sendToUserSessions(userId, payload)
}

/** 断开某账号当前所有聊天会话（封禁时调用），返回断开数量 */
export function closeUserSessions(userId: number, code = 4003, reason = 'chat banned'): number {
  const list = sessionsOf(userId)
  let closed = 0
  for (const session of list) {
    removeSession(session)
    try {
      session.sink.close(code, reason)
      closed += 1
    } catch { /* ignore */ }
  }
  return closed
}

/** 调试用：当前在线（已绑定）用户 id 列表 */
export function onlineChatUserIds(): number[] {
  const result: number[] = []
  for (const [userId, ids] of sessionsByUser) {
    for (const id of ids) {
      const session = sessionsById.get(id)
      if (session?.bound) {
        result.push(userId)
        break
      }
    }
  }
  return result
}

// === 一次性 SASL 票据 ===

const TICKET_TTL_MS = 120 * 1000
const tickets = new Map<string, { userId: number; expiresAt: number }>()

export function issueChatTicket(userId: number): string {
  // 顺带清理过期票据，避免长期运行下无界增长
  const now = Date.now()
  if (tickets.size > 0) {
    for (const [key, value] of tickets) {
      if (value.expiresAt <= now) tickets.delete(key)
    }
  }
  const ticket = crypto.randomBytes(24).toString('hex')
  tickets.set(ticket, { userId, expiresAt: now + TICKET_TTL_MS })
  return ticket
}

/** 校验并消费一次性票据（票据必须对应该用户且未过期） */
export function consumeChatTicket(ticket: string, userId: number): boolean {
  const entry = tickets.get(String(ticket || ''))
  if (!entry) return false
  tickets.delete(String(ticket || ''))
  return entry.userId === userId && entry.expiresAt > Date.now()
}

// === presence 广播 ===

function presenceXml(userId: number, online: boolean): string {
  return serialize(
    elementOf('presence', { from: directJidOf(userId), ...(online ? {} : { type: 'unavailable' }) }),
  )
}

/** 该用户的好友 ∪ 同群成员（广播 presence 的收件人） */
async function presenceAudience(userId: number): Promise<number[]> {
  const [friends, coMembers] = await Promise.all([
    prisma.friendship.findMany({ where: { userId }, select: { friendId: true } }),
    prisma.conversationMember.findMany({
      where: { conversation: { members: { some: { userId } } }, userId: { not: userId } },
      select: { userId: true },
      distinct: ['userId'],
    }),
  ])
  const ids = new Set<number>()
  for (const row of friends) ids.add(row.friendId)
  for (const row of coMembers) ids.add(row.userId)
  return [...ids]
}

/**
 * 广播上线 / 下线。绑定首个会话与关闭末个会话时调用（由 chatMessaging 状态机驱动）。
 * 只投递给当前有会话的联系人，查询量 = 好友 + 同群成员一次。
 */
export async function broadcastPresence(userId: number, online: boolean): Promise<void> {
  try {
    const audience = await presenceAudience(userId)
    if (audience.length === 0) return
    const onlineIds = audience.filter((id) => isUserChatOnline(id))
    if (onlineIds.length === 0) return
    sendToUsersSessions(onlineIds, presenceXml(userId, online))
  } catch (err) {
    console.warn('[chatSessions] presence 广播失败:', err instanceof Error ? err.message : err)
  }
}

/** 未读口径外的兜底：把用户名拼回 JID（日志用） */
export function describeSession(session: ChatSession): string {
  return `${toNekoUsername(session.userId)}#${session.kind}/${session.id.slice(0, 6)}${session.bound ? '+bind' : ''}`
}
