import { Link } from 'react-router-dom'
import { usePostsList, usePublicStats, useFeaturedPages } from '../hooks/useQueries'
import { useAuth } from '../contexts/AuthContext'
import { GitHubButton } from '../components/ui'
import UserAvatar from '../components/UserAvatar'

interface PostPreview {
  id: number
  title: string
  summary: string | null
  slug: string
  createdAt: string
  author: { username: string }
}

interface FeaturedPage {
  id: number
  title: string
  slug: string
  featureEmoji: string | null
  featureDesc: string | null
}

function RepoCircle({ letter }: { letter: string }) {
  return <span className="gh-repo-circle">{letter}</span>
}

export default function HomePage() {
  const { user } = useAuth()
  const { data: postsData } = usePostsList(1, undefined, undefined, 3)
  const { data: statsData } = usePublicStats()
  const { data: featuredData } = useFeaturedPages()
  const recentPosts = (postsData?.posts ?? []) as PostPreview[]
  const stats = statsData as { posts: number; users: number; comments: number; pages: number } | undefined
  const featuredPages = (featuredData?.pages ?? []) as FeaturedPage[]

  return (
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
                  background: 'var(--gh-color-bg-tertiary)', margin: '0 auto',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--gh-color-fg-muted)' }}>
                    <circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 1 0-16 0" />
                  </svg>
                </div>
                <h3 style={{ margin: '12px 0 4px', fontSize: '1.25rem' }}>欢迎来访</h3>
                <p className="gh-text-secondary" style={{ fontSize: '0.85rem', marginBottom: '16px' }}>登录以解锁更多功能</p>
                <GitHubButton variant="primary" href="/login" fullWidth>登录</GitHubButton>
              </>
            )}
          </div>

          {stats && (
            <div className="gh-box" style={{ marginTop: '16px' }}>
              <h4 className="gh-text-secondary" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' }}>站点统计</h4>
              <div className="gh-stats-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {[
                  { label: '文章', count: stats.posts },
                  { label: '页面', count: stats.pages },
                  { label: '用户', count: stats.users },
                  { label: '评论', count: stats.comments },
                ].map(({ label, count }) => (
                  <div key={label} className="gh-box" style={{ textAlign: 'center', padding: '10px' }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>{count}</div>
                    <div className="gh-text-tertiary" style={{ fontSize: '0.75rem' }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {recentPosts.map((post) => (
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
          )}

          <div style={{ marginTop: '12px' }}>
            <GitHubButton variant="ghost" href="/posts" size="sm">查看全部文章 →</GitHubButton>
          </div>
        </div>

        {/* Right: Quick Links */}
        <div className="gh-dashboard-sidebar">
          <div className="gh-box">
            <h4 className="gh-text-secondary" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px' }}>快捷导航</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <Link to="/posts" className="gh-btn gh-btn--ghost gh-btn--full" style={{ justifyContent: 'flex-start' } as React.CSSProperties}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px', flexShrink: 0 }}>
                  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
                </svg>
                文章列表
              </Link>
              <Link to="/features" className="gh-btn gh-btn--ghost gh-btn--full" style={{ justifyContent: 'flex-start' } as React.CSSProperties}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px', flexShrink: 0 }}>
                  <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
                功能页面
              </Link>
              {user && (
                <Link to="/profile" className="gh-btn gh-btn--ghost gh-btn--full" style={{ justifyContent: 'flex-start' } as React.CSSProperties}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px', flexShrink: 0 }}>
                    <circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 1 0-16 0" />
                  </svg>
                  个人中心
                </Link>
              )}
              <Link to="/calculator" className="gh-btn gh-btn--ghost gh-btn--full" style={{ justifyContent: 'flex-start' } as React.CSSProperties}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px', flexShrink: 0 }}>
                  <rect x="4" y="2" width="16" height="20" rx="2" /><line x1="8" y1="6" x2="16" y2="6" />
                </svg>
                计算器
              </Link>
            </div>
          </div>

          {featuredPages.length > 0 && (
            <div className="gh-box" style={{ marginTop: '16px' }}>
              <h4 className="gh-text-secondary" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px' }}>推荐功能</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {featuredPages.map((page) => (
                  <Link
                    key={page.id}
                    to={`/page/${page.slug}`}
                    className="gh-list-item"
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    <span style={{ fontSize: '1.1rem' }}>{page.featureEmoji || '📄'}</span>
                    <div className="gh-list-item-content">
                      <span className="gh-list-item-title">{page.title}</span>
                      {page.featureDesc && (
                        <span className="gh-text-tertiary" style={{ fontSize: '0.75rem' }}>{page.featureDesc}</span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
