import { useState, useEffect } from 'react'
import LiquidButton from '../../components/glass/LiquidButton'
import LiquidGlass from '../../components/glass/LiquidGlass'
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
    <div className="admin-page">
      <div className="admin-page-header">
        <h1 className="admin-page-title">页面管理</h1>
        <LiquidButton to="/admin/pages/new" variant="primary" size="md">
          新建页面
        </LiquidButton>
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
              {data?.pages.map((item, i) => (
                <tr key={item.id} className="admin-row fade-in" style={{ animationDelay: `${i * 0.04}s` }}>
                  <td className="admin-cell admin-cell--title" data-label="标题">
                    <div className="admin-post-title">{item.title}</div>
                    <div className="admin-post-date">
                      /{item.slug} · {new Date(item.createdAt).toLocaleDateString('zh-CN')}
                    </div>
                  </td>
                  <td className="admin-cell admin-cell--status" data-label="状态">
                    <span className={`admin-badge ${item.published ? 'admin-badge--published' : 'admin-badge--draft'}`}>
                      {item.published ? '已发布' : '草稿'}
                    </span>
                  </td>
                  <td className="admin-cell admin-cell--actions" data-label="操作">
                    <div className="admin-actions">
                      <LiquidButton size="sm" variant="glass" onClick={() => handleToggle(item)}>
                        {item.published ? '下架' : '发布'}
                      </LiquidButton>
                      <LiquidButton size="sm" variant="glass" to={`/admin/pages/${item.id}/edit`}>
                        编辑
                      </LiquidButton>
                      <LiquidButton size="sm" variant="danger" onClick={() => handleDelete(item.id)}>
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
        <div className="admin-pagination">
          {(() => {
            const total = data.totalPages
            const current = page
            const pages: (number | 0)[] = []
            const start = Math.max(1, current - 2)
            const end = Math.min(total, current + 2)
            if (start > 1) pages.push(1)
            if (start > 2) pages.push(0)
            for (let i = start; i <= end; i++) pages.push(i)
            if (end < total - 1) pages.push(0)
            if (end < total) pages.push(total)
            return pages.map((p, i) =>
              p === 0 ? (
                <span key={`ellipsis-${i}`} className="admin-ellipsis">...</span>
              ) : (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`admin-page-btn ${p === page ? 'admin-page-btn--active' : ''}`}
                >
                  {p}
                </button>
              )
            )
          })()}
        </div>
      )}
    </div>
  )
}
