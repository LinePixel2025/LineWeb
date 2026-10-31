import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import { usePoints } from '../contexts/PointsContext'
import type {
  StockBuyResult,
  StockHolding,
  StockMarket,
  StockPortfolio,
  StockQuote,
  StockSellResult,
  StockTrend,
} from '../types/stock'

/** 只在本次浏览器会话内记住「不再提示」，刷新页面仍会再次提示 */
const NOTICE_KEY = 'lineweb_stocks_notice_ack'

/** 行情轮询间隔（与服务端 3 秒 tick 对齐） */
const MARKET_POLL_MS = 3_000
/** 行情请求失败后的退避时长，退避期内跳过轮询 */
const MARKET_BACKOFF_MS = 10_000
/** 个股走势（分时 + 日线）轮询间隔 */
const TREND_POLL_MS = 30_000
/** 价格闪烁动画时长（与 stocks.css 的 keyframes 对齐） */
const FLASH_CLEAR_MS = 900
/** 一天的毫秒数（分时图 x 轴：t = 当日 00:00 起的毫秒） */
const DAY_MS = 86_400_000
/** trend.tickMs 异常时的兜底 tick 间隔 */
const FALLBACK_TICK_MS = 3_000

function formatPrice(value: number): string {
  return value.toFixed(2)
}

