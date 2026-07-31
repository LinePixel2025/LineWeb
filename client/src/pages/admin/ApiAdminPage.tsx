import { useState, useEffect, useCallback } from 'react'
import { GitHubButton, GitHubBadge, GitHubAlert } from '../../components/ui'
import api from '../../lib/api'

interface ApiKey {
  id: number
  name: string
  prefix: string
  key?: string
  active: boolean
  lastUsedAt: string | null
  expiresAt: string | null
  createdAt: string
  user: { id: number; username: string }
}

export default function ApiAdminPage() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showEdit, setShowEdit] = useState<ApiKey | null>(null)
  const [newKey, setNewKey] = useState<ApiKey | null>(null)
  const [copied, setCopied] = useState(false)
  const [formName, setFormName] = useState('')
  const [formExpires, setFormExpires] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchKeys = useCallback(() => {
    api.get<ApiKey[]>('/api-keys')
      .then(setKeys)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchKeys() }, [fetchKeys])

  const handleCreate = async () => {
    setSaving(true)
    setFormError('')
    try {
      const body: Record<string, string> = { name: formName.trim() }
      if (formExpires) body.expiresAt = formExpires
      const result = await api.post<ApiKey>('/api-keys', body)
      setNewKey(result)
      setShowCreate(false)
      setFormName('')
      setFormExpires('')
      fetchKeys()
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : '创建失败')
    } finally {
      setSaving(false)
    }
  }

  const handleUpdate = async () => {
    if (!showEdit) return
    setSaving(true)
    setFormError('')
    try {
      const body: Record<string, unknown> = {}
      if (formName.trim()) body.name = formName.trim()
      body.expiresAt = formExpires || null
      await api.put(`/api-keys/${showEdit.id}`, body)
      setShowEdit(null)
      setFormName('')
      setFormExpires('')
      fetchKeys()
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : '更新失败')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (key: ApiKey) => {
    try {
      await api.put(`/api-keys/${key.id}`, { active: !key.active })
      fetchKeys()
    } catch {
      alert('更新失败')
    }
  }

  const handleDelete = async (key: ApiKey) => {
    if (!confirm(`确定要删除 API Key「${key.name}」吗？此操作不可撤销。`)) return
    try {
      await api.delete(`/api-keys/${key.id}`)
      fetchKeys()
    } catch {
      alert('删除失败')
    }
  }

  const handleCopyKey = async () => {
    if (!newKey?.key) return
    try {
      await navigator.clipboard.writeText(newKey.key)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      alert('复制失败，请手动复制')
    }
  }

  const openEdit = (key: ApiKey) => {
    setShowEdit(key)
    setFormName(key.name)
    setFormExpires(key.expiresAt ? key.expiresAt.slice(0, 10) : '')
    setFormError('')
  }

  const inputStyle: React.CSSProperties = {
    padding: '6px 12px',
    fontSize: 'var(--gh-text-sm)',
    fontFamily: 'var(--gh-font)',
    color: 'var(--gh-text)',
    background: 'var(--gh-canvas)',
    border: '1px solid var(--gh-border)',
    borderRadius: 'var(--gh-radius)',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  }

  const inputFocusStyle = { borderColor: 'var(--gh-accent)', boxShadow: 'var(--gh-focus-ring)' }

  return (
    <div>
      <div className="gh-page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1>API 密钥管理</h1>
          <p>创建和管理 API 访问密钥</p>
        </div>
        <GitHubButton variant="primary" size="md" onClick={() => { setShowCreate(true); setFormName(''); setFormExpires(''); setFormError('') }}>
          + 创建密钥
        </GitHubButton>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--gh-space-7)' }}>
          <div className="gh-spinner" />
        </div>
      ) : keys.length === 0 ? (
        <div className="gh-box" style={{ padding: '60px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 'var(--gh-space-3)' }}>🔑</div>
          <p className="gh-text-secondary">暂无 API 密钥</p>
          <p className="gh-text-tertiary" style={{ marginTop: '6px' }}>
            点击右上角「+ 创建密钥」生成第一个 API Key
          </p>
        </div>
      ) : (
        <div className="gh-box gh-table-wrap" style={{ padding: 0 }}>
          <table className="gh-table">
            <thead>
              <tr>
                <th style={{ width: '20%' }}>名称</th>
                <th style={{ width: '18%' }}>密钥前缀</th>
                <th style={{ width: '10%' }}>创建者</th>
                <th>状态</th>
                <th style={{ width: '14%' }}>创建时间</th>
                <th style={{ width: '14%' }}>最后使用</th>
                <th style={{ width: '16%', textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{key.name}</div>
                  </td>
                  <td>
                    <code style={{
                      padding: '2px 8px', borderRadius: 'var(--gh-radius)',
                      background: 'var(--gh-canvas-inset)', fontSize: 'var(--gh-text-xs)',
                      color: 'var(--gh-text-secondary)', fontFamily: 'var(--gh-font-mono)',
                    }}>
                      {key.prefix}
                    </code>
                  </td>
                  <td>{key.user.username}</td>
                  <td>
                    <span style={{ cursor: 'pointer' }} onClick={() => handleToggleActive(key)}>
                      {key.active ? (
                        <GitHubBadge variant="success">启用</GitHubBadge>
                      ) : (
                        <GitHubBadge variant="danger">禁用</GitHubBadge>
                      )}
                    </span>
                  </td>
                  <td className="gh-text-tertiary">
                    {new Date(key.createdAt).toLocaleString('zh-CN')}
                  </td>
                  <td className="gh-text-tertiary">
                    {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString('zh-CN') : (
                      <span className="gh-text-tertiary">从未使用</span>
                    )}
                  </td>
                  <td>
                    <div className="gh-actions">
                      <GitHubButton variant="secondary" size="sm" onClick={() => openEdit(key)}>
                        编辑
                      </GitHubButton>
                      <GitHubButton variant="danger" size="sm" onClick={() => handleDelete(key)}>
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

      {/* 创建弹窗 */}
      {showCreate && (
        <div className="gh-dialog-overlay" onClick={() => setShowCreate(false)}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: '440px' }}>
            <div className="gh-dialog">
              <h2 className="gh-dialog-title">创建 API 密钥</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gh-space-3)' }}>
                <div>
                  <label style={{
                    display: 'block', marginBottom: 'var(--gh-space-1)',
                    fontWeight: 600, fontSize: 'var(--gh-text-sm)', color: 'var(--gh-text)',
                  }}>
                    名称
                  </label>
                  <input
                    className="gh-input gh-input--full"
                    type="text"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="例如：我的博客客户端"
                    autoFocus
                  />
                </div>
                <div>
                  <label style={{
                    display: 'block', marginBottom: 'var(--gh-space-1)',
                    fontWeight: 600, fontSize: 'var(--gh-text-sm)', color: 'var(--gh-text)',
                  }}>
                    过期时间（可选）
                  </label>
                  <input
                    className="gh-input gh-input--full"
                    type="date"
                    value={formExpires}
                    onChange={e => setFormExpires(e.target.value)}
                  />
                </div>
                {formError && (
                  <GitHubAlert variant="danger">{formError}</GitHubAlert>
                )}
              </div>
              <div className="gh-dialog-actions">
                <GitHubButton variant="secondary" size="md" onClick={() => setShowCreate(false)}>
                  取消
                </GitHubButton>
                <GitHubButton variant="primary" size="md" onClick={handleCreate} disabled={saving || !formName.trim()}>
                  {saving ? '创建中…' : '创建'}
                </GitHubButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 创建成功后显示完整密钥 */}
      {newKey && (
        <div className="gh-dialog-overlay" onClick={() => { setNewKey(null); setCopied(false) }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: '480px' }}>
            <div className="gh-dialog">
              <h2 className="gh-dialog-title">密钥已创建</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gh-space-3)' }}>
                <GitHubAlert variant="warning">
                  这是唯一一次显示完整密钥，请立即复制并妥善保存。
                </GitHubAlert>
                <div style={{
                  padding: 'var(--gh-space-3)', borderRadius: 'var(--gh-radius)',
                  background: 'var(--gh-canvas-inset)', border: '1px solid var(--gh-border)',
                  wordBreak: 'break-all',
                }}>
                  <code style={{ fontFamily: 'var(--gh-font-mono)', fontSize: 'var(--gh-text-xs)' }}>
                    {newKey.key}
                  </code>
                </div>
                <GitHubButton variant="secondary" size="sm" onClick={handleCopyKey}>
                  {copied ? '✓ 已复制' : '📋 复制密钥'}
                </GitHubButton>
              </div>
              <div className="gh-dialog-actions">
                <GitHubButton variant="primary" size="md" onClick={() => { setNewKey(null); setCopied(false) }}>
                  我已安全保存
                </GitHubButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 编辑弹窗 */}
      {showEdit && (
        <div className="gh-dialog-overlay" onClick={() => setShowEdit(null)}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: '440px' }}>
            <div className="gh-dialog">
              <h2 className="gh-dialog-title">编辑密钥</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gh-space-3)' }}>
                <div>
                  <label style={{
                    display: 'block', marginBottom: 'var(--gh-space-1)',
                    fontWeight: 600, fontSize: 'var(--gh-text-sm)', color: 'var(--gh-text)',
                  }}>
                    名称
                  </label>
                  <input
                    className="gh-input gh-input--full"
                    type="text"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="密钥名称"
                    autoFocus
                  />
                </div>
                <div>
                  <label style={{
                    display: 'block', marginBottom: 'var(--gh-space-1)',
                    fontWeight: 600, fontSize: 'var(--gh-text-sm)', color: 'var(--gh-text)',
                  }}>
                    过期时间（留空=永不过期）
                  </label>
                  <input
                    className="gh-input gh-input--full"
                    type="date"
                    value={formExpires}
                    onChange={e => setFormExpires(e.target.value)}
                  />
                </div>
                <label style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--gh-space-2)',
                  fontSize: 'var(--gh-text-sm)', color: 'var(--gh-text-secondary)', cursor: 'pointer',
                }}>
                  <input
                    type="checkbox"
                    checked={showEdit.active}
                    onChange={() => setShowEdit({ ...showEdit, active: !showEdit.active })}
                    style={{ accentColor: 'var(--gh-accent)' }}
                  />
                  {showEdit.active ? '密钥已启用' : '密钥已禁用'}
                </label>
                {formError && (
                  <GitHubAlert variant="danger">{formError}</GitHubAlert>
                )}
              </div>
              <div className="gh-dialog-actions">
                <GitHubButton variant="secondary" size="md" onClick={() => setShowEdit(null)}>
                  取消
                </GitHubButton>
                <GitHubButton variant="primary" size="md" onClick={handleUpdate} disabled={saving || !formName.trim()}>
                  {saving ? '保存中…' : '保存'}
                </GitHubButton>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
