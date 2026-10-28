import { useCallback, useEffect, useState } from 'react'
import { GitHubAlert, GitHubBadge, GitHubButton, GitHubInput } from '../../components/ui'
import {
  webProxyAdminApi,
  type ProxyAdminOverview,
  type ProxyAdminUser,
  type ProxyBlacklistEntry,
  type ProxyStatsResponse,
} from '../../lib/webProxy'

/**
 * 网页反代管理（/admin/proxy）
 *
 * 三块能力：
 *  1. 黑名单：命中后禁止新建站点与转发请求（HTTP / 媒体 / WebSocket 全覆盖）
 *  2. 访问统计：按站点 / 账号排名 + 每日趋势（服务端每 15 秒批量落库）
 *  3. 排队赦免：被豁免的账号不占用反代并发闸门（管理员本身天然豁免）
 */

type Tab = 'stats' | 'blacklist' | 'exempt'

const DAY_OPTIONS = [1, 7, 30, 90]

const numberFormat = new Intl.NumberFormat('zh-CN')

function formatNumber(value: number | null | undefined): string {
  return numberFormat.format(value ?? 0)
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', { hour12: false })
}

const cardStyle: React.CSSProperties = {
  flex: '1 1 140px',
  minWidth: 130,
  padding: 'var(--gh-space-4)',
  border: '1px solid var(--gh-border)',
  borderRadius: 'var(--gh-radius-lg)',
  background: 'var(--gh-canvas-subtle)',
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 'var(--gh-text-sm)',
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '1px solid var(--gh-border)',
  color: 'var(--gh-text-secondary)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--gh-border-muted)',
  verticalAlign: 'top',
}

const CHART_HEIGHT = 112

interface TrendPoint {
  day: string
  requests: number
  errors: number
}

function formatPercent(part: number, total: number): string {
  if (!total) return '0%'
  const ratio = part / total
  return `${(ratio * 100).toFixed(ratio >= 0.1 ? 0 : 1)}%`
}

/**
 * 访问趋势图：按天画柱，失败请求叠在柱顶（红色）。
 * 服务端已把窗口内没有访问的日子补成 0，所以「近 7 / 30 / 90 天」始终是等距的 N 根柱子。
 */
