import readline from 'node:readline'
import fs from 'node:fs'
import { execSync } from 'node:child_process'
import { resolveContext, tryResolveContext, Context } from './context'
import { banner, HELP_TEXT, c, err, warn, setReplInterface } from './ui'
import { ServiceName } from './processes'
import {
  cmdStart,
  cmdStop,
  cmdRestart,
  cmdStatus,
  cmdUpdate,
  cmdLogs,
  cmdOpen,
  cmdSetup,
} from './commands'
import { cmdAutoUpdate } from './autoupdate'

// 由 esbuild define 注入；tsx 开发模式下未定义则回退 dev
declare const CLI_VERSION: string | undefined
const VERSION = typeof CLI_VERSION !== 'undefined' ? CLI_VERSION : 'dev'

// Windows 控制台切换到 UTF-8，避免中文乱码（尽力而为）
if (process.platform === 'win32') {
  try {
    execSync('chcp 65001', { stdio: 'ignore', windowsHide: true })
  } catch {
    // 忽略
  }
}

interface Flags {
  yes: boolean
  noStorage: boolean
  follow: boolean
}

function parseFlags(args: string[]): Flags {
  return {
    yes: args.includes('--yes') || args.includes('-y'),
    noStorage: args.includes('--no-storage'),
    follow: args.includes('-f') || args.includes('--follow'),
  }
}

const LOG_TARGETS: ServiceName[] = ['server', 'client', 'storage']

async function dispatch(
  ctx: Context,
  name: string,
  args: string[],
  interactive: boolean
): Promise<boolean> {
  const flags = parseFlags(args)
  switch (name) {
    case 'setup':
      return cmdSetup(ctx, { storage: !flags.noStorage, interactive })
    case 'start':
      return cmdStart(ctx, { storage: !flags.noStorage })
    case 'stop':
      return cmdStop(ctx)
    case 'restart':
      return cmdRestart(ctx, { storage: !flags.noStorage })
    case 'status':
      return cmdStatus(ctx)
    case 'update':
      return cmdUpdate(ctx, { yes: flags.yes, interactive })
    case 'autoupdate':
      return cmdAutoUpdate(ctx, args, { interactive })
    case 'logs': {
      const target = args.find((a) => (LOG_TARGETS as string[]).includes(a)) as
        | ServiceName
        | undefined
      if (flags.follow && interactive) {
        warn('REPL 内暂不支持持续跟踪，请在命令行执行：LineWebCLI.exe logs ' + (target ?? 'server') + ' -f')
      }
      return cmdLogs(ctx, target ?? 'server', flags.follow && !interactive)
    }
    case 'open':
      return cmdOpen()
    case 'help':
    case '?':
      console.log(HELP_TEXT)
      return true
    case 'version':
    case '--version':
    case '-v':
      console.log(VERSION)
      return true
    default:
      err(`未知命令：${name}`)
      console.log(HELP_TEXT)
      return false
  }
}

async function repl(ctx: Context): Promise<void> {
  banner(VERSION, ctx.root)
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  setReplInterface(rl)

  let busy = false
  let stdinClosed = false
  let everInput = false
  const queue: string[] = []

  const shutdown = (): void => {
    rl.close()
    process.exit(0)
  }

  rl.on('SIGINT', () => {
    console.log()
    shutdown()
  })
  rl.on('close', () => {
    stdinClosed = true
    if (!busy) {
      if (!everInput) {
        console.log()
        console.log('检测到输入已关闭，交互式控制台退出。')
        console.log('请使用命令行方式运行：LineWebCLI.exe <命令>')
        holdExit(0)
      }
      shutdown()
    }
  })

  const processQueue = async (): Promise<void> => {
    if (busy) return
    busy = true
    while (queue.length > 0) {
      const line = queue.shift()!
      const parts = line.split(/\s+/).filter(Boolean)
      if (parts.length === 0) continue
      const [name, ...rest] = parts
      if (name === 'exit' || name === 'quit') shutdown()
      try {
        await dispatch(ctx, name, rest, true)
      } catch (e) {
        err(`命令执行出错：${e instanceof Error ? e.message : String(e)}`)
      }
    }
    busy = false
    if (stdinClosed) shutdown()
    rl.prompt()
  }

  rl.setPrompt(`${c.cyan}lineweb>${c.reset} `)
  rl.on('line', (line) => {
    everInput = true
    queue.push(line.trim())
    void processQueue()
  })
  rl.prompt()
}

/**
 * 退出前在交互终端下暂停等待按键。
 * Windows 双击运行 exe 时窗口随进程退出立即关闭，直接 process.exit 会让错误一闪而过；
 * 在 TTY 下同步阻塞读取 stdin 等待用户按键，错误信息可保留在屏幕上。非交互环境直接退出。
 */
function holdExit(code: number): never {
  if (process.stdin.isTTY) {
    console.log('\n按任意键退出...')
    try {
      const buf = Buffer.alloc(1)
      fs.readSync(0, buf, 0, 1, null)
    } catch {
      // 读取失败（stdin 异常）时直接退出
    }
  }
  process.exit(code)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  // setup 支持在无项目根的场景运行（全新机器一键安装）
  if (args.length > 0 && args[0] === 'setup') {
    const flags = parseFlags(args.slice(1))
    try {
      const success = await cmdSetup(tryResolveContext(), {
        storage: !flags.noStorage,
        interactive: false,
      })
      process.exitCode = success ? 0 : 1
    } catch (e) {
      err(`命令执行出错：${e instanceof Error ? e.message : String(e)}`)
      process.exitCode = 1
    }
    return
  }

  // 无参数 → 交互式 REPL（双击 exe 的主入口）
  if (args.length === 0) {
    // 非交互环境（stdin 已关闭/管道）：进入 REPL 会因 stdin EOF 立即退出，应明确提示
    if (!process.stdin.isTTY) {
      console.log()
      console.log(`${c.bold}${c.cyan}LineWeb CLI${c.reset}  ${c.dim}v${VERSION}${c.reset}`)
      console.log('当前为非交互式环境（标准输入已关闭或非终端），无法进入交互式控制台。')
      console.log('请使用命令行方式执行单条命令，例如：')
      console.log(`  ${c.bold}LineWebCLI.exe setup${c.reset}          全新机器一键安装`)
      console.log(`  ${c.bold}LineWebCLI.exe start${c.reset}          启动服务`)
      console.log(`  ${c.bold}LineWebCLI.exe status${c.reset}         查看运行状态`)
      console.log(`  ${c.bold}LineWebCLI.exe update --yes${c.reset}   更新代码`)
      console.log(`  ${c.bold}LineWebCLI.exe autoupdate on${c.reset}  开启自动更新`)
      process.exit(1)
    }

    const ctx = tryResolveContext()
    if (!ctx) {
      console.error('错误：找不到 LineWeb 项目根目录（name 为 "lineweb" 的 package.json）。')
      console.error('请将本程序放在项目目录内、设置环境变量 LINEWEB_ROOT，或先运行 setup 一键安装。')
      holdExit(1)
    }
    await repl(ctx)
    return
  }

  const ctx = resolveContext()
  const [name, ...rest] = args
  try {
    const success = await dispatch(ctx, name, rest, false)
    process.exitCode = success ? 0 : 1
  } catch (e) {
    err(`命令执行出错：${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e))
  holdExit(1)
})
