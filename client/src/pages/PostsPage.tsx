import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePostsList } from '../hooks/useQueries'
import LiquidGlass from '../components/glass/LiquidGlass'
import Pagination from '../components/Pagination'

interface PostSummary {
  id: number; title: string; summary: string | null
  slug: string; createdAt: string; author: { username: string }
}
interface PostsResponse { posts: PostSummary[]; total: number; page: number; totalPages: number }

export default function PostsPage() {
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<'desc' | 'asc'>('desc')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

  const { data, isLoading: loading } = usePostsList(page, sort, search || undefined, 6)

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
        <div className="posts-search-wrap">
          <span className="posts-search-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </span>
          <input
            className="lg-input posts-search-input"
            type="text"
            placeholder="搜索文章标题…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
          />
          <button type="button" className="posts-search-submit" onClick={handleSearch} aria-label="搜索">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
            </svg>
          </button>
          <div className="posts-toolbar-divider" />
          <button className="posts-sort-btn-inline" onClick={toggleSort}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}>
              <path d="m3 16 4 4 4-4" /><path d="M7 20V4" /><path d="m21 8-4-4-4 4" /><path d="M17 4v16" />
            </svg>
            {sort === 'desc' ? '最新' : '最早'}
          </button>
        </div>
        {search && (
          <button type="button" className="liquid-btn ghost sm" onClick={handleClearSearch}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '2px' }}>
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
            清除
          </button>
        )}
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
