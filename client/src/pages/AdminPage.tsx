import { useState, useEffect } from 'react'
import LiquidButton from '../components/glass/LiquidButton'
import LiquidGlass from '../components/glass/LiquidGlass'
import api from '../lib/api'
import Pagination from '../components/Pagination'

interface PostSummary {
  id: number
  title: string
  slug: string
  published: boolean
  createdAt: string
}

interface PostsResponse {
  posts: PostSummary[]
  total: number
  page: number
  totalPages: number
}

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
    <div className="admin-page">
      <div className="admin-page-header">
        <h1 className="admin-page-title">文章管理</h1>
        <LiquidButton to="/admin/new" variant="primary" size="md">写文章</LiquidButton>
      </div>

      {loading ? (
        <div className="admin-spinner">
          <div className="spinner" />
        </div>
      ) : (
        <LiquidGlass variant="blur" className="admin-page-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th className="admin-th admin-th--title">标题</th>
                <th className="admin-th admin-th--status">状态</th>
                <th className="admin-th admin-th--actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {data?.posts.map((post, i) => (
                <tr key={post.id} className="admin-row fade-in" style={{ animationDelay: `${i * 0.04}s` }}>
                  <td className="admin-cell admin-cell--title" data-label="标题">
                    <div className="admin-post-title">{post.title}</div>
                    <div className="admin-post-date">
                      {new Date(post.createdAt).toLocaleDateString('zh-CN')}
                    </div>
                  </td>
                  <td className="admin-cell admin-cell--status" data-label="状态">
                    <span className={`admin-badge ${post.published ? 'admin-badge--published' : 'admin-badge--draft'}`}>
                      {post.published ? '已发布' : '草稿'}
                    </span>
                  </td>
                  <td className="admin-cell admin-cell--actions" data-label="操作">
                    <div className="admin-actions">
                      <LiquidButton size="sm" variant="glass" onClick={() => handleToggle(post)}>
                        {post.published ? '下架' : '发布'}
                      </LiquidButton>
                      <LiquidButton size="sm" variant="glass" to={`/admin/edit/${post.id}`}>
                        编辑
                      </LiquidButton>
                      <LiquidButton size="sm" variant="danger" onClick={() => handleDelete(post.id)}>
                        删除
                      </LiquidButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </LiquidGlass>
      )}

      {data && data.totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={data.totalPages}
          onPageChange={setPage}
        />
      )}
    </div>
  )
}
