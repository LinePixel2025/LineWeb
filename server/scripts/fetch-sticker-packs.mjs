#!/usr/bin/env node
/**
 * 抓取并生成表情商店素材（奶龙 / 呆猫）
 *
 * 用法（需要本机已登录 gh CLI）：
 *   cd server && node scripts/fetch-sticker-packs.mjs
 *
 * 行为：
 *   1. 用 `gh api` 从公开表情图库下载精选文件（只下清单内的，不拉全仓库）
 *   2. 统一压到最长边 360px：静态图 JPEG/PNG，动图 GIF（保留动画、128 色）
 *   3. 写入 client/public/stickers/shop/<pack>/，并补上来源 LICENSE.txt
 *
 * 素材清单与 client/src/lib/stickers.ts 的 ENTRIES 必须保持一致（client 测试会校验文件一一对应）。
 * 新增/替换素材时：改这里的清单 → 重跑 → 同步 stickers.ts。
 *
 * 版权：两个来源仓库的许可仅覆盖其代码与收集整理工作；形象版权归原权利方所有，
 * 素材仅供个人聊天使用，不得商用。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(SCRIPT_DIR, '../..')
const OUT_ROOT = path.join(ROOT, 'client/public/stickers/shop')
const CACHE_ROOT = path.join(os.tmpdir(), 'lineweb-sticker-cache')

/** 奶龙：GeorgeNaNN/nailong-memes（MIT） */
const NAILONG_STATIC = [
  ['images/01BEF394F197C969AF1D293C2B86B75E.jpg', 'meeting'],
  ['images/0e7aa11d6d5d00ba12a24e147bb02654.jpg', 'newspaper'],
  ['images/11B0AD0BE894AE929291EF5B7BA119C6.jpg', 'wave'],
  ['images/17C62A7AC359814D375A7FC37382DD4A.jpg', 'hug'],
  ['images/1d58f5bc64278dd82fa9738670c6a7ce.jpg', 'sweet'],
  ['images/274d629bfa4fc646138fe36ea27f3f35.jpg', 'defiant'],
  ['images/2EC91AB5920CA4C4DA480F5EFD0DA10E.jpg', 'handstand'],
  ['images/367aaf3f9b80de98d1da27597d9156fe.jpg', 'punch'],
  ['images/4f24b3ec7d290217f2e867df6a659a69.jpg', 'laugh'],
  ['images/5149D45A84B61F3D538EB7F4BD8EF57C.jpg', 'cheer'],
  ['images/522b5f888cffd66abd8bd705e6598bad.jpg', 'akimbo'],
  ['images/61919F0C50F97AC3AB7A476C4E893102.jpg', 'chin'],
  ['images/706DF161165F0563317CFE4122C88A3D.jpg', 'soccer'],
  ['images/72d3a232a303424396473b3c287223ec.jpg', 'meditate'],
  ['images/84a5c63b0b8119a0651dcba6f649093e.jpg', 'shush'],
  ['images/8eca876e50b8fcaed66f3301158085ea.jpg', 'police'],
  ['images/93fd379de0b7ef1f00274e53cb6f02a0.jpg', 'cry'],
  ['images/9A640FCE9DD95746A6254806682D3395.jpg', 'shock'],
  ['images/B25A9251B83C7B06077223A9D4A546D0.jpg', 'thumb'],
  ['images/CF0E9EB8A8B36AC7C06F03F2B955794A.jpg', 'milktea'],
  ['images/D42412FFAEA2B67AC6CA9EBE53B53768.jpg', 'rofl'],
  ['images/DF6C6ABBE88D0DE497EB8F3D48190D1A.jpg', 'double-thumb'],
  ['images/E314D78C748F0646029B5D69AFEC59B9.jpg', 'eat'],
  ['images/c7dd8b96b538c95880cb9accbca14efb.jpg', 'speechless'],
  ['images/cdc8baf08a03f76841089cedd31564eb.jpg', 'angel'],
  ['images/d8faa0faea83b8b8ea865d265c634cf2.jpg', 'happy'],
  ['images/ef135a10fa8d09d6268fcc9b03758c68.jpg', 'glasses'],
  ['images/f55bba1656311e56ee5ca10263a19c67.jpg', 'phone'],
]

const NAILONG_GIF = [
  ['gif/242B39C1E5E91DB01ED6285F86D2D5FD.gif', 'heart'],
  ['gif/5F3832CEB835B150E076CB589A53C604.gif', 'laugh-gif'],
  ['gif/6D34F8AD79540C759A30E724E9230DFC.gif', 'wave-gif'],
  ['gif/71808EA8C5342D504532E0BE5F57F8C7.gif', 'swim'],
  ['gif/9337EA0772D5F796F3D2353D02572405.gif', 'akimbo-gif'],
  ['gif/C209129A7D64057C2D36E9CED0501B7A.gif', 'arms'],
  ['gif/D7BB82FDCEFE4304DEFC2DC1CC132655.gif', 'angel-gif'],
  ['gif/FFFC2EAC8A8DA120ABC5DFC49BE9F8AB.gif', 'cuddle'],
]

