import { execSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { Context, PORTS, REPO_URL, contextFrom, pointerFile } from './context'
import {
  ServiceName,
  readState,
  writeState,
  isProcessAlive,
  listeningPids,
  isPortListening,
  waitForPort,
  sleep,
  startDetached,
  killTree,
  commandExists,
  findNodeExe,
} from './processes'
import { c, ok, warn, err, info, confirm } from './ui'

/** 启动一个服务所需的完整信息（直接调用解释器，不经 cmd shell） */
interface LaunchSpec {
  file: string
  args: string[]
  cwd: string
  /** 用于展示的命令行描述 */
  display: string
}

interface ServiceDef {
  name: ServiceName
  title: string
  port?: number
  /** 生成启动配置；缺少运行条件时返回 error */
  prepare: (ctx: Context, nodeExe: string | null) => { spec?: LaunchSpec; error?: string }
}

const SERVICES: ServiceDef[] = [
  {
    name: 'server',
    title: '后端服务 (Express)',
    port: PORTS.server,
    prepare: (ctx, nodeExe) => {
      if (!nodeExe) return { error: '未检测到 Node.js，无法启动后端（请安装 Node 18+ 并加入 PATH）' }
      const tsxEntry = path.join(ctx.serverDir, 'node_modules', 'tsx', 'dist', 'cli.mjs')
      if (!fs.existsSync(tsxEntry)) return { error: '后端依赖未安装（缺少 tsx），请先执行 npm install' }
      return {
        spec: {
          file: nodeExe,
          args: [tsxEntry, 'watch', 'src/index.ts'],
          cwd: ctx.serverDir,
          display: 'node tsx watch src/index.ts',
        },
      }
    },
  },
  {
    name: 'client',
    title: '前端开发服务 (Vite)',
    port: PORTS.client,
    prepare: (ctx, nodeExe) => {
      if (!nodeExe) return { error: '未检测到 Node.js，无法启动前端（请安装 Node 18+ 并加入 PATH）' }
      const viteEntry = path.join(ctx.clientDir, 'node_modules', 'vite', 'bin', 'vite.js')
      if (!fs.existsSync(viteEntry)) return { error: '前端依赖未安装（缺少 vite），请先执行 npm install' }
      return {
        spec: {
          file: nodeExe,
          args: [viteEntry],
          cwd: ctx.clientDir,
          display: 'node vite',
        },
      }
    },
  },
  {
    name: 'storage',
    title: '存储节点 (Python)',
    prepare: (ctx) => {
      if (!commandExists('python')) return { error: '未检测到 python，跳过存储节点（请安装 Python 3.10+ 并加入 PATH）' }
      return {
        spec: {
          file: 'python',
          args: ['main.py'],
          cwd: ctx.storageDir,
          display: 'python main.py',
        },
      }
    },
  },
]

const logPath = (ctx: Context, name: ServiceName): string =>
  path.join(ctx.logsDir, `${name}.log`)

function formatTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// ============================== start ==============================

export async function cmdStart(ctx: Context, opts: { storage: boolean }): Promise<boolean> {
  const state = readState(ctx.stateFile)
  const started: ServiceName[] = []
  const nodeExe = findNodeExe()

  for (const svc of SERVICES) {
    if (svc.name === 'storage' && !opts.storage) {
      info('跳过存储节点（--no-storage）')
      continue
    }

    const recorded = state[svc.name]
    if (recorded && isProcessAlive(recorded.pid)) {
      info(`${svc.title}已在运行（PID ${recorded.pid}），跳过`)
      continue
    }
    if (svc.port && isPortListening(svc.port)) {
      info(`${svc.title}已在运行（端口 ${svc.port} 被监听），跳过`)
      delete state[svc.name] // 清理失效记录
      continue
    }

    const { spec, error } = svc.prepare(ctx, nodeExe)
    if (!spec) {
      warn(error ?? `${svc.title}无法启动`)
      continue
    }

    info(`正在启动${svc.title}...`)
    const pid = startDetached({
      cwd: spec.cwd,
      file: spec.file,
      args: spec.args,
      logFile: logPath(ctx, svc.name),
    })
    if (pid <= 0) {
      err(`${svc.title}启动失败`)
      continue
    }
    state[svc.name] = {
      pid,
      startedAt: new Date().toISOString(),
      cwd: spec.cwd,
      command: spec.display,
    }
    started.push(svc.name)
  }

  writeState(ctx.stateFile, state)

  if (started.length === 0) {
    ok('所有服务均已在运行')
    return true
  }

  // 等待端口就绪
  const waiting = SERVICES.filter((s) => started.includes(s.name) && s.port)
  if (waiting.length > 0) {
    info('等待服务就绪...')
    for (const svc of waiting) {
      const ready = await waitForPort(svc.port!, 40_000)
      if (ready) ok(`${svc.title}就绪（端口 ${svc.port}）`)
      else err(`${svc.title}未能在规定时间内监听端口 ${svc.port}，请查看日志：logs ${svc.name}`)
    }
  }

  // 存储节点无端口，稍后检查进程是否存活
  if (started.includes('storage')) {
    await sleep(2000)
    const st = readState(ctx.stateFile).storage
    if (st && isProcessAlive(st.pid)) ok('存储节点已启动（后台自动连接远程服务器）')
    else warn('存储节点进程已退出，请查看日志：logs storage')
  }

  console.log()
  console.log(`  前端：${c.cyan}http://localhost:${PORTS.client}${c.reset}`)
  console.log(`  后端：${c.cyan}http://localhost:${PORTS.server}${c.reset}`)
  console.log(`  ${c.dim}提示：logs 查看日志，stop 停止服务${c.reset}`)
  return true
}

// ============================== stop ==============================

export async function cmdStop(ctx: Context): Promise<boolean> {
  const state = readState(ctx.stateFile)
  let stoppedAny = false

  for (const svc of SERVICES) {
    const recorded = state[svc.name]
    if (recorded && isProcessAlive(recorded.pid)) {
      info(`正在停止${svc.title}（PID ${recorded.pid}）...`)
      killTree(recorded.pid)
      stoppedAny = true
    }
  }

  // 兜底：清理仍占用 3001/5173 的进程（可能由旧脚本启动、未记录在 state 中）
  for (const port of [PORTS.server, PORTS.client]) {
    for (const pid of listeningPids(port)) {
      info(`正在清理占用端口 ${port} 的进程（PID ${pid}）...`)
      killTree(pid)
      stoppedAny = true
    }
  }

  writeState(ctx.stateFile, {})
  await sleep(1000)

  const remaining = [PORTS.server, PORTS.client].filter((pt) => isPortListening(pt))
  if (remaining.length > 0) {
    err(`端口 ${remaining.join(', ')} 仍被占用，请手动检查`)
    return false
  }
  ok(stoppedAny ? '所有服务已停止' : '没有发现正在运行的服务')
  return true
}

// ============================== restart ==============================

export async function cmdRestart(ctx: Context, opts: { storage: boolean }): Promise<boolean> {
  info('重启所有服务...')
  const stopped = await cmdStop(ctx)
  if (!stopped) warn('停止阶段未完全清理，仍尝试继续启动...')
  return cmdStart(ctx, opts)
}

// ============================== status ==============================

function checkHealth(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: PORTS.server, path: '/api/health', timeout: 3000 },
      (res) => {
        let body = ''
        res.on('data', (d: Buffer) => (body += d.toString()))
        res.on('end', () => resolve(res.statusCode === 200 ? body.trim() : null))
      }
    )
    req.on('error', () => resolve(null))
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
  })
}

