import { useCallback, useEffect, useMemo, useState } from 'react'
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
} from '../types/stock'

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

function formatShares(value: number): string {
  return value >= 1000 ? value.toFixed(0) : value.toFixed(2)
}

function formatPoints(value: number): string {
  return value.toLocaleString('zh-CN')
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
  const [portfolio, setPortfolio] = useState<StockPortfolio | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
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

  const loadPortfolio = useCallback(async () => {
    const data = await api.get<StockPortfolio>('/stocks/portfolio')
    setPortfolio(data)
    return data
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [marketData, portfolioData] = await Promise.all([
          api.get<StockMarket>('/stocks/market'),
          api.get<StockPortfolio>('/stocks/portfolio'),
        ])
        if (cancelled) return
        setMarket(marketData)
        setPortfolio(portfolioData)
        setSelectedCode((prev) => prev
          ?? portfolioData.holdings[0]?.code
          ?? marketData.stocks[0]?.code
          ?? null)
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
  const holding = portfolio?.holdings.find((row) => row.code === selected?.code) ?? null
  const upCount = market?.stocks.filter((stock) => stock.changePct > 0).length ?? 0
  const downCount = market?.stocks.filter((stock) => stock.changePct < 0).length ?? 0

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

  const historyChangePct = selected && selected.history.length > 1
    ? ((selected.price - selected.history[0].close) / selected.history[0].close) * 100
    : 0

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

  const sell = async () => {
    if (busy || !selected || !holding) return
    if (!window.confirm(`按今日价 ${formatPrice(selected.price)} 卖出全部 ${formatShares(holding.shares)} 份「${holding.name}」？`)) {
      return
    }
    setBusy(true)
    setTradeNotice(null)
    try {
      const result = await api.post<StockSellResult>('/stocks/sell', { code: selected.code })
      const profitText = result.profit >= 0 ? `盈利 ${formatPoints(result.profit)}` : `亏损 ${formatPoints(-result.profit)}`
      setTradeNotice({
        tone: result.profit >= 0 ? 'success' : 'danger',
        text: `卖出 ${result.name}，到账 ${formatPoints(result.proceeds)} 积分（手续费 ${result.fee}），${profitText}`,
      })
      await Promise.all([loadPortfolio(), refreshPoints()])
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

  return (
    <div className="gh-page-container gh-stocks-page">
      <header className="gh-stocks-header">
        <div>
          <p className="gh-stocks-eyebrow"><Link to="/">← 返回首页</Link></p>
          <h1 className="gh-page-title">模拟股市</h1>
          <p className="gh-text-secondary">
            每天 0 点刷新一组虚构股票行情。用积分买入，卖出时按当日价结算收益（模拟数据，不可兑换真实货币）。
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

      {error && <div className="gh-alert gh-alert--danger" role="alert">{error}</div>}
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

                {rule && (
                  <div className="gh-stocks-trade">
                    <div className="gh-stocks-trade-head">
                      <div>
                        <strong>积分投资</strong>
                        <p className="gh-text-tertiary">
                          单笔 {formatPoints(rule.minInvest)}–{formatPoints(rule.maxInvest)} 积分 · 买卖各收 {Math.round(rule.feeRate * 100)}% 手续费 · 行情每天 0 点刷新
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
                          onClick={() => void sell()}
                        >
                          卖出全部
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
              本页面展示的股票、价格与走势全部是虚构数据，由程序按日期规则生成，与真实证券市场无关。
              页面支持用站内积分投资：买入后按每天 0 点刷新的行情计算市值，卖出时结算盈亏（买卖各收 1% 手续费）。
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
    </div>
  )
}
