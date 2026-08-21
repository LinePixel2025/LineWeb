// LineWeb CLI 构建脚本：esbuild 打包单文件 → pkg 编译为 Windows exe
import { build } from 'esbuild'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(cliDir)

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))

console.log(`正在打包 cli v${pkg.version}...`)
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: 'dist/cli.cjs',
  define: { CLI_VERSION: JSON.stringify(pkg.version) },
  logLevel: 'info',
})

console.log('正在编译为 exe（首次构建需下载 Node 基础二进制，请耐心等待）...')
execSync('npx pkg dist/cli.cjs --targets node22-win-x64 --output dist/LineWebCLI.exe', {
  stdio: 'inherit',
})

console.log(`\n构建完成：${path.join(cliDir, 'dist', 'LineWebCLI.exe')}`)