export async function cmdStatus(ctx: Context): Promise<boolean> {
  const state = readState(ctx.stateFile)
  console.log()
  for (const svc of SERVICES) {
    const recorded = state[svc.name]
    const alive = recorded ? isProcessAlive(recorded.pid) : false
    let line: string
    if (alive) {
      line = `${c.green}● 运行中${c.reset}  ${svc.title}  ${c.dim}PID ${recorded!.pid}，启动于 ${formatTime(recorded!.startedAt)}${c.reset}`
    } else {
      line = `${c.dim}○ 已停止  ${svc.title}${c.reset}`
    }
    if (svc.port) {
      line += isPortListening(svc.port)
        ? `  ${c.green}端口 ${svc.port} 监听中${c.reset}`
        : `  ${c.dim}端口 ${svc.port} 未监听${c.reset}`
    }
    console.log(`  ${line}`)
  }

  const health = await checkHealth()
  if (health !== null) ok(`后端健康检查通过：${health}`)
  else if (isPortListening(PORTS.server)) warn('后端端口监听中，但健康检查未通过')
  console.log()
  return true
}

// ============================== 数据库同步（setup / update 共用） ==============================

/** 备份 server/prisma/ 下所有 SQLite 库文件到 .lineweb-cli/db-backups/，保留最近 5 份 */
function backupSqlite(ctx: Context): void {
  try {
    const backupDir = path.join(ctx.stateDir, 'db-backups')
    fs.mkdirSync(backupDir, { recursive: true })
    const prismaDir = path.join(ctx.serverDir, 'prisma')
    const dbs = fs.readdirSync(prismaDir).filter((f) => f.endsWith('.db'))
    for (const db of dbs) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const target = path.join(backupDir, `${db}.${stamp}`)
      fs.copyFileSync(path.join(prismaDir, db), target)
      const backups = fs
        .readdirSync(backupDir)
        .filter((f) => f.startsWith(`${db}.`))
        .sort()
      for (const old of backups.slice(0, Math.max(0, backups.length - 5))) {
        fs.rmSync(path.join(backupDir, old), { force: true })
      }
    }
    info(`已备份数据库（${dbs.join(', ')} → ${backupDir}）`)
  } catch {
    // 备份失败不阻断主流程
  }
}

