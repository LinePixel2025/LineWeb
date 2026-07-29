import { memo, useState, useEffect } from 'react'
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

export default memo(function StatsCard({ items, layout, showLabels }: StatsCardProps) {
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
          <div key={item} className="gh-box" style={itemStyle}>
            <div className="skeleton" style={{ height: '32px', width: '60px', margin: '0 auto 8px' }} />
            {showLabels && <div className="skeleton" style={{ height: '16px', width: '40px', margin: '0 auto' }} />}
          </div>
        ))}
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={layoutStyle}>
        {items.map((item) => (
          <div key={item} className="gh-box" style={itemStyle}>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--gh-text-tertiary)' }}>--</div>
            {showLabels && <div style={{ fontSize: '0.85rem', color: 'var(--gh-text-tertiary)', marginTop: '4px' }}>{LABELS[item]}</div>}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={layoutStyle}>
      {items.map((item) => (
        <div key={item} className="gh-box" style={itemStyle}>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--gh-accent)' }}>
            {data[item]}
          </div>
          {showLabels && (
            <div style={{ fontSize: '0.85rem', color: 'var(--gh-text-secondary)', marginTop: '4px' }}>
              {LABELS[item]}
            </div>
          )}
        </div>
      ))}
    </div>
  )
})
