import { useState, useEffect } from 'react'
import LiquidGlass from './glass/LiquidGlass'
import api from '../lib/api'

interface StatsData {
  posts: number
  users: number
  comments: number
  pages: number
}

interface StatsCardProps {
  items: ('posts' | 'users' | 'comments' | 'pages')[]
  layout: 'horizontal' | 'vertical' | 'grid'
  showLabels: boolean
}

const LABELS: Record<string, string> = {
  posts: '文章',
  users: '用户',
  comments: '评论',
  pages: '页面',
}

export default function StatsCard({ items, layout, showLabels }: StatsCardProps) {
  const [data, setData] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    api.get<StatsData>('/stats/public')
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  const layoutStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: layout === 'vertical' ? 'column' : 'row',
    flexWrap: layout === 'grid' ? 'wrap' : 'nowrap',
    gap: '16px',
    justifyContent: 'center',
    alignItems: 'center',
  }

  const itemStyle: React.CSSProperties = {
    flex: layout === 'grid' ? '1 1 calc(50% - 16px)' : '1',
    minWidth: layout === 'grid' ? '120px' : undefined,
    textAlign: 'center',
    padding: '20px',
  }

  if (loading) {
    return (
      <div style={layoutStyle}>
        {items.map((item) => (
          <LiquidGlass key={item} variant="blur" interactive={false} chromatic={false} style={itemStyle}>
            <div className="skeleton" style={{ height: '32px', width: '60px', margin: '0 auto 8px' }} />
            {showLabels && <div className="skeleton" style={{ height: '16px', width: '40px', margin: '0 auto' }} />}
          </LiquidGlass>
        ))}
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={layoutStyle}>
        {items.map((item) => (
          <LiquidGlass key={item} variant="blur" interactive={false} chromatic={false} style={itemStyle}>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--lg-text-tertiary)' }}>--</div>
            {showLabels && <div style={{ fontSize: '0.85rem', color: 'var(--lg-text-tertiary)', marginTop: '4px' }}>{LABELS[item]}</div>}
          </LiquidGlass>
        ))}
      </div>
    )
  }

  return (
    <div style={layoutStyle}>
      {items.map((item) => (
        <LiquidGlass key={item} variant="blur" interactive={false} chromatic={false} style={itemStyle}>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--lg-text-primary)' }}>
            {data[item]}
          </div>
          {showLabels && (
            <div style={{ fontSize: '0.85rem', color: 'var(--lg-text-secondary)', marginTop: '4px' }}>
              {LABELS[item]}
            </div>
          )}
        </LiquidGlass>
      ))}
    </div>
  )
}
