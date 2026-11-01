/**
 * LineWeb 主题目录（服务端唯一真相源）。
 *
 * 口径：
 * - `default` 是免费主题，代表站点原生的 Apple 视觉，不落库、不可购买、永远「已拥有」；
 * - 其余 10 个主题用积分兑换，价格区间 5000–38000，最低一档也明显高于日常签到 / 单局游戏的收益，
 *   保持「不廉价」的稀缺感（兑换过一次即永久拥有）；
 * - 本文件只描述商店元数据（名称 / 文案 / 价格 / 色板 / 预览渐变）。真正的视觉定义在
 *   `client/src/styles/themes.css` 里按 `html[data-lw-theme="<key>"]` 覆盖设计令牌，
 *   新增主题必须同时在 CSS 里写 light 与 dark 两套变量，否则浅色模式下会退回默认配色。
 */

export type ThemeRarity = 'rare' | 'epic' | 'legendary'
export type ThemeMode = 'light' | 'dark'

export interface ThemeDef {
  key: string
  name: string
  tagline: string
  description: string
  /** 积分价格（整数）；默认主题为 0 */
  price: number
  rarity: ThemeRarity
  /** 主色板，用于商店预览卡：背景 / 卡片 / 强调色 / 文字（4 个 hex） */
  swatches: [string, string, string, string]
  /** 预览卡背景渐变（只用目录内颜色，禁止外链图片） */
  previewGradient: string
  /** 主题基底：themes.css 中 light 与 dark 两套都要定义同 key 的变量覆盖 */
  defaultMode: ThemeMode
}

/** 默认主题 key（免费、不可购买、不落库） */
export const DEFAULT_THEME_KEY = 'default'

/** 付费主题价格下限：低于它的主题会被 verify-themes 判为「廉价」 */
export const MIN_PAID_THEME_PRICE = 5000

export const DEFAULT_THEME: ThemeDef = {
  key: DEFAULT_THEME_KEY,
  name: '默认主题',
  tagline: '站点原生的 Apple 视觉',
  description:
    'LineWeb 出厂外观：毛玻璃外壳、克制的发丝线与系统字体栈。所有主题都是在它的令牌基础上做覆盖。',
  price: 0,
  // 默认主题不出现在商店里，rarity 只为满足类型；界面对它显示「免费 / 已拥有」而不是稀有度
  rarity: 'rare',
  swatches: ['#f5f5f7', '#ffffff', '#0066cc', '#1d1d1f'],
  previewGradient: 'linear-gradient(135deg, #f5f5f7 0%, #ffffff 55%, #0066cc 100%)',
  defaultMode: 'light',
}

/**
 * 付费主题目录。
 * 顺序即商店的默认顺序（客户端仍提供按价格排序），key 一旦上线不可更改（落库在 ThemeUnlock.themeKey）。
 */
