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
      <section className="home-section">
        <div className="home-hero-mesh" />
        <div className="home-hero-content">
          <LiquidGlass variant="strong" chromatic={false} className="home-hero-card">
            <h1 className="home-hero-title">Line Web</h1>
            <p className="home-hero-subtitle">代码 · 思考 · 生活</p>
            <div className="home-hero-actions">
              <Link to="/posts" className="liquid-btn primary lg">浏览文章</Link>
              <Link to="/features" className="liquid-btn glass lg">探索功能</Link>
            </div>
          </LiquidGlass>
        </div>
        <div className="home-scroll-hint">
          <svg width="20" height="30" viewBox="0 0 20 30" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="home-scroll-arrow">
            <path d="M10 2v18" /><path d="m4 14 6 6 6-6" />
          </svg>
        </div>
      </section>

      {/* Bento Grid Section */}
      <div className="home-bento">
        {/* Stats */}
        <div className="home-bento-card home-bento-stats">
          <LiquidGlass variant="blur" chromatic={false} className="home-bento-glass">
            <h3 className="home-bento-title">网站统计</h3>
            <StatsCard
              items={['posts', 'users', 'comments', 'pages']}
              layout="horizontal"
              showLabels={true}
            />
          </LiquidGlass>
        </div>

        {/* DigitalHealth */}
        <div className="home-bento-card home-bento-health">
          <DigitalHealthCard />
        </div>

        {/* Latest Posts */}
        {recentPosts.length > 0 && (
          <div className="home-bento-card home-bento-posts">
            <LiquidGlass variant="blur" chromatic={false} className="home-bento-glass">
              <h3 className="home-bento-title">最新文章</h3>
              <div className="home-bento-posts-grid">
                {recentPosts.map((post, i) => (
                  <Link key={post.id} to={`/posts/${post.slug}`} className="home-bento-post-card fade-in-stagger" style={{ animationDelay: `${i * 0.08}s` }}>
                    <h4>{post.title}</h4>
                    {post.summary && <p className="text-secondary home-bento-post-summary">{post.summary}</p>}
                    <div className="home-bento-post-meta">
                      <span className="text-tertiary">{post.author.username}</span>
                      <span className="text-tertiary">{new Date(post.createdAt).toLocaleDateString('zh-CN')}</span>
                    </div>
                  </Link>
                ))}
              </div>
              <Link to="/posts" className="home-bento-view-all">
                查看全部文章 →
              </Link>
            </LiquidGlass>
          </div>
        )}
      </div>

      {/* AI 助手 */}
      <AiAssistant />
    </>
  )
}
