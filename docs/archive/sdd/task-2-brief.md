# Task 2: 前端 - 创建统计数字卡片组件

## 任务概述
创建StatsCard组件，用于显示网站统计数据（文章数、用户数、评论数、页面数）。

## 文件
- Create: `client/src/components/StatsCard.tsx`

## 接口
- Produces: `StatsCard` 组件，接收 `items`, `layout`, `showLabels` props

## 实现步骤

### Step 1: 创建StatsCard组件

```typescript
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
          <LiquidGlass key={item} variant="blur" style={itemStyle}>
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
          <LiquidGlass key={item} variant="blur" style={itemStyle}>
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
        <LiquidGlass key={item} variant="blur" style={itemStyle}>
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
```

### Step 2: 测试组件导入

在任意页面临时导入组件测试：

```typescript
import StatsCard from '../components/StatsCard'

// 在render中添加
<StatsCard items={['posts', 'users', 'comments', 'pages']} layout="horizontal" showLabels={true} />
```

### Step 3: 提交更改

```bash
git add client/src/components/StatsCard.tsx
git commit -m "feat: create StatsCard component"
```

## 全局约束
- 使用现有的LiquidGlass组件保持设计一致性
- 公开API无需认证，只返回总数不返回详细信息
- 数据缓存5分钟避免频繁请求
- 组件支持三种布局方式：horizontal、vertical、grid
- 错误时显示友好提示，加载时显示骨架屏