export const PAID_THEMES: readonly ThemeDef[] = [
  {
    key: 'aurora',
    name: '极光',
    tagline: '冷青与紫的极光，在页面上缓慢流过',
    description:
      '把北境极光搬进站点：深蓝底、青绿光带、玻璃卡片随滚动泛出微光。深色下像仰望极夜，浅色下像清晨的冰湖。',
    price: 8000,
    rarity: 'epic',
    swatches: ['#071426', '#0e2138', '#4fe3c1', '#eaf4ff'],
    previewGradient: 'linear-gradient(135deg, #071426 0%, #0e2138 46%, #4fe3c1 100%)',
    defaultMode: 'dark',
  },
  {
    key: 'sakura',
    name: '樱花',
    tagline: '粉白纸面，落樱轻轻',
    description:
      '以樱花粉与暖白为主调，卡片像撒了一层花瓣的纸，按钮是花瓣尖端的深粉。适合生活日志与摄影随笔。',
    price: 5000,
    rarity: 'rare',
    swatches: ['#fdf2f5', '#ffffff', '#c2185b', '#2b1620'],
    previewGradient: 'linear-gradient(140deg, #fdf2f5 0%, #ffffff 52%, #c2185b 100%)',
    defaultMode: 'light',
  },
  {
    key: 'forest',
    name: '森林',
    tagline: '苔绿与木色，安静生长',
    description:
      '苔绿、树皮棕与晨雾白，卡片带一点纸感。阅读长文时眼睛最放松的一套配色，侧边栏像林间的木牌。',
    price: 6000,
    rarity: 'rare',
    swatches: ['#f1f5ec', '#ffffff', '#2f6b3a', '#1d2a1a'],
    previewGradient: 'linear-gradient(135deg, #f1f5ec 0%, #ffffff 48%, #2f6b3a 100%)',
    defaultMode: 'light',
  },
  {
    key: 'ocean',
    name: '海洋',
    tagline: '深蓝青，水面浮光',
    description:
      '深海蓝到青绿的过渡，表面像被水波打过光的玻璃。代码块与表格用更深的礁石色，信息层次分明。',
    price: 7000,
    rarity: 'epic',
    swatches: ['#04121c', '#0a2233', '#38d6e0', '#e2f4ff'],
    previewGradient: 'linear-gradient(150deg, #04121c 0%, #0a2233 44%, #38d6e0 100%)',
    defaultMode: 'dark',
  },
  {
    key: 'cyberpunk',
    name: '赛博朋克',
    tagline: '洋红霓虹，扫描线常在',
    description:
      '暗底 + 洋红与霓虹青双强色，配扫描线与霓虹描边。整站像深夜的霓虹街，适合展示作品集。',
    price: 25000,
    rarity: 'legendary',
    swatches: ['#0b0116', '#160328', '#ff2bd1', '#f7e9ff'],
    previewGradient: 'linear-gradient(120deg, #0b0116 0%, #160328 40%, #ff2bd1 100%)',
    defaultMode: 'dark',
  },
  {
    key: 'terminal',
    name: '终端',
    tagline: '近黑底，荧光绿字',
    description:
      '近黑背景与荧光绿文字，装饰网格与光标闪烁。等宽字体氛围，像一台永远在线的老式终端。',
    price: 12000,
    rarity: 'epic',
    swatches: ['#040b05', '#0a1409', '#3dff7a', '#e6ffe9'],
    previewGradient: 'linear-gradient(160deg, #040b05 0%, #0a1409 55%, #3dff7a 100%)',
    defaultMode: 'dark',
  },
  {
    key: 'sunset',
    name: '日落',
    tagline: '橙粉紫的黄昏渐变',
    description:
      '暖橙到玫瑰粉再到淡紫，整页像黄昏的窗。卡片用奶油白，文字用暖棕，柔和但不甜腻。',
    price: 9000,
    rarity: 'epic',
    swatches: ['#fff2e8', '#fffdfb', '#b53a0a', '#33180f'],
    previewGradient: 'linear-gradient(135deg, #fff2e8 0%, #fffdfb 45%, #b53a0a 100%)',
    defaultMode: 'light',
  },
  {
    key: 'ink',
    name: '水墨',
    tagline: '宣纸米白，朱红点睛',
    description:
      '宣纸底色、墨色文字、朱红印章式强调，配极淡的纸纹。中文长文与诗稿最贴合的一套。',
    price: 15000,
    rarity: 'epic',
    swatches: ['#f5f0e6', '#fbf7ee', '#b3382c', '#1c1a17'],
    previewGradient: 'linear-gradient(145deg, #f5f0e6 0%, #fbf7ee 50%, #b3382c 100%)',
    defaultMode: 'light',
  },
  {
    key: 'candy',
    name: '糖果',
    tagline: '高饱和糖果色，圆润可爱',
    description:
      '粉紫糖果底色 + 高饱和撞色，圆角更圆、阴影更软。整站像一整盒刚拆开的糖，最讨小朋友喜欢。',
    price: 18000,
    rarity: 'legendary',
    swatches: ['#fff0f8', '#ffffff', '#d81b8c', '#2a1230'],
    previewGradient: 'linear-gradient(135deg, #fff0f8 0%, #ffffff 42%, #d81b8c 100%)',
    defaultMode: 'light',
  },
  {
    key: 'royal',
    name: '皇家',
    tagline: '深紫金，华贵内敛',
    description:
      '深紫天鹅绒底 + 金线描边，卡片有绶带般的光泽。最贵的一套主题，适合当压箱底的收藏。',
    price: 38000,
    rarity: 'legendary',
    swatches: ['#0d0718', '#170d29', '#d9b45a', '#f3ebff'],
    previewGradient: 'linear-gradient(135deg, #0d0718 0%, #170d29 46%, #d9b45a 100%)',
    defaultMode: 'dark',
  },
]

/** 全量目录（默认主题在首位；商店只展示 PAID_THEMES） */
export const THEMES: readonly ThemeDef[] = [DEFAULT_THEME, ...PAID_THEMES]

/** 全部合法 key，顺序与 THEMES 一致 */
export const THEME_KEYS: readonly string[] = THEMES.map((theme) => theme.key)

const THEME_MAP: ReadonlyMap<string, ThemeDef> = new Map(THEMES.map((theme) => [theme.key, theme]))

const RARITY_LABELS: Record<ThemeRarity, string> = {
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
}

/** 是否是目录里的主题 key（用于路由入参校验） */
export function isThemeKey(key: unknown): key is string {
  return typeof key === 'string' && THEME_MAP.has(key)
}

/** 按 key 取主题定义；未知 key 返回 null（调用方自己决定 404 还是回退） */
export function getTheme(key: string | null | undefined): ThemeDef | null {
  if (!key) return null
  return THEME_MAP.get(key) ?? null
}

/** 主题价格；未知主题返回 0，调用前应先用 getTheme 判断存在性 */
export function themePrice(key: string | null | undefined): number {
  return getTheme(key)?.price ?? 0
}

/** 主题是否是付费主题（default 与未知 key 都返回 false） */
export function isPurchasableTheme(key: string | null | undefined): boolean {
  const theme = getTheme(key)
  return !!theme && theme.key !== DEFAULT_THEME_KEY
}

/**
 * 把库里的 equippedThemeKey 解析成可用的主题 key：
 * 未知 / 空值 / 已下架主题一律回退默认主题，避免客户端拿到一个没有 CSS 的 key。
 */
export function resolveEquippedTheme(key: string | null | undefined): string {
  return getTheme(key)?.key ?? DEFAULT_THEME_KEY
}

/** 稀有度中文标签；未知值按「普通」兜底（管理员改动 / 旧数据不炸前端） */
export function themeRarityLabel(rarity: string | null | undefined): string {
  if (rarity === 'rare' || rarity === 'epic' || rarity === 'legendary') {
    return RARITY_LABELS[rarity]
  }
  return '普通'
}
