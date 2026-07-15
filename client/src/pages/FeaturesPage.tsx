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

const features = [
  {
    title: '计算器',
    desc: '基础运算与百分比计算，清晰直观的交互体验',
    path: '/calculator',
    emoji: '🧮',
  },
  {
    title: '文章阅读',
    desc: '浏览已发布的文章，支持完整的 Markdown 渲染',
    path: '/posts',
    emoji: '📝',
  },
  {
    title: '个人中心',
    desc: '管理你的账号信息与个人资料',
    path: '/profile',
    emoji: '👤',
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
              <div className="features-emoji" style={{ lineHeight: 1 }}>{item.emoji}</div>
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
                {item.featureEmoji || '📄'}
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
