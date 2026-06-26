import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../lib/api'
import LiquidButton from '../components/glass/LiquidButton'
import LiquidGlass from '../components/glass/LiquidGlass'

/* ---------- helpers ---------- */

function toSlug(t: string) {
  return t
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

/* ---------- types ---------- */

interface PostData {
  id: number
  title: string
  content: string
  summary: string | null
  slug: string
  published: boolean
}

/* ---------- component ---------- */

export default function EditorPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [summary, setSummary] = useState('')
  const [content, setContent] = useState('')
  const [published, setPublished] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fetching, setFetching] = useState(isEdit)
  const [error, setError] = useState('')

  /* load existing post */
  useEffect(() => {
    if (!id) return
    api.get<PostData>(`/posts/admin/${id}`)
      .then(d => {
        setTitle(d.title)
        setSlug(d.slug)
        setSummary(d.summary ?? '')
        setContent(d.content)
        setPublished(d.published)
      })
      .catch(err => setError(err.message))
      .finally(() => setFetching(false))
  }, [id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)

    const finalSlug = slug || toSlug(title)
    if (!finalSlug) {
      setError('请输入标题或 Slug')
      setSaving(false)
      return
    }

    const payload = {
      title,
      slug: finalSlug,
      summary: summary || title.substring(0, 200),
      content,
      published,
    }

    try {
      if (isEdit) {
        await api.put(`/posts/${id}`, payload)
      } else {
        await api.post('/posts', payload)
      }
      navigate('/admin')
    } catch (err: any) {
      setError(err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  /* ------- loading state ------- */
  if (fetching) {
    return (
      <div className="page container" style={{ display: 'flex', justifyContent: 'center' }}>
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div className="page container" style={{ maxWidth: 720, margin: '0 auto', paddingTop: 'calc(var(--lg-nav-height) + var(--lg-safe-top) + 24px)' }}>
      <LiquidGlass
        variant="blur"
        chromatic={false}
        className="glass-rise editor-page-glass"
      >
      <h1 style={{ marginBottom: 16, fontSize: '1.5rem' }}>{isEdit ? '编辑文章' : '写文章'}</h1>

      {/* error banner */}
      {error && <div className="editor-error">{error}</div>}

      <form onSubmit={handleSubmit} className="editor-form">
        <div className="editor-field">
          <label className="editor-label">标题</label>
          <input
            className="lg-input"
            value={title}
            onChange={e => setTitle(e.target.value)}
            required
            placeholder="文章标题"
          />
        </div>

        <div className="editor-field">
          <label className="editor-label">Slug</label>
          <input
            className="lg-input"
            value={slug}
            onChange={e => setSlug(e.target.value)}
            placeholder={title ? toSlug(title) : 'article-slug'}
          />
        </div>

        <div className="editor-field">
          <label className="editor-label">摘要</label>
          <input
            className="lg-input"
            value={summary}
            onChange={e => setSummary(e.target.value)}
            placeholder="文章摘要（可选）"
          />
        </div>

        <div className="editor-field">
          <label className="editor-label">
            内容 <span className="text-tertiary" style={{ fontWeight: 400 }}>— HTML</span>
          </label>
          <textarea
            className="lg-input editor-textarea"
            value={content}
            onChange={e => setContent(e.target.value)}
            required
            placeholder="使用 HTML 编写..."
          />
        </div>

        {/* preview */}
        <LiquidGlass variant="regular" chromatic={false} className="editor-preview">
          <div className="text-tertiary editor-preview-label">预览</div>
          {content ? (
            content.length > 1500 ? (
              <div className="article-content" dangerouslySetInnerHTML={{
                __html: content.slice(0, 1500) + '\n\n<hr>\n<p><em>（预览截断 — 继续输入可看到更多）</em></p>'
              }} />
            ) : (
              <div className="article-content" dangerouslySetInnerHTML={{ __html: content }} />
            )
          ) : (
            <p className="text-secondary" style={{ fontSize: '0.85rem' }}>
              输入 HTML 内容后预览将显示在此处
            </p>
          )}
        </LiquidGlass>

        {/* controls */}
        <div className="editor-controls">
          <label className="editor-checkbox">
            <input
              type="checkbox"
              checked={published}
              onChange={e => setPublished(e.target.checked)}
            />
            发布
          </label>

          <div className="editor-actions">
            <LiquidButton type="submit" variant="primary" size="lg" disabled={saving}>
              {saving ? '保存中…' : isEdit ? '更新文章' : '发布文章'}
            </LiquidButton>
            <LiquidButton type="button" variant="glass" size="lg" onClick={() => navigate('/admin')}>
              取消
            </LiquidButton>
          </div>
        </div>
      </form>
      </LiquidGlass>
    </div>
  )
}
