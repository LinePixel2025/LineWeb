import { useCallback, useEffect, useState } from 'react'
import api from '../../lib/api'
import Badge from '../../components/ui/Badge'
import { formatCrisisPoints } from '../../lib/crisis'
import type { CrisisAdminOverview, CrisisDividendRecord } from '../../types/crisis'

const HOUR_MS = 3_600_000

interface ConfigForm {
  enabled: boolean
  ratioPercent: string
  intervalHours: string
  graceHours: string
  minLevy: string
  dividendEnabled: boolean
  dividendPct: string
}

function formOf(rules: CrisisAdminOverview['rules']): ConfigForm {
  return {
    enabled: rules.enabled,
    ratioPercent: String(Math.round(rules.ratio * 100)),
    intervalHours: String(Math.round(rules.intervalMs / HOUR_MS)),
    graceHours: String(Math.round(rules.graceMs / HOUR_MS)),
    minLevy: String(rules.minLevy),
    dividendEnabled: rules.dividendEnabled,
    dividendPct: String(rules.dividendPct),
  }
}

/**
 * 危机管理端（需 points:manage 能力）。
 *
 * 注意：改比例 / 宽限不会重算已经开轮的账单（应缴额在开轮瞬间冻结），
 * 只有「强制到期」才会按当前资产重新快照 —— 页面上要把这条口径写清楚。
 */
