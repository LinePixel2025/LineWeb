import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'

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
        <div
          className="lg-surface-strong glass-rise"
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
          <p style={{ fontSize: 'clamp(0.95rem, 3vw, 1.1rem)', lineHeight: 1.6, marginTop: '16px', color: 'rgba(255,255,255,0.78)' }}>
            一个融合 Liquid Glass 设计语言的个人空间
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '36px' }}>
            <Link to="/posts" className="liquid-btn primary lg">
              浏览文章
            </Link>
            <Link to="/features" className="liquid-btn glass lg">
              探索功能
            </Link>
          </div>
        </div>
      </section>

      {/* Latest Posts Preview */}
      {recentPosts.length > 0 && (
        <section
          style={{
            padding: '80px 24px 120px',
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
              <Link
                key={post.id}
                to={`/posts/${post.slug}`}
                className="lg-surface"
                style={{
                  display: 'block',
                  padding: '24px',
                  textDecoration: 'none',
                  color: 'inherit',
                  animation: `fadeIn 0.4s ease-out ${i * 0.08}s both`,
                  transition: 'transform 0.25s ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none' }}
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
            ))}
          </div>

          <div style={{ textAlign: 'center', marginTop: '32px' }}>
            <Link to="/posts" className="liquid-btn glass md">
              查看全部文章 →
            </Link>
          </div>
        </section>
      )}
    </>
  )
}
