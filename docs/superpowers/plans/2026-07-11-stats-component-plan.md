# 首页统计组件实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在首页添加统计组件，展示网站概览数据（文章数、用户数、评论数、页面数），作为页面编辑器中的新组件类型

**Architecture:** 新增公开API端点 `/api/stats/public`，在PageEditor中添加 `stats` 组件类型，组件从API获取数据并显示为数字卡片

**Tech Stack:** Express.js (后端), React 19 + TypeScript (前端), Prisma (数据库)

## Global Constraints

- 使用现有的LiquidGlass组件保持设计一致性
- 公开API无需认证，只返回总数不返回详细信息
- 数据缓存5分钟避免频繁请求
- 组件支持三种布局方式：horizontal、vertical、grid
- 错误时显示友好提示，加载时显示骨架屏

---

## 文件结构

### 后端文件
- `server/src/routes/stats.ts` - 修改：添加公开API端点

### 前端文件
- `client/src/pages/admin/PageEditor.tsx` - 修改：添加stats组件类型、PreviewComponent渲染、PropsEditor配置
- `client/src/components/StatsCard.tsx` - 新建：统计数字卡片组件

---

### Task 1: 后端 - 添加公开统计API端点

**Files:**
- Modify: `server/src/routes/stats.ts:52-70`

**Interfaces:**
- Produces: `GET /api/stats/public` 端点，返回 `{ posts: number, users: number, comments: number, pages: number }`

- [ ] **Step 1: 更新缓存类型以支持key字段**

修改缓存类型定义：

```typescript
let statsCache: { key: string; data: unknown; expireAt: number } | null = null
```

- [ ] **Step 2: 在stats.ts中添加公开端点**

在现有管理员端点之后添加公开端点：

```typescript
// === 公开统计端点（无需认证） ===
router.get('/public', async (_req: Request, res: Response) => {
  try {
    // 使用独立的缓存key，避免与管理员缓存冲突
    const cacheKey = 'public_stats'
    const now = Date.now()
    
    // 检查缓存
    if (statsCache && statsCache.key === cacheKey && now < statsCache.expireAt) {
      res.setHeader('Cache-Control', 'public, max-age=300')
      res.json(statsCache.data)
      return
    }

    // 只查询需要的数据
    const [totalPosts, totalUsers, totalComments, totalPages] = await Promise.all([
      prisma.post.count(),
      prisma.user.count(),
      prisma.comment.count(),
      prisma.page.count(),
    ])

    const data = {
      posts: totalPosts,
      users: totalUsers,
      comments: totalComments,
      pages: totalPages,
    }

    // 更新缓存
    statsCache = { key: cacheKey, data, expireAt: now + STATS_CACHE_TTL_MS }

    res.setHeader('Cache-Control', 'public, max-age=300')
    res.json(data)
  } catch (err) {
    console.error('获取公开统计数据失败:', err)
    res.status(500).json({ error: '获取统计数据失败' })
  }
})
```

- [ ] **Step 3: 测试公开API端点**

启动服务器后，使用curl测试：

```bash
curl http://localhost:3001/api/stats/public
```

预期响应：
```json
{"posts":42,"users":128,"comments":256,"pages":12}
```

- [ ] **Step 4: 提交更改**

```bash
git add server/src/routes/stats.ts
git commit -m "feat: add public stats API endpoint"
```

---

### Task 2: 前端 - 创建统计数字卡片组件

**Files:**
- Create: `client/src/components/StatsCard.tsx`

**Interfaces:**
- Produces: `StatsCard` 组件，接收 `items`, `layout`, `showLabels` props

- [ ] **Step 1: 创建StatsCard组件**

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

- [ ] **Step 2: 测试组件导入**

在任意页面临时导入组件测试：

```typescript
import StatsCard from '../components/StatsCard'

// 在render中添加
<StatsCard items={['posts', 'users', 'comments', 'pages']} layout="horizontal" showLabels={true} />
```

- [ ] **Step 3: 提交更改**

```bash
git add client/src/components/StatsCard.tsx
git commit -m "feat: create StatsCard component"
```

---

### Task 3: 前端 - 在PageEditor中添加stats组件类型

**Files:**
- Modify: `client/src/pages/admin/PageEditor.tsx:61-75` (PALETTE_ITEMS)
- Modify: `client/src/pages/admin/PageEditor.tsx:270-342` (PreviewComponent)
- Modify: `client/src/pages/admin/PageEditor.tsx:223-251` (PropsEditor)

**Interfaces:**
- Consumes: `StatsCard` 组件
- Produces: 页面编辑器中的 `stats` 组件类型

- [ ] **Step 1: 添加stats到PALETTE_ITEMS**

在 `client/src/pages/admin/PageEditor.tsx` 的 PALETTE_ITEMS 数组中添加：

```typescript
{ type: 'stats', label: '统计', icon: '📊', defaultProps: { items: ['posts', 'users', 'comments', 'pages'], layout: 'horizontal', showLabels: true } },
```

- [ ] **Step 2: 更新ComponentType类型**

修改类型定义：

```typescript
type ComponentType = 'heading' | 'paragraph' | 'image' | 'button' | 'divider'
  | 'list' | 'card' | 'columns' | 'spacer' | 'html' | 'stats'
```

