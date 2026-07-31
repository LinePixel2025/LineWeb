import { useCallback, useEffect, useState } from 'react'
import api from '@/lib/api'
import DailyGoalSetter from '@/components/DailyGoalSetter'

interface Token {
  id: number
  name: string
  token: string
  expiresAt: string | null
}

const EXPIRE_OPTIONS = [
  { label: '永久有效', value: '' },
  { label: '7 天', value: '7' },
  { label: '30 天', value: '30' },
]

function formatExpires(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString('zh-CN') : '永久有效'
}

export default function DigitalHealthSection() {
  const [tokens, setTokens] = useState<Token[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('Time Master')
  const [expireDays, setExpireDays] = useState('')
  const [creating, setCreating] = useState(false)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const fetchTokens = useCallback(async () => {
    try {
      setLoading(true)
      const result = await api.get<{ tokens: Token[] }>('/health/tokens')
      setTokens(result.tokens)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载同步连接失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTokens()
  }, [fetchTokens])

  const handleCreate = async () => {
    setCreating(true)
    setError('')
    setNewToken(null)
    try {
      const body: { name: string; expiresAt?: string } = { name: name.trim() || 'Time Master' }
      if (expireDays) {
        const expiresAt = new Date()
        expiresAt.setDate(expiresAt.getDate() + parseInt(expireDays, 10))
        body.expiresAt = expiresAt.toISOString()
      }
      const result = await api.post<Token & { token: string }>('/health/tokens', body)
      setNewToken(result.token)
      await fetchTokens()
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成同步密钥失败，请稍后重试。')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!window.confirm('确定删除这个同步连接吗？已配置该密钥的设备将无法继续同步。')) return
    try {
      await api.delete(`/health/tokens/${id}`)
      await fetchTokens()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除同步连接失败，请稍后重试。')
    }
  }

  const handleCopy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('无法自动复制，请手动复制密钥。')
    }
  }

  return (
    <div id="digital-health" className="digital-health-settings">
      <div className="digital-health-settings__intro">
        <div className="digital-health-settings__title-mark" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 14.25s-5.5-3.4-5.5-8.1A2.65 2.65 0 0 1 7.1 4.32L8 5.2l.9-.88a2.65 2.65 0 0 1 4.6 1.83c0 4.7-5.5 8.1-5.5 8.1Z" />
          </svg>
        </div>
        <div>
          <h2>数字健康</h2>
          <p>设置今天的屏幕使用边界，并管理 Time Master 的同步连接。</p>
        </div>
      </div>

      <DailyGoalSetter />

      <section className="digital-health-settings__section" aria-labelledby="sync-title">
        <div className="digital-health-settings__section-header">
          <div>
            <h3 id="sync-title">同步连接</h3>
            <p>为每台设备创建独立密钥，便于随时撤销访问权限。</p>
          </div>
        </div>

        {newToken && (
          <div className="digital-health-token-reveal" role="status">
            <div>
              <strong>请立即保存此密钥</strong>
              <p>出于安全考虑，它只会显示这一次。</p>
            </div>
            <div className="digital-health-token-reveal__value">
              <code>{newToken}</code>
              <button type="button" onClick={() => handleCopy(newToken)} className="gh-btn gh-btn--secondary gh-btn--sm">{copied ? '已复制' : '复制'}</button>
            </div>
          </div>
        )}

        <div className="digital-health-token-form">
          <label>
            <span>设备名称</span>
            <input type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：我的电脑" className="gh-input" />
          </label>
          <label>
            <span>有效期</span>
            <select value={expireDays} onChange={(event) => setExpireDays(event.target.value)} className="gh-input">
              {EXPIRE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button type="button" onClick={handleCreate} disabled={creating} className="gh-btn gh-btn--primary gh-btn--sm">
            {creating ? '生成中…' : '生成密钥'}
          </button>
        </div>

        <div className="digital-health-token-list" aria-live="polite">
          <div className="digital-health-token-list__header">
            <span>已连接的设备</span>
            {!loading && <span>{tokens.length} 个</span>}
          </div>
          {loading ? (
            <div className="digital-health-settings__loading">正在加载同步连接…</div>
          ) : tokens.length === 0 ? (
            <div className="digital-health-token-list__empty">尚未创建同步连接。</div>
          ) : (
            tokens.map((token) => (
              <div key={token.id} className="digital-health-token-row">
                <div>
                  <strong>{token.name}</strong>
                  <span><code>{token.token}</code> · 有效期至 {formatExpires(token.expiresAt)}</span>
                </div>
                <button type="button" onClick={() => handleDelete(token.id)} className="gh-btn gh-btn--danger gh-btn--sm">撤销</button>
              </div>
            ))
          )}
        </div>
      </section>

      {error && <p className="digital-health-form-error" role="alert">{error}</p>}
    </div>
  )
}
