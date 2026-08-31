import { useState } from 'react'
import { usePostsList } from '../hooks/useQueries'
import { GitHubButton, GitHubInput } from '../components/ui'
import Pagination from '../components/Pagination'
import PostListItem, { type PostListItemData } from '../components/PostListItem'

export default function PostsPage() {
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<'desc' | 'asc'>('desc')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

  const { data, isLoading: loading } = usePostsList(page, sort, search || undefined, 6)

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    setSearch(searchInput.trim())
  }

  const handleClearSearch = () => {
    setSearchInput('')
    setSearch('')
    setPage(1)
  }

  const toggleSort = () => {
    setPage(1)
    setSort(prev => prev === 'desc' ? 'asc' : 'desc')
  }

  return (
    <div className="gh-page-container">
      <div className="gh-page-header">
        <h1 className="gh-page-title">文章</h1>
        <p className="gh-text-secondary">发现 Line Web 的最新内容</p>
      </div>

      <div className="gh-box gh-posts-tools" style={{ marginBottom: '16px', padding: '12px 16px' }}>
        <form className="gh-posts-search-form" onSubmit={handleSearch} style={{ marginBottom: search ? '12px' : '0' }}>
          <GitHubInput
            type="text"
            placeholder="搜索文章标题…"
            aria-label="搜索文章标题"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            fullWidth
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
              </svg>
            }
          />
          <GitHubButton type="submit" variant="primary" size="sm">搜索</GitHubButton>
          <GitHubButton type="button" variant="secondary" size="sm" onClick={toggleSort}>
            {sort === 'desc' ? '最新 ↓' : '最早 ↑'}
          </GitHubButton>
        </form>
        {search && (
          <div className="gh-posts-search-summary">
            <span className="gh-text-secondary" style={{ fontSize: '0.85rem' }}>
              搜索 "{search}" — {data ? `${data.total} 篇结果` : '搜索中…'}
            </span>
            <GitHubButton variant="ghost" size="sm" onClick={handleClearSearch}>清除</GitHubButton>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}><div className="gh-spinner" /></div>
      ) : data?.posts.length === 0 ? (
        <div className="gh-box" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <p className="gh-text-secondary">{search ? `未找到包含 "${search}" 的文章` : '暂无文章'}</p>
        </div>
      ) : (
        <>
          <div className="gh-post-list">
            {data?.posts.map((post) => (
              <PostListItem key={post.id} post={post as PostListItemData} />
            ))}
          </div>

          {data && data.totalPages > 1 && (
            <div className="gh-pagination">
              <Pagination
                page={page}
                totalPages={data.totalPages}
                onPageChange={setPage}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
