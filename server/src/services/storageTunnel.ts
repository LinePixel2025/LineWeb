import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import { Server as HttpServer } from 'http'
import { config } from '../config/index.js'

const CHUNK_SIZE = config.uploadChunkKB * 1024 || 32768

interface NodeCommand {
  id: string
  type: 'write_file' | 'write_file_data' | 'write_file_end'
       | 'read_file' | 'read_file_stream' | 'write_file_stream' | 'stream_eof'
       | 'delete_file' | 'mkdir'
       | 'move' | 'stat' | 'list_dir' | 'rename'
  path: string
  data?: string
  newPath?: string
  newName?: string
  totalSize?: number
  isLast?: boolean
  offset?: number
  length?: number
  streamId?: number
  sha256?: string
  bytesWritten?: number
}

interface NodeResponse {
  id: string
  success: boolean
  data?: unknown
  error?: string
  bytesRead?: number
  isEOF?: boolean
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
 * 判断是否为可重试的瞬时错误
 */
function isTransientError(err: Error): boolean {
  const msg = err.message || ''
  return msg.includes('超时') || msg.includes('断开') || msg.includes('发送')
}

/**
 * 带指数退避重试的命令发送
 * 对超时、断开等瞬时错误自动重试，最多 retries 次
 */
export async function sendCommandWithRetry(
  command: Omit<NodeCommand, 'id'> & { id?: string },
  retries = 3,
): Promise<NodeResponse> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await sendCommand(command)
    } catch (err: unknown) {
      if (attempt === retries || !(err instanceof Error) || !isTransientError(err)) throw err
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
      console.warn(
        `[StorageTunnel] Command ${command.type} failed (${attempt}/${retries}), retrying in ${delay}ms: ${err.message}`,
      )
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw new Error('unreachable')
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
    } catch (err: unknown) {
      pendingCommands.delete(id)
      clearTimeout(timer)
      reject(new Error(`发送命令失败: ${err instanceof Error ? err.message : String(err)}`))
    }
  })
}

/**
 * 流式分块写入 — 接收 AsyncIterable<Buffer>，边收边转发
 * 相比旧版等整个 Buffer 再 base64 分块，此版本将内存峰值从
 * "文件大小 + base64 膨胀 33%" 降为 "单个 chunk base64"
 */
