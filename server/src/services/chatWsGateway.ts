import type { Server as HttpServer } from 'http'
import type { IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import { WebSocket, WebSocketServer } from 'ws'
import { config } from '../config/index.js'
import { resolveAuthContext } from '../middleware/auth.js'
import { isFeatureEnabled } from './featureService.js'
import { getActiveChatBan } from './chatBanService.js'
import { randomUUID } from 'crypto'
import {
  closeUserSessions,
  registerSession,
  type ChatSession,
} from './chatSessions.js'
import { processSessionStanza, teardownSession } from './chatMessaging.js'
import { chatBackendOf } from '../routes/chatXmpp.js'
import { attachNekoRelay, closeUserNekoSockets } from './nekoWsProxy.js'

/**
 * 自建聊天 WebSocket 网关（/ws/xmpp）
 *
 * 取代原 nekoWsProxy 字节级中继：浏览器仍说 RFC 7395 XMPP（SASL PLAIN / bind 在
 * 浏览器侧完成），但 stanza 由本服务解析并落地 Prisma（见 chatMessaging.ts）。
 *
 * 鉴权链（与原中继一致）：
 *   1. `?token=<LineWeb 登录令牌>`，无效 / 下载票据 / 应用令牌 → 拒绝升级
 *   2. chat 功能开关关闭 → 403
 *   3. 非管理员有 active ChatBan → 403（握手期拦截；存量连接由 adminChat 主动断开）
 *   4. SASL PLAIN 校验一次性票据（chatSessions.issueChatTicket）
 *
 * 注册顺序（index.ts）：initStorageTunnel → initChatWsGateway → initWebProxyWs → initChatHub。
 */

const MAX_PAYLOAD = 1024 * 1024
const IDLE_TIMEOUT_MS = 120 * 1000

function rejectUpgrade(socket: Duplex, status = '502 Bad Gateway'): void {
  if (socket.destroyed) return
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

export function initChatWsGateway(server: HttpServer): WebSocketServer {
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
      console.warn('[chatWs] 升级流程异常：', err instanceof Error ? err.message : err)
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
    if (!(await isFeatureEnabled('chat', auth.user.role))) {
      rejectUpgrade(socket, '403 Forbidden')
      return
    }
    const userId = auth.user.userId
    if (auth.user.role !== 'admin') {
      const ban = await getActiveChatBan(userId)
      if (ban) {
        rejectUpgrade(socket, '403 Forbidden')
        return
      }
    }
    // 聊天双后端：用户选择 XMPP 时把连接中继到 neko，其余走自建网关
    const backend = await chatBackendOf(userId)

    wss.handleUpgrade(req, socket, head, (ws) => {
      if (backend === 'xmpp') {
        attachNekoRelay(userId, ws)
        return
      }
      const session: ChatSession = {
        id: randomUUID(),
        userId,
        kind: 'ws',
        sink: {
          send(xml: string) {
            if (ws.readyState !== WebSocket.OPEN) return
            try {
              ws.send(xml)
            } catch { /* ignore */ }
          },
          close(code?: number, reason?: string) {
            try {
              if (code === undefined) ws.close()
              else ws.close(code, reason)
            } catch { /* ignore */ }
          },
        },
        authed: false,
        bound: false,
        resource: '',
        lastActivity: Date.now(),
        closed: false,
      }
      registerSession(session)

      const idleTimer = setInterval(() => {
        if (Date.now() - session.lastActivity > IDLE_TIMEOUT_MS) {
          teardownSession(session)
          try {
            ws.close(1001, 'idle')
          } catch { /* ignore */ }
        }
      }, 30_000)
      idleTimer.unref?.()

      ws.on('message', (data: Buffer, isBinary: boolean) => {
        if (isBinary) return
        void processSessionStanza(session, data.toString('utf8'))
      })
      ws.on('close', () => {
        clearInterval(idleTimer)
        teardownSession(session)
      })
      ws.on('error', () => {
        clearInterval(idleTimer)
        teardownSession(session)
        try {
          ws.close(1011)
        } catch { /* ignore */ }
      })
    })
  }

  console.log('[chatWs] 自建聊天 WS 网关已启用：/ws/xmpp')
  return wss
}

/** 兼容别名：管理端封禁时断开某账号全部聊天连接（自建会话 + neko 中继） */
export function closeUserChatSockets(userId: number): number {
  const selfClosed = closeUserSessions(userId)
  const nekoClosed = config.nekoChatEnabled ? closeUserNekoSockets(userId) : 0
  return selfClosed + nekoClosed
}
