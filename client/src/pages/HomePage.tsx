import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import { useWallpaper } from '../contexts/WallpaperContext'
import LiquidGlass from '../components/glass/LiquidGlass'

interface PostPreview {
  id: number
  title: string
  summary: string | null
  slug: string
  createdAt: string
  author: { username: string }
}

export default function HomePage() {
  const [recentPosts, setRecentPosts] = useState<PostPreview[]>([])
  const { refresh, loading } = useWallpaper()

  useEffect(() => {
    api.get<{ posts: PostPreview[] }>('/posts?page=1&limit=3')
      .then(data => setRecentPosts(data.posts))
      .catch(() => {})
  }, [])

  return (
    <>
      {/* Hero */}
      <section
        style={{
          textAlign: 'center',
          padding: '160px 24px 100px',
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        className="home-section"
      >
        <LiquidGlass
          variant="strong"
          chromatic={false}
          style={{
            padding: '56px 48px',
            maxWidth: '520px',
            width: '100%',
          }}
        >
          <h1
            style={{
              fontSize: 'clamp(2.4rem, 7vw, 4rem)',
              fontWeight: 700,
              letterSpacing: '-0.03em',
              color: 'white',
              background: 'linear-gradient(135deg, #ffffff 0%, #40a9ff 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Line Web
          </h1>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '36px' }}>
            <Link to="/posts" className="liquid-btn primary lg">
              浏览文章
            </Link>
            <Link to="/features" className="liquid-btn glass lg">
              探索功能
            </Link>
          </div>
        </LiquidGlass>
      </section>

      {/* Latest Posts Preview */}
      {recentPosts.length > 0 && (
        <section
          className="home-posts-section"
          style={{
            maxWidth: '720px',
            margin: '0 auto',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: '40px' }}>
            <h2>最新文章</h2>
            <p className="text-secondary" style={{ marginTop: '8px' }}>近期发布的内容精选</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {recentPosts.map((post, i) => (
              <LiquidGlass key={post.id} variant="blur" chromatic={false} className="fade-in-stagger" style={{ padding: '24px', animationDelay: `${i * 0.08}s` }}>
                <Link
                  to={`/posts/${post.slug}`}
                  style={{
                    display: 'block',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <h3 style={{ marginBottom: '4px' }}>{post.title}</h3>
                  {post.summary && (
                    <p className="text-secondary" style={{ marginTop: '8px', fontSize: '0.92rem' }}>
                      {post.summary}
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: '16px', marginTop: '12px' }}>
                    <span className="text-tertiary">{post.author.username}</span>
                    <span className="text-tertiary">{new Date(post.createdAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                </Link>
              </LiquidGlass>
            ))}
          </div>

          <div style={{ textAlign: 'center', marginTop: '32px' }}>
            <Link to="/posts" className="liquid-btn glass md">
              查看全部文章 →
            </Link>
          </div>
        </section>
      )}

      {/* Refresh wallpaper button — bottom right */}
      <button
        onClick={refresh}
        className={`wallpaper-refresh-btn${loading ? ' refreshing' : ''}`}
        disabled={loading}
        aria-label="刷新壁纸"
        title="刷新壁纸"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      </button>
    </>
  )
}
