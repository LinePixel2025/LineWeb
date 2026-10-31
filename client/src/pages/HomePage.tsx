import { Link } from 'react-router-dom'
import { usePostsList, usePublicStats, useFeaturedPages } from '../hooks/useQueries'
import { useAuth } from '../contexts/AuthContext'
import { useFeature } from '../contexts/FeatureContext'
import { Button, Icon } from '../components/ui'
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
  const { isEnabled } = useFeature()
  const showPosts = isEnabled('posts')
  const showPages = isEnabled('pages')
  const { data: postsData } = usePostsList(1, undefined, undefined, 3, showPosts)
  const { data: statsData } = usePublicStats()
  const { data: featuredData } = useFeaturedPages(showPages)
  const recentPosts = (postsData?.posts ?? []) as PostListItemData[]
  const stats = statsData as { posts: number; users: number; comments: number; pages: number } | undefined
  const featuredPages = (featuredData?.pages ?? []) as FeaturedPage[]

  return (
    <>
      <div className="gh-page-container">
        <div className="gh-home">
          {/* 行 1：问候 hero + 最新文章（便当式） */}
          <section className="gh-home-hero-row" aria-labelledby="home-greeting">
            <div className="gh-hero">
              <div className="gh-hero-sheets" aria-hidden="true">
                <span />
                <span />
              </div>
              <div className="gh-hero-sheet">
                <svg className="gh-hero-line" viewBox="0 0 260 180" fill="none" aria-hidden="true">
                  <path
                    className="gh-hero-line-path"
                    d="M14 152c30-54 50-64 84-64s50 20 82-12c22-23 32-38 58-52"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                  <path
                    className="gh-hero-line-path gh-hero-line-path--soft"
                    d="M40 168c26-34 44-44 66-44 24 0 38 14 62-8 18-16 28-30 46-44"
                    stroke="currentColor"
                    strokeWidth="1"
                    strokeLinecap="round"
                  />
                </svg>

                <p className="gh-hero-eyebrow">LineWeb</p>
                <h1 className="gh-hero-title" id="home-greeting">
                  {user ? `你好，${user.username}` : '欢迎来到 Line Web'}
                </h1>
                <p className="gh-hero-subtitle">一个记录想法、项目与日常探索的个人空间。</p>

                <div className="gh-hero-actions">
                  {showPosts && (
                    <Button variant="primary" size="lg" href="/posts">浏览文章</Button>
                  )}
                  <Button variant="secondary" size="lg" href={user ? '/profile' : '/login'}>
                    {user ? '个人资料' : '登录'}
                  </Button>
                </div>
              </div>
            </div>

            <div className="gh-home-featured">
              {!showPosts ? (
                <div className="gh-home-featured-empty">
                  <p className="gh-text-secondary">文章功能当前已关闭。</p>
                </div>
              ) : recentPosts[0] ? (
                <PostFeaturedCard post={recentPosts[0]} />
              ) : (
                <div className="gh-home-featured-empty">
                  <p className="gh-text-secondary">还没有文章。</p>
                  <Button variant="secondary" size="sm" href="/posts">去文章库看看</Button>
                </div>
              )}
            </div>
          </section>

          {/* 行 2：更多文章（+ 快捷入口）+ 侧栏（身份 / 统计 / 屏幕时间） */}
          <div className="gh-home-body">
            <div className="gh-home-main">
              <div className="gh-section-head">
                <h2 className="gh-section-title">更多文章</h2>
                {showPosts && <Link to="/posts" className="gh-section-link">全部文章 →</Link>}
              </div>

              {!showPosts ? (
                <div className="gh-empty-card">文章功能当前已关闭。</div>
              ) : recentPosts.length > 1 ? (
                <div className="gh-post-list">
                  {recentPosts.slice(1).map(post => (
                    <PostListItem key={post.id} post={post} />
                  ))}
                </div>
              ) : (
                <div className="gh-empty-card">还没有更多文章，去文章库看看吧。</div>
              )}

              <section className="gh-home-shortcuts" aria-labelledby="home-shortcuts-title">
                <div className="gh-section-head">
                  <h2 className="gh-section-title" id="home-shortcuts-title">快捷入口</h2>
                </div>
                <div className="gh-shortcut-grid">
                  {showPosts && (
                    <Link to="/posts" className="gh-shortcut-item">
                      <span className="gh-shortcut-icon"><Icon name="book" size={19} /></span>
                      <span className="gh-shortcut-label">文章列表</span>
                      <span className="gh-shortcut-hint">阅读最新内容</span>
                    </Link>
                  )}
                  {showPages && (
                    <Link to="/features" className="gh-shortcut-item">
                      <span className="gh-shortcut-icon"><Icon name="grid" size={19} /></span>
                      <span className="gh-shortcut-label">功能页面</span>
                      <span className="gh-shortcut-hint">全部工具入口</span>
                    </Link>
                  )}
                  {user && (
                    <Link to="/profile" className="gh-shortcut-item">
                      <span className="gh-shortcut-icon"><Icon name="user" size={19} /></span>
                      <span className="gh-shortcut-label">个人中心</span>
                      <span className="gh-shortcut-hint">账号与安全</span>
                    </Link>
                  )}
                  {isEnabled('calculator') && (
                    <Link to="/calculator" className="gh-shortcut-item">
                      <span className="gh-shortcut-icon"><Icon name="settings" size={19} /></span>
                      <span className="gh-shortcut-label">科学计算器</span>
                      <span className="gh-shortcut-hint">三角函数与记忆</span>
                    </Link>
                  )}
                </div>
              </section>

              {showPages && featuredPages.length > 0 && (
                <section className="gh-home-featured-pages" aria-labelledby="home-featured-title">
                  <div className="gh-section-head">
                    <h2 className="gh-section-title" id="home-featured-title">推荐功能</h2>
                  </div>
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
                </section>
              )}

              <DigitalHealthCard />
            </div>

            <aside className="gh-home-aside" aria-label="个人信息与站点数据">
              <div className="gh-identity-card">
                {user ? (
                  <>
                    <UserAvatar userId={user.id} username={user.username} size="xl" />
                    <div className="gh-identity-copy">
                      <h2 className="gh-identity-name">{user.username}</h2>
                      <p className="gh-identity-meta">{user.email}</p>
                    </div>
                    <Button variant="secondary" fullWidth href="/profile">编辑资料</Button>
                  </>
                ) : (
                  <>
                    <span className="gh-identity-name">欢迎来访</span>
                    <p className="gh-identity-meta">登录以解锁更多功能</p>
                    <Button variant="primary" fullWidth href="/login">登录</Button>
                  </>
                )}
              </div>

              {stats && (
                <div className="gh-box">
                  <h3 className="gh-box-heading">站点数据</h3>
                  <div className="gh-metric-grid">
                    {[
                      { label: '文章', value: stats.posts },
                      { label: '页面', value: stats.pages },
                      { label: '用户', value: stats.users },
                      { label: '评论', value: stats.comments },
                    ].map(({ label, value }) => (
                      <div key={label} className="gh-metric">
                        <span className="gh-metric-value">{value}</span>
                        <span className="gh-metric-label">{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </aside>
          </div>
        </div>
      </div>

      {/* AI 助手 — 浮动聊天组件 */}
      {isEnabled('aiAssistant') && <AiAssistant />}
    </>
  )
}
