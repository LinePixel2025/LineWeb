import type { CrisisStateDto } from '../types/crisis'

/** 积分显示：公共银行总额是 BigInt 字符串，逐位分组时不能先转 Number（会丢精度） */
export function formatCrisisPoints(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '0'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '0'
    return Math.floor(value).toLocaleString('zh-CN')
  }
  const digits = value.replace(/^-?\d+$/, '') === '' ? value : value.replace(/[^\d-]/g, '')
  if (!/^-?\d+$/.test(digits)) return value
  const negative = digits.startsWith('-')
  const body = negative ? digits.slice(1) : digits
  const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${grouped}`
}

/** 倒计时文案：天 / 小时 / 分 / 「已到期」，不出现负数 */
export function formatCrisisCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '已到期'
  const totalMinutes = Math.floor(ms / 60_000)
  if (totalMinutes < 1) return '不足 1 分钟'
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    return `${days} 天 ${hours % 24} 小时`
  }
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  return `${minutes} 分钟`
}

/**
 * 快捷缴纳额度：剩余应缴的四档 + 「全部」。
 * 末档取「min(剩余, 余额)」，让用户一键把能缴的都缴掉；余额不足时不会出现按了必失败的按钮。
 */
export function crisisQuickAmounts(state: CrisisStateDto, balance: number): number[] {
  const remaining = Math.max(0, state.remaining)
  // 余额来自异步 context，可能是 NaN：Math.floor(NaN) 不等于 0，会漏出一个 NaN 档位
  if (!Number.isFinite(balance) || balance <= 0 || remaining <= 0) return []
  const affordable = Math.min(remaining, Math.floor(balance))
  if (affordable <= 0) return []
  const steps = [0.25, 0.5, 0.75]
    .map((ratio) => Math.max(1, Math.floor(remaining * ratio)))
    .filter((amount) => amount <= affordable)
  const unique = Array.from(new Set([...steps, affordable])).sort((a, b) => a - b)
  return unique.slice(-4)
}

/** 本轮还剩多久封锁（毫秒）；已封锁或无账单返回 0 */
export function crisisMsUntilBlock(state: CrisisStateDto, nowMs = Date.now()): number {
  if (state.status !== 'due' || !state.graceUntil) return 0
  const deadline = new Date(state.graceUntil).getTime()
  if (!Number.isFinite(deadline)) return 0
  return Math.max(0, deadline - nowMs)
}
