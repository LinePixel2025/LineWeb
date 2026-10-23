import { WebSocketServer, WebSocket } from 'ws'
import { Server as HttpServer } from 'http'
import { config } from '../config/index.js'
import { resolveAuthContext } from '../middleware/auth.js'

/**
 * 聊天 WebSocket Hub（/ws/chat）
 *
 * 协议：
 *   1. 连接后 5 秒内客户端必须发送 `{ type: 'auth', token }`（账号登录令牌）
 *   2. 服务端校验成功后回 `{ type: 'auth_ok', userId }`，之后才推送业务事件
 *   3. 认证失败（含令牌失效 / 下载票据 / 第三方应用令牌）→ close(4001, '认证失败')
 *   4. 客户端可发 `{ type: 'ping' }` → 服务端回 `{ type: 'pong' }`；
 *      服务端每 30 秒发协议级 ping，未回 pong 的连接会被 terminate
 *
 * 业务事件（由 routes/chat.ts 通过 sendToUser/sendToUsers 推送）：
 *   - message:new / conversation:updated / conversation:removed
 *   - friend:request / friend:accepted / friend:rejected / friend:removed
 */

/** 服务端推送给客户端的事件（字段名必须与前端契约一致） */
export interface ChatServerEvent {
  type: string
  [key: string]: unknown
}

interface SocketState {
  /** null 表示尚未通过认证 */
  userId: number | null
  /** 心跳标记：上一轮 ping 之后是否收到过 pong */
  alive: boolean
  authTimer: ReturnType<typeof setTimeout> | null
}

/** userId → 该用户当前所有已认证连接（多标签页 / 多设备） */
const userSockets = new Map<number, Set<WebSocket>>()
const socketStates = new WeakMap<WebSocket, SocketState>()

const AUTH_TIMEOUT_MS = 5_000
const HEARTBEAT_INTERVAL_MS = 30_000
/** WebSocket 关闭码：认证失败（前端据此停止重连） */
export const AUTH_FAILED_CLOSE_CODE = 4001

function send(ws: WebSocket, event: ChatServerEvent): void {
  if (ws.readyState !== WebSocket.OPEN) return
  try {
    ws.send(JSON.stringify(event))
  } catch (err) {
    console.error('[ChatHub] 发送事件失败:', err)
  }
}

/** 推送事件给单个用户的所有连接 */
export function sendToUser(userId: number, event: ChatServerEvent): void {
  const sockets = userSockets.get(userId)
  if (!sockets || sockets.size === 0) return
  const payload = JSON.stringify(event)
  for (const ws of sockets) {
    if (ws.readyState !== WebSocket.OPEN) continue
    try {
      ws.send(payload)
    } catch (err) {
      console.error('[ChatHub] 发送事件失败:', err)
    }
  }
}

/** 推送事件给多个用户（自动去重；序列化一次） */
export function sendToUsers(userIds: Iterable<number>, event: ChatServerEvent): void {
  const payload = JSON.stringify(event)
  for (const userId of new Set(userIds)) {
    const sockets = userSockets.get(userId)
    if (!sockets) continue
    for (const ws of sockets) {
      if (ws.readyState !== WebSocket.OPEN) continue
      try {
        ws.send(payload)
      } catch (err) {
        console.error('[ChatHub] 发送事件失败:', err)
      }
    }
  }
}

/** 用户是否有至少一个已认证连接在线 */
export function isUserOnline(userId: number): boolean {
  const sockets = userSockets.get(userId)
  return !!sockets && sockets.size > 0
}

/** 已认证在线用户 id 列表（便于调试 / 冒烟验证） */
export function getOnlineUserIds(): number[] {
  return Array.from(userSockets.keys())
}

function removeSocket(ws: WebSocket): void {
  const state = socketStates.get(ws)
  if (!state) return
  if (state.authTimer) {
    clearTimeout(state.authTimer)
    state.authTimer = null
  }
  if (state.userId !== null) {
    const sockets = userSockets.get(state.userId)
    if (sockets) {
      sockets.delete(ws)
      if (sockets.size === 0) userSockets.delete(state.userId)
    }
    state.userId = null
  }
}