/** 呆猫：BI7AQU/Felyne-Memes（GPL-3.0，仓库内 source/） */
const FELYNE = [
  ['hello.gif', 'hello'],
  ['关灯.jpg', 'light-off'],
  ['刀.gif', 'knife'],
  ['吃白饭的猫.jpg', 'rice'],
  ['哭.png', 'cry'],
  ['害羞.jpg', 'shy'],
  ['弄你.jpg', 'annoy'],
  ['抠鼻.gif', 'nose'],
  ['拍手.gif', 'clap'],
  ['拳.gif', 'punch'],
  ['摸.gif', 'touch'],
  ['滚蛋.png', 'roll'],
  ['瞪眼.jpg', 'stare'],
  ['精神小猫.gif', 'spirit'],
  ['给我.jpg', 'gimme'],
  ['跑来跑去.jpg', 'run'],
  ['躺挠.gif', 'scratch'],
  ['送花.jpg', 'flower'],
  ['骑.gif', 'ride'],
]

const SOURCES = {
  nailong: {
    repo: 'GeorgeNaNN/nailong-memes',
    dir: '',
    license: [
      '奶龙表情包素材来源',
      '====================',
      '',
      '来源仓库：https://github.com/GeorgeNaNN/nailong-memes',
      '（AstrBot 插件「来只奶龙」的默认奶龙图库，仓库以 MIT 许可发布）',
      '',
      '抓取与处理：server/scripts/fetch-sticker-packs.mjs',
      '- 仅挑选部分静态图 / 小体积 GIF',
      '- 统一压缩到最长边 360px（GIF 保留动画，128 色）',
      '',
      '版权说明：仓库许可覆盖其代码与收集整理工作；「奶龙」形象版权归原权利方所有。',
      '本目录素材仅供个人聊天使用，不得用于商业用途；如权利人提出异议请删除。',
      '',
    ].join('\n'),
  },
  felyne: {
    repo: 'BI7AQU/Felyne-Memes',
    dir: 'source',
    license: [
      '呆猫表情包素材来源',
      '====================',
      '',
      '来源仓库：https://github.com/BI7AQU/Felyne-Memes',
      '（呆猫表情包收集，仓库以 GPL-3.0 许可发布）',
      '',
      '抓取与处理：server/scripts/fetch-sticker-packs.mjs',
      '- 仅挑选部分静态图 / GIF',
      '- 统一压缩到最长边 360px（GIF 保留动画，128 色）',
      '',
      '版权说明：仓库许可覆盖其代码与收集整理工作；「呆猫」形象版权归原权利方所有。',
      '本目录素材仅供个人聊天使用，不得用于商业用途；如权利人提出异议请删除。',
      '',
    ].join('\n'),
  },
}

function fail(message) {
  console.error(`\n[fetch-sticker-packs] ${message}`)
  process.exit(1)
}

function checkGh() {
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' })
  } catch {
    fail('未检测到可用的 gh CLI 登录状态。请先安装 gh 并执行 `gh auth login`。')
  }
}

function download(repo, remotePath, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  console.log(`  下载 ${repo}/${remotePath}`)
  const buffer = execFileSync(
    'gh',
    ['api', '-H', 'Accept: application/vnd.github.raw', `repos/${repo}/contents/${remotePath}`],
    { maxBuffer: 64 * 1024 * 1024 },
  )
  fs.writeFileSync(dest, buffer)
  return dest
}

function extOf(file) {
  return path.extname(file).toLowerCase()
}

async function writeStatic(src, dest, ext) {
  const pipeline = sharp(src).resize(360, 360, { fit: 'inside', withoutEnlargement: true })
  if (ext === '.png') await pipeline.png({ compressionLevel: 9 }).toFile(dest)
  else await pipeline.jpeg({ quality: 82, mozjpeg: true }).toFile(dest)
}

async function writeGif(src, dest) {
  await sharp(src, { animated: true })
    .resize(360, 360, { fit: 'inside', withoutEnlargement: true })
    .gif({ colours: 128, effort: 7 })
    .toFile(dest)
}

async function buildPack(packId, files) {
  const source = SOURCES[packId]
  const outDir = path.join(OUT_ROOT, packId)
  fs.mkdirSync(outDir, { recursive: true })
  console.log(`\n[${packId}] 处理 ${files.length} 个素材`)

  for (const [file, slug] of files) {
    const remotePath = source.dir ? `${source.dir}/${file}` : file
    const cacheDir = path.join(CACHE_ROOT, packId)
    const cached = download(source.repo, remotePath, path.join(cacheDir, path.basename(file)))
    const ext = extOf(file)
    const dest = path.join(outDir, `${slug}${ext}`)
    if (ext === '.gif') await writeGif(cached, dest)
    else await writeStatic(cached, dest, ext)
    console.log(`  → ${packId}/${slug}${ext} (${(fs.statSync(dest).size / 1024).toFixed(0)}KB)`)
  }

  fs.writeFileSync(path.join(outDir, 'LICENSE.txt'), source.license, 'utf8')
}

checkGh()
await buildPack('nailong', [...NAILONG_STATIC, ...NAILONG_GIF])
await buildPack('felyne', FELYNE)
console.log('\n完成。记得确认 client/src/lib/stickers.ts 的 ENTRIES 与本脚本清单一致。')
