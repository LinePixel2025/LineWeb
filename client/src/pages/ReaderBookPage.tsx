import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Icon from '../components/ui/Icon'
import { api, getToken } from '../lib/api'
import {
  openEpub,
  type EpubHandle,
  type FoliateLoadDetail,
  type FoliateRelocateDetail,
  type FoliateTocItem,
  type ReaderThemeName,
} from '../lib/reader/epubReader'
import {
  collectEpubBlocks,
  findEpubStartIndex,
  injectEpubAppearance,
  pickActiveEpubDoc,
  refreshEpubLayout,
  scrollEpubToBlock,
  setEpubSpeakingBlock,
  type EpubBlock,
} from '../lib/reader/epubExtras'
import {
  buildSpeechChunks,
  isSpeechSupported,
  ReaderSpeech,
  SPEECH_RATES,
  type SpeechChunk,
} from '../lib/reader/speech'
import { buildTxtChapterContent, type TxtChapterContent } from '../lib/reader/txtContent'
import { decodeTxt, splitTxtChapters, txtPercent, type TxtChapter } from '../lib/reader/txtChapters'
import type { BookDto, ReaderBooksResponse, TxtLocation } from '../types/reader'

/**
 * 阅读视图（/reader/:bookId）——沉浸式阅读壳。
 *
 *   - 整页 fixed 铺满视口（盖住站点导航），正文之外只剩可自动隐藏的浮动工具条；
 *   - 顶部浮动 chrome：返回 / 书名 / 章节 / 进度 / 目录，鼠标移到顶部或点击顶部可唤回；
 *   - 底部播放器条：章节进度、全书百分比、上一章/下一页（EPUB prev/next）、可拖动定位
 *     （TXT 拖章节内滚动比例；EPUB 仅展示，避免 fraction 跳转造成排版抖动）；
 *   - 设置 sheet：主题 / 字号 / 行距 / 页宽 / 分页滚动（localStorage 持久化）；
 *   - 听书：Web Speech API，整章顺序朗读 + 暂停/继续 + 上/下一段 + 语速，段落高亮；
 *   - EPUB 仍由 vendored foliate-js 渲染，进度保存/恢复、目录、主题、字号语义保持不变；
 *   - TXT 自绘章节：真实字号/行距/页宽，恢复 scroll offset，切章平滑回顶部。
 */

const THEME_KEY = 'lineweb_reader_theme'
const FONT_KEY = 'lineweb_reader_font'
const FLOW_KEY = 'lineweb_reader_flow'
const LINE_HEIGHT_KEY = 'lineweb_reader_line_height'
const PAGE_WIDTH_KEY = 'lineweb_reader_page_width'
const TTS_RATE_KEY = 'lineweb_reader_tts_rate'
const PROGRESS_SAVE_DELAY_MS = 2000

const FONT_MIN = 14
const FONT_MAX = 30
const LINE_HEIGHTS = [1.6, 1.9, 2.2] as const
const PAGE_WIDTHS = { narrow: 600, standard: 720, wide: 880 } as const
type PageWidthKey = keyof typeof PAGE_WIDTHS
const PAGE_WIDTH_OPTIONS: { key: PageWidthKey; label: string }[] = [
  { key: 'narrow', label: '窄' },
  { key: 'standard', label: '标准' },
  { key: 'wide', label: '宽' },
]

const THEMES: { key: ReaderThemeName; label: string }[] = [
  { key: 'light', label: '明亮' },
  { key: 'sepia', label: '羊皮纸' },
  { key: 'dark', label: '夜间' },
]

type SpeechMode = 'txt' | 'epub'
type FlowMode = 'paginated' | 'scrolled'

interface RelocateDetailExt extends FoliateRelocateDetail {
  section?: { current: number; total: number }
}

interface FoliateLocationExtras {
  lastLocation?: { range?: Range }
}

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function tocItemLabel(item: FoliateRelocateDetail['tocItem']): string {
  if (!item) return ''
  const label = item.label as unknown
  if (typeof label === 'string') return label
  if (label && typeof label === 'object' && 'text' in label) {
    return String((label as { text?: string }).text ?? '')
  }
  return ''
}

function cssVars(vars: Record<string, string>): CSSProperties {
  return vars as unknown as CSSProperties
}

function percentText(value: number): string {
  return `${Math.round(clamp(value, 0, 1) * 100)}%`
}