/**
 * prisma db push --accept-data-loss。
 * 服务器运行时会创建 FTS5 虚拟表（drive_files_fts），不在 Prisma schema 中，
 * db push 尝试逐张删除其影子表时会失败（虚拟表删除后影子表级联消失）。
 * 因此先显式 DROP 虚拟表（服务启动时 ensureFTSTable 会从 drive_files 重建索引）。
 *
 * 执行前将 SQLite 库文件备份到 .lineweb-cli/db-backups/（保留最近 5 份），
 * db push --accept-data-loss 有破坏性，生产数据需可回滚。
 */
function pushDatabase(ctx: Context): boolean {
  backupSqlite(ctx)

  try {
    const sqlFile = path.join(ctx.stateDir, 'drop-fts.sql')
    fs.writeFileSync(sqlFile, 'DROP TABLE IF EXISTS drive_files_fts;', 'utf-8')
    try {
      execSync(`npx prisma db execute --file "${sqlFile}" --schema prisma/schema.prisma`, {
        cwd: ctx.serverDir,
        encoding: 'utf-8',
        windowsHide: true,
        stdio: 'ignore',
      })
    } catch {
      // 表不存在或非 SQLite 环境，忽略
    } finally {
      fs.rmSync(sqlFile, { force: true })
    }
  } catch {
    // 临时文件写入失败不阻断主流程
  }

  try {
    execSync('npx prisma db push --accept-data-loss', {
      cwd: ctx.serverDir,
      encoding: 'utf-8',
      windowsHide: true,
      stdio: 'inherit',
    })
    return true
  } catch {
    return false
  }
}

// ============================== 代码同步（update / setup 共用） ==============================

export interface SyncResult {
  status: 'updated' | 'up-to-date' | 'cancelled' | 'failed'
  oldHead?: string
  newHead?: string
}

/**
 * git fetch + reset --hard（同 CI 部署策略）。
 * 仓库地址与 setup 克隆一致（REPO_URL，默认 HTTPS，可用 LINEWEB_REPO_URL 覆盖），
 * 不依赖本地 origin 配置；有本地改动时列出并要求确认（assumeYes 跳过确认）。
 */
