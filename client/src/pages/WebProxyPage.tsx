import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  clearProxyLocalData,
  normalizeProxyInput,
  webProxyApi,
  type ProxySite,
} from '../lib/webProxy'

function formatWhen(value: string | null): string {
  if (!value) return '尚未访问'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '尚未访问'
  const diff = Date.now() - date.getTime()
  if (diff < 60_000) return '刚刚访问'
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前访问`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前访问`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前访问`
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function hostInitial(site: ProxySite): string {
  const host = site.host.replace(/^www\./, '')
  return (host.charAt(0) || 'W').toUpperCase()
}

interface SiteCardProps {
  site: ProxySite
  editing: boolean
  draftName: string
  busy: boolean
  onDraftChange: (value: string) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveName: () => void
  onOpen: () => void
  onClearCookies: () => void
  onRemove: () => void
}

function SiteCard({
  site,
  editing,
  draftName,
  busy,
  onDraftChange,
  onStartEdit,
  onCancelEdit,
  onSaveName,
  onOpen,
  onClearCookies,
  onRemove,
}: SiteCardProps) {
  return (
    <article className="gh-proxy-card">
      <div className="gh-proxy-card-head">
        <div className="gh-proxy-card-avatar" aria-hidden="true">{hostInitial(site)}</div>
        <div className="gh-proxy-card-copy">
          {editing ? (
            <form
              className="gh-proxy-rename"
              onSubmit={(event) => {
                event.preventDefault()
                onSaveName()
              }}
            >
              <input
                className="gh-input gh-proxy-rename-input"
                value={draftName}
                maxLength={60}
                autoFocus
                onChange={(event) => onDraftChange(event.target.value)}
                aria-label="站点显示名称"
              />
              <button type="submit" className="gh-btn gh-btn--primary gh-btn--sm" disabled={busy}>
                保存
              </button>
              <button type="button" className="gh-btn gh-btn--sm" onClick={onCancelEdit} disabled={busy}>
                取消
              </button>
            </form>
          ) : (
            <h3 className="gh-proxy-card-title" title={site.name}>{site.name}</h3>
          )}
          <p className="gh-proxy-card-origin" title={site.origin}>{site.origin}</p>
          <div className="gh-proxy-card-meta">
            <span>{formatWhen(site.lastVisitedAt)}</span>
            {site.cookieCount > 0 ? (
              <span className="gh-badge gh-badge--success" title="登录状态已加密保存在你的账号下">
                已保存登录态 · {site.cookieCount}
              </span>
            ) : (
              <span className="gh-badge">未保存登录态</span>
            )}
          </div>
        </div>
      </div>

      <div className="gh-proxy-card-actions">
        <button type="button" className="gh-btn gh-btn--primary gh-btn--sm" onClick={onOpen} disabled={busy}>
          打开反代
        </button>
        {!editing && (
          <button type="button" className="gh-btn gh-btn--sm" onClick={onStartEdit} disabled={busy}>
            重命名
          </button>
        )}
        <button
          type="button"
          className="gh-btn gh-btn--sm"
          onClick={onClearCookies}
          disabled={busy || site.cookieCount === 0}
          title="清除后需要重新登录该网站"
        >
          清除登录
        </button>
        <button type="button" className="gh-btn gh-btn--danger gh-btn--sm" onClick={onRemove} disabled={busy}>
          删除
        </button>
      </div>
    </article>
  )
}

/**
 * 网页反代：输入域名即可通过 LineWeb 打开目标站点。
 * 站点列表与登录态（Cookie 罐）按账号保存在服务端，换设备不掉登录。
 */
export default function WebProxyPage() {
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draftName, setDraftName] = useState('')

  const sitesQuery = useQuery({
    queryKey: ['web-proxy-sites'],
    queryFn: async () => (await webProxyApi.list()).sites,
  })
  const sites = sitesQuery.data ?? []
  const sortedSites = useMemo(
    () =>
      [...sites].sort((a, b) => {
        const left = a.lastVisitedAt ? Date.parse(a.lastVisitedAt) : 0
        const right = b.lastVisitedAt ? Date.parse(b.lastVisitedAt) : 0
        if (left !== right) return right - left
        return b.id - a.id
      }),
    [sites],
  )

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    const normalized = normalizeProxyInput(url)
    if (!normalized) {
      setFormError('请输入要反代的网站域名或地址。')
      return
    }
    try {
      const parsed = new URL(normalized)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        setFormError('仅支持 http/https 网站。')
        return
      }
      if (!parsed.hostname || !parsed.hostname.includes('.')) {
        setFormError('请输入完整的域名，例如 github.com。')
        return
      }
    } catch {
      setFormError('请输入有效的网站域名或地址。')
      return
    }

    setSubmitting(true)
    setFormError('')
    try {
      const { site } = await webProxyApi.create(normalized, name)
      setUrl('')
      setName('')
      await sitesQuery.refetch()
      navigate(`/webproxy/${site.id}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : '创建失败，请稍后再试。'
      if (message.includes('已经在反代列表里')) {
        setFormError('这个网站已经在列表里了，直接在下面打开即可。')
        void sitesQuery.refetch()
      } else {
        setFormError(message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleOpen = (site: ProxySite) => {
    // 先跳查看页，由查看页调用 /open 换会话票据后再挂 iframe
    navigate(`/webproxy/${site.id}`)
  }

  const handleStartEdit = (site: ProxySite) => {
    setEditingId(site.id)
    setDraftName(site.name)
  }

  const handleSaveName = async (site: ProxySite) => {
    const next = draftName.trim()
    if (!next) {
      window.alert('名称不能为空')
      return
    }
    if (next === site.name) {
      setEditingId(null)
      return
    }
    setBusyId(site.id)
    try {
      await webProxyApi.rename(site.id, next)
      await sitesQuery.refetch()
      setEditingId(null)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '重命名失败，请稍后再试')
    } finally {
      setBusyId(null)
    }
  }

  const handleClearCookies = async (site: ProxySite) => {
    if (!window.confirm(`清除「${site.name}」的登录状态？清除后需要在该网站重新登录。`)) return
    setBusyId(site.id)
    try {
      await webProxyApi.clearCookies(site.id)
      clearProxyLocalData(site.id)
      await sitesQuery.refetch()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '清除失败，请稍后再试')
    } finally {
      setBusyId(null)
    }
  }

  const handleRemove = async (site: ProxySite) => {
    if (!window.confirm(`删除「${site.name}」？会同时删除保存的登录状态，此操作不可撤销。`)) return
    setBusyId(site.id)
    try {
      await webProxyApi.remove(site.id)
      clearProxyLocalData(site.id)
      await sitesQuery.refetch()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '删除失败，请稍后再试')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="gh-page-container gh-proxy-page">
      <header className="gh-proxy-hero">
        <p className="gh-proxy-eyebrow">WEB PROXY</p>
        <h1 className="gh-proxy-title">网页反代</h1>
        <p className="gh-proxy-subtitle">
          输入已有网站的域名，直接在 LineWeb 内打开。登录状态随账号保存在服务端，换电脑、换手机都不用重新登录。
        </p>
      </header>

      <form className="gh-proxy-form" onSubmit={handleCreate}>
        <div className="gh-proxy-form-fields">
          <label className="gh-proxy-field">
            <span className="gh-proxy-field-label">网站地址</span>
            <input
              className="gh-input"
              value={url}
              placeholder="example.com 或 https://example.com"
              onChange={(event) => {
                setUrl(event.target.value)
                if (formError) setFormError('')
              }}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
          <label className="gh-proxy-field gh-proxy-field--name">
            <span className="gh-proxy-field-label">显示名称（可选）</span>
            <input
              className="gh-input"
              value={name}
              placeholder="例如：公司后台"
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
            />
          </label>
        </div>
        <div className="gh-proxy-form-foot">
          <button type="submit" className="gh-btn gh-btn--primary gh-btn--md" disabled={submitting}>
            {submitting ? '正在创建…' : '添加并打开'}
          </button>
          <span className="gh-text-tertiary gh-proxy-form-hint">
            仅支持公开可访问的 http/https 网站，内网与本机地址会被拒绝。
          </span>
        </div>
        {formError && <p className="gh-proxy-form-error" role="alert">{formError}</p>}
      </form>

      <section className="gh-proxy-list-section" aria-labelledby="gh-proxy-list-title">
        <div className="gh-proxy-list-head">
          <h2 id="gh-proxy-list-title" className="gh-proxy-list-title">我的反代站点</h2>
          <span className="gh-badge">{sortedSites.length} / 60</span>
          {sitesQuery.isFetching && <span className="gh-text-tertiary gh-proxy-list-sync">同步中…</span>}
        </div>

        {sitesQuery.isLoading ? (
          <div className="gh-proxy-state">
            <div className="gh-spinner" />
            <p className="gh-text-secondary">正在读取站点列表…</p>
          </div>
        ) : sitesQuery.isError ? (
          <div className="gh-proxy-state">
            <p className="gh-text-secondary">
              {sitesQuery.error instanceof Error ? sitesQuery.error.message : '站点列表加载失败。'}
            </p>
            <button type="button" className="gh-btn gh-btn--sm" onClick={() => void sitesQuery.refetch()}>
              重试
            </button>
          </div>
        ) : sortedSites.length === 0 ? (
          <div className="gh-proxy-empty">
            <div className="gh-proxy-empty-icon" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z" />
              </svg>
            </div>
            <h3>还没有反代站点</h3>
            <p className="gh-text-secondary">
              在上方输入一个网站域名，例如 github.com，即可开始。首次打开后正常登录，登录状态会自动保存到你的账号。
            </p>
          </div>
        ) : (
          <div className="gh-proxy-list">
            {sortedSites.map((site) => (
              <SiteCard
                key={site.id}
                site={site}
                editing={editingId === site.id}
                draftName={editingId === site.id ? draftName : site.name}
                busy={busyId === site.id}
                onDraftChange={setDraftName}
                onStartEdit={() => handleStartEdit(site)}
                onCancelEdit={() => setEditingId(null)}
                onSaveName={() => void handleSaveName(site)}
                onOpen={() => handleOpen(site)}
                onClearCookies={() => void handleClearCookies(site)}
                onRemove={() => void handleRemove(site)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="gh-proxy-notes" aria-label="使用说明">
        <div className="gh-proxy-note">
          <strong>登录不会掉</strong>
          <span>站点 Cookie 由服务端按账号保存，浏览器里只有 LineWeb 自己的会话票据，换设备后依然保持登录。</span>
        </div>
        <div className="gh-proxy-note">
          <strong>随时返回</strong>
          <span>反代页左下角常驻 LineWeb 标识，可收起、可展开，一键回到站点列表。</span>
        </div>
        <div className="gh-proxy-note">
          <strong>实时与降级</strong>
          <span>站点使用 WebSocket 时走中继实时连接；不支持时页面会自动使用自身的轮询降级方案。</span>
        </div>
      </section>
    </div>
  )
}
