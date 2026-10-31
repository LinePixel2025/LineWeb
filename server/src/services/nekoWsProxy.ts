import { WebSocket } from 'ws'
import { config } from '../config/index.js'
import { isAllowedOutboundStanza } from './nekoChatGuard.js'

/**
 * neko XMPP 字节级中继（聊天双后端的「XMPP」侧）
 *
 * 自建迁移（2026-10-31）后，/ws/xmpp 由自建网关（chatWsGateway.ts）统一接管升级；
 * 用户在聊天设置里选择了 XMPP 后端时，网关把该连接交给本模块中继到 neko：
 *   - 上游：`nekoChatInternalUrl`（http→ws）+ `nekoChatWsPath`，带 x-internal-token，剥 Origin
 *   - 单聊好友校验：出站 chat/normal 帧走 nekoChatGuard（与轮询 http-stanza 同一份口径）
 *   - 每账号连接跟踪：聊天封禁时断开（closeUserNekoSockets，由 adminChat 调）
 */

const DIAL_TIMEOUT_MS = 8000
const MAX_PAYLOAD = 1024 * 1024
const IDLE_TIMEOUT_MS = 120 * 1000

function normalizeCloseCode(code: number): number {
  if (code === 1005 || code === 1006 || code === 1015 || code === 0) return 1000
  return code
}

/** neko 中继持有的浏览器连接（封禁时主动断开） */
const userSockets = new Map<number, Set<WebSocket>>()

function trackUserSocket(userId: number, socket: WebSocket): void {
  let set = userSockets.get(userId)
  if (!set) {
    set = new Set()
    userSockets.set(userId, set)
  }
  set.add(socket)
}

function untrackUserSocket(userId: number, socket: WebSocket): void {
  const set = userSockets.get(userId)
  if (!set) return
  set.delete(socket)
  if (set.size === 0) userSockets.delete(userId)
}

/** 断开某账号当前所有 neko 中继连接，返回断开数量（封禁时调用） */
export function closeUserNekoSockets(userId: number): number {
  const set = userSockets.get(userId)
  if (!set || set.size === 0) return 0
  userSockets.delete(userId)
  let closed = 0
  for (const socket of set) {
    try {
      socket.close(4003, 'chat banned')
      closed += 1
    } catch { /* ignore */ }
  }
  return closed
}

/**
 * 把一条已完成 HTTP 升级的浏览器 WebSocket 中继到 neko。
 * 调用方（chatWsGateway）已做 JWT / 功能开关 / 封禁校验；这里只负责拨上游与双向转发。
 * neko 未配置时直接关闭连接。
 */
export function attachNekoRelay(userId: number, browser: WebSocket): void {
  if (!config.nekoChatEnabled) {
    try { browser.close(1011, 'xmpp backend not configured') } catch { /* ignore */ }
    return
  }
  const upstreamBase = config.nekoChatInternalUrl.replace(/^http/, 'ws')
  const upstreamUrl = `${upstreamBase}${config.nekoChatWsPath}`

  let upstream: WebSocket
  try {
    upstream = new WebSocket(upstreamUrl, {
      headers: { 'x-internal-token': config.nekoChatToken },
      maxPayload: MAX_PAYLOAD,
    })
  } catch (err) {
    console.warn('[xmpp] 上游地址无效：', upstreamUrl, err instanceof Error ? err.message : err)
    try { browser.close(1011) } catch { /* ignore */ }
    return
  }

  let upstreamOpen = false
  const dialTimer = setTimeout(() => {
    if (!upstreamOpen) {
      try { upstream.terminate() } catch { /* ignore */ }
      try { browser.close(1011) } catch { /* ignore */ }
    }
  }, DIAL_TIMEOUT_MS)
  dialTimer.unref?.()

  const failEarly = () => {
    clearTimeout(dialTimer)
    if (!upstreamOpen) {
      try { browser.close(1011) } catch { /* ignore */ }
    }
  }
  upstream.once('error', failEarly)
  upstream.once('unexpected-response', failEarly)

  upstream.once('open', () => {
    clearTimeout(dialTimer)
    upstreamOpen = true
    trackUserSocket(userId, browser)
    const state = { lastActivity: Date.now() }

    const closeBoth = (code?: number, reason?: Buffer) => {
      const safe = code === undefined ? undefined : normalizeCloseCode(code)
      try {
        if (browser.readyState === WebSocket.OPEN || browser.readyState === WebSocket.CONNECTING) {
          safe === undefined ? browser.close() : browser.close(safe, reason)
        }
      } catch { /* ignore */ }
      try {
        if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
          safe === undefined ? upstream.close() : upstream.close(safe, reason)
        }
      } catch { /* ignore */ }
    }

    browser.on('message', (data: Buffer, isBinary: boolean) => {
      state.lastActivity = Date.now()
      const text = isBinary ? '' : data.toString('utf8')
      if (!isBinary) {
        void isAllowedOutboundStanza(userId, text)
          .then((result) => {
            if (!result.allowed) {
              console.warn(`[xmpp] 拦截非好友单聊：user=${userId} → ${result.peer}`)
              if (browser.readyState === WebSocket.OPEN) {
                browser.send(
                  '<message type="error"><error type="cancel"><not-authorized xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/></error></message>',
                )
              }
              return
            }
            if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: false })
          })
          .catch((err) => {
            console.warn(`[xmpp] 好友校验失败：user=${userId}`, err instanceof Error ? err.message : err)
            if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: false })
          })
        return
      }
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: true })
    })

    upstream.on('message', (data: Buffer, isBinary: boolean) => {
      state.lastActivity = Date.now()
      if (browser.readyState === WebSocket.OPEN) browser.send(data, { binary: isBinary })
    })

    browser.on('close', (code) => {
      untrackUserSocket(userId, browser)
      console.log(`[xmpp] 浏览器连接关闭：user=${userId} code=${code}`)
      closeBoth(code)
    })
    browser.on('error', () => closeBoth(1001))
    upstream.on('close', (code) => {
      console.log(`[xmpp] 上游连接关闭：user=${userId} code=${code}`)
      closeBoth(code)
    })
    upstream.on('error', () => closeBoth(1011))

    // 空闲兜底：客户端每 30 秒发 XMPP ping，正常连接不会触发
    const idleTimer = setInterval(() => {
      if (Date.now() - state.lastActivity > IDLE_TIMEOUT_MS) {
        console.log(`[xmpp] 空闲超时关闭：user=${userId}`)
        closeBoth(1001)
      }
    }, 30_000)
    idleTimer.unref?.()
    browser.on('close', () => clearInterval(idleTimer))
  })
}
