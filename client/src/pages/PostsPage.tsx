import { useState } from 'react'
import { usePostsList } from '../hooks/useQueries'
import { Button, Input, SegmentedControl, Icon } from '../components/ui'
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

  return (
    <div className="gh-page-container">
      <div className="gh-page-header">
        <h1 className="gh-page-title">文章</h1>
        <p className="gh-page-subtitle">发现 Line Web 的最新内容</p>
      </div>

      <div className="gh-posts-tools">
        <form className="gh-posts-search-form" onSubmit={handleSearch}>
          <Input
            type="text"
            placeholder="搜索文章标题…"
            aria-label="搜索文章标题"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            fullWidth
            icon={
              <Icon name="search" size={16} />
            }
          />
          <Button type="submit" variant="primary" size="sm">搜索</Button>
          <div className="gh-posts-sort">
            <SegmentedControl
              tabs={[
                { value: 'desc', label: '最新' },
                { value: 'asc', label: '最早' },
              ]}
              active={sort}
              onChange={value => { setPage(1); setSort(value as 'desc' | 'asc') }}
            />
          </div>
        </form>
        {search && (
          <div className="gh-posts-search-summary">
            <span>搜索 “{search}” — {data ? `${data.total} 篇结果` : '搜索中…'}</span>
            <Button variant="ghost" size="sm" onClick={handleClearSearch}>清除</Button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="gh-loading-row"><div className="gh-spinner" /></div>
      ) : data?.posts.length === 0 ? (
        <div className="gh-empty-card">
          {search ? `未找到包含 “${search}” 的文章` : '暂无文章'}
        </div>
      ) : (
        <>
          <div className="gh-post-list">
            {data?.posts.map((post) => (
              <PostListItem key={post.id} post={post as PostListItemData} />
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
