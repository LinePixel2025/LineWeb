import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import type { StockMarket, StockQuote } from '../types/stock'

/** 只在本次浏览器会话内记住「不再提示」，刷新页面仍会再次提示 */
const NOTICE_KEY = 'lineweb_stocks_notice_ack'

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

function trendClass(value: number): string {
  if (value > 0) return 'gh-stock-up'
  if (value < 0) return 'gh-stock-down'
  return 'gh-stock-flat'
}

function PriceChart({ stock }: { stock: StockQuote }) {
  const width = 720
  const height = 260
  const padX = 18
  const padY = 22
  const candles = stock.history
  const geometry = useMemo(() => {
    if (candles.length < 2) return null
    const closes = candles.map((candle) => candle.close)
    const min = Math.min(...closes)
    const max = Math.max(...closes)
    const span = max - min || 1
    const x = (index: number) => padX + (index / (candles.length - 1)) * (width - padX * 2)
    const y = (value: number) => height - padY - ((value - min) / span) * (height - padY * 2)
    const line = closes
      .map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`)
      .join(' ')
    const lastIndex = closes.length - 1
    const area = `${line} L${x(lastIndex).toFixed(1)},${(height - padY).toFixed(1)} L${x(0).toFixed(1)},${(height - padY).toFixed(1)} Z`
    return { closes, min, max, x, y, line, area, lastIndex }
  }, [candles])

  if (!geometry) {
    return <div className="gh-stocks-chart-empty">暂无足够的历史数据</div>
  }

  const up = stock.history[stock.history.length - 1].close >= stock.history[0].close
  const stroke = up ? 'var(--gh-danger)' : 'var(--gh-success)'
  const gridValues = [null, 0.25, 0.5, 0.75, null].map((ratio) =>
    ratio === null ? null : geometry.min + (geometry.max - geometry.min) * ratio,
  )
  const startDate = candles[0].date.slice(5)
  const endDate = candles[candles.length - 1].date.slice(5)
  const midDate = candles[Math.floor(candles.length / 2)].date.slice(5)

  return (
    <div className={`gh-stocks-chart ${up ? 'gh-stocks-chart--up' : 'gh-stocks-chart--down'}`}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${stock.name}近 30 日走势`}>
        <defs>
          <linearGradient id={`stock-fill-${stock.code}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={up ? 'var(--gh-danger)' : 'var(--gh-success)'} stopOpacity="0.22" />
            <stop offset="100%" stopColor={up ? 'var(--gh-danger)' : 'var(--gh-success)'} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {gridValues.map((value, index) => {
          if (value === null) return null
          const y = geometry.y(value)
          return (
            <g key={index}>
              <line
                x1={padX}
                x2={width - padX}
                y1={y}
                y2={y}
                stroke="var(--gh-border-muted)"
                strokeDasharray="3 5"
              />
              <text x={padX - 4} y={y - 3} textAnchor="end" fontSize="10" fill="var(--gh-text-tertiary)">
                {value.toFixed(1)}
              </text>
            </g>
          )
        })}
        <path d={geometry.area} fill={`url(#stock-fill-${stock.code})`} />
        <path d={geometry.line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle
          cx={geometry.x(geometry.lastIndex)}
          cy={geometry.y(geometry.closes[geometry.lastIndex])}
          r="3.5"
          fill={stroke}
        />
        <text x={padX} y={height - 4} fontSize="10" fill="var(--gh-text-tertiary)">{startDate}</text>
        <text x={width / 2} y={height - 4} fontSize="10" textAnchor="middle" fill="var(--gh-text-tertiary)">{midDate}</text>
        <text x={width - padX} y={height - 4} fontSize="10" textAnchor="end" fill="var(--gh-text-tertiary)">{endDate}</text>
      </svg>
    </div>
  )
}

export default function StocksPage() {
  const [market, setMarket] = useState<StockMarket | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [dontRemind, setDontRemind] = useState(false)
  const [noticeOpen, setNoticeOpen] = useState(() => {
    try {
      return sessionStorage.getItem(NOTICE_KEY) !== '1'
    } catch {
      return true
    }
  })

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const data = await api.get<StockMarket>('/stocks/market')
        if (cancelled) return
        setMarket(data)
        setSelectedCode((prev) => prev ?? data.stocks[0]?.code ?? null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载行情失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const selected = market?.stocks.find((stock) => stock.code === selectedCode) ?? market?.stocks[0] ?? null
  const upCount = market?.stocks.filter((stock) => stock.changePct > 0).length ?? 0
  const downCount = market?.stocks.filter((stock) => stock.changePct < 0).length ?? 0

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

  const historyChangePct = selected && selected.history.length > 1
    ? ((selected.price - selected.history[0].close) / selected.history[0].close) * 100
    : 0

  return (
    <div className="gh-page-container gh-stocks-page">
      <header className="gh-stocks-header">
        <div>
          <p className="gh-stocks-eyebrow"><Link to="/">← 返回首页</Link></p>
          <h1 className="gh-page-title">模拟股市</h1>
          <p className="gh-text-secondary">
            每天 0 点刷新一组虚构股票行情。仅用于展示，不可交易、不产生任何收益。
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
          <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" onClick={() => setNoticeOpen(true)}>
            风险提示
          </button>
        </div>
      </header>

      {error && <div className="gh-alert gh-alert--danger" role="alert">{error}</div>}

      {loading && !market ? (
        <div className="gh-stocks-loading">
          <div className="gh-spinner" />
        </div>
      ) : market && (
        <div className="gh-stocks-layout">
          <aside className="gh-box gh-stocks-list" aria-label="股票列表">
            <div className="gh-stocks-list-head">
              <strong>{market.stocks.length} 只股票</strong>
              <span className="gh-text-tertiary">涨 {upCount} · 跌 {downCount}</span>
            </div>
            <ul>
              {market.stocks.map((stock) => (
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
                      </span>
                      <span className="gh-stocks-row-code">{stock.code} · {stock.sector}</span>
                    </span>
                    <span className="gh-stocks-row-quote">
                      <span className="gh-stocks-row-price">{formatPrice(stock.price)}</span>
                      <span className={`gh-stocks-row-pct ${trendClass(stock.changePct)}`}>
                        {formatPct(stock.changePct)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
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
                  </h2>
                  <p className="gh-text-tertiary gh-stocks-detail-price-line">
                    <strong className={`gh-stocks-detail-price ${trendClass(selected.change)}`}>
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
                    <strong className={trendClass(historyChangePct)}>{formatPct(historyChangePct)}</strong>
                  </div>
                </div>
              </div>

              <PriceChart stock={selected} />

              <footer className="gh-stocks-detail-foot">
                <span>{market.disclaimer}</span>
                <span className="gh-text-tertiary">计价单位：{market.currency}</span>
              </footer>
            </section>
          )}
        </div>
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
              本页面展示的股票、价格与走势全部是虚构数据，由程序按日期生成，与真实证券市场无关。
              当前版本<strong>不支持交易，也不产生任何积分或收益</strong>，仅用于查看。
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
    </div>
  )
}
