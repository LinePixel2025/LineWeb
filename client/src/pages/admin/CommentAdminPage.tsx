import { useState, useEffect, useMemo } from 'react'
import { GitHubButton, GitHubBadge } from '../../components/ui'
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
    <tr>
      <td style={indent ? { paddingLeft: '40px' } : undefined}>
        {isEditing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gh-space-2)' }}>
            <textarea
              className="gh-input gh-input--full"
              value={editText}
              onChange={e => setEditText(e.target.value)}
              rows={3}
              maxLength={2000}
              style={{ resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: 'var(--gh-space-2)' }}>
              <GitHubButton variant="primary" size="sm" onClick={() => onSave(comment.id)}>保存</GitHubButton>
              <GitHubButton variant="ghost" size="sm" onClick={cancelEdit}>取消</GitHubButton>
            </div>
          </div>
        ) : (
          <div style={isReply ? { color: 'var(--gh-text-tertiary)' } : undefined}>
            {isReply ? '└ ' : ''}{truncate(comment.content, isReply ? 100 : 120)}
          </div>
        )}
      </td>
      <td>{comment.author.username}</td>
      <td>
        <GitHubBadge variant={isReply ? 'default' : 'accent'}>
          {isReply ? '回复' : '主评论'}
        </GitHubBadge>
      </td>
      <td className="gh-text-tertiary">
        {new Date(comment.createdAt).toLocaleString('zh-CN')}
      </td>
      <td>
        <div className="gh-actions">
          {!isEditing && (
            <>
              <GitHubButton variant="secondary" size="sm" onClick={() => onStartEdit(comment)}>编辑</GitHubButton>
              <GitHubButton variant="danger" size="sm" onClick={() => onDelete(comment.id)}>删除</GitHubButton>
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

  const totalComments = useMemo(
    () => comments.reduce((sum, c) => sum + 1 + c.replies.length, 0),
    [comments]
  )

  /* ---- Level 1: Post list ---- */
  if (!selectedPost) {
    return (
      <div>
        <div className="gh-page-header">
          <h1>评论管理</h1>
          <p>选择文章查看和管理评论</p>
        </div>

        {groupsLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--gh-space-7)' }}>
            <div className="gh-spinner" />
          </div>
        ) : groups.length === 0 ? (
          <div className="gh-box" style={{ padding: '40px', textAlign: 'center' }}>
            <p className="gh-text-secondary">暂无评论</p>
          </div>
        ) : (
          <div className="gh-box" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="gh-table">
              <thead>
                <tr>
                  <th>文章标题</th>
                  <th style={{ width: 100 }}>评论数</th>
                  <th style={{ width: 180 }}>最新评论</th>
                  <th style={{ width: 80, textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.postId} style={{ cursor: 'pointer' }}>
                    <td onClick={() => selectPost(g.postId, g.title)}>
                      <div style={{ fontWeight: 500 }}>{g.title}</div>
                    </td>
                    <td onClick={() => selectPost(g.postId, g.title)}>
                      <GitHubBadge variant="accent">{g.commentCount}</GitHubBadge>
                    </td>
                    <td className="gh-text-tertiary" onClick={() => selectPost(g.postId, g.title)}>
                      {new Date(g.latestAt).toLocaleString('zh-CN')}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <GitHubButton variant="secondary" size="sm" onClick={() => selectPost(g.postId, g.title)}>
                        管理
                      </GitHubButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  /* ---- Level 2: Comments for selected post ---- */
  return (
    <div>
      <div className="gh-page-header" style={{ display: 'flex', alignItems: 'center', gap: 'var(--gh-space-3)' }}>
        <GitHubButton variant="secondary" size="sm" onClick={backToList}>
          &larr; 返回
        </GitHubButton>
        <h1 style={{ margin: 0 }}>{truncate(selectedPost.title, 30)}</h1>
        <GitHubBadge variant="accent">{totalComments}</GitHubBadge>
      </div>

      {commentsLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--gh-space-7)' }}>
          <div className="gh-spinner" />
        </div>
      ) : comments.length === 0 ? (
        <div className="gh-box" style={{ padding: '40px', textAlign: 'center' }}>
          <p className="gh-text-secondary">该文章暂无评论</p>
        </div>
      ) : (
        <div className="gh-box" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="gh-table">
            <thead>
              <tr>
                <th style={{ width: '50%' }}>评论内容</th>
                <th style={{ width: 100 }}>作者</th>
                <th style={{ width: 80 }}>类型</th>
                <th style={{ width: 150 }}>时间</th>
                <th style={{ textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {comments.map((comment) => (
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
              {comments.map((comment) =>
                comment.replies.map((reply) => (
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
        </div>
      )}
    </div>
  )
}
