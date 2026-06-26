import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import api from '../lib/api'
import LiquidGlass from '../components/glass/LiquidGlass'
import LiquidButton from '../components/glass/LiquidButton'

interface PostDetail {
  id: number; title: string; content: string; summary: string | null
  slug: string; createdAt: string; updatedAt: string; author: { username: string }
}

interface CommentAuthor {
  id: number; username: string
}

interface CommentData {
  id: number
  content: string
  createdAt: string
  parentId: number | null
  author: CommentAuthor
  replies: CommentData[]
}

const CONTENT_MAX = 300

function CollapsibleContent({ content }: { content: string }) {
  const [showAll, setShowAll] = useState(false)
  const isLong = content.length > CONTENT_MAX

  return (
    <div>
      <div className="comment-content">
        {isLong && !showAll ? content.slice(0, CONTENT_MAX) + '…' : content}
      </div>
      {isLong && (
        <LiquidButton size="sm" variant="ghost" onClick={() => setShowAll(prev => !prev)} style={{ marginTop: '6px' }}>
          {showAll ? '收起' : '展开全部'}
        </LiquidButton>
      )}
    </div>
  )
}

function ReplyForm({
  parentId,
  postId,
  onReply,
  onCancel,
}: {
  parentId: number
  postId: number
  onReply: (reply: CommentData) => void
  onCancel: () => void
}) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    setError('')
    try {
      const reply = await api.post<CommentData>('/comments', { content: text, postId, parentId })
      // onReply 会触发 setShowReplyForm(false) 卸载本组件
      // 成功后不要再 touch 本地 state
      onReply(reply)
    } catch (err: any) {
      // 错误时组件未卸载，可以安全更新 state
      setError(err.message || '回复失败')
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSubmit()
    }
  }

  return (
    <div className="reply-form">
      <textarea
        className="lg-input reply-input"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="写下你的回复..."
        rows={2}
        maxLength={2000}
      />
      {error && <p className="comment-error">{error}</p>}
      <div className="reply-form-actions">
        <span className="text-tertiary" style={{ fontSize: '0.8rem' }}>{text.length}/2000</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <LiquidButton type="button" variant="primary" size="sm" onClick={handleSubmit} disabled={sending || !text.trim()}>
            {sending ? '发送中…' : '回复'}
          </LiquidButton>
          <LiquidButton type="button" variant="ghost" size="sm" onClick={onCancel}>
            取消
          </LiquidButton>
        </div>
      </div>
    </div>
  )
}

function ReplyItem({
  reply,
  postId,
}: {
  reply: CommentData
  postId: number
}) {
  return (
    <div className="reply-item">
      <div className="comment-meta">
        <span className="comment-author">{reply.author.username}</span>
        <span className="comment-time">{new Date(reply.createdAt).toLocaleString('zh-CN')}</span>
      </div>
      <CollapsibleContent content={reply.content} />
    </div>
  )
}

function CommentCard({
  comment,
  postId,
  onReplyAdded,
}: {
  comment: CommentData
  postId: number
  onReplyAdded: (parentId: number, r: CommentData) => void
}) {
  const { user } = useAuth()
  const [expanded, setExpanded] = useState(false) // 子评论默认折叠
  const [showReplyForm, setShowReplyForm] = useState(false)
  const hasReplies = comment.replies.length > 0
  const canReply = user // 主评论总能回复

  return (
    <div className="comment-item">
      <LiquidGlass variant="regular" interactive={false} chromatic={false} style={{ padding: '16px' }}>
        <div className="comment-meta">
          <span className="comment-author">{comment.author.username}</span>
          <span className="comment-time">{new Date(comment.createdAt).toLocaleString('zh-CN')}</span>
        </div>
        <CollapsibleContent content={comment.content} />

        <div className="comment-actions">
          {canReply && (
            <LiquidButton size="sm" variant="ghost" onClick={() => setShowReplyForm(prev => !prev)}>
              {showReplyForm ? '取消回复' : '回复'}
            </LiquidButton>
          )}
          {hasReplies && (
            <LiquidButton
              size="sm"
              variant="ghost"
              onClick={() => setExpanded(prev => !prev)}
              style={{ color: 'var(--lg-text-tertiary)' }}
            >
              {expanded ? `收起回复 (${comment.replies.length})` : `展开回复 (${comment.replies.length})`}
            </LiquidButton>
          )}
        </div>

        {showReplyForm && (
          <ReplyForm
            parentId={comment.id}
            postId={postId}
            onReply={r => { onReplyAdded(comment.id, r); setShowReplyForm(false) }}
            onCancel={() => setShowReplyForm(false)}
          />
        )}

        {hasReplies && expanded && (
          <div className="replies-section">
            {comment.replies.map(reply => (
              <ReplyItem
                  key={reply.id}
                  reply={reply}
                  postId={postId}
                />
            ))}
          </div>
        )}
      </LiquidGlass>
    </div>
  )
}