export default function CrisisAdminPage() {
  const [overview, setOverview] = useState<CrisisAdminOverview | null>(null)
  const [form, setForm] = useState<ConfigForm | null>(null)
  const [targetUserId, setTargetUserId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dividendRecord, setDividendRecord] = useState<CrisisDividendRecord | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<CrisisAdminOverview>('/admin/crisis')
      setOverview(data)
      setForm(formOf(data.rules))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取危机总览失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const saveConfig = useCallback(async () => {
    if (!form) return
    const ratio = Number.parseFloat(form.ratioPercent)
    const intervalHours = Number.parseFloat(form.intervalHours)
    const graceHours = Number.parseFloat(form.graceHours)
    const minLevy = Number.parseInt(form.minLevy, 10)
    const dividendPct = Number.parseInt(form.dividendPct, 10)
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 100) {
      setError('征收比例必须是 0–100 之间的百分数')
      return
    }
    if (!Number.isFinite(intervalHours) || intervalHours < 1) {
      setError('缴纳周期至少 1 小时（更短等于持续封锁全站）')
      return
    }
    if (!Number.isFinite(graceHours) || graceHours < 1 / 60) {
      setError('宽限期至少 1 分钟')
      return
    }
    if (!Number.isFinite(minLevy) || minLevy < 0) {
      setError('免征门槛必须是非负整数')
      return
    }
    if (!Number.isFinite(dividendPct) || dividendPct < 0 || dividendPct > 100) {
      setError('分红比例必须是 0–100 之间的整数（0 = 不发放）')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const data = await api.put<{ rules: CrisisAdminOverview['rules'] }>('/admin/crisis/config', {
        enabled: form.enabled,
        ratio: ratio / 100,
        intervalMs: Math.round(intervalHours * HOUR_MS),
        graceMs: Math.round(graceHours * HOUR_MS),
        minLevy,
        dividendEnabled: form.dividendEnabled,
        dividendPct,
      })
      setForm(formOf(data.rules))
      setNotice('参数已保存。已开轮的账单不会重算，需要重征请用「强制到期」。')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存参数失败')
    } finally {
      setBusy(false)
    }
  }, [form, load])

  const forceDue = useCallback(async (all: boolean) => {
    const userId = Number.parseInt(targetUserId, 10)
    if (!all && (!Number.isFinite(userId) || userId <= 0)) {
      setError('请填写有效的用户 ID')
      return
    }
    if (all && !window.confirm('确定要让所有非管理员账号立刻到期？这会按每个人当前的总资产重新快照应缴额。')) {
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (all) {
        const data = await api.post<{ opened: number; skipped: number }>('/admin/crisis/force-due', { all: true })
        setNotice(`全员到期已执行：开轮 ${data.opened} 人，免征 / 跳过 ${data.skipped} 人。`)
      } else {
        const data = await api.post<{ userId: number; state: { required: number } }>('/admin/crisis/force-due', { userId })
        setNotice(`用户 ${data.userId} 已到期，应缴 ${formatCrisisPoints(data.state.required)} 积分。`)
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '强制到期失败')
    } finally {
      setBusy(false)
    }
  }, [load, targetUserId])

  const triggerDividend = useCallback(async () => {
    if (!window.confirm('立即按当前分红比例从公共银行抽积分发给全站用户？手动发放会占用今天的自动分红额度（今天不会再自动发）。')) {
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const data = await api.post<{ record: CrisisDividendRecord }>('/admin/crisis/dividend')
      setDividendRecord(data.record)
      setNotice(
        data.record.skipped
          ? '分红未发放：按当前比例抽取后人均不足 1 分，已记录本次开奖。'
          : `本次分红已发放 ${formatCrisisPoints(data.record.total)} 积分，人均 ${formatCrisisPoints(data.record.perUser)} 积分 × ${data.record.userCount} 人。`,
      )
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '手动分红失败')
    } finally {
      setBusy(false)
    }
  }, [load])

  if (loading && !overview) {    return <div className="gh-page-container"><p className="gh-crisisadmin-muted">正在读取危机总览…</p></div>
  }

  return (
    <div className="gh-page-container">
      <div className="gh-page-header">
        <div>
          <h1 className="gh-page-title">Lineweb 危机</h1>
          <p className="gh-page-subtitle">
            周期性积分回收：每个非管理员账号自上次结清起每 N 小时须向公共银行上缴约总资产一定比例的积分，
            逾期未缴满则全站封锁（仅保留筹钱与查账入口）。管理员豁免。
          </p>
        </div>
        <button type="button" className="gh-btn gh-btn--secondary" onClick={() => void load()} disabled={busy}>
          刷新
        </button>
      </div>

      {error && <div className="gh-alert gh-alert--danger" role="alert">{error}</div>}
      {notice && <div className="gh-alert gh-alert--success" role="status">{notice}</div>}

      {overview && (
        <div className="gh-crisisadmin-stats">
          <div className="gh-crisisadmin-stat">
            <span>公共银行累计</span>
            <strong>{formatCrisisPoints(overview.poolTotal)}</strong>
            <em>缴款 / 税款流入 · 贷款 / 分红流出</em>
          </div>
          <div className="gh-crisisadmin-stat">
            <span>参与征收的账号</span>
            <strong>{overview.totals.users}</strong>
            <em>不含管理员</em>
          </div>
          <div className="gh-crisisadmin-stat">
            <span>本轮待缴</span>
            <strong>{overview.totals.due}</strong>
            <em>已开轮未缴满</em>
          </div>
          <div className="gh-crisisadmin-stat">
            <span>已过宽限</span>
            <strong>{overview.totals.blocked}</strong>
            <em>其中打对局的暂不封锁</em>
          </div>
          <div className="gh-crisisadmin-stat">
            <span>已结清</span>
            <strong>{overview.totals.settled}</strong>
            <em>等待下一轮到期</em>
          </div>
        </div>
      )}

      {form && (
        <section className="gh-box gh-crisisadmin-section">
          <div className="gh-crisisadmin-section-head">
            <h2 className="gh-crisisadmin-title">征收参数</h2>
            <span className="gh-crisisadmin-hint">改这里不会重算已开轮的账单，只对下一轮生效</span>
          </div>
          <div className="gh-crisisadmin-form">
            <label className="gh-crisisadmin-field">
              <span>危机开关</span>
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
              />
            </label>
            <label className="gh-crisisadmin-field">
              <span>征收比例（%）</span>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={form.ratioPercent}
                onChange={(event) => setForm({ ...form, ratioPercent: event.target.value })}
              />
            </label>
            <label className="gh-crisisadmin-field">
              <span>缴纳周期（小时）</span>
              <input
                type="number"
                min={1}
                step={1}
                value={form.intervalHours}
                onChange={(event) => setForm({ ...form, intervalHours: event.target.value })}
              />
            </label>
            <label className="gh-crisisadmin-field">
              <span>宽限期（小时）</span>
              <input
                type="number"
                min={0.02}
                step={0.01}
                value={form.graceHours}
                onChange={(event) => setForm({ ...form, graceHours: event.target.value })}
              />
            </label>
            <label className="gh-crisisadmin-field">
              <span>免征门槛（积分）</span>
              <input
                type="number"
                min={0}
                step={1}
                value={form.minLevy}
                onChange={(event) => setForm({ ...form, minLevy: event.target.value })}
              />
            </label>
            <label className="gh-crisisadmin-field">
              <span>每日自动分红</span>
              <input
                type="checkbox"
                checked={form.dividendEnabled}
                onChange={(event) => setForm({ ...form, dividendEnabled: event.target.checked })}
              />
            </label>
            <label className="gh-crisisadmin-field">
              <span>分红抽取比例（%）</span>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={form.dividendPct}
                onChange={(event) => setForm({ ...form, dividendPct: event.target.value })}
              />
            </label>
            <button type="button" className="gh-btn gh-btn--primary" onClick={() => void saveConfig()} disabled={busy}>
              保存参数
            </button>
          </div>
        </section>
      )}

      <section className="gh-box gh-crisisadmin-section">
        <div className="gh-crisisadmin-section-head">
          <h2 className="gh-crisisadmin-title">公共银行分红</h2>
          <span className="gh-crisisadmin-hint">
            按「分红抽取比例」从现在池子里抽 {overview ? formatCrisisPoints(overview.poolTotal) : '—'} 积分的对应比例，
            人均分给全站 active 用户（含管理员）；手动发放与每日自动分红共用当天额度，一天最多发一次。
          </span>
        </div>
        <div className="gh-crisisadmin-form">
          <button type="button" className="gh-btn gh-btn--primary" onClick={() => void triggerDividend()} disabled={busy}>
            {busy ? '发放中…' : '立即手动发放分红'}
          </button>
          <span className="gh-crisisadmin-muted">
            每次发放全站用户都会看到「本次发放了多少」的弹窗提示。
          </span>
        </div>
        {dividendRecord && (
          <ul className="gh-crisisadmin-debtors gh-crisisadmin-dividend-result">
            <li className="gh-crisisadmin-debtor">
              <span className="gh-crisisadmin-debtor-name">
                {dividendRecord.dateKey} · {dividendRecord.manual ? '管理员手动发放' : '每日自动发放'}
              </span>
              <span className="gh-crisisadmin-muted">比例 {dividendRecord.pct}%</span>
              <span className="gh-crisisadmin-muted">发放 {formatCrisisPoints(dividendRecord.total)}</span>
              <span className="gh-crisisadmin-muted">人均 {formatCrisisPoints(dividendRecord.perUser)}</span>
              <span className="gh-crisisadmin-muted">{dividendRecord.userCount} 人</span>
              {dividendRecord.skipped && <Badge variant="warning">人均不足 1 分</Badge>}
            </li>
          </ul>
        )}
      </section>

      <section className="gh-box gh-crisisadmin-section">
        <div className="gh-crisisadmin-section-head">
          <h2 className="gh-crisisadmin-title">手动触发危机</h2>
          <span className="gh-crisisadmin-hint">按当前总资产立即快照并开新一轮</span>
        </div>
        <div className="gh-crisisadmin-form">
          <label className="gh-crisisadmin-field">
            <span>用户 ID</span>
            <input
              type="number"
              min={1}
              value={targetUserId}
              placeholder="例如 3"
              onChange={(event) => setTargetUserId(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="gh-btn gh-btn--secondary"
            onClick={() => void forceDue(false)}
            disabled={busy || !targetUserId}
          >
            让该用户立刻到期
          </button>
          <button type="button" className="gh-btn gh-btn--danger" onClick={() => void forceDue(true)} disabled={busy}>
            全员立刻到期
          </button>
        </div>
      </section>

      <section className="gh-box gh-crisisadmin-section">
        <div className="gh-crisisadmin-section-head">
          <h2 className="gh-crisisadmin-title">欠费榜（按应缴额）</h2>
          <span className="gh-crisisadmin-hint">最多显示 30 条</span>
        </div>
        {!overview || overview.topDebtors.length === 0 ? (
          <p className="gh-crisisadmin-muted">当前没有待缴账单。</p>
        ) : (
          <ul className="gh-crisisadmin-debtors">
            {overview.topDebtors.map((debtor) => (
              <li key={debtor.userId} className="gh-crisisadmin-debtor">
                <span className="gh-crisisadmin-debtor-name">
                  #{debtor.userId} {debtor.username}
                </span>
                <Badge variant={debtor.blocked ? 'danger' : 'warning'}>
                  {debtor.blocked ? '已逾期' : '宽限内'}
                </Badge>
                <span className="gh-crisisadmin-muted">快照 {formatCrisisPoints(debtor.snapshot)}</span>
                <span className="gh-crisisadmin-muted">应缴 {formatCrisisPoints(debtor.required)}</span>
                <span className="gh-crisisadmin-muted">已缴 {formatCrisisPoints(debtor.paid)}</span>
                <strong className="gh-crisisadmin-remaining">欠 {formatCrisisPoints(debtor.remaining)}</strong>
                <button
                  type="button"
                  className="gh-btn gh-btn--ghost gh-btn--sm"
                  onClick={() => setTargetUserId(String(debtor.userId))}
                >
                  填为用户 ID
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
