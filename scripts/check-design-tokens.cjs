/**
 * 设计令牌自检（Apple 风格重构）
 *
 * 用法：node scripts/check-design-tokens.cjs
 *
 * 检查项：
 *   1. 明暗两套语义色的 WCAG 对比度（正文 4.5:1、大字/UI 3:1）
 *   2. 旧 GitHub Primer 色板是否仍有残留（只允许出现在变量文件的注释里）
 *   3. 组件样式里是否还有 uppercase 小节标题（游戏美术文件豁免）
 *
 * 退出码：对比度或残留检查不通过时为 1。
 */
const fs = require('fs')
const path = require('path')

const STYLES = path.resolve(__dirname, '..', 'client', 'src', 'styles')
const variablesFile = path.join(STYLES, 'variables.css')

/* ================= 颜色解析与对比度 ================= */
function parseColor(value) {
  const v = String(value).trim()
  let m = /^#([0-9a-f]{3,8})$/i.exec(v)
  if (m) {
    let hex = m[1]
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
    if (hex.length === 4) hex = hex.split('').map((c) => c + c).join('')
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
      return { r, g, b, a }
    }
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(v)
  if (m) {
    const parts = m[1].split(',').map((s) => parseFloat(s.trim()))
    if (parts.length >= 3) {
      return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] === undefined ? 1 : parts[3] }
    }
  }
  return null
}

function over(fg, bg) {
  const a = fg.a === undefined ? 1 : fg.a
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  }
}

function luminance({ r, g, b }) {
  const channel = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(fg, bg) {
  const fgOpaque = fg.a !== undefined && fg.a < 1 ? over(fg, bg) : fg
  const l1 = luminance(fgOpaque)
  const l2 = luminance(bg)
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

/* ================= 解析变量文件 ================= */
function extractBlock(css, selector) {
  // 取 selector { ... } 第一次出现（支持 [data-theme="dark"]）
  const start = css.indexOf(selector)
  if (start < 0) return ''
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  return ''
}

function extractTokens(block) {
  const tokens = {}
  for (const line of block.split('\n')) {
    const m = /(--gh-[a-z0-9-]+)\s*:\s*([^;]+);/i.exec(line)
    if (!m) continue
    if (m[2].includes('var(')) continue
    const color = parseColor(m[2])
    if (color) tokens[m[1]] = color
  }
  return tokens
}

const css = fs.readFileSync(variablesFile, 'utf8')
const themes = {
  light: extractTokens(extractBlock(css, ':root')),
  dark: extractTokens(extractBlock(css, '[data-theme="dark"]')),
}

/* ================= 对比度矩阵 =================
   [前景, 背景, 最低要求, 用途] */
const PAIRS = [
  ['--gh-text', '--gh-bg', 4.5, '正文 in 页面画布'],
  ['--gh-text', '--gh-canvas', 4.5, '正文 in 卡片'],
  ['--gh-text-secondary', '--gh-bg', 4.5, '次要文本 in 页面画布'],
  ['--gh-text-secondary', '--gh-canvas', 4.5, '次要文本 in 卡片'],
  ['--gh-text-tertiary', '--gh-bg', 4.5, '三级文本 in 页面画布'],
  ['--gh-text-tertiary', '--gh-canvas', 4.5, '三级文本 in 卡片'],
  ['--gh-accent', '--gh-bg', 4.5, '链接 in 页面画布'],
  ['--gh-accent', '--gh-canvas', 4.5, '链接 in 卡片'],
  ['--gh-on-accent', '--gh-accent-button', 4.5, '主按钮白字'],
  ['--gh-danger', '--gh-canvas', 4.5, '危险色文本'],
  ['--gh-success', '--gh-canvas', 4.5, '成功色文本'],
  ['--gh-warning', '--gh-canvas', 4.5, '警告色文本'],
  ['--gh-text', '--gh-canvas-inset', 4.5, '凹槽上的正文'],
  ['--gh-border-strong', '--gh-canvas', 1.2, '发丝线可见度'],
]

let failed = 0
const rows = []
for (const [theme, tokens] of Object.entries(themes)) {
  const canvas = tokens['--gh-canvas']
  for (const [fgName, bgName, min, note] of PAIRS) {
    const fg = tokens[fgName]
    let bg = tokens[bgName]
    if (!fg || !bg) {
      rows.push({ theme, pair: `${fgName} on ${bgName}`, ratio: 'missing', min, ok: false, note })
      failed++
      continue
    }
    // 半透明背景（fill / canvas-inset）按叠在卡片表面上的实际颜色计算
    if (bg.a !== undefined && bg.a < 1 && canvas) bg = over(bg, canvas)
    const ratio = contrast(fg, bg)
    const ok = ratio >= min
    if (!ok) failed++
    rows.push({ theme, pair: `${fgName} on ${bgName}`, ratio: ratio.toFixed(2), min, ok, note })
  }
}

console.log('=== 令牌对比度 ===')
for (const row of rows) {
  const mark = row.ok ? '✓' : '✗'
  console.log(`${mark} [${row.theme}] ${row.pair.padEnd(42)} ${String(row.ratio).padStart(6)} (≥${row.min})  ${row.note}`)
}

/* ================= 旧色板残留 =================
   游戏美术文件（牌面/棋盘/场景）按设计决策保留自身配色，不参与本项检查。 */
const GAME_ART_FILES = new Set([
  'doudizhu.css', 'snake.css', 'minesweeper.css', 'jump.css', 'minecraft.css',
  'gomoku.css', 'liar.css', 'uno.css', 'xiangqi.css', 'parkour.css', 'farm.css',
])
const LEGACY_COLORS = ['#0969da', '#0550ae', '#1f2328', '#d1d9e0', '#f6f8fa', '#f3f6f8', '#2f81f7', '#0d1117']
const legacyHits = []
for (const file of fs.readdirSync(STYLES).filter((f) => f.endsWith('.css'))) {
  if (file === 'variables.css' || GAME_ART_FILES.has(file)) continue
  const text = fs.readFileSync(path.join(STYLES, file), 'utf8')
  for (const color of LEGACY_COLORS) {
    const count = text.toLowerCase().split(color).length - 1
    if (count > 0) legacyHits.push({ file, color, count })
  }
}
console.log('\n=== 旧 Primer 色板残留（variables.css 之外） ===')
if (legacyHits.length === 0) {
  console.log('✓ 无残留')
} else {
  for (const hit of legacyHits) console.log(`✗ ${hit.file}: ${hit.color} × ${hit.count}`)
  failed++
}

/* ================= uppercase 小节标题 ================= */
const upperHits = []
for (const file of fs.readdirSync(STYLES).filter((f) => f.endsWith('.css'))) {
  if (GAME_ART_FILES.has(file) || file === 'variables.css') continue
  const text = fs.readFileSync(path.join(STYLES, file), 'utf8')
  const count = (text.match(/text-transform:\s*uppercase/g) || []).length
  if (count > 0) upperHits.push({ file, count })
}
console.log('\n=== uppercase 小节标题（游戏美术文件豁免） ===')
if (upperHits.length === 0) {
  console.log('✓ 无 uppercase')
} else {
  for (const hit of upperHits) console.log(`! ${hit.file}: ${hit.count}`)
  // uppercase 是警告而非硬失败（个别数据标签可能仍需要）
}

console.log(`\n结果：${failed === 0 ? '通过' : `${failed} 项未通过`}`)
process.exitCode = failed === 0 ? 0 : 1
