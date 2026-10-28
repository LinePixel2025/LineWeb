/**
 * 表情商店 Twemoji 素材下载器
 *
 * 用法：node client/scripts/fetch-twemoji-stickers.mjs
 * 产物：client/public/stickers/shop/twemoji/<codepoint>.svg + LICENSE.txt
 *
 * 素材来自 Twemoji（https://github.com/jdecked/twemoji），图形版权归
 * Twitter, Inc. 及其他贡献者所有，按 CC-BY 4.0 授权使用；商店面板已附署名。
 * 下载后请勿删除 LICENSE.txt。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/stickers/shop/twemoji')
const BASE = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg'
const CONCURRENCY = 6

/** 需要下载的 emoji 清单（codepoint + 商店展示名） */
export const TWEMOJI_ENTRIES = [
  ['1f600', '开心'],
  ['1f602', '笑哭'],
  ['1f605', '汗笑'],
  ['1f606', '大笑'],
  ['1f609', '眨眼'],
  ['1f60a', '害羞'],
  ['1f60d', '花痴'],
  ['1f618', '亲亲'],
  ['1f61c', '吐舌'],
  ['1f914', '思考'],
  ['1f928', '挑眉'],
  ['1f644', '白眼'],
  ['1f62d', '大哭'],
  ['1f621', '生气'],
  ['1f92c', '爆粗'],
  ['1f634', '睡觉'],
  ['1f971', '打哈欠'],
  ['1f923', '笑翻'],
  ['1f973', '庆祝'],
  ['1f97a', '委屈'],
  ['1f60e', '酷'],
  ['1f929', '星星眼'],
  ['1f970', '心动'],
  ['1f612', '无语'],
  ['1f60f', '得意'],
  ['1f614', '失落'],
  ['1f622', '流泪'],
  ['1f62e', '惊讶'],
  ['1f632', '震惊'],
  ['1f631', '尖叫'],
  ['1f620', '愤怒'],
  ['1f608', '小恶魔'],
  ['1f47b', '幽灵'],
  ['1f480', '骷髅'],
  ['1f921', '小丑'],
  ['1f916', '机器人'],
  ['1f44d', '赞'],
  ['1f44e', '踩'],
  ['1f44f', '鼓掌'],
  ['1f64c', '举手'],
  ['1f64f', '拜托'],
  ['1f91d', '握手'],
  ['270c', '胜利'],
  ['1f4aa', '加油'],
  ['1f440', '盯'],
  ['1f926', '捂脸'],
  ['1f937', '耸肩'],
  ['1f525', '火'],
  ['2764', '爱心'],
  ['1f494', '心碎'],
  ['1f389', '撒花'],
  ['1f38a', '彩带'],
  ['1f31f', '闪星'],
  ['2b50', '星星'],
  ['1f308', '彩虹'],
  ['1f319', '月亮'],
  ['2728', '闪光'],
  ['1f4af', '满分'],
  ['1f436', '狗'],
  ['1f431', '猫'],
  ['1f43c', '熊猫'],
  ['1f984', '独角兽'],
  ['1f34e', '苹果'],
  ['1f349', '西瓜'],
  ['2615', '咖啡'],
  ['1f37a', '啤酒'],
  ['1f382', '蛋糕'],
  ['1f381', '礼物'],
  ['1f680', '火箭'],
  ['1f3c6', '奖杯'],
  ['1f3ae', '游戏'],
  ['26bd', '足球'],
]

const LICENSE = `Twemoji graphics
================

Copyright 2020 Twitter, Inc and other contributors
Code licensed under the MIT License: https://opensource.org/licenses/MIT
Graphics licensed under CC-BY 4.0: https://creativecommons.org/licenses/by/4.0/

Source: https://github.com/jdecked/twemoji (assets/svg, v15.1.0)
This directory contains a curated subset used by the LineWeb sticker shop.
Do not remove this attribution file.
`

mkdirSync(OUT_DIR, { recursive: true })

async function download([codepoint, name]) {
  const url = `${BASE}/${codepoint}.svg`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${codepoint} (${name}) HTTP ${response.status}`)
  let svg = await response.text()
  if (!svg.includes('<svg')) throw new Error(`${codepoint} (${name}) 不是有效 SVG`)
  // Twemoji 只有 viewBox、没有 width/height；补成 360×360，保证各浏览器 <img> 有
  // 明确固有尺寸，前端 canvas 栅格化时不会出现 0 宽或拉伸异常。
  if (!/<svg[^>]*\bwidth=/.test(svg)) {
    svg = svg.replace('<svg ', '<svg width="360" height="360" ')
  }
  writeFileSync(resolve(OUT_DIR, `${codepoint}.svg`), svg, 'utf8')
  return `${codepoint}=${name}`
}

const queue = [...TWEMOJI_ENTRIES]
const failures = []
let done = 0
async function worker() {
  while (queue.length > 0) {
    const entry = queue.shift()
    if (!entry) return
    try {
      const label = await download(entry)
      done += 1
      console.log(`✓ ${label}`)
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err))
      console.error(`✗ ${err instanceof Error ? err.message : err}`)
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
writeFileSync(resolve(OUT_DIR, 'LICENSE.txt'), LICENSE, 'utf8')

if (failures.length > 0) {
  console.error(`\n完成 ${done} 个，失败 ${failures.length} 个：`)
  for (const item of failures) console.error(`  - ${item}`)
  process.exitCode = 1
} else {
  console.log(`\n完成：${done} 个表情 → ${OUT_DIR}`)
}
