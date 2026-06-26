import { useState, useEffect } from 'react'
import LiquidButton from '../../components/glass/LiquidButton'
import LiquidGlass from '../../components/glass/LiquidGlass'
import api from '../../lib/api'

/* ---------- types ---------- */

interface PostGroup {
  postId: number
  title: string
  slug: string
  commentCount: number
  latestAt: string
}

interface CommentItem {
  id: number
  content: string
  createdAt: string
  updatedAt: string
  parentId: number | null
  author: { id: number; username: string }
}

/* ---------- component ---------- */

export default function CommentAdminPage() {
  const [groups, setGroups] = useState<PostGroup[]>([])
  const [groupsLoading, setGroupsLoading] = useState(true)
  const [selectedPost, setSelectedPost] = useState<{ postId: number; title: string } | null>(null)

  const [comments, setComments] = useState<CommentItem[]>([])
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
    api.get<{ comments: CommentItem[]; total: number }>(`/comments/admin/post/${postId}`)
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

  const startEdit = (comment: CommentItem) => {
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

  const truncate = (text: string, max: number) =>
    text.length > max ? text.slice(0, max) + '…' : text

  // Build hierarchy: top level comments and their children
  const topLevel = comments.filter(c => !c.parentId)
  const childMap = new Map<number, CommentItem[]>()
  for (const c of comments) {
    if (c.parentId) {
      const children = childMap.get(c.parentId) || []
      children.push(c)
      childMap.set(c.parentId, children)
    }
  }

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

  /* ---- Level 2: Comments for selected post ---- */
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
          {comments.length}
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
              {topLevel.map((comment, i) => {
                const replies = childMap.get(comment.id) || []
                return (
                  <tr key={comment.id} className="admin-row fade-in" style={{ animationDelay: `${i * 0.04}s` }}>
                    <td className="admin-cell admin-cell--comment">
                      {editingId === comment.id ? (
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
                            <LiquidButton size="sm" variant="primary" onClick={() => handleUpdate(comment.id)}>保存</LiquidButton>
                            <LiquidButton size="sm" variant="ghost" onClick={cancelEdit}>取消</LiquidButton>
                          </div>
                        </div>
                      ) : (
                        <div className="comment-preview">{truncate(comment.content, 120)}</div>
                      )}
                    </td>
                    <td className="admin-cell">{comment.author.username}</td>
                    <td className="admin-cell">
                      <span className="admin-badge admin-badge--published" style={{ fontSize: '0.75rem' }}>主评论</span>
                    </td>
                    <td className="admin-cell admin-cell--date">
                      {new Date(comment.createdAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="admin-cell admin-cell--actions">
                      <div className="admin-actions">
                        {editingId === comment.id ? null : (
                          <>
                            <LiquidButton size="sm" variant="glass" onClick={() => startEdit(comment)}>编辑</LiquidButton>
                            <LiquidButton size="sm" variant="danger" onClick={() => handleDelete(comment.id)}>删除</LiquidButton>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {/* Render replies indented under their parent */}
              {topLevel.map(comment => {
                const replies = childMap.get(comment.id) || []
                return replies.map((reply, ri) => (
                  <tr key={reply.id} className="admin-row fade-in" style={{ animationDelay: `${(topLevel.indexOf(comment) + 0.1 + ri * 0.03).toFixed(2)}s` }}>
                    <td className="admin-cell admin-cell--comment" style={{ paddingLeft: '40px' }}>
                      {editingId === reply.id ? (
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
                            <LiquidButton size="sm" variant="primary" onClick={() => handleUpdate(reply.id)}>保存</LiquidButton>
                            <LiquidButton size="sm" variant="ghost" onClick={cancelEdit}>取消</LiquidButton>
                          </div>
                        </div>
                      ) : (
                        <div className="comment-preview" style={{ color: 'var(--lg-text-tertiary)' }}>
                          └ {truncate(reply.content, 100)}
                        </div>
                      )}
                    </td>
                    <td className="admin-cell">{reply.author.username}</td>
                    <td className="admin-cell">
                      <span className="admin-badge admin-badge--draft" style={{ fontSize: '0.75rem' }}>回复</span>
                    </td>
                    <td className="admin-cell admin-cell--date">
                      {new Date(reply.createdAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="admin-cell admin-cell--actions">
                      <div className="admin-actions">
                        {editingId === reply.id ? null : (
                          <>
                            <LiquidButton size="sm" variant="glass" onClick={() => startEdit(reply)}>编辑</LiquidButton>
                            <LiquidButton size="sm" variant="danger" onClick={() => handleDelete(reply.id)}>删除</LiquidButton>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              })}
            </tbody>
          </table>
        </LiquidGlass>
      )}
    </div>
  )
}
