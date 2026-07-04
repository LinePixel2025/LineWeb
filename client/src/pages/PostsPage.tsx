import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import LiquidGlass from '../components/glass/LiquidGlass'
import Pagination from '../components/Pagination'

interface PostSummary {
  id: number; title: string; summary: string | null
  slug: string; createdAt: string; author: { username: string }
}
interface PostsResponse { posts: PostSummary[]; total: number; page: number; totalPages: number }

export default function PostsPage() {
  const [data, setData] = useState<PostsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<'desc' | 'asc'>('desc')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

  const fetchPosts = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      limit: '6',
      sort,
    })
    if (search) params.set('search', search)
    api.get<PostsResponse>(`/posts?${params}`)
      .then(setData).catch(console.error).finally(() => setLoading(false))
  }, [page, sort, search])

  useEffect(() => { fetchPosts() }, [fetchPosts])

  // 搜索提交
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    setSearch(searchInput.trim())
  }

  // 清除搜索
  const handleClearSearch = () => {
    setSearchInput('')
    setSearch('')
    setPage(1)
  }

  // 切换排序
  const toggleSort = () => {
    setPage(1)
    setSort(prev => prev === 'desc' ? 'asc' : 'desc')
  }

  return (
    <div className="page container" style={{ maxWidth: '720px' }}>
      <h1 style={{ marginBottom: '8px' }}>文章</h1>
      <p className="text-secondary" style={{ marginBottom: '24px' }}>发现 Line Web 的最新内容</p>

      {/* 工具栏：搜索 + 排序 */}
      <LiquidGlass variant="blur" chromatic={false} className="posts-toolbar">
        <form onSubmit={handleSearch} className="posts-search-form">
          <input
            className="lg-input posts-search-input"
            type="text"
            placeholder="搜索文章标题…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
          />
          <button type="submit" className="liquid-btn glass sm">
            🔍 搜索
            <span className="btn-flare" />
          </button>
          {search && (
            <button type="button" className="liquid-btn ghost sm" onClick={handleClearSearch}>
              ✕ 清除
              <span className="btn-flare" />
            </button>
          )}
        </form>
        <button className="liquid-btn glass sm posts-sort-btn" onClick={toggleSort}>
          {sort === 'desc' ? '🕐 最新优先' : '🕐 最早优先'}
          <span className="btn-flare" />
        </button>
      </LiquidGlass>

      {/* 搜索结果提示 */}
      {search && data && (
        <p className="text-tertiary" style={{ margin: '16px 0 0', fontSize: '0.88rem' }}>
          搜索 "{search}" 找到 {data.total} 篇文章
        </p>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}><div className="spinner" /></div>
      ) : data?.posts.length === 0 ? (
        <LiquidGlass variant="regular" chromatic={false} style={{ textAlign: 'center', padding: '60px 24px', marginTop: '24px' }}>
          <p className="text-secondary">{search ? `未找到包含 "${search}" 的文章` : '暂无文章'}</p>
        </LiquidGlass>
      ) : (
        <>
          <div className="posts-list">
            {data?.posts.map((post, i) => (
              <LiquidGlass key={post.id} variant="blur" chromatic={false} className="fade-in-stagger posts-card" style={{ animationDelay: `${i * 0.05}s` }}>
                <Link
                  to={`/posts/${post.slug}`}
                  style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
                >
                  <h3>{post.title}</h3>
                  {post.summary && <p className="text-secondary" style={{ marginTop: '8px', fontSize: '0.92rem' }}>{post.summary}</p>}
                  <div style={{ display: 'flex', gap: '16px', marginTop: '12px' }}>
                    <span className="text-tertiary">{post.author.username}</span>
                    <span className="text-tertiary">{new Date(post.createdAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                </Link>
              </LiquidGlass>
            ))}
          </div>

          {data && data.totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={data.totalPages}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>
  )
}
