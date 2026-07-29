import { Link } from 'react-router-dom'
import { usePostsList } from '../hooks/useQueries'
import LiquidGlass from '../components/glass/LiquidGlass'
import StatsCard from '../components/StatsCard'
import DigitalHealthCard from '../components/DigitalHealthCard/DigitalHealthCard'
import AiAssistant from '../components/AiAssistant'

interface PostPreview {
  id: number
  title: string
  summary: string | null
  slug: string
  createdAt: string
  author: { username: string }
}

export default function HomePage() {
  const { data: postsData } = usePostsList(1, undefined, undefined, 3)
  const recentPosts = postsData?.posts ?? []

  return (
    <>
      {/* Hero */}
      <section
        style={{
          textAlign: 'center',
          padding: 'var(--lg-space-9) var(--lg-space-5) var(--lg-space-8)',
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
            padding: 'var(--lg-space-7) var(--lg-space-7)',
            maxWidth: '560px',
            width: '100%',
          }}
        >
          <h1
            style={{
              fontSize: 'clamp(2.4rem, 7vw, 4rem)',
              fontWeight: 700,
              letterSpacing: '-0.03em',
              color: 'white',
              background: 'linear-gradient(135deg, #ffffff 0%, var(--lg-accent-secondary) 50%, var(--lg-accent) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Line Web
          </h1>
          <p
            style={{
              marginTop: 'var(--lg-space-4)',
              fontSize: 'clamp(1rem, 3vw, 1.3rem)',
              color: 'var(--lg-text-secondary)',
              letterSpacing: '0.02em',
              fontWeight: 400,
            }}
          >
            代码 · 思考 · 生活
          </p>
          <div style={{ display: 'flex', gap: 'var(--lg-space-3)', justifyContent: 'center', flexWrap: 'wrap', marginTop: '36px' }}>
            <Link to="/posts" className="liquid-btn primary lg">
              浏览文章
            </Link>
            <Link to="/features" className="liquid-btn glass lg">
              探索功能
            </Link>
          </div>
        </LiquidGlass>
      </section>

      {/* DigitalHealth Section */}
      <DigitalHealthCard />

      {/* Stats Section */}
      <section
        className="home-stats-section"
        style={{
          maxWidth: '720px',
          margin: '0 auto',
          padding: '0 var(--lg-space-5)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 'var(--lg-space-7)' }}>
          <h2>网站统计</h2>
          <p className="text-secondary" style={{ marginTop: '8px' }}>网站运行数据概览</p>
        </div>

        <LiquidGlass variant="blur" chromatic={false} style={{ padding: 'var(--lg-space-6)' }}>
          <StatsCard 
            items={['posts', 'users', 'comments', 'pages']} 
            layout="horizontal" 
            showLabels={true} 
          />
        </LiquidGlass>
      </section>

      {/* Latest Posts Preview */}
      {recentPosts.length > 0 && (
        <section
          className="home-posts-section"
          style={{
            maxWidth: '720px',
            margin: '0 auto',
            padding: 'var(--lg-space-7) var(--lg-space-5) var(--lg-space-9)',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: 'var(--lg-space-7)' }}>
            <h2>最新文章</h2>
            <p className="text-secondary" style={{ marginTop: '8px' }}>近期发布的内容精选</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--lg-space-3)' }}>
            {recentPosts.map((post, i) => (
              <LiquidGlass key={post.id} variant="blur" chromatic={false} className="fade-in-stagger" style={{ padding: 'var(--lg-space-5)', animationDelay: `${i * 0.08}s` }}>
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

          <div style={{ textAlign: 'center', marginTop: 'var(--lg-space-6)' }}>
            <Link
              to="/posts"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--lg-space-2)',
                color: 'var(--lg-accent-secondary)',
                fontSize: '1rem',
                fontWeight: 500,
                textDecoration: 'none',
                transition: 'color var(--lg-transition)',
              }}
            >
              查看全部文章
              <span style={{ display: 'inline-block', transition: 'transform var(--lg-transition)' }}>→</span>
            </Link>
          </div>
        </section>
      )}

      {/* AI 助手 — 浮动聊天组件 */}
      <AiAssistant />
    </>
  )
}
