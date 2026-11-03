import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import { usePoints } from '../contexts/PointsContext'
import Icon from '../components/ui/Icon'
import type {
  BankDeposit,
  BankFixedOpenResult,
  BankFixedRedeemResult,
  BankFund,
  BankLedgerEntry,
  BankOverview,
  BankDemandResult,
  FundBuyResult,
  FundSellResult,
} from '../types/bank'

/** 总览轮询间隔（利息按日结算，行情逐日变化，15 秒足够） */
const OVERVIEW_POLL_MS = 15_000
/** 页面内轻提示停留时长 */
const TOAST_MS = 5_000

/** 积分流水 reason 中文映射（与 schema 注释枚举一致） */
const REASON_LABELS: Record<string, string> = {
  bank_deposit_in: '活期存入',
  bank_demand_withdraw: '活期取出',
  bank_fixed_open: '定期存入',
  bank_fixed_redeem: '定期支取',
  bank_interest: '利息发放',
  fund_buy: '基金买入',
  fund_sell: '基金卖出',
}

function formatPoints(value: number): string {
  return value.toLocaleString('zh-CN')
}

/** 净值统一 4 位小数 */
function formatNav(value: number): string {
  return value.toFixed(4)
}

function formatPct(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

/** 涨红跌绿（与模拟股市同一配色习惯） */
function trendClass(value: number): string {
  if (value > 0) return 'gh-bank-up'
  if (value < 0) return 'gh-bank-down'
  return 'gh-bank-flat'
}

function formatDateTime(iso: string): string {
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
    return iso.slice(5, 16).replace('T', ' ')
  }
}

/** 金额输入解析：非法 / 非整数返回 null（服务端仍会做权威校验） */
function parseAmountInput(raw: string): number | null {
  const value = Number(raw)
  if (!Number.isFinite(value)) return null
  const amount = Math.trunc(value)
  if (amount < 100 || amount > 100_000) return null
  return amount
}

function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason
}

