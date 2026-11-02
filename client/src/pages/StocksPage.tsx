import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import { usePoints } from '../contexts/PointsContext'
import Icon from '../components/ui/Icon'
import SegmentedControl from '../components/ui/SegmentedControl'
import UserAvatar from '../components/UserAvatar'
import type {
  StockAlert,
  StockAlertHit,
  StockBuyResult,
  StockHolding,
  StockLeaderboard,
  StockMarket,
  StockNewsItem,
  StockPortfolio,
  StockQuote,
  StockSellResult,
  StockTrade,
  StockTradeList,
  StockTrend,
} from '../types/stock'

/** 只在本次浏览器会话内记住「不再提示」，刷新页面仍会再次提示 */
const NOTICE_KEY = 'lineweb_stocks_notice_ack'
/** 自选股（本机）：字符串数组的股票代码 */
const WATCHLIST_KEY = 'lineweb_stock_watchlist_v1'
/** 价格提醒（本机）：{ id, code, target, direction }[] */
const ALERTS_KEY = 'lineweb_stock_alerts_v1'
/** 已触发的提醒记录（本机）：命中后从待触发列表移除，但留一条历史可回看 */
const ALERT_LOG_KEY = 'lineweb_stock_alert_log_v1'

/** 行情轮询间隔（与服务端 3 秒 tick 对齐） */
const MARKET_POLL_MS = 3_000
/** 行情请求失败后的退避时长，退避期内跳过轮询 */
const MARKET_BACKOFF_MS = 10_000
/** 个股走势（分时 + 日线）轮询间隔 */
const TREND_POLL_MS = 30_000
/** 页面内轻提示（价格提醒命中）的停留时长 */
const TOAST_MS = 6_000
/** 一天的毫秒数（分时图 x 轴：t = 当日 00:00 起的毫秒） */
const DAY_MS = 86_400_000
/** trend.tickMs 异常时的兜底 tick 间隔 */
const FALLBACK_TICK_MS = 3_000

const MOOD_TEXT: Record<string, string> = { bull: '牛市', flat: '震荡', bear: '熊市' }

/** 稳定的空数组：避免 PriceChart 的 useMemo 因每次渲染新建 [] 而重复计算 */
const EMPTY_NEWS: StockNewsItem[] = []

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

/** 事件冲击小数 → 带符号百分比（0.032 → +3.20%） */
function formatImpact(value: number): string {
  return `${value > 0 ? '+' : ''}${(value * 100).toFixed(2)}%`
}

/**
 * 按半衰期估算「强度衰减到 5%（视为基本结束）」还需要多久。
 * ratio = 当前强度 / 初始强度 = 2^(-elapsed/halfLife)，因此剩余时间可由两边反推：
 * remaining = halfLife × log2(ratio / 0.05)。前端不做本地时钟推算，直接用服务端下发的
 * impact / halfLifeMs / currentImpact，避免玩家改系统时间作弊或与服务端 tick 不同步。
 */
function formatNewsCountdown(ratio: number, halfLifeMs: number): string {
  if (!(ratio > 0.05)) return '强度已基本衰减'
  const minutes = (halfLifeMs / 60_000) * Math.log2(ratio / 0.05)
  if (minutes < 60) return `约 ${Math.max(1, Math.round(minutes))} 分钟后衰减到 5%`
  const hours = minutes / 60
  return `约 ${hours >= 10 ? Math.round(hours) : hours.toFixed(1)} 小时后衰减到 5%`
}

/** 统一按 Asia/Shanghai 显示时间：分时图横轴与快讯触发时刻同为上海日界，避免跨时区错位 */
function formatShanghaiTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--:--'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date)
  } catch {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
}

/** 成交记录时间：MM-DD HH:mm（Asia/Shanghai） */
function formatTradeTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date)
  } catch {
    return date.toISOString().slice(5, 16).replace('T', ' ')
  }
}

function readWatchlist(): string[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string').slice(0, 50)
  } catch {
    return []
  }
}

function readAlerts(): StockAlert[] {
  try {
    const raw = localStorage.getItem(ALERTS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const alerts: StockAlert[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      const code = typeof record.code === 'string' ? record.code : ''
      const target = typeof record.target === 'number' ? record.target : Number.NaN
      const direction = record.direction === 'above' || record.direction === 'below' ? record.direction : null
      const id = typeof record.id === 'string' ? record.id : ''
      if (!code || !direction || !Number.isFinite(target) || target <= 0 || !id) continue
      alerts.push({ id, code, target: Math.round(target * 100) / 100, direction })
    }
    return alerts.slice(0, 50)
  } catch {
    return []
  }
}

/** 本地数据落盘：隐私模式 / 配额满时静默失败，不阻塞行情与交易 */
function persistLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 忽略：本地记忆丢失不影响账户数据（后端为准）
  }
}

