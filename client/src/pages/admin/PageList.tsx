import { useState, useEffect } from 'react'
import { GitHubButton, GitHubBadge } from '../../components/ui'
import Pagination from '../../components/Pagination'
import api from '../../lib/api'

interface PageItem {
  id: number
  title: string
  slug: string
  published: boolean
  featured: boolean
  featureEmoji: string | null
  featureDesc: string | null
  createdAt: string
}

interface PagesResponse {
  pages: PageItem[]
  total: number
  page: number
  totalPages: number
}

export default function PageList() {
  const [data, setData] = useState<PagesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  const fetchPages = () => {
    setLoading(true)
    api.get<PagesResponse>(`/pages?page=${page}&limit=20`)
      .then(setData).catch(console.error).finally(() => setLoading(false))
  }

  useEffect(() => { fetchPages() }, [page])

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这个页面吗？')) return
    try { await api.delete(`/pages/${id}`); fetchPages() }
    catch { alert('删除失败') }
  }

  const handleToggle = async (item: PageItem) => {
    try { await api.put(`/pages/${item.id}`, { published: !item.published }); fetchPages() }
    catch { alert('更新失败') }
  }

  return (
    <div>
      <div className="gh-page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1>页面管理</h1>
          <p>管理自定义页面</p>
        </div>
        <GitHubButton variant="primary" size="md" href="/admin/pages/new">
          新建页面
        </GitHubButton>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--gh-space-7)' }}>
          <div className="gh-spinner" />
        </div>
      ) : (
        <div className="gh-box gh-table-wrap" style={{ padding: 0 }}>
          <table className="gh-table">
            <thead>
              <tr>
                <th style={{ width: '50%' }}>标题</th>
                <th>状态</th>
                <th style={{ textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {data?.pages.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{item.title}</div>
                    <div className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)' }}>
                      /{item.slug} · {new Date(item.createdAt).toLocaleDateString('zh-CN')}
                    </div>
                  </td>
                  <td>
                    {item.published ? (
                      <GitHubBadge variant="success">已发布</GitHubBadge>
                    ) : (
                      <GitHubBadge>草稿</GitHubBadge>
                    )}
                  </td>
                  <td>
                    <div className="gh-actions">
                      <GitHubButton variant="secondary" size="sm" onClick={() => handleToggle(item)}>
                        {item.published ? '下架' : '发布'}
                      </GitHubButton>
                      <GitHubButton variant="secondary" size="sm" href={`/admin/pages/${item.id}/edit`}>
                        编辑
                      </GitHubButton>
                      <GitHubButton variant="danger" size="sm" onClick={() => handleDelete(item.id)}>
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
