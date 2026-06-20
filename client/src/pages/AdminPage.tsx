import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'

interface PostSummary { id: number; title: string; slug: string; published: boolean; createdAt: string }
interface PostsResponse { posts: PostSummary[]; total: number; page: number; totalPages: number }

export default function AdminPage() {
  const [data, setData] = useState<PostsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  const fetchPosts = () => {
    setLoading(true)
    api.get<PostsResponse>(`/posts/admin/all?page=${page}&limit=20`)
      .then(setData).catch(console.error).finally(() => setLoading(false))
  }

  useEffect(() => { fetchPosts() }, [page])

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这篇文章吗？')) return
    try { await api.delete(`/posts/${id}`); fetchPosts() }
    catch { alert('删除失败') }
  }

  const handleToggle = async (post: PostSummary) => {
    try { await api.put(`/posts/${post.id}`, { published: !post.published }); fetchPosts() }
    catch { alert('更新失败') }
  }

  return (
    <div className="page container glass-rise" style={{ maxWidth: '800px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '12px' }}>
        <h1>管理面板</h1>
        <Link to="/admin/new" className="admin-new-btn" style={{
          padding: '10px 24px', borderRadius: '9999px', fontWeight: 500, fontSize: '0.9rem',
          background: 'linear-gradient(135deg, var(--lg-accent), #40a9ff)', color: 'white',
          textDecoration: 'none', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3), 0 4px 12px var(--lg-accent-glow)',
        }}>写文章</Link>
      </div>
      <p className="text-secondary" style={{ marginBottom: '32px' }}>管理文章和扩展</p>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}><div className="spinner" /></div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="admin-table-wrap lg-surface-strong fade-in" style={{ overflow: 'hidden' }}>
            <table className="admin-table">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--lg-glass-border)' }}>
                  <th style={{ textAlign: 'left', padding: '14px 16px', fontWeight: 500, fontSize: '0.85rem', color: 'var(--lg-text-secondary)' }}>标题</th>
                  <th style={{ textAlign: 'center', padding: '14px 16px', fontWeight: 500, fontSize: '0.85rem', color: 'var(--lg-text-secondary)', width: '80px' }}>状态</th>
                  <th style={{ textAlign: 'right', padding: '14px 16px', fontWeight: 500, fontSize: '0.85rem', color: 'var(--lg-text-secondary)', width: '220px' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {data?.posts.map((post, i) => (
                  <tr key={post.id} className="fade-in" style={{ borderBottom: '1px solid var(--lg-glass-border)', animationDelay: `${i * 0.04}s` }}>
                    <td className="admin-title-cell" style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 500 }}>{post.title}</div>
                      <div className="text-tertiary" style={{ fontSize: '0.78rem', marginTop: '2px' }}>{new Date(post.createdAt).toLocaleDateString('zh-CN')}</div>
                    </td>
                    <td style={{ textAlign: 'center', padding: '12px 16px' }}>
                      <span style={{
                        display: 'inline-block', padding: '2px 10px', borderRadius: '9999px', fontSize: '0.78rem',
                        background: post.published ? 'rgba(52,199,89,0.15)' : 'var(--lg-glass-bg)',
                        color: post.published ? 'var(--lg-success)' : 'var(--lg-text-tertiary)',
                      }}>
                        {post.published ? '已发布' : '草稿'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', padding: '12px 16px' }}>
                      <div className="admin-actions">
                        <button onClick={() => handleToggle(post)}
                          className="admin-btn"
                          style={{
                            padding: '6px 14px', borderRadius: '9999px', fontSize: '0.82rem', fontWeight: 500,
                            background: 'var(--lg-glass-bg)', border: '1px solid var(--lg-glass-border)',
                            color: 'var(--lg-text-primary)', cursor: 'pointer', fontFamily: 'var(--lg-font)',
                          }}
                        >{post.published ? '下架' : '发布'}</button>
                        <Link to={`/admin/edit/${post.id}`}
                          className="admin-btn"
                          style={{
                            padding: '6px 14px', borderRadius: '9999px', fontSize: '0.82rem', fontWeight: 500,
                            background: 'var(--lg-glass-bg)', border: '1px solid var(--lg-glass-border)',
                            color: 'var(--lg-text-primary)', textDecoration: 'none',
                          }}
                        >编辑</Link>
                        <button onClick={() => handleDelete(post.id)}
                          className="admin-btn admin-btn-danger"
                          style={{
                            padding: '6px 14px', borderRadius: '9999px', fontSize: '0.82rem', fontWeight: 500,
                            background: 'rgba(255,59,48,0.12)', border: '1px solid rgba(255,59,48,0.2)',
                            color: 'var(--lg-danger)', cursor: 'pointer', fontFamily: 'var(--lg-font)',
                          }}
                        >删除</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data && data.totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '24px', flexWrap: 'wrap' }}>
              {(() => {
                const total = data.totalPages, current = page
                const pages: number[] = []
                const start = Math.max(1, current - 2), end = Math.min(total, current + 2)
                if (start > 1) pages.push(1)
                if (start > 2) pages.push(0)
                for (let i = start; i <= end; i++) pages.push(i)
                if (end < total - 1) pages.push(0)
                if (end < total) pages.push(total)
                return pages.map((p, i) =>
                  p === 0 ? (
                    <span key={`e-${i}`} style={{ color: 'var(--lg-text-tertiary)', alignSelf: 'center' }}>...</span>
                  ) : (
                    <button key={p} onClick={() => setPage(p)}
                      className="pagination-btn"
                      style={{
                        width: '40px', height: '40px', borderRadius: '50%',
                        background: p === page ? 'var(--lg-accent)' : 'var(--lg-glass-bg)',
                        color: p === page ? 'white' : 'var(--lg-text-primary)',
                        border: '1px solid var(--lg-glass-border)', cursor: 'pointer',
                        fontWeight: 500, fontFamily: 'var(--lg-font)',
                        fontSize: '0.95rem', transition: 'all 0.2s ease',
                        WebkitTapHighlightColor: 'transparent',
                      }}
                    >{p}</button>
                  )
                )
              })()}
            </div>
          )}
        </>
      )}
    </div>
  )
}