function CommentSection({ postId }: { postId: number }) {
  const { user } = useAuth()
  const [topLevel, setTopLevel] = useState<CommentData[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const fetchComments = () => {
    setLoading(true)
    api.get<CommentData[]>(`/comments/post/${postId}`)
      .then(setTopLevel)
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchComments() }, [postId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim() || sending) return
    setSending(true)
    setError('')
    try {
      const newComment = await api.post<CommentData>('/comments', { content: text, postId })
      setTopLevel(prev => [...prev, { ...newComment, replies: [] }])
      setText('')
    } catch (err: any) {
      setError(err.message || '发表评论失败')
    } finally {
      setSending(false)
    }
  }

  const handleReplyAdded = (parentId: number, reply: CommentData) => {
    const addReply = (comments: CommentData[]): CommentData[] =>
      comments.map(c => {
        if (c.id === parentId) {
          return { ...c, replies: [...(c.replies || []), { ...reply, replies: [] }] }
        }
        return { ...c, replies: addReply(c.replies || []) }
      })
    setTopLevel(prev => addReply(prev))
  }

  const totalComments = topLevel.reduce((sum, c) => sum + 1 + c.replies.length, 0)

  return (
    <LiquidGlass variant="blur" interactive={false} style={{ padding: '32px', marginTop: '32px' }}>
      <div className="comment-section">
        <h3 className="comment-heading">
          评论
          {totalComments > 0 && <span className="comment-count">{totalComments}</span>}
        </h3>

        {user ? (
          <form className="comment-form" onSubmit={handleSubmit}>
            <textarea
              className="lg-input comment-input"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="写下你的评论..."
              rows={3}
              maxLength={2000}
            />
            {error && <p className="comment-error">{error}</p>}
            <div className="comment-form-actions">
              <span className="text-tertiary comment-char-count">{text.length}/2000</span>
              <LiquidButton type="submit" variant="primary" size="sm" disabled={sending || !text.trim()}>
                {sending ? '发表中…' : '发表评论'}
              </LiquidButton>
            </div>
          </form>
        ) : (
          <div className="comment-login-prompt">
            <Link to="/login">登录</Link> 后可以发表评论
          </div>
        )}

        <div className="comment-list">
          {loading ? (
            <div className="comment-spinner"><div className="spinner" /></div>
          ) : topLevel.length === 0 ? (
            <p className="comment-empty">暂无评论</p>
          ) : (
            topLevel.map(comment => (
              <CommentCard
                key={comment.id}
                comment={comment}
                postId={postId}
                onReplyAdded={handleReplyAdded}
              />
            ))
          )}
        </div>
      </div>
    </LiquidGlass>
  )
}

export default function PostPage() {
  const { slug } = useParams<{ slug: string }>()
  const [post, setPost] = useState<PostDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    api.get<PostDetail>(`/posts/${slug}`)
      .then(setPost).catch(err => setError(err.message)).finally(() => setLoading(false))
  }, [slug])

  if (loading) return <div className="page container" style={{ display: 'flex', justifyContent: 'center', paddingTop: '120px' }}><div className="spinner" /></div>

  if (error || !post) {
    return (
      <div className="page container" style={{ textAlign: 'center', paddingTop: '120px' }}>
        <h2>文章未找到</h2>
        <p className="text-secondary" style={{ marginTop: '8px' }}>{error || '请检查链接是否正确'}</p>
        <Link to="/posts" className="liquid-btn glass" style={{ marginTop: '20px', display: 'inline-block', padding: '10px 24px', borderRadius: '9999px', background: 'var(--lg-glass-bg)', border: '1px solid var(--lg-glass-border)', textDecoration: 'none', color: 'var(--lg-text-primary)' }}>返回文章列表</Link>
      </div>
    )
  }

  return (
    <article className="page container" style={{ maxWidth: '720px' }}>
      <Link to="/posts" style={{ display: 'inline-block', marginBottom: '24px', fontSize: '0.9rem' }}>&larr; 返回文章列表</Link>

      <LiquidGlass variant="blur" interactive={false} style={{ padding: '32px' }}>
        <h1 className="post-title">{post.title}</h1>
        <div style={{ display: 'flex', gap: '16px', marginTop: '12px', marginBottom: '32px' }}>
          <span className="text-tertiary">{post.author.username}</span>
          <span className="text-tertiary">{new Date(post.createdAt).toLocaleDateString('zh-CN')}</span>
        </div>

        <div className="article-content" dangerouslySetInnerHTML={{ __html: post.content }} />
      </LiquidGlass>

      <div className="post-section-divider" />

      <CommentSection postId={post.id} />
    </article>
  )
}
