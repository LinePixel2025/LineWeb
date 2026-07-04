import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import { Server as HttpServer } from 'http'
import { config } from '../config/index.js'

const CHUNK_SIZE = config.uploadChunkKB * 1024 || 32768

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
  chunkSize?: number
}

interface NodeResponse {
  id: string
  success: boolean
  data?: unknown
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

interface PendingReadState {
  chunks: Map<number, string>
  totalChunks: number
  /** 当有数据到达时 resolve(index) — 供 streamRead 的 AsyncGenerator 使用 */
  notify: ((index: number) => void) | null
  /** 旧版兼容: 全量收集完成后的 resolve */
  resolve: ((value: NodeResponse) => void) | null
  reject: ((reason: Error) => void) | null
  timer: ReturnType<typeof setTimeout> | null
}

// 等待收集的分块读取数据（同时支持旧版 sendChunkedRead 和 新版 streamRead）
const pendingReads = new Map<string, PendingReadState>()

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
      pendingReads.delete(id)
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

  // 先发 init 告知节点总大小和总块数（可选）
  const knownSize = totalSize && totalSize > 0 ? totalSize : undefined
  const initCmd: NodeCommand = {
    id: batchId, type: 'write_file', path,
    totalSize: knownSize ?? 0,
    totalChunks: knownSize ? Math.ceil(knownSize / CHUNK_SIZE) : -1,
    chunkIndex: -1, isLast: false,
  }
  activeNode.send(JSON.stringify(initCmd))

  // 等待 50ms 确保节点初始化缓冲区
  await new Promise(r => setTimeout(r, 50))

  let chunkIndex = 0
  let lastChunk: Buffer | null = null

  for await (const rawChunk of chunks) {
    if (lastChunk) {
      // 发送上一个非最终块（fire-and-forget）
      const base64Data = lastChunk.toString('base64')
      const dCmd: NodeCommand = {
        id: batchId, type: 'write_file_data', path,
        data: base64Data, chunkIndex: chunkIndex - 1, isLast: false,
      }
      activeNode.send(JSON.stringify(dCmd))
    }
    lastChunk = rawChunk
    chunkIndex++
  }

  // 最后一块 — 等待确认
  if (!lastChunk) throw new Error('空流')

  // 如果只有一个 chunk，直接用 sendCommand 发送（单块模式）
  if (chunkIndex === 1) {
    return sendCommand({
      id: batchId,
      type: 'write_file' as const,
      path,
      totalSize: totalSize ?? lastChunk.length,
      totalChunks: 1,
      data: lastChunk.toString('base64'),
      chunkIndex: 0,
      isLast: true,
    })
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCommands.delete(batchId)
      reject(new Error(`写入超时: ${path}`))
    }, 120000)  // 大文件写超时 2 分钟

    pendingCommands.set(batchId, { resolve, reject, timer })

    const finalBase64 = lastChunk!.toString('base64')
    const lastCmd: NodeCommand = {
      id: batchId, type: 'write_file_data', path,
      data: finalBase64, chunkIndex: chunkIndex - 1, isLast: true,
    }
    try {
      activeNode!.send(JSON.stringify(lastCmd))
    } catch (err: unknown) {
      pendingCommands.delete(batchId)
      clearTimeout(timer)
      reject(new Error(`发送最后一块失败: ${err instanceof Error ? err.message : String(err)}`))
    }
  })
}

/**
 * 流式分块写入 — 将 Buffer 切分为 32KB 块后委托 streamWrite
 * @deprecated 请使用 streamWrite(path, asyncIterable, totalSize?) 以获得更低内存占用
 */
export async function sendChunkedWrite(path: string, rawData: Buffer): Promise<NodeResponse> {
  async function* bufferChunkIterator(buf: Buffer): AsyncIterable<Buffer> {
    for (let offset = 0; offset < buf.length; offset += CHUNK_SIZE) {
      yield buf.subarray(offset, Math.min(offset + CHUNK_SIZE, buf.length))
    }
  }
  return streamWrite(path, bufferChunkIterator(rawData), rawData.length)
}

/**
 * 等待指定 index 的 chunk 到达
 */
function waitForChunk(readId: string, index: number): Promise<string | null> {
  const state = pendingReads.get(readId)
  if (!state) {
    throw new Error('读取状态丢失（节点可能已断开）')
  }

  return new Promise((resolve, reject) => {
    // 检查 chunk 是否已到达
    if (state.chunks.has(index)) {
      resolve(state.chunks.get(index)!)
      return
    }

    // 如果 totalChunks 已知且 index >= totalChunks 则流结束
    if (state.totalChunks > 0 && index >= state.totalChunks) {
      resolve(null)
      return
    }

    // 注册 notify 回调，等待数据到达
    state.notify = (arrivedIndex: number) => {
      if (arrivedIndex === index) {
        // 清除 notify 以免重复触发
        state.notify = null
        resolve(state.chunks.get(index) ?? null)
      }
    }

    // 如果 reject 已被调用，cleanup
    const originalReject = state.reject
    state.reject = (err: Error) => {
      state.notify = null
      if (originalReject) originalReject(err)
      reject(err)
    }
  })
}

