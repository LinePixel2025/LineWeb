import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import { Server as HttpServer } from 'http'
import { config } from '../config/index.js'
import { createHash } from 'crypto'

const CHUNK_SIZE = config.uploadChunkKB * 1024 || 32768

interface NodeCommand {
  id: string
  type: 'read_file' | 'read_file_stream' | 'write_file_stream' | 'stream_eof'
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
  sha256?: string
  streamId?: number
  type?: string
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

/**
 * 连接存活标记（心跳用）。值为 false 表示「上一轮 ping 之后没收到任何入站数据」，
 * 下一轮心跳仍未恢复就判定链路已死并 terminate。
 */
const liveness = new Map<WebSocket, boolean>()

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

const WS_MAX_BUFFER = 8 * 1024 * 1024  // 8MB high water mark
/** 背压轮询间隔：只在缓冲超高水位时生效，正常发送不进这个循环 */
const WS_DRAIN_POLL_MS = 5
/** 单次等待缓冲回落的超时（持续 60s 无法写入即判定链路已死，避免请求永久挂起） */
const WS_DRAIN_TIMEOUT_MS = 60_000

/**
 * 等待发送缓冲回落到高水位以下（流式上传的背压控制）。
 *
 * ⚠️ 历史坑：这里曾经用 `ws.on('drain', ...)` 等待回落。`ws` 的 WebSocket 实例
 * **不会**发出 'drain' 事件（只有内部 receiver 有），因此只要一次上传让
 * `bufferedAmount` 超过高水位，Promise 就永远不会 resolve —— 现象是浏览器
 * 上传进度走到 100% 后请求永不返回（小说/网盘上传都中招）。
 *
 * 现在改为轮询 `bufferedAmount`，并额外处理三种终止条件：
 *   - 连接关闭 / 不是 OPEN 状态 → 立即 reject（调用方按「存储节点已断开」处理）
 *   - 超过 WS_DRAIN_TIMEOUT_MS 仍未回落 → reject（链路假死，不能无限等）
 */
function waitForDrain(maxBuffer: number): Promise<void> {
  const ws = activeNode
  if (!ws || !nodeConnected || ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('存储节点已断开'))
  }
  if ((ws.bufferedAmount ?? 0) <= maxBuffer) return Promise.resolve()

  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now()
    let timer: ReturnType<typeof setTimeout> | null = null

    const stop = (err?: Error) => {
      if (timer) clearTimeout(timer)
      timer = null
      if (err) reject(err)
      else resolve()
    }

    const poll = () => {
      timer = null
      // 连接可能在等待期间断开（close 事件会清空 activeNode）
      if (ws.readyState !== WebSocket.OPEN || !nodeConnected) {
        stop(new Error('存储节点已断开'))
        return
      }
      if ((ws.bufferedAmount ?? 0) <= maxBuffer) {
        stop()
        return
      }
      if (Date.now() - startedAt > WS_DRAIN_TIMEOUT_MS) {
        stop(new Error('向存储节点发送数据超时（链路持续拥塞）'))
        return
      }
      timer = setTimeout(poll, WS_DRAIN_POLL_MS)
      timer.unref?.()
    }

    poll()
  })
}

const streamRegistry = new Map<number, PendingStream>()

let _nextStreamId = 0
function nextStreamId(): number {
  // 递增，溢出回绕，跳过 0（0 保留给控制帧），跳过冲突
  do {
    _nextStreamId = (_nextStreamId + 1) & 0xFFFFFFFF
  } while (_nextStreamId === 0 || streamRegistry.has(_nextStreamId))
  return _nextStreamId
}

const STREAM_IDLE_TIMEOUT_MS = 5 * 60 * 1000
const staleStreamReaper = setInterval(() => {
  const now = Date.now()
  for (const [id, stream] of streamRegistry) {
    if ('lastActivity' in stream) {
      const lastActivity = (stream as any).lastActivity as number
      if (now - lastActivity > STREAM_IDLE_TIMEOUT_MS) {
        console.warn(`[StorageTunnel] Reaping stale stream ${id}`)
        stream.fail(new Error('下载流超时 (5min 无活动)'))
        streamRegistry.delete(id)
      }
    }
  }
}, 60_000)
staleStreamReaper.unref()

class PendingStream {
  private chunks: Buffer[] = []
  private done = false
  private error: Error | null = null
  private endData: NodeResponse | null = null
  private pushResolve: (() => void) | null = null
  private checksumResolve: ((value: void) => void) | null = null
  private checksumReject: ((err: Error) => void) | null = null

  constructor(readonly streamId: number) {}

  push(data: Buffer): void {
    (this as any).lastActivity = Date.now()
    this.chunks.push(data)
    this.pushResolve?.()
    this.pushResolve = null
  }

