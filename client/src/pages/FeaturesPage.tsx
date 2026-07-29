import { Link } from 'react-router-dom'
import LiquidGlass from '../components/glass/LiquidGlass'
import { useFeaturedPages } from '../hooks/useQueries'

interface FeaturedPage {
  id: number
  title: string
  slug: string
  featureEmoji: string | null
  featureDesc: string | null
}

const featureIcons: Record<string, React.ReactNode> = {
  calculator: <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" /><line x1="8" y1="6" x2="16" y2="6" /><line x1="8" y1="10" x2="8" y2="10.01" /><line x1="12" y1="10" x2="16" y2="10" /><line x1="8" y1="14" x2="8" y2="14.01" /><line x1="12" y1="14" x2="16" y2="14" /><line x1="8" y1="18" x2="8" y2="18.01" /><line x1="12" y1="18" x2="16" y2="18" /></svg>,
  posts: <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /></svg>,
  profile: <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 1 0-16 0" /></svg>,
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
    <div className="page container" style={{ maxWidth: '800px', paddingTop: 'calc(var(--lg-nav-height) + 60px)' }}>
      <div style={{ textAlign: 'center', marginBottom: '48px' }}>
        <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', display: 'inline-block', color: 'var(--lg-text-primary)' }}>
          功能界面
        </h1>
        <p className="text-secondary" style={{ fontSize: '1.05rem', marginTop: '12px' }}>
          探索 Line Web 提供的各种工具与功能
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
        {/* 内置功能卡片 */}
        {features.map((item, i) => (
          <LiquidGlass
            key={item.path}
            variant="strong"
            chromatic={false}
            className="features-card fade-in-stagger"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              gap: '16px',
              animationDelay: `${i * 0.1}s`,
            }}
          >
            <Link
              to={item.path}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textDecoration: 'none',
                color: 'inherit',
                gap: '16px',
              }}
            >
              <div className="features-emoji" style={{ lineHeight: 1 }}>{featureIcons[item.icon]}</div>
              <div>
                <h3 style={{ fontSize: '1.2rem', marginBottom: '6px' }}>{item.title}</h3>
                <p className="text-secondary" style={{ fontSize: '0.88rem', margin: 0 }}>{item.desc}</p>
              </div>
              {item.badge && (
                <span style={{
                  fontSize: '0.72rem', padding: '2px 12px',
                  borderRadius: '9999px',
                  background: 'var(--lg-accent-soft)',
                  color: 'var(--lg-accent)',
                }}>
                  {item.badge}
                </span>
              )}
            </Link>
          </LiquidGlass>
        ))}

        {/* 自定义页面卡片 */}
        {customPages.map((item, i) => (
          <LiquidGlass
            key={item.slug}
            variant="strong"
            chromatic={false}
            className="features-card fade-in-stagger"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              gap: '16px',
              animationDelay: `${(i + features.length) * 0.1}s`,
            }}
          >
            <Link
              to={`/page/${item.slug}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textDecoration: 'none',
                color: 'inherit',
                gap: '16px',
              }}
            >
              <div className="features-emoji" style={{ lineHeight: 1 }}>
                {item.featureEmoji ? (
                  <span>{item.featureEmoji}</span>
                ) : (
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                )}
              </div>
              <div>
                <h3 style={{ fontSize: '1.2rem', marginBottom: '6px' }}>{item.title}</h3>
                {item.featureDesc && (
                  <p className="text-secondary" style={{ fontSize: '0.88rem', margin: 0 }}>
                    {item.featureDesc}
                  </p>
                )}
              </div>
            </Link>
          </LiquidGlass>
        ))}
      </div>

      {isSuccess && customPages.length === 0 && (
        <p className="text-tertiary" style={{ textAlign: 'center', marginTop: '24px' }}>
          管理员尚未添加自定义模块
        </p>
      )}
    </div>
  )
}
