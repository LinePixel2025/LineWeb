import { useEffect, useState } from 'react'
import { GitHubAlert, GitHubBadge, GitHubButton, GitHubInput } from '../../components/ui'
import api from '../../lib/api'
import {
  APP_SCOPES,
  APP_SCOPE_DESCRIPTIONS,
  APP_SCOPE_LABELS,
  appScopeLabel,
  isHighRiskScope,
  type AppScope,
} from '../../lib/appScopes'

/**
 * 应用授权管理（/admin/apps）
 *
 * 只有在这里注册过的应用才能跳转 /authorize 请求用户授权。
 * 机密客户端的 client_secret 仅在「创建」与「重置密钥」两个响应中出现一次，
 * 之后服务端只保留 bcrypt 哈希，无法再次查看。
 */

interface OAuthClientItem {
  id: number
  clientId: string
  clientType: string
  name: string
  description: string | null
  homepage: string | null
  redirectUris: string[]
  allowedScopes: string[]
  isActive: boolean
  createdAt: string
  updatedAt: string
  grantCount: number
}

interface SecretReveal {
  clientId: string
  clientSecret: string
}

interface FormState {
  name: string
  description: string
  homepage: string
  clientType: 'confidential' | 'public'
  redirectUris: string
  allowedScopes: AppScope[]
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  homepage: '',
  clientType: 'confidential',
  redirectUris: '',
  allowedScopes: [],
}

/** 回调地址必须是绝对的 http/https 地址：服务端按精确匹配校验，不支持通配 */
function validateRedirectUris(raw: string): { uris: string[]; error: string } {
  const uris = raw.split('\n').map((line) => line.trim()).filter(Boolean)
  if (uris.length === 0) return { uris, error: '请至少填写一个回调地址' }
  if (uris.length > 20) return { uris, error: '回调地址最多 20 个' }
  for (const uri of uris) {
    let parsed: URL
    try {
      parsed = new URL(uri)
    } catch {
      return { uris, error: `回调地址不是合法的 URL：${uri}` }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { uris, error: `回调地址必须以 http:// 或 https:// 开头：${uri}` }
    }
  }
  return { uris, error: '' }
}

