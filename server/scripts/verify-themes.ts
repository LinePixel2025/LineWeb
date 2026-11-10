/**
 * LineWeb 主题目录自检（纯函数，不依赖数据库 / 环境变量 / 网络）
 *
 * 用法: cd server && npx tsx scripts/verify-themes.ts
 *      （package.json 未接 verify:themes，直接跑 tsx 即可）
 */

import {
  DEFAULT_THEME,
  DEFAULT_THEME_KEY,
  MIN_PAID_THEME_PRICE,
  PAID_THEMES,
  THEMES,
  THEME_KEYS,
  getTheme,
  isPurchasableTheme,
  isThemeKey,
  resolveEquippedTheme,
  themePrice,
  themeRarityLabel,
} from '../src/lib/themes.js'

let passed = 0

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(`断言失败：${label}`)
  passed += 1
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const actualText = JSON.stringify(actual)
  const expectedText = JSON.stringify(expected)
  if (actualText !== expectedText) {
    throw new Error(`断言失败：${label}\n  实际: ${actualText}\n  期望: ${expectedText}`)
  }
  passed += 1
}

const HEX_RE = /^#[0-9a-f]{6}$/i
const KEY_RE = /^[a-z][a-z0-9-]{0,31}$/
const RARITIES = ['rare', 'epic', 'legendary']
const DEFAULT_MODES = ['light', 'dark']

/* ============================================================
   目录不变量
   ============================================================ */

assertEqual(THEMES[0].key, DEFAULT_THEME_KEY, '默认主题排在目录首位')
assertEqual(THEMES.length, 15, '目录共 15 个主题（1 默认 + 14 付费）')
assertEqual(PAID_THEMES.length, 14, '付费主题 14 个')
assertEqual(THEME_KEYS.length, THEMES.length, 'THEME_KEYS 与 THEMES 数量一致')
assertEqual(new Set(THEME_KEYS).size, THEME_KEYS.length, '主题 key 唯一')
assertEqual(new Set(THEMES.map((theme) => theme.name)).size, THEMES.length, '主题名称唯一')

