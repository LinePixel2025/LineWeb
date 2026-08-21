import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'
import iconv from 'iconv-lite'
import { Context, pointerFile } from './context'
import { c, ok, warn, err, info } from './ui'

/**
 * 自动更新：注册 Windows 计划任务，每隔一段时间自动执行 `update --yes`。
 * 用计划任务而非 CLI 内部定时器，重启后依然生效，且不依赖 CLI 进程常驻。
 */

/** 计划任务名（固定，便于查询/删除） */
const TASK_NAME = 'LineWeb-AutoUpdate'

interface IntervalSpec {
  /** 展示文案，如“每 6 小时” */
  label: string
  /** ISO-8601 重复间隔，如 PT6H / PT30M / P1D */
  repetition: string
}

/** 解析间隔参数：数字 + 单位（m=分钟 h=小时 d=天），默认 6h */
export function parseInterval(raw: string | undefined): IntervalSpec | null {
  const input = raw ?? '6h'
  const m = input.match(/^(\d+)(m|h|d)?$/)
  if (!m) return null
  const n = Number(m[1])
  const unit = m[2] ?? 'h'
  if (!Number.isInteger(n) || n <= 0) return null
  switch (unit) {
    case 'm':
      if (n > 1440) return null
      return { label: `每 ${n} 分钟`, repetition: `PT${n}M` }
    case 'h':
      if (n > 24) return null
      return { label: `每 ${n} 小时`, repetition: `PT${n}H` }
    case 'd':
      if (n > 365) return null
      return { label: `每 ${n} 天`, repetition: `P${n}D` }
    default:
      return null
  }
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** 生成计划任务 XML（MultipleInstancesPolicy=IgnoreNew 防止并发重复更新） */
function buildXml(ctx: Context, runnerBat: string, spec: IntervalSpec): string {
  const now = new Date()
  const start = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(
    now.getHours()
  )}:${pad(now.getMinutes())}:00`
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Date>${now.toISOString()}</Date>
    <Author>LineWeb CLI</Author>
    <Description>LineWeb 自动更新（${spec.label}，执行 update --yes）</Description>
    <URI>\\${TASK_NAME}</URI>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>${start}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
      <Repetition>
        <Interval>${spec.repetition}</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${os.userInfo().username}</UserId>
      <LogonType>S4U</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${runnerBat}</Command>
      <WorkingDirectory>${ctx.root}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>`
}

/** 计划任务运行 exe 时可能不在项目目录，确保指针文件存在以便定位项目根 */
function ensurePointerFile(ctx: Context): void {
  try {
    const pf = pointerFile()
    const current = fs.existsSync(pf) ? fs.readFileSync(pf, 'utf-8').trim() : ''
    if (current !== ctx.root) {
      fs.writeFileSync(pf, ctx.root, 'utf-8')
      info(`已记录项目位置（${pf}）`)
    }
  } catch {
    // 无写入权限时忽略；XML 的 WorkingDirectory 与 LINEWEB_ROOT 可兜底
  }
}

interface TaskInfo {
  exists: boolean
  /** schtasks /Query /V /FO LIST 输出 */
  raw: string
}

