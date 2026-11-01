/**
 * TXT 纯文本小说解析（纯函数，无依赖）：
 *   1. 编码检测：UTF-8 严格解码失败 → GB18030（覆盖国内常见 GBK 编码 TXT）
 *   2. 章节切分：正则匹配「第X章/卷/回/部/集」与常见特殊章节名；
 *      全文无命中时退化为「空行包裹的短行」启发式；再不行整本单章
 *   3. 进度换算：章节索引 + 章节内偏移 → 全书 0–1 百分比
 */

/** 章节标题行（行内匹配，标题行要求整行基本就是标题） */
const CHAPTER_LINE_RE = /^\s{0,8}(?:第\s*[0-9０-９零一二三四五六七八九十百千万两]+\s*[章节卷回部集]|Chapter\s+\d+|CHAPTER\s+\d+|序章|序言|楔子|前言|自序|后记|尾声|番外|终章|最终章|附录)[^\n]{0,30}$/

/** 启发式回退：独立短行（前后空行、无句末标点、长度 1–30） */
const HEADING_FALLBACK_MAX_LENGTH = 30
const SENTENCE_END_RE = /[。！？…：」』”"'\]）)】;;,，]$/u

export interface TxtChapter {
  /** 标题（章节行原文，去首尾空白） */
  title: string
  /** 章节起始字符偏移（含标题行） */
  start: number
  /** 章节结束字符偏移（不含，等于下一章 start 或文本长度） */
  end: number
}

/**
 * 解码 TXT 原始字节：先按 UTF-8 严格解码，失败（非法序列）回退 GB18030。
 * 注意 GB18030 解码是宽容的（不会抛错），所以先试 UTF-8 即可覆盖绝大多数文件。
 */
export function decodeTxt(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('gb18030').decode(buffer)
  }
}

/** 规范化换行（CRLF/CR → LF），章节偏移基于规范化后的文本 */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

interface LineInfo {
  /** 行首偏移（不含行首缩进） */
  start: number
  /** 行内容（含缩进，不含换行符） */
  text: string
}

function scanLines(text: string): LineInfo[] {
  const lines: LineInfo[] = []
  let start = 0
  while (start <= text.length) {
    const idx = text.indexOf('\n', start)
    const end = idx === -1 ? text.length : idx
    lines.push({ start, text: text.slice(start, end) })
    if (idx === -1) break
    start = idx + 1
  }
  return lines
}

/**
 * 切分章节。返回按顺序的章节数组，覆盖 [0, text.length]：
 *   - 第一个章节标题前的前言并入第一章（start 仍为 0）
 *   - 无任何标题命中时：启发式短行 → 仍无则整本单章（title 取调用方给的书名）
 */
export function splitTxtChapters(text: string, fallbackTitle = '正文'): TxtChapter[] {
  const normalized = normalizeNewlines(text)
  const lines = scanLines(normalized)
  const headingStarts: { start: number; title: string }[] = []

  // 主匹配：章节标题正则
  for (const line of lines) {
    const trimmed = line.text.trim()
    if (trimmed.length >= 2 && trimmed.length <= 40 && CHAPTER_LINE_RE.test(line.text)) {
      headingStarts.push({ start: line.start, title: trimmed })
    }
  }

  // 启发式回退：空行包裹的短行且不以句末标点收尾
  if (headingStarts.length < 2) {
    const heuristic: { start: number; title: string }[] = []
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].text.trim()
      if (trimmed.length < 1 || trimmed.length > HEADING_FALLBACK_MAX_LENGTH) continue
      if (SENTENCE_END_RE.test(trimmed)) continue
      const prevBlank = i === 0 || lines[i - 1].text.trim() === ''
      const nextNonBlank = i + 1 < lines.length && lines[i + 1].text.trim() !== ''
      if (prevBlank && nextNonBlank) {
        heuristic.push({ start: lines[i].start, title: trimmed })
      }
    }
    if (heuristic.length >= 2) {
      headingStarts.length = 0
      headingStarts.push(...heuristic)
    }
  }

  if (headingStarts.length === 0) {
    return [{ title: fallbackTitle, start: 0, end: normalized.length }]
  }

  // 去掉相邻过近的重复命中（同一行被两种规则命中时取第一个）
  const chapters: TxtChapter[] = []
  let cursor = 0
  for (let i = 0; i < headingStarts.length; i++) {
    const heading = headingStarts[i]
    if (heading.start < cursor) continue
    const nextStart = i + 1 < headingStarts.length ? headingStarts[i + 1].start : normalized.length
    chapters.push({
      title: heading.title,
      // 第一章并入标题前的前言
      start: chapters.length === 0 ? 0 : heading.start,
      end: nextStart,
    })
    cursor = nextStart
  }
  return chapters
}

/** 章节索引 + 章节内偏移（0–1）→ 全书进度 0–1 */
export function txtPercent(chapterCount: number, chapterIndex: number, offset: number): number {
  if (chapterCount <= 0) return 0
  const clamped = Math.min(Math.max(chapterIndex, 0), chapterCount - 1)
  const clampedOffset = Math.min(Math.max(offset, 0), 1)
  return (clamped + clampedOffset) / chapterCount
}
