import { useState, useEffect, useMemo } from 'react'
import LiquidButton from '../../components/glass/LiquidButton'
import LiquidGlass from '../../components/glass/LiquidGlass'
import api from '../../lib/api'
import type { CommentData } from '../../types/comment'

/* ---------- types ---------- */

interface PostGroup {
  postId: number
  title: string
  slug: string
  commentCount: number
  latestAt: string
}

/* ---------- helpers ---------- */

const truncate = (text: string, max: number) =>
  text.length > max ? text.slice(0, max) + '…' : text

/* ---------- sub-components ---------- */

function CommentRow({
  comment,
  isReply,
  indent,
  editingId,
  editText,
  setEditText,
  onSave,
  onStartEdit,
  onDelete,
  cancelEdit,
}: {
  comment: CommentData
  isReply: boolean
  indent?: boolean
  editingId: number | null
  editText: string
  setEditText: (v: string) => void
  onSave: (id: number) => void
  onStartEdit: (c: CommentData) => void
  onDelete: (id: number) => void
  cancelEdit: () => void
}) {
  const isEditing = editingId === comment.id

  return (
    <tr className="admin-row fade-in">
      <td className="admin-cell admin-cell--comment" style={indent ? { paddingLeft: '40px' } : undefined}>
        {isEditing ? (
          <div className="comment-edit-form">
            <textarea
              className="lg-input"
              value={editText}
              onChange={e => setEditText(e.target.value)}
              rows={3}
              maxLength={2000}
              style={{ width: '100%', marginBottom: '8px' }}
            />
            <div className="comment-edit-actions">
              <LiquidButton size="sm" variant="primary" onClick={() => onSave(comment.id)}>保存</LiquidButton>
              <LiquidButton size="sm" variant="ghost" onClick={cancelEdit}>取消</LiquidButton>
            </div>
          </div>
        ) : (
          <div className="comment-preview" style={isReply ? { color: 'var(--lg-text-tertiary)' } : undefined}>
            {isReply ? '└ ' : ''}{truncate(comment.content, isReply ? 100 : 120)}
          </div>
        )}
      </td>
      <td className="admin-cell">{comment.author.username}</td>
      <td className="admin-cell">
        <span className={`admin-badge ${isReply ? 'admin-badge--draft' : 'admin-badge--published'}`} style={{ fontSize: '0.75rem' }}>
          {isReply ? '回复' : '主评论'}
        </span>
      </td>
      <td className="admin-cell admin-cell--date">
        {new Date(comment.createdAt).toLocaleString('zh-CN')}
      </td>
      <td className="admin-cell admin-cell--actions">
        <div className="admin-actions">
          {isEditing ? null : (
            <>
              <LiquidButton size="sm" variant="glass" onClick={() => onStartEdit(comment)}>编辑</LiquidButton>
              <LiquidButton size="sm" variant="danger" onClick={() => onDelete(comment.id)}>删除</LiquidButton>
            </>
          )}
        </div>
      </td>
    </tr>
  )
}

/* ---------- main component ---------- */