function queryTask(): TaskInfo {
  try {
    // schtasks 输出为系统 ANSI 代码页（中文系统 GBK），pkg 内 Node 无 ICU 需 iconv 转码
    const buf = execSync(`schtasks /Query /TN "${TASK_NAME}" /V /FO LIST`, {
      encoding: 'buffer',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as Buffer
    const out = iconv.decode(buf, 'gbk')
    return { exists: true, raw: out }
  } catch {
    return { exists: false, raw: '' }
  }
}

/** 从任务详情中提取字段（兼容中文/英文系统） */
function extract(lines: string, zh: string, en: string): string | null {
  const m = lines.match(
    new RegExp(`(?:${zh}|${en})\\s*[:：]?\\s*([^\\r\\n]+)`)
  )
  return m ? m[1].trim() : null
}

/** schtasks 运行结果码 → 可读描述（0x41303=尚未运行，0=成功） */
function describeResult(code: string): string {
  const n = Number(code)
  if (Number.isFinite(n)) {
    if (n === 0) return '上次运行成功'
    if (n === 0x41303) return '尚未运行'
  }
  return `上次结果 0x${n.toString(16).toUpperCase()}`
}

// ============================== enable ==============================

/**
 * 生成计划任务实际运行的 .bat。
 * S4U 登录类型不加载用户环境变量，需显式设置 HOME/APPDATA/PATH 等，
 * 否则 git/npm/node 找不到或无法写缓存；PATH 使用注册/开启时的完整值。
 * 输出重定向到 .lineweb-cli/logs/autoupdate.log 便于排查。
 */
function buildRunnerBat(ctx: Context, exePath: string): string {
  const home = os.homedir()
  const local = path.join(home, 'AppData', 'Local')
  const roam = path.join(home, 'AppData', 'Roaming')
  const tmp = path.join(local, 'Temp')
  const esc = (s: string): string => s.replace(/%/g, '%%')
  const set = (k: string, v: string): string => `set "${k}=${esc(v)}"`
  const logFile = path.join(ctx.logsDir, 'autoupdate.log')
  const lines = [
    '@echo off',
    'rem LineWeb autoupdate runner (generated by LineWeb CLI)',
    set('HOME', home),
    set('USERPROFILE', home),
    set('APPDATA', roam),
    set('LOCALAPPDATA', local),
    set('TEMP', tmp),
    set('TMP', tmp),
    set('PATH', process.env.PATH ?? ''),
    `"${esc(exePath)}" update --yes >> "${esc(logFile)}" 2>&1`,
  ]
  return lines.join('\r\n')
}

function enable(ctx: Context, args: string[]): boolean {
  const i = args.indexOf('--interval')
  const raw = i >= 0 ? args[i + 1] : undefined
  if (i >= 0 && !raw) {
    err('--interval 缺少参数，示例：autoupdate on --interval 6h')
    return false
  }
  const spec = parseInterval(raw)
  if (!spec) {
    err('间隔格式无效，示例：30m / 6h / 1d（m=分钟 h=小时 d=天）')
    return false
  }

  const exePath = process.execPath
  if (!exePath.endsWith('.exe')) {
    err('自动更新依赖打包后的 exe（当前以 tsx 开发模式运行，请先 npm run build 构建）')
    return false
  }
  ensurePointerFile(ctx)

  // S4U 登录类型不加载用户环境，先生成运行脚本（含完整 PATH 与环境变量）
  const batPath = path.join(ctx.stateDir, 'autoupdate-run.bat')
  try {
    fs.writeFileSync(batPath, buildRunnerBat(ctx, exePath), 'ascii')
  } catch {
    err('无法写入运行脚本，请检查 .lineweb-cli 目录权限')
    return false
  }

  const xmlPath = path.join(ctx.stateDir, 'autoupdate-task.xml')
  try {
    // schtasks 解析 UTF-16 XML 需要 BOM，Node 的 utf16le 不带 BOM，需手动前置 \uFEFF
    fs.writeFileSync(xmlPath, '\uFEFF' + buildXml(ctx, batPath, spec), 'utf16le')
  } catch {
    err('无法写入计划任务临时文件，请检查 .lineweb-cli 目录权限')
    return false
  }

  try {
    execSync(`schtasks /Create /F /TN "${TASK_NAME}" /XML "${xmlPath}"`, {
      encoding: 'utf-8',
      windowsHide: true,
      stdio: 'inherit',
    })
  } catch {
    err('注册计划任务失败，请确认当前用户有权限（普通用户一般无需管理员）')
    fs.rmSync(xmlPath, { force: true })
    return false
  }
  fs.rmSync(xmlPath, { force: true })

  ok(`已开启自动更新：${spec.label}执行 update --yes`)
  info('以无人登录（S4U）方式运行，无需保持登录；日志见 .lineweb-cli/logs/autoupdate.log')
  info('后台服务在运行时会自动重启；可随时用 autoupdate status 查看，autoupdate off 关闭')
  return true
}

// ============================== disable ==============================

function disable(): boolean {
  try {
    execSync(`schtasks /Delete /TN "${TASK_NAME}" /F`, {
      encoding: 'utf-8',
      windowsHide: true,
      stdio: 'inherit',
    })
  } catch {
    err('关闭自动更新失败（任务可能不存在或无权删除）')
    return false
  }
  ok('已关闭自动更新')
  return true
}

// ============================== status ==============================

function status(ctx: Context): boolean {
  const task = queryTask()
  if (!task.exists) {
    warn('自动更新未开启')
    info('开启：autoupdate on [--interval 6h]')
    return true
  }
  const lines = task.raw
  const interval = extract(lines, '重复: 每', 'Repeat: Every')
  const next = extract(lines, '下次运行时间', 'Next Run Time')
  const last = extract(lines, '上次运行时间', 'Last Run Time')
  const result = extract(lines, '上次结果', 'Last Result')
  const status_ = extract(lines, '计划任务状态', 'Status')
  const logon = extract(lines, '登录状态', 'Logon Status') ?? extract(lines, '登录模式', 'Logon Mode')

  ok('自动更新已开启')
  if (interval) console.log(`  间隔：${c.dim}${interval}${c.reset}`)
  if (status_) console.log(`  任务状态：${c.dim}${status_}${c.reset}`)
  if (logon) console.log(`  登录模式：${c.dim}${logon}${c.reset}`)
  if (next) console.log(`  下次运行：${c.dim}${next}${c.reset}`)
  if (last && result) console.log(`  上次运行：${c.dim}${last}（${describeResult(result)}）${c.reset}`)
  console.log()
  console.log(`  ${c.dim}计划任务名：${TASK_NAME}（可在“任务计划程序”中查看或修改）${c.reset}`)
  console.log(`  ${c.dim}关闭：autoupdate off${c.reset}`)
  return true
}

// ============================== 入口 ==============================

export async function cmdAutoUpdate(
  ctx: Context,
  args: string[],
  _opts: { interactive: boolean }
): Promise<boolean> {
  const sub = args[0]
  if (sub === 'off' || sub === 'disable') return disable()
  if (sub === 'status') return status(ctx)
  if (sub === undefined || sub === 'on' || sub === 'enable' || sub.startsWith('--')) {
    return enable(ctx, args)
  }
  err(`未知参数：${sub}`)
  console.log('  用法：autoupdate on [--interval 6h] | autoupdate off | autoupdate status')
  return false
}
