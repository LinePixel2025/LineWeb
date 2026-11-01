/**
 * EPUB 阅读引擎：vendored foliate-js（../../foliate/，见 VENDORED.md）的唯一 TS 边界。
 *
 * foliate-js 是纯 ESM 无类型声明的浏览器库，本文件集中承担：
 *   1. 动态 import（点击打开书时才加载，独立 chunk，不进主包）
 *   2. 最小类型面（只声明本项目用到的方法）
 *   3. 主题/字号注入（view 的 'load' 事件对 iframe document 插 <style>）
 *
 * 进度：'relocate' 事件的 detail.cfi 存库；恢复用 view.init({ lastLocation })。
 */

/** vendored foliate 无类型声明（allowJs=false），动态 import 处显式关闭检查 */
type FoliateViewModule = {
  View: new () => FoliateView
}

export interface FoliateTocItem {
  /** 目录标题（foliate 通常为 string，个别书籍为 { text } 形态） */
  label: string | { text?: string }
  href: string
  subitems?: FoliateTocItem[]
}

export interface FoliateRelocateDetail {
  /** 当前位置 CFI（进度持久化用） */
  cfi: string
  /** 全书 0–1 */
  fraction: number
  /** 所在目录项（可选） */
  tocItem?: { label?: { text?: string } } | null
  index: number
}

export interface FoliateLoadDetail {
  /** 章节渲染的 iframe document（主题注入目标） */
  doc: Document
  index: number
}

export interface FoliateView extends HTMLElement {
  open(book: Blob | File | string): Promise<void>
  /** 打开后调用：lastLocation 存在则恢复，否则从头开始 */
  init(options: { lastLocation?: string; showTextStart?: boolean }): Promise<void>
  goTo(target: string | number | { href?: string; index?: number }): Promise<unknown>
  prev(): Promise<unknown>
  next(): Promise<unknown>
  close(): void
  /** 分页/滚动与排版属性都在 renderer 上 */
  renderer: HTMLElement & {
    setAttribute(name: string, value: string): void
    getAttribute(name: string): string | null
    /** 已加载章节的 iframe 内容（主题/字号变更时重新注入） */
    getContents?(): { doc: Document; index: number }[]
    goPrev?(): Promise<unknown>
    goNext?(): Promise<unknown>
  }
  book: {
    metadata: { title?: string; author?: string; cover?: Blob | null }
    toc?: FoliateTocItem[]
    dir?: string
  }
  lastLocation?: FoliateRelocateDetail
  addEventListener(type: 'relocate', listener: (event: CustomEvent<FoliateRelocateDetail>) => void): void
  addEventListener(type: 'load', listener: (event: CustomEvent<FoliateLoadDetail>) => void): void
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void
}

export type ReaderThemeName = 'light' | 'sepia' | 'dark'

export interface EpubHandle {
  view: FoliateView
  toc: FoliateTocItem[]
  title: string
  author: string
  destroy(): void
}

export interface OpenEpubOptions {
  /** 挂载容器（需显式宽高） */
  container: HTMLElement
  /** 书籍文件 URL（带 token 的 /api/reader/books/:id/file 直链） */
  url: string
  /** 恢复进度（CFI） */
  lastLocation?: string
  theme: ReaderThemeName
  /** 正文字号 px */
  fontSize: number
  /** 分页（左右翻页）或滚动 */
  flow: 'paginated' | 'scrolled'
  onRelocate: (detail: FoliateRelocateDetail) => void
}

/** 动态加载 vendored view.js（custom element <foliate-view>） */
async function loadFoliateView(): Promise<FoliateViewModule> {
  // @ts-expect-error vendored foliate-js 为无类型 JS（见 lib/reader/foliate/VENDORED.md）
  return await import('../reader/foliate/view.js') as FoliateViewModule
}

const THEME_BODY_STYLES: Record<ReaderThemeName, { background: string; color: string | null }> = {
  light: { background: 'transparent', color: null },
  sepia: { background: 'transparent', color: null },
  dark: { background: 'transparent', color: '#cfcfd2' },
}

/** 主题与字号注入到章节 iframe（每次章节加载都会触发，需重复注入） */
export function injectChapterStyles(doc: Document, theme: ReaderThemeName, fontSize: number): void {
  const style = doc.createElement('style')
  const bodyStyle = THEME_BODY_STYLES[theme]
  style.textContent = `
    html { background: transparent !important; }
    body {
      background: ${bodyStyle.background} !important;
      ${bodyStyle.color ? `color: ${bodyStyle.color} !important;` : ''}
      font-size: ${fontSize}px !important;
      line-height: 1.75 !important;
    }
    img, svg, video { max-width: 100% !important; height: auto !important; }
  `
  doc.head.appendChild(style)
}

/** 主题/字号变更后对所有已加载章节重新注入 */
export function applyEpubTheme(handle: EpubHandle, theme: ReaderThemeName, fontSize: number): void {
  const contents = handle.view.renderer.getContents?.() ?? []
  for (const { doc } of contents) {
    injectChapterStyles(doc, theme, fontSize)
  }
}

/** 打开一本书并挂到容器；返回句柄（翻页/目录/销毁） */
export async function openEpub(options: OpenEpubOptions): Promise<EpubHandle> {
  const { container } = options

  // 1. 拉取书籍字节（view.open 的格式探测读 file.name / file.type，须给 File 而非裸 Blob）
  const res = await fetch(options.url)
  if (!res.ok) throw new Error(`书籍加载失败（${res.status}）`)
  const blob = await res.blob()
  const file = new File([blob], 'book.epub', { type: 'application/epub+zip' })

  // 2. 动态加载引擎并创建 custom element
  const { View } = await loadFoliateView()
  const view = new View()
  view.setAttribute('flow', options.flow)
  container.appendChild(view)

  let toc: FoliateTocItem[] = []
  let title = ''
  let author = ''

  view.addEventListener('load', (event) => {
    injectChapterStyles(event.detail.doc, options.theme, options.fontSize)
  })
  view.addEventListener('relocate', (event) => {
    options.onRelocate(event.detail)
  })

  await view.open(file)
  toc = view.book.toc ?? []
  title = view.book.metadata?.title ?? ''
  author = view.book.metadata?.author ?? ''

  await view.init({ lastLocation: options.lastLocation || undefined })

  return {
    view,
    toc,
    title,
    author,
    destroy() {
      view.close()
      view.remove()
    },
  }
}
