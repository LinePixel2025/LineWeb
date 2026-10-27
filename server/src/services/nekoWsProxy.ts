import type { Server as HttpServer } from 'http'
import type { IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import { WebSocket, WebSocketServer } from 'ws'
import { config } from '../config/index.js'
import { resolveAuthContext } from '../middleware/auth.js'
import { isAllowedOutboundStanza } from './nekoChatGuard.js'

/**
 * /ws/xmpp —— 浏览器 ↔ neko XMPP 服务的字节级 WebSocket 中继
 *
 * 为什么不直连：neko 只监听公网 8090，内部令牌绝不能下发浏览器；同时需要在
 * 中继层做三件事（不改 neko 一行代码）：
 *   1. 同源鉴权：`?token=<LineWeb 登录令牌>`，令牌无效直接拒绝升级
 *   2. 剥掉 Origin：neko 对「无 Origin」的非浏览器客户端放行，避免跨域限制
 *   3. 单聊好友校验：发往 `lw_<id>@…` 的 chat/normal 消息要求 Prisma 好友关系
 *
 * 注册顺序（index.ts）：initStorageTunnel → initNekoXmppProxy → initChatHub。
 * chatHub 会快照并转发未知路径的 upgrade，所以本代理必须先注册才能拿到 /ws/xmpp。
 */

const DIAL_TIMEOUT_MS = 8000
const MAX_PAYLOAD = 1024 * 1024
const IDLE_TIMEOUT_MS = 120 * 1000

interface SocketState {
  userId: number | null
  lastActivity: number
}

function normalizeCloseCode(code: number): number {
  if (code === 1005 || code === 1006 || code === 1015 || code === 0) return 1000
  return code
}

/** 已完成 101 升级的 socket —— 不能再往里写原始 HTTP 响应，否则会污染 WS 帧流 */
const upgradedSockets = new WeakSet<Duplex>()

function rejectUpgrade(socket: Duplex, status = '502 Bad Gateway'): void {
  if (socket.destroyed || upgradedSockets.has(socket)) return
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

export interface NekoXmppProxy {
  close(): void
}

export function initNekoXmppProxy(server: HttpServer): NekoXmppProxy | null {
  if (!config.nekoChatEnabled) {
    console.log('[xmpp] 聊天服务未配置（NEKO_CHAT_ENABLED / NEKO_CHAT_TOKEN），/ws/xmpp 不启用')
    return null
  }

  const upstreamBase = config.nekoChatInternalUrl.replace(/^http/, 'ws')
  const upstreamUrl = `${upstreamBase}${config.nekoChatWsPath}`
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD })

  const previousUpgradeListeners = server.listeners('upgrade').slice()
  server.removeAllListeners('upgrade')
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = (req.url ?? '').split('?')[0]
    if (pathname !== '/ws/xmpp' && pathname !== '/ws/xmpp/') {
      for (const listener of previousUpgradeListeners) listener.call(server, req, socket, head)
      return
    }
    handleUpgrade(req, socket, head).catch((err) => {
      console.warn('[xmpp] 升级流程异常：', err instanceof Error ? err.message : err)
      rejectUpgrade(socket)
    })
  })

  async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    let url: URL
    try {
      url = new URL(req.url ?? '', 'http://lineweb.local')
    } catch {
      rejectUpgrade(socket, '400 Bad Request')
      return
    }
    const token = url.searchParams.get('token') || ''
    if (!token) {
      rejectUpgrade(socket, '401 Unauthorized')
      return
    }
    const auth = await resolveAuthContext(token)
    if (!auth.ok || auth.user.type === 'download' || auth.user.type === config.oauthAccessTokenType) {
      rejectUpgrade(socket, '401 Unauthorized')
      return
    }
    const userId = auth.user.userId

    // 先拨上游：失败直接 502，避免浏览器拿一个必然断开的本地 WS。
    // 配置写错（如 WS_PATH 被拼成 Windows 路径）时构造函数会同步抛错，必须兜住，
    // 否则浏览器端会拿到 101 却永远收不到任何 stanza。
    let upstream: WebSocket
    try {
      upstream = new WebSocket(upstreamUrl, {
        headers: { 'x-internal-token': config.nekoChatToken },
        maxPayload: MAX_PAYLOAD,
      })
    } catch (err) {
      console.warn('[xmpp] 上游地址无效，拒绝升级：', upstreamUrl, err instanceof Error ? err.message : err)
      rejectUpgrade(socket)
      return
    }
    let upstreamOpen = false
    const dialTimer = setTimeout(() => {
      if (!upstreamOpen) {
        try { upstream.terminate() } catch { /* ignore */ }
        rejectUpgrade(socket)
      }
    }, DIAL_TIMEOUT_MS)
    dialTimer.unref?.()

    upstream.once('error', () => {
      clearTimeout(dialTimer)
      if (!upstreamOpen) rejectUpgrade(socket)
    })
    upstream.once('unexpected-response', () => {
      clearTimeout(dialTimer)
      if (!upstreamOpen) rejectUpgrade(socket)
    })
    upstream.once('open', () => {
      clearTimeout(dialTimer)
      upstreamOpen = true

      wss.handleUpgrade(req, socket, head, (browser) => {
        upgradedSockets.add(socket)
        const state: SocketState = { userId, lastActivity: Date.now() }

        const closeBoth = (code?: number, reason?: Buffer) => {
          const safe = code === undefined ? undefined : normalizeCloseCode(code)
          try {
            if (browser.readyState === WebSocket.OPEN || browser.readyState === WebSocket.CONNECTING) {
              safe === undefined ? browser.close() : browser.close(safe)
            }
          } catch { /* ignore */ }
          try {
            if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
              safe === undefined ? upstream.close() : upstream.close(safe)
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
    })
  }

  console.log(`[xmpp] 聊天中继已启用：/ws/xmpp → ${upstreamUrl}`)
  return {
    close() {
      wss.clients.forEach((client) => {
        try { client.close(1001) } catch { /* ignore */ }
      })
      wss.close()
    },
  }
}