function readAlertLog(): StockAlertHit[] {
  try {
    const raw = localStorage.getItem(ALERT_LOG_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const hits: StockAlertHit[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      const code = typeof record.code === 'string' ? record.code : ''
      const target = typeof record.target === 'number' ? record.target : Number.NaN
      const price = typeof record.price === 'number' ? record.price : Number.NaN
      const at = typeof record.at === 'number' ? record.at : Number.NaN
      const direction = record.direction === 'above' || record.direction === 'below' ? record.direction : null
      const id = typeof record.id === 'string' ? record.id : ''
      if (!code || !direction || !id || !Number.isFinite(target) || !Number.isFinite(price) || !Number.isFinite(at)) continue
      hits.push({ id, code, target, direction, price, at })
    }
    return hits.slice(0, 30)
  } catch {
    return []
  }
}

type ChartMode = 'intraday' | 'daily'
type LowerTab = 'holdings' | 'trades' | 'rank'
type ToastTone = 'info' | 'success' | 'danger'

interface ToastItem {
  id: number
  tone: ToastTone
  text: string
}

const CHART_WIDTH = 720
const CHART_HEIGHT = 260
const CHART_PAD_X = 18
const CHART_PAD_Y = 22

interface IntradayMarker {
  id: string
  x: number
  y: number | null
  active: boolean
  sentiment: 'good' | 'bad'
  title: string
  currentImpact: number
  time: string
}

function PriceChart({
  stock,
  trend,
  loading,
  liveT,
  news,
  tickMs,
}: {
  stock: StockQuote
  trend: StockTrend | null
  loading: boolean
  liveT: number | null
  news: StockNewsItem[]
  tickMs: number
}) {
  const [mode, setMode] = useState<ChartMode>('intraday')

  // 分时序列 = 后端采样点 + 实时价末端点；采样最后一点与实时点同 tick 时用实时点覆盖
  const intradayPoints = useMemo(() => {
    const points = (trend?.intraday ?? []).map((point) => ({ t: point.t, price: point.price }))
    if (liveT === null) return points
    const stepMs = trend && trend.tickMs > 0 ? trend.tickMs : FALLBACK_TICK_MS
    const livePoint = { t: liveT, price: stock.price }
    const last = points[points.length - 1]
    if (last && Math.floor(last.t / stepMs) === Math.floor(liveT / stepMs)) {
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
    // 新闻事件标记：横坐标由 startTick × tickMs 定位，已触发的事件在曲线上打点
    const markers: IntradayMarker[] = news.map((item) => {
      const eventT = item.startTick * (tickMs > 0 ? tickMs : FALLBACK_TICK_MS)
      let nearest = intradayPoints[0]
      for (const point of intradayPoints) {
        if (Math.abs(point.t - eventT) < Math.abs(nearest.t - eventT)) nearest = point
      }
      return {
        id: item.id,
        x: Math.min(CHART_WIDTH - CHART_PAD_X, Math.max(CHART_PAD_X, x(eventT))),
        y: item.active ? y(nearest.price) : null,
        active: item.active,
        sentiment: item.sentiment ?? 'good',
        title: item.title,
        currentImpact: item.currentImpact,
        time: formatShanghaiTime(item.startAt),
      }
    })
    return { min, max, x, y, line, area, lastPoint, markers }
  }, [intradayPoints, stock.prevClose, news, tickMs])

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

  const renderMarkers = (markers: IntradayMarker[]) =>
    markers.map((marker) => {
      const color = marker.sentiment === 'good' ? 'var(--gh-danger)' : 'var(--gh-success)'
      return (
        <g key={marker.id}>
          <line
            x1={marker.x}
            x2={marker.x}
            y1={CHART_PAD_Y - 4}
            y2={CHART_HEIGHT - CHART_PAD_Y}
            stroke={marker.active ? color : 'var(--gh-text-tertiary)'}
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity={marker.active ? 0.55 : 0.3}
          />
          {marker.y !== null && <circle cx={marker.x} cy={marker.y} r="3" fill={color} />}
          <text x={marker.x} y={CHART_PAD_Y - 8} fontSize="9" textAnchor="middle" fill="var(--gh-text-tertiary)">
            {marker.time}
          </text>
          <title>
            {marker.active
              ? `${marker.title}（${marker.sentiment === 'good' ? '利好' : '利空'} ${formatImpact(marker.currentImpact)}）`
              : `${marker.time} 有重要公告待公布`}
          </title>
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
          {renderMarkers(intraday.markers)}
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
        {showIntraday && news.length > 0 && (
          <span className="gh-stocks-chart-legend">
            <i className="gh-stocks-chart-legend-line" aria-hidden />
            新闻事件标记
          </span>
        )}
      </div>
      {body}
    </div>
  )
}

function HoldingRow({ holding, onSelect }: { holding: StockHolding; onSelect: () => void }) {
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

/** 快讯卡片：未触发只显示「有时间、有公告」；已触发才展示标题 / 摘要 / 幅度 / 剩余强度 */
function NewsCard({
  item,
  stock,
  onSelect,
}: {
  item: StockNewsItem
  stock: StockQuote
  onSelect: () => void
}) {
  const good = item.sentiment === 'good'
  const sentimentClass = item.active && item.sentiment ? (good ? 'good' : 'bad') : 'pending'
  const remaining = item.impact !== 0 ? Math.min(1, Math.max(0, item.currentImpact / item.impact)) : 0
  return (
    <button
      type="button"
      className={`gh-stocks-news-card gh-stocks-news-card--${sentimentClass}${item.active ? '' : ' gh-stocks-news-card--pending'}`}
      onClick={onSelect}
      aria-label={`${stock.name}快讯`}
    >
      <span className="gh-stocks-news-head">
        <i className="gh-stocks-dot" style={{ background: stock.color }} aria-hidden />
        <strong>{stock.name}</strong>
        <span className="gh-stocks-news-time">{formatShanghaiTime(item.startAt)}</span>
        {item.active ? (
          <span className="gh-stocks-news-state">{good ? '利好' : '利空'}</span>
        ) : (
          <span className="gh-stocks-news-state gh-stocks-news-state--pending">待公布</span>
        )}
        <span className="gh-stocks-news-source" title={item.source === 'template' ? 'AI 不可用时的模板兜底' : '大模型生成'}>
          {item.source === 'template' ? '模板' : 'AI'}
        </span>
      </span>
      {item.active ? (
        <>
          <span className="gh-stocks-news-title">{item.title}</span>
          <span className="gh-stocks-news-summary">{item.summary}</span>
          <span className="gh-stocks-news-foot">
            <span className={`gh-stocks-news-impact ${good ? 'gh-stock-up' : 'gh-stock-down'}`}>
              {formatImpact(item.currentImpact)}
            </span>
            <span className="gh-stocks-news-bar" aria-hidden>
              <i style={{ width: `${Math.round(remaining * 100)}%` }} />
            </span>
            <span className="gh-text-tertiary" title="按半衰期估算，强度衰减到 5% 视为基本结束">
              强度 {Math.round(remaining * 100)}% · {formatNewsCountdown(remaining, item.halfLifeMs)}
            </span>
          </span>
        </>
      ) : (
        <span className="gh-stocks-news-title gh-stocks-news-title--pending">
          {formatShanghaiTime(item.startAt)} 有重要公告待公布
        </span>
      )}
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
  const [sellOpen, setSellOpen] = useState(false)
  const [sellSharesInput, setSellSharesInput] = useState('')
  const [sellAll, setSellAll] = useState(false)
  const [sellError, setSellError] = useState<string | null>(null)

  // 账户 / 交易记录 / 排行榜
  const [tab, setTab] = useState<LowerTab>('holdings')
  const [showAllNews, setShowAllNews] = useState(false)
  const [trades, setTrades] = useState<StockTrade[] | null>(null)
  const [tradesLoading, setTradesLoading] = useState(false)
  const [tradesError, setTradesError] = useState<string | null>(null)
  const [leaderboard, setLeaderboard] = useState<StockLeaderboard | null>(null)
  const [leaderboardLoading, setLeaderboardLoading] = useState(false)
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null)

  // 自选股 / 价格提醒 / 页面内轻提示（本地记忆，刷新不丢）
  const [watchlist, setWatchlist] = useState<string[]>(() => readWatchlist())
  const [onlyWatch, setOnlyWatch] = useState(false)
  const [alerts, setAlerts] = useState<StockAlert[]>(() => readAlerts())
  const [alertLog, setAlertLog] = useState<StockAlertHit[]>(() => readAlertLog())
  const [alertTarget, setAlertTarget] = useState('')
  const [alertDirection, setAlertDirection] = useState<'above' | 'below'>('above')
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const toastTimersRef = useRef<number[]>([])
  const toastSeqRef = useRef(0)
  const marketBackoffUntilRef = useRef(0)
  const portfolioLoadedRef = useRef(false)
  const marketRequestRef = useRef(0)
  const trendRequestRef = useRef(0)

  const pushToast = useCallback((tone: ToastTone, text: string) => {
    toastSeqRef.current += 1
    const id = toastSeqRef.current
    setToasts((prev) => [...prev.slice(-2), { id, tone, text }])
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id))
      toastTimersRef.current = toastTimersRef.current.filter((value) => value !== timer)
    }, TOAST_MS)
    toastTimersRef.current.push(timer)
  }, [])

  useEffect(() => () => {
    for (const timer of toastTimersRef.current) window.clearTimeout(timer)
  }, [])

  const loadPortfolio = useCallback(async () => {
    const data = await api.get<StockPortfolio>('/stocks/portfolio')
    portfolioLoadedRef.current = true
    setPortfolio(data)
    return data
  }, [])

  const loadTrades = useCallback(async () => {
    setTradesLoading(true)
    try {
      const data = await api.get<StockTradeList>('/stocks/trades?limit=50')
      setTrades(data.trades)
      setTradesError(null)
    } catch (err) {
      setTradesError(err instanceof Error ? err.message : '成交记录加载失败')
    } finally {
      setTradesLoading(false)
    }
  }, [])

  const loadLeaderboard = useCallback(async () => {
    setLeaderboardLoading(true)
    try {
      const data = await api.get<StockLeaderboard>('/stocks/leaderboard?limit=20')
      setLeaderboard(data)
      setLeaderboardError(null)
    } catch (err) {
      setLeaderboardError(err instanceof Error ? err.message : '排行榜加载失败')
    } finally {
      setLeaderboardLoading(false)
    }
  }, [])

  const loadMarket = useCallback(async () => {
    const requestId = ++marketRequestRef.current
    try {
      const data = await api.get<StockMarket>('/stocks/market')
      // 已有更新的请求在途/落地，丢弃过期快照
      if (marketRequestRef.current !== requestId) return
      marketBackoffUntilRef.current = 0
      setMarketError(null)
      setMarket(data)
      setSelectedCode((code) => code ?? data.stocks[0]?.code ?? null)
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
  }, [loadPortfolio])

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

  // 切到「成交记录 / 排行榜」时才拉数据（每次进入都刷新，数据量小且有限流兜底）
  useEffect(() => {
    if (tab === 'trades') void loadTrades()
    if (tab === 'rank') void loadLeaderboard()
  }, [tab, loadTrades, loadLeaderboard])

  const selected = market?.stocks.find((stock) => stock.code === selectedCode) ?? market?.stocks[0] ?? null
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

  const account = portfolio?.account
  const totalAssets = account?.totalAssets ?? (portfolio?.summary.marketValue ?? 0) + balance
  const realizedProfit = account?.realizedPoints ?? portfolio?.summary.realizedProfit ?? 0

  // 全市场快讯（按触发时间排序）：列表展示所有股票的事件，点击跳到对应股票
  const newsFeed = useMemo(() => {
    if (!market) return [] as Array<{ item: StockNewsItem; stock: StockQuote }>
    return market.stocks
      .flatMap((stock) => (stock.news ?? []).map((item) => ({ item, stock })))
      .sort((a, b) => a.item.startTick - b.item.startTick)
  }, [market])
  const pendingNews = newsFeed.filter((entry) => !entry.item.active).length
  const goodNews = newsFeed.filter((entry) => entry.item.active && entry.item.sentiment === 'good').length
  const badNews = newsFeed.filter((entry) => entry.item.active && entry.item.sentiment === 'bad').length
  const displayNews = useMemo(() => {
    const recent = [...newsFeed].reverse()
    return showAllNews ? recent : recent.slice(0, 12)
  }, [newsFeed, showAllNews])

  const visibleStocks = useMemo(() => {
    if (!market) return [] as StockQuote[]
    if (!onlyWatch) return market.stocks
    return market.stocks.filter((stock) => watchlist.includes(stock.code))
  }, [market, onlyWatch, watchlist])

  const alertsForSelected = selected ? alerts.filter((alert) => alert.code === selected.code) : []
  const recentAlertHits = selected ? alertLog.filter((hit) => hit.code === selected.code).slice(0, 3) : []

  // 价格提醒命中：行情轮询每次刷新都检查，命中即弹页面内提示并自动移除（避免重复骚扰）
  useEffect(() => {
    if (!market || alerts.length === 0) return
    const hits = alerts.filter((alert) => {
      const stock = market.stocks.find((item) => item.code === alert.code)
      if (!stock) return false
      return alert.direction === 'above' ? stock.price >= alert.target : stock.price <= alert.target
    })
    if (hits.length === 0) return
    const remaining = alerts.filter((alert) => !hits.includes(alert))
    setAlerts(remaining)
    persistLocal(ALERTS_KEY, remaining)
    const triggered: StockAlertHit[] = []
    for (const hit of hits) {
      const stock = market.stocks.find((item) => item.code === hit.code)
      const price = stock ? stock.price : hit.target
      triggered.push({ ...hit, price, at: Date.now() })
      pushToast(
        'info',
        `${stock?.name ?? hit.code} ${hit.direction === 'above' ? '涨到' : '跌到'} ${formatPrice(hit.target)}（现价 ${formatPrice(price)}）`,
      )
    }
    // 已在待触发列表移除，但保留一条本地历史（刷新后仍能看到最近触发过什么）
    const nextLog = [...triggered, ...alertLog].slice(0, 30)
    setAlertLog(nextLog)
    persistLocal(ALERT_LOG_KEY, nextLog)
  }, [market, alerts, alertLog, pushToast])

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

  const toggleWatch = (code: string) => {
    setWatchlist((prev) => {
      const next = prev.includes(code) ? prev.filter((item) => item !== code) : [...prev, code]
      persistLocal(WATCHLIST_KEY, next)
      return next
    })
  }

  const addAlert = () => {
    if (!selected) return
    const target = Number(alertTarget)
    if (!Number.isFinite(target) || target <= 0) {
      setTradeNotice({ tone: 'danger', text: '请输入大于 0 的目标价' })
      return
    }
    const rounded = Math.round(target * 100) / 100
    if (alerts.some((alert) => alert.code === selected.code && alert.direction === alertDirection && alert.target === rounded)) {
      setTradeNotice({ tone: 'danger', text: '同样的提醒已存在' })
      return
    }
    const next: StockAlert[] = [
      ...alerts,
      { id: `${selected.code}-${alertDirection}-${rounded}-${Date.now()}`, code: selected.code, target: rounded, direction: alertDirection },
    ]
    setAlerts(next)
    persistLocal(ALERTS_KEY, next)
    setAlertTarget('')
    setTradeNotice({ tone: 'success', text: `已设置提醒：${selected.name} ${alertDirection === 'above' ? '高于' : '低于'} ${formatPrice(rounded)}` })
  }

  const removeAlert = (id: string) => {
    const next = alerts.filter((alert) => alert.id !== id)
    setAlerts(next)
    persistLocal(ALERTS_KEY, next)
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
        text: `买入 ${result.trade.name} ${formatShares(result.trade.shares)} 份，成交价 ${formatPrice(result.trade.price)}（冲击 ${result.trade.impactPct > 0 ? '+' : ''}${result.trade.impactPct.toFixed(2)}%），花费 ${formatPoints(result.trade.points)} 积分（手续费 ${result.trade.fee}）`,
      })
      await Promise.all([loadPortfolio(), refreshPoints()])
      if (tab === 'trades') void loadTrades()
      if (tab === 'rank') void loadLeaderboard()
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
      // 卖出会推动价格：持仓、积分、行情、走势与榜单一起刷新
      await Promise.all([loadPortfolio(), refreshPoints(), loadMarket(), loadTrend(selected.code)])
      if (tab === 'trades') void loadTrades()
      if (tab === 'rank') void loadLeaderboard()
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

  const marketIndex = market?.index ?? null
  const marketMood = market?.marketMood ?? null

  return (
    <div className="gh-page-container gh-stocks-page">
      <header className="gh-stocks-header">
        <div>
          <p className="gh-stocks-eyebrow"><Link to="/">← 返回首页</Link></p>
          <h1 className="gh-page-title">模拟股市</h1>
          <p className="gh-text-secondary">
            行情每 3 秒刷新的虚构股票（模拟数据，不可兑换真实货币）。AI 每 40 分钟生成一批快讯，玩家大额交易会明显推动价格；
            用积分买入、择机卖出结算收益；没有分红，涨跌完全由随机波动与 AI 事件驱动。
          </p>
        </div>
        <div className="gh-stocks-header-meta">
          {market && (
            <>
              <span className={`gh-stocks-chip ${trendClass(market.marketChangePct)}`}>
                大盘 {marketIndex === null ? '—' : marketIndex.toFixed(2)} {formatPct(market.marketChangePct)}
              </span>
              {marketMood && (
                <span className={`gh-stocks-mood gh-stocks-mood--${marketMood}`}>
                  {MOOD_TEXT[marketMood] ?? '震荡'}
                </span>
              )}
              <span className="gh-text-tertiary gh-stocks-date">行情日 {market.dateKey}</span>
            </>
          )}
          <Link to="/points" className="gh-header-points" title="积分中心">
            <span className="gh-header-points-icon" aria-hidden><Icon name="coin" size={15} /></span>
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
      {toasts.length > 0 && (
        <div className="gh-stocks-toasts" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`gh-stocks-toast gh-stocks-toast--${toast.tone}`}>
              <Icon name="bell" size={14} />
              <span>{toast.text}</span>
            </div>
          ))}
        </div>
      )}

      {loading && !market ? (
        <div className="gh-stocks-loading">
          <div className="gh-spinner" />
        </div>
      ) : market && (
        <>
          <section className="gh-stocks-account" aria-label="账户概览">
            <div className="gh-stocks-account-item">
              <span>总资产</span>
              <strong>{formatPoints(totalAssets)}</strong>
              <small>积分 + 持仓市值</small>
            </div>
            <div className="gh-stocks-account-item">
              <span>积分余额</span>
              <strong>{formatPoints(balance)}</strong>
              <small>可用于买入</small>
            </div>
            <div className={`gh-stocks-account-item ${trendClass(portfolio?.summary.profit ?? 0)}`}>
              <span>浮动盈亏</span>
              <strong>
                {(portfolio?.summary.profit ?? 0) > 0 ? '+' : ''}{formatPoints(portfolio?.summary.profit ?? 0)}
                （{formatPct(portfolio?.summary.profitPct ?? 0)}）
              </strong>
              <small>{portfolio ? `${portfolio.summary.positions} 只持仓` : '暂无持仓'}</small>
            </div>
            <div className={`gh-stocks-account-item ${trendClass(realizedProfit)}`}>
              <span>已实现盈亏</span>
              <strong>{realizedProfit > 0 ? '+' : ''}{formatPoints(realizedProfit)}</strong>
              <small>卖出结算累计</small>
            </div>
          </section>

          <section className="gh-box gh-stocks-news" aria-label="AI 快讯">
            <div className="gh-stocks-news-head-row">
              <div>
                <h2>AI 快讯</h2>
                <p className="gh-text-tertiary">
                  {newsFeed.length === 0
                    ? '本时段暂无快讯，等待下一批 AI 事件'
                    : `已公布 利好 ${goodNews} · 利空 ${badNews} · 待公布 ${pendingNews}`}
                </p>
              </div>
              <span className="gh-text-tertiary gh-stocks-news-hint">每 40 分钟一批 · 事件按半衰期衰减</span>
            </div>
            {newsFeed.length > 0 ? (
              <>
                <div className="gh-stocks-news-list">
                  {displayNews.map(({ item, stock }) => (
                    <NewsCard
                      key={item.id}
                      item={item}
                      stock={stock}
                      onSelect={() => setSelectedCode(stock.code)}
                    />
                  ))}
                </div>
                {newsFeed.length > 12 && (
                  <button
                    type="button"
                    className="gh-btn gh-btn--ghost gh-btn--sm gh-stocks-news-more"
                    onClick={() => setShowAllNews((value) => !value)}
                  >
                    {showAllNews ? '只看最近 12 条' : `查看全部 ${newsFeed.length} 条`}
                  </button>
                )}
              </>
            ) : (
              <p className="gh-stocks-empty">今日暂无快讯</p>
            )}
          </section>

          <div className="gh-stocks-layout">
            <aside className="gh-box gh-stocks-list" aria-label="股票列表">
              <div className="gh-stocks-list-head">
                <strong>{visibleStocks.length} 只股票</strong>
                <span className="gh-text-tertiary">涨 {upCount} · 跌 {downCount}</span>
              </div>
              <div className="gh-stocks-list-tools">
                <button
                  type="button"
                  className={`gh-stocks-watch-toggle ${onlyWatch ? 'gh-stocks-watch-toggle--active' : ''}`}
                  aria-pressed={onlyWatch}
                  onClick={() => setOnlyWatch((prev) => !prev)}
                >
                  <Icon name="star" size={13} filled={onlyWatch} />
                  只看自选（{watchlist.length}）
                </button>
              </div>
              {visibleStocks.length === 0 ? (
                <p className="gh-stocks-empty">
                  {onlyWatch ? '还没有自选股，点击列表左侧星标添加' : '暂无股票'}
                </p>
              ) : (
                <ul>
                  {visibleStocks.map((stock) => {
                    const owned = portfolio?.holdings.some((row) => row.code === stock.code) ?? false
                    const watched = watchlist.includes(stock.code)
                    return (
                      <li key={stock.code} className="gh-stocks-row-item">
                        <button
                          type="button"
                          className={`gh-stocks-star ${watched ? 'gh-stocks-star--active' : ''}`}
                          aria-pressed={watched}
                          aria-label={watched ? `取消自选 ${stock.name}` : `加入自选 ${stock.name}`}
                          title={watched ? '取消自选' : '加入自选'}
                          onClick={() => toggleWatch(stock.code)}
                        >
                          <Icon name="star" size={14} filled={watched} />
                        </button>
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
                            </span>
                            <span className="gh-stocks-row-code">
                              {stock.code} · {stock.sector}
                            </span>
                          </span>
                          <span className="gh-stocks-row-quote">
                            <span className="gh-stocks-row-price">
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
              )}
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
                      <button
                        type="button"
                        className={`gh-stocks-star gh-stocks-star--inline ${watchlist.includes(selected.code) ? 'gh-stocks-star--active' : ''}`}
                        aria-pressed={watchlist.includes(selected.code)}
                        aria-label={watchlist.includes(selected.code) ? '取消自选' : '加入自选'}
                        title={watchlist.includes(selected.code) ? '取消自选' : '加入自选'}
                        onClick={() => toggleWatch(selected.code)}
                      >
                        <Icon name="star" size={15} filled={watchlist.includes(selected.code)} />
                      </button>
                    </h2>
                    <p className="gh-text-tertiary gh-stocks-detail-price-line">
                      <strong
                        className={`gh-stocks-detail-price ${trendClass(selected.change)}`}
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
                  news={activeTrend?.news ?? selected.news ?? EMPTY_NEWS}
                  tickMs={market.tickMs}
                />

                {rule && (
                  <div className="gh-stocks-trade">
                    <div className="gh-stocks-trade-head">
                      <div>
                        <strong>积分投资</strong>
                        <p className="gh-text-tertiary">
                          单笔 {formatPoints(rule.minInvest)}–{formatPoints(rule.maxInvest)} 积分 · 买卖各收 {Math.round(rule.feeRate * 1000) / 10}% 手续费 · 行情每 3 秒刷新 · 大额交易有冲击滑点
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
                        {formatPoints(investAmount)} 积分 → 预计买入 {formatShares(preview.shares)} 份（手续费 {preview.fee} 积分，按现价 {formatPrice(selected.price)}；大额交易成交价会因冲击上浮）
                      </p>
                    )}

                    <div className="gh-stocks-alert">
                      <div className="gh-stocks-alert-head">
                        <strong>价格提醒</strong>
                        <span className="gh-text-tertiary">只保存在本机，命中后自动移除</span>
                      </div>
                      <div className="gh-stocks-alert-form">
                        <select
                          className="gh-input gh-stocks-alert-select"
                          value={alertDirection}
                          onChange={(event) => setAlertDirection(event.target.value === 'below' ? 'below' : 'above')}
                          aria-label="提醒方向"
                        >
                          <option value="above">价格高于</option>
                          <option value="below">价格低于</option>
                        </select>
                        <input
                          className="gh-input gh-stocks-alert-input"
                          type="number"
                          min={0}
                          step={0.01}
                          value={alertTarget}
                          placeholder={`目标价（现价 ${formatPrice(selected.price)}）`}
                          onChange={(event) => setAlertTarget(event.target.value)}
                          aria-label="目标价"
                        />
                        <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" onClick={addAlert}>
                          添加提醒
                        </button>
                      </div>
                      {alertsForSelected.length > 0 && (
                        <ul className="gh-stocks-alert-list">
                          {alertsForSelected.map((alert) => (
                            <li key={alert.id}>
                              <span>
                                {alert.direction === 'above' ? '高于' : '低于'} <strong>{formatPrice(alert.target)}</strong>
                              </span>
                              <button
                                type="button"
                                className="gh-stocks-alert-remove"
                                aria-label="删除提醒"
                                onClick={() => removeAlert(alert.id)}
                              >
                                <Icon name="close" size={13} />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {recentAlertHits.length > 0 && (
                        <ul className="gh-stocks-alert-log">
                          {recentAlertHits.map((hit) => (
                            <li key={hit.id}>
                              已提醒 · {hit.direction === 'above' ? '高于' : '低于'} {formatPrice(hit.target)} ·{' '}
                              {formatTradeTime(new Date(hit.at).toISOString())}（触发价 {formatPrice(hit.price)}）
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}

                <footer className="gh-stocks-detail-foot">
                  <span>{market.disclaimer}</span>
                  <span className="gh-text-tertiary">计价单位：{market.currency}</span>
                </footer>
              </section>
            )}
          </div>

          <section className="gh-box gh-stocks-lower" aria-label="持仓与记录">
            <div className="gh-stocks-tabs">
              <SegmentedControl
                tabs={[
                  { value: 'holdings', label: '持仓', count: portfolio?.holdings.length ?? 0 },
                  { value: 'trades', label: '成交记录' },
                  { value: 'rank', label: '排行榜' },
                ]}
                active={tab}
                onChange={(value) => setTab(value === 'trades' ? 'trades' : value === 'rank' ? 'rank' : 'holdings')}
              />
              <span className="gh-text-tertiary gh-stocks-lower-hint">
                {tab === 'holdings' && '大额买卖会推动价格，成交价含冲击滑点'}
                {tab === 'trades' && '最近 50 笔买卖（含手续费与已实现盈亏）'}
                {tab === 'rank' && '总资产 = 积分余额 + 持仓实时市值'}
              </span>
            </div>

            {tab === 'holdings' && (
              !portfolio ? (
                <p className="gh-stocks-empty">持仓加载中…</p>
              ) : portfolio.holdings.length > 0 ? (
                <div className="gh-stocks-holdings">
                  {portfolio.holdings.map((row) => (
                    <HoldingRow
                      key={row.code}
                      holding={row}
                      onSelect={() => setSelectedCode(row.code)}
                    />
                  ))}
                </div>
              ) : (
                <p className="gh-stocks-empty">还没有持仓，在上方选择股票买入</p>
              )
            )}

            {tab === 'trades' && (
              <>
                {tradesLoading && !trades && <div className="gh-stocks-inline-loading"><div className="gh-spinner" /></div>}
                {tradesError && (
                  <div className="gh-alert gh-alert--danger" role="status">
                    {tradesError}
                    <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" onClick={() => void loadTrades()}>
                      重试
                    </button>
                  </div>
                )}
                {trades && trades.length === 0 && <p className="gh-stocks-empty">还没有成交记录，买入或卖出后会出现在这里</p>}
                {trades && trades.length > 0 && (
                  <ul className="gh-stocks-trades">
                    {trades.map((trade) => (
                      <li key={trade.id} className="gh-stocks-trade-row">
                        <span className={`gh-stocks-side gh-stocks-side--${trade.side}`}>
                          {trade.side === 'buy' ? '买入' : '卖出'}
                        </span>
                        <span className="gh-stocks-trade-name">
                          <i className="gh-stocks-dot" style={{ background: trade.color }} aria-hidden />
                          <span>
                            <strong>{trade.name}</strong>
                            <small>{trade.code} · {formatTradeTime(trade.createdAt)}</small>
                          </span>
                        </span>
                        <span className="gh-stocks-trade-cell">
                          <small>数量 / 价格</small>
                          <strong>{formatShares(trade.shares)} 份 @ {formatPrice(trade.price)}</strong>
                        </span>
                        <span
                          className="gh-stocks-trade-cell"
                          title={`手续费 ${formatPoints(trade.fee)} 积分`}
                        >
                          <small>{trade.side === 'buy' ? '投入（含费）' : '到账'}</small>
                          <strong>{trade.side === 'buy' ? '-' : '+'}{formatPoints(trade.points)}</strong>
                        </span>
                        <span className={`gh-stocks-trade-cell ${trade.profit === null ? '' : trendClass(trade.profit)}`}>
                          <small>已实现盈亏</small>
                          <strong>
                            {trade.profit === null
                              ? '—'
                              : `${trade.profit > 0 ? '+' : ''}${formatPoints(trade.profit)}`}
                          </strong>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {tab === 'rank' && (
              <>
                {leaderboardLoading && !leaderboard && <div className="gh-stocks-inline-loading"><div className="gh-spinner" /></div>}
                {leaderboardError && (
                  <div className="gh-alert gh-alert--danger" role="status">
                    {leaderboardError}
                    <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" onClick={() => void loadLeaderboard()}>
                      重试
                    </button>
                  </div>
                )}
                {leaderboard && leaderboard.entries.length === 0 && (
                  <p className="gh-stocks-empty">还没有人持有资产，成为第一个上榜的人吧</p>
                )}
                {leaderboard && leaderboard.entries.length > 0 && (
                  <ol className="gh-stocks-rank">
                    {leaderboard.entries.map((entry) => (
                      <li key={entry.userId} className={`gh-stocks-rank-row ${entry.isMe ? 'gh-stocks-rank-row--me' : ''}`}>
                        <span className={`gh-stocks-rank-no gh-stocks-rank-no--${entry.rank <= 3 ? entry.rank : 'plain'}`}>
                          {entry.rank}
                        </span>
                        <UserAvatar userId={entry.userId} username={entry.username} size="sm" />
                        <span className="gh-stocks-rank-name">
                          {entry.username}
                          {entry.isMe && <span className="gh-badge gh-badge--success">我</span>}
                        </span>
                        <span className="gh-stocks-rank-cell">
                          <small>总资产</small>
                          <strong>{formatPoints(entry.totalAssets)}</strong>
                        </span>
                        <span className="gh-stocks-rank-cell">
                          <small>持仓市值</small>
                          <strong>{formatPoints(entry.marketValue)}</strong>
                        </span>
                        <span className={`gh-stocks-rank-cell ${trendClass(entry.profit)}`}>
                          <small>浮动盈亏</small>
                          <strong>{entry.profit > 0 ? '+' : ''}{formatPoints(entry.profit)}</strong>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                {leaderboard?.me && !leaderboard.entries.some((entry) => entry.isMe) && (
                  <div className="gh-stocks-rank-me">
                    <span className="gh-text-tertiary">我的排名</span>
                    <span className="gh-stocks-rank-no gh-stocks-rank-no--plain">{leaderboard.me.rank}</span>
                    <span className="gh-stocks-rank-name">{leaderboard.me.username}</span>
                    <span className="gh-stocks-rank-cell">
                      <small>总资产</small>
                      <strong>{formatPoints(leaderboard.me.totalAssets)}</strong>
                    </span>
                    <span className="gh-stocks-rank-cell">
                      <small>持仓市值</small>
                      <strong>{formatPoints(leaderboard.me.marketValue)}</strong>
                    </span>
                    <span className={`gh-stocks-rank-cell ${trendClass(leaderboard.me.profit)}`}>
                      <small>浮动盈亏</small>
                      <strong>{leaderboard.me.profit > 0 ? '+' : ''}{formatPoints(leaderboard.me.profit)}</strong>
                    </span>
                  </div>
                )}
              </>
            )}
          </section>
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
              本页面展示的股票与价格全部是虚构的模拟行情，每 3 秒跳动一次，玩家的买入卖出会明显推动价格，与真实证券市场无关。
              页面支持用站内积分投资：买入后按实时行情计算市值，择机卖出结算盈亏（买卖各收 0.3% 手续费）。
              行情由对称随机波动驱动，AI 每 40 分钟生成一批虚构快讯；玩家大额交易会明显推动价格，成交价含冲击滑点，短线往返大概率亏损。
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
                  <span>手续费（{Math.round((rule?.feeRate ?? 0) * 1000) / 10}%）</span>
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