for (const theme of THEMES) {
  const prefix = `[${theme.key}]`
  assert(KEY_RE.test(theme.key), `${prefix} key 符合 slug 形态`)
  assert(theme.name.trim().length > 0, `${prefix} 有名称`)
  assert(theme.tagline.trim().length > 0, `${prefix} 有一句 tagline`)
  assert(theme.description.trim().length >= 10, `${prefix} 描述足够完整（≥10 字）`)
  assert(Number.isInteger(theme.price), `${prefix} 价格是整数`)
  assert(theme.price >= 0, `${prefix} 价格非负`)
  assert(theme.price <= 100_000, `${prefix} 价格不至于离谱（≤10 万分）`)
  assert(RARITIES.includes(theme.rarity), `${prefix} 稀有度合法`)
  assert(DEFAULT_MODES.includes(theme.defaultMode), `${prefix} defaultMode 合法`)

  assertEqual(theme.swatches.length, 4, `${prefix} swatches 恰好 4 个`)
  for (const swatch of theme.swatches) {
    assert(HEX_RE.test(swatch), `${prefix} 色板是 6 位 hex：${swatch}`)
  }
  // 4 个色板必须彼此不同：否则预览卡分不出「背景 / 卡片 / 强调 / 文字」
  assertEqual(new Set(theme.swatches.map((s) => s.toLowerCase())).size, 4, `${prefix} 4 个色板互不相同`)

  assert(theme.previewGradient.startsWith('linear-gradient('), `${prefix} 预览是 linear-gradient`)
  assert(!theme.previewGradient.includes('url('), `${prefix} 预览不含外链图片`)
  assert(!theme.previewGradient.includes('://'), `${prefix} 预览不含任何 URL`)
  // 预览渐变只用目录内颜色：把 hex 全部抽出来，逐个核对是否属于本主题色板
  const gradientHexes = theme.previewGradient.match(/#[0-9a-f]{6}/gi) ?? []
  assert(gradientHexes.length >= 2, `${prefix} 预览渐变至少 2 个色段`)
  const palette = new Set(theme.swatches.map((s) => s.toLowerCase()))
  for (const hex of gradientHexes) {
    assert(palette.has(hex.toLowerCase()), `${prefix} 预览色 ${hex} 来自本主题色板`)
  }
}

/* ============================================================
   价格：默认免费、付费主题不廉价
   ============================================================ */

assertEqual(DEFAULT_THEME.price, 0, '默认主题免费')
assertEqual(DEFAULT_THEME.key, DEFAULT_THEME_KEY, '默认主题 key 固定')
assert(THEMES.includes(DEFAULT_THEME), '默认主题在目录里')
assertEqual(isPurchasableTheme(DEFAULT_THEME_KEY), false, '默认主题不可购买')

for (const theme of PAID_THEMES) {
  assert(theme.price >= MIN_PAID_THEME_PRICE, `${theme.key} 价格 ≥ ${MIN_PAID_THEME_PRICE}`)
  assert(theme.key !== DEFAULT_THEME_KEY, `${theme.key} 不是默认主题 key`)
  assert(isPurchasableTheme(theme.key), `${theme.key} 可购买`)
}

const prices = PAID_THEMES.map((theme) => theme.price)
assertEqual(Math.min(...prices), 5000, '最低价 5000（樱花）')
assertEqual(Math.max(...prices), 38000, '最高价 38000（皇家）')
assertEqual(new Set(prices).size, prices.length, '付费主题价格互不相同（避免同价无法排序区分）')
assertEqual(
  PAID_THEMES.find((theme) => theme.key === 'sakura')?.price,
  5000,
  '樱花 5000',
)
assertEqual(PAID_THEMES.find((theme) => theme.key === 'cyberpunk')?.price, 25000, '赛博朋克 25000')
assertEqual(PAID_THEMES.find((theme) => theme.key === 'royal')?.price, 38000, '皇家 38000')

/* ============================================================
   浅色 / 深色两种基底都有主题覆盖（保证 themes.css 两套分支都被用到）
   ============================================================ */

assert(PAID_THEMES.some((theme) => theme.defaultMode === 'light'), '有浅色基底主题')
assert(PAID_THEMES.some((theme) => theme.defaultMode === 'dark'), '有深色基底主题')
assertEqual(
  new Set(PAID_THEMES.map((theme) => theme.rarity)).size,
  RARITIES.length,
  '三档稀有度都有主题',
)

/* ============================================================
   查表 / 校验
   ============================================================ */

assert(isThemeKey(DEFAULT_THEME_KEY), 'default 是合法 key')
for (const key of THEME_KEYS) {
  assert(isThemeKey(key), `${key} 通过 isThemeKey`)
}

assertEqual(isThemeKey('aurora'), true, 'aurora 合法')
assertEqual(isThemeKey('nope'), false, '未知 key 不合法')
assertEqual(isThemeKey(''), false, '空串不合法')
assertEqual(isThemeKey(null), false, 'null 不合法')
assertEqual(isThemeKey(undefined), false, 'undefined 不合法')
assertEqual(isThemeKey(42), false, '数字不合法')
assertEqual(isThemeKey('Aurora'), false, '大小写敏感（库里有同名 key 会静默失效）')
assertEqual(isThemeKey('default '), false, '带空格不合法')

assertEqual(getTheme('sakura')?.name, '樱花', 'getTheme 取到樱花')
assertEqual(getTheme('nope'), null, 'getTheme 未知 key 返回 null')
assertEqual(getTheme(null), null, 'getTheme null 返回 null')
assertEqual(getTheme(undefined), null, 'getTheme undefined 返回 null')
assertEqual(getTheme('')?.key, undefined, 'getTheme 空串返回 null')

/* ============================================================
   价格读取
   ============================================================ */

assertEqual(themePrice('aurora'), 8000, 'themePrice 极光 8000')
assertEqual(themePrice('terminal'), 12000, 'themePrice 终端 12000')
assertEqual(themePrice('candy'), 18000, 'themePrice 糖果 18000')
assertEqual(themePrice(DEFAULT_THEME_KEY), 0, 'themePrice 默认主题 0')
assertEqual(themePrice('nope'), 0, 'themePrice 未知 key 返回 0')
assertEqual(themePrice(null), 0, 'themePrice null 返回 0')

/* ============================================================
   佩戴 key 回退
   ============================================================ */

assertEqual(resolveEquippedTheme('royal'), 'royal', '已佩戴的主题原样返回')
assertEqual(resolveEquippedTheme(DEFAULT_THEME_KEY), DEFAULT_THEME_KEY, '默认主题原样返回')
assertEqual(resolveEquippedTheme(null), DEFAULT_THEME_KEY, 'null 回退默认')
assertEqual(resolveEquippedTheme(undefined), DEFAULT_THEME_KEY, 'undefined 回退默认')
assertEqual(resolveEquippedTheme(''), DEFAULT_THEME_KEY, '空串回退默认')
assertEqual(resolveEquippedTheme('   '), DEFAULT_THEME_KEY, '空白回退默认')
assertEqual(resolveEquippedTheme('discontinued-theme'), DEFAULT_THEME_KEY, '已下架主题回退默认')
assertEqual(resolveEquippedTheme('Aurora'), DEFAULT_THEME_KEY, '大小写不符回退默认')

/* ============================================================
   稀有度文案
   ============================================================ */

assertEqual(themeRarityLabel('rare'), '稀有', 'rare → 稀有')
assertEqual(themeRarityLabel('epic'), '史诗', 'epic → 史诗')
assertEqual(themeRarityLabel('legendary'), '传说', 'legendary → 传说')
assertEqual(themeRarityLabel('common'), '普通', '未知稀有度 → 普通')
assertEqual(themeRarityLabel(null), '普通', 'null → 普通')
assertEqual(themeRarityLabel(undefined), '普通', 'undefined → 普通')
assertEqual(themeRarityLabel(''), '普通', '空串 → 普通')

console.log(`✅ LineWeb 主题目录自检：${passed} 个断言`)
