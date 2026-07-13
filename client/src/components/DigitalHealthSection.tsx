import { useState, useEffect, useCallback } from 'react'
import api from '@/lib/api'
import LiquidGlass from '@/components/glass/LiquidGlass'

interface Token {
  id: number
  name: string
  token: string
  expiresAt: string | null
  createdAt: string
}

const EXPIRE_OPTIONS = [
  { label: '永久', value: '' },
  { label: '7 天', value: '7' },
  { label: '30 天', value: '30' },
]

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
      const res = await api.get<{ tokens: Token[] }>('/health/tokens')
      setTokens(res.tokens)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
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
      const body: { name: string; expiresAt?: string } = { name }
      if (expireDays) {
        const d = new Date()
        d.setDate(d.getDate() + parseInt(expireDays, 10))
        body.expiresAt = d.toISOString()
      }
      const res = await api.post<Token & { token: string }>('/health/tokens', body)
      setNewToken(res.token)
      await fetchTokens()
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!window.confirm('确定删除这个 Token？')) return
    try {
      await api.delete(`/health/tokens/${id}`)
      await fetchTokens()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  const handleCopy = async (token: string) => {
    await navigator.clipboard.writeText(token)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const formatExpires = (iso: string | null) => {
    if (!iso) return '永久'
    return new Date(iso).toLocaleDateString('zh-CN')
  }

  return (
    <div id="digital-health">
    <LiquidGlass variant="strong" chromatic={false} className="profile-card">
      <h2 style={{ margin: '0 0 22px', fontSize: '1.1rem', fontWeight: 600, color: 'var(--lg-text-primary)' }}>数字健康</h2>
      <p className="text-secondary" style={{ fontSize: '0.9rem', marginBottom: '22px' }}>
        连接 Time Master 以同步屏幕时间。在本地脚本中配置 Token 后，数据会定期推送到 LineWeb。
      </p>

      {newToken && (
        <div style={{ marginBottom: '22px', padding: '14px', borderRadius: '12px', background: 'rgba(41,151,255,0.08)', border: '1px solid rgba(41,151,255,0.2)' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--lg-accent)', marginBottom: '8px' }}>Token 仅显示一次，请立即复制</div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <code style={{ flex: 1, wordBreak: 'break-all', fontSize: '0.85rem', color: 'var(--lg-text-primary)' }}>{newToken}</code>
            <button onClick={() => handleCopy(newToken)} className="liquid-btn glass sm">
              {copied ? '已复制' : '复制'}
            </button>
          </div>
        </div>
      )}

      <div style={{ marginBottom: '22px' }}>
        <span className="profile-label">生成新 Token</span>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="名称"
            style={{ flex: 1, minWidth: '140px', padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)', color: '#fff', fontFamily: 'var(--lg-font)', fontSize: '0.85rem' }}
          />
          <select
            value={expireDays}
            onChange={(e) => setExpireDays(e.target.value)}
            style={{ padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)', color: '#fff', fontFamily: 'var(--lg-font)', fontSize: '0.85rem' }}
          >
            {EXPIRE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
        <button onClick={handleCreate} disabled={creating} className="liquid-btn primary sm">
          {creating ? '生成中…' : '生成 Token'}
        </button>
      </div>

      {error && <div style={{ color: 'var(--lg-danger)', fontSize: '0.85rem', marginBottom: '16px' }}>{error}</div>}

      <div>
        <span className="profile-label">已连接的 Token</span>
        {loading ? (
          <div className="text-tertiary" style={{ padding: '20px 0', fontSize: '0.85rem' }}>加载中…</div>
        ) : tokens.length === 0 ? (
          <div className="text-tertiary" style={{ padding: '20px 0', fontSize: '0.85rem' }}>暂无 Token</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {tokens.map(t => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div>
                  <div style={{ fontSize: '0.92rem', fontWeight: 500, color: 'var(--lg-text-primary)' }}>{t.name}</div>
                  <div className="text-tertiary" style={{ fontSize: '0.78rem', marginTop: '2px' }}>{t.token} · 有效期至 {formatExpires(t.expiresAt)}</div>
                </div>
                <button onClick={() => handleDelete(t.id)} className="liquid-btn danger sm">删除</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </LiquidGlass>
    </div>
  )
}