/** TXT 章节正文（memo：滚动 / 进度变化不再重渲染整章段落） */
const TxtChapterView = memo(function TxtChapterView({
  content,
  activeKey,
  scrollRef,
  onScroll,
  onClick,
}: {
  content: TxtChapterContent
  activeKey: string
  scrollRef: RefObject<HTMLDivElement | null>
  onScroll: () => void
  onClick: (event: ReactMouseEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      ref={scrollRef}
      className={`gh-reader-txt-body${content.lined ? ' gh-reader-txt-body--lined' : ''}`}
      onScroll={onScroll}
      onClick={onClick}
    >
      <article className="gh-reader-txt-paper">
        {content.title && <h1 className="gh-reader-txt-title">{content.title}</h1>}
        <div className="gh-reader-txt-flow">
          {content.paragraphs.map(paragraph => (
            <p
              key={paragraph.key}
              data-para={paragraph.key}
              className={`gh-reader-txt-paragraph${paragraph.key === activeKey ? ' gh-reader-txt-paragraph--active' : ''}`}
            >
              {paragraph.text}
            </p>
          ))}
        </div>
        <div className="gh-reader-txt-end" aria-hidden="true">本章完</div>
      </article>
    </div>
  )
})

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
  const [settingsOpen, setSettingsOpen] = useState(false)

  // 阅读偏好（localStorage 持久化；THEME/FONT/FLOW 键名保持不变）
  const [theme, setTheme] = useState<ReaderThemeName>(() =>
    loadStored(THEME_KEY, ['light', 'sepia', 'dark'] as const, 'light'))
  const [fontSize, setFontSize] = useState<number>(() => {
    const stored = Number(localStorage.getItem(FONT_KEY))
    return stored >= FONT_MIN && stored <= FONT_MAX ? stored : 18
  })
  const [flow, setFlow] = useState<FlowMode>(() =>
    loadStored(FLOW_KEY, ['paginated', 'scrolled'] as const, 'paginated'))
  const [lineHeight, setLineHeight] = useState<number>(() => {
    const stored = Number(localStorage.getItem(LINE_HEIGHT_KEY))
    return (LINE_HEIGHTS as readonly number[]).includes(stored) ? stored : 1.9
  })
  const [pageWidth, setPageWidth] = useState<PageWidthKey>(() =>
    loadStored(PAGE_WIDTH_KEY, ['narrow', 'standard', 'wide'] as const, 'standard'))

  // TXT 模式状态
  const [chapters, setChapters] = useState<TxtChapter[] | null>(null)
  const [chapterIndex, setChapterIndex] = useState(0)
  const [chapterProgress, setChapterProgress] = useState(0)

  // EPUB 章节信息（底部条 / 顶部副标题）
  const [epubSection, setEpubSection] = useState(0)
  const [epubSectionTotal, setEpubSectionTotal] = useState(0)
  const [epubLabel, setEpubLabel] = useState('')

  const [chromeVisible, setChromeVisible] = useState(true)
  const [notice, setNotice] = useState('')

  const [ttsActive, setTtsActive] = useState(false)
  const [ttsPaused, setTtsPaused] = useState(false)
  const [ttsGroupKey, setTtsGroupKey] = useState('')
  const [ttsRate, setTtsRate] = useState<number>(() => {
    const stored = Number(localStorage.getItem(TTS_RATE_KEY))
    return (SPEECH_RATES as readonly number[]).includes(stored) ? stored : 1
  })

  const speechSupported = useMemo(() => isSpeechSupported(), [])

  // DOM / 引擎
  const txtTextRef = useRef('')
  const txtScrollRef = useRef<HTMLDivElement | null>(null)
  const txtRestoreRef = useRef<{ chapter: number; offset: number } | null>(null)
  const epubRef = useRef<EpubHandle | null>(null)
  const epubContainerRef = useRef<HTMLDivElement | null>(null)
  const tocPanelRef = useRef<HTMLElement | null>(null)
  const docInteractionsRef = useRef<WeakSet<Document>>(new WeakSet())

  // 进度保存
  const latestProgressRef = useRef<{ location: string; percent: number }>({ location: '', percent: 0 })
  const saveTimerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)

  // 滚动 / 工具条
  const chromeVisibleRef = useRef(true)
  const chromePinnedRef = useRef(false)
  const hideTimerRef = useRef<number | null>(null)
  const panelOpenRef = useRef(false)
  const settingsOpenRef = useRef(false)
  const readyRef = useRef(false)
  const lastTxtScrollTopRef = useRef(0)
  const suppressScrollChromeUntilRef = useRef(0)
  const pendingScrollRef = useRef<{ offset: number; scrollTop: number } | null>(null)
  const scrollRafRef = useRef<number | null>(null)

  // 最新值（供 iframe 内事件 / 异步回调读取）
  const pageWidthRef = useRef(pageWidth)
  const appearanceRef = useRef({ theme, fontSize, lineHeight })
  const flowRef = useRef<FlowMode>(flow)
  const chaptersRef = useRef<TxtChapter[] | null>(null)
  const chapterIndexRef = useRef(0)
  const epubSectionRef = useRef(0)
  const hideChromeRef = useRef<() => void>(() => {})
  const toggleChromeRef = useRef<() => void>(() => {})
  const turnPageRef = useRef<(direction: 1 | -1) => void>(() => {})
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {})
  const stopSpeechRef = useRef<() => void>(() => {})
  const lastEpubPercentRef = useRef(0)

  // 听书
  const speechRef = useRef<ReaderSpeech | null>(null)
  const speechChunksRef = useRef<SpeechChunk[]>([])
  const ttsModeRef = useRef<SpeechMode | null>(null)
  const ttsActiveRef = useRef(false)
  const ttsPausedRef = useRef(false)
  const ttsGroupRef = useRef('')
  const ttsRateRef = useRef(ttsRate)
  const epubSpeechRef = useRef<{ doc: Document; blocks: EpubBlock[] } | null>(null)
  const speechChunkHandlerRef = useRef<(index: number) => void>(() => {})
  const speechEndHandlerRef = useRef<() => void>(() => {})
  const speechErrorHandlerRef = useRef<(message: string) => void>(() => {})
  const noticeTimerRef = useRef<number | null>(null)

  const fileApiPath = Number.isInteger(numericBookId) && numericBookId > 0
    ? `/reader/books/${numericBookId}/file?token=${encodeURIComponent(getToken() ?? '')}`
    : ''
  // openEpub 自己 fetch（相对站点的完整路径）；api.arrayBuffer 会再拼 API_BASE，用 api 相对路径
  const fileUrl = fileApiPath ? `/api${fileApiPath}` : ''

  const ready = !loading && !!book && !loadError && !engineError
  const chapterCount = chapters?.length ?? 0

  /** 当前 TXT 章节正文（滚动 / 进度变化不重算） */
  const txtContent = useMemo<TxtChapterContent | null>(() => {
    if (!chapters || book?.format !== 'txt') return null
    const chapter = chapters[chapterIndex]
    if (!chapter) return null
    return buildTxtChapterContent(
      txtTextRef.current.slice(chapter.start, chapter.end),
      chapter.title,
    )
  }, [book?.format, chapters, chapterIndex])

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

  const clearChromeTimer = useCallback(() => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const scheduleChromeHide = useCallback((delay = 3400) => {
    clearChromeTimer()
    if (!readyRef.current || chromePinnedRef.current || panelOpenRef.current || settingsOpenRef.current) return
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null
      if (chromePinnedRef.current || panelOpenRef.current || settingsOpenRef.current) return
      chromeVisibleRef.current = false
      setChromeVisible(false)
    }, delay)
  }, [clearChromeTimer])

  const showChrome = useCallback(() => {
    chromeVisibleRef.current = true
    setChromeVisible(true)
    scheduleChromeHide()
  }, [scheduleChromeHide])

  const hideChrome = useCallback(() => {
    if (chromePinnedRef.current || panelOpenRef.current || settingsOpenRef.current) return
    clearChromeTimer()
    chromeVisibleRef.current = false
    setChromeVisible(false)
  }, [clearChromeTimer])

  const toggleChrome = useCallback(() => {
    if (panelOpenRef.current || settingsOpenRef.current) return
    if (chromeVisibleRef.current) hideChrome()
    else showChrome()
  }, [hideChrome, showChrome])

  const pushNotice = useCallback((text: string) => {
    setNotice(text)
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), 3000)
  }, [])

  const setPanel = useCallback((open: boolean) => {
    panelOpenRef.current = open
    setPanelOpen(open)
    if (open) {
      clearChromeTimer()
      chromeVisibleRef.current = true
      setChromeVisible(true)
    } else {
      scheduleChromeHide()
    }
  }, [clearChromeTimer, scheduleChromeHide])

  const setSettings = useCallback((open: boolean) => {
    settingsOpenRef.current = open
    setSettingsOpen(open)
    if (open) {
      clearChromeTimer()
      chromeVisibleRef.current = true
      setChromeVisible(true)
    } else {
      scheduleChromeHide()
    }
  }, [clearChromeTimer, scheduleChromeHide])

  /** 停止朗读并清掉所有听书状态（离开页面 / 切书 / 切章 / 手动停止都走这里） */
  const stopSpeech = useCallback(() => {
    speechRef.current?.stop()
    const epubState = epubSpeechRef.current
    if (epubState) setEpubSpeakingBlock(epubState.doc, null)
    epubSpeechRef.current = null
    speechChunksRef.current = []
    ttsModeRef.current = null
    ttsActiveRef.current = false
    ttsPausedRef.current = false
    ttsGroupRef.current = ''
    setTtsActive(false)
    setTtsPaused(false)
    setTtsGroupKey('')
  }, [])

  /** 退出听书（播放条会消失，顺手解除工具条 hover 锁定并安排自动隐藏） */
  const exitSpeech = useCallback(() => {
    stopSpeech()
    chromePinnedRef.current = false
    scheduleChromeHide()
  }, [scheduleChromeHide, stopSpeech])

  // === 打开书籍 ===
  useEffect(() => {
    mountedRef.current = true
    if (!Number.isInteger(numericBookId) || numericBookId <= 0) {
      setLoading(false)
      setLoadError('无效的书籍链接')
      return
    }

    let cancelled = false
    stopSpeech()
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    latestProgressRef.current = { location: '', percent: 0 }
    setLoading(true)
    setBook(null)
    setLoadError('')
    setEngineError('')
    setToc([])
    setChapters(null)
    setChapterIndex(0)
    setPercent(0)
    setChapterProgress(0)
    setEpubSection(0)
    setEpubSectionTotal(0)
    setEpubLabel('')
    setPanelOpen(false)
    setSettingsOpen(false)
    panelOpenRef.current = false
    settingsOpenRef.current = false
    chromeVisibleRef.current = true
    setChromeVisible(true)
    lastEpubPercentRef.current = 0
    txtTextRef.current = ''
    txtRestoreRef.current = null

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
                setPercent(clamp(percentValue, 0, 1))
                // 滚动模式下用进度方向推断工具条收起 / 唤回（分页由 renderer 的 reason 处理）
                if (!ttsActiveRef.current && flowRef.current === 'scrolled') {
                  const previous = lastEpubPercentRef.current
                  if (percentValue > previous + 0.0004) hideChrome()
                  else if (percentValue < previous - 0.0004) showChrome()
                }
                lastEpubPercentRef.current = percentValue
                const section = (detail as RelocateDetailExt).section
                if (section && Number.isFinite(section.current)) {
                  epubSectionRef.current = section.current
                  setEpubSection(section.current)
                  setEpubSectionTotal(Number.isFinite(section.total) ? section.total : 0)
                }
                setEpubLabel(tocItemLabel(detail.tocItem))
                scheduleSave(detail.cfi ?? '', percentValue)
              },
            })
            if (cancelled || !mountedRef.current) {
              handle.destroy()
              return
            }
            epubRef.current = handle
            setToc(handle.toc)
            // 页宽 → foliate paginator 的 max-inline-size（分页/滚动都生效）；
            // 用 ref 取最新值，避免打开期间用户已改设置却被旧闭包覆盖
            applyPageWidth(handle, pageWidthRef.current)
            applyEpubMargin(handle)
            handle.view.renderer.setAttribute('flow', flowRef.current)
            attachEpubListeners(handle)
            // 首次加载的章节在应用主题/字号后需要重排一次
            window.requestAnimationFrame(() => {
              if (mountedRef.current && epubRef.current === handle) refreshEpubLayout(handle)
            })
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
            const restored = parseTxtLocation(target.progress?.location ?? '')
            const initialIndex = Math.min(Math.max(restored.chapter, 0), Math.max(split.length - 1, 0))
            txtRestoreRef.current = { chapter: initialIndex, offset: clamp(restored.offset, 0, 1) }
            setChapters(split)
            setChapterIndex(initialIndex)
            setPercent(txtPercent(split.length, initialIndex, clamp(restored.offset, 0, 1)))
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
      stopSpeech()
      epubRef.current?.destroy()
      epubRef.current = null
      flushSave()
    }
    // 仅在进入页面/换书时执行一次；阅读偏好变化不重建引擎
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericBookId])

  // === 偏好持久化 ===
  useEffect(() => { localStorage.setItem(THEME_KEY, theme) }, [theme])
  useEffect(() => { localStorage.setItem(FONT_KEY, String(fontSize)) }, [fontSize])
  useEffect(() => { localStorage.setItem(FLOW_KEY, flow) }, [flow])
  useEffect(() => { localStorage.setItem(LINE_HEIGHT_KEY, String(lineHeight)) }, [lineHeight])
  useEffect(() => { localStorage.setItem(PAGE_WIDTH_KEY, pageWidth) }, [pageWidth])
  useEffect(() => { localStorage.setItem(TTS_RATE_KEY, String(ttsRate)) }, [ttsRate])

  useEffect(() => {
    appearanceRef.current = { theme, fontSize, lineHeight }
    const handle = epubRef.current
    if (!handle) return
    for (const { doc } of handle.view.renderer.getContents?.() ?? []) {
      injectEpubAppearance(doc, appearanceRef.current)
    }
  }, [theme, fontSize, lineHeight])

  // 字号 / 行距改变后重新分页（render 内部会锚回当前位置）
  useEffect(() => {
    const handle = epubRef.current
    if (!handle) return
    const frame = window.requestAnimationFrame(() => {
      if (epubRef.current === handle) refreshEpubLayout(handle)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [fontSize, lineHeight])

  useEffect(() => {
    pageWidthRef.current = pageWidth
    applyPageWidth(epubRef.current, pageWidth)
  }, [pageWidth])

  // 视口跨过移动端断点时调整 foliate 上下留白，避免底栏 / 顶栏压住正文
  useEffect(() => {
    const onResize = () => applyEpubMargin(epubRef.current)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    flowRef.current = flow
    const handle = epubRef.current
    if (!handle) return
    if (ttsModeRef.current === 'epub') stopSpeech()
    handle.view.renderer.setAttribute('flow', flow)
    // stopSpeech 是稳定回调；只在 flow 切换时执行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow])

  // === 引用同步（供 iframe 内事件 / 朗读异步回调使用） ===
  useEffect(() => { chaptersRef.current = chapters }, [chapters])
  useEffect(() => { chapterIndexRef.current = chapterIndex }, [chapterIndex])
  useEffect(() => { ttsRateRef.current = ttsRate }, [ttsRate])
  useEffect(() => { ttsActiveRef.current = ttsActive }, [ttsActive])
  useEffect(() => { ttsPausedRef.current = ttsPaused }, [ttsPaused])
  useEffect(() => { ttsGroupRef.current = ttsGroupKey }, [ttsGroupKey])
  useEffect(() => { chromeVisibleRef.current = chromeVisible }, [chromeVisible])
  useEffect(() => {
    readyRef.current = ready
    if (ready) scheduleChromeHide(3600)
    else {
      clearChromeTimer()
      chromeVisibleRef.current = true
      setChromeVisible(true)
    }
  }, [ready, scheduleChromeHide, clearChromeTimer])

  // === 创建 / 复用朗读器 ===
  const ensureSpeech = useCallback((): ReaderSpeech => {
    if (!speechRef.current) {
      speechRef.current = new ReaderSpeech({
        onChunk: (index) => speechChunkHandlerRef.current(index),
        onEnd: () => speechEndHandlerRef.current(),
        onError: (message) => speechErrorHandlerRef.current(message),
      })
    }
    return speechRef.current
  }, [])

  const scrollTxtToParagraph = useCallback((key: string) => {
    const container = txtScrollRef.current
    if (!container) return
    const element = container.querySelector<HTMLElement>(`[data-para="${key}"]`)
    if (!element) return
    const box = container.getBoundingClientRect()
    const rect = element.getBoundingClientRect()
    const delta = rect.top - box.top
    const outOfView = delta < box.height * 0.14 || rect.bottom > box.bottom - box.height * 0.18
    if (!outOfView) return
    const target = container.scrollTop + delta - box.height * 0.32
    container.scrollTo({
      top: Math.max(0, target),
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }, [])

  const applySpeechHighlight = useCallback((group: string) => {
    if (ttsModeRef.current === 'txt') {
      scrollTxtToParagraph(group)
      return
    }
    const state = epubSpeechRef.current
    const handle = epubRef.current
    if (!state || !handle) return
    const block = state.blocks.find(item => item.key === group)
    if (!block) return
    setEpubSpeakingBlock(state.doc, block.element)
    scrollEpubToBlock(handle, state.doc, block.element)
  }, [scrollTxtToParagraph])

  useEffect(() => {
    speechChunkHandlerRef.current = (index) => {
      const chunk = speechChunksRef.current[index]
      if (!chunk) return
      if (ttsGroupRef.current === chunk.group) return
      ttsGroupRef.current = chunk.group
      setTtsGroupKey(chunk.group)
      applySpeechHighlight(chunk.group)
    }
    speechEndHandlerRef.current = () => {
      const mode = ttsModeRef.current
      let hadNextChapter = false
      if (mode === 'txt') {
        const all = chaptersRef.current
        const next = chapterIndexRef.current + 1
        if (all && next < all.length) {
          hadNextChapter = true
          const chapter = all[next]
          const content = buildTxtChapterContent(
            txtTextRef.current.slice(chapter.start, chapter.end),
            chapter.title,
          )
          const chunks = buildSpeechChunks(content.paragraphs)
          if (chunks.length > 0) {
            setChapterIndex(next)
            chapterIndexRef.current = next
            setChapterProgress(0)
            speechChunksRef.current = chunks
            ttsModeRef.current = 'txt'
            ttsGroupRef.current = ''
            setTtsGroupKey('')
            ttsActiveRef.current = true
            ttsPausedRef.current = false
            setTtsActive(true)
            setTtsPaused(false)
            speechRef.current?.start(chunks, 0, ttsRateRef.current)
            return
          }
        }
      }
      exitSpeech()
      pushNotice(
        mode === 'txt'
          ? (hadNextChapter ? '下一章没有可朗读的文字' : '已读完本书')
          : '本节已朗读完毕',
      )
    }
    speechErrorHandlerRef.current = (message) => {
      exitSpeech()
      pushNotice(message)
    }
  })

  // === 切页 / 章节 ===
  const turnPage = useCallback((direction: 1 | -1) => {
    const view = epubRef.current?.view
    if (!view) return
    stopSpeech()
    hideChrome()
    void (direction > 0 ? view.next() : view.prev()).catch(() => {})
  }, [stopSpeech, hideChrome])

  const changeChapter = useCallback((index: number) => {
    const all = chaptersRef.current
    if (!all) return
    stopSpeech()
    setPanel(false)
    setChapterIndex(clamp(index, 0, all.length - 1))
    setChapterProgress(0)
  }, [setPanel, stopSpeech])

  const goToTocItem = useCallback((item: FoliateTocItem) => {
    stopSpeech()
    setPanel(false)
    const view = epubRef.current?.view
    if (!view) return
    hideChrome()
    void view.goTo({ href: item.href })
  }, [setPanel, stopSpeech, hideChrome])

  // === 工具条自动隐藏：回车/离开 ===
  const pinChrome = useCallback(() => {
    chromePinnedRef.current = true
    clearChromeTimer()
  }, [clearChromeTimer])

  const unpinChrome = useCallback(() => {
    chromePinnedRef.current = false
    scheduleChromeHide()
  }, [scheduleChromeHide])

  const handleChromeBlur = useCallback((event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget
    if (next instanceof Node && event.currentTarget.contains(next)) return
    unpinChrome()
  }, [unpinChrome])

  // === EPUB 渲染外围：样式 / 点击翻页 / 滑动翻页 ===
  const attachDocInteractions = useCallback((doc: Document) => {
    if (docInteractionsRef.current.has(doc)) return
    docInteractionsRef.current.add(doc)

    let lastTouchMoveAt = 0
    doc.addEventListener('touchmove', () => { lastTouchMoveAt = Date.now() }, { passive: true })

    doc.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0) return
      // 滑动结束后的合成 click 不再触发点击翻页（滑动翻页由 foliate 处理）
      if (Date.now() - lastTouchMoveAt < 500) return
      const target = event.target as Element | null
      if (target?.closest('a, button, input, textarea, select, summary, [role="button"], [contenteditable="true"]')) return
      const selection = doc.defaultView?.getSelection()
      if (selection && !selection.isCollapsed) return
      if (panelOpenRef.current || settingsOpenRef.current) return
      const width = doc.documentElement.clientWidth || 1
      if (flowRef.current === 'paginated') {
        if (event.clientX < width * 0.28) {
          turnPageRef.current(-1)
          return
        }
        if (event.clientX > width * 0.72) {
          turnPageRef.current(1)
          return
        }
      }
      toggleChromeRef.current()
    })

    // 左右滑动翻页由 foliate paginator 自身处理（它会监听 iframe 的 touch 事件），
    // 这里不要再加一份，否则一次滑动会翻两页。

    doc.addEventListener('keydown', (event) => keyHandlerRef.current(event))
  }, [])

  const attachEpubListeners = useCallback((handle: EpubHandle) => {
    handle.view.addEventListener('load', (event) => {
      const detail = (event as CustomEvent<FoliateLoadDetail>).detail
      if (!detail?.doc) return
      injectEpubAppearance(detail.doc, appearanceRef.current)
      attachDocInteractions(detail.doc)
    })

    // 直接监听 renderer 的原始 relocate：拿到 reason/index 做工具条隐藏与章节跟踪
    handle.view.renderer.addEventListener('relocate', (event) => {
      const detail = (event as CustomEvent<{ reason?: string; index?: number }>).detail
      if (!detail) return
      if (typeof detail.index === 'number') {
        epubSectionRef.current = detail.index
        setEpubSection(detail.index)
      }
      if (detail.reason === 'snap' && ttsActiveRef.current) stopSpeechRef.current()
      if ((detail.reason === 'page' || detail.reason === 'snap') && !ttsActiveRef.current) {
        hideChromeRef.current()
      }
    })

    // openEpub 返回前已加载的章节：补样式与交互
    const contents = handle.view.renderer.getContents?.() ?? []
    for (const { doc } of contents) {
      injectEpubAppearance(doc, appearanceRef.current)
      attachDocInteractions(doc)
    }
  }, [attachDocInteractions])

  // === TXT 滚动进度 ===
  const handleTxtScroll = useCallback(() => {
    const element = txtScrollRef.current
    if (!element || !chaptersRef.current) return
    const scrollable = element.scrollHeight - element.clientHeight
    const offset = scrollable > 0 ? clamp(element.scrollTop / scrollable, 0, 1) : 0
    pendingScrollRef.current = { offset, scrollTop: element.scrollTop }
    if (scrollRafRef.current !== null) return
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null
      const pending = pendingScrollRef.current
      const all = chaptersRef.current
      if (!pending || !all) return
      const index = chapterIndexRef.current
      const nextPercent = txtPercent(all.length, index, pending.offset)
      setChapterProgress(prev => Math.abs(prev - pending.offset) > 0.0008 ? pending.offset : prev)
      setPercent(prev => {
        const rounded = Math.round(nextPercent * 1000) / 1000
        return Math.abs(prev - rounded) > 0.0005 ? rounded : prev
      })
      const location = JSON.stringify({
        chapter: index,
        offset: Math.round(pending.offset * 10000) / 10000,
      } satisfies TxtLocation)
      scheduleSave(location, nextPercent)

      if (performance.now() > suppressScrollChromeUntilRef.current) {
        const delta = pending.scrollTop - lastTxtScrollTopRef.current
        if (delta > 18) hideChrome()
        else if (delta < -18) showChrome()
      }
      lastTxtScrollTopRef.current = pending.scrollTop
    })
  }, [hideChrome, scheduleSave, showChrome])

  // 章节切换：恢复上次 offset / 平滑回顶部
  useEffect(() => {
    if (!chapters) return
    const element = txtScrollRef.current
    if (!element) return
    const restore = txtRestoreRef.current
    const isRestore = !!restore && restore.chapter === chapterIndex
    const targetOffset = isRestore ? clamp(restore.offset, 0, 1) : 0
    if (isRestore) txtRestoreRef.current = null

    const frame = window.requestAnimationFrame(() => {
      const scrollable = Math.max(0, element.scrollHeight - element.clientHeight)
      const targetTop = Math.round(scrollable * targetOffset)
      suppressScrollChromeUntilRef.current = performance.now() + 700
      if (isRestore) {
        element.scrollTop = targetTop
      } else if (element.scrollTop > 0) {
        element.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
      }
      const applied = isRestore && scrollable > 0
        ? clamp(element.scrollTop / scrollable, 0, 1)
        : 0
      setChapterProgress(applied)
      const nextPercent = txtPercent(chapters.length, chapterIndex, applied)
      setPercent(nextPercent)
      lastTxtScrollTopRef.current = element.scrollTop
      scheduleSave(JSON.stringify({
        chapter: chapterIndex,
        offset: Math.round(applied * 10000) / 10000,
      } satisfies TxtLocation), nextPercent)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [chapters, chapterIndex, scheduleSave])

  // 目录打开时把当前章节滚到可视区
  useEffect(() => {
    if (!panelOpen) return
    const active = tocPanelRef.current?.querySelector<HTMLElement>('.gh-reader-toc-item--active')
    active?.scrollIntoView({ block: 'center' })
  }, [panelOpen, chapterIndex])

  // === 键盘翻页 ===
  const scrollTxtPage = useCallback((direction: 1 | -1) => {
    const element = txtScrollRef.current
    if (!element) return
    element.scrollBy({
      top: direction * element.clientHeight * 0.82,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }, [])

  const toggleTtsPause = useCallback(() => {
    const speech = speechRef.current
    if (!speech?.active) return
    if (ttsPausedRef.current) {
      speech.resume()
      ttsPausedRef.current = false
      setTtsPaused(false)
    } else {
      speech.pause()
      ttsPausedRef.current = true
      setTtsPaused(true)
    }
  }, [])

  const keyHandler = useCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
    const target = event.target as HTMLElement | null
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
    if (panelOpenRef.current || settingsOpenRef.current) {
      if (event.key === 'Escape') {
        setPanel(false)
        setSettings(false)
      }
      return
    }
    if (target?.closest('button, a, [role="button"]') && (event.key === ' ' || event.key === 'Enter')) return
    if (event.key === 'Escape') {
      event.preventDefault()
      if (ttsActiveRef.current) exitSpeech()
      else hideChrome()
      return
    }
    if (ttsActiveRef.current && (event.key === ' ' || event.key === 'Spacebar')) {
      event.preventDefault()
      toggleTtsPause()
      return
    }
    const isEpub = book?.format === 'epub'
    if (isEpub) {
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault()
        turnPage(-1)
      } else if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault()
        turnPage(1)
      }
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      changeChapter(chapterIndexRef.current - 1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      changeChapter(chapterIndexRef.current + 1)
    } else if (event.key === 'PageDown' || event.key === ' ') {
      event.preventDefault()
      scrollTxtPage(1)
    } else if (event.key === 'PageUp') {
      event.preventDefault()
      scrollTxtPage(-1)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      scrollTxtPage(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      scrollTxtPage(-1)
    }
  }, [book?.format, changeChapter, exitSpeech, hideChrome, scrollTxtPage, setPanel, setSettings, toggleTtsPause, turnPage])

  useEffect(() => {
    keyHandlerRef.current = keyHandler
    hideChromeRef.current = hideChrome
    toggleChromeRef.current = toggleChrome
    turnPageRef.current = turnPage
    stopSpeechRef.current = stopSpeech
  }, [keyHandler, hideChrome, toggleChrome, turnPage, stopSpeech])

  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandlerRef.current(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  // === 页面壳：滚动锁 + 离开清理 ===
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
      if (scrollRafRef.current !== null) window.cancelAnimationFrame(scrollRafRef.current)
      speechRef.current?.stop()
      speechRef.current = null
    }
  }, [])

  // === 听书启动 ===
  const startTts = useCallback(() => {
    if (!book || !ready) return
    if (!speechSupported) {
      pushNotice('当前浏览器不支持语音朗读')
      return
    }
    const speech = ensureSpeech()
    stopSpeech()
    if (book.format === 'txt') {
      if (!txtContent) return
      const chunks = buildSpeechChunks(txtContent.paragraphs)
      if (chunks.length === 0) {
        pushNotice('本章没有可朗读的文字')
        return
      }
      speechChunksRef.current = chunks
      epubSpeechRef.current = null
      ttsModeRef.current = 'txt'
      if (!speech.start(chunks, 0, ttsRateRef.current)) return
      ttsActiveRef.current = true
      ttsPausedRef.current = false
      setTtsActive(true)
      setTtsPaused(false)
      setTtsGroupKey('')
      return
    }

    const handle = epubRef.current
    if (!handle) {
      pushNotice('正文还在加载，请稍后再试')
      return
    }
    const doc = pickActiveEpubDoc(handle, epubSectionRef.current)
    if (!doc) {
      pushNotice('正文还在加载，请稍后再试')
      return
    }
    const blocks = collectEpubBlocks(doc)
    if (blocks.length === 0) {
      pushNotice('本节没有可朗读的文字')
      return
    }
    const chunks = buildSpeechChunks(blocks)
    if (chunks.length === 0) {
      pushNotice('本节没有可朗读的文字')
      return
    }
    const visibleRange = (handle.view as unknown as FoliateLocationExtras).lastLocation?.range
    const startBlock = findEpubStartIndex(doc, blocks, visibleRange)
    const startIndex = Math.max(0, chunks.findIndex(chunk => chunk.group === blocks[startBlock].key))
    epubSpeechRef.current = { doc, blocks }
    speechChunksRef.current = chunks
    ttsModeRef.current = 'epub'
    if (!speech.start(chunks, startIndex, ttsRateRef.current)) {
      epubSpeechRef.current = null
      ttsModeRef.current = null
      return
    }
    ttsActiveRef.current = true
    ttsPausedRef.current = false
    setTtsActive(true)
    setTtsPaused(false)
    setTtsGroupKey('')
  }, [book, ensureSpeech, pushNotice, ready, speechSupported, stopSpeech, txtContent])

  const skipSpeech = useCallback((direction: 1 | -1) => {
    const speech = speechRef.current
    if (!speech?.active) return
    ttsPausedRef.current = false
    setTtsPaused(false)
    speech.skip(direction)
  }, [])

  const changeTtsRate = useCallback((rate: number) => {
    ttsRateRef.current = rate
    setTtsRate(rate)
    speechRef.current?.setRate(rate)
  }, [])

  // === 其他交互 ===
  const handleBack = useCallback(() => {
    stopSpeech()
    flushSave()
    navigate('/reader')
  }, [flushSave, navigate, stopSpeech])

  const handleTxtClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (panelOpenRef.current || settingsOpenRef.current) return
    const target = event.target as HTMLElement
    if (target.closest('a, button')) return
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) return
    toggleChromeRef.current()
  }, [])

  const handleTxtScrub = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const next = clamp(Number(event.target.value) / 1000, 0, 1)
    if (ttsActiveRef.current) stopSpeech()
    setChapterProgress(next)
    const element = txtScrollRef.current
    if (!element) return
    const scrollable = element.scrollHeight - element.clientHeight
    if (scrollable <= 0) return
    suppressScrollChromeUntilRef.current = performance.now() + 500
    element.scrollTop = scrollable * next
  }, [stopSpeech])

  const changeFlow = useCallback((next: FlowMode) => {
    if (next === flow) return
    setFlow(next)
  }, [flow])

  const chapterLabel = book?.format === 'txt'
    ? (chapters?.[chapterIndex]?.title ?? '')
    : (epubLabel || (epubSectionTotal > 0 ? `第 ${epubSection + 1} 节` : ''))
  const chapterPercent = Math.round(clamp(chapterProgress, 0, 1) * 100)
  const playbarVisible = ready && (chromeVisible || settingsOpen || ttsActive)
  const percentValue = clamp(percent, 0, 1)
  const fontSliderFill = `${((fontSize - FONT_MIN) / (FONT_MAX - FONT_MIN)) * 100}%`

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
            <span className="gh-reader-toc-index">{index + 1}</span>
            <span className="gh-reader-toc-label">{chapter.title}</span>
          </button>
        </li>
      ))}
    </ul>
  )

  return (
    <div
      className={`gh-page gh-reader-book-page gh-reader-book-page--${theme}${chromeVisible ? ' gh-reader-book-page--chrome' : ''}${ttsActive ? ' gh-reader-book-page--tts' : ''}${settingsOpen ? ' gh-reader-book-page--sheet' : ''}`}
      style={cssVars({
        '--reader-txt-size': `${fontSize}px`,
        '--reader-line-height': String(lineHeight),
        '--reader-column-width': `${PAGE_WIDTHS[pageWidth]}px`,
      })}
    >
      <div className="gh-reader-topzone">
        <button
          type="button"
          className="gh-reader-topzone-btn"
          aria-label="显示阅读工具条"
          tabIndex={chromeVisible ? -1 : 0}
          onPointerEnter={showChrome}
          onClick={showChrome}
        >
          <span className="gh-reader-topzone-handle" aria-hidden="true" />
        </button>
      </div>

      <header
        className={`gh-reader-chrome${chromeVisible ? ' is-visible' : ''}`}
        aria-hidden={!chromeVisible}
        inert={!chromeVisible}
        onPointerEnter={pinChrome}
        onPointerLeave={unpinChrome}
        onFocusCapture={pinChrome}
        onBlurCapture={handleChromeBlur}
      >
        <div className="gh-reader-chrome-inner">
          <button className="gh-reader-tool-btn" onClick={handleBack} aria-label="返回书架">
            <Icon name="arrow-left" size={18} />
          </button>
          <div className="gh-reader-chrome-title">
            <span className="gh-reader-chrome-book" title={book?.title}>{book?.title ?? '加载中…'}</span>
            <span className="gh-reader-chrome-chapter">{chapterLabel || ' '}</span>
          </div>
          <span className="gh-reader-chrome-percent">{percentText(percentValue)}</span>
          <button
            className="gh-reader-tool-btn"
            onClick={() => setPanel(true)}
            aria-label="目录"
            aria-expanded={panelOpen}
          >
            <Icon name="list" size={18} />
          </button>
        </div>
      </header>

      <main className="gh-reader-stage">
        {loading && (
          <div className="gh-reader-loading">
            <span className="gh-spinner" aria-hidden="true" />
            <span>正在打开《{book?.title ?? '…'}》…</span>
          </div>
        )}
        {!loading && loadError && (
          <div className="gh-reader-error-card">
            <span className="gh-reader-error-icon"><Icon name="bookOpen" size={26} /></span>
            <p>{loadError}</p>
            <button className="gh-btn gh-btn--ghost" onClick={() => navigate('/reader')}>返回书架</button>
          </div>
        )}
        {!loading && !loadError && engineError && (
          <div className="gh-reader-error-card">
            <span className="gh-reader-error-icon"><Icon name="bookOpen" size={26} /></span>
            <p>{engineError}</p>
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
        {book?.format === 'txt' && txtContent && (
          <TxtChapterView
            content={txtContent}
            activeKey={ttsGroupKey}
            scrollRef={txtScrollRef}
            onScroll={handleTxtScroll}
            onClick={handleTxtClick}
          />
        )}
      </main>

      {playbarVisible && (
        <footer
          className="gh-reader-playbar"
          onPointerEnter={pinChrome}
          onPointerLeave={unpinChrome}
          onFocusCapture={pinChrome}
          onBlurCapture={handleChromeBlur}
        >
          {ttsActive && speechSupported && (
            <div className="gh-reader-ttsbar">
              <span className={`gh-reader-tts-state${ttsPaused ? '' : ' is-reading'}`} aria-live="polite">
                <span className="gh-reader-tts-dot" aria-hidden="true" />
                {ttsPaused ? '已暂停' : '正在朗读'}
              </span>
              <div className="gh-reader-tts-controls">
                <button className="gh-reader-tts-btn" onClick={() => skipSpeech(-1)} aria-label="上一段">
                  <Icon name="skip-back" size={18} />
                </button>
                <button
                  className="gh-reader-tts-btn gh-reader-tts-btn--primary"
                  onClick={toggleTtsPause}
                  aria-label={ttsPaused ? '继续朗读' : '暂停朗读'}
                >
                  <Icon name={ttsPaused ? 'play' : 'pause'} size={18} />
                </button>
                <button className="gh-reader-tts-btn" onClick={() => skipSpeech(1)} aria-label="下一段">
                  <Icon name="skip-forward" size={18} />
                </button>
              </div>
              <div className="gh-reader-tts-rate" role="group" aria-label="朗读语速">
                {SPEECH_RATES.map(rate => (
                  <button
                    key={rate}
                    className={`gh-reader-tts-rate-btn${rate === ttsRate ? ' is-active' : ''}`}
                    onClick={() => changeTtsRate(rate)}
                    aria-pressed={rate === ttsRate}
                  >
                    {rate}<span aria-hidden="true">×</span>
                  </button>
                ))}
              </div>
              <button className="gh-reader-tts-close" onClick={exitSpeech} aria-label="退出朗读">
                <Icon name="close" size={16} />
              </button>
            </div>
          )}

          <div className="gh-reader-playbar-progress">
            {book?.format === 'txt' ? (
              <input
                type="range"
                className="gh-reader-slider"
                min={0}
                max={1000}
                step={1}
                value={Math.round(clamp(chapterProgress, 0, 1) * 1000)}
                onChange={handleTxtScrub}
                aria-label="本章阅读进度"
                style={cssVars({ '--reader-slider-fill': `${clamp(chapterProgress, 0, 1) * 100}%` })}
              />
            ) : (
              <div
                className="gh-reader-progress-track"
                role="progressbar"
                aria-label="全书阅读进度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(percentValue * 100)}
              >
                <span style={{ width: `${percentValue * 100}%` }} />
              </div>
            )}
          </div>

          <div className="gh-reader-playbar-main">
            <div className="gh-reader-playbar-nav">
              {book?.format === 'txt' ? (
                <>
                  <button
                    className="gh-reader-nav-btn"
                    onClick={() => changeChapter(chapterIndex - 1)}
                    disabled={chapterIndex <= 0}
                    aria-label="上一章"
                  >
                    <Icon name="skip-back" size={18} />
                    <span className="gh-reader-nav-label">上一章</span>
                  </button>
                  <button
                    className="gh-reader-nav-btn"
                    onClick={() => changeChapter(chapterIndex + 1)}
                    disabled={chapterIndex >= chapterCount - 1}
                    aria-label="下一章"
                  >
                    <span className="gh-reader-nav-label">下一章</span>
                    <Icon name="skip-forward" size={18} />
                  </button>
                </>
              ) : (
                <>
                  <button className="gh-reader-nav-btn" onClick={() => turnPage(-1)} aria-label="上一页">
                    <Icon name="chevron-left" size={18} />
                    <span className="gh-reader-nav-label">上一页</span>
                  </button>
                  <button className="gh-reader-nav-btn" onClick={() => turnPage(1)} aria-label="下一页">
                    <span className="gh-reader-nav-label">下一页</span>
                    <Icon name="chevron-right" size={18} />
                  </button>
                </>
              )}
            </div>

            <div className="gh-reader-playbar-meta">
              <span className="gh-reader-playbar-chapter">{chapterLabel || '正文'}</span>
              <span className="gh-reader-playbar-stat">
                {book?.format === 'txt'
                  ? `第 ${chapterIndex + 1} / ${chapterCount} 章 · 本章 ${chapterPercent}%`
                  : `第 ${epubSection + 1}${epubSectionTotal > 0 ? ` / ${epubSectionTotal}` : ''} 节 · 全书 ${percentText(percentValue)}`}
              </span>
            </div>

            <div className="gh-reader-playbar-tools">
              {speechSupported && !ttsActive && (
                <button className="gh-reader-nav-btn gh-reader-nav-btn--tts" onClick={startTts} aria-label="听书">
                  <Icon name="volume" size={18} />
                  <span className="gh-reader-nav-label">听书</span>
                </button>
              )}
              <button
                className="gh-reader-tool-btn"
                onClick={() => setSettings(true)}
                aria-label="阅读设置"
                aria-expanded={settingsOpen}
              >
                <Icon name="settings" size={18} />
              </button>
            </div>
          </div>
        </footer>
      )}

      {ready && !playbarVisible && (
        <div className="gh-reader-hairline" aria-hidden="true">
          <span style={{ width: `${percentValue * 100}%` }} />
        </div>
      )}

      {notice && (
        <div className="gh-reader-notice" role="status">{notice}</div>
      )}

      {panelOpen && (
        <>
          <div className="gh-reader-backdrop" onClick={() => setPanel(false)} />
          <aside
            className="gh-reader-toc"
            ref={tocPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label="目录"
          >
            <div className="gh-reader-toc-head">
              <div className="gh-reader-toc-heading">
                <span className="gh-reader-toc-eyebrow">
                  {book?.format === 'epub' ? '目录' : `共 ${chapterCount} 章`}
                </span>
                <h2>{book?.title ?? '目录'}</h2>
              </div>
              <button className="gh-reader-tool-btn" onClick={() => setPanel(false)} aria-label="关闭目录">
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className="gh-reader-toc-body">
              {book?.format === 'epub'
                ? (toc.length > 0 ? renderToc(toc) : <p className="gh-reader-toc-empty">本书没有目录信息</p>)
                : renderTxtToc()}
            </div>
          </aside>
        </>
      )}

      {settingsOpen && (
        <>
          <div className="gh-reader-backdrop gh-reader-backdrop--sheet" onClick={() => setSettings(false)} />
          <section className="gh-reader-sheet" role="dialog" aria-modal="true" aria-label="阅读设置">
            <div className="gh-reader-sheet-grabber" aria-hidden="true" />
            <header className="gh-reader-sheet-head">
              <h2>阅读设置</h2>
              <button className="gh-reader-tool-btn" onClick={() => setSettings(false)} aria-label="关闭设置">
                <Icon name="close" size={18} />
              </button>
            </header>
            <div className="gh-reader-sheet-body">
              <section className="gh-reader-setting">
                <div className="gh-reader-setting-label"><span>主题</span></div>
                <div className="gh-reader-theme-options">
                  {THEMES.map(item => (
                    <button
                      key={item.key}
                      className={`gh-reader-theme-option gh-reader-theme-option--${item.key}${theme === item.key ? ' is-active' : ''}`}
                      onClick={() => setTheme(item.key)}
                      aria-pressed={theme === item.key}
                    >
                      <span className="gh-reader-theme-swatch" aria-hidden="true" />
                      <span className="gh-reader-theme-name">{item.label}</span>
                      {theme === item.key && <Icon name="check" size={14} />}
                    </button>
                  ))}
                </div>
              </section>

              <section className="gh-reader-setting">
                <div className="gh-reader-setting-label">
                  <span>字号</span>
                  <span className="gh-reader-setting-value">{fontSize}px</span>
                </div>
                <div className="gh-reader-font-row">
                  <button
                    className="gh-reader-step-btn"
                    onClick={() => setFontSize(size => Math.max(FONT_MIN, size - 1))}
                    aria-label="减小字号"
                  >
                    A−
                  </button>
                  <input
                    type="range"
                    className="gh-reader-slider"
                    min={FONT_MIN}
                    max={FONT_MAX}
                    step={1}
                    value={fontSize}
                    onChange={event => setFontSize(clamp(Number(event.target.value), FONT_MIN, FONT_MAX))}
                    aria-label="字号"
                    style={cssVars({ '--reader-slider-fill': fontSliderFill })}
                  />
                  <button
                    className="gh-reader-step-btn"
                    onClick={() => setFontSize(size => Math.min(FONT_MAX, size + 1))}
                    aria-label="增大字号"
                  >
                    A+
                  </button>
                </div>
              </section>

              <section className="gh-reader-setting">
                <div className="gh-reader-setting-label">
                  <span>行距</span>
                  <span className="gh-reader-setting-value">{lineHeight.toFixed(1)}</span>
                </div>
                <div className="gh-reader-seg">
                  {LINE_HEIGHTS.map(value => (
                    <button
                      key={value}
                      className={lineHeight === value ? 'is-active' : ''}
                      onClick={() => setLineHeight(value)}
                      aria-pressed={lineHeight === value}
                    >
                      {value === 1.6 ? '紧凑' : value === 1.9 ? '标准' : '宽松'}
                    </button>
                  ))}
                </div>
              </section>

              <section className="gh-reader-setting">
                <div className="gh-reader-setting-label">
                  <span>页宽</span>
                  <span className="gh-reader-setting-value">{PAGE_WIDTHS[pageWidth]}px</span>
                </div>
                <div className="gh-reader-seg">
                  {PAGE_WIDTH_OPTIONS.map(option => (
                    <button
                      key={option.key}
                      className={pageWidth === option.key ? 'is-active' : ''}
                      onClick={() => setPageWidth(option.key)}
                      aria-pressed={pageWidth === option.key}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="gh-reader-setting">
                <div className="gh-reader-setting-label">
                  <span>排版</span>
                  {book?.format === 'epub' && (
                    <span className="gh-reader-setting-value">
                      {flow === 'paginated' ? '左右分页' : '上下滚动'}
                    </span>
                  )}
                </div>
                {book?.format === 'epub' ? (
                  <div className="gh-reader-seg">
                    <button
                      className={flow === 'paginated' ? 'is-active' : ''}
                      onClick={() => changeFlow('paginated')}
                      aria-pressed={flow === 'paginated'}
                    >
                      分页
                    </button>
                    <button
                      className={flow === 'scrolled' ? 'is-active' : ''}
                      onClick={() => changeFlow('scrolled')}
                      aria-pressed={flow === 'scrolled'}
                    >
                      滚动
                    </button>
                  </div>
                ) : (
                  <p className="gh-reader-setting-hint">TXT 采用连续滚动排版，字号 / 行距 / 页宽实时生效。</p>
                )}
              </section>

              {!speechSupported && (
                <p className="gh-reader-setting-hint">当前浏览器不支持语音合成，听书入口已隐藏。</p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

/** 页宽 → foliate paginator（分页/滚动模式都受 max-inline-size 控制） */
function applyPageWidth(handle: EpubHandle | null, pageWidth: PageWidthKey): void {
  if (!handle) return
  handle.view.renderer.setAttribute('max-inline-size', `${PAGE_WIDTHS[pageWidth]}px`)
}

/** 上下留白：移动端给浮动工具条让出空间，避免压住正文 */
function applyEpubMargin(handle: EpubHandle | null): void {
  if (!handle) return
  const margin = `${window.innerWidth <= 767 ? 104 : 72}px`
  if (handle.view.renderer.getAttribute('margin') === margin) return
  handle.view.renderer.setAttribute('margin', margin)
  refreshEpubLayout(handle)
}
