import { describe, expect, it } from 'vitest'
import { tokenize } from '../tokenizer'
import { CalcParser } from '../parser'
import { evaluateExpression } from '../evaluate'
import { formatCalculatorValue } from '../format'

function evaluate(expression: string, mode: 'DEG' | 'RAD' = 'DEG'): number {
  return evaluateExpression(expression, mode)
}

describe('calculator tokenizer/parser', () => {
  it('tokenizes numbers, identifiers and operators', () => {
    expect(tokenize('sin(30)+2.5').map((t) => t.type)).toEqual([
      'identifier', 'lparen', 'number', 'rparen', 'operator', 'number',
    ])
  })

  it('parses precedence and parentheses', () => {
    expect(new CalcParser(tokenize('2+3*4')).parse().type).toBe('binary')
    expect(evaluate('2+3*4')).toBe(14)
    expect(evaluate('(2+3)*4')).toBe(20)
  })
})

describe('calculator evaluation', () => {
  it('supports implicit multiplication', () => {
    expect(evaluate('2(3+4)')).toBe(14)
    expect(evaluate('2π', 'RAD')).toBeCloseTo(6.28318530718, 8)
  })

  it('supports right-associative power and unary minus', () => {
    expect(evaluate('2^3^2')).toBe(512)
    expect(evaluate('-2^2')).toBe(-4)
    expect(evaluate('2^-3')).toBe(0.125)
  })

  it('supports factorial and percent', () => {
    expect(evaluate('5!')).toBe(120)
    expect(evaluate('50%')).toBe(0.5)
    expect(evaluate('200*10%')).toBe(20)
  })

  it('supports trig with DEG/RAD', () => {
    expect(evaluate('sin(30)', 'DEG')).toBe(0.5)
    expect(evaluate('cos(60)', 'DEG')).toBe(0.5)
    expect(evaluate('sin(pi/2)', 'RAD')).toBe(1)
    expect(evaluate('asin(0.5)', 'DEG')).toBe(30)
  })

  it('supports log/ln/sqrt/abs/exp', () => {
    expect(evaluate('log(100)')).toBe(2)
    expect(evaluate('ln(e)')).toBe(1)
    expect(evaluate('sqrt(16)')).toBe(4)
    expect(evaluate('abs(-3)')).toBe(3)
    expect(evaluate('exp(0)')).toBe(1)
  })

  it('reports domain errors', () => {
    expect(() => evaluate('sqrt(-1)')).toThrow('负数不能开平方')
    expect(() => evaluate('log(0)')).toThrow('log 的输入必须大于 0')
    expect(() => evaluate('tan(90)')).toThrow('tan 在该角度无定义')
    expect(() => evaluate('asin(2)')).toThrow('asin 的输入必须在 -1 到 1 之间')
    expect(() => evaluate('1/0')).toThrow('不能除以 0')
    expect(() => evaluate('(-3)!')).toThrow('阶乘只支持非负整数')
    expect(() => evaluate('2+')).toThrow('表达式不完整')
    expect(() => evaluate('sin 30')).toThrow('函数 sin 需要括号')
  })

  it('rounds floating point noise', () => {
    expect(evaluate('0.1+0.2')).toBe(0.3)
    expect(formatCalculatorValue(0.1 + 0.2)).toBe('0.3')
    expect(formatCalculatorValue(1e13)).toContain('e+')
  })
})