/**
 * 流式读取文件 — 通过 AsyncGenerator 逐块吐出 Buffer
 * 节点分块推送，边收边 yield，无需等全量数据到达
 */
export async function* streamRead(path: string): AsyncGenerator<Buffer> {
  if (!activeNode || !nodeConnected) {
    throw new Error('存储节点未连接')
  }

  const id = 'r-' + generateId()
  const READ_BUFFER_SIZE = config.downloadChunkKB * 1024

  const readState: PendingReadState = {
    chunks: new Map<number, string>(),
    totalChunks: 0,
    notify: null,
    resolve: null,
    reject: null,
    timer: null,
  }

  // 超时计时器：如果长时间没有数据到达则拒绝
  readState.timer = setTimeout(() => {
    const s = pendingReads.get(id)
    if (s) {
      pendingReads.delete(id)
      if (s.reject) s.reject(new Error(`流式读取超时 (120s): ${path}`))
    }
  }, 120000)

  pendingReads.set(id, readState)

  const cmd = { id, type: 'read_file' as const, path, chunkSize: READ_BUFFER_SIZE }
  try {
    activeNode.send(JSON.stringify(cmd))
  } catch (err: unknown) {
    pendingReads.delete(id)
    if (readState.timer) clearTimeout(readState.timer)
    throw new Error(`发送读取命令失败: ${err instanceof Error ? err.message : String(err)}`)
  }

  try {
    let buffer: Buffer | null = null

    for (let i = 0; ; i++) {
      const chunk = await waitForChunk(id, i)
      if (chunk === null) {
        // 流结束，flush 剩余 buffer
        if (buffer && buffer.length > 0) {
          yield buffer
        }
        break
      }

      // 重置超时计时器（每次收到 chunk 续期）
      if (readState.timer) clearTimeout(readState.timer)
      readState.timer = setTimeout(() => {
        const s = pendingReads.get(id)
        if (s) {
          pendingReads.delete(id)
          if (s.reject) s.reject(new Error(`流式读取超时 (120s): ${path}`))
        }
      }, 120000)

      const decoded = Buffer.from(chunk, 'base64')

      if (buffer === null) {
        buffer = decoded
      } else {
        buffer = Buffer.concat([buffer, decoded])
      }

      // 当累积到目标大小时 yield
      if (buffer.length >= READ_BUFFER_SIZE) {
        yield buffer
        buffer = null
      }
    }

    // 正常结束
    if (readState.timer) clearTimeout(readState.timer)
  } finally {
    if (readState.reject) readState.reject = null
    pendingReads.delete(id)
  }
}

/**
 * 分块读取文件 — 节点分块返回数据，全量收集后返回
 * @deprecated 请使用 streamRead(path) 以获得流式输出和更低的内存占用
 */
export async function sendChunkedRead(path: string): Promise<NodeResponse> {
  // 内部消费 streamRead 并拼接全量结果
  let fullBase64 = ''
  for await (const chunk of streamRead(path)) {
    fullBase64 += chunk.toString('base64')
  }
  return {
    id: '',
    success: true,
    data: fullBase64,
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

        // 处理分块读取的数据（read_file_data）
        if (msg.type === 'read_file_data' && pendingReads.has(msg.id)) {
          const pending = pendingReads.get(msg.id)!
          if (msg.chunkIndex !== undefined && msg.data) {
            pending.chunks.set(msg.chunkIndex, msg.data)
          }
          if (msg.totalChunks) {
            pending.totalChunks = msg.totalChunks
          }

          // 新版 streamRead: 通知等待者该 index 已到达
          if (pending.notify && msg.chunkIndex !== undefined) {
            pending.notify(msg.chunkIndex)
          }

          // 旧版 sendChunkedRead: 全量收集完所有块后 resolve
          if (pending.resolve && pending.totalChunks > 0 && pending.chunks.size >= pending.totalChunks) {
            const timer = pending.timer
            if (timer) clearTimeout(timer)
            const localResolve = pending.resolve
            pendingReads.delete(msg.id)

            // 按顺序拼接
            let fullBase64 = ''
            for (let i = 0; i < pending.totalChunks; i++) {
              fullBase64 += pending.chunks.get(i) || ''
            }

            localResolve({
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
          if (pending.timer) clearTimeout(pending.timer)
          // streamRead: 通过 reject 通知 generator
          if (pending.reject) {
            pending.reject(new Error('存储节点已断开'))
          }
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
