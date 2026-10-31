import { randomUUID } from 'crypto'
import { registerSession, type ChatSession, type ChatSink } from './chatSessions.js'
import { processSessionStanza, teardownSession } from './chatMessaging.js'

/**
 * 自建聊天 HTTP 长轮询会话（/api/chat/xmpp/http-*）
 *
 * 与 WS 完全同构：客户端把 XMPP XML 通过 http-stanza 上行（同样走完整的
 * open / SASL / bind 握手），服务端把出站帧排进队列，http-poll 挂起最多 25 秒
 * 取一帧。会话由登录令牌（JWT）直接绑定，创建时不消耗票据。
 */

/** 单次 poll 挂起时长（前端请求超时 50s，留足余量） */
export const POLL_HANG_MS = 25 * 1000

const sessions = new Map<string, { session: ChatSession; sink: PollingSink }>()

class PollingSink implements ChatSink {
  private queue: string[] = []
  private waiter: ((value: string | null) => void) | null = null
  private invalid = false

  send(xml: string): void {
    if (this.invalid) return
    if (this.waiter) {
      const resolve = this.waiter
      this.waiter = null
      resolve(xml)
      return
    }
    this.queue.push(xml)
    // 防御：客户端断开但未 close 时队列无界增长
    if (this.queue.length > 256) this.queue.shift()
  }

  close(): void {
    this.invalid = true
    const waiter = this.waiter
    this.waiter = null
    if (waiter) waiter(null)
  }

  invalidate(): void {
    this.close()
  }

  /** 取一帧：队列非空立即返回；否则挂起直到有帧 / 会话作废 / 超时 */
  async poll(timeoutMs: number): Promise<string | null> {
    if (this.queue.length > 0) return this.queue.shift() ?? null
    if (this.invalid) return null
    return new Promise<string | null>((resolve) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        this.waiter = null
        resolve(null)
      }, timeoutMs)
      timer.unref?.()
      this.waiter = (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }
    })
  }
}

/** 创建长轮询会话（JWT 鉴权后调用；返回 sessionId） */
export function createPollingSession(userId: number): string {
  const sink = new PollingSink()
  const session: ChatSession = {
    id: randomUUID(),
    userId,
    kind: 'http',
    sink,
    authed: false,
    bound: false,
    resource: '',
    lastActivity: Date.now(),
    closed: false,
  }
  registerSession(session)
  sessions.set(session.id, { session, sink })
  return session.id
}

/** 上行一帧（open / auth / message / iq 均走同一状态机） */
export async function feedStanza(sessionId: string, userId: number, xml: string): Promise<boolean> {
  const entry = sessions.get(sessionId)
  if (!entry || entry.session.userId !== userId || entry.session.closed) return false
  await processSessionStanza(entry.session, xml)
  return true
}

/** 挂起取一帧；会话无效返回 null */
export async function pollStanza(
  sessionId: string,
  userId: number,
): Promise<string | null> {
  const entry = sessions.get(sessionId)
  if (!entry || entry.session.userId !== userId || entry.session.closed) return null
  return entry.sink.poll(POLL_HANG_MS)
}

/** 关闭会话（客户端显式 close 或会话被回收） */
export function closePollingSession(sessionId: string, userId: number): boolean {
  const entry = sessions.get(sessionId)
  if (!entry || entry.session.userId !== userId) return false
  teardownSession(entry.session)
  entry.sink.invalidate()
  sessions.delete(sessionId)
  return true
}
