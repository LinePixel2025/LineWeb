/**
 * EPUB 阅读增强（不修改 vendored foliate-js，只在外围操作 iframe document）。
 *
 * 职责：
 *   1. 主题 / 字号 / 行距注入（幂等 style，避免每次改字号都在 iframe 里叠一份）；
 *   2. 抽取当前章节的段落块（听书队列 + 高亮定位）；
 *   3. 当前朗读块高亮与滚动到块（分页模式下 paginator.scrollToAnchor 会翻到对应页）。
 */

import type { EpubHandle, ReaderThemeName } from './epubReader'

const STYLE_ID = 'lineweb-reader-appearance'
const SPEAKING_CLASS = 'lineweb-reader-speaking'

/** 段落块候选：取最内层带文字的块，避免父容器重复朗读 */
const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, dd, dt, figcaption, div'

const HIGHLIGHT: Record<ReaderThemeName, { background: string; bar: string }> = {
  light: { background: 'rgba(0, 102, 204, 0.12)', bar: 'rgba(0, 102, 204, 0.55)' },
  sepia: { background: 'rgba(154, 106, 47, 0.16)', bar: 'rgba(154, 106, 47, 0.60)' },
  dark: { background: 'rgba(255, 214, 102, 0.16)', bar: 'rgba(255, 214, 102, 0.65)' },
}

export interface EpubAppearance {
  theme: ReaderThemeName
  /** px */
  fontSize: number
  /** 无单位倍数（1.6 / 1.9 / 2.2） */
  lineHeight: number
}

export interface EpubBlock {
  key: string
  text: string
  element: HTMLElement
}

export interface EpubRendererExtras {
  getContents?(): { doc: Document; index: number }[]
  scrollToAnchor?(anchor: Element | Range, select?: boolean): Promise<unknown>
  /** paginator 重排（字号/行距变化后调用，内部会锚回当前位置） */
  render?(): void
}

interface FoliateLocationExtras {
  lastLocation?: { range?: Range }
}

/** 把阅读偏好注入章节 iframe（重复调用只更新同一个 style） */
export function injectEpubAppearance(doc: Document, appearance: EpubAppearance): void {
  if (!doc.head) return
  doc.documentElement.setAttribute('data-lineweb-reader-theme', appearance.theme)
  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = doc.createElement('style')
    style.id = STYLE_ID
    doc.head.appendChild(style)
  }
  const highlight = HIGHLIGHT[appearance.theme]
  const darkText = appearance.theme === 'dark'
    ? 'color: #cfcfd2 !important;'
    : ''
  const linkColor = appearance.theme === 'dark'
    ? 'a:link, a:visited { color: #6cb4ff !important; }'
    : ''
  style.textContent = `
    html { background: transparent !important; }
    body {
      background: transparent !important;
      ${darkText}
      font-size: ${appearance.fontSize}px !important;
      line-height: ${appearance.lineHeight} !important;
    }
    p, li, blockquote, dd, dt, figcaption {
      line-height: ${appearance.lineHeight} !important;
    }
    img, svg, video { max-width: 100% !important; height: auto !important; }
    ${linkColor}
    .${SPEAKING_CLASS} {
      background: ${highlight.background} !important;
      border-radius: 5px;
      box-shadow: inset 3px 0 0 ${highlight.bar};
      transition: background-color 160ms ease-out;
    }
    @media (prefers-reduced-motion: reduce) {
      .${SPEAKING_CLASS} { transition: none; }
    }
  `
}

/** 当前章节里所有「最内层文字块」，按文档顺序 */
export function collectEpubBlocks(doc: Document): EpubBlock[] {
  const body = doc.body
  if (!body) return []
  const blocks: EpubBlock[] = []
  const candidates = Array.from(body.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))
  for (const element of candidates) {
    if (element.closest('script, style, noscript, nav, svg, math, [aria-hidden="true"], [hidden]')) continue
    const nested = element.querySelector(BLOCK_SELECTOR)
    if (nested && (nested.textContent ?? '').trim()) continue
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (text.length < 2) continue
    blocks.push({ key: `b${blocks.length}`, text, element })
  }
  if (blocks.length === 0) {
    const text = (body.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (text) blocks.push({ key: 'b0', text, element: body })
  }
  return blocks
}

/**
 * 找到当前可见范围对应的起始段落，避免从本章第一页重新朗读。
 * 传入 view.lastLocation.range（foliate 每次 relocate 时记录的可见 Range）。
 */
export function findEpubStartIndex(doc: Document, blocks: EpubBlock[], visibleRange?: Range): number {
  if (!visibleRange || blocks.length === 0) return 0
  if (visibleRange.startContainer.getRootNode() !== doc) return 0
  for (let index = 0; index < blocks.length; index += 1) {
    const range = doc.createRange()
    range.selectNodeContents(blocks[index].element)
    if (range.compareBoundaryPoints(Range.END_TO_START, visibleRange) > 0) return index
  }
  return 0
}

/** 当前视口对应的 iframe document（优先用 lastLocation.range 判断） */
export function pickActiveEpubDoc(handle: EpubHandle, sectionIndex: number | null): Document | null {
  const contents = handle.view.renderer.getContents?.() ?? []
  if (contents.length === 0) return null
  const lastLocation = (handle.view as unknown as FoliateLocationExtras).lastLocation
  const range = lastLocation?.range
  if (range) {
    const root = range.startContainer.getRootNode()
    if (root.nodeType === Node.DOCUMENT_NODE) {
      const byRange = contents.find(item => item.doc === root)
      if (byRange) return byRange.doc
    }
  }
  if (sectionIndex !== null) {
    const byIndex = contents.find(item => item.index === sectionIndex)
    if (byIndex) return byIndex.doc
  }
  return contents[0]?.doc ?? null
}

/** 段落高亮（同一 document 内只保留一个） */
export function setEpubSpeakingBlock(doc: Document, element: HTMLElement | null): void {
  const previous = doc.querySelectorAll(`.${SPEAKING_CLASS}`)
  previous.forEach(node => node.classList.remove(SPEAKING_CLASS))
  if (element && element.isConnected) element.classList.add(SPEAKING_CLASS)
}

/** 滚动/翻页到正在朗读的段落（分页模式会切到该段所在页） */
export function scrollEpubToBlock(handle: EpubHandle, doc: Document, element: HTMLElement): void {
  const renderer = handle.view.renderer as unknown as EpubRendererExtras
  if (!renderer.scrollToAnchor) return
  try {
    const range = doc.createRange()
    range.selectNodeContents(element)
    void Promise.resolve(renderer.scrollToAnchor(range, false)).catch(() => {})
  } catch {
    /* 章节已卸载时忽略 */
  }
}

/** 字号/行距改变后让 foliate 重新分页（render 会锚回当前阅读位置） */
export function refreshEpubLayout(handle: EpubHandle): void {
  const renderer = handle.view.renderer as unknown as EpubRendererExtras
  renderer.render?.()
}
