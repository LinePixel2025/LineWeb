export interface CalculatorHistoryEntry {
  expression: string
  result: string
  at: number
}

const HISTORY_KEY = 'lineweb_calc_history'
const MAX_HISTORY = 50

export function readCalculatorHistory(): CalculatorHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is CalculatorHistoryEntry =>
      !!item && typeof item === 'object'
      && typeof item.expression === 'string'
      && typeof item.result === 'string'
      && typeof item.at === 'number'
    ).slice(0, MAX_HISTORY)
  } catch {
    return []
  }
}

export function appendCalculatorHistory(
  history: CalculatorHistoryEntry[],
  expression: string,
  result: string,
): CalculatorHistoryEntry[] {
  const next = [{ expression, result, at: Date.now() }, ...history].slice(0, MAX_HISTORY)
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch {
    // 隐私模式下只保留内存历史
  }
  return next
}

export function clearCalculatorHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY)
  } catch {
    // ignore
  }
}
