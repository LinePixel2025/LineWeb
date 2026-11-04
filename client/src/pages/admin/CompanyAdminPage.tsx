/**
 * 公司管理（管理员，points:manage 能力）
 *
 * 只做三件事：看总览、改公司参数 JSON、强制解散。
 * 参数与危机管理同口径：读旧 → 深合并 → normalize → 保存，缺失字段回退代码默认值。
 */

import { useCallback, useEffect, useState } from 'react'
import api, { ApiError } from '../../lib/api'

interface AdminOverview {
  counts: { total: number; founding: number; active: number; disbanded: number }
  pools: { poolBalance: number; revenue: number; loansOpen: number; loansOverdue: number }
  topRevenue: { id: number; name: string; revenue: number; poolBalance: number; level: number; members: number }[]
  rules: Record<string, unknown>
  shape?: Record<string, unknown>
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export default function CompanyAdminPage() {
  const [data, setData] = useState<AdminOverview | null>(null)
  const [configText, setConfigText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const overview = await api.get<AdminOverview>('/admin/company/overview')
      setData(overview)
      setConfigText(JSON.stringify(overview.rules ?? {}, null, 2))
    } catch (error) {
      setNote({ tone: 'bad', text: errorText(error, '加载公司总览失败') })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const saveConfig = async () => {
    if (busy) return
    setBusy(true)
    try {
      const parsed = JSON.parse(configText) as Record<string, unknown>
      // 服务端 PUT /config 收的是裸配置对象（不是 { config } 包裹），只做形状校验后深合并
      const result = await api.put<{ config: Record<string, unknown> }>('/admin/company/config', parsed)
      setConfigText(JSON.stringify(result.config ?? parsed, null, 2))
      setNote({ tone: 'ok', text: '公司参数已保存' })
      await load()
    } catch (error) {
      setNote({ tone: 'bad', text: errorText(error, '保存失败（JSON 格式也要检查）') })
    } finally {
      setBusy(false)
    }
  }

  const disband = async (id: number, name: string) => {
    if (!window.confirm(`强制解散「${name}」？未售货物会退回捐入者，资金池按人均退回，未结清贷款会被拒绝。`)) return
    try {
      await api.post(`/admin/company/${id}/disband`, {})
      setNote({ tone: 'ok', text: `已解散 ${name}` })
      await load()
    } catch (error) {
      setNote({ tone: 'bad', text: errorText(error, '解散失败') })
    }
  }

  return (
    <div className="gh-page-container gh-company-page">
      <header className="gh-company-hero">
        <div>
          <h1>公司管理</h1>
          <p>总览在营公司、累计营业额与资金池；参数改动立即生效（只影响之后的捐货 / 放贷，不动存量贷款）。</p>
        </div>
        <div className="gh-company-hero-stats">
          <div>
            <span>公司数</span>
            <strong>{data?.counts.total ?? '—'}</strong>
          </div>
          <div>
            <span>运营中</span>
            <strong>{data?.counts.active ?? '—'}</strong>
          </div>
          <div>
            <span>筹建中</span>
            <strong>{data?.counts.founding ?? '—'}</strong>
          </div>
          <div>
            <span>资金池合计</span>
            <strong>{(data?.pools.poolBalance ?? 0).toLocaleString('zh-CN')}</strong>
          </div>
          <div>
            <span>累计营业额</span>
            <strong>{(data?.pools.revenue ?? 0).toLocaleString('zh-CN')}</strong>
          </div>
          <div>
            <span>未结清 / 逾期贷款</span>
            <strong>{data ? `${data.pools.loansOpen} / ${data.pools.loansOverdue}` : '—'}</strong>
          </div>
        </div>
      </header>

      {note && (
        <div className={`gh-company-toast gh-company-toast--${note.tone}`} role="status" aria-live="polite">
          {note.text}
        </div>
      )}

      <section className="gh-company-body">
        <div className="gh-company-card">
          <h2>营业额排行</h2>
          {!data || data.topRevenue.length === 0 ? (
            <p className="gh-company-hint">还没有公司。</p>
          ) : (
            <ul className="gh-company-list">
              {data.topRevenue.map((row) => (
                <li key={row.id}>
                  <div>
                    <strong>{row.name}</strong>
                    <small>
                      Lv.{row.level} · {row.members} 人 · 资金池 {row.poolBalance.toLocaleString('zh-CN')}
                    </small>
                  </div>
                  <div className="gh-company-row-actions">
                    <span className="gh-company-amount">{row.revenue.toLocaleString('zh-CN')}</span>
                    <button
                      type="button"
                      className="gh-btn gh-btn--ghost gh-btn--sm"
                      onClick={() => void disband(row.id, row.name)}
                    >
                      解散
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="gh-company-card">
          <h2>公司参数（JSON）</h2>
          <p className="gh-company-hint">
            priceBandMin / priceBandMax（相对参考价的定价带宽）、loanTierCaps、loanRatePct、loanDueDays、
            donationCaps（按稀有度的单条捐入上限）、restockCaps（每日补货上限）。
          </p>
          <textarea
            className="gh-company-field"
            style={{ minHeight: 220, fontFamily: 'var(--gh-font-mono, monospace)', fontSize: 12 }}
            value={configText}
            spellCheck={false}
            onChange={(event) => setConfigText(event.target.value)}
          />
          <div className="gh-company-row-actions">
            <button type="button" className="gh-btn gh-btn--primary" disabled={busy} onClick={() => void saveConfig()}>
              {busy ? '保存中…' : '保存参数'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
