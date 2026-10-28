import { CalculatorError, tokenize } from './tokenizer'
import { CalcParser, type CalcNode } from './parser'

export type AngleMode = 'DEG' | 'RAD'

function roundSignificant(value: number): number {
  if (!Number.isFinite(value)) return value
  if (value === 0) return 0
  return Number(value.toPrecision(12))
}

function factorial(value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new CalculatorError('阶乘只支持非负整数')
  if (value > 170) throw new CalculatorError('阶乘数值过大')
  let result = 1
  for (let i = 2; i <= value; i += 1) result *= i
  return result
}

function toRadians(value: number, mode: AngleMode): number {
  return mode === 'DEG' ? (value * Math.PI) / 180 : value
}

function fromRadians(value: number, mode: AngleMode): number {
  return mode === 'DEG' ? (value * 180) / Math.PI : value
}

function evalNode(node: CalcNode, mode: AngleMode): number {
  switch (node.type) {
    case 'number':
      return node.value
    case 'constant':
      return node.name === 'pi' ? Math.PI : Math.E
    case 'unary': {
      const value = evalNode(node.value, mode)
      return node.op === '-' ? -value : value
    }
    case 'postfix': {
      const value = evalNode(node.value, mode)
      return node.op === '!' ? factorial(value) : value / 100
    }
    case 'binary': {
      const left = evalNode(node.left, mode)
      const right = evalNode(node.right, mode)
      switch (node.op) {
        case '+': return left + right
        case '-': return left - right
        case '*': return left * right
        case '/':
          if (right === 0) throw new CalculatorError('不能除以 0')
          return left / right
        case '^': {
          const result = Math.pow(left, right)
          if (!Number.isFinite(result)) throw new CalculatorError('幂运算结果超出范围')
          return result
        }
      }
      break
    }
    case 'call': {
      const value = evalNode(node.arg, mode)
      switch (node.name) {
        case 'sin': return Math.sin(toRadians(value, mode))
        case 'cos': return Math.cos(toRadians(value, mode))
        case 'tan': {
          const radians = toRadians(value, mode)
          if (Math.abs(Math.cos(radians)) < 1e-12) throw new CalculatorError('tan 在该角度无定义')
          return Math.tan(radians)
        }
        case 'asin':
          if (value < -1 || value > 1) throw new CalculatorError('asin 的输入必须在 -1 到 1 之间')
          return fromRadians(Math.asin(value), mode)
        case 'acos':
          if (value < -1 || value > 1) throw new CalculatorError('acos 的输入必须在 -1 到 1 之间')
          return fromRadians(Math.acos(value), mode)
        case 'atan': return fromRadians(Math.atan(value), mode)
        case 'log':
          if (value <= 0) throw new CalculatorError('log 的输入必须大于 0')
          return Math.log10(value)
        case 'ln':
          if (value <= 0) throw new CalculatorError('ln 的输入必须大于 0')
          return Math.log(value)
        case 'sqrt':
          if (value < 0) throw new CalculatorError('负数不能开平方')
          return Math.sqrt(value)
        case 'abs': return Math.abs(value)
        case 'exp': return Math.exp(value)
        default: throw new CalculatorError(`未知函数「${node.name}」`)
      }
    }
  }
  throw new CalculatorError('表达式无法计算')
}

export function evaluateExpression(expression: string, mode: AngleMode = 'DEG'): number {
  const node = new CalcParser(tokenize(expression)).parse()
  const result = evalNode(node, mode)
  if (!Number.isFinite(result)) throw new CalculatorError('结果超出数值范围')
  return roundSignificant(result)
}
