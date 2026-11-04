import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import { useCrisis } from '../contexts/CrisisContext'
import { usePoints } from '../contexts/PointsContext'
import {
  crisisMsUntilBlock,
  crisisQuickAmounts,
  formatCrisisCountdown,
  formatCrisisPoints,
} from '../lib/crisis'
import {
  CRISIS_ASSET_LABELS,
  CRISIS_STATUS_LABELS,
  type CrisisHistoryItem,
} from '../types/crisis'

/** 上缴额低于免征门槛就不收税：页面上要解释清楚「为什么我不用缴」 */
function statusTone(status: string): string {
  if (status === 'blocked') return 'danger'
  if (status === 'due') return 'warning'
  return 'success'
}

export default function CrisisPage() {
  const { state, ready, refresh, pay } = useCrisis()
  const { balance, refresh: refreshPoints } = usePoints()
  const [amountText, setAmountText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [history, setHistory] = useState<CrisisHistoryItem[]>([])
  const [, forceTick] = useState(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    void api.get<{ items: CrisisHistoryItem[] }>('/crisis/history')
      .then((data) => { if (mountedRef.current) setHistory(data.items ?? []) })
      .catch(() => { /* 流水读不到不影响缴税本身 */ })
  }, [state?.paid, state?.status])

  // 宽限倒计时逐秒跳动（只在待缴时挂定时器，clear 状态不空转）
  useEffect(() => {
    if (state?.status !== 'due') return
    const timer = window.setInterval(() => {
      if (!document.hidden && mountedRef.current) forceTick((value) => value + 1)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [state?.status])

  const quickAmounts = useMemo(
    () => (state ? crisisQuickAmounts(state, balance) : []),
    [state, balance],
  )

  const submit = useCallback(async (amount: number) => {
    if (!state || busy) return
    if (amount <= 0) {
      setError('请输入要上缴的积分')
      return
    }
    if (amount > balance) {
      setError(`可用积分只有 ${formatCrisisPoints(balance)}，先去银行取出 / 卖持仓 / 回收仓库物资再缴`)
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await pay(amount)
      setNotice(
        result.settled
          ? `已缴清本轮 ${formatCrisisPoints(result.charged)} 积分，下一轮 ${formatCrisisCountdown(
            result.state.nextDueAt ? new Date(result.state.nextDueAt).getTime() - Date.now() : 0,
          )}后再来。`
          : `已上缴 ${formatCrisisPoints(result.charged)} 积分，本轮还差 ${formatCrisisPoints(result.state.remaining)} 积分。`,
      )
      setAmountText('')
      void refreshPoints()
      void refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '缴纳失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }, [balance, busy, pay, refresh, refreshPoints, state])

  if (!ready || !state) {
    return <div className="gh-page-container gh-crisis-page"><p className="gh-crisis-muted">正在读取危机账单…</p></div>
  }

  const ratioPercent = Math.round(state.rules.ratio * 100)
  const intervalHours = Math.round(state.rules.intervalMs / 3_600_000)
  const graceHours = Math.round(state.rules.graceMs / 3_600_000)
  const countdown = formatCrisisCountdown(crisisMsUntilBlock(state))
  const paidRatio = state.required > 0 ? Math.min(1, state.paid / state.required) : 1

  return (
    <div className="gh-page-container gh-crisis-page">
      <header className="gh-crisis-header">
        <div>
          <h1 className="gh-page-title">⚠️ Lineweb 危机</h1>
          <p className="gh-crisis-subtitle">
            积分长期只增不减，站点进入「危机状态」：每人每 {intervalHours} 小时（从自己上次结清算起）
            须向公共银行上缴约总资产 {ratioPercent}% 的积分。
          </p>
        </div>
        <div className="gh-crisis-pool" title="公共银行只进不出，任何人都无法提取">
          <span className="gh-crisis-pool-label">Lineweb 公共银行</span>
          <strong className="gh-crisis-pool-value">{formatCrisisPoints(state.poolTotal)}</strong>
          <span className="gh-crisis-pool-note">累计上缴 · 不可提取</span>
        </div>
      </header>

      {!state.enabled && (
        <div className="gh-alert gh-alert--info">
          危机当前由管理员关闭，所有账号无需上缴，功能不受限制。
        </div>
      )}
      {state.exempt && (
        <div className="gh-alert gh-alert--info">
          你是管理员，危机豁免：不参与征收，也不会被封锁。这里的资产明细仅供核对征收口径。
        </div>
      )}

      <section className={`gh-crisis-levy gh-crisis-levy--${statusTone(state.status)}`}>
        <div className="gh-crisis-levy-head">
          <span className={`gh-crisis-badge gh-crisis-badge--${statusTone(state.status)}`}>
            {CRISIS_STATUS_LABELS[state.status]}
          </span>
          {state.status === 'due' && <span className="gh-crisis-countdown">距封锁还剩 {countdown}</span>}
          {state.status === 'blocked' && <span className="gh-crisis-countdown">功能已封锁，缴清即刻恢复</span>}
          {state.hasLiveRaid && state.status === 'due' && (
            <span className="gh-crisis-countdown">搜打撤对局进行中，打完这局才开始封锁</span>
          )}
        </div>

        <div className="gh-crisis-figure-grid">
          <div className="gh-crisis-figure">
            <span className="gh-crisis-figure-label">开轮时总资产</span>
            <strong>{formatCrisisPoints(state.snapshot)}</strong>
            <em>快照冻结，此后涨跌不改本轮账单</em>
          </div>
          <div className="gh-crisis-figure">
            <span className="gh-crisis-figure-label">本轮应缴</span>
            <strong className="gh-crisis-required">{formatCrisisPoints(state.required)}</strong>
            <em>
              {state.waiverPct > 0
                ? `公司减免 ${state.waiverPct}%（原 ${formatCrisisPoints(state.requiredBase)}）`
                : `低于 ${formatCrisisPoints(state.rules.minLevy)} 免征`}
            </em>
          </div>
          <div className="gh-crisis-figure">
            <span className="gh-crisis-figure-label">已缴</span>
            <strong>{formatCrisisPoints(state.paid)}</strong>
            <em>当前余额 {formatCrisisPoints(balance)}</em>
          </div>
          <div className="gh-crisis-figure">
            <span className="gh-crisis-figure-label">尚欠</span>
            <strong className="gh-crisis-remaining">{formatCrisisPoints(state.remaining)}</strong>
            <em>{state.nextDueAt ? `下一轮 ${new Date(state.nextDueAt).toLocaleString('zh-CN', { hour12: false })}` : '缴清后排下一轮'}</em>
          </div>
        </div>

        {state.waiverPct > 0 && (
          <div className="gh-crisis-waiver">
            <span aria-hidden>🏢</span>
            <p>
              你所在公司的业绩已经达标，本轮应缴下调 <strong>{state.waiverPct}%</strong>：
              {formatCrisisPoints(state.requiredBase)} → {formatCrisisPoints(state.required)}。
              每个档位每人终身只享一次，下一档要靠更高的累计营业额解锁。
            </p>
            <Link className="gh-btn gh-btn--ghost gh-btn--sm" to="/company">
              看公司进度
            </Link>
          </div>
        )}

        <div className="gh-crisis-progress" role="presentation">
          <span className="gh-crisis-progress-fill" style={{ width: `${Math.round(paidRatio * 100)}%` }} />
        </div>

        {state.status !== 'clear' && !state.exempt && (
          <div className="gh-crisis-pay">
            <input
              type="number"
              min={1}
              max={state.remaining}
              step={1}
              value={amountText}
              placeholder={`上缴积分（最多 ${formatCrisisPoints(Math.min(state.remaining, balance))}）`}
              onChange={(event) => setAmountText(event.target.value)}
              disabled={busy}
              aria-label="上缴积分数量"
            />
            <button
              type="button"
              className="gh-btn gh-btn--primary"
              onClick={() => submit(Number.parseInt(amountText, 10) || 0)}
              disabled={busy || state.remaining <= 0}
            >
              {busy ? '缴纳中…' : '上缴'}
            </button>
          </div>
        )}
        {quickAmounts.length > 0 && state.status !== 'clear' && !state.exempt && (
          <div className="gh-crisis-quick">
            {quickAmounts.map((amount, index) => (
              <button
                key={amount}
                type="button"
                className="gh-btn gh-btn--ghost gh-btn--sm"
                onClick={() => setAmountText(String(amount))}
                disabled={busy}
              >
                {index === quickAmounts.length - 1 ? `能缴的全缴 ${formatCrisisPoints(amount)}` : formatCrisisPoints(amount)}
              </button>
            ))}
          </div>
        )}
        {error && <div className="gh-alert gh-alert--danger" role="alert">{error}</div>}
        {notice && <div className="gh-alert gh-alert--success" role="status">{notice}</div>}
      </section>

      <section className="gh-crisis-assets">
        <h2 className="gh-crisis-section-title">我的资产构成（当前估值）</h2>
        <p className="gh-crisis-section-hint">
          账单按<strong>开轮那一刻</strong>的快照计算；下表是现在的估值，两者会随行情变化而不同。
        </p>
        <ul className="gh-crisis-asset-list">
          {CRISIS_ASSET_LABELS.map(({ key, label, hint }) => (
            <li key={key} className="gh-crisis-asset-row">
              <span className="gh-crisis-asset-name">{label}</span>
              <span className="gh-crisis-asset-hint">{hint}</span>
              <strong className="gh-crisis-asset-value">{formatCrisisPoints(state.assets.parts[key])}</strong>
            </li>
          ))}
          <li className="gh-crisis-asset-row gh-crisis-asset-row--total">
            <span className="gh-crisis-asset-name">合计</span>
            <span className="gh-crisis-asset-hint">应缴 = 快照 × {ratioPercent}%</span>
            <strong className="gh-crisis-asset-value">{formatCrisisPoints(state.assets.total)}</strong>
          </li>
        </ul>
      </section>

      <section className="gh-crisis-raise">
        <h2 className="gh-crisis-section-title">积分不够？这些入口封锁期间照常可用</h2>
        <div className="gh-crisis-raise-links">
          <Link className="gh-btn gh-btn--ghost" to="/bank">银行取出 / 支取定期 / 赎回基金</Link>
          <Link className="gh-btn gh-btn--ghost" to="/stocks">卖出股票持仓</Link>
          <Link className="gh-btn gh-btn--ghost" to="/pets/raid/storage">搜打撤仓库一键回收</Link>
          <Link className="gh-btn gh-btn--ghost" to="/points">查看积分流水</Link>
        </div>
        <p className="gh-crisis-section-hint">
          把资产换成流动积分不会让总资产变小（各项都计入征收口径），但能让你先把本轮缴清、解除封锁。
        </p>
      </section>

      <section className="gh-crisis-history">
        <h2 className="gh-crisis-section-title">上缴记录</h2>
        {history.length === 0 ? (
          <p className="gh-crisis-muted">还没有上缴记录。</p>
        ) : (
          <ul className="gh-crisis-history-list">
            {history.map((item) => (
              <li key={item.id} className="gh-crisis-history-row">
                <span className="gh-crisis-history-time">{new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
                <strong className="gh-crisis-history-amount">{formatCrisisPoints(item.amount)}</strong>
                <span className="gh-crisis-history-balance">缴费后余额 {formatCrisisPoints(item.balance)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="gh-crisis-rules">
        <h2 className="gh-crisis-section-title">本轮口径</h2>
        <ul className="gh-crisis-rule-list">
          <li>征收比例：总资产的 {ratioPercent}%（管理员可调）</li>
          <li>缴纳周期：结清后每 {intervalHours} 小时一轮，各人独立滚动</li>
          <li>宽限期：开轮后 {graceHours} 小时内可筹钱；先缴一部分不会延长这个时限</li>
          <li>免征门槛：按 {ratioPercent}% 算出来不足 {formatCrisisPoints(state.rules.minLevy)} 积分则本轮不收</li>
          <li>封锁范围：除危机页与「筹钱 / 查账」入口外，全站功能一律 403</li>
          <li>对局保护：正在打搜打撤时暂不封锁，撤离结算后再封</li>
          <li>公共银行：只进不出，任何人都不能提取，只显示累计总额</li>
        </ul>
      </section>
    </div>
  )
}
