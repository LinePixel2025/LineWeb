import { describe, expect, it } from 'vitest'
import { decodeTxt, splitTxtChapters, txtPercent } from '../txtChapters'

function gb18030Bytes(text: string): ArrayBuffer {
  // 手工构造 GBK 字节：仅覆盖测试用的两个汉字
  const table: Record<string, number[]> = {
    '第': [0xb5, 0xda],
    '一': [0xd2, 0xbb],
    '章': [0xd5, 0xc2],
    '天': [0xcc, 0xec],
    '地': [0xb5, 0xd8],
    '玄': [0xd0, 0xfe],
    '黄': [0xbb, 0xc6],
  }
  const bytes: number[] = []
  for (const char of text) {
    if (table[char]) bytes.push(...table[char])
    else if (char.charCodeAt(0) < 128) bytes.push(char.charCodeAt(0))
    else throw new Error(`测试表缺少字符：${char}`)
  }
  return new Uint8Array(bytes).buffer
}

describe('decodeTxt', () => {
  it('UTF-8 直接解码', () => {
    const buffer = new TextEncoder().encode('第一章 天地玄黄\n正文内容').buffer as ArrayBuffer
    expect(decodeTxt(buffer)).toBe('第一章 天地玄黄\n正文内容')
  })

  it('GBK 编码回退 GB18030', () => {
    expect(decodeTxt(gb18030Bytes('第一章\n天地玄黄'))).toBe('第一章\n天地玄黄')
  })

  it('带 BOM 的 UTF-8', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('正文')])
    expect(decodeTxt(bytes.buffer)).toBe('正文')
  })
})

describe('splitTxtChapters', () => {
  it('匹配「第X章」并合并前言到第一章', () => {
    const text = '这是前言\n\n第一章 开端\n甲的正文。\n\n第二章 转折\n乙的正文。'
    const chapters = splitTxtChapters(text)
    expect(chapters).toHaveLength(2)
    expect(chapters[0].title).toBe('第一章 开端')
    expect(chapters[0].start).toBe(0) // 前言并入第一章
    expect(text.slice(chapters[0].start, chapters[0].end)).toContain('这是前言')
    expect(chapters[1].title).toBe('第二章 转折')
    expect(chapters[1].end).toBe(text.length)
  })

  it('匹配中文数字与特殊章节名', () => {
    const text = '序章\n起点。\n第一百二十三章 风起\n内容。\n尾声\n结束。'
    const chapters = splitTxtChapters(text)
    expect(chapters.map(c => c.title)).toEqual(['序章', '第一百二十三章 风起', '尾声'])
  })

  it('匹配卷/回与 Chapter N', () => {
    const text = '第一卷 蛮荒\n内容\n第三十回 夜宴\n内容\nChapter 4\ncontent'
    const chapters = splitTxtChapters(text)
    expect(chapters.map(c => c.title)).toEqual(['第一卷 蛮荒', '第三十回 夜宴', 'Chapter 4'])
  })

  it('无正则命中时退化为空行短行启发式', () => {
    const text = '第一段。\n\n小结一\n正文甲正文甲。\n\n小结二\n正文乙正文乙。'
    const chapters = splitTxtChapters(text)
    expect(chapters.map(c => c.title)).toContain('小结一')
    expect(chapters.map(c => c.title)).toContain('小结二')
  })

  it('完全无结构时整本单章', () => {
    const chapters = splitTxtChapters('只有一段没有标题的文字。', '书名')
    expect(chapters).toHaveLength(1)
    expect(chapters[0].title).toBe('书名')
    expect(chapters[0].start).toBe(0)
  })

  it('句末标点短行不会被误判为标题（启发式）', () => {
    const text = '他说完了。\n\n好的，就这样。\n正文继续。'
    const chapters = splitTxtChapters(text)
    expect(chapters).toHaveLength(1)
  })

  it('CRLF 换行归一化', () => {
    const text = '第一章 A\r\n内容\r\n\r\n第二章 B\r\n内容'
    const chapters = splitTxtChapters(text)
    expect(chapters.map(c => c.title)).toEqual(['第一章 A', '第二章 B'])
  })
})

describe('txtPercent', () => {
  it('章节 + 偏移换算全书进度', () => {
    expect(txtPercent(10, 0, 0)).toBe(0)
    expect(txtPercent(10, 4, 0.5)).toBeCloseTo(0.45)
    expect(txtPercent(10, 9, 1)).toBe(1)
  })

  it('越界钳制', () => {
    expect(txtPercent(5, -1, 0)).toBe(0)
    expect(txtPercent(5, 99, 1)).toBe(1)
    expect(txtPercent(0, 0, 0)).toBe(0)
  })
})
