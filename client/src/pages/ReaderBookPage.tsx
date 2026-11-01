import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Icon from '../components/ui/Icon'
import { api, getToken } from '../lib/api'
import {
  applyEpubTheme,
  openEpub,
  type EpubHandle,
  type FoliateTocItem,
  type ReaderThemeName,
} from '../lib/reader/epubReader'
import { decodeTxt, splitTxtChapters, txtPercent, type TxtChapter } from '../lib/reader/txtChapters'
import type { BookDto, ReaderBooksResponse, TxtLocation } from '../types/reader'

/**
 * 阅读视图（/reader/:bookId）：
 *   - EPUB：vendored foliate-js 渲染（点击进入时才动态加载），目录/主题/字号/翻页，
 *     进度以 foliate CFI 保存
 *   - TXT：自绘章节渲染（decodeTxt 编码检测 + 正则分章），进度按 {chapter,offset} 保存
 * 进度保存 2 秒防抖 + 卸载/离页冲刷。
 */

const THEME_KEY = 'lineweb_reader_theme'
const FONT_KEY = 'lineweb_reader_font'
const FLOW_KEY = 'lineweb_reader_flow'
const PROGRESS_SAVE_DELAY_MS = 2000
const THEMES: { key: ReaderThemeName; label: string }[] = [
  { key: 'light', label: '明亮' },
  { key: 'sepia', label: '羊皮纸' },
  { key: 'dark', label: '夜间' },
]

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function loadStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const value = localStorage.getItem(key)
  return value && (allowed as readonly string[]).includes(value) ? value as T : fallback
}

function parseTxtLocation(location: string): TxtLocation {
  try {
    const parsed = JSON.parse(location) as Partial<TxtLocation>
    if (typeof parsed.chapter === 'number' && typeof parsed.offset === 'number') {
      return { chapter: parsed.chapter, offset: parsed.offset }
    }
  } catch { /* 忽略损坏的进度 */ }
  return { chapter: 0, offset: 0 }
}

