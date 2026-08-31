import { describe, it, expect } from 'vitest'
import { stripHtml, countWords, calcReadingTime } from '../textStats'

describe('stripHtml', () => {
  it('去标签并归一化空白', () => {
    expect(stripHtml('<p>你好&nbsp;&nbsp;世界</p><div>第二段</div>')).toBe('你好 世界 第二段')
  })
  it('反转义常见实体', () => {
    expect(stripHtml('<span>a &amp; b &lt;c&gt;</span>')).toBe('a & b <c>')
  })
  it('空输入返回空串', () => {
    expect(stripHtml('')).toBe('')
    expect(stripHtml('<p></p>')).toBe('')
  })
})

describe('countWords', () => {
  it('中文字符逐字计数', () => {
    expect(countWords('你好世界')).toBe(4)
  })
  it('连续英文/数字串计 1 词', () => {
    expect(countWords('hello world 2024')).toBe(3)
  })
  it('中英混合', () => {
    // 使用(2 CJK) + Rust(1 latin) + 语言(2 CJK) = 5
    expect(countWords('使用 Rust 语言')).toBe(5)
  })
})

describe('calcReadingTime', () => {
  it('空正文至少 1 分钟', () => {
    expect(calcReadingTime('')).toBe(1)
  })
  it('400 字中文约 1 分钟', () => {
    expect(calcReadingTime('<p>' + '字'.repeat(400) + '</p>')).toBe(1)
  })
  it('800 字中文约 2 分钟', () => {
    expect(calcReadingTime('<p>' + '字'.repeat(800) + '</p>')).toBe(2)
  })
  it('200 个英文词约 1 分钟', () => {
    expect(calcReadingTime('<p>' + 'word '.repeat(200) + '</p>')).toBe(1)
  })
  it('超 400 字向上取整', () => {
    expect(calcReadingTime('<p>' + '字'.repeat(401) + '</p>')).toBe(2)
  })
})
