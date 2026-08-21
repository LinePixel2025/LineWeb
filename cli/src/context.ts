import fs from 'node:fs'
import path from 'node:path'

export const PORTS = {
  server: 3001,
  client: 5173,
} as const

/** 代码仓库地址（公开仓库，可匿名 HTTPS 克隆；可用环境变量覆盖） */
export const REPO_URL =
  process.env.LINEWEB_REPO_URL || 'https://github.com/LinePixel2025/LineWeb.git'

export interface Context {
  /** 项目根目录（package.json name = "lineweb"） */
  root: string
  serverDir: string
  clientDir: string
  storageDir: string
  /** CLI 运行时状态目录 <root>/.lineweb-cli */
  stateDir: string
  stateFile: string
  logsDir: string
}

/** 从 start 目录向上查找 name 为 lineweb 的 package.json */
function findRootFrom(start: string): string | null {
  let dir = start
  for (;;) {
    const pkgPath = path.join(dir, 'package.json')
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { name?: unknown }
        if (pkg.name === 'lineweb') return dir
      } catch {
        // package.json 损坏，继续向上找
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function buildContext(root: string): Context {
  const stateDir = path.join(root, '.lineweb-cli')
  const logsDir = path.join(stateDir, 'logs')
  fs.mkdirSync(logsDir, { recursive: true })
  return {
    root,
    serverDir: path.join(root, 'server'),
    clientDir: path.join(root, 'client'),
    storageDir: path.join(root, 'storage-node'),
    stateDir,
    stateFile: path.join(stateDir, 'state.json'),
    logsDir,
  }
}

/** 从已知根目录构建 Context；目录不是 lineweb 项目时返回 null */
export function contextFrom(root: string): Context | null {
  try {
    const pkgPath = path.join(root, 'package.json')
    if (!fs.existsSync(pkgPath)) return null
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { name?: unknown }
    if (pkg.name !== 'lineweb') return null
    return buildContext(root)
  } catch {
    return null
  }
}

/** exe 同目录下的项目位置指针文件（setup 克隆到别处后记录，供后续命令定位） */
export function pointerFile(): string {
  return path.join(path.dirname(process.execPath), 'lineweb-root.txt')
}

/** 尝试定位项目根目录；找不到返回 null（不退出进程） */
export function tryResolveContext(): Context | null {
  // 1. setup 写入的指针文件（exe 放在项目外的场景）
  try {
    const pointer = pointerFile()
    if (fs.existsSync(pointer)) {
      const saved = fs.readFileSync(pointer, 'utf-8').trim()
      if (saved) {
        const ctx = contextFrom(saved)
        if (ctx) return ctx
      }
    }
  } catch {
    // 忽略，继续其他方式
  }

  // 2. 环境变量 / exe 目录 / 当前目录向上查找
  const candidates: string[] = []
  if (process.env.LINEWEB_ROOT) candidates.push(path.resolve(process.env.LINEWEB_ROOT))
  candidates.push(path.dirname(process.execPath))
  candidates.push(process.cwd())

  for (const start of candidates) {
    try {
      const root = findRootFrom(start)
      if (root) return buildContext(root)
    } catch {
      // 忽略，尝试下一个候选
    }
  }
  return null
}

/**
 * 定位项目根目录：
 * 1. setup 写入的指针文件（exe 同目录 lineweb-root.txt）
 * 2. LINEWEB_ROOT 环境变量
 * 3. 从可执行文件所在目录向上查找（双击 exe 场景）
 * 4. 从当前工作目录向上查找
 */
export function resolveContext(): Context {
  const ctx = tryResolveContext()
  if (ctx) return ctx

  console.error('错误：找不到 LineWeb 项目根目录（name 为 "lineweb" 的 package.json）。')
  console.error('请将本程序放在项目目录内、设置环境变量 LINEWEB_ROOT，或先运行 setup 一键安装。')
  process.exit(1)
}