export default function CommentAdminPage() {
  const [groups, setGroups] = useState<PostGroup[]>([])
  const [groupsLoading, setGroupsLoading] = useState(true)
  const [selectedPost, setSelectedPost] = useState<{ postId: number; title: string } | null>(null)

  const [comments, setComments] = useState<CommentData[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')

  const fetchGroups = () => {
    setGroupsLoading(true)
    api.get<PostGroup[]>('/comments/admin/posts')
      .then(setGroups)
      .catch(console.error)
      .finally(() => setGroupsLoading(false))
  }

  useEffect(() => { fetchGroups() }, [])

  const fetchComments = (postId: number) => {
    setCommentsLoading(true)
    setEditingId(null)
    api.get<{ comments: CommentData[]; total: number }>(`/comments/admin/post/${postId}`)
      .then(d => setComments(d.comments))
      .catch(console.error)
      .finally(() => setCommentsLoading(false))
  }

  const selectPost = (postId: number, title: string) => {
    setSelectedPost({ postId, title })
    fetchComments(postId)
  }

  const backToList = () => {
    setSelectedPost(null)
    setComments([])
    setEditingId(null)
    fetchGroups()
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这条评论吗？')) return
    try {
      await api.delete(`/comments/${id}`)
      if (selectedPost) fetchComments(selectedPost.postId)
    } catch {
      alert('删除失败')
    }
  }

  const startEdit = (comment: CommentData) => {
    setEditingId(comment.id)
    setEditText(comment.content)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditText('')
  }

  const handleUpdate = async (id: number) => {
    if (!editText.trim()) return
    try {
      await api.put(`/comments/${id}`, { content: editText })
      setEditingId(null)
      setEditText('')
      if (selectedPost) fetchComments(selectedPost.postId)
    } catch {
      alert('更新失败')
    }
  }

  // 评论计数
  const totalComments = useMemo(
    () => comments.reduce((sum, c) => sum + 1 + c.replies.length, 0),
    [comments]
  )

  /* ---- Level 1: Post list ---- */
  if (!selectedPost) {
    return (
      <div className="admin-page">
        <div className="admin-page-header">
          <h1 className="admin-page-title">评论管理</h1>
        </div>

        {groupsLoading ? (
          <div className="admin-spinner"><div className="spinner" /></div>
        ) : groups.length === 0 ? (
          <LiquidGlass variant="blur" style={{ padding: '40px', textAlign: 'center' }}>
            <p style={{ color: 'var(--lg-text-tertiary)' }}>暂无评论</p>
          </LiquidGlass>
        ) : (
          <LiquidGlass variant="blur" className="admin-page-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th className="admin-th">文章标题</th>
                  <th className="admin-th" style={{ width: 100 }}>评论数</th>
                  <th className="admin-th" style={{ width: 180 }}>最新评论</th>
                  <th className="admin-th admin-th--actions" style={{ width: 80 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, i) => (
                  <tr key={g.postId} className="admin-row fade-in admin-row--clickable" style={{ animationDelay: `${i * 0.04}s` }}>
                    <td className="admin-cell" onClick={() => selectPost(g.postId, g.title)}>
                      <div className="admin-post-title">{g.title}</div>
                    </td>
                    <td className="admin-cell" onClick={() => selectPost(g.postId, g.title)}>
                      <span className="comment-group-badge">{g.commentCount}</span>
                    </td>
                    <td className="admin-cell admin-cell--date" onClick={() => selectPost(g.postId, g.title)}>
                      {new Date(g.latestAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="admin-cell admin-cell--actions">
                      <LiquidButton size="sm" variant="glass" onClick={() => selectPost(g.postId, g.title)}>
                        管理
                      </LiquidButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </LiquidGlass>
        )}
      </div>
    )
  }

  /* ---- Level 2: Comments for selected post (tree-based) ---- */
  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <LiquidButton size="sm" variant="glass" onClick={backToList}>
          &larr; 返回
        </LiquidButton>
        <h1 className="admin-page-title" style={{ marginLeft: '12px' }}>
          {truncate(selectedPost.title, 30)}
        </h1>
        <span className="comment-group-badge" style={{ marginLeft: '10px', position: 'static', alignSelf: 'center' }}>
          {totalComments}
        </span>
      </div>

      {commentsLoading ? (
        <div className="admin-spinner"><div className="spinner" /></div>
      ) : comments.length === 0 ? (
        <LiquidGlass variant="blur" style={{ padding: '40px', textAlign: 'center' }}>
          <p style={{ color: 'var(--lg-text-tertiary)' }}>该文章暂无评论</p>
        </LiquidGlass>
      ) : (
        <LiquidGlass variant="blur" className="admin-page-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th className="admin-th admin-th--title" style={{ width: '50%' }}>评论内容</th>
                <th className="admin-th" style={{ width: 100 }}>作者</th>
                <th className="admin-th" style={{ width: 80 }}>类型</th>
                <th className="admin-th" style={{ width: 150 }}>时间</th>
                <th className="admin-th admin-th--actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {comments.map((comment, i) => (
                <CommentRow
                  key={comment.id}
                  comment={comment}
                  isReply={false}
                  editingId={editingId}
                  editText={editText}
                  setEditText={setEditText}
                  onSave={handleUpdate}
                  onStartEdit={startEdit}
                  onDelete={handleDelete}
                  cancelEdit={cancelEdit}
                />
              ))}
              {comments.map((comment, ci) =>
                comment.replies.map((reply, ri) => (
                  <CommentRow
                    key={reply.id}
                    comment={reply}
                    isReply
                    indent
                    editingId={editingId}
                    editText={editText}
                    setEditText={setEditText}
                    onSave={handleUpdate}
                    onStartEdit={startEdit}
                    onDelete={handleDelete}
                    cancelEdit={cancelEdit}
                  />
                ))
              )}
            </tbody>
          </table>
        </LiquidGlass>
      )}
    </div>
  )
}
