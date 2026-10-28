/** 科学计算器显示格式化：12 位有效数字，极端值用科学计数法 */
export function formatCalculatorValue(value: number): string {
  if (!Number.isFinite(value)) return '错误'
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e12 || abs < 1e-9) {
    return value.toExponential(6).replace(/\.?0+e/, 'e')
  }
  const rounded = Number(value.toPrecision(12))
  return String(rounded)
}
