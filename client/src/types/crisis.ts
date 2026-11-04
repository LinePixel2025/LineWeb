/**
 * Lineweb 危机（周期性积分回收）的前端类型。
 * 与 server/src/lib/crisisRules.ts 的 CrisisStateDto 字段一一对应。
 */

export type CrisisStatus = 'clear' | 'due' | 'blocked'

export interface CrisisRules {
  /** 危机总开关 */
  enabled: boolean
  /** 上缴比例（0–1） */
  ratio: number
  /** 结清后多久开下一轮（毫秒） */
  intervalMs: number
  /** 开轮后的宽限时长（毫秒） */
  graceMs: number
  /** 免征门槛：算出的应缴额低于它则归零 */
  minLevy: number
}

/** 资产分项，键序与服务端 CrisisAssetParts 一致 */
export interface CrisisAssetParts {
  points: number
  raidGear: number
  raidWarehouse: number
  raidBags: number
  petOutfits: number
  petEquipment: number
  petSkills: number
  stocks: number
  stockOrders: number
  bankDemand: number
  bankDeposits: number
  funds: number
}

export interface CrisisStateDto {
  enabled: boolean
  /** 管理员豁免 */
  exempt: boolean
  status: CrisisStatus
  blocked: boolean
  /** 有进行中的搜打撤对局，因此暂时不封锁（「打完这局再封」） */
  hasLiveRaid: boolean
  round: number
  snapshot: number
  required: number
  paid: number
  remaining: number
  assets: { total: number; parts: CrisisAssetParts }
  rules: CrisisRules
  openAt: string | null
  graceUntil: string | null
  settledAt: string | null
  nextDueAt: string | null
  /** 距离封锁还剩多少毫秒（已封锁 / 未开轮为 0） */
  msUntilBlock: number
  /** 公共银行累计总额（BigInt 以字符串出口） */
  poolTotal: string
}

export interface CrisisPayResult {
  state: CrisisStateDto
  charged: number
  settled: boolean
}

export interface CrisisHistoryItem {
  id: number
  amount: number
  balance: number
  note: string | null
  createdAt: string
}

export interface CrisisAdminOverview {
  rules: CrisisRules
  poolTotal: string
  totals: { users: number; due: number; blocked: number; settled: number }
  topDebtors: {
    userId: number
    username: string
    snapshot: number
    required: number
    paid: number
    remaining: number
    graceUntil: string | null
    blocked: boolean
  }[]
}

/** 资产分项的中文名（前端展示顺序即此处顺序） */
export const CRISIS_ASSET_LABELS: { key: keyof CrisisAssetParts; label: string; hint: string }[] = [
  { key: 'points', label: '可用积分', hint: '当前余额' },
  { key: 'raidGear', label: '搜打撤装备', hint: '头盔 / 护甲 / 战靴 / 背包 / 胸挂（按目录价）' },
  { key: 'raidWarehouse', label: '搜打撤仓库', hint: '按官方回收价' },
  { key: 'raidBags', label: '已撤离未存入', hint: '背包 / 胸挂 / 安全箱内的战利品' },
  { key: 'petOutfits', label: '宠物装扮', hint: '已购买的全部装扮' },
  { key: 'petEquipment', label: '宠物装备', hint: '含交易行挂单中的装备（挂单是要价，不重复计价）' },
  { key: 'petSkills', label: '宠物技能', hint: '已购买的全部技能' },
  { key: 'stocks', label: '股票持仓', hint: '按实时行情估值' },
  { key: 'stockOrders', label: '冻结委托', hint: '限价买入挂单的冻结积分 + 卖出挂单冻结份额的市值' },
  { key: 'bankDemand', label: '银行活期', hint: '活期本金（未结利息不计）' },
  { key: 'bankDeposits', label: '银行定期', hint: '未到期存单的本金' },
  { key: 'funds', label: '基金持仓', hint: '份额 × 当日净值' },
]

export const CRISIS_STATUS_LABELS: Record<CrisisStatus, string> = {
  clear: '已结清',
  due: '待缴纳',
  blocked: '已封锁',
}