- [ ] **Step 3: 在PreviewComponent中添加stats渲染**

首先在文件顶部添加导入：

```typescript
import StatsCard from '../../components/StatsCard'
```

然后在 `PreviewComponent` 的 `renderInner` 函数中添加stats case：

```typescript
case 'stats': {
  const items = (comp.props.items as string[]) || ['posts', 'users', 'comments', 'pages']
  const layout = (comp.props.layout as string) || 'horizontal'
  const showLabels = comp.props.showLabels !== false
  
  return (
    <StatsCard 
      items={items as ('posts' | 'users' | 'comments' | 'pages')[]} 
      layout={layout as 'horizontal' | 'vertical' | 'grid'} 
      showLabels={showLabels} 
    />
  )
}
```

- [ ] **Step 4: 在PropsEditor中添加stats配置**

在 `PropsEditor` 的 `render` 函数中添加stats case：

```typescript
case 'stats': {
  const items = (comp.props.items as string[]) || ['posts', 'users', 'comments', 'pages']
  const layout = (comp.props.layout as string) || 'horizontal'
  const showLabels = comp.props.showLabels !== false
  
  return (
    <div className="pe-fields">
      <div className="pe-field">
        <label className="pe-field-label">显示项目</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(['posts', 'users', 'comments', 'pages'] as const).map((item) => (
            <label key={item} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={items.includes(item)} 
                onChange={(e) => {
                  const newItems = e.target.checked 
                    ? [...items, item] 
                    : items.filter(i => i !== item)
                  set('items', newItems)
                }}
                style={{ accentColor: 'var(--lg-accent)' }} 
              />
              {item === 'posts' ? '文章' : item === 'users' ? '用户' : item === 'comments' ? '评论' : '页面'}
            </label>
          ))}
        </div>
      </div>
      {S('layout', '布局方式', [
        { value: 'horizontal', label: '水平' },
        { value: 'vertical', label: '垂直' },
        { value: 'grid', label: '网格' },
      ])}
      <label className="pe-toggle">
        <input type="checkbox" checked={showLabels} onChange={e => set('showLabels', e.target.checked)} />
        <span className="pe-toggle-slider" /> <span className="pe-toggle-label">显示标签</span>
      </label>
    </div>
  )
}
```

- [ ] **Step 5: 测试页面编辑器中的stats组件**

1. 启动开发服务器：`npm run dev`
2. 登录管理后台
3. 进入页面管理，创建新页面
4. 从控件仓库拖拽"统计"组件到画布
5. 配置组件属性（选择显示项目、布局方式等）
6. 预览组件效果

- [ ] **Step 6: 提交更改**

```bash
git add client/src/pages/admin/PageEditor.tsx
git commit -m "feat: add stats component type to page editor"
```

---

### Task 4: 前端 - 在首页添加统计组件

**Files:**
- Modify: `client/src/pages/HomePage.tsx:76-123`

**Interfaces:**
- Consumes: `StatsCard` 组件

- [ ] **Step 1: 在首页导入StatsCard组件**

在 `client/src/pages/HomePage.tsx` 顶部添加导入：

```typescript
import StatsCard from '../components/StatsCard'
```

- [ ] **Step 2: 在最新文章部分之前添加统计组件**

在最新文章预览部分之前添加统计组件：

```typescript
{/* Stats Section */}
<section
  className="home-stats-section"
  style={{
    maxWidth: '720px',
    margin: '0 auto',
    padding: '0 24px',
  }}
>
  <div style={{ textAlign: 'center', marginBottom: '40px' }}>
    <h2>网站统计</h2>
    <p className="text-secondary" style={{ marginTop: '8px' }}>网站运行数据概览</p>
  </div>
  
  <LiquidGlass variant="blur" chromatic={false} style={{ padding: '32px' }}>
    <StatsCard 
      items={['posts', 'users', 'comments', 'pages']} 
      layout="horizontal" 
      showLabels={true} 
    />
  </LiquidGlass>
</section>
```

- [ ] **Step 3: 测试首页统计组件**

1. 启动开发服务器：`npm run dev`
2. 访问首页：`http://localhost:5173`
3. 验证统计组件显示正确
4. 测试不同布局方式（修改layout prop）

- [ ] **Step 4: 提交更改**

```bash
git add client/src/pages/HomePage.tsx
git commit -m "feat: add stats component to homepage"
```

---

### Task 5: 测试与验证

**Files:**
- Test: 所有修改的文件

- [ ] **Step 1: 测试后端API**

```bash
# 测试公开端点
curl http://localhost:3001/api/stats/public

# 测试管理员端点（需要认证）
curl -H "Authorization: Bearer <token>" http://localhost:3001/api/stats
```

- [ ] **Step 2: 测试前端组件**

1. 测试页面编辑器中的stats组件拖拽和配置
2. 测试首页统计组件显示
3. 测试错误处理（断开网络连接）
4. 测试加载状态（网络慢速）

- [ ] **Step 3: 运行TypeScript检查**

```bash
cd server && npx tsc --noEmit
cd client && npx tsc --noEmit
```

- [ ] **Step 4: 最终提交**

```bash
git add .
git commit -m "feat: complete stats component implementation"
```