import { Link } from 'react-router-dom'
import { useFeaturedPages } from '../hooks/useQueries'
import { GitHubBadge } from '../components/ui'

interface FeaturedPage {
  id: number
  title: string
  slug: string
  featureEmoji: string | null
  featureDesc: string | null
}

const featureIcons: Record<string, React.ReactNode> = {
  calculator: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" /><line x1="8" y1="6" x2="16" y2="6" /><line x1="8" y1="10" x2="8" y2="10.01" /><line x1="12" y1="10" x2="16" y2="10" /><line x1="8" y1="14" x2="8" y2="14.01" /><line x1="12" y1="14" x2="16" y2="14" /><line x1="8" y1="18" x2="8" y2="18.01" /><line x1="12" y1="18" x2="16" y2="18" /></svg>,
  posts: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /></svg>,
  profile: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 1 0-16 0" /></svg>,
}

const features = [
  {
    title: '计算器',
    desc: '基础运算与百分比计算，清晰直观的交互体验',
    path: '/calculator',
    icon: 'calculator',
  },
  {
    title: '文章阅读',
    desc: '浏览已发布的文章，支持完整的 Markdown 渲染',
    path: '/posts',
    icon: 'posts',
  },
  {
    title: '个人中心',
    desc: '管理你的账号信息与个人资料',
    path: '/profile',
    icon: 'profile',
    badge: '需登录',
  },
]

export default function FeaturesPage() {
  const { data: featuredData, isSuccess } = useFeaturedPages()
  const customPages = featuredData?.pages ?? []

  return (
    <div className="gh-page-container">
      <div className="gh-page-header" style={{ textAlign: 'center' }}>
        <h1 className="gh-page-title">功能页面</h1>
        <p className="gh-text-secondary">探索 Line Web 提供的各种工具与功能</p>
      </div>

      <div className="gh-feature-grid">
        {features.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className="gh-box"
            style={{
              textDecoration: 'none', color: 'inherit',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              textAlign: 'center', gap: '12px', padding: '24px',
            }}
          >
            <div style={{ color: 'var(--gh-color-fg-muted)' }}>{featureIcons[item.icon]}</div>
            <div>
              <h3 style={{ fontSize: '1rem', marginBottom: '4px' }}>{item.title}</h3>
              <p className="gh-text-secondary" style={{ fontSize: '0.82rem', margin: 0 }}>{item.desc}</p>
            </div>
            {item.badge && (
              <GitHubBadge variant="accent">{item.badge}</GitHubBadge>
            )}
          </Link>
        ))}

      </div>

      {customPages.length > 0 && (
        <section className="gh-feature-custom-pages" aria-labelledby="custom-pages-heading">
          <h2 id="custom-pages-heading" className="gh-feature-custom-pages-title">自定义页面</h2>
          <div className="gh-feature-grid">
            {customPages.map((item) => (
          <Link
            key={item.slug}
            to={`/page/${item.slug}`}
            className="gh-box"
            style={{
              textDecoration: 'none', color: 'inherit',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              textAlign: 'center', gap: '12px', padding: '24px',
            }}
          >
            <div style={{ fontSize: '1.5rem' }}>{item.featureEmoji || (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--gh-color-fg-muted)' }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            )}</div>
            <div>
              <h3 style={{ fontSize: '1rem', marginBottom: '4px' }}>{item.title}</h3>
              {item.featureDesc && (
                <p className="gh-text-secondary" style={{ fontSize: '0.82rem', margin: 0 }}>{item.featureDesc}</p>
              )}
            </div>
          </Link>
            ))}
          </div>
        </section>
      )}

      {isSuccess && customPages.length === 0 && (
        <p className="gh-text-tertiary" style={{ textAlign: 'center', marginTop: '24px' }}>
          管理员尚未添加自定义模块
        </p>
      )}
    </div>
  )
}
