import type { Server as HttpServer, IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import { WebSocket, WebSocketServer } from 'ws'
import prisma from '../lib/prisma.js'
import { assertPublicHost } from './webProxyService.js'
import { cookieHeaderForUrl, readCookieJar } from './proxyCookies.js'
import { acquireProxyWsSlot } from './proxyQueue.js'
import { resolveProxySessionInfo } from './proxySession.js'
import { isFeatureEnabled } from './featureService.js'

/**
 * /proxy-ws/<siteId>/* —— 反代站点的 WebSocket 中继
 *
 * 页面里的 WebSocket 构造函数（bootstrap 注入）把「与目标站同主机」的 ws(s) URL
 * 改写成 `/proxy-ws/<siteId>/...`，这样上游需要的 Cookie 由服务端罐补上。
 * 外部主机的 WebSocket 不做改写，浏览器直连即可。
 *
 * 上游连不上时直接拒绝升级：站点自己的轮询降级逻辑会接管（"没有 WS 就降级"）。
 *
 * 注册顺序：initStorageTunnel → initNekoXmppProxy → initWebProxyWs → initChatHub。
 * chatHub 会快照并转发未知路径的 upgrade，所以本代理必须先注册才能拿到 /proxy-ws。
 */

const DIAL_TIMEOUT_MS = 10_000
const IDLE_TIMEOUT_MS = 10 * 60 * 1000
const MAX_PAYLOAD = 16 * 1024 * 1024

const upgradedSockets = new WeakSet<Duplex>()

function normalizeCloseCode(code: number): number {
  if (code === 1005 || code === 1006 || code === 1015 || code === 0) return 1000
  return code
}

function rejectUpgrade(socket: Duplex, status = '502 Bad Gateway'): void {
  if (socket.destroyed || upgradedSockets.has(socket)) return
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

function parseSubProtocols(req: IncomingMessage): string[] {
  const raw = req.headers['sec-websocket-protocol']
  if (typeof raw !== 'string') return []
  return raw.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 8)
}

export interface WebProxyWsHandle {
  close(): void
}

export function initWebProxyWs(server: HttpServer): WebProxyWsHandle {
  const previousUpgradeListeners = server.listeners('upgrade').slice()
  server.removeAllListeners('upgrade')
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = (req.url ?? '').split('?')[0]
    if (!pathname.startsWith('/proxy-ws/')) {
      for (const listener of previousUpgradeListeners) listener.call(server, req, socket, head)
      return
    }
    void handleUpgrade(req, socket, head).catch((err) => {
      console.warn('[proxy-ws] 升级流程异常：', err instanceof Error ? err.message : err)
      rejectUpgrade(socket)
    })
  })

  async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const match = /^\/proxy-ws\/(\d+)(\/.*)?$/.exec((req.url ?? '').split('?')[0])
    if (!match) {
      rejectUpgrade(socket, '400 Bad Request')
      return
    }
    const siteId = Number.parseInt(match[1], 10)
    const session = await resolveProxySessionInfo(req.headers)
    if (!session) {
      rejectUpgrade(socket, '401 Unauthorized')
      return
    }
    if (!(await isFeatureEnabled('webProxy', session.role))) {
      rejectUpgrade(socket, '403 Forbidden')
      return
    }
    const userId = session.userId
    const site = await prisma.proxySite.findFirst({ where: { id: siteId, userId } })
    if (!site) {
      rejectUpgrade(socket, '404 Not Found')
      return
    }

    // 连接数闸门：管理员不占名额；超出上限直接拒绝升级（页面会降级为轮询）
    const releaseWsSlot = acquireProxyWsSlot({ bypass: session.role === 'admin' })
    if (!releaseWsSlot) {
      console.warn(`[proxy-ws] 连接数已达上限：site=${siteId} user=${userId}`)
      rejectUpgrade(socket, '503 Service Unavailable')
      return
    }
    let wsSlotReleased = false
    const releaseWsSlotOnce = () => {
      if (wsSlotReleased) return
      wsSlotReleased = true
      releaseWsSlot()
    }

    const rest = match[2] || '/'
    const search = (req.url ?? '').includes('?') ? `?${(req.url ?? '').split('?').slice(1).join('?')}` : ''
    let upstreamUrl: URL
    try {
      upstreamUrl = new URL(`${site.origin}${rest}${search}`)
      upstreamUrl.protocol = upstreamUrl.protocol === 'https:' ? 'wss:' : 'ws:'
      await assertPublicHost(upstreamUrl.hostname)
    } catch {
      rejectUpgrade(socket, '400 Bad Request')
      return
    }

    const jar = readCookieJar(site.cookies)
    const cookie = cookieHeaderForUrl(jar, new URL(site.origin))
    const protocols = parseSubProtocols(req)

    let upstream: WebSocket
    try {
      upstream = protocols.length > 0
        ? new WebSocket(upstreamUrl, protocols, {
          headers: {
            ...(cookie ? { cookie } : {}),
            origin: site.origin,
            ...(typeof req.headers['user-agent'] === 'string' ? { 'user-agent': req.headers['user-agent'] } : {}),
          },
          handshakeTimeout: DIAL_TIMEOUT_MS,
          perMessageDeflate: false,
          maxPayload: MAX_PAYLOAD,
        })
        : new WebSocket(upstreamUrl, {
          headers: {
            ...(cookie ? { cookie } : {}),
            origin: site.origin,
            ...(typeof req.headers['user-agent'] === 'string' ? { 'user-agent': req.headers['user-agent'] } : {}),
          },
          handshakeTimeout: DIAL_TIMEOUT_MS,
          perMessageDeflate: false,
          maxPayload: MAX_PAYLOAD,
        })
    } catch (err) {
      console.warn('[proxy-ws] 上游地址无效：', err instanceof Error ? err.message : err)
      releaseWsSlotOnce()
      rejectUpgrade(socket)
      return
    }

    let upstreamOpen = false
    const dialTimer = setTimeout(() => {
      if (!upstreamOpen) {
        try { upstream.terminate() } catch { /* ignore */ }
        releaseWsSlotOnce()
        rejectUpgrade(socket)
      }
    }, DIAL_TIMEOUT_MS + 1000)
    dialTimer.unref?.()

    upstream.once('error', () => {
      clearTimeout(dialTimer)
      if (!upstreamOpen) {
        releaseWsSlotOnce()
        rejectUpgrade(socket)
      }
    })
    upstream.once('unexpected-response', () => {
      clearTimeout(dialTimer)
      if (!upstreamOpen) {
        releaseWsSlotOnce()
        rejectUpgrade(socket)
      }
    })
    upstream.once('open', () => {
      clearTimeout(dialTimer)
      upstreamOpen = true

      // 每个连接单独建 server：把上游实际协商的 subprotocol 原样回给浏览器
      const wss = new WebSocketServer({
        noServer: true,
        maxPayload: MAX_PAYLOAD,
        perMessageDeflate: false,
        handleProtocols: () => upstream.protocol || false,
      })
      wss.handleUpgrade(req, socket, head, (browser) => {
        upgradedSockets.add(socket)
        let lastActivity = Date.now()

        const closeBoth = (code?: number, reason?: string) => {
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
          lastActivity = Date.now()
          if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary })
        })
        upstream.on('message', (data: Buffer, isBinary: boolean) => {
          lastActivity = Date.now()
          if (browser.readyState === WebSocket.OPEN) browser.send(data, { binary: isBinary })
        })

        browser.on('close', (code, reason) => {
          releaseWsSlotOnce()
          closeBoth(code, reason.toString())
        })
        browser.on('error', () => closeBoth(1001))
        upstream.on('close', (code, reason) => {
          closeBoth(code, reason.toString())
        })
        upstream.on('error', () => closeBoth(1011))

        const idleTimer = setInterval(() => {
          if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
            console.log(`[proxy-ws] 空闲超时关闭：site=${siteId} user=${userId}`)
            closeBoth(1001)
          }
        }, 30_000)
        idleTimer.unref?.()
        browser.on('close', () => clearInterval(idleTimer))
      })
    })
  }

  console.log('✦ Web proxy WebSocket relay listening at /proxy-ws/:siteId')
  return {
    close() {
      // 单连接的清理由 close 事件负责；这里只阻止新的升级
      server.removeAllListeners('upgrade')
    },
  }
}
