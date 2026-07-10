### Task 8: 更新文章列表页

**Files:**
- Modify: `client/src/pages/PostsPage.tsx`

**Interfaces:**
- Consumes: CSS变量系统，LiquidGlass组件
- Produces: 更新后的文章列表页

- [ ] **Step 1: 更新文章列表页组件**

```tsx
// client/src/pages/PostsPage.tsx
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
    <div className="page container" style={{ maxWidth: '720px' }}>
      <h1 style={{ marginBottom: '8px' }}>文章</h1>
      <p style={{ marginBottom: '24px', color: 'var(--color-text-secondary)' }}>发现 Line Web 的最新内容</p>

      {/* Toolbar */}
      <LiquidGlass variant="blur" chromatic={false} className="posts-toolbar">
        <div className="posts-search-wrap">
          <span className="posts-search-icon">🔍</span>
          <input
            className="lg-input posts-search-input"
            type="text"
            placeholder="搜索文章标题…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
          />
          <button type="button" className="posts-search-submit" onClick={handleSearch} aria-label="搜索">→</button>
          <div className="posts-toolbar-divider" />
          <button className="posts-sort-btn-inline" onClick={toggleSort}>
            {sort === 'desc' ? '🕐 最新' : '🕐 最早'}
          </button>
        </div>
        {search && (
          <button type="button" className="btn btn-ghost" onClick={handleClearSearch}>
            ✕ 清除
          </button>
        )}
      </LiquidGlass>

      {/* Search results hint */}
      {search && data && (
        <p style={{ margin: '16px 0 0', fontSize: '0.88rem', color: 'var(--color-text-tertiary)' }}>
          搜索 "{search}" 找到 {data.total} 篇文章
        </p>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}><div className="spinner" /></div>
      ) : data?.posts.length === 0 ? (
        <LiquidGlass variant="regular" chromatic={false} style={{ textAlign: 'center', padding: '60px 24px', marginTop: '24px' }}>
          <p style={{ color: 'var(--color-text-secondary)' }}>{search ? `未找到包含 "${search}" 的文章` : '暂无文章'}</p>
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
                  {post.summary && <p style={{ marginTop: '8px', fontSize: '0.92rem', color: 'var(--color-text-secondary)' }}>{post.summary}</p>}
                  <div style={{ display: 'flex', gap: '16px', marginTop: '12px' }}>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>{post.author.username}</span>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>{new Date(post.createdAt).toLocaleDateString('zh-CN')}</span>
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
```

- [ ] **Step 2: 验证文章列表页**

在浏览器中检查文章列表页是否正确显示。

- [ ] **Step 3: 提交更改**

```bash
git add client/src/pages/PostsPage.tsx
git commit -m "feat: update posts page for new design system"
```