  end(resp: NodeResponse): void {
    this.endData = resp
    this.done = true
    this.pushResolve?.()
    this.pushResolve = null
    if (resp.success && resp.sha256) {
      this.checksumResolve?.()
    } else if (!resp.success) {
      this.error = new Error(resp.error || '流传输失败')
      this.checksumReject?.(this.error)
    } else {
      this.checksumResolve?.()
    }
  }

  fail(err: Error): void {
    this.error = err
    this.done = true
    this.pushResolve?.()
    this.pushResolve = null
    this.checksumReject?.(err)
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
    let i = 0
    while (!this.done || i < this.chunks.length) {
      if (i < this.chunks.length) {
        yield this.chunks[i++]
      } else if (!this.done) {
        await new Promise<void>(r => { this.pushResolve = r })
      } else {
        break
      }
    }
    if (this.error) throw this.error
  }

  awaitChecksum(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.done) {
        if (this.error) reject(this.error)
        else resolve()
        return
      }
      this.checksumResolve = resolve
      this.checksumReject = reject
    })
  }
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
 * 二进制流式读取 — 发送一次 read_file_stream 命令，存储节点持续推送二进制帧
 * 每个二进制帧前 4 字节为 streamId，后接文件原始数据（无 base64）。
 */
export async function* streamReadBinary(
  path: string,
  offset = 0,
  length?: number,
): AsyncGenerator<Buffer> {
  if (!activeNode || !nodeConnected) {
    throw new Error('存储节点未连接')
  }

  const streamId = nextStreamId()
  const stream = new PendingStream(streamId)
  streamRegistry.set(streamId, stream)

  const timeoutMs = 120_000
  let timeout: ReturnType<typeof setTimeout> | undefined

  const resetTimeout = () => {
    clearTimeout(timeout)
    timeout = setTimeout(() => {
      stream.fail(new Error('下载流超时 (120s)'))
      streamRegistry.delete(streamId)
    }, timeoutMs)
  }
  resetTimeout()

  try {
    const resp = await sendCommand({
      type: 'read_file_stream',
      path,
      streamId,
      offset,
      length,
    })
    if (!resp.success) {
      throw new Error(`下载流初始化失败: ${resp.error || '未知错误'}`)
    }

    for await (const chunk of stream) {
      resetTimeout()
      yield chunk
    }

    await stream.awaitChecksum()
  } finally {
    clearTimeout(timeout)
    streamRegistry.delete(streamId)
  }
}

/**
 * 二进制流式上传 — busboy 流出的 Buffer 直接封装为 WebSocket 二进制帧，
 * 无 base64 编码开销。每 STREAM_CHUNK_KB 累积一批发送。
 *
 * 性能优化：
 *   - 用 pending: Buffer[] 数组代替 Buffer.concat 累积，避免 O(n²) 拷贝
 *   - SHA-256 只在发送帧时批量更新（每 ~4MB 一次）
 *   - 只在发送时执行一次 Buffer.concat 合并帧
 */
export async function streamWriteBinary(
  path: string,
  chunks: AsyncIterable<Buffer>,
  totalSize?: number,
): Promise<{ sha256: string; bytesWritten: number }> {
  if (!activeNode || !nodeConnected) {
    throw new Error('存储节点未连接')
  }
  // 锁定本次写入使用的连接：中途重连不会把帧发到新连接上（新连接上没有这个 streamId）
  const ws = activeNode

  const streamId = nextStreamId()
  const sha256 = createHash('sha256')
  const CHUNK = Math.max(config.streamChunkKB * 1024, 64 * 1024)

  // pending 数组避免 O(n²) 的 Buffer.concat([buffered, chunk]) 模式
  const pending: Buffer[] = []
  let pendingBytes = 0
  let totalBytes = 0
  /** 发送回调里的错误（ws.send 是异步写入，错误只能通过回调拿到） */
  let sendError: Error | null = null

  const initResp = await sendCommand({
    type: 'write_file_stream',
    path,
    streamId,
    totalSize,
  })
  if (!initResp.success) {
    throw new Error(`初始化写入流失败: ${initResp.error || '未知错误'}`)
  }

  try {
    // 逐帧发送累积数据：每次达到 CHUNK 或数据流结束
    const flush = async (force: boolean): Promise<void> => {
      while (pendingBytes >= CHUNK || (force && pendingBytes > 0)) {
        const takeSize = force ? pendingBytes : CHUNK
        // 合并 pending 为单一 Buffer —— 每 CHUNK 合并一次，而非每个 busboy chunk
        const combined = Buffer.concat(pending)
        const frameData = combined.subarray(0, takeSize)
        const rest = combined.subarray(takeSize)

        // 重建 pending：剩余数据
        pending.length = 0
        if (rest.length > 0) pending.push(rest)
        pendingBytes -= takeSize

        // 批量更新 SHA-256（每帧一次，而非每个 busboy chunk）
        sha256.update(frameData)

        // 构造 WebSocket 帧：4 字节 streamId + 原始数据
        const frame = Buffer.concat([createStreamHeader(streamId), frameData])
        totalBytes += frameData.length

        if (sendError) throw sendError
        // 背压：缓冲超过高水位时等它回落（waitForDrain 内部有超时，不会永久挂起）
        await waitForDrain(WS_MAX_BUFFER)
        if (ws.readyState !== WebSocket.OPEN) throw new Error('存储节点已断开')
        ws.send(frame, (err?: Error) => {
          if (err && !sendError) sendError = err
        })
      }
    }

    for await (const chunk of chunks) {
      // O(1) 压入，不拷贝
      pending.push(chunk)
      pendingBytes += chunk.length
      // 累积到阈值时刷出
      await flush(false)
    }

    // 强制刷出剩余数据
    await flush(true)
    if (sendError) throw sendError

    const digest = sha256.digest('hex')
    const streamEndResp = await sendCommand({
      type: 'stream_eof',
      path,
      streamId,
      sha256: digest,
    })

    if (!streamEndResp.success) {
      throw new Error(`上传完成确认失败: ${streamEndResp.error || 'SHA-256 校验不匹配'}`)
    }

    return {
      sha256: digest,
      bytesWritten: totalBytes,
    }
  } catch (err) {
    try {
      await sendCommand({ type: 'delete_file', path: path + '.tmp' })
    } catch { /* ignore */ }
    throw err
  }
}

