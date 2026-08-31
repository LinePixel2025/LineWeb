import { Link } from 'react-router-dom'
import { usePostsList, usePublicStats, useFeaturedPages } from '../hooks/useQueries'
import { useAuth } from '../contexts/AuthContext'
import { GitHubButton } from '../components/ui'
import UserAvatar from '../components/UserAvatar'
import DigitalHealthCard from '../components/DigitalHealthCard/DigitalHealthCard'
import AiAssistant from '../components/AiAssistant'
import PostListItem, { PostFeaturedCard, type PostListItemData } from '../components/PostListItem'

interface FeaturedPage {
  id: number
  title: string
  slug: string
  featureEmoji: string | null
  featureDesc: string | null
}

export default function HomePage() {
  const { user } = useAuth()
  const { data: postsData } = usePostsList(1, undefined, undefined, 3)
  const { data: statsData } = usePublicStats()
  const { data: featuredData } = useFeaturedPages()
  const recentPosts = (postsData?.posts ?? []) as PostListItemData[]
  const stats = statsData as { posts: number; users: number; comments: number; pages: number } | undefined
  const featuredPages = (featuredData?.pages ?? []) as FeaturedPage[]

  return (
    <>
      <div className="gh-page-container">
        <div className="gh-dashboard">
          {/* Left: Profile */}
          <div className="gh-dashboard-sidebar">
            <div className="gh-box" style={{ textAlign: 'center' }}>
              {user ? (
                <>
                  <UserAvatar userId={user.id} username={user.username} size="xl" />
                  <h3 style={{ margin: '12px 0 4px', fontSize: '1.25rem' }}>{user.username}</h3>
                  <p className="gh-text-secondary" style={{ fontSize: '0.85rem' }}>{user.email}</p>
                  <div style={{ marginTop: '16px' }}>
                    <GitHubButton variant="ghost" href="/profile" fullWidth>编辑资料</GitHubButton>
                  </div>
                </>
              ) : (
                <>
                  <div style={{
                    width: '64px', height: '64px', borderRadius: '50%',
                    background: 'var(--gh-canvas)', margin: '0 auto',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--gh-text-tertiary)' }}>
                      <circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 1 0-16 0" />
                    </svg>
                  </div>
                  <h3 style={{ margin: '12px 0 4px', fontSize: '1.25rem' }}>欢迎来访</h3>
                  <p className="gh-text-secondary" style={{ fontSize: '0.85rem', marginBottom: '16px' }}>登录以解锁更多功能</p>
                  <GitHubButton variant="primary" href="/login" fullWidth>登录</GitHubButton>
                </>
              )}
            </div>

            <DigitalHealthCard />
          </div>

          {/* Center: Feed */}
          <div className="gh-dashboard-feed">
            <div className="gh-page-header">
              <h2 className="gh-page-title">首页</h2>
            </div>

            {recentPosts.length === 0 ? (
              <div className="gh-box" style={{ textAlign: 'center', padding: '48px 24px' }}>
                <p className="gh-text-secondary">暂无文章</p>
                <GitHubButton variant="ghost" href="/posts" style={{ marginTop: '8px' }}>浏览文章库</GitHubButton>
              </div>
            ) : (
              <>
                <PostFeaturedCard post={recentPosts[0]} />
                {recentPosts.length > 1 && (
                  <div className="gh-post-list">
                    {recentPosts.slice(1).map(post => (
                      <PostListItem key={post.id} post={post} />
                    ))}
                  </div>
                )}
              </>
            )}

            <div>
              <GitHubButton variant="ghost" href="/posts" size="sm">查看全部文章 →</GitHubButton>
            </div>
          </div>

          {/* Right: Quick Links */}
          <div className="gh-dashboard-sidebar">
            {stats && (
              <div className="gh-box">
                <h4 className="gh-box-heading">站点统计</h4>
                <div className="gh-stats-grid">
                  {[
                    { label: '文章', count: stats.posts },
                    { label: '页面', count: stats.pages },
                    { label: '用户', count: stats.users },
                    { label: '评论', count: stats.comments },
                  ].map(({ label, count }) => (
                    <div key={label} className="gh-stat-cell">
                      <div className="gh-stat-cell-count">{count}</div>
                      <div className="gh-stat-cell-label">{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="gh-box">
              <h4 className="gh-box-heading">快捷导航</h4>
              <div className="gh-nav-links">
                <Link to="/posts" className="gh-btn gh-btn--ghost gh-btn--full gh-nav-link">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
                  </svg>
                  文章列表
                </Link>
                <Link to="/features" className="gh-btn gh-btn--ghost gh-btn--full gh-nav-link">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                  功能页面
                </Link>
                {user && (
                  <Link to="/profile" className="gh-btn gh-btn--ghost gh-btn--full gh-nav-link">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 1 0-16 0" />
                    </svg>
                    个人中心
                  </Link>
                )}
                <Link to="/calculator" className="gh-btn gh-btn--ghost gh-btn--full gh-nav-link">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="4" y="2" width="16" height="20" rx="2" /><line x1="8" y1="6" x2="16" y2="6" />
                  </svg>
                  计算器
                </Link>
              </div>
            </div>

            {featuredPages.length > 0 && (
              <div className="gh-box">
                <h4 className="gh-box-heading">推荐功能</h4>
                <div className="gh-featured-list">
                  {featuredPages.map((page) => (
                    <Link key={page.id} to={`/page/${page.slug}`} className="gh-list-item gh-featured-item">
                      <span className="gh-featured-emoji">{page.featureEmoji || '📄'}</span>
                      <div className="gh-list-item-content">
                        <span className="gh-list-item-title">{page.title}</span>
                        {page.featureDesc && <span className="gh-featured-desc">{page.featureDesc}</span>}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* AI 助手 — 浮动聊天组件 */}
      <AiAssistant />
    </>
  )
}
