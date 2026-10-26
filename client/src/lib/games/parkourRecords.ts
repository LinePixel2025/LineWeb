/**
 * 霓虹跑酷单机最佳纪录（localStorage，容错读写）
 *
 * 与引擎解耦：只接收一局结束时的数值，不依赖 three.js / React。
 */

export const PARKOUR_BEST_KEY = 'lineweb.parkour.best'

export interface ParkourBest {
  /** 最远距离（米） */
  distanceM: number
  /** 单局最多金币 */
  coins: number
  /** 单局最高分 */
  score: number
  /** 单局最高连击 */
  maxCombo: number
  /** 累计完成局数 */
  runs: number
}

export interface ParkourRunResult {
  distanceM: number
  coins: number
  score: number
  maxCombo: number
}

export interface ParkourSaveResult {
  best: ParkourBest
  newDistance: boolean
  newCoins: boolean
  newScore: boolean
  newCombo: boolean
}

export function emptyParkourBest(): ParkourBest {
  return { distanceM: 0, coins: 0, score: 0, maxCombo: 0, runs: 0 }
}

function getStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** 读取纪录；损坏 / 不可用时回退为空纪录 */
export function readParkourBest(): ParkourBest {
  const storage = getStorage()
  if (!storage) return emptyParkourBest()
  try {
    const raw = storage.getItem(PARKOUR_BEST_KEY)
    if (!raw) return emptyParkourBest()
    const parsed = JSON.parse(raw) as Partial<ParkourBest> | null
    if (!parsed || typeof parsed !== 'object') return emptyParkourBest()
    return {
      distanceM: safeNumber(parsed.distanceM),
      coins: Math.floor(safeNumber(parsed.coins)),
      score: Math.floor(safeNumber(parsed.score)),
      maxCombo: Math.floor(safeNumber(parsed.maxCombo)),
      runs: Math.floor(safeNumber(parsed.runs)),
    }
  } catch {
    return emptyParkourBest()
  }
}

/** 保存一局结果并返回是否刷新各项纪录（写入失败不抛错） */
export function saveParkourRun(result: ParkourRunResult): ParkourSaveResult {
  const previous = readParkourBest()
  const distanceM = Math.max(0, Math.round(safeNumber(result.distanceM) * 10) / 10)
  const coins = Math.floor(safeNumber(result.coins))
  const score = Math.floor(safeNumber(result.score))
  const maxCombo = Math.floor(safeNumber(result.maxCombo))
  const best: ParkourBest = {
    distanceM: Math.max(previous.distanceM, distanceM),
    coins: Math.max(previous.coins, coins),
    score: Math.max(previous.score, score),
    maxCombo: Math.max(previous.maxCombo, maxCombo),
    runs: previous.runs + 1,
  }
  const storage = getStorage()
  try {
    storage?.setItem(PARKOUR_BEST_KEY, JSON.stringify(best))
  } catch {
    // 隐私模式 / 配额满：保留内存中的 best，不阻断游戏结束流程
  }
  return {
    best,
    newDistance: distanceM > previous.distanceM,
    newCoins: coins > previous.coins,
    newScore: score > previous.score,
    newCombo: maxCombo > previous.maxCombo,
  }
}
