import { useState, useEffect, useCallback } from 'react'
import LiquidGlass from '../../components/glass/LiquidGlass'
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

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1 className="admin-page-title">API 密钥管理</h1>
        <button
          className="api-refresh-btn"
          style={{
            padding: '8px 20px', borderRadius: '9999px', fontWeight: 500, fontSize: '0.85rem',
            background: 'linear-gradient(135deg, var(--lg-accent), #40a9ff)',
            color: '#fff', border: 'none', cursor: 'pointer',
            fontFamily: 'var(--lg-font)',
          }}
          onClick={() => { setShowCreate(true); setFormName(''); setFormExpires(''); setFormError('') }}
        >
          + 创建密钥
        </button>
      </div>

      {loading ? (
        <div className="admin-spinner"><div className="spinner" /></div>
      ) : keys.length === 0 ? (
        <LiquidGlass variant="blur" className="admin-page-table-wrap" style={{ padding: '60px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🔑</div>
          <div style={{ color: 'var(--lg-text-tertiary)', fontSize: '0.95rem' }}>
            暂无 API 密钥
          </div>
          <div style={{ color: 'var(--lg-text-tertiary)', fontSize: '0.8rem', marginTop: '6px' }}>
            点击右上角「创建密钥」生成第一个 API Key
          </div>
        </LiquidGlass>
      ) : (
        <LiquidGlass variant="blur" className="admin-page-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th className="admin-th" style={{ width: '20%' }}>名称</th>
                <th className="admin-th" style={{ width: '18%' }}>密钥前缀</th>
                <th className="admin-th" style={{ width: '10%' }}>创建者</th>
                <th className="admin-th" style={{ width: '8%' }}>状态</th>
                <th className="admin-th admin-cell--date" style={{ width: '14%' }}>创建时间</th>
                <th className="admin-th admin-cell--date" style={{ width: '14%' }}>最后使用</th>
                <th className="admin-th" style={{ width: '16%' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key, i) => (
                <tr key={key.id} className="admin-row fade-in" style={{ animationDelay: `${i * 0.03}s` }}>
                  <td className="admin-cell" data-label="名称">
                    <div className="admin-post-title">{key.name}</div>
                  </td>
                  <td className="admin-cell" data-label="密钥前缀">
                    <code style={{
                      padding: '2px 8px', borderRadius: '4px',
                      background: 'rgba(255,255,255,0.06)', fontSize: '0.8rem',
                      color: 'var(--lg-text-secondary)', fontFamily: 'monospace',
                    }}>
                      {key.prefix}
                    </code>
                  </td>
                  <td className="admin-cell" data-label="创建者">
                    {key.user.username}
                  </td>
                  <td className="admin-cell" data-label="状态">
                    <span
                      className={`admin-badge ${key.active ? 'admin-badge--published' : 'admin-badge--draft'}`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => handleToggleActive(key)}
                    >
                      {key.active ? '启用' : '禁用'}
                    </span>
                  </td>
                  <td className="admin-cell admin-cell--date" data-label="创建时间">
                    {new Date(key.createdAt).toLocaleString('zh-CN')}
                  </td>
                  <td className="admin-cell admin-cell--date" data-label="最后使用">
                    {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString('zh-CN') : (
                      <span style={{ color: 'var(--lg-text-tertiary)' }}>从未使用</span>
                    )}
                  </td>
                  <td className="admin-cell" data-label="操作">
                    <div className="admin-actions">
                      <button
                        className="admin-action-btn"
                        onClick={() => openEdit(key)}
                      >
                        编辑
                      </button>
                      <button
                        className="admin-action-btn admin-action-btn--danger"
                        onClick={() => handleDelete(key)}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </LiquidGlass>
      )}

      {/* 创建弹窗 */}
      {showCreate && (
        <div className="admin-modal-overlay" onClick={() => setShowCreate(false)}>
          <div onClick={e => e.stopPropagation()}>
            <LiquidGlass variant="strong" className="admin-modal">
              <h2 className="admin-modal-title">创建 API 密钥</h2>
              <div className="admin-modal-body">
                <label className="admin-modal-label">名称</label>
                <input
                  className="admin-modal-input"
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="例如：我的博客客户端"
                  autoFocus
                />
                <label className="admin-modal-label" style={{ marginTop: '16px' }}>过期时间（可选）</label>
                <input
                  className="admin-modal-input"
                  type="date"
                  value={formExpires}
                  onChange={e => setFormExpires(e.target.value)}
                />
                {formError && <div className="admin-modal-error">{formError}</div>}
              </div>
              <div className="admin-modal-footer">
                <button className="admin-modal-btn admin-modal-btn--cancel" onClick={() => setShowCreate(false)}>
                  取消
                </button>
                <button
                  className="admin-modal-btn admin-modal-btn--confirm"
                  onClick={handleCreate}
                  disabled={saving || !formName.trim()}
                >
                  {saving ? '创建中…' : '创建'}
                </button>
              </div>
            </LiquidGlass>
          </div>
        </div>
      )}

      {/* 创建成功后显示完整密钥 */}
      {newKey && (
        <div className="admin-modal-overlay" onClick={() => { setNewKey(null); setCopied(false) }}>
          <div onClick={e => e.stopPropagation()}>
            <LiquidGlass variant="strong" className="admin-modal">
              <h2 className="admin-modal-title">密钥已创建</h2>
              <div className="admin-modal-body">
                <p style={{ color: 'var(--lg-text-warning)', fontSize: '0.85rem', marginBottom: '12px' }}>
                  ⚠️ 这是唯一一次显示完整密钥，请立即复制并妥善保存。
                </p>
                <div className="admin-modal-key-display">
                  <code className="admin-modal-key-text">{newKey.key}</code>
                </div>
                <button
                  className="admin-modal-copy-btn"
                  onClick={handleCopyKey}
                >
                  {copied ? '✓ 已复制' : '📋 复制密钥'}
                </button>
              </div>
              <div className="admin-modal-footer">
                <button
                  className="admin-modal-btn admin-modal-btn--confirm"
                  onClick={() => { setNewKey(null); setCopied(false) }}
                >
                  我已安全保存
                </button>
              </div>
            </LiquidGlass>
          </div>
        </div>
      )}

      {/* 编辑弹窗 */}
      {showEdit && (
        <div className="admin-modal-overlay" onClick={() => setShowEdit(null)}>
          <div onClick={e => e.stopPropagation()}>
            <LiquidGlass variant="strong" className="admin-modal">
              <h2 className="admin-modal-title">编辑密钥</h2>
              <div className="admin-modal-body">
                <label className="admin-modal-label">名称</label>
                <input
                  className="admin-modal-input"
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="密钥名称"
                  autoFocus
                />
                <label className="admin-modal-label" style={{ marginTop: '16px' }}>过期时间（留空=永不过期）</label>
                <input
                  className="admin-modal-input"
                  type="date"
                  value={formExpires}
                  onChange={e => setFormExpires(e.target.value)}
                />
                <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="checkbox"
                    id="toggle-active"
                    checked={showEdit.active}
                    onChange={() => setShowEdit({ ...showEdit, active: !showEdit.active })}
                    style={{ accentColor: 'var(--lg-accent)' }}
                  />
                  <label htmlFor="toggle-active" style={{ color: 'var(--lg-text-secondary)', fontSize: '0.85rem', cursor: 'pointer' }}>
                    {showEdit.active ? '密钥已启用' : '密钥已禁用'}
                  </label>
                </div>
                {formError && <div className="admin-modal-error">{formError}</div>}
              </div>
              <div className="admin-modal-footer">
                <button className="admin-modal-btn admin-modal-btn--cancel" onClick={() => setShowEdit(null)}>
                  取消
                </button>
                <button
                  className="admin-modal-btn admin-modal-btn--confirm"
                  onClick={handleUpdate}
                  disabled={saving || !formName.trim()}
                >
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            </LiquidGlass>
          </div>
        </div>
      )}
    </div>
  )
}