function ProxyTrendChart({ data }: { data: TrendPoint[] }) {
  const max = Math.max(1, ...data.map((item) => item.requests))
  const total = data.reduce((sum, item) => sum + item.requests, 0)
  const errors = data.reduce((sum, item) => sum + item.errors, 0)
  const peak = data.reduce<TrendPoint | null>(
    (best, item) => (!best || item.requests > best.requests ? item : best),
    null,
  )
  // 柱子太多时按间隔显示日期，避免标签重叠
  const labelStep = data.length <= 7 ? 1 : data.length <= 30 ? 5 : 15
  const barMinWidth = data.length <= 7 ? 24 : data.length <= 30 ? 14 : 8

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--gh-space-3)', flexWrap: 'wrap', marginTop: 'var(--gh-space-3)' }}>
        <span className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-sm)' }}>
          近 {data.length} 天累计 {formatNumber(total)} 次请求
          {errors > 0 && ` · 失败 ${formatNumber(errors)}（${formatPercent(errors, total)}）`}
          {peak && peak.requests > 0 && ` · 峰值 ${formatNumber(peak.requests)} 次（${peak.day.slice(5)}）`}
        </span>
        <span className="gh-text-tertiary" style={{ display: 'flex', gap: 12, fontSize: 'var(--gh-text-xs)' }}>
          <span>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--gh-accent)', marginRight: 4 }} />
            成功
          </span>
          <span>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--gh-danger)', marginRight: 4 }} />
            失败
          </span>
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: data.length > 30 ? 3 : 8, marginTop: 'var(--gh-space-3)', overflowX: 'auto', paddingBottom: 2 }}>
        {data.map((item, index) => {
          const totalHeight = item.requests > 0 ? Math.max(3, (item.requests / max) * CHART_HEIGHT) : 0
          const errorHeight = item.requests > 0
            ? Math.min(totalHeight, Math.max(item.errors > 0 ? 2 : 0, (item.errors / max) * CHART_HEIGHT))
            : 0
          const successHeight = Math.max(0, totalHeight - errorHeight)
          const showLabel = index % labelStep === 0 || index === data.length - 1
          return (
            <div
              key={item.day}
              title={`${item.day}：请求 ${formatNumber(item.requests)} 次，失败 ${formatNumber(item.errors)} 次`}
              style={{
                flex: '1 0 auto',
                minWidth: barMinWidth,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <div style={{ width: '100%', height: CHART_HEIGHT, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', borderRadius: 3, overflow: 'hidden' }}>
                {item.requests === 0 ? (
                  <div style={{ height: 2, borderRadius: 1, background: 'var(--gh-border-muted)' }} />
                ) : (
                  <>
                    {errorHeight > 0 && <div style={{ height: errorHeight, background: 'var(--gh-danger)', opacity: 0.9 }} />}
                    <div style={{ height: successHeight, background: 'var(--gh-accent)', opacity: 0.85 }} />
                  </>
                )}
              </div>
              <span className="gh-text-tertiary" style={{ fontSize: 10, whiteSpace: 'nowrap', visibility: showLabel ? 'visible' : 'hidden' }}>
                {item.day.slice(5)}
              </span>
            </div>
          )
        })}
      </div>

      {total === 0 && (
        <p className="gh-text-tertiary" style={{ marginTop: 'var(--gh-space-2)', fontSize: 'var(--gh-text-sm)' }}>
          这段时间还没有反代访问记录。
        </p>
      )}
    </div>
  )
}

export default function ProxyAdminPage() {
  const [tab, setTab] = useState<Tab>('stats')
  const [overview, setOverview] = useState<ProxyAdminOverview | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  // 黑名单
  const [entries, setEntries] = useState<ProxyBlacklistEntry[]>([])
  const [pattern, setPattern] = useState('')
  const [reason, setReason] = useState('')

  // 统计
  const [days, setDays] = useState(7)
  const [stats, setStats] = useState<ProxyStatsResponse | null>(null)

  // 排队赦免
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<ProxyAdminUser[]>([])

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await webProxyAdminApi.overview())
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载反代总览失败')
    }
  }, [])

  const loadBlacklist = useCallback(async () => {
    try {
      const data = await webProxyAdminApi.blacklist()
      setEntries(data.entries)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载黑名单失败')
    }
  }, [])

  const loadStats = useCallback(async (range: number) => {
    try {
      setStats(await webProxyAdminApi.stats(range))
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载访问统计失败')
    }
  }, [])

  const loadUsers = useCallback(async (q: string) => {
    try {
      const data = await webProxyAdminApi.users(q)
      setUsers(data.users)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载用户列表失败')
    }
  }, [])

  useEffect(() => {
    void loadOverview()
    void loadBlacklist()
    void loadStats(7)
    void loadUsers('')
  }, [loadOverview, loadBlacklist, loadStats, loadUsers])

  const switchTab = (next: Tab) => {
    setTab(next)
    setNotice('')
    setError('')
    if (next === 'stats') void loadStats(days)
    if (next === 'blacklist') void loadBlacklist()
    if (next === 'exempt') void loadUsers(query)
  }

  const changeDays = (next: number) => {
    setDays(next)
    void loadStats(next)
  }

  const handleAdd = async () => {
    if (!pattern.trim() || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { entry } = await webProxyAdminApi.addBlacklist(pattern, reason)
      setEntries((prev) => [entry, ...prev])
      setPattern('')
      setReason('')
      setNotice(`已拉黑 ${entry.pattern}，该域名的反代请求会立即被拒绝`)
      void loadOverview()
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加黑名单失败')
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (entry: ProxyBlacklistEntry) => {
    if (!window.confirm(`把 ${entry.pattern} 从反代黑名单移除？`)) return
    setError('')
    setNotice('')
    try {
      await webProxyAdminApi.removeBlacklist(entry.id)
      setEntries((prev) => prev.filter((item) => item.id !== entry.id))
      setNotice(`已移除 ${entry.pattern}`)
      void loadOverview()
    } catch (err) {
      setError(err instanceof Error ? err.message : '移除失败')
    }
  }

  const handleExemption = async (user: ProxyAdminUser, exempt: boolean) => {
    setError('')
    setNotice('')
    try {
      const data = await webProxyAdminApi.setExemption(user.id, exempt)
      setUsers((prev) => prev.map((item) => (item.id === user.id ? { ...item, exempt: data.user.exempt } : item)))
      setNotice(`${user.username} ${exempt ? '已获得' : '已取消'}排队赦免`)
      void loadOverview()
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败')
    }
  }

  const handleSearch = async () => {
    await loadUsers(query.trim())
  }

  return (
    <div>
      <div className="gh-page-header">
        <h1>网页反代管理</h1>
        <p>统一管理反代黑名单、访问统计与并发排队豁免；反代页面本身在「网页反代」功能页打开</p>
      </div>

      {error && <GitHubAlert variant="danger">{error}</GitHubAlert>}
      {notice && <GitHubAlert variant="success">{notice}</GitHubAlert>}

      {/* 总览卡片 */}
      <div style={{ display: 'flex', gap: 'var(--gh-space-3)', flexWrap: 'wrap', margin: 'var(--gh-space-4) 0' }}>
        <div style={cardStyle}>
          <div className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)' }}>并发闸门</div>
          <div style={{ fontSize: 'var(--gh-text-xl)', fontWeight: 600 }}>
            {overview ? `${overview.queue.active} / ${overview.queue.maxConcurrent}` : '—'}
          </div>
          <div className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)' }}>
            排队 {overview?.queue.queued ?? 0} 人 · 队列上限 {overview?.queue.queueLimit ?? 0}
          </div>
        </div>
        <div style={cardStyle}>
          <div className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)' }}>反代站点</div>
          <div style={{ fontSize: 'var(--gh-text-xl)', fontWeight: 600 }}>{formatNumber(overview?.totals.sites)}</div>
          <div className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)' }}>
            {formatNumber(overview?.totals.users)} 个账号使用中
          </div>
        </div>
        <div style={cardStyle}>
          <div className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)' }}>累计请求</div>
          <div style={{ fontSize: 'var(--gh-text-xl)', fontWeight: 600 }}>{formatNumber(overview?.totals.requests)}</div>
          <div className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)' }}>
            失败 {formatNumber(overview?.totals.errors)}
          </div>
        </div>
        <div style={cardStyle}>
          <div className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)' }}>排队赦免</div>
          <div style={{ fontSize: 'var(--gh-text-xl)', fontWeight: 600 }}>{formatNumber(overview?.totals.exemptUsers)}</div>
          <div className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)' }}>
            黑名单 {formatNumber(overview?.totals.blacklistEntries)} 条
          </div>
        </div>
      </div>

      {/* Tab 切换 */}
      <div style={{ display: 'flex', gap: 'var(--gh-space-2)', marginBottom: 'var(--gh-space-4)', flexWrap: 'wrap' }}>
        {([
          ['stats', '访问统计与排名'],
          ['blacklist', '反代黑名单'],
          ['exempt', '排队赦免'],
        ] as Array<[Tab, string]>).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => switchTab(value)}
            className={`gh-btn gh-btn--sm ${tab === value ? 'gh-btn--primary' : 'gh-btn--secondary'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'stats' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gh-space-4)' }}>
          <div className="gh-box">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--gh-space-3)', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 600 }}>访问趋势</div>
                <div className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)' }}>
                  统计口径为反代转发的全部请求（含子资源）；数字每 15 秒批量落库
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--gh-space-2)' }}>
                {DAY_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => changeDays(option)}
                    className={`gh-btn gh-btn--sm ${days === option ? 'gh-btn--primary' : 'gh-btn--secondary'}`}
                  >
                    近 {option} 天
                  </button>
                ))}
              </div>
            </div>

            {stats ? (
              <ProxyTrendChart data={stats.daily} />
            ) : (
              <p className="gh-text-tertiary" style={{ marginTop: 'var(--gh-space-4)' }}>正在加载访问趋势…</p>
            )}
          </div>

          <div className="gh-box">
            <div style={{ fontWeight: 600, marginBottom: 'var(--gh-space-3)' }}>站点排名（近 {stats?.days ?? days} 天）</div>
            {stats && stats.sites.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>#</th>
                      <th style={thStyle}>站点</th>
                      <th style={thStyle}>归属账号</th>
                      <th style={thStyle}>请求</th>
                      <th style={thStyle}>失败</th>
                      <th style={thStyle}>累计请求</th>
                      <th style={thStyle}>最近访问</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.sites.map((item, index) => (
                      <tr key={item.siteId}>
                        <td style={tdStyle}>{index + 1}</td>
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 600 }}>{item.name}</div>
                          <div className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)' }}>{item.origin}</div>
                        </td>
                        <td style={tdStyle}>{item.ownerName}</td>
                        <td style={tdStyle}>{formatNumber(item.requests)}</td>
                        <td style={tdStyle}>
                          {item.errors > 0
                            ? <GitHubBadge variant="danger">{formatNumber(item.errors)}</GitHubBadge>
                            : <span className="gh-text-tertiary">0</span>}
                        </td>
                        <td style={tdStyle}>{formatNumber(item.totalRequests)}</td>
                        <td style={tdStyle}>{formatTime(item.lastVisitedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="gh-text-tertiary">还没有站点访问记录。</p>
            )}
          </div>

          <div className="gh-box">
            <div style={{ fontWeight: 600, marginBottom: 'var(--gh-space-3)' }}>账号排名（近 {stats?.days ?? days} 天）</div>
            {stats && stats.users.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>#</th>
                      <th style={thStyle}>账号</th>
                      <th style={thStyle}>请求</th>
                      <th style={thStyle}>失败</th>
                      <th style={thStyle}>排队赦免</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.users.map((item, index) => (
                      <tr key={item.userId}>
                        <td style={tdStyle}>{index + 1}</td>
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 600 }}>{item.username}</div>
                          <div className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)' }}>{item.role}</div>
                        </td>
                        <td style={tdStyle}>{formatNumber(item.requests)}</td>
                        <td style={tdStyle}>{formatNumber(item.errors)}</td>
                        <td style={tdStyle}>
                          {item.exempt ? <GitHubBadge variant="success">已豁免</GitHubBadge> : <span className="gh-text-tertiary">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="gh-text-tertiary">还没有账号访问记录。</p>
            )}
          </div>
        </div>
      )}

      {tab === 'blacklist' && (
        <div className="gh-box">
          <div style={{ fontWeight: 600 }}>新增黑名单</div>
          <p className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-sm)', marginTop: 4 }}>
            填域名即可（可贴完整链接）：<code>example.com</code> 会同时拦截所有子域名；<code>*.example.com</code> 只拦截子域名。命中后既不能新建站点，已存在的站点也会立即停止转发。
          </p>
          <div style={{ display: 'flex', gap: 'var(--gh-space-2)', flexWrap: 'wrap', margin: 'var(--gh-space-3) 0' }}>
            <GitHubInput
              style={{ flex: '1 1 240px' }}
              placeholder="example.com 或 *.example.com"
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void handleAdd() }}
            />
            <GitHubInput
              style={{ flex: '1 1 200px' }}
              placeholder="原因（可选）"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <GitHubButton variant="primary" onClick={() => void handleAdd()} disabled={busy || !pattern.trim()}>
              {busy ? '添加中…' : '加入黑名单'}
            </GitHubButton>
          </div>

          {entries.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>域名</th>
                    <th style={thStyle}>原因</th>
                    <th style={thStyle}>创建时间</th>
                    <th style={thStyle}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td style={tdStyle}><code>{entry.pattern}</code></td>
                      <td style={tdStyle}>{entry.reason || <span className="gh-text-tertiary">—</span>}</td>
                      <td style={tdStyle}>{formatTime(entry.createdAt)}</td>
                      <td style={tdStyle}>
                        <GitHubButton variant="danger" size="sm" onClick={() => void handleRemove(entry)}>
                          移除
                        </GitHubButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="gh-text-tertiary">黑名单为空。</p>
          )}
        </div>
      )}

      {tab === 'exempt' && (
        <div className="gh-box">
          <div style={{ fontWeight: 600 }}>排队赦免</div>
          <p className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-sm)', marginTop: 4 }}>
            反代默认限制同时进行中的请求数（超出后排队，队列满或超时返回 503）。被豁免的账号不排队、不占并发，适合演示或高频使用者。管理员本身天然豁免。
          </p>

          <div style={{ display: 'flex', gap: 'var(--gh-space-2)', margin: 'var(--gh-space-3) 0', flexWrap: 'wrap' }}>
            <GitHubInput
              style={{ flex: '1 1 240px' }}
              placeholder="搜索用户名或邮箱"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void handleSearch() }}
            />
            <GitHubButton onClick={() => void handleSearch()}>搜索</GitHubButton>
          </div>

          {users.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>账号</th>
                    <th style={thStyle}>角色</th>
                    <th style={thStyle}>反代站点</th>
                    <th style={thStyle}>状态</th>
                    <th style={thStyle}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600 }}>{user.username}</div>
                        <div className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)' }}>{user.email}</div>
                      </td>
                      <td style={tdStyle}>{user.role}</td>
                      <td style={tdStyle}>{user.siteCount}</td>
                      <td style={tdStyle}>
                        {user.role === 'admin'
                          ? <GitHubBadge variant="accent">管理员天然豁免</GitHubBadge>
                          : user.exempt
                            ? <GitHubBadge variant="success">已豁免</GitHubBadge>
                            : <span className="gh-text-tertiary">正常排队</span>}
                      </td>
                      <td style={tdStyle}>
                        {user.role === 'admin' ? (
                          <span className="gh-text-tertiary">—</span>
                        ) : (
                          <GitHubButton
                            size="sm"
                            variant={user.exempt ? 'secondary' : 'primary'}
                            onClick={() => void handleExemption(user, !user.exempt)}
                          >
                            {user.exempt ? '取消豁免' : '授予豁免'}
                          </GitHubButton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="gh-text-tertiary">没有匹配的账号。</p>
          )}
        </div>
      )}
    </div>
  )
}
