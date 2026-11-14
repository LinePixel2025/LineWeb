/**
 * 网页反代 — WebSocket over HTTP 桥（无 WS / WS 被阻断设备的降级通道）
 *
 * 老旧 WebView 或某些网络环境没有 WebSocket（或升级被中间设备掐断）。
 * 这里用「长轮询 + 上行 POST」把上游 WS 会话桥接成纯 HTTP，引导脚本里的
 * LWWebSocket polyfill 据此实现标准 WebSocket API，站点代码无感知。
 *
 * 设计与 services/chatPolling.ts 同构：会话绑定 userId + siteId，出站帧排进
 * 队列，poll 挂起最多 25 秒取一批帧。安全边界与 WS 中继完全一致：
 * lw_proxy Cookie 鉴权 + 功能开关 + 站点归属 + 档案/family 白名单 + 逐跳
 * assertPublicHost（含黑名单）+ 复用 proxyQueue 的 WS 名额闸门。
 *
 * 帧队列 FrameQueue 是纯函数式对象（不依赖 ws / 网络），便于自检脚本断言。
 */

import { Router, type Request, type Response } from 'express'
import { randomUUID } from 'crypto'
import { WebSocket } from 'ws'
import prisma from '../lib/prisma.js'
import { resolveProxySessionInfo } from './proxySession.js'
import { isFeatureEnabled } from './featureService.js'
import { acquireProxyWsSlot } from './proxyQueue.js'
import { cookieHeaderForUrl, readCookieJar } from './proxyCookies.js'
import { resolveProxyWsTarget } from './webProxyWs.js'
import { recordProxyRequest } from './proxyStats.js'

/** 单次 poll 挂起时长（与聊天长轮询一致） */
export const POLL_HANG_MS = 25 * 1000
const DIAL_TIMEOUT_MS = 10_000
const IDLE_TIMEOUT_MS = 90 * 1000
const MAX_PAYLOAD = 16 * 1024 * 1024
const MAX_SESSIONS_PER_USER = 8
const MAX_SESSIONS_ADMIN = 32
/** 单批 poll 最多返回的帧数 / 字节数 */
const POLL_BATCH_FRAMES = 64

export interface BridgeFrame {
  /** base64 编码的帧数据（文本帧也按 base64 传输，客户端按 binary 标志解码） */
  data: string
  binary: boolean
}

/**
 * 出站帧队列（纯逻辑）：push 入队 / poll 挂起取批 / close 作废。
 * 超过帧数或字节上限时以 1011 关闭，防止客户端不取帧导致内存膨胀。
 */
export class FrameQueue {
  private queue: BridgeFrame[] = []
  private bytes = 0
  private waiter: ((value: BridgeFrame[] | null) => void) | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private invalid = false
  closed = false
  closeCode: number | undefined
  closeReason: string | undefined

  constructor(private maxFrames = 512, private maxBytes = 8 * 1024 * 1024) {}

  private takeBatch(): BridgeFrame[] {
    const frames = this.queue.splice(0, POLL_BATCH_FRAMES)
    for (const frame of frames) this.bytes -= frame.data.length
    if (this.bytes < 0) this.bytes = 0
    return frames
  }

  push(frame: BridgeFrame): boolean {
    if (this.invalid) return false
    this.queue.push(frame)
    this.bytes += frame.data.length
    if (this.queue.length > this.maxFrames || this.bytes > this.maxBytes) {
      this.close(1011, 'frame queue overflow')
      return false
    }
    if (this.waiter && this.queue.length > 0) {
      const resolve = this.waiter
      this.waiter = null
      this.clearTimer()
      resolve(this.takeBatch())
    }
    return true
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** 取一批帧：队列非空立即返回；否则挂起直到有帧 / 作废 / 超时（超时返回空批） */
  async poll(timeoutMs: number): Promise<BridgeFrame[] | null> {
    if (this.queue.length > 0) return this.takeBatch()
    if (this.invalid) return null
    return new Promise<BridgeFrame[] | null>((resolve) => {
      let settled = false
      this.timer = setTimeout(() => {
        if (settled) return
        settled = true
        this.waiter = null
        this.timer = null
        resolve([])
      }, timeoutMs)
      this.timer.unref?.()
      this.waiter = (value) => {
        if (settled) return
        settled = true
        this.clearTimer()
        resolve(value)
      }
    })
  }

  /** 客户端断开时提前结束挂起（不关闭会话，客户端可重新 poll） */
  cancelPoll(): void {
    if (this.waiter) {
      const resolve = this.waiter
      this.waiter = null
      this.clearTimer()
      resolve([])
    }
  }

  close(code?: number, reason?: string): void {
    if (this.invalid) return
    this.invalid = true
    this.closed = true
    this.closeCode = code
    this.closeReason = reason
    const waiter = this.waiter
    this.waiter = null
    this.clearTimer()
    if (waiter) {
      const frames = this.takeBatch()
      waiter(frames.length > 0 ? frames : null)
    }
  }
}

interface BridgeSession {
  id: string
  userId: number
  siteId: number
  upstream: WebSocket
  queue: FrameQueue
  protocol: string
  lastActivity: number
  releaseSlot: () => void
  slotReleased: boolean
}

const sessions = new Map<string, BridgeSession>()

function normalizeCloseCode(code: number): number {
  if (code === 1005 || code === 1006 || code === 1015 || code === 0) return 1000
  return code
}

function countUserSessions(userId: number): number {
  let count = 0
  for (const session of sessions.values()) if (session.userId === userId) count += 1
  return count
}

function releaseOnce(session: BridgeSession): void {
  if (session.slotReleased) return
  session.slotReleased = true
  session.releaseSlot()
}

function teardown(session: BridgeSession): void {
  releaseOnce(session)
  sessions.delete(session.id)
  try {
    if (session.upstream.readyState === WebSocket.OPEN || session.upstream.readyState === WebSocket.CONNECTING) {
      session.upstream.close()
    }
  } catch {
    /* ignore */
  }
}

function readBody(req: Request, limit: number): Promise<{ body: Buffer | null; tooLarge: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let tooLarge = false
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return
      total += chunk.length
      if (total > limit) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve({ body: tooLarge ? null : (chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0)), tooLarge }))
    req.on('error', reject)
  })
}

