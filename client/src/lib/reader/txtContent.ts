/**
 * TXT 正文 → 段落化（纯函数，无依赖）。
 *
 * 旧的阅读视图用 pre-wrap 直接渲染整章字符串，导致：
 *   - 听书无法定位「当前段」，也没法给段落加高亮；
 *   - 不同排版的 TXT（空行分段 / 一行一段 / 硬折行）可读性差异很大。
 *
 * 这里只做两件事：
 *   1. 把章节首行标题剥离出来单独渲染（避免标题重复且更清晰）；
 *   2. 生成段落数组，供渲染、滚动定位与朗读共用。
 *
 * 分段启发式：
 *   - 正文内部有空行 → 按空行分段（博客/精排版常见）；
 *   - 完全没有空行 → 一行一段（网文 TXT 常见的「一段一行」）。
 */

import { joinSpeechLines } from './speech'

export interface TxtParagraph {
  key: string
  /** 展示文本（段落内硬折行保留，CSS 用 pre-line） */
  text: string
  /** 朗读文本（段内换行合并，避免逐行停顿） */
  speech: string
}

export interface TxtChapterContent {
  /** 章节标题（正文首行与标题一致时会被剥离） */
  title: string
  paragraphs: TxtParagraph[]
  /** true = 一行一段（段落间距更紧凑） */
  lined: boolean
}

function normalizeLines(raw: string): string[] {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t\u00a0]+$/g, ''))
}

function isBlank(line: string): boolean {
  return line.trim() === ''
}

export function buildTxtChapterContent(raw: string, chapterTitle: string): TxtChapterContent {
  const lines = normalizeLines(raw)
  let cursor = 0
  let title = chapterTitle.trim()

  // 跳过开头空行；正文首行通常就是章节标题
  while (cursor < lines.length && isBlank(lines[cursor])) cursor += 1
  if (cursor < lines.length) {
    const first = lines[cursor].trim()
    if (!title) title = first
  }

  // 章节标题行可能不在首行（第一章常把前言并进来）：在前 40 行内定位并剥离，
  // 否则标题会被渲染两次（顶部 h1 + 正文里的一行）。
  let titleLineIndex = -1
  if (title) {
    const limit = Math.min(lines.length, cursor + 40)
    for (let index = cursor; index < limit; index += 1) {
      if (lines[index].trim() === title) {
        titleLineIndex = index
        break
      }
    }
  }

  const body = lines
    .slice(cursor)
    .filter((_, index) => cursor + index !== titleLineIndex)

  // 去掉尾部空行后再判断「内部是否用过空行分段」
  let end = body.length
  while (end > 0 && isBlank(body[end - 1])) end -= 1
  const bodyLines = body.slice(0, end)
  const hasBlankLine = bodyLines.some(isBlank)

  const paragraphs: TxtParagraph[] = []
  const pushParagraph = (chunks: string[]) => {
    const text = chunks.map(line => line.trim()).filter(Boolean).join('\n').trim()
    if (!text) return
    paragraphs.push({
      key: `p${paragraphs.length}`,
      text,
      speech: joinSpeechLines(text.split('\n')),
    })
  }

  if (!hasBlankLine) {
    for (const line of bodyLines) {
      if (!isBlank(line)) pushParagraph([line])
    }
  } else {
    let buffer: string[] = []
    for (const line of bodyLines) {
      if (isBlank(line)) {
        pushParagraph(buffer)
        buffer = []
        continue
      }
      buffer.push(line)
    }
    pushParagraph(buffer)
  }

  return { title, paragraphs, lined: !hasBlankLine }
}
