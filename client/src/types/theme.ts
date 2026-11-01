/**
 * LineWeb 主题类型（与服务端 `GET /api/themes` 契约保持一致）。
 *
 * 约定：
 * - 目录、价格、稀有度全部由服务端下发，前端不硬编码任何主题或价格；
 * - `equipped` 是服务端解析后的「实际生效」主题 key（库里的未知 / 未解锁值已回退为 default）；
 * - `balance` 与 `points` 是同一个余额，后者为早期命名，保留兼容。
 */

export type ThemeRarity = 'rare' | 'epic' | 'legendary'

/** 主题基底：只是「这套配色更适合哪种明暗」的元信息，不强制切换用户的明暗设置 */
export type ThemeMode = 'light' | 'dark'

/** 商店里的一张主题卡 */
export interface ThemeCatalogItem {
  key: string
  name: string
  tagline: string
  description: string
  /** 积分价格；默认主题为 0 */
  price: number
  rarity: ThemeRarity
  /** 稀有度中文标签（服务端下发，避免前后端文案漂移） */
  rarityLabel: string
  /** 背景 / 卡片 / 强调色 / 文字，4 个 hex */
  swatches: [string, string, string, string]
  previewGradient: string
  defaultMode: ThemeMode
  isDefault: boolean
  owned: boolean
  equipped: boolean
  /** 余额是否够买（已拥有 / 默认主题恒为 false） */
  affordable: boolean
}

/** 商店视图 */
export interface ThemesView {
  catalog: ThemeCatalogItem[]
  /** 已拥有主题 key（含 default） */
  owned: string[]
  /** 当前佩戴的主题 key（default 表示默认主题） */
  equipped: string
  balance: number
  points: number
  defaultTheme: string
}

/** 购买返回：扣分后的余额 + 最新拥有/佩戴状态 + 该主题最新卡片 */
export interface ThemeBuyResult {
  balance: number
  owned: string[]
  equipped: string
  theme: ThemeCatalogItem
}

/** 商店筛选：全部 / 已拥有 / 可购买（余额够）/ 按稀有度 */
export type ThemeFilter = 'all' | 'owned' | 'affordable' | ThemeRarity

/** 排序：价格从低到高 / 从高到低 */
export type ThemeSort = 'price-asc' | 'price-desc'