function parseSubProtocols(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && !!item).slice(0, 8)
}

/** 鉴权 + 站点归属（open/send/poll/close 共用）；失败时已发送响应，返回 null */
async function authorize(req: Request, res: Response): Promise<{ userId: number; role: string; siteId: number; site: { id: number; origin: string; cookies: string } } | null> {
  const session = await resolveProxySessionInfo(req.headers)
  if (!session) {
    res.status(401).json({ error: '反代会话已失效' })
    return null
  }
  if (!(await isFeatureEnabled('webProxy', session.role))) {
    res.status(403).json({ error: '网页反代功能当前已关闭' })
    return null
  }
  const siteId = Number.parseInt(req.params.siteId, 10)
  if (!Number.isFinite(siteId)) {
    res.status(400).json({ error: '站点编号无效' })
    return null
  }
  const site = await prisma.proxySite.findFirst({ where: { id: siteId, userId: session.userId } })
  if (!site) {
    res.status(404).json({ error: '站点不存在' })
    return null
  }
  return { userId: session.userId, role: session.role, siteId, site }
}

function getSession(req: Request, res: Response, userId: number, siteId: number): BridgeSession | null {
  const session = sessions.get(req.params.session)
  if (!session || session.userId !== userId || session.siteId !== siteId) {
    res.status(404).json({ error: '会话不存在或已关闭' })
    return null
  }
  return session
}

export const webProxyWsHttpRouter = Router()

/** 建立桥接会话：拨号上游 WS，返回 sessionId */
webProxyWsHttpRouter.post('/:siteId/open', async (req, res) => {
  const auth = await authorize(req, res)
  if (!auth) return
  const { userId, role, siteId, site } = auth

  const { body, tooLarge } = await readBody(req, 64 * 1024)
  if (tooLarge || !body) {
    res.status(413).json({ error: '请求体过大' })
    return
  }
  let payload: { path?: unknown; protocols?: unknown }
  try {
    payload = JSON.parse(body.toString('utf8'))
  } catch {
    res.status(400).json({ error: '请求体不是合法 JSON' })
    return
  }
  const rawPath = typeof payload.path === 'string' ? payload.path : ''
  const match = /^\/proxy-ws\/(\d+)(\/.*)?$/.exec(rawPath.split('?')[0])
  if (!match || Number.parseInt(match[1], 10) !== siteId) {
    res.status(400).json({ error: 'WS 路径无效' })
    return
  }
  const rest = match[2] || '/'
  const search = rawPath.includes('?') ? `?${rawPath.split('?').slice(1).join('?')}` : ''
  const resolved = await resolveProxyWsTarget(site, rest, search)
  if (!resolved) {
    res.status(400).json({ error: '上游地址无效或被拒绝' })
    return
  }

  const cap = role === 'admin' ? MAX_SESSIONS_ADMIN : MAX_SESSIONS_PER_USER
  if (countUserSessions(userId) >= cap) {
    res.status(429).json({ error: '桥接会话数已达上限' })
    return
  }
  const releaseSlot = acquireProxyWsSlot({ bypass: role === 'admin' })
  if (!releaseSlot) {
    res.status(503).json({ error: '反代 WebSocket 连接数已达上限' })
    return
  }

  const jar = readCookieJar(site.cookies)
  const cookie = cookieHeaderForUrl(jar, resolved.url)
  const protocols = parseSubProtocols(payload.protocols)
  const headers: Record<string, string> = {
    ...(cookie ? { cookie } : {}),
    origin: resolved.baseOrigin,
    ...(typeof req.headers['user-agent'] === 'string' ? { 'user-agent': req.headers['user-agent'] } : {}),
  }

  let upstream: WebSocket
  try {
    upstream = protocols.length > 0
      ? new WebSocket(resolved.url, protocols, { headers, handshakeTimeout: DIAL_TIMEOUT_MS, perMessageDeflate: false, maxPayload: MAX_PAYLOAD })
      : new WebSocket(resolved.url, { headers, handshakeTimeout: DIAL_TIMEOUT_MS, perMessageDeflate: false, maxPayload: MAX_PAYLOAD })
  } catch {
    releaseSlot()
    res.status(502).json({ error: '上游地址无效' })
    return
  }

  // 等待上游 open（超时 / 错误 → 释放名额并 502，站点自身的降级逻辑接管）
  const opened = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      try { upstream.terminate() } catch { /* ignore */ }
      resolve(false)
    }, DIAL_TIMEOUT_MS + 1000)
    timer.unref?.()
    upstream.once('open', () => {
      clearTimeout(timer)
      resolve(true)
    })
    upstream.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
    upstream.once('unexpected-response', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
  if (!opened) {
    releaseSlot()
    recordProxyRequest({ siteId, userId, statusCode: 502 })
    res.status(502).json({ error: '无法连接上游 WebSocket' })
    return
  }

  const id = randomUUID()
  const queue = new FrameQueue()
  const bridge: BridgeSession = {
    id,
    userId,
    siteId,
    upstream,
    queue,
    protocol: upstream.protocol || '',
    lastActivity: Date.now(),
    releaseSlot,
    slotReleased: false,
  }
  sessions.set(id, bridge)

  upstream.on('message', (data: Buffer, isBinary: boolean) => {
    bridge.lastActivity = Date.now()
    queue.push({ data: data.toString('base64'), binary: isBinary })
  })
  upstream.on('close', (code, reason) => {
    queue.close(normalizeCloseCode(code), reason.toString())
    releaseOnce(bridge)
    sessions.delete(id)
  })
  upstream.on('error', () => {
    queue.close(1011, 'upstream error')
    teardown(bridge)
  })

  recordProxyRequest({ siteId, userId, statusCode: 200 })
  res.json({ session: id, protocol: bridge.protocol })
})