/** 生成 4 字节大端 streamId 头 */
function createStreamHeader(streamId: number): Buffer {
  const buf = Buffer.alloc(4)
  buf.writeUInt32BE(streamId, 0)
  return buf
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

    ws.on('message', (raw: Buffer, isBinary: boolean) => {
      // 任何入站数据都视为链路存活信号
      liveness.set(ws, true)
      try {
        // 二进制帧：路由到 PendingStream
        if (isBinary) {
          if (raw.length < 4) return
          const streamId = raw.readUInt32BE(0)
          const payload = raw.subarray(4)
          const stream = streamRegistry.get(streamId)
          if (stream) {
            stream.push(payload)
          }
          return
        }

        const msg = JSON.parse(raw.toString())

        if (!authenticated) {
          // 处理认证
          if (msg.type === 'auth' && msg.token === config.storageNodeToken) {
            authenticated = true
            if (authTimer) clearTimeout(authTimer)
            activeNode = ws
            nodeConnected = true
            nodeConnectTime = new Date()
            liveness.set(ws, true)
            console.log('✅ Storage node authenticated')
            ws.send(JSON.stringify({ type: 'auth_ok' }))
          } else {
            console.log('❌ Storage node auth failed')
            ws.send(JSON.stringify({ type: 'auth_error', error: '认证失败' }))
            ws.close(4002, '认证失败')
          }
          return
        }

        // 先检查是否是 pending 命令的响应（如 stream_eof 的 ack）
        {
          const response: NodeResponse = msg
          if (response.id && pendingCommands.has(response.id)) {
            const pending = pendingCommands.get(response.id)!
            clearTimeout(pending.timer)
            pendingCommands.delete(response.id)
            pending.resolve(response)
            return
          }
        }

        // 处理 stream_end 控制帧（下载流的结束信号）
        if (msg.type === 'stream_end') {
          const stream = streamRegistry.get(msg.streamId)
          if (stream) {
            const response: NodeResponse = msg
            stream.end(response)
          }
          return
        }

        // 处理命令响应（旧协议兼容）
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
      liveness.delete(ws)
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

        // 清理 streamRegistry
        for (const [id, stream] of streamRegistry) {
          stream.fail(new Error('存储节点已断开'))
          streamRegistry.delete(id)
        }
      }
    })

    ws.on('error', (err) => {
      console.error('Storage WebSocket error:', err)
    })

    // 心跳应答：ws 把 pong 作为独立事件抛出（不会进 'message'），
    // 空闲连接只有 pong 这一种存活信号，漏掉它会把健康连接误判为半开而断开。
    ws.on('pong', () => liveness.set(ws, true))
    ws.on('ping', () => liveness.set(ws, true))
  })

  // 心跳：每 30 秒 ping；连续一个周期没收到任何入站数据（pong 或消息）就判定链路已死。
  // 没有这层检测时，节点机器掉线/拔网线这类「TCP 半开」连接会一直留着 nodeConnected=true，
  // 上传会挂在发送缓冲上直到超时（历史现象：上传 100% 后卡死）。
  const heartbeatInterval = setInterval(() => {
    if (!activeNode || !nodeConnected) return
    if (liveness.get(activeNode) === false) {
      console.warn('[StorageTunnel] 存储节点心跳超时，主动断开半开连接')
      try {
        activeNode.terminate()
      } catch {
        // ignore
      }
      return
    }
    liveness.set(activeNode, false)
    try {
      activeNode.ping()
    } catch {
      // ignore
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
