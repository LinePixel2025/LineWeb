import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePostsList } from '../hooks/useQueries'
import { GitHubButton, GitHubInput } from '../components/ui'
import Pagination from '../components/Pagination'

interface PostSummary {
  id: number; title: string; summary: string | null
  slug: string; createdAt: string; author: { username: string }
}
interface PostsResponse { posts: PostSummary[]; total: number; page: number; totalPages: number }

function RepoCircle({ letter }: { letter: string }) {
  return <span className="gh-repo-circle">{letter}</span>
}

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

      <div className="gh-box" style={{ marginBottom: '16px', padding: '12px 16px' }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: search ? '12px' : '0' }}>
          <GitHubInput
            type="text"
            placeholder="搜索文章标题…"
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {data?.posts.map((post) => (
              <div key={post.id} className="gh-list-item">
                <RepoCircle letter={post.title.charAt(0).toUpperCase()} />
                <div className="gh-list-item-content">
                  <Link to={`/posts/${post.slug}`} className="gh-list-item-title">
                    {post.title}
                  </Link>
                  {post.summary && (
                    <p className="gh-text-secondary" style={{ fontSize: '0.82rem', margin: '2px 0 0' }}>
                      {post.summary}
                    </p>
                  )}
                  <div className="gh-list-item-meta">
                    <span className="gh-text-tertiary">{post.author.username}</span>
                    <span className="gh-text-tertiary">{new Date(post.createdAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                </div>
              </div>
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
