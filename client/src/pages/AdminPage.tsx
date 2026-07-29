import { useState, useEffect } from 'react'
import { GitHubButton, GitHubBadge } from '../components/ui'
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
    <div>
      <div className="gh-page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1>文章管理</h1>
          <p>管理所有文章的状态</p>
        </div>
        <GitHubButton variant="primary" size="md" href="/admin/new">
          写文章
        </GitHubButton>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--gh-space-7)' }}>
          <div className="gh-spinner" />
        </div>
      ) : (
        <div className="gh-box" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="gh-table">
            <thead>
              <tr>
                <th style={{ width: '50%' }}>标题</th>
                <th>状态</th>
                <th style={{ textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {data?.posts.map((post) => (
                <tr key={post.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{post.title}</div>
                    <div className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)' }}>
                      {new Date(post.createdAt).toLocaleDateString('zh-CN')}
                    </div>
                  </td>
                  <td>
                    {post.published ? (
                      <GitHubBadge variant="success">已发布</GitHubBadge>
                    ) : (
                      <GitHubBadge>草稿</GitHubBadge>
                    )}
                  </td>
                  <td>
                    <div className="gh-actions">
                      <GitHubButton variant="secondary" size="sm" onClick={() => handleToggle(post)}>
                        {post.published ? '下架' : '发布'}
                      </GitHubButton>
                      <GitHubButton variant="secondary" size="sm" href={`/admin/edit/${post.id}`}>
                        编辑
                      </GitHubButton>
                      <GitHubButton variant="danger" size="sm" onClick={() => handleDelete(post.id)}>
                        删除
                      </GitHubButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
