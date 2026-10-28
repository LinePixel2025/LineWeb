import { CalculatorError, type CalcToken } from './tokenizer'

export type CalcNode =
  | { type: 'number'; value: number }
  | { type: 'constant'; name: 'pi' | 'e' }
  | { type: 'unary'; op: '-' | '+'; value: CalcNode }
  | { type: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: CalcNode; right: CalcNode }
  | { type: 'postfix'; op: '!' | '%'; value: CalcNode }
  | { type: 'call'; name: string; arg: CalcNode }

const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'log', 'ln', 'sqrt', 'abs', 'exp',
])

const CONSTANTS = new Set(['pi', 'e'])

export class CalcParser {
  private index = 0
  private readonly tokens: CalcToken[]

  constructor(tokens: CalcToken[]) {
    this.tokens = tokens
  }

  parse(): CalcNode {
    if (this.tokens.length === 0) throw new CalculatorError('请输入表达式')
    const node = this.parseExpression()
    if (!this.done()) throw new CalculatorError('表达式存在多余内容')
    return node
  }

  private peek(): CalcToken | null {
    return this.tokens[this.index] ?? null
  }

  private next(): CalcToken | null {
    const token = this.peek()
    if (token) this.index += 1
    return token
  }

  private done(): boolean {
    return this.index >= this.tokens.length
  }

  private isOperator(value: string): boolean {
    const token = this.peek()
    return token?.type === 'operator' && token.value === value
  }

  private startsPrimary(token: CalcToken | null): boolean {
    if (!token) return false
    if (token.type === 'number' || token.type === 'lparen') return true
    return token.type === 'identifier'
  }

  private parseExpression(): CalcNode {
    let node = this.parseTerm()
    while (this.isOperator('+') || this.isOperator('-')) {
      const op = this.next()!.value as '+' | '-'
      node = { type: 'binary', op, left: node, right: this.parseTerm() }
    }
    return node
  }

  private parseTerm(): CalcNode {
    let node = this.parseUnary()
    while (true) {
      if (this.isOperator('*') || this.isOperator('/')) {
        const op = this.next()!.value as '*' | '/'
        node = { type: 'binary', op, left: node, right: this.parseUnary() }
        continue
      }
      // 隐式乘法：2π、2(3+4)、(1+2)(3+4)、2sin(30)
      if (this.startsPrimary(this.peek())) {
        node = { type: 'binary', op: '*', left: node, right: this.parseUnary() }
        continue
      }
      break
    }
    return node
  }

  private parseUnary(): CalcNode {
    if (this.isOperator('+') || this.isOperator('-')) {
      const op = this.next()!.value as '+' | '-'
      return { type: 'unary', op, value: this.parseUnary() }
    }
    return this.parsePower()
  }

  private parsePower(): CalcNode {
    const base = this.parsePostfix()
    if (this.isOperator('^')) {
      this.next()
      // 右结合：2^3^2 = 2^(3^2)
      return { type: 'binary', op: '^', left: base, right: this.parseUnary() }
    }
    return base
  }

  private parsePostfix(): CalcNode {
    let node = this.parsePrimary()
    while (this.isOperator('!') || this.isOperator('%')) {
      const op = this.next()!.value as '!' | '%'
      node = { type: 'postfix', op, value: node }
    }
    return node
  }

  private parsePrimary(): CalcNode {
    const token = this.next()
    if (!token) throw new CalculatorError('表达式不完整')

    if (token.type === 'number') {
      return { type: 'number', value: Number(token.value) }
    }

    if (token.type === 'lparen') {
      const node = this.parseExpression()
      const close = this.next()
      if (!close || close.type !== 'rparen') throw new CalculatorError('缺少右括号')
      return node
    }

    if (token.type === 'identifier') {
      if (CONSTANTS.has(token.value)) {
        return { type: 'constant', name: token.value as 'pi' | 'e' }
      }
      if (!FUNCTIONS.has(token.value)) throw new CalculatorError(`未知函数「${token.value}」`)
      const open = this.next()
      if (!open || open.type !== 'lparen') throw new CalculatorError(`函数 ${token.value} 需要括号`)
      const arg = this.parseExpression()
      const close = this.next()
      if (!close || close.type !== 'rparen') throw new CalculatorError('缺少右括号')
      return { type: 'call', name: token.value, arg }
    }

    throw new CalculatorError('表达式不完整')
  }
}