export async function streamWrite(
  path: string,
  chunks: AsyncIterable<Buffer>,
  totalSize?: number,
): Promise<NodeResponse> {
  const batchId = 'w-' + generateId()

  if (!activeNode || !nodeConnected) {
    throw new Error('存储节点未连接')
  }

  // P8: Check WebSocket buffer before sending to prevent memory buildup
  const MAX_BUFFER = 1024 * 1024 // 1MB high water mark

  async function waitForDrain(ws: WebSocket, maxBuffer: number): Promise<void> {
    if ((ws.bufferedAmount ?? 0) > maxBuffer) {
      await new Promise<void>(resolve => {
        const check = () => {
          if ((ws?.bufferedAmount ?? 0) <= maxBuffer) {
            ws?.removeListener('drain', check)
            resolve()
          }
        }
        ws.on('drain', check)
      })
    }
  }

  const knownSize = totalSize && totalSize > 0 ? totalSize : undefined
  const initCmd: NodeCommand = {
    id: batchId, type: 'write_file', path,
    totalSize: knownSize ?? 0,
    isLast: false,
  }

  // 整体 try/catch — 任何失败都清理 .tmp 残片
  try {
    // init 命令等待 ack — 确保节点已准备好接收数据
    const initResp = await sendCommand(initCmd)
    if (!initResp.success) {
      throw new Error(`初始化写入失败: ${initResp.error || '未知错误'}`)
    }

    let chunkIndex = 0
    let lastChunk: Buffer | null = null

    for await (const rawChunk of chunks) {
      if (lastChunk) {
        // 发送上一个非最终块 — 用 try/catch 防止 send 抛异常导致状态不一致
        const base64Data = lastChunk.toString('base64')
        const dCmd: NodeCommand = {
          id: batchId, type: 'write_file_data', path,
          data: base64Data, isLast: false,
        }
        try {
          if (!activeNode || !nodeConnected) {
            throw new Error('存储节点已断开')
          }
          // P8: 等待缓冲区排空再发送下一个分块，防止内存堆积
          await waitForDrain(activeNode, MAX_BUFFER)
          activeNode.send(JSON.stringify(dCmd))
        } catch (err: unknown) {
          // 中间块发送失败 — 清理 .tmp 残片
          await cleanupTempFile(path).catch(() => {})
          throw new Error(`发送数据块 ${chunkIndex} 失败: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      lastChunk = rawChunk
      chunkIndex++
    }

    // 最后一块 — 等待确认
    if (!lastChunk) throw new Error('空流')

    // 如果只有一个 chunk，用 write_file_data 追加到 init 已打开的 .tmp 文件
    if (chunkIndex === 1) {
      const resp = await sendCommand({
        id: batchId,
        type: 'write_file_data' as const,
        path,
        data: lastChunk.toString('base64'),
        isLast: true,
      })
      if (!resp.success) {
        await cleanupTempFile(path).catch(() => {})
        throw new Error(`写入最后一块失败: ${resp.error || '未知错误'}`)
      }
      return resp
    }

    const finalResp = await new Promise<NodeResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingCommands.delete(batchId)
        reject(new Error(`写入超时: ${path}`))
      }, 120000)  // 大文件写超时 2 分钟

      pendingCommands.set(batchId, { resolve, reject, timer })

      const finalBase64 = lastChunk!.toString('base64')
      const lastCmd: NodeCommand = {
        id: batchId, type: 'write_file_data', path,
        data: finalBase64, isLast: true,
      }
      try {
        if (!activeNode || !nodeConnected) {
          throw new Error('存储节点已断开')
        }
        activeNode.send(JSON.stringify(lastCmd))
      } catch (err: unknown) {
        pendingCommands.delete(batchId)
        clearTimeout(timer)
        reject(new Error(`发送最后一块失败: ${err instanceof Error ? err.message : String(err)}`))
      }
    })

    if (!finalResp.success) {
      await cleanupTempFile(path).catch(() => {})
      throw new Error(`写入完成确认失败: ${finalResp.error || '未知错误'}`)
    }

    return finalResp
  } catch (err) {
    // 整体失败 — 尝试清理 .tmp 残片
    await cleanupTempFile(path).catch(() => {})
    throw err
  }
}

/** 清理写入失败时的 .tmp 残片 */
async function cleanupTempFile(path: string): Promise<void> {
  if (!activeNode || !nodeConnected) return
  try {
    await sendCommand({ type: 'delete_file', path: path + '.tmp' })
  } catch {
    // 静默失败 — .tmp 可能不存在
  }
}

/**
 * 流式读取文件 — 通过 AsyncGenerator 逐块吐出 Buffer
 * 拉模式: 每次请求一个 chunk，节点按需读取并返回，内存峰值仅 ~256KB
 */
export async function* streamRead(path: string): AsyncGenerator<Buffer> {
  if (!activeNode || !nodeConnected) {
    throw new Error('存储节点未连接')
  }

  const READ_SIZE = config.downloadChunkKB * 1024
  let offset = 0

  while (true) {
    const response = await sendCommand({
      type: 'read_file',
      path,
      offset,
      length: READ_SIZE,
    })

    if (!response.success) {
      throw new Error(`读取文件失败: ${response.error}`)
    }

    const data = response.data as string
    const isEOF = response.isEOF as boolean
    const bytesRead = response.bytesRead as number

    if (!data || bytesRead === 0) {
      break
    }

    const buffer = Buffer.from(data, 'base64')
    yield buffer

    if (isEOF) {
      break
    }

    offset += bytesRead
  }
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
 * 递归列出存储节点上所有路径（文件 + 文件夹）
 * 通过逐层调用 list_dir 实现
 */
export async function listDirRecursive(rootPath: string = ''): Promise<string[]> {
  const result: string[] = []
  const pending = [rootPath]

  while (pending.length > 0) {
    const dir = pending.pop()!
    const resp = await sendCommand({ type: 'list_dir', path: dir || '.' })

    if (!resp.success || !Array.isArray(resp.data)) {
      console.warn(`listDirRecursive: 无法列出 ${dir}: ${resp.error}`)
      continue
    }

    for (const item of resp.data) {
      const itemPath = dir ? `${dir}/${item.name}` : item.name
      result.push(itemPath)
      if (item.isFolder) {
        pending.push(itemPath)
      }
    }
  }

  return result
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