export default function ReaderBookPage() {
  const { bookId } = useParams()
  const navigate = useNavigate()
  const numericBookId = Number(bookId)

  const [book, setBook] = useState<BookDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [engineError, setEngineError] = useState('')

  const [percent, setPercent] = useState(0)
  const [toc, setToc] = useState<FoliateTocItem[]>([])
  const [panelOpen, setPanelOpen] = useState(false)

  // 阅读偏好（localStorage 持久化）
  const [theme, setTheme] = useState<ReaderThemeName>(() =>
    loadStored(THEME_KEY, ['light', 'sepia', 'dark'] as const, 'light'))
  const [fontSize, setFontSize] = useState<number>(() => {
    const stored = Number(localStorage.getItem(FONT_KEY))
    return stored >= 14 && stored <= 28 ? stored : 18
  })
  const [flow, setFlow] = useState<'paginated' | 'scrolled'>(() =>
    loadStored(FLOW_KEY, ['paginated', 'scrolled'] as const, 'paginated'))

  // TXT 模式状态
  const [chapters, setChapters] = useState<TxtChapter[] | null>(null)
  const [chapterIndex, setChapterIndex] = useState(0)
  const txtTextRef = useRef<string>('')
  const txtScrollRef = useRef<HTMLDivElement | null>(null)

  const epubRef = useRef<EpubHandle | null>(null)
  const epubContainerRef = useRef<HTMLDivElement | null>(null)
  const latestProgressRef = useRef<{ location: string; percent: number }>({ location: '', percent: 0 })
  const saveTimerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)

  const fileApiPath = Number.isInteger(numericBookId) && numericBookId > 0
    ? `/reader/books/${numericBookId}/file?token=${encodeURIComponent(getToken() ?? '')}`
    : ''
  // openEpub 自己 fetch（相对站点的完整路径）；api.arrayBuffer 会再拼 API_BASE，用 api 相对路径
  const fileUrl = fileApiPath ? `/api${fileApiPath}` : ''

  /** 合并最新进度并安排 2s 防抖保存 */
  const scheduleSave = useCallback((location: string, percentValue: number) => {
    latestProgressRef.current = { location, percent: percentValue }
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      const progress = latestProgressRef.current
      if (!progress.location && progress.percent <= 0) return
      void api.put(`/reader/books/${numericBookId}/progress`, {
        location: progress.location,
        percent: progress.percent,
      }).catch(() => {}) // 进度保存失败静默（下次翻页再试）
    }, PROGRESS_SAVE_DELAY_MS)
  }, [numericBookId])

  /** 立即冲刷进度（卸载/离页） */
  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const progress = latestProgressRef.current
    if (!progress.location && progress.percent <= 0) return
    void api.put(`/reader/books/${numericBookId}/progress`, {
      location: progress.location,
      percent: progress.percent,
    }).catch(() => {})
  }, [numericBookId])

  // === 打开书籍 ===
  useEffect(() => {
    mountedRef.current = true
    if (!Number.isInteger(numericBookId) || numericBookId <= 0) {
      setLoading(false)
      setLoadError('无效的书籍链接')
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const data = await api.get<ReaderBooksResponse>('/reader/books')
        if (cancelled || !mountedRef.current) return
        const target = data.books.find(item => item.id === numericBookId)
        if (!target) {
          setLoadError('书籍不存在或已被删除')
          setLoading(false)
          return
        }
        setBook(target)

        if (target.format === 'epub') {
          // foliate 动态加载（首次打开书时才拉取引擎 chunk）
          const container = epubContainerRef.current
          if (!container) return
          try {
            const handle = await openEpub({
              container,
              url: fileUrl,
              lastLocation: target.progress?.location || undefined,
              theme,
              fontSize,
              flow,
              onRelocate: (detail) => {
                if (cancelled || !mountedRef.current) return
                const percentValue = Number.isFinite(detail.fraction) ? detail.fraction : 0
                setPercent(percentValue)
                scheduleSave(detail.cfi ?? '', percentValue)
              },
            })
            if (cancelled || !mountedRef.current) {
              handle.destroy()
              return
            }
            epubRef.current = handle
            setToc(handle.toc)
          } catch (err) {
            if (!cancelled && mountedRef.current) {
              console.error('EPUB 引擎加载失败:', err)
              setEngineError('阅读引擎加载失败，请刷新重试')
            }
          }
        } else {
          // TXT：拉原始字节 → 编码检测 → 分章
          try {
            const buffer = await api.arrayBuffer(fileApiPath)
            if (cancelled || !mountedRef.current) return
            const text = decodeTxt(buffer)
            txtTextRef.current = text
            const split = splitTxtChapters(text, target.title)
            setChapters(split)
            const restored = parseTxtLocation(target.progress?.location ?? '')
            const initialIndex = Math.min(Math.max(restored.chapter, 0), Math.max(split.length - 1, 0))
            setChapterIndex(initialIndex)
            setPercent(txtPercent(split.length, initialIndex, restored.offset))
          } catch (err) {
            if (!cancelled && mountedRef.current) {
              setEngineError(errMessage(err, '书籍内容读取失败'))
            }
          }
        }
        if (!cancelled && mountedRef.current) setLoading(false)
      } catch (err) {
        if (!cancelled && mountedRef.current) {
          setLoadError(errMessage(err, '书籍加载失败'))
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
      mountedRef.current = false
      epubRef.current?.destroy()
      epubRef.current = null
      flushSave()
    }
    // 仅在进入页面/换书时执行一次；阅读偏好变化不重建引擎
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericBookId])

  // === 主题/字号/排版变化 ===
  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme)
    if (epubRef.current) applyEpubTheme(epubRef.current, theme, fontSize)
  }, [theme, fontSize])

  useEffect(() => {
    localStorage.setItem(FONT_KEY, String(fontSize))
    if (epubRef.current) applyEpubTheme(epubRef.current, theme, fontSize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontSize])

  useEffect(() => {
    localStorage.setItem(FLOW_KEY, flow)
    epubRef.current?.view.renderer.setAttribute('flow', flow)
  }, [flow])

  // === EPUB 键盘翻页 ===
  useEffect(() => {
    if (!book || book.format !== 'epub') return
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      const view = epubRef.current?.view
      if (!view) return
      if (event.key === 'ArrowLeft') void view.prev()
      if (event.key === 'ArrowRight' || event.key === ' ') {
        event.preventDefault()
        void view.next()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [book])

  // === TXT 章节切换与滚动进度 ===
  useEffect(() => {
    if (!chapters) return
    const offset = txtScrollRef.current
    if (offset) offset.scrollTop = 0
    const percentValue = txtPercent(chapters.length, chapterIndex, 0)
    setPercent(percentValue)
    scheduleSave(JSON.stringify({ chapter: chapterIndex, offset: 0 } satisfies TxtLocation), percentValue)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterIndex, chapters])

  const handleTxtScroll = useCallback(() => {
    const element = txtScrollRef.current
    if (!element || !chapters) return
    const scrollable = element.scrollHeight - element.clientHeight
    const offset = scrollable > 0 ? element.scrollTop / scrollable : 1
    const percentValue = txtPercent(chapters.length, chapterIndex, offset)
    setPercent(percentValue)
    scheduleSave(JSON.stringify({ chapter: chapterIndex, offset } satisfies TxtLocation), percentValue)
  }, [chapters, chapterIndex, scheduleSave])

  const changeChapter = useCallback((index: number) => {
    if (!chapters) return
    setChapterIndex(Math.min(Math.max(index, 0), chapters.length - 1))
    setPanelOpen(false)
  }, [chapters])

  // === 页面隐藏时冲刷进度 ===
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushSave()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flushSave)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flushSave)
    }
  }, [flushSave])

  const percentLabel = `${Math.round(Math.min(Math.max(percent, 0), 1) * 100)}%`

  const goToTocItem = useCallback((item: FoliateTocItem) => {
    const view = epubRef.current?.view
    if (!view) return
    void view.goTo({ href: item.href })
    setPanelOpen(false)
  }, [])

  const renderToc = (items: FoliateTocItem[], depth = 0) => (
    <ul className={`gh-reader-toc-list gh-reader-toc-list--depth-${depth}`}>
      {items.map((item, index) => (
        <li key={`${item.href}-${index}`}>
          <button className="gh-reader-toc-item" onClick={() => goToTocItem(item)}>
            {typeof item.label === 'string' ? item.label : item.label?.text ?? item.href}
          </button>
          {item.subitems && item.subitems.length > 0 && renderToc(item.subitems, depth + 1)}
        </li>
      ))}
    </ul>
  )


  const renderTxtToc = () => (
    <ul className="gh-reader-toc-list">
      {chapters?.map((chapter, index) => (
        <li key={chapter.start}>
          <button
            className={`gh-reader-toc-item ${index === chapterIndex ? 'gh-reader-toc-item--active' : ''}`}
            onClick={() => changeChapter(index)}
          >
            {chapter.title}
          </button>
        </li>
      ))}
    </ul>
  )

  return (
    <div className={`gh-page gh-reader-book-page gh-reader-book-page--${theme}`}>
      <header className="gh-reader-book-header">
        <button className="gh-reader-icon-btn" onClick={() => navigate('/reader')} aria-label="返回书架">
          <Icon name="arrow-left" size={16} />
        </button>
        <div className="gh-reader-book-header-title" title={book?.title}>
          {book?.title ?? '加载中…'}
        </div>
        <span className="gh-reader-book-percent">{percentLabel}</span>
        <button className="gh-reader-icon-btn" onClick={() => setPanelOpen(open => !open)} aria-label="目录">
          <Icon name="list" size={16} />
        </button>
        <button
          className="gh-reader-icon-btn"
          onClick={() => setTheme(THEMES[(THEMES.findIndex(t => t.key === theme) + 1) % THEMES.length].key)}
          aria-label="切换主题"
          title={THEMES.find(t => t.key === theme)?.label}
        >
          <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={16} />
        </button>
        <button className="gh-reader-icon-btn" onClick={() => setFontSize(size => Math.max(14, size - 1))} aria-label="缩小字号">A-</button>
        <button className="gh-reader-icon-btn" onClick={() => setFontSize(size => Math.min(28, size + 1))} aria-label="放大字号">A+</button>
        {book?.format === 'epub' && (
          <button
            className="gh-reader-icon-btn gh-reader-icon-btn--text"
            onClick={() => setFlow(current => current === 'paginated' ? 'scrolled' : 'paginated')}
            title="切换排版"
          >
            {flow === 'paginated' ? '分页' : '滚动'}
          </button>
        )}
      </header>

      {panelOpen && (
        <aside className="gh-reader-panel">
          <div className="gh-reader-panel-head">
            <span>目录</span>
            <button className="gh-reader-icon-btn" onClick={() => setPanelOpen(false)} aria-label="关闭目录">
              <Icon name="close" size={14} />
            </button>
          </div>
          <div className="gh-reader-panel-body">
            {book?.format === 'epub'
              ? (toc.length > 0 ? renderToc(toc) : <div className="gh-reader-panel-empty">本书没有目录信息</div>)
              : renderTxtToc()}
          </div>
        </aside>
      )}

      <div className={`gh-reader-stage ${panelOpen ? 'gh-reader-stage--with-panel' : ''}`}>
        {loading && <div className="gh-reader-loading">正在打开《{book?.title ?? '…'}》…</div>}
        {!loading && loadError && (
          <div className="gh-reader-alert gh-reader-alert--error">
            {loadError}
            <button className="gh-btn gh-btn--ghost" onClick={() => navigate('/reader')}>返回书架</button>
          </div>
        )}
        {!loading && !loadError && engineError && (
          <div className="gh-reader-alert gh-reader-alert--error">
            {engineError}
            <button className="gh-btn gh-btn--ghost" onClick={() => window.location.reload()}>重新加载</button>
          </div>
        )}

        {/* EPUB 渲染容器（foliate-view 由引擎挂载） */}
        <div
          ref={epubContainerRef}
          className={`gh-reader-epub-container ${book?.format === 'epub' ? '' : 'gh-reader-hidden'}`}
          aria-hidden={book?.format !== 'epub'}
        />

        {/* TXT 渲染 */}
        {book?.format === 'txt' && chapters && chapters.length > 0 && (
          <div className="gh-reader-txt-wrap">
            {chapters.length > 1 && (
              <div className="gh-reader-txt-nav gh-reader-txt-nav--top">
                <button
                  className="gh-btn gh-btn--ghost"
                  disabled={chapterIndex <= 0}
                  onClick={() => changeChapter(chapterIndex - 1)}
                >
                  上一章
                </button>
                <span className="gh-reader-txt-chapter-title">{chapters[chapterIndex].title}</span>
                <button
                  className="gh-btn gh-btn--ghost"
                  disabled={chapterIndex >= chapters.length - 1}
                  onClick={() => changeChapter(chapterIndex + 1)}
                >
                  下一章
                </button>
              </div>
            )}
            <div ref={txtScrollRef} className="gh-reader-txt-body" onScroll={handleTxtScroll}>
              {txtTextRef.current.slice(chapters[chapterIndex].start, chapters[chapterIndex].end)}
            </div>
            <div className="gh-reader-txt-nav gh-reader-txt-nav--bottom">
              <button
                className="gh-btn gh-btn--ghost"
                disabled={chapterIndex <= 0}
                onClick={() => changeChapter(chapterIndex - 1)}
              >
                上一章
              </button>
              <span className="gh-reader-txt-progress">{chapterIndex + 1} / {chapters.length}</span>
              <button
                className="gh-btn gh-btn--ghost"
                disabled={chapterIndex >= chapters.length - 1}
                onClick={() => changeChapter(chapterIndex + 1)}
              >
                下一章
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
