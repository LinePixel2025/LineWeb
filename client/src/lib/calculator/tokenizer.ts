export type CalcTokenType = 'number' | 'identifier' | 'operator' | 'lparen' | 'rparen'

export interface CalcToken {
  type: CalcTokenType
  value: string
  pos: number
}

export class CalculatorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CalculatorError'
  }
}

const OPERATORS = new Set(['+', '-', '*', '/', '^', '%', '!'])

function normalize(source: string): string {
  return source
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/π/g, 'pi')
    .replace(/√/g, 'sqrt')
}

/** 词法分析：数字 / 标识符 / 运算符 / 括号；非法字符直接报错 */
export function tokenize(source: string): CalcToken[] {
  const text = normalize(source)
  const tokens: CalcToken[] = []
  let i = 0

  while (i < text.length) {
    const ch = text[i]
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (/[0-9.]/.test(ch)) {
      const start = i
      let dots = 0
      while (i < text.length && /[0-9.]/.test(text[i])) {
        if (text[i] === '.') dots += 1
        i += 1
      }
      const raw = text.slice(start, i)
      if (dots > 1 || raw === '.') throw new CalculatorError('数字格式无效')
      tokens.push({ type: 'number', value: raw, pos: start })
      continue
    }
    if (/[a-zA-Z]/.test(ch)) {
      const start = i
      while (i < text.length && /[a-zA-Z]/.test(text[i])) i += 1
      tokens.push({ type: 'identifier', value: text.slice(start, i).toLowerCase(), pos: start })
      continue
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen', value: ch, pos: i })
      i += 1
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ch, pos: i })
      i += 1
      continue
    }
    if (OPERATORS.has(ch)) {
      tokens.push({ type: 'operator', value: ch, pos: i })
      i += 1
      continue
    }
    throw new CalculatorError(`无法识别的字符「${ch}」`)
  }

  return tokens
}