/**
 * 初始化聊天 WebSocket 服务（与 HTTP server 共用端口，路径 /ws/chat）
 *
 * ⚠️ 为什么不用 `new WebSocketServer({ server, path: '/ws/chat' })`：
 * ws 库在 `{ server, path }` 模式下，会把「路径不匹配」的 upgrade 请求直接
 * abort 成 HTTP 400（见 ws/lib/websocket-server.js handleUpgrade → shouldHandle）。
 * 同一个 HTTP server 上 storageTunnel 已经用 `{ server, path: '/ws/storage' }`
 * 注册了一个 upgrade 监听器，所以第二个带 path 的 WebSocketServer 会让
 * /ws/chat 的握手全部被 400 掉。
 *
 * 因此这里用 `noServer: true` + 接管 upgrade 事件做路径分发：
 *   - /ws/chat → 交给聊天 Hub；
 *   - 其它路径 → 原样转交给此前已注册的 upgrade 监听器（即 storageTunnel）。
 *
 * 注意调用顺序：initChatHub 必须在 initStorageTunnel 之后调用（index.ts 已如此），
 * 这样被转交的监听器集合里才包含存储隧道。
 */
export function initChatHub(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
  })

  const previousUpgradeListeners = server.listeners('upgrade').slice()
  server.removeAllListeners('upgrade')
  server.on('upgrade', (req, socket, head) => {
    const pathname = (req.url ?? '').split('?')[0]
    if (pathname === '/ws/chat' || pathname === '/ws/chat/') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req)
      })
      return
    }
    for (const listener of previousUpgradeListeners) {
      listener.call(server, req, socket, head)
    }
  })

  console.log('✦ Chat hub listening at /ws/chat')

  wss.on('connection', (ws: WebSocket) => {
    const state: SocketState = { userId: null, alive: true, authTimer: null }
    socketStates.set(ws, state)

    // 认证超时：5 秒内未完成认证直接断开
    state.authTimer = setTimeout(() => {
      if (state.userId === null) ws.close(AUTH_FAILED_CLOSE_CODE, '认证失败')
    }, AUTH_TIMEOUT_MS)
    state.authTimer.unref()

    ws.on('pong', () => {
      state.alive = true
    })

    ws.on('message', (raw: Buffer) => {
      // 单条消息的处理全部包在 try/catch 里，避免异步异常逃逸到进程级处理
      void (async () => {
        let msg: { type?: unknown; token?: unknown }
        try {
          msg = JSON.parse(raw.toString()) as { type?: unknown; token?: unknown }
        } catch {
          return
        }
        if (!msg || typeof msg.type !== 'string') return

        // === 未认证：只接受 auth 帧 ===
        if (state.userId === null) {
          if (msg.type !== 'auth' || typeof msg.token !== 'string') {
            ws.close(AUTH_FAILED_CLOSE_CODE, '认证失败')
            return
          }
          const result = await resolveAuthContext(msg.token)
          const rejected = !result.ok
            || result.user.type === 'download'
            || result.user.type === config.oauthAccessTokenType
          if (rejected) {
            ws.close(AUTH_FAILED_CLOSE_CODE, '认证失败')
            return
          }

          state.userId = result.user.userId
          if (state.authTimer) {
            clearTimeout(state.authTimer)
            state.authTimer = null
          }
          let sockets = userSockets.get(state.userId)
          if (!sockets) {
            sockets = new Set()
            userSockets.set(state.userId, sockets)
          }
          sockets.add(ws)
          send(ws, { type: 'auth_ok', userId: state.userId })
          return
        }

        // === 已认证：只处理心跳 ===
        if (msg.type === 'ping') {
          send(ws, { type: 'pong' })
        }
      })().catch((err) => {
        console.error('[ChatHub] 处理消息失败:', err)
        try {
          ws.close(AUTH_FAILED_CLOSE_CODE, '认证失败')
        } catch {
          // ignore
        }
      })
    })

    ws.on('close', () => removeSocket(ws))
    ws.on('error', (err) => {
      console.error('[ChatHub] WebSocket 错误:', err)
    })
  })

  // 心跳：每 30 秒 ping 一次，上一轮没回 pong 的连接直接断开
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const state = socketStates.get(ws)
      if (!state) continue
      if (!state.alive) {
        ws.terminate()
        removeSocket(ws)
        continue
      }
      state.alive = false
      try {
        ws.ping()
      } catch {
        // 连接已异常，交给 close 事件清理
      }
    }
  }, HEARTBEAT_INTERVAL_MS)
  heartbeat.unref()

  wss.on('close', () => {
    clearInterval(heartbeat)
  })

  return wss
}
