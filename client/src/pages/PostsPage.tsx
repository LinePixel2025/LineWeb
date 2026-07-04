import { useState, useEffect } from 'react'
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
        <LiquidGlass variant="regular" chromatic={false} style={{ textAlign: 'center', padding: '60px 24px' }}>
          <p className="text-secondary">暂无文章</p>
        </LiquidGlass>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {data?.posts.map((post, i) => (
              <LiquidGlass key={post.id} variant="blur" chromatic={false} className="fade-in-stagger" style={{ padding: '24px', animationDelay: `${i * 0.05}s` }}>
            <Link
              to={`/posts/${post.slug}`}
              style={{
                display: 'block',
                textDecoration: 'none', color: 'inherit',
              }}
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
