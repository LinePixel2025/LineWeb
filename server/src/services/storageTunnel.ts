import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import { Server as HttpServer } from 'http'
import { config } from '../config/index.js'

const CHUNK_SIZE = 32768  // 32KB raw data per chunk (~43KB base64)

interface NodeCommand {
  id: string
  type: 'write_file' | 'write_file_data' | 'write_file_end'
       | 'read_file' | 'read_file_data'
       | 'delete_file' | 'mkdir'
       | 'move' | 'stat' | 'list_dir' | 'rename'
  path: string
  data?: string
  newPath?: string
  newName?: string
  chunkIndex?: number
  totalChunks?: number
  totalSize?: number
  isLast?: boolean
}

interface NodeResponse {
  id: string
  success: boolean
  data?: any
  error?: string
  chunkIndex?: number
  totalChunks?: number
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

// 等待收集的分块读取数据
const pendingReads = new Map<string, {
  chunks: Map<number, string>
  totalChunks: number
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
      pendingReads.delete(id)
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
 * 分块写入文件 — 将大文件拆分成多个小消息发送
 */
export async function sendChunkedWrite(path: string, rawData: Buffer): Promise<NodeResponse> {
  const base64Data = rawData.toString('base64')
  const totalChunks = Math.ceil(base64Data.length / CHUNK_SIZE)
  const batchId = 'w-' + generateId()

  // 第一步：发送 start（不含数据，仅元信息）
  await sendCommand({
    id: batchId,
    type: 'write_file' as any,
    path,
    totalSize: rawData.length,
    totalChunks,
  })

  // 第二步：逐块发送数据
  for (let i = 0; i < totalChunks; i++) {
    const chunk = base64Data.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
    const isLast = i === totalChunks - 1

    const result = await sendCommand({
      id: batchId,
      type: 'write_file_data' as any,
      path,
      data: chunk,
      chunkIndex: i,
      totalChunks,
      isLast,
    })

    if (!isLast && !result.success) {
      return result
    }
    if (isLast) {
      return result
    }
  }

  return { id: batchId, success: true, data: { size: rawData.length } }
}

/**
 * 分块读取文件 — 节点分块返回数据
 */
export async function sendChunkedRead(path: string): Promise<NodeResponse> {
  if (!activeNode || !nodeConnected) {
    throw new Error('存储节点未连接')
  }

  const id = 'r-' + generateId()

  // 发送读取请求
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCommands.delete(id)
      pendingReads.delete(id)
      reject(new Error(`读取超时 (60s): ${path}`))
    }, 60000)

    const readState = {
      chunks: new Map<number, string>(),
      totalChunks: 0,
      resolve,
      reject,
      timer,
    }
    pendingReads.set(id, readState)

    const cmd = { id, type: 'read_file' as const, path }
    try {
      activeNode!.send(JSON.stringify(cmd))
    } catch (err) {
      pendingReads.delete(id)
      clearTimeout(timer)
      reject(new Error(`发送读取命令失败: ${err}`))
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
    maxPayload: 0,     // 不限制单条消息大小
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

        // 处理分块读取的数据
        if (msg.type === 'read_file_data' && pendingReads.has(msg.id)) {
          const pending = pendingReads.get(msg.id)!
          if (msg.chunkIndex !== undefined && msg.data) {
            pending.chunks.set(msg.chunkIndex, msg.data)
          }
          if (msg.totalChunks) {
            pending.totalChunks = msg.totalChunks
          }

          // 收集完所有块
          if (pending.totalChunks > 0 && pending.chunks.size >= pending.totalChunks) {
            clearTimeout(pending.timer)
            pendingReads.delete(msg.id)

            // 按顺序拼接
            let fullBase64 = ''
            for (let i = 0; i < pending.totalChunks; i++) {
              fullBase64 += pending.chunks.get(i) || ''
            }

            pending.resolve({
              id: msg.id,
              success: true,
              data: fullBase64,
            })
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
        for (const [id, pending] of pendingReads) {
          clearTimeout(pending.timer)
          pending.reject(new Error('存储节点已断开'))
          pendingReads.delete(id)
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
