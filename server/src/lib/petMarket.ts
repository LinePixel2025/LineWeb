/**
 * 宠物交易行纯函数（价格模型 / 手续费 / 挂单校验）。
 *
 * 价格随玩家变动：
 *   - 每笔成交把参考价往成交价拉 30%（老价权重 70%）
 *   - 在售数量多时小幅下压、无在售时小幅上浮
 *   - 读取时按 7 天半衰期惰性回归基础价，避免长期偏离
 *   - 挂单价必须落在参考价的 50%–150%，防止恶意天价/地板价刷屏
 */

export const PET_MARKET_FEE_RATE = 0.05
export const PET_MARKET_PRICE_MIN_RATIO = 0.5
export const PET_MARKET_PRICE_MAX_RATIO = 1.5
export const PET_MARKET_REF_MIN_RATIO = 0.5
export const PET_MARKET_REF_MAX_RATIO = 3
export const PET_MARKET_REF_HALF_LIFE_DAYS = 7
export const PET_MARKET_MAX_ACTIVE_LISTINGS = 5

const DAY_MS = 86_400_000

export function petMarketFee(price: number): number {
  const clean = Math.max(0, Math.trunc(price))
  if (clean <= 0) return 0
  return Math.max(1, Math.ceil(clean * PET_MARKET_FEE_RATE))
}

export function petMarketSellerProceeds(price: number): number {
  const clean = Math.max(0, Math.trunc(price))
  return Math.max(0, clean - petMarketFee(clean))
}

/** 参考价惰性回归基础价（半衰期 7 天） */
export function decayRefPrice(
  refPrice: number,
  basePrice: number,
  updatedAtMs: number,
  nowMs = Date.now(),
): number {
  const base = Math.max(1, Math.round(basePrice))
  const ref = Math.max(1, Math.round(refPrice))
  if (ref === base) return base
  const elapsed = Math.max(0, nowMs - updatedAtMs)
  if (elapsed <= 0) return ref
  const factor = Math.pow(0.5, elapsed / (PET_MARKET_REF_HALF_LIFE_DAYS * DAY_MS))
  return clampRefPrice(base + (ref - base) * factor, base)
}

export function clampRefPrice(value: number, basePrice: number): number {
  const base = Math.max(1, Math.round(basePrice))
  const min = Math.max(1, Math.round(base * PET_MARKET_REF_MIN_RATIO))
  const max = Math.max(min, Math.round(base * PET_MARKET_REF_MAX_RATIO))
  if (!Number.isFinite(value)) return base
  return Math.max(min, Math.min(max, Math.round(value)))
}

/** 成交后的新参考价 */
export function nextRefPrice(
  refPrice: number,
  basePrice: number,
  tradePrice: number,
  activeListings = 0,
): number {
  const blended = refPrice * 0.7 + Math.max(0, tradePrice) * 0.3
  let pressure = 1
  if (activeListings > PET_MARKET_MAX_ACTIVE_LISTINGS) {
    const excess = Math.min(5, activeListings - PET_MARKET_MAX_ACTIVE_LISTINGS)
    pressure -= excess * 0.02
  } else if (activeListings === 0) {
    pressure += 0.02
  }
  return clampRefPrice(blended * pressure, basePrice)
}

/** 挂单价校验：返回错误文案或 null */
export function validateListingPrice(price: number, refPrice: number): string | null {
  if (!Number.isFinite(price) || !Number.isInteger(price)) return '价格必须是整数'
  if (price < 1) return '价格必须大于 0'
  if (price > 1_000_000) return '价格不能超过 1,000,000'
  const ref = Math.max(1, Math.round(refPrice))
  const min = Math.max(1, Math.floor(ref * PET_MARKET_PRICE_MIN_RATIO))
  const max = Math.max(min, Math.ceil(ref * PET_MARKET_PRICE_MAX_RATIO))
  if (price < min || price > max) {
    return `价格需在参考价 ${min}–${max} 积分之间`
  }
  return null
}

/** 参考价相对基础价的百分比（展示用，保留 1 位小数） */
export function refPriceChangePct(refPrice: number, basePrice: number): number {
  const base = Math.max(1, basePrice)
  return Math.round(((refPrice - base) / base) * 1000) / 10
}