function formatPct(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

function formatChange(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`
}

function formatVolume(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)} 亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)} 万`
  return String(value)
}

function formatShares(value: number): string {
  return value >= 1000 ? value.toFixed(0) : value.toFixed(2)
}

/** 卖出份额输入框回填：去掉浮点尾差，保留最多 6 位小数 */
function formatSharesInput(value: number): string {
  return String(Math.round(value * 1e6) / 1e6)
}

function formatPoints(value: number): string {
  return value.toLocaleString('zh-CN')
}

function trendClass(value: number): string {
  if (value > 0) return 'gh-stock-up'
  if (value < 0) return 'gh-stock-down'
  return 'gh-stock-flat'
}

/** |changePct| ≥ 5 异动、≥ 9 强烈异动（交易未设涨跌停，不用「涨停/跌停」字样） */
function swingBadge(changePct: number): { text: string; className: string } | null {
  const abs = Math.abs(changePct)
  if (abs < 5) return null
  const direction = changePct >= 0 ? 'up' : 'down'
  return {
    text: abs >= 9 ? '强烈异动' : '异动',
    className: `gh-stocks-badge gh-stocks-badge--${direction}${abs >= 9 ? ' gh-stocks-badge--strong' : ''}`,
  }
}

type FlashDirection = 'up' | 'down'
type ChartMode = 'intraday' | 'daily'

const CHART_WIDTH = 720
const CHART_HEIGHT = 260
const CHART_PAD_X = 18
const CHART_PAD_Y = 22

function PriceChart({
  stock,
  trend,
  loading,
  liveT,
}: {
  stock: StockQuote
  trend: StockTrend | null
  loading: boolean
  liveT: number | null
}) {
  const [mode, setMode] = useState<ChartMode>('intraday')

  // 分时序列 = 后端采样点 + 实时价末端点；采样最后一点与实时点同 tick 时用实时点覆盖
  const intradayPoints = useMemo(() => {
    const points = (trend?.intraday ?? []).map((point) => ({ t: point.t, price: point.price }))
    if (liveT === null) return points
    const tickMs = trend && trend.tickMs > 0 ? trend.tickMs : FALLBACK_TICK_MS
    const livePoint = { t: liveT, price: stock.price }
    const last = points[points.length - 1]
    if (last && Math.floor(last.t / tickMs) === Math.floor(liveT / tickMs)) {
      points[points.length - 1] = livePoint
    } else {
      points.push(livePoint)
    }
    return points
  }, [trend, liveT, stock.price])

  const dailyCandles = trend?.daily ?? []

  const intraday = useMemo(() => {
    if (intradayPoints.length < 2) return null
    const values = intradayPoints.map((point) => point.price)
    if (stock.prevClose > 0) values.push(stock.prevClose)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = max - min || 1
    const x = (t: number) => CHART_PAD_X + (t / DAY_MS) * (CHART_WIDTH - CHART_PAD_X * 2)
    const y = (value: number) =>
      CHART_HEIGHT - CHART_PAD_Y - ((value - min) / span) * (CHART_HEIGHT - CHART_PAD_Y * 2)
    const line = intradayPoints
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.t).toFixed(1)},${y(point.price).toFixed(1)}`)
      .join(' ')
    const lastPoint = intradayPoints[intradayPoints.length - 1]
    const area = `${line} L${x(lastPoint.t).toFixed(1)},${CHART_HEIGHT - CHART_PAD_Y} L${x(intradayPoints[0].t).toFixed(1)},${CHART_HEIGHT - CHART_PAD_Y} Z`
    return { min, max, x, y, line, area, lastPoint }
  }, [intradayPoints, stock.prevClose])

  const daily = useMemo(() => {
    if (dailyCandles.length < 2) return null
    const closes = dailyCandles.map((candle) => candle.close)
    const min = Math.min(...closes)
    const max = Math.max(...closes)
    const span = max - min || 1
    const x = (index: number) => CHART_PAD_X + (index / (closes.length - 1)) * (CHART_WIDTH - CHART_PAD_X * 2)
    const y = (value: number) =>
      CHART_HEIGHT - CHART_PAD_Y - ((value - min) / span) * (CHART_HEIGHT - CHART_PAD_Y * 2)
    const line = closes
      .map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`)
      .join(' ')
    const lastIndex = closes.length - 1
    const area = `${line} L${x(lastIndex).toFixed(1)},${CHART_HEIGHT - CHART_PAD_Y} L${x(0).toFixed(1)},${CHART_HEIGHT - CHART_PAD_Y} Z`
    return { closes, min, max, x, y, line, area, lastIndex }
  }, [dailyCandles])

  const showIntraday = mode === 'intraday'
  const up = showIntraday
    ? stock.price >= stock.prevClose
    : daily ? daily.closes[daily.lastIndex] >= daily.closes[0] : true
  const stroke = up ? 'var(--gh-danger)' : 'var(--gh-success)'

  const renderGrid = (min: number, max: number, y: (value: number) => number) =>
    [null, 0.25, 0.5, 0.75, null].map((ratio, index) => {
      if (ratio === null) return null
      const value = min + (max - min) * ratio
      return (
        <g key={index}>
          <line
            x1={CHART_PAD_X}
            x2={CHART_WIDTH - CHART_PAD_X}
            y1={y(value)}
            y2={y(value)}
            stroke="var(--gh-border-muted)"
            strokeDasharray="3 5"
          />
          <text x={CHART_PAD_X - 4} y={y(value) - 3} textAnchor="end" fontSize="10" fill="var(--gh-text-tertiary)">
            {value.toFixed(1)}
          </text>
        </g>
      )
    })

  let body: ReactNode
  if (showIntraday) {
    if (!intraday) {
      body = (
        <div className="gh-stocks-chart-empty">
          {loading ? '分时数据加载中…' : '今日分时数据尚未生成'}
        </div>
      )
    } else {
      body = (
        <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label={`${stock.name}今日分时`}>
          <defs>
            <linearGradient id={`stock-fill-${stock.code}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0.01" />
            </linearGradient>
          </defs>
          {renderGrid(intraday.min, intraday.max, intraday.y)}
          {stock.prevClose > 0 && (
            <g>
              <line
                x1={CHART_PAD_X}
                x2={CHART_WIDTH - CHART_PAD_X}
                y1={intraday.y(stock.prevClose)}
                y2={intraday.y(stock.prevClose)}
                stroke="var(--gh-text-tertiary)"
                strokeDasharray="2 4"
              />
              <text
                x={CHART_WIDTH - CHART_PAD_X}
                y={intraday.y(stock.prevClose) - 4}
                textAnchor="end"
                fontSize="10"
                fill="var(--gh-text-tertiary)"
              >
                昨收 {formatPrice(stock.prevClose)}
              </text>
            </g>
          )}
          <path d={intraday.area} fill={`url(#stock-fill-${stock.code})`} />
          <path d={intraday.line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={intraday.x(intraday.lastPoint.t)} cy={intraday.y(intraday.lastPoint.price)} r="3.5" fill={stroke} />
          <text x={CHART_PAD_X} y={CHART_HEIGHT - 4} fontSize="10" fill="var(--gh-text-tertiary)">00:00</text>
          <text x={CHART_WIDTH / 2} y={CHART_HEIGHT - 4} fontSize="10" textAnchor="middle" fill="var(--gh-text-tertiary)">12:00</text>
          <text x={CHART_WIDTH - CHART_PAD_X} y={CHART_HEIGHT - 4} fontSize="10" textAnchor="end" fill="var(--gh-text-tertiary)">24:00</text>
        </svg>
      )
    }
  } else if (!daily) {
    body = (
      <div className="gh-stocks-chart-empty">
        {loading ? '走势数据加载中…' : '暂无足够的历史数据'}
      </div>
    )
  } else {
    const startDate = dailyCandles[0].date.slice(5)
    const endDate = dailyCandles[dailyCandles.length - 1].date.slice(5)
    const midDate = dailyCandles[Math.floor(dailyCandles.length / 2)].date.slice(5)
    body = (
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label={`${stock.name}近30日走势`}>
        <defs>
          <linearGradient id={`stock-fill-${stock.code}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {renderGrid(daily.min, daily.max, daily.y)}
        <path d={daily.area} fill={`url(#stock-fill-${stock.code})`} />
        <path d={daily.line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={daily.x(daily.lastIndex)} cy={daily.y(daily.closes[daily.lastIndex])} r="3.5" fill={stroke} />
        <text x={CHART_PAD_X} y={CHART_HEIGHT - 4} fontSize="10" fill="var(--gh-text-tertiary)">{startDate}</text>
        <text x={CHART_WIDTH / 2} y={CHART_HEIGHT - 4} fontSize="10" textAnchor="middle" fill="var(--gh-text-tertiary)">{midDate}</text>
        <text x={CHART_WIDTH - CHART_PAD_X} y={CHART_HEIGHT - 4} fontSize="10" textAnchor="end" fill="var(--gh-text-tertiary)">{endDate}</text>
      </svg>
    )
  }

  return (
    <div className={`gh-stocks-chart ${up ? 'gh-stocks-chart--up' : 'gh-stocks-chart--down'}`}>
      <div className="gh-stocks-chart-head">
        <div className="gh-stocks-chart-tabs" role="group" aria-label="图表模式">
          <button
            type="button"
            className={`gh-stocks-chart-tab ${mode === 'intraday' ? 'gh-stocks-chart-tab--active' : ''}`}
            aria-pressed={mode === 'intraday'}
            onClick={() => setMode('intraday')}
          >
            分时
          </button>
          <button
            type="button"
            className={`gh-stocks-chart-tab ${mode === 'daily' ? 'gh-stocks-chart-tab--active' : ''}`}
            aria-pressed={mode === 'daily'}
            onClick={() => setMode('daily')}
          >
            日线
          </button>
        </div>
      </div>
      {body}
    </div>
  )
}

function HoldingRow({
  holding,
  onSelect,
}: {
  holding: StockHolding
  onSelect: () => void
}) {
  return (
    <button type="button" className="gh-stocks-holding" onClick={onSelect}>
      <span className="gh-stocks-holding-main">
        <i className="gh-stocks-dot" style={{ background: holding.color }} aria-hidden />
        <span>
          <strong>{holding.name}</strong>
          <small>{holding.code} · {holding.sector}</small>
        </span>
      </span>
      <span className="gh-stocks-holding-num">
        <small>持有 / 成本</small>
        <strong>{formatShares(holding.shares)} 份 · {formatPoints(holding.costPoints)}</strong>
      </span>
      <span className="gh-stocks-holding-num">
        <small>市值</small>
        <strong>{formatPoints(holding.marketValue)}</strong>
      </span>
      <span className={`gh-stocks-holding-num ${trendClass(holding.profit)}`}>
        <small>浮动盈亏</small>
        <strong>{holding.profit > 0 ? '+' : ''}{formatPoints(holding.profit)}（{formatPct(holding.profitPct)}）</strong>
      </span>
    </button>
  )
}

export default function StocksPage() {
  const { balance, refresh: refreshPoints } = usePoints()
  const [market, setMarket] = useState<StockMarket | null>(null)
  const [marketError, setMarketError] = useState<string | null>(null)
  const [portfolio, setPortfolio] = useState<StockPortfolio | null>(null)
  const [loading, setLoading] = useState(true)
  const [tradeNotice, setTradeNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [amount, setAmount] = useState('500')
  const [busy, setBusy] = useState(false)
  const [dontRemind, setDontRemind] = useState(false)
  const [noticeOpen, setNoticeOpen] = useState(() => {
    try {
      return sessionStorage.getItem(NOTICE_KEY) !== '1'
    } catch {
      return true
    }
  })
  const [trend, setTrend] = useState<StockTrend | null>(null)
  const [trendCode, setTrendCode] = useState<string | null>(null)
  const [trendLoading, setTrendLoading] = useState(false)
  const [flash, setFlash] = useState<Record<string, FlashDirection>>({})
  const [sellOpen, setSellOpen] = useState(false)
  const [sellSharesInput, setSellSharesInput] = useState('')
  const [sellAll, setSellAll] = useState(false)
  const [sellError, setSellError] = useState<string | null>(null)

  const prevPricesRef = useRef<Record<string, number>>({})
  const flashTimersRef = useRef<Partial<Record<string, number>>>({})
  const marketBackoffUntilRef = useRef(0)
  const portfolioLoadedRef = useRef(false)
  const marketRequestRef = useRef(0)
  const trendRequestRef = useRef(0)

  const loadPortfolio = useCallback(async () => {
    const data = await api.get<StockPortfolio>('/stocks/portfolio')
    portfolioLoadedRef.current = true
    setPortfolio(data)
    return data
  }, [])

  /** 给价格变化的股票设置约 900ms 的闪烁方向，到期自动清除 */
  const applyFlash = useCallback((updates: Record<string, FlashDirection>) => {
    setFlash((prev) => ({ ...prev, ...updates }))
    for (const [code, direction] of Object.entries(updates)) {
      const timers = flashTimersRef.current
      const existing = timers[code]
      if (existing) window.clearTimeout(existing)
      timers[code] = window.setTimeout(() => {
        setFlash((prev) => {
          if (!(code in prev)) return prev
          const next = { ...prev }
          delete next[code]
          return next
        })
        delete flashTimersRef.current[code]
      }, FLASH_CLEAR_MS)
    }
  }, [])

  useEffect(() => () => {
    for (const timer of Object.values(flashTimersRef.current)) {
      if (timer) window.clearTimeout(timer)
    }
  }, [])

  const loadMarket = useCallback(async () => {
    const requestId = ++marketRequestRef.current
    try {
      const data = await api.get<StockMarket>('/stocks/market')
      // 已有更新的请求在途/落地，丢弃过期快照（避免旧价覆盖新价并误触发闪烁）
      if (marketRequestRef.current !== requestId) return
      marketBackoffUntilRef.current = 0
      setMarketError(null)
      setMarket(data)
      setSelectedCode((code) => code ?? data.stocks[0]?.code ?? null)
      // 记录最新价并计算闪烁方向（首次拉取只建基线，不闪烁）
      const previous = prevPricesRef.current
      const updates: Record<string, FlashDirection> = {}
      for (const stock of data.stocks) {
        const before = previous[stock.code]
        if (before !== undefined && stock.price !== before) {
          updates[stock.code] = stock.price > before ? 'up' : 'down'
        }
        previous[stock.code] = stock.price
      }
      if (Object.keys(updates).length > 0) applyFlash(updates)
      if (!portfolioLoadedRef.current) {
        loadPortfolio().catch(() => {
          // 首屏持仓补拉失败不阻塞行情轮询，下个 tick 会再次尝试
        })
      }
    } catch {
      // 过期请求的失败不置错误态/退避，交给最新一次请求决定
      if (marketRequestRef.current !== requestId) return
      // 保留旧行情数据，仅提示连接中断并进入退避
      setMarketError('行情连接中断，正在重试…')
      marketBackoffUntilRef.current = Date.now() + MARKET_BACKOFF_MS
    }
  }, [applyFlash, loadPortfolio])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      await Promise.allSettled([loadMarket(), loadPortfolio()])
      if (!cancelled) setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [loadMarket, loadPortfolio])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden) return
      if (Date.now() < marketBackoffUntilRef.current) return
      void loadMarket()
    }, MARKET_POLL_MS)
    const handleVisibility = () => {
      if (document.hidden) return
      // 恢复可见立即拉一次并重置退避
      marketBackoffUntilRef.current = 0
      void loadMarket()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [loadMarket])

  const loadTrend = useCallback(async (code: string) => {
    const requestId = ++trendRequestRef.current
    setTrendLoading(true)
    try {
      const data = await api.get<StockTrend>(`/stocks/market/trend?code=${encodeURIComponent(code)}`)
      if (trendRequestRef.current !== requestId) return
      setTrend(data)
      setTrendCode(code)
    } catch {
      if (trendRequestRef.current !== requestId) return
      setTrend(null)
      setTrendCode(code)
    } finally {
      if (trendRequestRef.current === requestId) setTrendLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedCode) return
    void loadTrend(selectedCode)
    const timer = window.setInterval(() => {
      if (document.hidden) return
      void loadTrend(selectedCode)
    }, TREND_POLL_MS)
    return () => window.clearInterval(timer)
  }, [selectedCode, loadTrend])

  const selected = market?.stocks.find((stock) => stock.code === selectedCode) ?? market?.stocks[0] ?? null
  const detailBadge = selected ? swingBadge(selected.changePct) : null
  const holding = portfolio?.holdings.find((row) => row.code === selected?.code) ?? null
  const activeTrend = selected && trendCode === selected.code ? trend : null
  /**
   * 实时点在分时轴上的位置：t = tickIndex × tickMs（当日 00:00 起的毫秒）。
   * trend 尚未跟上行情日（跨日瞬间 30s 轮询间隔内）时不拼实时点，避免分时线横跳。
   */
  const liveT = market && market.tickMs > 0 && (!activeTrend || activeTrend.dateKey === market.dateKey)
    ? market.tickIndex * market.tickMs
    : null
  const upCount = market?.stocks.filter((stock) => stock.changePct > 0).length ?? 0
  const downCount = market?.stocks.filter((stock) => stock.changePct < 0).length ?? 0

  let monthChangePct: number | null = null
  if (selected && activeTrend && activeTrend.daily.length > 0 && activeTrend.daily[0].close > 0) {
    monthChangePct = ((selected.price - activeTrend.daily[0].close) / activeTrend.daily[0].close) * 100
  }

  const rule = market?.trade
  const parsedAmount = Number.parseInt(amount, 10)
  const investAmount = Number.isFinite(parsedAmount) ? parsedAmount : 0
  const preview = useMemo(() => {
    if (!rule || !selected || investAmount <= 0) return null
    const fee = Math.max(1, Math.ceil(investAmount * rule.feeRate))
    const net = Math.max(0, investAmount - fee)
    return { fee, shares: net / selected.price }
  }, [rule, selected, investAmount])

  const flashClass = (code: string) => {
    const direction = flash[code]
    if (!direction) return ''
    return direction === 'up' ? ' gh-stocks-flash-up' : ' gh-stocks-flash-down'
  }

  const dismissNotice = () => {
    if (dontRemind) {
      try {
        sessionStorage.setItem(NOTICE_KEY, '1')
      } catch {
        // 隐私模式下忽略
      }
    }
    setNoticeOpen(false)
  }

  const buy = async () => {
    if (busy || !selected || !rule) return
    if (!Number.isInteger(investAmount) || investAmount <= 0) {
      setTradeNotice({ tone: 'danger', text: '请输入整数积分' })
      return
    }
    if (investAmount < rule.minInvest) {
      setTradeNotice({ tone: 'danger', text: `单笔最少投入 ${formatPoints(rule.minInvest)} 积分` })
      return
    }
    if (investAmount > rule.maxInvest) {
      setTradeNotice({ tone: 'danger', text: `单笔最多投入 ${formatPoints(rule.maxInvest)} 积分` })
      return
    }
    if (investAmount > balance) {
      setTradeNotice({ tone: 'danger', text: '积分不足' })
      return
    }
    setBusy(true)
    setTradeNotice(null)
    try {
      const result = await api.post<StockBuyResult>('/stocks/buy', {
        code: selected.code,
        points: investAmount,
      })
      setTradeNotice({
        tone: 'success',
        text: `买入 ${result.trade.name} ${formatShares(result.trade.shares)} 份，花费 ${formatPoints(result.trade.points)} 积分（手续费 ${result.trade.fee}）`,
      })
      await Promise.all([loadPortfolio(), refreshPoints()])
    } catch (err) {
      setTradeNotice({ tone: 'danger', text: err instanceof Error ? err.message : '买入失败' })
    } finally {
      setBusy(false)
    }
  }

  const openSellDialog = () => {
    setSellSharesInput('')
    setSellAll(false)
    setSellError(null)
    setSellOpen(true)
  }

  /** 按 25% / 50% 回填：向下取两位小数，保证不超过持有份额 */
  const fillSellShares = (ratio: number) => {
    if (!holding) return
    setSellAll(false)
    setSellSharesInput(formatSharesInput(Math.floor(holding.shares * ratio * 100) / 100))
    setSellError(null)
  }

  const fillSellAll = () => {
    if (!holding) return
    setSellAll(true)
    setSellSharesInput(formatSharesInput(holding.shares))
    setSellError(null)
  }

  const validateSellShares = (): number | null => {
    if (!holding) return null
    const value = Number(sellSharesInput)
    if (!Number.isFinite(value) || value <= 0) {
      setSellError('请输入大于 0 的卖出份额')
      return null
    }
    if (value > holding.shares + 1e-9) {
      setSellError(`卖出份额不能超过持有的 ${formatShares(holding.shares)} 份`)
      return null
    }
    return value
  }

  const confirmSell = async () => {
    if (busy || !selected || !holding) return
    const shares = sellAll ? holding.shares : validateSellShares()
    if (shares === null) return
    // 「全部」或输入恰好等于持仓时走整仓语义（不带 shares）
    const sellEntire = sellAll || shares >= holding.shares - 1e-9
    setBusy(true)
    setTradeNotice(null)
    try {
      const result = await api.post<StockSellResult>(
        '/stocks/sell',
        sellEntire ? { code: selected.code } : { code: selected.code, shares },
      )
      const profitText = result.profit >= 0 ? `盈利 ${formatPoints(result.profit)}` : `亏损 ${formatPoints(-result.profit)}`
      setTradeNotice({
        tone: result.profit >= 0 ? 'success' : 'danger',
        text: `卖出 ${result.name} ${formatShares(result.shares)} 份，到账 ${formatPoints(result.proceeds)} 积分（手续费 ${result.fee}），${profitText}${result.closed ? '，已清仓' : ''}`,
      })
      setSellOpen(false)
      // 卖出会推动价格：持仓、积分、行情与走势一起刷新
      await Promise.all([loadPortfolio(), refreshPoints(), loadMarket(), loadTrend(selected.code)])
    } catch (err) {
      setTradeNotice({ tone: 'danger', text: err instanceof Error ? err.message : '卖出失败' })
    } finally {
      setBusy(false)
    }
  }

  const fillAmount = (value: number) => {
    if (!rule) return
    const next = Math.max(0, Math.min(rule.maxInvest, Math.floor(value)))
    setAmount(String(next))
  }

  const sellPreview = useMemo(() => {
    if (!rule || !selected || !holding) return null
    const value = sellAll ? holding.shares : Number(sellSharesInput)
    if (!Number.isFinite(value) || value <= 0) return null
    const shares = Math.min(value, holding.shares)
    const gross = shares * selected.price
    const fee = Math.max(1, Math.ceil(gross * rule.feeRate))
    return { gross, fee, proceeds: Math.round(gross - fee) }
  }, [rule, selected, holding, sellSharesInput, sellAll])

  return (
    <div className="gh-page-container gh-stocks-page">
      <header className="gh-stocks-header">
        <div>
          <p className="gh-stocks-eyebrow"><Link to="/">← 返回首页</Link></p>
          <h1 className="gh-page-title">模拟股市</h1>
          <p className="gh-text-secondary">
            行情每 3 秒刷新的虚构股票（模拟数据，不可兑换真实货币）。用积分买入，玩家的交易会小幅影响价格，择机卖出结算收益。
          </p>
        </div>
        <div className="gh-stocks-header-meta">
          {market && (
            <>
              <span className={`gh-stocks-chip ${trendClass(market.marketChangePct)}`}>
                大盘 {formatPct(market.marketChangePct)}
              </span>
              <span className="gh-text-tertiary gh-stocks-date">行情日 {market.dateKey}</span>
            </>
          )}
          <Link to="/points" className="gh-header-points" title="积分中心">
            <span className="gh-header-points-icon" aria-hidden>🪙</span>
            <span className="gh-header-points-value">{formatPoints(balance)}</span>
          </Link>
          <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" onClick={() => setNoticeOpen(true)}>
            风险提示
          </button>
        </div>
      </header>

      {marketError && <div className="gh-alert gh-alert--danger" role="status">{marketError}</div>}
      {tradeNotice && (
        <div className={`gh-alert gh-alert--${tradeNotice.tone}`} role="status">{tradeNotice.text}</div>
      )}

      {loading && !market ? (
        <div className="gh-stocks-loading">
          <div className="gh-spinner" />
        </div>
      ) : market && (
        <>
          {portfolio && (
            <section className="gh-box gh-stocks-portfolio" aria-label="我的持仓">
              <div className="gh-stocks-portfolio-head">
                <div>
                  <h2>我的持仓</h2>
                  <p className="gh-text-tertiary">
                    {portfolio.summary.positions > 0
                      ? `共 ${portfolio.summary.positions} 只 · 投入 ${formatPoints(portfolio.summary.costPoints)} 积分`
                      : '还没有持仓，在下方选择股票买入'}
                  </p>
                </div>
                <div className="gh-stocks-portfolio-summary">
                  <div>
                    <span>总市值</span>
                    <strong>{formatPoints(portfolio.summary.marketValue)}</strong>
                  </div>
                  <div className={trendClass(portfolio.summary.profit)}>
                    <span>浮动盈亏</span>
                    <strong>
                      {portfolio.summary.profit > 0 ? '+' : ''}{formatPoints(portfolio.summary.profit)}
                      （{formatPct(portfolio.summary.profitPct)}）
                    </strong>
                  </div>
                </div>
              </div>
              {portfolio.holdings.length > 0 && (
                <div className="gh-stocks-holdings">
                  {portfolio.holdings.map((row) => (
                    <HoldingRow
                      key={row.code}
                      holding={row}
                      onSelect={() => setSelectedCode(row.code)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          <div className="gh-stocks-layout">
            <aside className="gh-box gh-stocks-list" aria-label="股票列表">
              <div className="gh-stocks-list-head">
                <strong>{market.stocks.length} 只股票</strong>
                <span className="gh-text-tertiary">涨 {upCount} · 跌 {downCount}</span>
              </div>
              <ul>
                {market.stocks.map((stock) => {
                  const owned = portfolio?.holdings.some((row) => row.code === stock.code) ?? false
                  const badge = swingBadge(stock.changePct)
                  return (
                    <li key={stock.code}>
                      <button
                        type="button"
                        className={`gh-stocks-row ${stock.code === selected?.code ? 'gh-stocks-row--active' : ''}`}
                        onClick={() => setSelectedCode(stock.code)}
                      >
                        <span className="gh-stocks-row-main">
                          <span className="gh-stocks-row-name">
                            <i className="gh-stocks-dot" style={{ background: stock.color }} aria-hidden />
                            {stock.name}
                            {owned && <span className="gh-badge gh-badge--success gh-stocks-owned">持仓</span>}
                            {badge && <span className={badge.className}>{badge.text}</span>}
                          </span>
                          <span className="gh-stocks-row-code">{stock.code} · {stock.sector}</span>
                        </span>
                        <span className="gh-stocks-row-quote">
                          <span key={stock.price} className={`gh-stocks-row-price${flashClass(stock.code)}`}>
                            {formatPrice(stock.price)}
                          </span>
                          <span className={`gh-stocks-row-pct ${trendClass(stock.changePct)}`}>
                            {formatPct(stock.changePct)}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </aside>

            {selected && (
              <section className="gh-box gh-stocks-detail" aria-label={`${selected.name}行情`}>
                <div className="gh-stocks-detail-head">
                  <div>
                    <h2 className="gh-stocks-detail-name">
                      <i className="gh-stocks-dot" style={{ background: selected.color }} aria-hidden />
                      {selected.name}
                      <span className="gh-stocks-detail-code">{selected.code}</span>
                      <span className="gh-badge">{selected.sector}</span>
                      {detailBadge && <span className={detailBadge.className}>{detailBadge.text}</span>}
                    </h2>
                    <p className="gh-text-tertiary gh-stocks-detail-price-line">
                      <strong
                        key={selected.price}
                        className={`gh-stocks-detail-price ${trendClass(selected.change)}${flashClass(selected.code)}`}
                      >
                        {formatPrice(selected.price)}
                      </strong>
                      <span className={trendClass(selected.change)}>
                        {formatChange(selected.change)}（{formatPct(selected.changePct)}）
                      </span>
                    </p>
                  </div>
                  <div className="gh-stocks-detail-stats">
                    <div><span>今开</span><strong>{formatPrice(selected.open)}</strong></div>
                    <div><span>最高</span><strong>{formatPrice(selected.high)}</strong></div>
                    <div><span>最低</span><strong>{formatPrice(selected.low)}</strong></div>
                    <div><span>昨收</span><strong>{formatPrice(selected.prevClose)}</strong></div>
                    <div><span>成交量</span><strong>{formatVolume(selected.volume)}</strong></div>
                    <div>
                      <span>近 30 日</span>
                      <strong className={monthChangePct === null ? undefined : trendClass(monthChangePct)}>
                        {monthChangePct === null ? '—' : formatPct(monthChangePct)}
                      </strong>
                    </div>
                  </div>
                </div>

                <PriceChart
                  stock={selected}
                  trend={activeTrend}
                  loading={trendLoading}
                  liveT={liveT}
                />

                {rule && (
                  <div className="gh-stocks-trade">
                    <div className="gh-stocks-trade-head">
                      <div>
                        <strong>积分投资</strong>
                        <p className="gh-text-tertiary">
                          单笔 {formatPoints(rule.minInvest)}–{formatPoints(rule.maxInvest)} 积分 · 买卖各收 {Math.round(rule.feeRate * 100)}% 手续费 · 行情每 3 秒刷新
                        </p>
                      </div>
                      {holding && (
                        <span className="gh-stocks-trade-position">
                          已持有 {formatShares(holding.shares)} 份 · 成本 {formatPoints(holding.costPoints)}
                        </span>
                      )}
                    </div>
                    {holding && (
                      <div className="gh-stocks-trade-holding">
                        <span>市值 <strong>{formatPoints(holding.marketValue)}</strong></span>
                        <span className={trendClass(holding.profit)}>
                          浮动盈亏 <strong>{holding.profit > 0 ? '+' : ''}{formatPoints(holding.profit)}（{formatPct(holding.profitPct)}）</strong>
                        </span>
                      </div>
                    )}
                    <div className="gh-stocks-buy-row">
                      <input
                        className="gh-input gh-stocks-amount"
                        type="number"
                        min={rule.minInvest}
                        max={rule.maxInvest}
                        step={1}
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        aria-label="投入积分"
                      />
                      <div className="gh-stocks-amount-presets">
                        {[100, 500, 1000, 2000].map((value) => (
                          <button
                            key={value}
                            type="button"
                            className="gh-btn gh-btn--ghost gh-btn--sm"
                            onClick={() => fillAmount(value)}
                          >
                            {value}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="gh-btn gh-btn--ghost gh-btn--sm"
                          onClick={() => fillAmount(Math.min(balance, rule.maxInvest))}
                        >
                          全部
                        </button>
                      </div>
                      <button
                        type="button"
                        className="gh-btn gh-btn--primary gh-btn--md"
                        disabled={busy || investAmount <= 0}
                        onClick={() => void buy()}
                      >
                        {busy ? '处理中…' : '买入'}
                      </button>
                      {holding && (
                        <button
                          type="button"
                          className="gh-btn gh-btn--secondary gh-btn--md"
                          disabled={busy}
                          onClick={openSellDialog}
                        >
                          卖出
                        </button>
                      )}
                    </div>
                    {preview && (
                      <p className="gh-text-tertiary gh-stocks-preview">
                        {formatPoints(investAmount)} 积分 → 预计买入 {formatShares(preview.shares)} 份（手续费 {preview.fee} 积分，按现价 {formatPrice(selected.price)}）
                      </p>
                    )}
                  </div>
                )}

                <footer className="gh-stocks-detail-foot">
                  <span>{market.disclaimer}</span>
                  <span className="gh-text-tertiary">计价单位：{market.currency}</span>
                </footer>
              </section>
            )}
          </div>
        </>
      )}

      {noticeOpen && (
        <div
          className="gh-dialog-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) dismissNotice()
          }}
        >
          <div className="gh-dialog gh-stocks-notice" role="dialog" aria-modal="true" aria-label="模拟股市提示">
            <h2 className="gh-dialog-title">这是模拟行情</h2>
            <p className="gh-text-secondary">
              本页面展示的股票与价格全部是虚构的模拟行情，每 3 秒跳动一次，玩家的买入卖出会小幅推动价格，与真实证券市场无关。
              页面支持用站内积分投资：买入后按实时行情计算市值，择机卖出结算盈亏（买卖各收 1% 手续费）。
              收益仅限站内积分，不能兑换成真实货币。
            </p>
            <label className="gh-stocks-notice-check">
              <input
                type="checkbox"
                checked={dontRemind}
                onChange={(event) => setDontRemind(event.target.checked)}
              />
              本次会话不再提示
            </label>
            <div className="gh-stocks-notice-actions">
              <button type="button" className="gh-btn gh-btn--primary" onClick={dismissNotice}>
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {sellOpen && selected && holding && (
        <div
          className="gh-dialog-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setSellOpen(false)
          }}
        >
          <div className="gh-dialog gh-stocks-sell-dialog" role="dialog" aria-modal="true" aria-label={`卖出 ${selected.name}`}>
            <h2 className="gh-dialog-title">卖出 {selected.name}</h2>
            <p className="gh-stocks-sell-holding-line">
              持有 {formatShares(holding.shares)} 份 · 现价 {formatPrice(selected.price)} · 市值 {formatPoints(holding.marketValue)} 积分
            </p>
            <div className="gh-stocks-sell-row">
              <label className="gh-stocks-sell-label" htmlFor="stocks-sell-shares">卖出份额</label>
              <input
                id="stocks-sell-shares"
                className="gh-input gh-stocks-sell-input"
                type="number"
                min={0}
                step={0.01}
                value={sellSharesInput}
                onChange={(event) => {
                  setSellSharesInput(event.target.value)
                  setSellAll(false)
                  setSellError(null)
                }}
                aria-label="卖出份额"
              />
              <div className="gh-stocks-sell-presets">
                <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" onClick={() => fillSellShares(0.25)}>
                  25%
                </button>
                <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" onClick={() => fillSellShares(0.5)}>
                  50%
                </button>
                <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" onClick={fillSellAll}>
                  全部
                </button>
              </div>
            </div>
            {sellError && <p className="gh-stocks-sell-error" role="alert">{sellError}</p>}
            {sellPreview && (
              <div className="gh-stocks-sell-preview">
                <div>
                  <span>毛收入</span>
                  <strong>{formatPoints(Math.round(sellPreview.gross))} 积分</strong>
                </div>
                <div>
                  <span>手续费（{Math.round((rule?.feeRate ?? 0) * 100)}%）</span>
                  <strong>{formatPoints(sellPreview.fee)} 积分</strong>
                </div>
                <div>
                  <span>预估到账</span>
                  <strong>{formatPoints(sellPreview.proceeds)} 积分</strong>
                </div>
              </div>
            )}
            <div className="gh-dialog-actions">
              <button
                type="button"
                className="gh-btn gh-btn--ghost gh-btn--md"
                disabled={busy}
                onClick={() => setSellOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="gh-btn gh-btn--primary gh-btn--md"
                disabled={busy}
                onClick={() => void confirmSell()}
              >
                {busy ? '处理中…' : '确认卖出'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