/** 近 14 日净值迷你走势（纯 SVG polyline，不引第三方库） */
function Sparkline({ series, up }: { series: { date: string; nav: number }[]; up: boolean }) {
  if (series.length < 2) {
    return <div className="gh-bank-spark gh-bank-spark--empty">走势数据积累中</div>
  }
  const navs = series.map((point) => point.nav)
  const min = Math.min(...navs)
  const max = Math.max(...navs)
  const span = max - min || 1
  const width = 100
  const height = 36
  const points = series
    .map((point, index) => {
      const x = (index / (series.length - 1)) * width
      const y = height - 3 - ((point.nav - min) / span) * (height - 6)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const stroke = up ? 'var(--gh-danger)' : 'var(--gh-success)'
  return (
    <svg
      className="gh-bank-spark"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="近 14 日净值走势"
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/** 买入 / 卖出基金弹层（买入按积分、卖出按份额） */
function FundTradeModal({
  fund,
  mode,
  balance,
  feeRate,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  fund: BankFund
  mode: 'buy' | 'sell'
  balance: number
  /** 单边手续费率（服务端 rules 下发） */
  feeRate: number
  busy: boolean
  error: string | null
  onClose: () => void
  onSubmit: (value: number) => void
}) {
  const [raw, setRaw] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const isBuy = mode === 'buy'
  const inputValue = Number(raw)
  const valid = Number.isFinite(inputValue) && inputValue > 0

  // 买入预览：手续费（最少 1 积分）→ 份额；卖出预览：毛收入 − 手续费 → 到账
  const preview = (() => {
    if (!valid) return null
    if (isBuy) {
      const points = Math.trunc(inputValue)
      const fee = Math.max(1, Math.ceil(points * feeRate))
      const net = Math.max(0, points - fee)
      return { fee, proceeds: null as number | null, shares: net / fund.nav, points }
    }
    const shares = inputValue
    const gross = shares * fund.nav
    const fee = gross > 0 ? Math.max(1, Math.ceil(gross * feeRate)) : 0
    return { fee, proceeds: Math.max(0, Math.floor(gross - fee)), shares, points: null as number | null }
  })()

  const fillRatio = (ratio: number) => {
    if (isBuy) {
      setRaw(String(Math.max(0, Math.min(100_000, Math.floor(balance * ratio)))))
    } else {
      const shares = Math.floor(fund.holding.shares * ratio * 1e6) / 1e6
      setRaw(String(shares))
    }
    setLocalError(null)
  }

  const submit = () => {
    if (!valid) {
      setLocalError(isBuy ? '请输入 100–100000 之间的整数积分' : '请输入大于 0 的份额')
      return
    }
    if (isBuy) {
      const amount = parseAmountInput(raw)
      if (amount === null) {
        setLocalError('买入金额需为 100–100000 之间的整数积分')
        return
      }
      if (amount > balance) {
        setLocalError('积分不足')
        return
      }
      onSubmit(amount)
      return
    }
    if (inputValue > fund.holding.shares + 1e-9) {
      setLocalError(`卖出份额不能超过持有的 ${fund.holding.shares.toFixed(2)} 份`)
      return
    }
    onSubmit(inputValue)
  }

  return (
    <div className="gh-bank-modal-overlay" onClick={onClose} role="presentation">
      <div className="gh-bank-modal" role="dialog" aria-modal="true" aria-label={isBuy ? '买入基金' : '卖出基金'} onClick={(event) => event.stopPropagation()}>
        <div className="gh-bank-modal-head">
          <strong>
            {fund.emoji} {isBuy ? '买入' : '卖出'} {fund.name}
          </strong>
          <button type="button" className="gh-bank-modal-close" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={15} />
          </button>
        </div>
        <p className="gh-text-tertiary gh-bank-modal-nav">
          当日净值 <strong>{formatNav(fund.nav)}</strong>
          <span className={trendClass(fund.changePct)}>（{formatPct(fund.changePct)}）</span>
        </p>
        <label className="gh-bank-field">
          <span>{isBuy ? '投入积分' : '卖出份额'}</span>
          <input
            className="gh-input"
            type="number"
            min={isBuy ? 100 : 0.0001}
            step={isBuy ? 1 : 0.0001}
            value={raw}
            onChange={(event) => {
              setRaw(event.target.value)
              setLocalError(null)
            }}
            aria-label={isBuy ? '投入积分' : '卖出份额'}
          />
        </label>
        <div className="gh-bank-quick-row">
          {[0.25, 0.5, 1].map((ratio) => (
            <button key={ratio} type="button" className="gh-btn gh-btn--ghost gh-btn--sm" onClick={() => fillRatio(ratio)}>
              {ratio === 1 ? '全部' : `${ratio * 100}%`}
            </button>
          ))}
        </div>
        {preview && (
          <p className="gh-text-tertiary gh-bank-modal-preview">
            {isBuy
              ? `预计买入 ${preview.shares.toFixed(2)} 份（手续费 ${formatPoints(preview.fee)} 积分）`
              : `预计到账 ${formatPoints(preview.proceeds ?? 0)} 积分（手续费 ${formatPoints(preview.fee)}）`}
          </p>
        )}
        {(localError || error) && (
          <div className="gh-alert gh-alert--danger" role="status">{localError ?? error}</div>
        )}
        <div className="gh-bank-modal-actions">
          <button type="button" className="gh-btn gh-btn--secondary" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className={`gh-btn gh-btn--primary ${isBuy ? '' : 'gh-bank-btn-sell'}`}
            disabled={busy || !valid}
            onClick={submit}
          >
            {busy ? '处理中…' : isBuy ? '确认买入' : '确认卖出'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 单张定期存单（active）行 */
function DepositRow({ deposit, busy, onRedeem }: { deposit: BankDeposit; busy: boolean; onRedeem: () => void }) {
  return (
    <li className={`gh-bank-deposit ${deposit.matured ? 'gh-bank-deposit--matured' : ''}`}>
      <div className="gh-bank-deposit-main">
        <strong>{deposit.termLabel}定存 · {formatPoints(deposit.principal)} 积分</strong>
        <span className="gh-text-tertiary">
          年化 {(deposit.annualRate * 100).toFixed(1)}% · {deposit.matured
            ? '已到期'
            : `剩余 ${deposit.remainingDays} 天到期`}
        </span>
      </div>
      <div className="gh-bank-deposit-side">
        <span className={`gh-bank-deposit-interest ${trendClass(deposit.currentInterestEstimate)}`}>
          {deposit.matured
            ? `到期利息 +${formatPoints(deposit.matureInterest)}`
            : `现在支取约 +${formatPoints(deposit.currentInterestEstimate)}（按活期）`}
        </span>
        <button
          type="button"
          className={`gh-btn gh-btn--sm ${deposit.matured ? 'gh-btn--primary' : 'gh-btn--secondary'}`}
          disabled={busy}
          onClick={onRedeem}
        >
          支取
        </button>
      </div>
    </li>
  )
}

export default function BankPage() {
  const { balance, refresh: refreshPoints } = usePoints()
  const [overview, setOverview] = useState<BankOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const [demandAmount, setDemandAmount] = useState('1000')
  const [demandMode, setDemandMode] = useState<'deposit' | 'withdraw'>('deposit')
  const [fixedTerm, setFixedTerm] = useState('30d')
  const [fixedAmount, setFixedAmount] = useState('1000')
  const [fundModal, setFundModal] = useState<{ code: string; mode: 'buy' | 'sell' } | null>(null)
  const [fundModalError, setFundModalError] = useState<string | null>(null)

  const toastTimerRef = useRef(0)
  const requestRef = useRef(0)

  const pushNotice = useCallback((tone: 'success' | 'danger', text: string) => {
    window.clearTimeout(toastTimerRef.current)
    setNotice({ tone, text })
    toastTimerRef.current = window.setTimeout(() => setNotice(null), TOAST_MS)
  }, [])

  useEffect(() => () => window.clearTimeout(toastTimerRef.current), [])

  const loadOverview = useCallback(async () => {
    const requestId = ++requestRef.current
    try {
      const data = await api.get<BankOverview>('/bank')
      if (requestRef.current !== requestId) return
      setOverview(data)
      setLoadError(null)
    } catch (err) {
      if (requestRef.current !== requestId) return
      // 保留旧数据只提示中断，避免轮询偶发失败清空整页
      setLoadError(err instanceof Error ? err.message : '银行数据加载失败')
    } finally {
      if (requestRef.current === requestId) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadOverview()
    const timer = window.setInterval(() => {
      if (document.hidden) return
      void loadOverview()
    }, OVERVIEW_POLL_MS)
    const handleVisibility = () => {
      if (!document.hidden) void loadOverview()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [loadOverview])

  /** 动作成功后的统一刷新：总览 + 顶栏积分余额 */
  const refreshAfterAction = useCallback(async () => {
    await Promise.all([loadOverview(), refreshPoints()])
  }, [loadOverview, refreshPoints])

  const demandBalance = overview?.demand.balance ?? 0
  const parsedDemand = parseAmountInput(demandAmount)
  const demandValid = parsedDemand !== null
  const demandInsufficient = demandMode === 'deposit'
    ? parsedDemand !== null && parsedDemand > balance
    : parsedDemand !== null && parsedDemand > demandBalance
  const parsedFixed = parseAmountInput(fixedAmount)

  /** 快捷回填：以传入值为上限，再夹到余额 / 单笔上限内 */
  const fillDemand = (value: number) => {
    const cap = Math.min(demandMode === 'deposit' ? balance : demandBalance, 100_000)
    setDemandAmount(String(Math.max(0, Math.floor(Math.min(value, cap)))))
  }

  const fillFixed = (value: number) => {
    setFixedAmount(String(Math.max(0, Math.floor(Math.min(value, balance, 100_000)))))
  }

  const submitDemand = async () => {
    if (busy) return
    const amount = parseAmountInput(demandAmount)
    if (amount === null) {
      pushNotice('danger', '金额需为 100–100000 之间的整数积分')
      return
    }
    if (demandMode === 'deposit' && amount > balance) {
      pushNotice('danger', '积分不足')
      return
    }
    if (demandMode === 'withdraw' && amount > demandBalance) {
      pushNotice('danger', '活期余额不足')
      return
    }
    setBusy(true)
    try {
      const path = demandMode === 'deposit' ? '/bank/demand/deposit' : '/bank/demand/withdraw'
      const result = await api.post<BankDemandResult>(path, { amount })
      pushNotice(
        'success',
        demandMode === 'deposit'
          ? `已存入 ${formatPoints(amount)} 积分到活期，当前活期余额 ${formatPoints(result.demandBalance)}`
          : `已取出 ${formatPoints(amount)} 积分，当前活期余额 ${formatPoints(result.demandBalance)}`,
      )
      await refreshAfterAction()
    } catch (err) {
      pushNotice('danger', err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const submitFixed = async () => {
    if (busy) return
    const amount = parseAmountInput(fixedAmount)
    if (amount === null) {
      pushNotice('danger', '金额需为 100–100000 之间的整数积分')
      return
    }
    if (amount > balance) {
      pushNotice('danger', '积分不足')
      return
    }
    setBusy(true)
    try {
      const result = await api.post<BankFixedOpenResult>('/bank/deposits', {
        termKey: fixedTerm,
        amount,
      })
      pushNotice(
        'success',
        `定期存单已开立：${result.deposit.termLabel} · ${formatPoints(amount)} 积分 · 年化 ${(result.deposit.annualRate * 100).toFixed(1)}%`,
      )
      await refreshAfterAction()
    } catch (err) {
      pushNotice('danger', err instanceof Error ? err.message : '开单失败')
    } finally {
      setBusy(false)
    }
  }

  const redeemDeposit = async (deposit: BankDeposit) => {
    if (busy) return
    setBusy(true)
    try {
      const result = await api.post<BankFixedRedeemResult>(`/bank/deposits/${deposit.id}/redeem`)
      pushNotice(
        'success',
        result.matured
          ? `定期到期支取：本金 ${formatPoints(result.principal)} + 利息 ${formatPoints(result.interest)}，共 ${formatPoints(result.total)} 积分已入账`
          : `定期提前支取：本金 ${formatPoints(result.principal)} + 活期利息 ${formatPoints(result.interest)}，共 ${formatPoints(result.total)} 积分已入账`,
      )
      await refreshAfterAction()
    } catch (err) {
      pushNotice('danger', err instanceof Error ? err.message : '支取失败')
    } finally {
      setBusy(false)
    }
  }

  const activeFund = overview?.funds.find((fund) => fund.code === fundModal?.code) ?? null

  const submitFund = async (value: number) => {
    if (busy || !fundModal || !activeFund) return
    setBusy(true)
    setFundModalError(null)
    try {
      if (fundModal.mode === 'buy') {
        const result = await api.post<FundBuyResult>('/bank/funds/buy', {
          code: fundModal.code,
          points: value,
        })
        pushNotice(
          'success',
          `已买入 ${result.fundName} ${result.shares.toFixed(2)} 份（净值 ${formatNav(result.nav)}，手续费 ${formatPoints(result.fee)} 积分）`,
        )
        setFundModal(null)
      } else {
        const result = await api.post<FundSellResult>('/bank/funds/sell', {
          code: fundModal.code,
          shares: value,
        })
        const profit = result.proceeds - result.costPoints
        pushNotice(
          profit >= 0 ? 'success' : 'danger',
          `已卖出 ${result.fundName} ${result.shares.toFixed(2)} 份，到账 ${formatPoints(result.proceeds)} 积分（手续费 ${formatPoints(result.fee)}，${profit >= 0 ? '盈亏 +' : '盈亏 '}${formatPoints(profit)}）${result.closed ? '，已清仓' : ''}`,
        )
        setFundModal(null)
      }
      await refreshAfterAction()
    } catch (err) {
      setFundModalError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const openFundModal = (code: string, mode: 'buy' | 'sell') => {
    setFundModal({ code, mode })
    setFundModalError(null)
  }

  const activeDeposits = overview?.deposits.filter((row) => row.status === 'active') ?? []

  return (
    <div className="gh-page-container gh-bank-page">
      <header className="gh-bank-header">
        <div>
          <p className="gh-bank-eyebrow"><Link to="/">← 返回首页</Link></p>
          <h1 className="gh-page-title">🏦 LineWeb 银行</h1>
          <p className="gh-text-secondary">
            积分存入银行获取利息：活期随存随取（年化 2%），定期锁定更高利率（提前支取按活期计息）；
            基金净值每日波动，投资有风险，入市需谨慎。
          </p>
        </div>
        <Link to="/points" className="gh-header-points" title="积分中心">
          <span className="gh-header-points-icon" aria-hidden><Icon name="coin" size={15} /></span>
          <span className="gh-header-points-value">{formatPoints(balance)}</span>
        </Link>
      </header>

      {loadError && <div className="gh-alert gh-alert--danger" role="status">{loadError}</div>}
      {notice && <div className={`gh-alert gh-alert--${notice.tone}`} role="status">{notice.text}</div>}

      {loading && !overview ? (
        <div className="gh-bank-loading">
          <div className="gh-spinner" />
        </div>
      ) : overview && (
        <>
          <div className="gh-bank-layout">
            {/* 活期 */}
            <section className="gh-box gh-bank-card" aria-label="活期存款">
              <div className="gh-bank-card-head">
                <h2>活期存款</h2>
                <span className="gh-text-tertiary">年化 {(overview.demand.annualRate * 100).toFixed(1)}% · 按日计息</span>
              </div>
              <p className="gh-bank-demand-balance">
                <span>活期余额</span>
                <strong>{formatPoints(overview.demand.balance)}</strong>
              </p>
              {overview.demand.interestToday > 0 && (
                <p className="gh-bank-interest-hint" role="status">
                  本次读取结算利息 +{formatPoints(overview.demand.interestToday)} 积分（已入账）
                </p>
              )}
              <div className="gh-bank-segment" role="group" aria-label="存入或取出">
                <button
                  type="button"
                  className={`gh-bank-segment-btn ${demandMode === 'deposit' ? 'gh-bank-segment-btn--active' : ''}`}
                  aria-pressed={demandMode === 'deposit'}
                  onClick={() => { setDemandMode('deposit'); setDemandAmount('1000') }}
                >
                  存入
                </button>
                <button
                  type="button"
                  className={`gh-bank-segment-btn ${demandMode === 'withdraw' ? 'gh-bank-segment-btn--active' : ''}`}
                  aria-pressed={demandMode === 'withdraw'}
                  onClick={() => { setDemandMode('withdraw'); setDemandAmount('1000') }}
                >
                  取出
                </button>
              </div>
              <div className="gh-bank-action-row">
                <input
                  className="gh-input gh-bank-amount"
                  type="number"
                  min={100}
                  max={100_000}
                  step={1}
                  value={demandAmount}
                  onChange={(event) => setDemandAmount(event.target.value)}
                  aria-label="金额（积分）"
                />
                <div className="gh-bank-quick-row">
                  {[0.25, 0.5, 1].map((ratio) => (
                    <button
                      key={ratio}
                      type="button"
                      className="gh-btn gh-btn--ghost gh-btn--sm"
                      onClick={() => fillDemand(ratio === 1 ? Number.MAX_SAFE_INTEGER : (demandMode === 'deposit' ? balance : demandBalance) * ratio)}
                    >
                      {ratio === 1 ? '全部' : `${ratio * 100}%`}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="gh-btn gh-btn--primary gh-btn--md"
                  disabled={busy || !demandValid || demandInsufficient}
                  onClick={() => void submitDemand()}
                >
                  {busy ? '处理中…' : demandMode === 'deposit' ? '存入' : '取出'}
                </button>
              </div>
              {!demandValid && <p className="gh-text-tertiary gh-bank-hint">单笔 100–100000 积分，利息按自然日结算、向下取整</p>}
            </section>

            {/* 定期 */}
            <section className="gh-box gh-bank-card" aria-label="定期存款">
              <div className="gh-bank-card-head">
                <h2>定期存款</h2>
                <span className="gh-text-tertiary">开单锁定利率 · 提前支取按活期计息</span>
              </div>
              <table className="gh-bank-terms">
                <thead>
                  <tr>
                    <th>期限</th>
                    <th>年化利率</th>
                    <th>持有单数</th>
                    <th aria-label="选择" />
                  </tr>
                </thead>
                <tbody>
                  {overview.fixedTerms.map((term) => (
                    <tr key={term.key} className={fixedTerm === term.key ? 'gh-bank-terms-row--active' : undefined}>
                      <td>{term.label}</td>
                      <td className="gh-bank-up">{(term.annualRate * 100).toFixed(1)}%</td>
                      <td>{term.holdings > 0 ? `${term.holdings} 单` : '—'}</td>
                      <td>
                        <button
                          type="button"
                          className={`gh-btn gh-btn--sm ${fixedTerm === term.key ? 'gh-btn--primary' : 'gh-btn--ghost'}`}
                          aria-pressed={fixedTerm === term.key}
                          onClick={() => setFixedTerm(term.key)}
                        >
                          {fixedTerm === term.key ? '已选' : '选择'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="gh-bank-action-row">
                <input
                  className="gh-input gh-bank-amount"
                  type="number"
                  min={100}
                  max={100_000}
                  step={1}
                  value={fixedAmount}
                  onChange={(event) => setFixedAmount(event.target.value)}
                  aria-label="存入金额（积分）"
                />
                <div className="gh-bank-quick-row">
                  {[0.25, 0.5, 1].map((ratio) => (
                    <button
                      key={ratio}
                      type="button"
                      className="gh-btn gh-btn--ghost gh-btn--sm"
                      onClick={() => fillFixed(ratio === 1 ? Number.MAX_SAFE_INTEGER : balance * ratio)}
                    >
                      {ratio === 1 ? '全部' : `${ratio * 100}%`}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="gh-btn gh-btn--primary gh-btn--md"
                  disabled={busy || parsedFixed === null || parsedFixed > balance}
                  onClick={() => void submitFixed()}
                >
                  {busy ? '处理中…' : '开单'}
                </button>
              </div>
              {activeDeposits.length > 0 && (
                <ul className="gh-bank-deposits">
                  {activeDeposits.map((deposit) => (
                    <DepositRow key={deposit.id} deposit={deposit} busy={busy} onRedeem={() => void redeemDeposit(deposit)} />
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* 基金 */}
          <section className="gh-box gh-bank-card" aria-label="基金投资">
            <div className="gh-bank-card-head">
              <h2>基金投资</h2>
              <span className="gh-text-tertiary">净值每日波动 · 买卖各收 0.25% 手续费</span>
            </div>
            <div className="gh-bank-funds">
              {overview.funds.map((fund) => {
                const holdingValue = fund.holding.value
                const profit = holdingValue - fund.holding.costPoints
                return (
                  <article key={fund.code} className="gh-bank-fund">
                    <div className="gh-bank-fund-head">
                      <span className="gh-bank-fund-name">
                        <i>{fund.emoji}</i>
                        {fund.name}
                        <small>{fund.code}</small>
                      </span>
                      <span className={`gh-bank-fund-pct ${trendClass(fund.changePct)}`}>{formatPct(fund.changePct)}</span>
                    </div>
                    <div className="gh-bank-fund-nav">
                      <strong>{formatNav(fund.nav)}</strong>
                      <small>昨日 {formatNav(fund.prevNav)}</small>
                    </div>
                    <Sparkline series={fund.navSeries} up={fund.changePct >= 0} />
                    {fund.holding.shares > 0 ? (
                      <p className="gh-bank-fund-holding">
                        持有 {fund.holding.shares.toFixed(2)} 份 · 市值 <strong>{formatPoints(holdingValue)}</strong>
                        <span className={trendClass(profit)}>（{profit >= 0 ? '+' : ''}{formatPoints(profit)}）</span>
                      </p>
                    ) : (
                      <p className="gh-bank-fund-holding gh-text-tertiary">未持有</p>
                    )}
                    <div className="gh-bank-fund-actions">
                      <button
                        type="button"
                        className="gh-btn gh-btn--primary gh-btn--sm"
                        disabled={busy}
                        onClick={() => openFundModal(fund.code, 'buy')}
                      >
                        买入
                      </button>
                      {fund.holding.shares > 0 && (
                        <button
                          type="button"
                          className="gh-btn gh-btn--secondary gh-btn--sm"
                          disabled={busy}
                          onClick={() => openFundModal(fund.code, 'sell')}
                        >
                          卖出
                        </button>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>

          {/* 最近流水 */}
          <section className="gh-box gh-bank-card" aria-label="最近流水">
            <div className="gh-bank-card-head">
              <h2>最近流水</h2>
              <span className="gh-text-tertiary">银行与基金相关积分变动（最多 30 条）</span>
            </div>
            {overview.trades.length === 0 ? (
              <p className="gh-bank-empty">还没有流水，存入第一笔积分开始理财吧</p>
            ) : (
              <ul className="gh-bank-ledger">
                {overview.trades.map((entry: BankLedgerEntry) => (
                  <li key={entry.id} className="gh-bank-ledger-row">
                    <span className="gh-bank-ledger-main">
                      <strong>{reasonLabel(entry.reason)}</strong>
                      {entry.note && <small className="gh-text-tertiary">{entry.note}</small>}
                    </span>
                    <span className="gh-bank-ledger-side">
                      <strong className={entry.amount >= 0 ? 'gh-bank-up' : 'gh-bank-down'}>
                        {entry.amount > 0 ? '+' : ''}{formatPoints(entry.amount)}
                      </strong>
                      <small className="gh-text-tertiary">{formatDateTime(entry.createdAt)}</small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {fundModal && activeFund && (
        <FundTradeModal
          fund={activeFund}
          mode={fundModal.mode}
          balance={balance}
          feeRate={overview?.rules.fundFeeRate ?? 0.0025}
          busy={busy}
          error={fundModalError}
          onClose={() => setFundModal(null)}
          onSubmit={(value) => void submitFund(value)}
        />
      )}
    </div>
  )
}