export async function syncToRemote(
  ctx: Context,
  opts: { interactive: boolean; assumeYes: boolean }
): Promise<SyncResult> {
  const exec = (cmd: string): string =>
    execSync(cmd, {
      cwd: ctx.root,
      encoding: 'utf-8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })?.toString() ?? ''

  info(`正在从 ${REPO_URL} 获取最新代码...`)
  let fetched = false
  for (let i = 1; i <= 3; i++) {
    try {
      exec(`git fetch "${REPO_URL}" master`)
      fetched = true
      break
    } catch {
      if (i < 3) {
        warn(`fetch 失败（第 ${i}/3 次），5 秒后重试...`)
        await sleep(5000)
      }
    }
  }
  if (!fetched) {
    err('无法连接代码仓库，请检查网络后重试')
    return { status: 'failed' }
  }

  const oldHead = exec('git rev-parse HEAD').trim()
  const behind = Number(exec('git rev-list HEAD..FETCH_HEAD --count').trim())
  if (!Number.isFinite(behind) || behind <= 0) {
    ok(`已是最新版本（${oldHead.slice(0, 7)}）`)
    return { status: 'up-to-date', oldHead, newHead: oldHead }
  }

  const incoming = exec('git log --oneline HEAD..FETCH_HEAD').trim().split('\n')
  info(`共 ${behind} 个新更新：`)
  for (const line of incoming.slice(0, 20)) console.log(`    ${c.dim}${line}${c.reset}`)
  if (behind > 20) console.log(`    ${c.dim}... 其余 ${behind - 20} 条省略${c.reset}`)

  // reset --hard 会覆盖已跟踪文件的改动，未跟踪文件（如 .env）不受影响
  const dirty = exec('git status --porcelain').trim()
  if (dirty) {
    const changed = dirty.split('\n')
    warn(`存在 ${changed.length} 处本地改动，将被${c.bold}覆盖${c.reset}${c.yellow}：`)
    for (const line of changed.slice(0, 10)) console.log(`    ${c.dim}${line}${c.reset}`)
    if (changed.length > 10) console.log(`    ${c.dim}... 其余 ${changed.length - 10} 条省略${c.reset}`)
    const confirmed = opts.assumeYes || (await confirm('确定覆盖本地改动并更新吗？', opts.interactive))
    if (!confirmed) {
      info('已取消更新')
      if (!opts.interactive && !opts.assumeYes) info('非交互模式可使用 --yes 跳过确认')
      return { status: 'cancelled', oldHead }
    }
  }

  info('正在更新代码（git reset --hard FETCH_HEAD）...')
  try {
    exec('git reset --hard FETCH_HEAD')
  } catch {
    err('git reset 失败，请手动检查仓库状态')
    return { status: 'failed', oldHead }
  }
  const newHead = exec('git log -1 --oneline').trim()
  ok(`代码已更新：${newHead}`)
  return { status: 'updated', oldHead, newHead }
}

// ============================== update ==============================

export async function cmdUpdate(
  ctx: Context,
  opts: { yes: boolean; interactive: boolean }
): Promise<boolean> {
  const exec = (cmd: string, inherit = false): string =>
    execSync(cmd, {
      cwd: ctx.root,
      encoding: 'utf-8',
      windowsHide: true,
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    })?.toString() ?? ''

  // 互斥锁：防止手动 update 与自动更新（autoupdate）并发执行
  const lockFile = path.join(ctx.stateDir, 'update.lock')
  try {
    if (fs.existsSync(lockFile)) {
      const pid = Number(fs.readFileSync(lockFile, 'utf-8'))
      if (pid > 0 && isProcessAlive(pid)) {
        warn(`已有更新正在进行（PID ${pid}），本次跳过`)
        return true
      }
      info('检测到残留的更新锁，清理后继续')
    }
    fs.writeFileSync(lockFile, String(process.pid), 'utf-8')
  } catch {
    // 锁文件不可写时不阻断主流程（无并发保护）
  }

  try {
    const state0 = readState(ctx.stateFile)
    const storageRunning = state0.storage ? isProcessAlive(state0.storage.pid) : false
    const wasRunning = isPortListening(PORTS.server) || isPortListening(PORTS.client)
    if (wasRunning || storageRunning) info('检测到服务正在运行，更新完成后将自动重启')

    const sync = await syncToRemote(ctx, { interactive: opts.interactive, assumeYes: opts.yes })
    if (sync.status === 'cancelled' || sync.status === 'failed') return false

    // 安装依赖（根 postinstall 级联安装 server/client）
    info('正在安装依赖（npm install）...')
    try {
      exec('npm install', true)
    } catch {
      err('依赖安装失败，请手动执行 npm install 后重试')
      return false
    }
    ok('依赖安装完成')

    // 同步数据库结构（本地 SQLite 开发库）
    info('正在同步数据库结构（prisma db push）...')
    if (pushDatabase(ctx)) ok('数据库同步完成')
    else warn('数据库同步失败，请手动执行 npm run db:push 检查')

    // 提示 CLI 自身是否有更新
    if (sync.status === 'updated' && sync.oldHead) {
      try {
        const cliChanged = exec(`git diff --name-only ${sync.oldHead} HEAD -- cli/`).trim()
        if (cliChanged) warn('本次更新包含 CLI 代码变更，请执行 npm run build:cli 重新构建 exe')
      } catch {
        // 忽略，不影响主流程
      }
    }

    // 更新前在运行则自动重启
    if (wasRunning || storageRunning) {
      return cmdRestart(ctx, { storage: storageRunning })
    }
    info('更新前服务未在运行，需要时执行 start 启动')
    return true
  } finally {
    try {
      fs.rmSync(lockFile, { force: true })
    } catch {
      // 忽略
    }
  }
}

// ============================== setup ==============================

/** 从 .env 文件读取指定键的值（简单行解析，去除引号） */
function readEnvValue(envPath: string, key: string): string | null {
  try {
    const content = fs.readFileSync(envPath, 'utf-8')
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`))
      if (m) return m[1].trim().replace(/^["']|["']$/g, '')
    }
  } catch {
    // 忽略
  }
  return null
}

/**
 * 一键安装：克隆代码（或同步已有仓库）→ 安装依赖 → 生成 .env → 初始化数据库 → 启动服务。
 * ctx 为 null 时执行全新克隆（克隆到当前目录的 LineWeb/ 下）。
 */
export async function cmdSetup(
  ctx: Context | null,
  opts: { storage: boolean; interactive: boolean }
): Promise<boolean> {
  // 1. 前置工具检查
  if (!commandExists('git')) {
    err('未检测到 Git，请先安装并加入 PATH（https://git-scm.com）')
    return false
  }
  if (!findNodeExe() || !commandExists('npm')) {
    err('未检测到 Node.js/npm，请先安装 Node 18+ 并加入 PATH（https://nodejs.org）')
    return false
  }

  // 2. 获取项目代码
  if (ctx) {
    info(`检测到已有项目：${ctx.root}`)
    const sync = await syncToRemote(ctx, { interactive: opts.interactive, assumeYes: false })
    if (sync.status === 'cancelled' || sync.status === 'failed') return false
  } else {
    const target = path.join(process.cwd(), 'LineWeb')
    if (fs.existsSync(target)) {
      err(`目录 ${target} 已存在且不是 LineWeb 项目，请处理后重试`)
      return false
    }
    // 克隆通道：直连 HTTPS → gh-proxy 镜像 → SSH（直连被墙时自动降级）
    const sources: { label: string; url: string }[] = process.env.LINEWEB_REPO_URL
      ? [{ label: '自定义仓库地址（LINEWEB_REPO_URL）', url: REPO_URL }]
      : [
          { label: 'GitHub（HTTPS）', url: REPO_URL },
          ...(REPO_URL.startsWith('https://github.com/')
            ? [
                { label: 'gh-proxy 镜像', url: `https://gh-proxy.com/${REPO_URL}` },
                { label: 'GitHub（SSH）', url: REPO_URL.replace('https://github.com/', 'git@github.com:') },
              ]
            : []),
        ]
    info(`正在克隆代码到 ${target} ...`)
    let cloned = false
    let usedSource = ''
    for (const src of sources) {
      info(`尝试从 ${src.label} 克隆...`)
      try {
        execSync(`git clone "${src.url}" "${target}"`, {
          encoding: 'utf-8',
          windowsHide: true,
          stdio: 'inherit',
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
            GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
          },
        })
        cloned = true
        usedSource = src.label
        break
      } catch {
        fs.rmSync(target, { recursive: true, force: true })
        warn(`从 ${src.label} 克隆失败`)
      }
    }
    if (!cloned) {
      err('所有克隆通道均失败，请检查网络后重试（也可设置 LINEWEB_REPO_URL 指定仓库地址）')
      return false
    }
    const fresh = contextFrom(target)
    if (!fresh) {
      err('克隆结果异常（缺少 package.json），请删除后重试')
      return false
    }
    ctx = fresh
    ok(`代码克隆完成（来源：${usedSource}）`)
  }

  // exe 位于项目外时写入指针文件，供后续命令定位
  const exeDir = path.dirname(process.execPath)
  const rel = path.relative(ctx.root, exeDir)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    try {
      fs.writeFileSync(pointerFile(), ctx.root, 'utf-8')
      info(`已记录项目位置（${pointerFile()}）`)
    } catch {
      // 无写入权限时忽略，可用 LINEWEB_ROOT 环境变量代替
    }
  }

  // 3. 安装依赖（根 postinstall 级联安装 server/client）
  info('正在安装依赖（npm install，可能需要几分钟）...')
  try {
    execSync('npm install', { cwd: ctx.root, encoding: 'utf-8', windowsHide: true, stdio: 'inherit' })
  } catch {
    err('依赖安装失败，请手动执行 npm install 后重新运行 setup')
    return false
  }
  ok('依赖安装完成')

  // 4. 配置 server/.env
  const envPath = path.join(ctx.serverDir, '.env')
  let storageToken: string | null
  if (fs.existsSync(envPath)) {
    info('server/.env 已存在，保留现有配置')
    storageToken = readEnvValue(envPath, 'STORAGE_NODE_TOKEN')
  } else {
    const jwtSecret = crypto.randomBytes(32).toString('hex')
    storageToken = crypto.randomBytes(16).toString('hex')
    fs.writeFileSync(
      envPath,
      `DATABASE_URL="file:./dev.db"\nJWT_SECRET="${jwtSecret}"\nSTORAGE_NODE_TOKEN="${storageToken}"\n`,
      'utf-8'
    )
    ok('已创建 server/.env（JWT_SECRET 与网盘存储 token 随机生成）')
  }

  // 5. 初始化数据库（seed 幂等，可重复执行）
  info('正在同步数据库结构（prisma db push）...')
  if (!pushDatabase(ctx)) {
    err('数据库结构同步失败，请手动执行 npm run db:push 检查')
    return false
  }
  info('正在初始化种子数据（管理员账号与示例文章）...')
  try {
    execSync('npm run db:seed', { cwd: ctx.root, encoding: 'utf-8', windowsHide: true, stdio: 'inherit' })
    ok('数据库就绪')
  } catch {
    warn('种子数据初始化失败，请手动执行 npm run db:seed 检查')
  }

  // 6. 启动服务
  info('正在启动服务...')
  const started = await cmdStart(ctx, { storage: opts.storage })
  console.log()
  if (storageToken) {
    console.log(`  ${c.bold}网盘存储节点 Token：${c.reset}${c.cyan}${storageToken}${c.reset}`)
    console.log(`  ${c.dim}存储节点 config.json 的 token 字段（或环境变量 LINEWEB_STORAGE_TOKEN）需与此一致${c.reset}`)
  }
  if (started) {
    console.log(`  ${c.dim}管理后台：http://localhost:${PORTS.client}/admin（admin@lineweb.dev / admin123）${c.reset}`)
  }
  return started
}

