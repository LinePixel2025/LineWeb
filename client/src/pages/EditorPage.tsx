import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../lib/api'

export default function EditorPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [summary, setSummary] = useState('')
  const [content, setContent] = useState('')
  const [published, setPublished] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(isEdit)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    api.get<{ id: number; title: string; content: string; summary: string | null; slug: string; published: boolean }>(`/posts/admin/${id}`)
      .then(d => { setTitle(d.title); setSlug(d.slug); setSummary(d.summary || ''); setContent(d.content); setPublished(d.published) })
      .catch(err => setError(err.message))
      .finally(() => setFetching(false))
  }, [id])

  const genSlug = (t: string) => t.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true)
    const finalSlug = slug || genSlug(title)
    if (!finalSlug) { setError('请输入标题或 Slug'); setLoading(false); return }
    try {
      if (isEdit) await api.put(`/posts/${id}`, { title, slug: finalSlug, summary: summary || title.substring(0, 200), content, published })
      else await api.post('/posts', { title, slug: finalSlug, summary: summary || title.substring(0, 200), content, published })
      navigate('/admin')
    } catch (err: any) { setError(err.message || '保存失败') } finally { setLoading(false) }
  }

  if (fetching) return <div className="page container" style={{ display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>

  return (
    <div className="page container glass-rise" style={{ maxWidth: '720px' }}>
      <h1 style={{ marginBottom: '24px' }}>{isEdit ? '编辑文章' : '写文章'}</h1>

      {error && (
        <div style={{
          background: 'rgba(255,59,48,0.12)', color: 'var(--lg-danger)',
          padding: '10px 14px', borderRadius: 'var(--lg-radius-md)', marginBottom: '16px', fontSize: '0.88rem',
        }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div className="lg-surface-strong lg-surface-strong-blur" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label className="text-tertiary" style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem' }}>标题</label>
            <input className="lg-input" value={title} onChange={e => setTitle(e.target.value)} required placeholder="文章标题" />
          </div>
          <div>
            <label className="text-tertiary" style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem' }}>Slug</label>
            <input className="lg-input" value={slug} onChange={e => setSlug(e.target.value)} placeholder="article-slug" />
          </div>
          <div>
            <label className="text-tertiary" style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem' }}>摘要</label>
            <input className="lg-input" value={summary} onChange={e => setSummary(e.target.value)} placeholder="文章摘要（可选）" />
          </div>
          <div>
            <label className="text-tertiary" style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem' }}>内容（Markdown）</label>
            <textarea
              className="lg-input"
              value={content} onChange={e => setContent(e.target.value)}
              required placeholder="使用 Markdown 编写..."
              style={{ minHeight: '300px', fontFamily: 'var(--lg-font-mono)', fontSize: '0.9rem', lineHeight: 1.6, resize: 'vertical' }}
            />
          </div>
          <div className="lg-surface-blur" style={{ padding: '16px', maxHeight: '200px', overflowY: 'auto', borderRadius: 'var(--lg-radius-md)' }}>
            <div className="text-tertiary" style={{ fontSize: '0.78rem', marginBottom: '8px' }}>预览</div>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--lg-font)' }}>{content.slice(0, 500)}{content.length > 500 ? '...' : ''}</pre>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0 4px' }}>
          <input type="checkbox" id="published" checked={published} onChange={e => setPublished(e.target.checked)}
            style={{ width: '18px', height: '18px', accentColor: 'var(--lg-accent)' }} />
          <label htmlFor="published" style={{ fontSize: '0.9rem' }}>发布</label>
        </div>
        <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
          <button type="submit" disabled={loading}
            style={{
              padding: '14px 32px', borderRadius: '9999px', fontWeight: 500, fontSize: '1rem',
              background: 'linear-gradient(135deg, var(--lg-accent), #40a9ff)', color: 'white', border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1,
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3), 0 4px 12px var(--lg-accent-glow)',
              fontFamily: 'var(--lg-font)',
            }}
          >
            {loading ? '保存中...' : (isEdit ? '更新文章' : '发布文章')}
          </button>
          <button type="button" onClick={() => navigate('/admin')}
            style={{
              padding: '14px 32px', borderRadius: '9999px', fontWeight: 500, fontSize: '1rem',
              background: 'var(--lg-glass-bg)', color: 'var(--lg-text-primary)', border: '1px solid var(--lg-glass-border)',
              cursor: 'pointer', fontFamily: 'var(--lg-font)',
            }}
          >
            取消
          </button>
        </div>
      </form>
    </div>
  )
}