/** 复制到剪贴板，失败时降级为选中文本 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export default function AppAdminPage() {
  const [clients, setClients] = useState<OAuthClientItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState('')

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [secretReveal, setSecretReveal] = useState<SecretReveal | null>(null)

  const [confirmAction, setConfirmAction] = useState<{ kind: 'delete' | 'reset' | 'toggle'; client: OAuthClientItem } | null>(null)

  const fetchClients = () => {
    setLoading(true)
    api.get<{ clients: OAuthClientItem[] }>('/oauth/clients')
      .then((data) => { setClients(data.clients); setError('') })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '加载应用列表失败'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchClients() }, [])

  const flashNotice = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 3000)
  }

  const handleCopy = async (value: string, tag: string) => {
    const ok = await copyText(value)
    if (ok) {
      setCopied(tag)
      window.setTimeout(() => setCopied(''), 2000)
    } else {
      setError('复制失败，请手动选中文本复制')
    }
  }

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError('')
    setDialogOpen(true)
  }

  const openEdit = (client: OAuthClientItem) => {
    setEditingId(client.id)
    setForm({
      name: client.name,
      description: client.description ?? '',
      homepage: client.homepage ?? '',
      clientType: client.clientType === 'public' ? 'public' : 'confidential',
      redirectUris: client.redirectUris.join('\n'),
      allowedScopes: client.allowedScopes.filter((s): s is AppScope => (APP_SCOPES as readonly string[]).includes(s)),
    })
    setFormError('')
    setDialogOpen(true)
  }

  const toggleScope = (scope: AppScope) => {
    setForm((prev) => ({
      ...prev,
      allowedScopes: prev.allowedScopes.includes(scope)
        ? prev.allowedScopes.filter((s) => s !== scope)
        : [...prev.allowedScopes, scope],
    }))
  }

  const handleSave = async () => {
    setFormError('')
    if (!form.name.trim()) { setFormError('请填写应用名称'); return }
    const { uris, error: uriError } = validateRedirectUris(form.redirectUris)
    if (uriError) { setFormError(uriError); return }
    if (form.allowedScopes.length === 0) { setFormError('请至少勾选一项允许申请的权限'); return }

    const body = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      homepage: form.homepage.trim() || undefined,
      clientType: form.clientType,
      redirectUris: uris,
      allowedScopes: form.allowedScopes,
    }

    setSaving(true)
    try {
      if (editingId === null) {
        const data = await api.post<{ client: OAuthClientItem; clientSecret?: string }>('/oauth/clients', body)
        setDialogOpen(false)
        flashNotice(`应用「${data.client.name}」已创建`)
        if (data.clientSecret) {
          setSecretReveal({ clientId: data.client.clientId, clientSecret: data.clientSecret })
        }
      } else {
        await api.put(`/oauth/clients/${editingId}`, body)
        setDialogOpen(false)
        flashNotice('应用已更新')
      }
      fetchClients()
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (client: OAuthClientItem) => {
    try {
      await api.put(`/oauth/clients/${client.id}`, { isActive: !client.isActive })
      flashNotice(client.isActive ? '应用已停用，其令牌立即失效' : '应用已启用')
      fetchClients()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '操作失败')
    }
  }

  const resetSecret = async (client: OAuthClientItem) => {
    try {
      const data = await api.post<SecretReveal>(`/oauth/clients/${client.id}/secret`)
      setSecretReveal(data)
      fetchClients()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '重置密钥失败')
    }
  }

  const removeClient = async (client: OAuthClientItem) => {
    try {
      await api.delete(`/oauth/clients/${client.id}`)
      flashNotice('应用已删除，相关授权一并撤销')
      fetchClients()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  const runConfirm = async () => {
    if (!confirmAction) return
    const { kind, client } = confirmAction
    setConfirmAction(null)
    if (kind === 'delete') await removeClient(client)
    else if (kind === 'reset') await resetSecret(client)
    else await toggleActive(client)
  }

  return (
    <div>
      <div className="gh-page-header">
        <h1>应用授权管理</h1>
        <p>只有在此注册的应用才能跳转 /authorize 请求用户授权你的 LineWeb 账号</p>
      </div>

      {notice && <GitHubAlert variant="success">{notice}</GitHubAlert>}
      {error && (
        <div style={{ marginBottom: '16px' }}>
          <GitHubAlert variant="danger">{error}</GitHubAlert>
        </div>
      )}

      <div className="gh-actions" style={{ justifyContent: 'flex-start', marginBottom: '16px' }}>
        <GitHubButton variant="primary" size="sm" onClick={openCreate}>注册新应用</GitHubButton>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--gh-space-7)' }}>
          <div className="gh-spinner" />
        </div>
      ) : clients.length === 0 ? (
        <div className="gh-box" style={{ padding: '40px', textAlign: 'center' }}>
          <p className="gh-text-secondary">还没有注册任何应用</p>
          <p className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-sm)' }}>
            注册后即可把 client_id 与回调地址交给应用开发者
          </p>
        </div>
      ) : (
        <div className="gh-box gh-table-wrap" style={{ padding: 0 }}>
          <table className="gh-table">
            <thead>
              <tr>
                <th>应用名称</th>
                <th style={{ width: '24%' }}>客户端 ID</th>
                <th style={{ width: '80px' }}>类型</th>
                <th style={{ width: '26%' }}>允许申请的权限</th>
                <th style={{ width: '80px' }}>授权数</th>
                <th style={{ textAlign: 'right', width: '240px' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 500 }}>
                      {client.name}
                      {!client.isActive && <GitHubBadge variant="danger">已停用</GitHubBadge>}
                    </div>
                    {client.description && (
                      <p className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)', margin: '4px 0 0', maxWidth: 260 }}>
                        {client.description}
                      </p>
                    )}
                    <p className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)', margin: '4px 0 0', maxWidth: 300 }}>
                      回调：{client.redirectUris.join('、') || '（未配置）'}
                    </p>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <code style={{ fontSize: 'var(--gh-text-xs)', fontFamily: 'var(--gh-font-mono)', wordBreak: 'break-all' }}>
                        {client.clientId}
                      </code>
                      <GitHubButton
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopy(client.clientId, `id-${client.id}`)}
                      >
                        {copied === `id-${client.id}` ? '已复制' : '复制'}
                      </GitHubButton>
                    </div>
                  </td>
                  <td>
                    <GitHubBadge variant={client.clientType === 'public' ? 'default' : 'accent'}>
                      {client.clientType === 'public' ? '公开' : '机密'}
                    </GitHubBadge>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {client.allowedScopes.slice(0, 3).map((scope) => (
                        <GitHubBadge key={scope} variant={isHighRiskScope(scope) ? 'warning' : 'default'}>
                          {appScopeLabel(scope)}
                        </GitHubBadge>
                      ))}
                      {client.allowedScopes.length > 3 && (
                        <GitHubBadge variant="default">+{client.allowedScopes.length - 3}</GitHubBadge>
                      )}
                    </div>
                  </td>
                  <td className="gh-text-tertiary" style={{ textAlign: 'center' }}>{client.grantCount}</td>
                  <td>
                    <div className="gh-actions" style={{ flexWrap: 'wrap' }}>
                      <GitHubButton variant="secondary" size="sm" onClick={() => openEdit(client)}>编辑</GitHubButton>
                      {client.clientType !== 'public' && (
                        <GitHubButton variant="secondary" size="sm" onClick={() => setConfirmAction({ kind: 'reset', client })}>
                          重置密钥
                        </GitHubButton>
                      )}
                      <GitHubButton
                        variant="secondary"
                        size="sm"
                        onClick={() => setConfirmAction({ kind: 'toggle', client })}
                      >
                        {client.isActive ? '停用' : '启用'}
                      </GitHubButton>
                      <GitHubButton variant="danger" size="sm" onClick={() => setConfirmAction({ kind: 'delete', client })}>
                        删除
                      </GitHubButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 创建 / 编辑对话框 */}
      {dialogOpen && (
        <div className="gh-dialog-overlay" onClick={() => !saving && setDialogOpen(false)}>
          <div className="gh-dialog" style={{ maxWidth: '560px' }} onClick={(e) => e.stopPropagation()}>
            <h2 className="gh-dialog-title">{editingId === null ? '注册新应用' : '编辑应用'}</h2>

            {formError && (
              <div style={{ marginBottom: '16px' }}>
                <GitHubAlert variant="danger">{formError}</GitHubAlert>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <label className="gh-form-field">
                <span>应用名称</span>
                <GitHubInput
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="例如：Time Master 桌面版"
                  maxLength={60}
                  fullWidth
                />
              </label>

              <label className="gh-form-field">
                <span>应用简介</span>
                <GitHubInput
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="会显示在授权页，帮助用户判断是否信任"
                  maxLength={200}
                  fullWidth
                />
              </label>

              <label className="gh-form-field">
                <span>应用主页</span>
                <GitHubInput
                  type="text"
                  value={form.homepage}
                  onChange={(e) => setForm((p) => ({ ...p, homepage: e.target.value }))}
                  placeholder="https://example.com（可选）"
                  maxLength={300}
                  fullWidth
                />
              </label>

              <label className="gh-form-field">
                <span>客户端类型</span>
                <select
                  className="gh-input gh-input--full"
                  value={form.clientType}
                  onChange={(e) => setForm((p) => ({ ...p, clientType: e.target.value as 'confidential' | 'public' }))}
                >
                  <option value="confidential">机密客户端（有服务端，可安全保存密钥）</option>
                  <option value="public">公开客户端（桌面 / 移动 / 纯前端，无密钥）</option>
                </select>
              </label>

              <label className="gh-form-field">
                <span>回调地址（每行一个，需与授权请求完全一致）</span>
                <textarea
                  className="gh-input"
                  style={{ width: '100%', minHeight: '72px', fontFamily: 'var(--gh-font-mono)', fontSize: 'var(--gh-text-xs)' }}
                  value={form.redirectUris}
                  onChange={(e) => setForm((p) => ({ ...p, redirectUris: e.target.value }))}
                  placeholder={'https://example.com/callback\nhttp://localhost:8080/callback'}
                />
              </label>

              <div className="gh-form-field">
                <span>允许申请的权限</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {APP_SCOPES.map((scope) => (
                    <label key={scope} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={form.allowedScopes.includes(scope)}
                        onChange={() => toggleScope(scope)}
                        style={{ marginTop: '3px' }}
                      />
                      <span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          {APP_SCOPE_LABELS[scope]}
                          {isHighRiskScope(scope) && <GitHubBadge variant="warning">高危</GitHubBadge>}
                        </span>
                        <span className="gh-text-tertiary" style={{ display: 'block', fontSize: 'var(--gh-text-xs)' }}>
                          {APP_SCOPE_DESCRIPTIONS[scope]}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="gh-dialog-actions">
              <GitHubButton type="button" variant="ghost" onClick={() => setDialogOpen(false)} disabled={saving}>
                取消
              </GitHubButton>
              <GitHubButton type="button" variant="primary" onClick={handleSave} disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </GitHubButton>
            </div>
          </div>
        </div>
      )}

      {/* 密钥一次性展示 */}
      {secretReveal && (
        <div className="gh-dialog-overlay" onClick={() => setSecretReveal(null)}>
          <div className="gh-dialog" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
            <h2 className="gh-dialog-title">请立即保存应用密钥</h2>
            <GitHubAlert variant="warning" title="密钥只显示这一次">
              关闭本对话框后无法再次查看该密钥。若遗失，只能重新生成（旧密钥会立即失效）。
            </GitHubAlert>
            <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <span className="gh-text-secondary" style={{ fontSize: 'var(--gh-text-xs)' }}>客户端 ID</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <code style={{ fontFamily: 'var(--gh-font-mono)', fontSize: 'var(--gh-text-xs)', wordBreak: 'break-all' }}>
                    {secretReveal.clientId}
                  </code>
                  <GitHubButton variant="ghost" size="sm" onClick={() => handleCopy(secretReveal.clientId, 'reveal-id')}>
                    {copied === 'reveal-id' ? '已复制' : '复制'}
                  </GitHubButton>
                </div>
              </div>
              <div>
                <span className="gh-text-secondary" style={{ fontSize: 'var(--gh-text-xs)' }}>客户端密钥</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <code style={{ fontFamily: 'var(--gh-font-mono)', fontSize: 'var(--gh-text-xs)', wordBreak: 'break-all' }}>
                    {secretReveal.clientSecret}
                  </code>
                  <GitHubButton variant="ghost" size="sm" onClick={() => handleCopy(secretReveal.clientSecret, 'reveal-secret')}>
                    {copied === 'reveal-secret' ? '已复制' : '复制'}
                  </GitHubButton>
                </div>
              </div>
            </div>
            <div className="gh-dialog-actions">
              <GitHubButton type="button" variant="primary" onClick={() => setSecretReveal(null)}>
                我已保存
              </GitHubButton>
            </div>
          </div>
        </div>
      )}

      {/* 危险操作确认 */}
      {confirmAction && (
        <div className="gh-dialog-overlay" onClick={() => setConfirmAction(null)}>
          <div className="gh-dialog" onClick={(e) => e.stopPropagation()}>
            <h2 className="gh-dialog-title">
              {confirmAction.kind === 'delete' ? '删除应用'
                : confirmAction.kind === 'reset' ? '重置密钥' : (confirmAction.client.isActive ? '停用应用' : '启用应用')}
            </h2>
            <p className="gh-text-secondary" style={{ fontSize: 'var(--gh-text-sm)' }}>
              {confirmAction.kind === 'delete'
                ? `确定要删除「${confirmAction.client.name}」吗？该应用的所有用户授权将一并撤销，其访问令牌立即失效。`
                : confirmAction.kind === 'reset'
                  ? `确定要为「${confirmAction.client.name}」生成新密钥吗？旧密钥会立即失效，应用需改用新密钥。`
                  : confirmAction.client.isActive
                    ? `确定要停用「${confirmAction.client.name}」吗？停用后该应用的所有令牌立即失效，且无法再发起授权。`
                    : `确定要重新启用「${confirmAction.client.name}」吗？`}
            </p>
            <div className="gh-dialog-actions">
              <GitHubButton type="button" variant="ghost" onClick={() => setConfirmAction(null)}>取消</GitHubButton>
              <GitHubButton
                type="button"
                variant={confirmAction.kind === 'toggle' && !confirmAction.client.isActive ? 'primary' : 'danger'}
                onClick={runConfirm}
              >
                确定
              </GitHubButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
