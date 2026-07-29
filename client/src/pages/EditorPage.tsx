import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../lib/api'
import { GitHubButton } from '../components/ui'
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  /* ------- loading state ------- */
  if (fetching) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--gh-space-7)' }}>
        <div className="gh-spinner" />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <div className="gh-page-header">
        <h1>{isEdit ? '编辑文章' : '写文章'}</h1>
      </div>

      {error && (
        <div style={{
          padding: '8px 16px', marginBottom: 'var(--gh-space-4)',
          borderRadius: 'var(--gh-radius)', color: 'var(--gh-danger)',
          background: 'var(--gh-danger-soft)', fontSize: 'var(--gh-text-sm)',
        }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 'var(--gh-space-4)' }}>
          <label style={{
            display: 'block', marginBottom: 'var(--gh-space-1)',
            fontWeight: 600, fontSize: 'var(--gh-text-sm)', color: 'var(--gh-text)',
          }}>
            标题
          </label>
          <input
            className="gh-input gh-input--full"
            value={title}
            onChange={e => setTitle(e.target.value)}
            required
            placeholder="文章标题"
          />
        </div>

        <div style={{ marginBottom: 'var(--gh-space-4)' }}>
          <label style={{
            display: 'block', marginBottom: 'var(--gh-space-1)',
            fontWeight: 600, fontSize: 'var(--gh-text-sm)', color: 'var(--gh-text)',
          }}>
            Slug
          </label>
          <input
            className="gh-input gh-input--full"
            value={slug}
            onChange={e => setSlug(e.target.value)}
            placeholder={title ? toSlug(title) : 'article-slug'}
          />
        </div>

        <div style={{ marginBottom: 'var(--gh-space-4)' }}>
          <label style={{
            display: 'block', marginBottom: 'var(--gh-space-1)',
            fontWeight: 600, fontSize: 'var(--gh-text-sm)', color: 'var(--gh-text)',
          }}>
            摘要
          </label>
          <input
            className="gh-input gh-input--full"
            value={summary}
            onChange={e => setSummary(e.target.value)}
            placeholder="文章摘要（可选）"
          />
        </div>

        <div style={{ marginBottom: 'var(--gh-space-4)' }}>
          <label style={{
            display: 'block', marginBottom: 'var(--gh-space-1)',
            fontWeight: 600, fontSize: 'var(--gh-text-sm)', color: 'var(--gh-text)',
          }}>
            内容
          </label>
          <LexicalEditor
            initialHtml={content}
            onChange={html => setContent(html)}
            placeholder="开始写作..."
            height={480}
          />
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          paddingTop: 'var(--gh-space-4)', borderTop: '1px solid var(--gh-border)',
        }}>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 'var(--gh-space-2)',
            cursor: 'pointer', fontSize: 'var(--gh-text-sm)', color: 'var(--gh-text)',
          }}>
            <input
              type="checkbox"
              checked={published}
              onChange={e => setPublished(e.target.checked)}
              style={{ accentColor: 'var(--gh-accent)' }}
            />
            发布
          </label>

          <div style={{ display: 'flex', gap: 'var(--gh-space-2)' }}>
            <GitHubButton type="submit" variant="primary" size="lg" disabled={saving}>
              {saving ? '保存中…' : isEdit ? '更新文章' : '发布文章'}
            </GitHubButton>
            <GitHubButton type="button" variant="secondary" size="lg" onClick={() => navigate('/admin')}>
              取消
            </GitHubButton>
          </div>
        </div>
      </form>
    </div>
  )
}