/** 上行一帧（原始字节，binary 由 content-type 区分） */
webProxyWsHttpRouter.post('/:siteId/:session/send', async (req, res) => {
  const auth = await authorize(req, res)
  if (!auth) return
  const bridge = getSession(req, res, auth.userId, auth.siteId)
  if (!bridge) return
  const { body, tooLarge } = await readBody(req, MAX_PAYLOAD)
  if (tooLarge || !body) {
    res.status(413).json({ error: '帧过大' })
    return
  }
  if (bridge.upstream.readyState !== WebSocket.OPEN) {
    res.status(409).json({ error: '上游连接已关闭' })
    return
  }
  const binary = (req.headers['content-type'] || '').includes('application/octet-stream')
  bridge.lastActivity = Date.now()
  try {
    bridge.upstream.send(body, { binary })
  } catch {
    res.status(502).json({ error: '上游发送失败' })
    return
  }
  res.json({ ok: true })
})

/** 长轮询取一批出站帧 */
webProxyWsHttpRouter.get('/:siteId/:session/poll', async (req, res) => {
  const auth = await authorize(req, res)
  if (!auth) return
  const bridge = getSession(req, res, auth.userId, auth.siteId)
  if (!bridge) return
  bridge.lastActivity = Date.now()
  // 客户端断开时提前结束挂起（会话保留，可重新 poll）
  res.once('close', () => bridge.queue.cancelPoll())
  const frames = await bridge.queue.poll(POLL_HANG_MS)
  if (res.writableEnded) return
  res.json({
    frames: frames ?? [],
    closed: bridge.queue.closed,
    code: bridge.queue.closeCode,
    reason: bridge.queue.closeReason,
  })
})

/** 关闭桥接会话 */
webProxyWsHttpRouter.post('/:siteId/:session/close', async (req, res) => {
  const auth = await authorize(req, res)
  if (!auth) return
  const bridge = getSession(req, res, auth.userId, auth.siteId)
  if (!bridge) return
  const { body } = await readBody(req, 4 * 1024)
  let code: number | undefined
  let reason: string | undefined
  if (body && body.length > 0) {
    try {
      const parsed = JSON.parse(body.toString('utf8'))
      if (typeof parsed.code === 'number') code = parsed.code
      if (typeof parsed.reason === 'string') reason = parsed.reason
    } catch {
      /* ignore */
    }
  }
  bridge.queue.close(code, reason)
  teardown(bridge)
  res.json({ ok: true })
})

/** 空闲会话回收（客户端崩溃 / 断网未 close 时兜底） */
const sweeper = setInterval(() => {
  const now = Date.now()
  for (const session of sessions.values()) {
    if (now - session.lastActivity > IDLE_TIMEOUT_MS) {
      session.queue.close(1001, 'idle timeout')
      teardown(session)
    }
  }
}, 15_000)
sweeper.unref?.()

/** 测试 / 运维：当前桥接会话数 */
export function bridgeSessionCount(): number {
  return sessions.size
}
