import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'

export type ServiceName = 'server' | 'client' | 'storage'

export interface ServiceState {
  pid: number
  startedAt: string
  cwd: string
  command: string
}

export type State = Partial<Record<ServiceName, ServiceState>>

export function readState(stateFile: string): State {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as State
  } catch {
    return {}
  }
}

export function writeState(stateFile: string, state: State): void {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8')
}

/** 通过 tasklist 检查进程是否存在 */
export function isProcessAlive(pid: number): boolean {
  try {
    const out = execSync(`tasklist /FI "PID eq ${pid}" /NH /FO CSV`, {
      encoding: 'utf-8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.includes(String(pid))
  } catch {
    return false
  }
}

/** 查询监听指定端口的 PID 列表（解析 netstat -ano） */
export function listeningPids(port: number): number[] {
  try {
    const out = execSync('netstat -ano', {
      encoding: 'utf-8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const pids = new Set<number>()
    for (const line of out.split('\n')) {
      if (!line.includes('LISTENING')) continue
      const parts = line.trim().split(/\s+/)
      if (parts.length < 5) continue
      const localPort = Number(parts[1].split(':').pop())
      const pid = Number(parts[4])
      if (localPort === port && Number.isFinite(pid) && pid > 0) pids.add(pid)
    }
    return [...pids]
  } catch {
    return []
  }
}

export function isPortListening(port: number): boolean {
  return listeningPids(port).length > 0
}

/** 轮询等待端口开始监听 */
export async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (isPortListening(port)) return true
    await sleep(1000)
  }
  return isPortListening(port)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface SpawnOptions {
  cwd: string
  /** 可执行文件（直接调用，不经 cmd shell，避免 Windows 下句柄继承丢失） */
  file: string
  args: string[]
  /** 追加写入的日志文件 */
  logFile: string
  /** 附加环境变量（合并到当前进程环境，如 NODE_ENV） */
  env?: NodeJS.ProcessEnv
}

/**
 * 后台启动进程：detached + 输出重定向到日志文件。
 * 返回子进程 PID（taskkill /T 可杀整棵进程树）。
 */
export function startDetached(opts: SpawnOptions): number {
  const fd = fs.openSync(opts.logFile, 'a')
  try {
    const child = spawn(opts.file, opts.args, {
      cwd: opts.cwd,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', fd, fd],
      env: { ...process.env, ...opts.env },
    })
    child.unref()
    child.on('error', () => {
      // spawn 失败（如命令不存在）写入日志文件即可
    })
    return child.pid ?? -1
  } finally {
    fs.closeSync(fd)
  }
}

/** 从 PATH 中定位 node.exe（CLI 打包后 process.execPath 是 exe 自身，不可用） */
export function findNodeExe(): string | null {
  try {
    const out = execSync('where node', {
      encoding: 'utf-8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const first = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)[0]
    return first || null
  } catch {
    return null
  }
}

/** 杀掉进程树（taskkill /F /T） */
export function killTree(pid: number): boolean {
  if (!pid || pid <= 0) return false
  try {
    execSync(`taskkill /F /T /PID ${pid}`, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    return true
  } catch {
    return false
  }
}

/** 检查命令是否可用（如 python） */
export function commandExists(command: string): boolean {
  try {
    execSync(`where ${command}`, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    return true
  } catch {
    return false
  }
}
