import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import { Server as HttpServer } from 'http'
import { config } from '../config/index.js'

interface NodeCommand {
  id: string
  type: 'write_file' | 'read_file' | 'delete_file' | 'mkdir'
       | 'move' | 'stat' | 'list_dir' | 'rename'
  path: string
  data?: string          // write_file 时携带 base64 文件数据
  newPath?: string       // move 时的目标路径
  newName?: string       // rename 时的新名称
}

interface NodeResponse {
  id: string
  success: boolean
  data?: any
  error?: string
}

// 全局存储节点连接
let activeNode: WebSocket | null = null
let nodeConnected = false
let nodeConnectTime: Date | null = null

// 等待响应的命令映射
const pendingCommands = new Map<string, {
  resolve: (value: NodeResponse) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}>()

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

/**
 * 向存储节点发送命令并等待响应
 */
export function sendCommand(command: Omit<NodeCommand, 'id'> & { id?: string }): Promise<NodeResponse> {
  return new Promise((resolve, reject) => {
    if (!activeNode || !nodeConnected) {
      reject(new Error('存储节点未连接'))
      return
    }

    const id = command.id || generateId()
    const cmd: NodeCommand = { ...command, id } as NodeCommand

    const timer = setTimeout(() => {
      pendingCommands.delete(id)
      reject(new Error(`命令超时 (60s): ${command.type}`))
    }, 60000)

    pendingCommands.set(id, { resolve, reject, timer })

    try {
      activeNode.send(JSON.stringify(cmd))
    } catch (err) {
      pendingCommands.delete(id)
      clearTimeout(timer)
      reject(new Error(`发送命令失败: ${err}`))
    }
  })
}

/**
 * 初始化 WebSocket 服务器
 */
export function initStorageTunnel(server: HttpServer) {
  const wss = new WebSocketServer({
    server,
    path: '/ws/storage',
  })

  console.log('✦ Storage tunnel listening at /ws/storage')

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const clientIp = req.socket.remoteAddress
    console.log(`🔌 Storage node connecting from ${clientIp}`)

    let authenticated = false
    let authTimer: ReturnType<typeof setTimeout> | null = null

    // 认证超时：5秒内未认证则断开
    authTimer = setTimeout(() => {
      if (!authenticated) {
        console.log('⏱ Auth timeout, disconnecting')
        ws.close(4001, '认证超时')
      }
    }, 5000)

    ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString())

        if (!authenticated) {
          // 处理认证
          if (msg.type === 'auth' && msg.token === config.storageNodeToken) {
            authenticated = true
            if (authTimer) clearTimeout(authTimer)
            activeNode = ws
            nodeConnected = true
            nodeConnectTime = new Date()
            console.log('✅ Storage node authenticated')
            ws.send(JSON.stringify({ type: 'auth_ok' }))
          } else {
            console.log('❌ Storage node auth failed')
            ws.send(JSON.stringify({ type: 'auth_error', error: '认证失败' }))
            ws.close(4002, '认证失败')
          }
          return
        }

        // 处理命令响应
        const response: NodeResponse = msg
        if (response.id && pendingCommands.has(response.id)) {
          const pending = pendingCommands.get(response.id)!
          clearTimeout(pending.timer)
          pendingCommands.delete(response.id)
          pending.resolve(response)
        }
      } catch (err) {
        console.error('Storage message error:', err)
      }
    })

    ws.on('close', () => {
      console.log('🔌 Storage node disconnected')
      if (activeNode === ws) {
        activeNode = null
        nodeConnected = false
        nodeConnectTime = null

        // 拒绝所有等待的命令
        for (const [id, pending] of pendingCommands) {
          clearTimeout(pending.timer)
          pending.reject(new Error('存储节点已断开'))
          pendingCommands.delete(id)
        }
      }
    })

    ws.on('error', (err) => {
      console.error('Storage WebSocket error:', err)
    })
  })

  // 心跳：每 30 秒 ping
  const heartbeatInterval = setInterval(() => {
    if (activeNode && nodeConnected) {
      try {
        activeNode.ping()
      } catch {
        // ignore
      }
    }
  }, 30000)

  wss.on('close', () => {
    clearInterval(heartbeatInterval)
  })

  return wss
}

/**
 * 检查存储节点是否已连接
 */
export function isNodeConnected(): boolean {
  return nodeConnected && activeNode !== null
}

/**
 * 获取节点连接状态信息
 */
export function getNodeStatus() {
  return {
    connected: nodeConnected,
    connectedAt: nodeConnectTime?.toISOString() || null,
  }
}
