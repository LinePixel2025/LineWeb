import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import DOMPurify from 'dompurify'
import api from '../lib/api'
import { GitHubButton } from '../components/ui'
import LexicalEditor from '../components/editor/LexicalEditor'
import { calcReadingTime, countWords, stripHtml } from '../lib/textStats'
import { aiWriteSummary, aiWriteTitles } from '../lib/aiWrite'

/* ---------- helpers ---------- */

/**
 * 由标题自动生成 slug：保留中文、字母数字与连字符，空白转 '-'。
 * （旧实现剥掉了全部中文字符，中文标题会生成空 slug 导致保存失败）
 */
function toSlug(t: string) {
  return t
    .toLowerCase()
    .replace(/[^\p{Script=Han}a-z0-9_\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

interface PostData {
  id: number
  title: string
  content: string
  summary: string | null
  slug: string
  published: boolean
  updatedAt?: string
}

interface DraftSnapshot {
  title: string
  slug: string
  manualSlug: boolean
  summary: string
  content: string
  published: boolean
  savedAt: number
}

function draftKey(id?: string) {
  return `lineweb-article-draft-${id ?? 'new'}`
}

/* ---------- component ---------- */

export default function EditorPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [manualSlug, setManualSlug] = useState(false)
  const [summary, setSummary] = useState('')
  const [content, setContent] = useState('')
  const [published, setPublished] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fetching, setFetching] = useState(isEdit)
  const [error, setError] = useState('')
  const [panelOpen, setPanelOpen] = useState(true)
  const [preview, setPreview] = useState(false)
  const [flash, setFlash] = useState('')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [pendingDraft, setPendingDraft] = useState<DraftSnapshot | null>(null)
  const [aiLoading, setAiLoading] = useState<'' | 'summary' | 'titles'>('')
  const [titleIdeas, setTitleIdeas] = useState<string[]>([])
  const [editorReset, setEditorReset] = useState(0)
  const loadedRef = useRef(false)
  const flashTimer = useRef<number | undefined>(undefined)

  const flashNote = useCallback((msg: string) => {
    setFlash(msg)
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlash(''), 4000)
  }, [])

  /* ------- 加载已有文章，并检测本地草稿 ------- */
  useEffect(() => {
    const stored = (() => {
      try {
        const raw = localStorage.getItem(draftKey(id))
        return raw ? (JSON.parse(raw) as DraftSnapshot) : null
      } catch { return null }
    })()

    if (!isEdit) {
      if (stored && (stored.title || stored.content)) setPendingDraft(stored)
      loadedRef.current = true
      return
    }
    api.get<PostData>(`/posts/admin/${id}`)
      .then(d => {
        setTitle(d.title)
        setSlug(d.slug)
        setSummary(d.summary ?? '')
        setContent(d.content)
        setPublished(d.published)
        const updatedAtMs = d.updatedAt ? Date.parse(d.updatedAt) : 0
        if (stored && stored.savedAt > updatedAtMs) {
          setPendingDraft(stored)
        }
      })
      .catch(err => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => {
        setFetching(false)
        loadedRef.current = true
      })
  }, [id, isEdit])

  /* ------- 本地草稿自动保存（防抖 1.5s） ------- */
  useEffect(() => {
    if (!loadedRef.current || !title && !content) return
    const timer = window.setTimeout(() => {
      const snapshot: DraftSnapshot = { title, slug, manualSlug, summary, content, published, savedAt: Date.now() }
      try {
        localStorage.setItem(draftKey(id), JSON.stringify(snapshot))
        setSavedAt(snapshot.savedAt)
      } catch { /* 存储满时静默失败 */ }
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [title, slug, manualSlug, summary, content, published, id])

  const applyDraft = (d: DraftSnapshot) => {
    setTitle(d.title); setSlug(d.slug); setManualSlug(d.manualSlug)
    setSummary(d.summary); setContent(d.content); setPublished(d.published)
    setPendingDraft(null)
    // 草稿是「外部整体替换正文」，需重建 Composer 才会读入新内容
    setEditorReset(n => n + 1)
    loadedRef.current = true
  }

  const discardDraft = () => {
    localStorage.removeItem(draftKey(id))
    setPendingDraft(null)
  }

  /* ------- AI ------- */

  const requireContent = (): boolean => {
    if (!stripHtml(content)) { flashNote('请先写点正文内容'); return false }
    return true
  }

  const runSummary = async () => {
    if (!requireContent()) return
    setAiLoading('summary'); setError('')
    try {
      setSummary(await aiWriteSummary(content))
      flashNote('摘要已生成')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 摘要失败')
    } finally { setAiLoading('') }
  }

  const runTitles = async () => {
    if (!requireContent()) return
    setAiLoading('titles'); setError(''); setTitleIdeas([])
    try {
      setTitleIdeas(await aiWriteTitles(content, summary || undefined))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 标题失败')
    } finally { setAiLoading('') }
  }

  /* ------- 保存 ------- */

  const autoSlug = slug && manualSlug ? slug : toSlug(title)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const finalSlug = autoSlug
    if (!finalSlug) {
      setError('请输入标题')
      return
    }
    setSaving(true)
    const payload = {
      title,
      slug: finalSlug,
      summary: summary || undefined,
      content,
      published,
    }
    try {
      if (isEdit) {
        await api.put(`/posts/${id}`, payload)
      } else {
        await api.post('/posts', payload)
      }
      localStorage.removeItem(draftKey(id))
      navigate('/admin')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const words = useMemo(() => countWords(stripHtml(content)), [content])
  const minutes = useMemo(() => calcReadingTime(content), [content])

  /* ------- loading ------- */
  if (fetching) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--gh-space-7)' }}>
        <div className="gh-spinner" />
      </div>
    )
  }

  return (
    <div className={`article-editor${panelOpen ? '' : ' article-editor--wide'}`}>
      {/* 顶栏 */}
      <div className="article-editor-topbar">
        <div className="article-editor-topbar-left">
          <button type="button" className="article-editor-back" onClick={() => navigate('/admin')}>← 返回</button>
          <span className="lex-div" />
          <div className="article-editor-status-seg" role="radiogroup" aria-label="发布状态">
            <button
              type="button" role="radio" aria-checked={!published}
              className={!published ? 'is-on' : ''}
              onClick={() => setPublished(false)}
            >草稿</button>
            <button
              type="button" role="radio" aria-checked={published}
              className={published ? 'is-on' : ''}
              onClick={() => setPublished(true)}
            >发布</button>
          </div>
        </div>
        <div className="article-editor-topbar-right">
          <GitHubButton
            type="button" variant="ghost" size="sm"
            onClick={() => setPreview(p => !p)}
          >{preview ? '继续编辑' : '预览'}</GitHubButton>
          <button
            type="button" className="article-editor-panel-toggle"
            onClick={() => setPanelOpen(o => !o)}
          >{panelOpen ? '收起设置 ▸' : '◂ 发布设置'}</button>
          <GitHubButton type="submit" form="article-form" variant="primary" size="sm" disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </GitHubButton>
        </div>
      </div>

      {/* 草稿恢复提示 */}
      {pendingDraft && (
        <div className="article-editor-draftbar" role="status">
          <span>发现 {new Date(pendingDraft.savedAt).toLocaleString('zh-CN')} 的本地未保存草稿，是否恢复？</span>
          <div>
            <button type="button" className="gh-btn gh-btn--sm gh-btn--primary" onClick={() => applyDraft(pendingDraft)}>恢复</button>
            <button type="button" className="gh-btn gh-btn--sm gh-btn--ghost" onClick={discardDraft}>丢弃</button>
          </div>
        </div>
      )}

      {error && <div className="article-editor-error">{error}</div>}

      <div className="article-editor-body">
        <form id="article-form" onSubmit={handleSubmit} className="article-editor-work">
          <input
            className="article-editor-title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="输入标题…"
            required
            aria-label="文章标题"
            maxLength={200}
          />
          {preview ? (
            <div
              className="article-content article-editor-preview"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content || '<p class="gh-text-tertiary">（暂无内容）</p>') }}
            />
          ) : (
            <LexicalEditor
              initialHtml={content}
              onChange={html => setContent(html)}
              placeholder="开始写作…（输入 # 、- 、1. 、> 可快捷排版）"
              resetKey={editorReset}
            />
          )}
        </form>

        {/* 右侧发布设置面板 */}
        {panelOpen && (
          <aside className="article-editor-panel">
            <div className="article-editor-panel-card">
              <h4 className="gh-box-heading">Slug（文章地址）</h4>
              {!manualSlug ? (
                <>
                  <code className="article-editor-slug">/posts/{autoSlug || '自动生成'}</code>
                  <button type="button" className="article-editor-linkbtn" onClick={() => { setManualSlug(true); setSlug(slug || autoSlug) }}>
                    自定义地址
                  </button>
                </>
              ) : (
                <input
                  className="gh-input"
                  value={slug}
                  onChange={e => setSlug(e.target.value.replace(/\s+/g, '-').toLowerCase())}
                  placeholder={toSlug(title) || 'article-slug'}
                  maxLength={255}
                />
              )}
            </div>

            <div className="article-editor-panel-card">
              <h4 className="gh-box-heading">摘要</h4>
              <textarea
                className="gh-input"
                rows={4}
                value={summary}
                onChange={e => setSummary(e.target.value)}
                placeholder="选填。展示在文章列表与首页卡片中"
                maxLength={500}
              />
              <button
                type="button" className="article-editor-aibtn"
                disabled={aiLoading !== ''}
                onClick={runSummary}
              >
                {aiLoading === 'summary' ? '生成中…' : '✨ AI 生成摘要'}
              </button>
            </div>

            <div className="article-editor-panel-card">
              <h4 className="gh-box-heading">标题建议</h4>
              {titleIdeas.length === 0 ? (
                <p className="gh-text-tertiary article-editor-hint">写完正文后让 AI 起几个标题</p>
              ) : (
                <ul className="article-editor-ideas">
                  {titleIdeas.map(t => (
                    <li key={t}>
                      <button type="button" onClick={() => { setTitle(t); setTitleIdeas([]); flashNote('已应用标题') }}>{t}</button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button" className="article-editor-aibtn"
                disabled={aiLoading !== ''}
                onClick={runTitles}
              >
                {aiLoading === 'titles' ? '生成中…' : '✨ AI 起标题'}
              </button>
            </div>

            <div className="article-editor-panel-card">
              <p className="gh-text-tertiary article-editor-hint">
                正文内容自动保存到本地浏览器；点「保存」写入服务器。
              </p>
            </div>
          </aside>
        )}
      </div>

      {/* 底部状态栏 */}
      <div className="article-editor-statusbar">
        <span>{words} 字 · 约 {minutes} 分钟</span>
        {flash && <span className="article-editor-flash">{flash}</span>}
        <span className="article-editor-saved">
          {savedAt ? `草稿已自动保存 ${new Date(savedAt).toLocaleTimeString('zh-CN')}` : '未保存'}
        </span>
      </div>
    </div>
  )
}
