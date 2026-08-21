import readline from 'node:readline'

// ANSI 颜色（直接输出转义码，零依赖）
export const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

export const ok = (msg: string): void => console.log(`${c.green}✓${c.reset} ${msg}`)
export const warn = (msg: string): void => console.log(`${c.yellow}!${c.reset} ${msg}`)
export const err = (msg: string): void => console.log(`${c.red}✗${c.reset} ${msg}`)
export const info = (msg: string): void => console.log(`${c.cyan}·${c.reset} ${msg}`)

export function banner(version: string, root: string): void {
  console.log()
  console.log(`  ${c.bold}${c.cyan}LineWeb CLI${c.reset}  ${c.dim}v${version}${c.reset}`)
  console.log(`  ${c.dim}项目根目录：${root}${c.reset}`)
  console.log(`  ${c.dim}输入 ${c.reset}help${c.dim} 查看可用命令，${c.reset}exit${c.dim} 退出${c.reset}`)
  console.log()
}

export const HELP_TEXT = `
可用命令：
  ${c.bold}setup${c.reset} [--no-storage]      一键安装：克隆/更新代码 → 装依赖 → 配置 env → 初始化数据库 → 启动服务
  ${c.bold}start${c.reset} [--no-storage]      启动服务（后端 + 前端 + 存储节点）
  ${c.bold}stop${c.reset}                        停止所有服务
  ${c.bold}restart${c.reset} [--no-storage]      重启所有服务
  ${c.bold}status${c.reset}                      查看服务运行状态
  ${c.bold}update${c.reset} [--yes]              从 GitHub 拉取最新版本并重装依赖
  ${c.bold}autoupdate${c.reset} [on|off|status] [--interval 6h]   定时自动执行 update（默认每 6 小时，m/h/d）
  ${c.bold}logs${c.reset} [server|client|storage] [-f]   查看日志（-f 持续跟踪）
  ${c.bold}open${c.reset}                        打开浏览器访问前端页面
  ${c.bold}help${c.reset}                        显示本帮助
  ${c.bold}exit${c.reset}                        退出 CLI（后台服务不受影响）
`

// ---- REPL 交互支持 ----

let rl: readline.Interface | null = null

export function setReplInterface(iface: readline.Interface): void {
  rl = iface
}

/**
 * 交互式确认。交互模式下询问用户；非交互模式直接返回 false
 * （调用方应提示使用 --yes 参数）。
 */
export async function confirm(question: string, interactive: boolean): Promise<boolean> {
  if (!interactive || !rl) return false
  return new Promise<boolean>((resolve) => {
    rl!.question(`${c.yellow}?${c.reset} ${question} (y/n) `, (answer) => {
      resolve(answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes')
    })
  })
}