// ============================== logs ==============================

export async function cmdLogs(
  ctx: Context,
  name: ServiceName,
  follow: boolean
): Promise<boolean> {
  const file = logPath(ctx, name)
  if (!fs.existsSync(file)) {
    warn(`暂无 ${name} 的日志（日志文件不存在）`)
    return true
  }

  if (!follow) {
    const content = fs.readFileSync(file, 'utf-8').trimEnd()
    if (!content) {
      info(`${name} 的日志为空`)
      return true
    }
    const lines = content.split('\n')
    console.log(`${c.dim}—— ${name} 最近 ${Math.min(30, lines.length)} 行日志 ——${c.reset}`)
    console.log(lines.slice(-30).join('\n'))
    return true
  }

  // 持续跟踪模式（仅命令行直调模式）
  let offset = fs.statSync(file).size
  process.stdout.write(fs.readFileSync(file, 'utf-8'))
  info('持续跟踪日志中，按 Ctrl+C 退出')
  const watcher = fs.watch(file, () => {
    try {
      const size = fs.statSync(file).size
      if (size < offset) offset = 0 // 文件被截断则从头读
      if (size > offset) {
        const fd = fs.openSync(file, 'r')
        const buf = Buffer.alloc(size - offset)
        fs.readSync(fd, buf, 0, buf.length, offset)
        fs.closeSync(fd)
        offset = size
        process.stdout.write(buf.toString('utf-8'))
      }
    } catch {
      // 文件瞬时状态异常，忽略等待下次事件
    }
  })
  await new Promise<void>((resolve) => {
    process.once('SIGINT', () => {
      watcher.close()
      console.log()
      resolve()
    })
  })
  return true
}

// ============================== open ==============================

export function cmdOpen(): boolean {
  const url = `http://localhost:${PORTS.client}`
  try {
    execSync(`start "" "${url}"`, { windowsHide: true, stdio: 'ignore' })
    ok(`已在浏览器打开：${url}`)
    return true
  } catch {
    err('打开浏览器失败')
    return false
  }
}
