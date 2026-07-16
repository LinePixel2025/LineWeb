import { useState, useEffect, useCallback, memo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import api from '../../lib/api'
import UserAvatar from '../UserAvatar'
import LiquidGlass from '../glass/LiquidGlass'
import LiquidButton from '../glass/LiquidButton'
import type { CommentData } from '../../types/comment'

const CONTENT_MAX = 300

const CollapsibleContent = memo(function CollapsibleContent({ content }: { content: string }) {
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
})

const ReplyForm = memo(function ReplyForm({
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
      onReply(reply)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '回复失败')
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
})

const CommentCard = memo(function CommentCard({
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

  return (
    <div className="comment-item">
      <LiquidGlass variant="regular" interactive={false} chromatic={false} style={{ padding: '16px' }}>
        <div className="comment-meta">
          <UserAvatar userId={comment.author.id} username={comment.author.username} size="sm" />
          <span className="comment-author">{comment.author.username}</span>
          <span className="comment-time">{new Date(comment.createdAt).toLocaleString('zh-CN')}</span>
        </div>
        <CollapsibleContent content={comment.content} />

        <div className="comment-actions">
          {user && (
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
              <div key={reply.id} className="reply-item">
                <div className="comment-meta">
                  <UserAvatar userId={reply.author.id} username={reply.author.username} size="sm" />
                  <span className="comment-author">{reply.author.username}</span>
                  <span className="comment-time">{new Date(reply.createdAt).toLocaleString('zh-CN')}</span>
                </div>
                <CollapsibleContent content={reply.content} />
              </div>
            ))}
          </div>
        )}
      </LiquidGlass>
    </div>
  )
})

export default function CommentSection({ postId }: { postId: number }) {
  const { user } = useAuth()
  const [topLevel, setTopLevel] = useState<CommentData[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const fetchComments = useCallback(() => {
    setLoading(true)
    api.get<{ comments: CommentData[] }>(`/comments/post/${postId}`)
      .then(res => setTopLevel(res.comments || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [postId])

  useEffect(() => { fetchComments() }, [postId, fetchComments])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
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
  }, [postId, sending, text])

  // 服务器只支持一级嵌套，parentId 总是顶级评论 ID —— 直接 map 而非递归
  const handleReplyAdded = useCallback((parentId: number, reply: CommentData) => {
    setTopLevel(prev =>
      prev.map(c =>
        c.id === parentId
          ? { ...c, replies: [...c.replies, { ...reply, replies: [] }] }
          : c
      )
    )
  }, [])

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
            <Link to="/login" target="_blank" rel="noopener noreferrer">登录</Link> 后可以发表评论
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
