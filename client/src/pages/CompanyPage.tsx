/**
 * 公司（2026-11-04）
 *
 * 一个页面四件事：成员名册（建司 / 邀请 / 踢人 / 退司 / 解散）、自家货栈（捐入 / 下架）、
 * 全站市场（买别家的货）、资金池贷款（借 / 还）。危机减免不在这里单独操作 ——
 * 营业额的档位一达成，服务端就会把全体成员当期应缴直接下调，页面只展示进度与已生效比例。
 *
 * 口径：所有价格 / 额度 / 减免比例都由服务端算，前端只提交 id 与数量。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api, { ApiError } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import type {
  Company,
  CompanyDetail,
  CompanyDonateOption,
  CompanyListing,
  CompanyLoan,
  CompanyMarket,
  CompanyMe,
  CompanyUser,
} from '../types/company'

type Tab = 'mine' | 'stock' | 'market' | 'loans'

const TABS: readonly { key: Tab; label: string }[] = [
  { key: 'mine', label: '我的公司' },
  { key: 'stock', label: '公司货栈' },
  { key: 'market', label: '市场' },
  { key: 'loans', label: '资金与贷款' },
]

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message
  if (error instanceof Error && error.message) return error.message
  return fallback
}

function points(value: number): string {
  return Math.round(value).toLocaleString('zh-CN')
}

function dateText(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

function durationText(ms: number): string {
  if (ms <= 0) return '已到期'
  const hours = Math.floor(ms / 3_600_000)
  if (hours >= 24) return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`
  if (hours >= 1) return `${hours} 小时`
  return `${Math.max(1, Math.floor(ms / 60_000))} 分钟`
}

export default function CompanyPage() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'mine'
  const [me, setMe] = useState<CompanyMe | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const [candidates, setCandidates] = useState<CompanyUser[]>([])
  const [companyName, setCompanyName] = useState('')
  const [pickedInvitees, setPickedInvitees] = useState<number[]>([])

  const [donateTarget, setDonateTarget] = useState<CompanyDonateOption | null>(null)
  const [donateAmount, setDonateAmount] = useState(1)
  const [donatePrice, setDonatePrice] = useState(0)

  const [market, setMarket] = useState<CompanyMarket | null>(null)
  const [marketQuery, setMarketQuery] = useState('')
  const [marketSource, setMarketSource] = useState<'' | 'farm_seed' | 'raid_item'>('')
  const [buyTarget, setBuyTarget] = useState<CompanyListing | null>(null)
  const [buyAmount, setBuyAmount] = useState(1)

  const [borrowAmount, setBorrowAmount] = useState('')
  const [investAmount, setInvestAmount] = useState('')
  const [redeemAmount, setRedeemAmount] = useState('')
  /** CEO 放贷设置草稿：随服务端数据加载对齐，保存时整体提交（0 = 跟随全站） */
  const [loanSettingsDraft, setLoanSettingsDraft] = useState({ enabled: true, ratePct: 0, maxPrincipal: 0, dueDays: 0, membersOnly: false })
  const [detail, setDetail] = useState<CompanyDetail | null>(null)

  const notify = useCallback((tone: 'ok' | 'bad', text: string) => {
    setToast({ tone, text })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const loadMe = useCallback(async () => {
    try {
      const data = await api.get<CompanyMe>('/company/me')
      setMe(data)
    } catch (error) {
      notify('bad', errorText(error, '公司信息加载失败'))
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    void loadMe()
  }, [loadMe])

  const loadCandidates = useCallback(async () => {
    try {
      const data = await api.get<{ candidates: CompanyUser[] }>('/company/candidates')
      setCandidates(data.candidates ?? [])
    } catch {
      setCandidates([])
    }
  }, [])

  const loadMarket = useCallback(async () => {
    try {
      const search = new URLSearchParams()
      if (marketQuery.trim()) search.set('q', marketQuery.trim())
      if (marketSource) search.set('source', marketSource)
      search.set('pageSize', '40')
      const data = await api.get<CompanyMarket>(`/company/market?${search.toString()}`)
      setMarket(data)
    } catch (error) {
      notify('bad', errorText(error, '市场加载失败'))
    }
  }, [marketQuery, marketSource, notify])

  useEffect(() => {
    if (tab === 'market') void loadMarket()
    if (tab === 'stock' || tab === 'mine') void loadCandidates()
    if (tab === 'mine' && me?.company) {
      void api.get<CompanyDetail>(`/company/${me.company.id}`).then(setDetail).catch(() => setDetail(null))
    }
  }, [tab, loadMarket, loadCandidates, me?.company])

  const run = useCallback(async (label: string, action: () => Promise<string>) => {
    if (busy) return
    setBusy(true)
    try {
      const message = await action()
      notify('ok', message)
      await loadMe()
    } catch (error) {
      notify('bad', errorText(error, `${label}失败`))
    } finally {
      setBusy(false)
    }
  }, [busy, loadMe, notify])

  const company = me?.company ?? null
  const isCeo = me?.myRole === 'ceo'
  const myShare = company?.myPoolInvestment?.amount ?? 0

  // 放贷设置草稿与服务端对齐：首次加载、每次动作后 loadMe 都会重置成最新生效值
  useEffect(() => {
    const settings = company?.loanSettings
    if (settings) {
      setLoanSettingsDraft({
        enabled: settings.enabled,
        ratePct: settings.ratePct,
        maxPrincipal: settings.maxPrincipal,
        dueDays: settings.dueDays,
        membersOnly: settings.membersOnly,
      })
    }
  }, [company?.id, company?.loanSettings])

  const selectedInvitees = useMemo(
    () => pickedInvitees.filter((id) => candidates.some((candidate) => candidate.id === id)),
    [pickedInvitees, candidates],
  )

  const toggleInvitee = (id: number) => {
    setPickedInvitees((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]).slice(0, 2))
  }

  const createCompany = () => {
    void run('创建公司', async () => {
      await api.post('/company', { name: companyName.trim(), invitees: selectedInvitees })
      setCompanyName('')
      setPickedInvitees([])
      return '公司已发起：两位好友接受邀请后就正式成立'
    })
  }

  const respondInvite = (inviteId: number, accept: boolean) => {
    void run(accept ? '接受邀请' : '拒绝邀请', async () => {
      await api.post('/company/invite/respond', { inviteId, accept })
      return accept ? '已入司' : '已拒绝邀请'
    })
  }

  const openDonate = (option: CompanyDonateOption) => {
    setDonateTarget(option)
    setDonateAmount(1)
    setDonatePrice(option.referencePrice)
  }

  const submitDonate = () => {
    if (!donateTarget) return
    void run('捐入货栈', async () => {
      await api.post('/company/donate', {
        source: donateTarget.source,
        itemKey: donateTarget.itemKey,
        amount: donateAmount,
        unitPrice: donatePrice,
      })
      setDonateTarget(null)
      return `已捐入 ${donateTarget.itemName} ×${donateAmount}，成交后全额进公司资金池`
    })
  }

  const submitBuy = () => {
    if (!buyTarget) return
    void run('购买', async () => {
      const result = await api.post<{ spent: number; total: number }>('/company/market/buy', {
        listingId: buyTarget.id,
        amount: buyAmount,
      })
      setBuyTarget(null)
      setMarket(null)
      await loadMarket()
      return `已买下 ${buyTarget.itemName} ×${buyAmount}（-${points(result.spent ?? result.total ?? 0)} 积分）`
    })
  }

  const submitBorrow = () => {
    const amount = Number.parseInt(borrowAmount, 10)
    if (!Number.isFinite(amount) || amount <= 0) {
      notify('bad', '请输入要借的积分数')
      return
    }
    void run('借款', async () => {
      await api.post('/company/loan/borrow', { amount })
      setBorrowAmount('')
      return `已从资金池借出 ${points(amount)} 积分`
    })
  }

  const repay = (loan: CompanyLoan) => {
    void run('还款', async () => {
      await api.post('/company/loan/repay', { loanId: loan.id })
      return `已结清 ${points(loan.remaining)} 积分`
    })
  }

  const submitInvest = () => {
    const amount = Number.parseInt(investAmount, 10)
    if (!Number.isFinite(amount) || amount < 100) {
      notify('bad', '单次至少投入 100 积分')
      return
    }
    void run('投入资金池', async () => {
      const result = await api.post<{ invested: number; balance: number }>('/company/pool/invest', { amount })
      setInvestAmount('')
      return `已投入 ${points(amount)} 积分，当前份额 ${points(result.invested)}`
    })
  }

  const submitRedeem = () => {
    const amount = Number.parseInt(redeemAmount, 10)
    if (!Number.isFinite(amount) || amount <= 0) {
      notify('bad', '请输入要赎回的积分数')
      return
    }
    void run('赎回份额', async () => {
      const result = await api.post<{ invested: number; balance: number }>('/company/pool/redeem', { amount })
      setRedeemAmount('')
      return `已赎回 ${points(amount)} 积分，剩余份额 ${points(result.invested)}`
    })
  }

  const saveLoanSettings = () => {
    void run('保存放贷设置', async () => {
      await api.put('/company/loan/settings', loanSettingsDraft)
      return '放贷设置已保存'
    })
  }

  /** 放贷设置数值输入：只留数字并夹进区间（0 = 跟随全站的哨兵值） */
  const patchLoanSettings = (patch: Partial<typeof loanSettingsDraft>) => {
    setLoanSettingsDraft((prev) => ({ ...prev, ...patch }))
  }

  const parseIntInput = (raw: string): number => {
    const digits = raw.replace(/[^\d]/g, '')
    if (!digits) return 0
    return Number.parseInt(digits, 10) || 0
  }

  return (
    <div className="gh-page-container gh-company-page">
      <header className="gh-company-hero">
        <div>
          <h1>公司</h1>
          <p>
            3–7 人的组织：把农场种子与搜打撤战利品捐进公司货栈对外销售，营业额会进资金池，
            也能给成员放贷。营业额达标后，全体成员当期的 Lineweb 危机应缴会被直接下调。
          </p>
        </div>
        <div className="gh-company-hero-stats">
          <div>
            <span>我的公司</span>
            <strong>{company ? company.name : '未加入'}</strong>
          </div>
          <div>
            <span>资金池</span>
            <strong>{company ? points(company.poolBalance) : '—'}</strong>
          </div>
          <div>
            <span>累计营业额</span>
            <strong>{company ? points(company.revenue) : '—'}</strong>
          </div>
        </div>
      </header>

      <nav className="gh-company-tabs" aria-label="公司分区">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`gh-company-tab${tab === item.key ? ' gh-company-tab--active' : ''}`}
            aria-current={tab === item.key ? 'page' : undefined}
            onClick={() => setParams(item.key === 'mine' ? {} : { tab: item.key })}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {loading ? (
        <div className="gh-company-empty">正在打开公司档案…</div>
      ) : (
        <>
          {/* ---------------- 我的公司 ---------------- */}
          {tab === 'mine' && (
            <section className="gh-company-body">
              {me && me.invitesReceived.length > 0 && (
                <div className="gh-company-card">
                  <h2>收到的入司邀请</h2>
                  <ul className="gh-company-list">
                    {me.invitesReceived.map((invite) => (
                      <li key={invite.id}>
                        <div>
                          <strong>{invite.companyName}</strong>
                          <small>{invite.inviter.username} 邀请你加入</small>
                        </div>
                        <div className="gh-company-row-actions">
                          <button type="button" className="gh-btn gh-btn--primary gh-btn--sm" disabled={busy} onClick={() => respondInvite(invite.id, true)}>
                            接受
                          </button>
                          <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" disabled={busy} onClick={() => respondInvite(invite.id, false)}>
                            拒绝
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!company ? (
                <div className="gh-company-card">
                  <h2>发起一家公司</h2>
                  <p className="gh-company-hint">
                    需要恰好 {me?.limits.minMembers ?? 3} 人起步：你先拉两位好友，他们接受后公司正式成立；
                    上限 {me?.limits.maxMembers ?? 7} 人。7 天内凑不满 3 人会自动作废。
                  </p>
                  <label className="gh-company-field">
                    <span>公司名（2–12 字，全站唯一）</span>
                    <input
                      value={companyName}
                      maxLength={30}
                      placeholder="例如：深空物流"
                      onChange={(event) => setCompanyName(event.target.value)}
                    />
                  </label>
                  <fieldset className="gh-company-fieldset">
                    <legend>选择两位好友（已选 {selectedInvitees.length}/2）</legend>
                    {candidates.length === 0 ? (
                      <p className="gh-company-hint">还没有可邀请的好友，先去聊天页加几个好友吧。</p>
                    ) : (
                      <div className="gh-company-chips">
                        {candidates.map((candidate) => (
                          <button
                            key={candidate.id}
                            type="button"
                            className={`gh-company-chip${selectedInvitees.includes(candidate.id) ? ' gh-company-chip--on' : ''}`}
                            onClick={() => toggleInvitee(candidate.id)}
                          >
                            {candidate.username}
                          </button>
                        ))}
                      </div>
                    )}
                  </fieldset>
                  <button
                    type="button"
                    className="gh-btn gh-btn--primary"
                    disabled={busy || !companyName.trim() || selectedInvitees.length !== 2}
                    onClick={createCompany}
                  >
                    发起公司
                  </button>
                </div>
              ) : (
                <>
                  <div className="gh-company-card">
                    <h2>{company.name}</h2>
                    <div className="gh-company-meta">
                      <span>等级 {company.level}</span>
                      <span>{company.memberCount}/{company.maxMembers} 人</span>
                      <span>状态 {company.status === 'founding' ? '筹建中' : company.status === 'active' ? '运营中' : '已解散'}</span>
                      <span>创建于 {dateText(company.createdAt)}</span>
                    </div>
                    <div className="gh-company-progress">
                      <div className="gh-company-progress-head">
                        <span>危机减免：当前 {company.tier.reductionPct}%</span>
                        <span>
                          {company.tier.next
                            ? `距下一档（再销 ${points(company.tier.next.remaining)}）解锁 ${company.tier.next.reductionPct}%`
                            : '已达最高档'}
                        </span>
                      </div>
                      <div className="gh-company-progress-bar">
                        <span
                          style={{
                            width: `${company.tier.next
                              ? Math.min(100, Math.round((company.revenue / company.tier.next.threshold) * 100))
                              : 100}%`,
                          }}
                        />
                      </div>
                    </div>
                    {company.status === 'founding' && company.foundingRemainingMs > 0 && (
                      <p className="gh-company-hint">
                        筹建剩余 {durationText(company.foundingRemainingMs)}：还需凑满 3 人，否则公司作废。
                      </p>
                    )}
                  </div>

                  <div className="gh-company-card">
                    <h2>成员</h2>
                    <ul className="gh-company-list">
                      {company.members.map((member) => (
                        <li key={member.id}>
                          <div>
                            <strong>
                              {member.username}
                              {member.isMe ? '（我）' : ''}
                            </strong>
                            <small>
                              {member.role === 'ceo' ? '发起人' : '成员'} · 加入于 {dateText(member.joinedAt)}
                              {member.outstanding > 0 ? ` · 未还 ${points(member.outstanding)}` : ''}
                            </small>
                          </div>
                          {isCeo && member.role !== 'ceo' && (
                            <button
                              type="button"
                              className="gh-btn gh-btn--ghost gh-btn--sm"
                              disabled={busy}
                              onClick={() => void run('踢出成员', async () => {
                                await api.post('/company/kick', { userId: member.id })
                                return `已把 ${member.username} 移出公司（欠款仍要还）`
                              })}
                            >
                              踢出
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                    <div className="gh-company-row-actions">
                      {!isCeo && (
                        <button
                          type="button"
                          className="gh-btn gh-btn--secondary gh-btn--sm"
                          disabled={busy}
                          onClick={() => void run('退司', async () => {
                            await api.post('/company/leave')
                            return '已退出公司'
                          })}
                        >
                          退出公司
                        </button>
                      )}
                      {isCeo && (
                        <button
                          type="button"
                          className="gh-btn gh-btn--ghost gh-btn--sm"
                          disabled={busy}
                          onClick={() => {
                            if (!window.confirm('解散后未售出的货物会退回捐入者，资金池按人均退回。确定解散吗？')) return
                            void run('解散', async () => {
                              await api.post('/company/disband', {})
                              return '公司已解散并清算'
                            })
                          }}
                        >
                          解散公司
                        </button>
                      )}
                    </div>
                    {company.memberCount < company.maxMembers && (
                      <div className="gh-company-invite">
                        <h3>邀请好友加入</h3>
                        <div className="gh-company-chips">
                          {candidates.map((candidate) => (
                            <button
                              key={candidate.id}
                              type="button"
                              className="gh-company-chip"
                              disabled={busy}
                              onClick={() => void run('邀请', async () => {
                                await api.post('/company/invite', { userId: candidate.id })
                                return `已邀请 ${candidate.username}`
                              })}
                            >
                              + {candidate.username}
                            </button>
                          ))}
                          {candidates.length === 0 && <span className="gh-company-hint">暂无可邀请的好友</span>}
                        </div>
                      </div>
                    )}
                  </div>

                  {detail && detail.recentOrders.length > 0 && (
                    <div className="gh-company-card">
                      <h2>最近成交</h2>
                      <ul className="gh-company-list">
                        {detail.recentOrders.slice(0, 8).map((order) => (
                          <li key={order.id}>
                            <div>
                              <strong>{order.itemName} ×{order.amount}</strong>
                              <small>{order.buyer.username} · {dateText(order.createdAt)}</small>
                            </div>
                            <span className="gh-company-amount">+{points(order.total)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {/* ---------------- 公司货栈 ---------------- */}
          {tab === 'stock' && (
            <section className="gh-company-body">
              {!company ? (
                <div className="gh-company-empty">先成立或加入一家公司，才能开货栈。</div>
              ) : (
                <>
                  <div className="gh-company-card">
                    <h2>捐入货栈</h2>
                    <p className="gh-company-hint">
                      捐入即从你的仓库 / 农场里实物扣除（托管），卖出后积分全额进公司资金池并计入营业额。
                      每个档位有单条上限与每日补货上限，所以货栈不是无限的。
                    </p>
                    <div className="gh-company-grid">
                      {(me?.donateOptions ?? []).map((option) => (
                        <button
                          key={`${option.source}:${option.itemKey}`}
                          type="button"
                          className="gh-company-tile"
                          disabled={busy || option.owned < 1 || option.restockLeft < 1}
                          onClick={() => openDonate(option)}
                        >
                          <span aria-hidden>{option.emoji}</span>
                          <strong>{option.itemName}</strong>
                          <small>
                            {option.source === 'farm_seed' ? '种子' : '搜打撤'} · {option.rarityLabel} ·
                            持有 {option.owned} · 今日可捐 {option.restockLeft}
                          </small>
                          <small>参考价 {points(option.referencePrice)} 积分</small>
                        </button>
                      ))}
                      {(me?.donateOptions ?? []).length === 0 && (
                        <p className="gh-company-hint">仓库和农场里暂时没有可捐的东西。</p>
                      )}
                    </div>
                  </div>

                  <div className="gh-company-card">
                    <h2>在架条目</h2>
                    {me && me.listings.length === 0 ? (
                      <p className="gh-company-hint">货栈还空着，先捐点货进来。</p>
                    ) : (
                      <ul className="gh-company-list">
                        {(me?.listings ?? []).map((listing) => (
                          <li key={listing.id}>
                            <div>
                              <strong>{listing.emoji} {listing.itemName} ×{listing.available}</strong>
                              <small>
                                {points(listing.unitPrice)} 积分/件 · 已售 {listing.soldAmount}/{listing.amount} ·
                                捐入者 {listing.donor.username}
                              </small>
                            </div>
                            {isCeo && (
                              <button
                                type="button"
                                className="gh-btn gh-btn--ghost gh-btn--sm"
                                disabled={busy}
                                onClick={() => void run('下架', async () => {
                                  await api.post('/company/listing/withdraw', { listingId: listing.id })
                                  return '已下架，未售出的部分退回捐入者'
                                })}
                              >
                                下架
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </section>
          )}

          {/* ---------------- 市场 ---------------- */}
          {tab === 'market' && (
            <section className="gh-company-body">
              <div className="gh-company-card">
                <h2>全站货栈</h2>
                <div className="gh-company-filters">
                  <input
                    value={marketQuery}
                    placeholder="搜物品名"
                    maxLength={24}
                    onChange={(event) => setMarketQuery(event.target.value)}
                  />
                  <select
                    value={marketSource}
                    onChange={(event) => setMarketSource(event.target.value as '' | 'farm_seed' | 'raid_item')}
                  >
                    <option value="">全部来源</option>
                    <option value="farm_seed">农场种子</option>
                    <option value="raid_item">搜打撤物品</option>
                  </select>
                  <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={() => void loadMarket()}>
                    刷新
                  </button>
                </div>
                {!market ? (
                  <p className="gh-company-hint">正在加载货架…</p>
                ) : market.listings.length === 0 ? (
                  <p className="gh-company-hint">暂时没有在售条目。</p>
                ) : (
                  <ul className="gh-company-list">
                    {market.listings.map((listing) => (
                      <li key={listing.id}>
                        <div>
                          <strong>{listing.emoji} {listing.itemName} ×{listing.available}</strong>
                          <small>
                            {listing.companyName} · {points(listing.unitPrice)} 积分/件 ·
                            {listing.source === 'farm_seed' ? ' 种子' : ' 搜打撤'} · {listing.rarityLabel}
                          </small>
                        </div>
                        <button
                          type="button"
                          className="gh-btn gh-btn--primary gh-btn--sm"
                          disabled={busy || listing.isMine}
                          title={listing.isMine ? '不能买自家货栈的东西' : '买下'}
                          onClick={() => {
                            setBuyTarget(listing)
                            setBuyAmount(1)
                          }}
                        >
                          {listing.isMine ? '自家条目' : '购买'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          {/* ---------------- 资金与贷款 ---------------- */}
          {tab === 'loans' && (
            <section className="gh-company-body">
              {!company ? (
                <div className="gh-company-empty">加入公司后才能使用资金池贷款。</div>
              ) : (
                <>
                  <div className="gh-company-card">
                    <h2>资金池</h2>
                    <div className="gh-company-meta">
                      <span>池内余额 {points(company.poolBalance)}</span>
                      <span>等级 {me?.loanSummary?.level ?? company.level}</span>
                      <span>单人额度上限 {points(me?.loanSummary?.cap ?? 0)}</span>
                      <span>利率 {me?.loanSummary?.ratePct ?? 0}% / {me?.loanSummary?.dueDays ?? 7} 天</span>
                    </div>
                    <div className="gh-company-borrow">
                      <input
                        value={borrowAmount}
                        inputMode="numeric"
                        placeholder={`可借 ${points(me?.loanSummary?.remaining ?? 0)}`}
                        onChange={(event) => setBorrowAmount(event.target.value.replace(/[^\d]/g, ''))}
                      />
                      <button
                        type="button"
                        className="gh-btn gh-btn--primary"
                        disabled={busy || !company.loanSettings.enabled || (me?.loanSummary?.remaining ?? 0) <= 0 || me?.loanSummary?.blockedByOverdue}
                        onClick={submitBorrow}
                      >
                        借款
                      </button>
                    </div>
                    {!company.loanSettings.enabled && (
                      <p className="gh-company-hint gh-company-hint--bad">CEO 已关闭本公司放贷，恢复前谁都借不了。</p>
                    )}
                    {me?.loanSummary?.blockedByOverdue && (
                      <p className="gh-company-hint gh-company-hint--bad">有逾期未还的贷款，先把逾期结清才能再借。</p>
                    )}
                    <p className="gh-company-hint">
                      利息在放款时一次算死，还款时本金与利息都回流公司资金池 —— 相当于全公司在补贴自己的资金成本。
                    </p>
                  </div>

                  <div className="gh-company-card">
                    <h2>资金池投资</h2>
                    <p className="gh-company-hint">
                      把积分投进资金池给全公司放贷用：每笔贷款结清时，利息按持有份额自动并入你的份额。
                      赎回受池子流动性限制 —— 钱都贷出去时要等还款回流。公司解散时投资份额优先全额发还。
                    </p>
                    <div className="gh-company-meta">
                      <span>我的份额 {points(myShare)}</span>
                      <span>累计利息 {points(company.myPoolInvestment?.earned ?? 0)}</span>
                      <span>池内余额 {points(company.poolBalance)}</span>
                    </div>
                    <div className="gh-company-borrow">
                      <input
                        value={investAmount}
                        inputMode="numeric"
                        placeholder="单次 ≥100 积分"
                        onChange={(event) => setInvestAmount(event.target.value.replace(/[^\d]/g, ''))}
                      />
                      <button type="button" className="gh-btn gh-btn--primary" disabled={busy} onClick={submitInvest}>
                        投入
                      </button>
                    </div>
                    <div className="gh-company-borrow">
                      <input
                        value={redeemAmount}
                        inputMode="numeric"
                        placeholder={`可赎回 ${points(myShare)}`}
                        onChange={(event) => setRedeemAmount(event.target.value.replace(/[^\d]/g, ''))}
                      />
                      <button type="button" className="gh-btn gh-btn--secondary" disabled={busy || myShare <= 0} onClick={submitRedeem}>
                        赎回
                      </button>
                    </div>
                  </div>

                  {isCeo && (
                    <div className="gh-company-card">
                      <h2>放贷设置（CEO）</h2>
                      <p className="gh-company-hint">
                        数值填 0 表示跟随全站档位（0 不是免息、也不是禁借）。
                        开关只管本公司：关闭后本司成员与外人都借不了；「仅成员可借」开启后外人无法向本公司借款。
                      </p>
                      <div className="gh-company-meta">
                        <button
                          type="button"
                          className={`gh-company-chip${loanSettingsDraft.enabled ? ' gh-company-chip--on' : ''}`}
                          aria-pressed={loanSettingsDraft.enabled}
                          onClick={() => patchLoanSettings({ enabled: !loanSettingsDraft.enabled })}
                        >
                          {loanSettingsDraft.enabled ? '开放放贷' : '已关闭放贷'}
                        </button>
                        <button
                          type="button"
                          className={`gh-company-chip${loanSettingsDraft.membersOnly ? ' gh-company-chip--on' : ''}`}
                          aria-pressed={loanSettingsDraft.membersOnly}
                          onClick={() => patchLoanSettings({ membersOnly: !loanSettingsDraft.membersOnly })}
                        >
                          {loanSettingsDraft.membersOnly ? '仅成员可借' : '对外放贷'}
                        </button>
                      </div>
                      <label className="gh-company-field">
                        <span>整期利率 %（0–20，0 = 跟随全站档位）</span>
                        <input
                          value={String(loanSettingsDraft.ratePct)}
                          inputMode="numeric"
                          onChange={(event) => patchLoanSettings({ ratePct: Math.min(20, parseIntInput(event.target.value)) })}
                        />
                      </label>
                      <label className="gh-company-field">
                        <span>单笔上限积分（0 = 按公司等级额度）</span>
                        <input
                          value={String(loanSettingsDraft.maxPrincipal)}
                          inputMode="numeric"
                          onChange={(event) => patchLoanSettings({ maxPrincipal: Math.min(10_000_000, parseIntInput(event.target.value)) })}
                        />
                      </label>
                      <label className="gh-company-field">
                        <span>借款期限天（0 = 跟随全站默认，1–90）</span>
                        <input
                          value={String(loanSettingsDraft.dueDays)}
                          inputMode="numeric"
                          onChange={(event) => patchLoanSettings({ dueDays: Math.min(90, parseIntInput(event.target.value)) })}
                        />
                      </label>
                      <button type="button" className="gh-btn gh-btn--primary" disabled={busy} onClick={saveLoanSettings}>
                        保存设置
                      </button>
                    </div>
                  )}

                  <div className="gh-company-card">
                    <h2>我的贷款</h2>
                    {(me?.loans ?? []).length === 0 ? (
                      <p className="gh-company-hint">没有未结清的贷款。</p>
                    ) : (
                      <ul className="gh-company-list">
                        {(me?.loans ?? []).map((loan) => (
                          <li key={loan.id}>
                            <div>
                              <strong>
                                本金 {points(loan.principal)} · 应还 {points(loan.dueAmount)}
                              </strong>
                              <small>
                                {loan.companyName} · {loan.ratePct}% / {loan.dueDays} 天 ·
                                到期 {dateText(loan.dueAt)} · 未还 {points(loan.remaining)}
                              </small>
                            </div>
                            <div className="gh-company-row-actions">
                              <span className={`gh-company-tag${loan.status === 'overdue' ? ' gh-company-tag--bad' : ''}`}>
                                {loan.status === 'repaid' ? '已还清' : loan.status === 'overdue' ? '已逾期' : `剩 ${durationText(loan.msUntilDue)}`}
                              </span>
                              {loan.status !== 'repaid' && (
                                <button type="button" className="gh-btn gh-btn--primary gh-btn--sm" disabled={busy} onClick={() => repay(loan)}>
                                  一次还清
                                </button>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <p className="gh-company-hint">
                    想知道减免什么时候生效？去 <Link to="/crisis">Lineweb 危机</Link> 看当期账单：
                    公司达成档位后，全体成员的应缴会在下一次开轮或成交时自动下调。
                  </p>
                </>
              )}
            </section>
          )}
        </>
      )}

      {/* ---------------- 捐入对话框 ---------------- */}
      {donateTarget && (
        <div className="gh-dialog-overlay" role="dialog" aria-modal="true" aria-label="捐入公司货栈">
          <div className="gh-dialog gh-company-dialog">
            <h2 className="gh-dialog-title">捐入 {donateTarget.emoji} {donateTarget.itemName}</h2>
            <p className="gh-company-hint">
              单条上限 {donateTarget.donationCap} 件 · 今日还剩 {donateTarget.restockLeft} 件额度 ·
              参考价 {points(donateTarget.referencePrice)} 积分
            </p>
            <label className="gh-company-field">
              <span>数量（持有 {donateTarget.owned}）</span>
              <input
                value={String(donateAmount)}
                inputMode="numeric"
                onChange={(event) => setDonateAmount(Math.max(1, Number.parseInt(event.target.value.replace(/[^\d]/g, '') || '1', 10)))}
              />
            </label>
            <label className="gh-company-field">
              <span>公司定价（每件积分）</span>
              <input
                value={String(donatePrice)}
                inputMode="numeric"
                onChange={(event) => setDonatePrice(Math.max(1, Number.parseInt(event.target.value.replace(/[^\d]/g, '') || '1', 10)))}
              />
            </label>
            <div className="gh-dialog-actions">
              <button type="button" className="gh-btn gh-btn--ghost" onClick={() => setDonateTarget(null)}>取消</button>
              <button type="button" className="gh-btn gh-btn--primary" disabled={busy} onClick={submitDonate}>
                确认捐入（预计入池 {points(donateAmount * donatePrice)}）
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- 购买对话框 ---------------- */}
      {buyTarget && (
        <div className="gh-dialog-overlay" role="dialog" aria-modal="true" aria-label="购买货栈物品">
          <div className="gh-dialog gh-company-dialog">
            <h2 className="gh-dialog-title">购买 {buyTarget.emoji} {buyTarget.itemName}</h2>
            <p className="gh-company-hint">
              {buyTarget.companyName} · {points(buyTarget.unitPrice)} 积分/件 · 在架 {buyTarget.available} 件
            </p>
            <label className="gh-company-field">
              <span>数量</span>
              <input
                value={String(buyAmount)}
                inputMode="numeric"
                onChange={(event) => setBuyAmount(
                  Math.min(buyTarget.available, Math.max(1, Number.parseInt(event.target.value.replace(/[^\d]/g, '') || '1', 10))),
                )}
              />
            </label>
            <div className="gh-dialog-actions">
              <button type="button" className="gh-btn gh-btn--ghost" onClick={() => setBuyTarget(null)}>取消</button>
              <button type="button" className="gh-btn gh-btn--primary" disabled={busy} onClick={submitBuy}>
                确认购买（{points(buyAmount * buyTarget.unitPrice)} 积分）
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`gh-company-toast gh-company-toast--${toast.tone}`} role="status" aria-live="polite">
          {toast.text}
        </div>
      )}

      {!user && <div className="gh-company-empty">登录后才能使用公司功能。</div>}
    </div>
  )
}
