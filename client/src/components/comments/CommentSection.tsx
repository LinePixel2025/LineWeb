import { useState, useEffect, useCallback, memo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import api from '../../lib/api'
import UserAvatar from '../UserAvatar'
import { GitHubButton } from '../ui'
import type { CommentData } from '../../types/comment'

const CONTENT_MAX = 300

function formatCommentTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

const CollapsibleContent = memo(function CollapsibleContent({ content }: { content: string }) {
  const [showAll, setShowAll] = useState(false)
  const isLong = content.length > CONTENT_MAX

  return (
    <div className="comment-copy">
      <div className="comment-content">
        {isLong && !showAll ? content.slice(0, CONTENT_MAX) + '…' : content}
      </div>
      {isLong && (
        <GitHubButton className="comment-expand-button" size="sm" variant="secondary" onClick={() => setShowAll(prev => !prev)}>
          {showAll ? '收起' : '展开全部'}
        </GitHubButton>
      )}
    </div>
  )
})

const ReplyForm = memo(function ReplyForm({
  parentId,
  postId,
  replyTo,
  onReply,
  onCancel,
}: {
  parentId: number
  postId: number
  replyTo: string
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
      <div className="reply-form-header">回复 <strong>@{replyTo}</strong></div>
      <textarea
        className="gh-input gh-input--full reply-input"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="写下回复"
        aria-label={`回复 ${replyTo}`}
        rows={3}
        maxLength={2000}
      />
      {error && <p className="comment-error">{error}</p>}
      <div className="reply-form-actions">
        <span className="comment-char-count">{text.length}/2000</span>
        <div className="reply-form-buttons">
          <GitHubButton type="button" variant="ghost" size="sm" onClick={onCancel}>
            取消
          </GitHubButton>
          <GitHubButton type="button" variant="primary" size="sm" onClick={handleSubmit} disabled={sending || !text.trim()}>
            {sending ? '发送中…' : '回复'}
          </GitHubButton>
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
      <div className="comment-avatar">
        <UserAvatar userId={comment.author.id} username={comment.author.username} size="md" />
      </div>
      <article className="comment-card">
        <header className="comment-meta">
          <strong className="comment-author">{comment.author.username}</strong>
          <span className="comment-time">
            评论于 <time dateTime={comment.createdAt}>{formatCommentTime(comment.createdAt)}</time>
          </span>
        </header>
        <div className="comment-body">
          <CollapsibleContent content={comment.content} />
        </div>

        <div className="comment-actions">
          {user && (
            <GitHubButton className="comment-action-button" size="sm" variant="ghost" onClick={() => setShowReplyForm(prev => !prev)}>
              {showReplyForm ? '取消回复' : '回复'}
            </GitHubButton>
          )}
          {hasReplies && (
            <GitHubButton
              size="sm"
              variant="ghost"
              className="comment-action-button"
              onClick={() => setExpanded(prev => !prev)}
            >
              {expanded ? `收起回复 (${comment.replies.length})` : `展开回复 (${comment.replies.length})`}
            </GitHubButton>
          )}
        </div>

        {showReplyForm && (
          <ReplyForm
            parentId={comment.id}
            postId={postId}
            replyTo={comment.author.username}
            onReply={r => { onReplyAdded(comment.id, r); setShowReplyForm(false) }}
            onCancel={() => setShowReplyForm(false)}
          />
        )}

        {hasReplies && expanded && (
          <div className="replies-section">
            {comment.replies.map(reply => (
              <div key={reply.id} className="reply-item">
                <div className="reply-avatar">
                  <UserAvatar userId={reply.author.id} username={reply.author.username} size="sm" />
                </div>
                <div className="reply-body">
                  <div className="reply-meta">
                    <strong className="comment-author">{reply.author.username}</strong>
                    <span className="comment-time">
                      回复于 <time dateTime={reply.createdAt}>{formatCommentTime(reply.createdAt)}</time>
                    </span>
                  </div>
                  <CollapsibleContent content={reply.content} />
                </div>
              </div>
            ))}
          </div>
        )}
      </article>
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '发表评论失败')
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
    <section className="gh-comment-thread" aria-labelledby="comments-heading">
      <div className="comment-section">
        <div className="comment-section-header">
          <h2 className="comment-heading" id="comments-heading">评论</h2>
          <span className="comment-count">{totalComments} 条讨论</span>
        </div>

        {user ? (
          <div className="comment-composer-row">
            <div className="comment-composer-avatar">
              <UserAvatar userId={user.id} username={user.username} size="md" />
            </div>
            <form className="comment-form" onSubmit={handleSubmit}>
              <div className="comment-form-tabs">
                <span className="comment-form-tab--active">撰写</span>
              </div>
              <div className="comment-form-body">
                <textarea
                  className="gh-input gh-input--full comment-input"
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="写下你的评论"
                  aria-label="评论内容"
                  rows={5}
                  maxLength={2000}
                />
              </div>
              {error && <p className="comment-error">{error}</p>}
              <div className="comment-form-actions">
                <span className="comment-char-count">{text.length}/2000</span>
                <GitHubButton type="submit" variant="primary" size="sm" disabled={sending || !text.trim()}>
                  {sending ? '发表中…' : '发表评论'}
                </GitHubButton>
              </div>
            </form>
          </div>
        ) : (
          <div className="comment-login-prompt">
            <Link to="/login">登录</Link> 后参与讨论
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
    </section>
  )
}
