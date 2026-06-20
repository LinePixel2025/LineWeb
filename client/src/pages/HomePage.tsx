import { Link } from 'react-router-dom'

export default function HomePage() {
  return (
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
          <Link to="/posts" className="liquid-btn primary lg" style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: 'clamp(12px, 3.5vw, 14px) clamp(24px, 6vw, 32px)', borderRadius: '9999px', fontWeight: 500,
            background: 'linear-gradient(135deg, var(--lg-accent), #40a9ff)',
            color: 'white', border: 'none', cursor: 'pointer',
            textDecoration: 'none', fontSize: 'clamp(0.9rem, 2.5vw, 1rem)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3), 0 4px 16px rgba(0,113,227,0.35)',
          }}>
            浏览文章
          </Link>
          <Link to="/features" className="liquid-btn glass lg" style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: 'clamp(12px, 3.5vw, 14px) clamp(24px, 6vw, 32px)', borderRadius: '9999px', fontWeight: 500,
            background: 'rgba(255,255,255,0.08)',
            backdropFilter: 'url(#lg-core) blur(0.6px)',
            color: '#f5f5f7', border: '1px solid rgba(255,255,255,0.18)',
            cursor: 'pointer', textDecoration: 'none', fontSize: 'clamp(0.9rem, 2.5vw, 1rem)',
            boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.15), 0 2px 8px rgba(0,0,0,0.2)',
          }}>
            探索功能
          </Link>
        </div>
      </div>
    </section>
  )
}
