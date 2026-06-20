import { Link } from 'react-router-dom'

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
        {features.map((item, i) => (
          <Link
            key={item.path}
            to={item.path}
            className="lg-surface-strong"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: '40px 24px',
              textDecoration: 'none',
              color: 'inherit',
              cursor: 'pointer',
              gap: '16px',
              animation: `fadeIn 0.5s ease-out ${i * 0.1}s both`,
              transition: 'transform 0.3s ease, box-shadow 0.3s ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'translateY(-4px) scale(1.02)'
              e.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.15), 0 12px 32px var(--lg-glass-shadow), 0 4px 8px rgba(0,0,0,0.1)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'none'
              e.currentTarget.style.boxShadow = ''
            }}
          >
            <div style={{ fontSize: '2.8rem', lineHeight: 1 }}>{item.emoji}</div>
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
        ))}
      </div>
    </div>
  )
}
