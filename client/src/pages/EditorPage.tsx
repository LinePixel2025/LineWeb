import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../lib/api'
import LiquidButton from '../components/glass/LiquidButton'
import LexicalEditor from '../components/editor/LexicalEditor'

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
      <div className="admin-spinner">
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div className="admin-page" style={{ maxWidth: 820 }}>
      <div className="admin-page-header">
        <h1 className="admin-page-title">{isEdit ? '编辑文章' : '写文章'}</h1>
      </div>

      {/* error banner */}
      {error && <div className="editor-error">{error}</div>}

      <form onSubmit={handleSubmit}>
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

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div className="editor-field" style={{ flex: 1, minWidth: 180 }}>
            <label className="editor-label">Slug</label>
            <input
              className="lg-input"
              value={slug}
              onChange={e => setSlug(e.target.value)}
              placeholder={title ? toSlug(title) : 'article-slug'}
            />
          </div>

          <div className="editor-field" style={{ flex: 2, minWidth: 240 }}>
            <label className="editor-label">摘要</label>
            <input
              className="lg-input"
              value={summary}
              onChange={e => setSummary(e.target.value)}
              placeholder="文章摘要（可选）"
            />
          </div>
        </div>

        <div className="editor-field">
          <label className="editor-label">内容</label>
          <LexicalEditor
            initialHtml={content}
            onChange={html => setContent(html)}
            placeholder="开始写作..."
            height={480}
          />
        </div>

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
    </div>
  )
}
