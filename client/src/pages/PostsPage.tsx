import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'

interface PostSummary {
  id: number; title: string; summary: string | null
  slug: string; createdAt: string; author: { username: string }
}
interface PostsResponse { posts: PostSummary[]; total: number; page: number; totalPages: number }

export default function PostsPage() {
  const [data, setData] = useState<PostsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  useEffect(() => {
    setLoading(true)
    api.get<PostsResponse>(`/posts?page=${page}&limit=10`)
      .then(setData).catch(console.error).finally(() => setLoading(false))
  }, [page])

  return (
    <div className="page container" style={{ maxWidth: '720px' }}>
      <h1 style={{ marginBottom: '8px' }}>文章</h1>
      <p className="text-secondary" style={{ marginBottom: '32px' }}>发现 Line Web 的最新内容</p>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}><div className="spinner" /></div>
      ) : data?.posts.length === 0 ? (
        <div className="lg-surface" style={{ textAlign: 'center', padding: '60px 24px' }}>
          <p className="text-secondary">暂无文章</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {data?.posts.map((post, i) => (
              <Link
                key={post.id} to={`/posts/${post.slug}`}
                className="lg-surface"
                style={{
                  display: 'block', padding: '24px',
                  textDecoration: 'none', color: 'inherit',
                  animation: `fadeIn 0.4s ease-out ${i * 0.05}s both`,
                  transition: 'transform 0.25s ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none' }}
              >
                <h3>{post.title}</h3>
                {post.summary && <p className="text-secondary" style={{ marginTop: '8px', fontSize: '0.92rem' }}>{post.summary}</p>}
                <div style={{ display: 'flex', gap: '16px', marginTop: '12px' }}>
                  <span className="text-tertiary">{post.author.username}</span>
                  <span className="text-tertiary">{new Date(post.createdAt).toLocaleDateString('zh-CN')}</span>
                </div>
              </Link>
            ))}
          </div>

          {data && data.totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '28px', flexWrap: 'wrap' }}>
              {(() => {
                // Show limited pages on mobile
                const total = data.totalPages
                const current = page
                const pages: number[] = []
                const start = Math.max(1, current - 2)
                const end = Math.min(total, current + 2)
                if (start > 1) pages.push(1)
                if (start > 2) pages.push(0) // ellipsis marker
                for (let i = start; i <= end; i++) pages.push(i)
                if (end < total - 1) pages.push(0)
                if (end < total) pages.push(total)
                return pages.map((p, i) =>
                  p === 0 ? (
                    <span key={`ellipsis-${i}`} style={{ color: 'var(--lg-text-tertiary)', alignSelf: 'center' }}>...</span>
                  ) : (
                    <button key={p} onClick={() => setPage(p)}
                      className="pagination-btn"
                      style={{
                        width: '40px', height: '40px', borderRadius: '50%',
                        background: p === page ? 'var(--lg-accent)' : 'var(--lg-glass-bg)',
                        color: p === page ? 'white' : 'var(--lg-text-primary)',
                        border: '1px solid var(--lg-glass-border)', cursor: 'pointer',
                        fontWeight: 500, fontFamily: 'var(--lg-font)',
                        fontSize: '0.95rem',
                        transition: 'all 0.2s ease',
                        WebkitTapHighlightColor: 'transparent',
                      }}
                    >
                      {p}
                    </button>
                  )
                )
              })()}
            </div>
          )}
        </>
      )}
    </div>
  )
}
