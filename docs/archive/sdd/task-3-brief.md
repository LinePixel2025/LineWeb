# Task 3: 前端 - 在PageEditor中添加stats组件类型

## 任务概述
在页面编辑器中添加stats组件类型，使其可以拖拽到页面中。

## 文件
- Modify: `client/src/pages/admin/PageEditor.tsx:61-75` (PALETTE_ITEMS)
- Modify: `client/src/pages/admin/PageEditor.tsx:270-342` (PreviewComponent)
- Modify: `client/src/pages/admin/PageEditor.tsx:223-251` (PropsEditor)

## 接口
- Consumes: `StatsCard` 组件
- Produces: 页面编辑器中的 `stats` 组件类型

## 实现步骤

### Step 1: 添加stats到PALETTE_ITEMS

在 `client/src/pages/admin/PageEditor.tsx` 的 PALETTE_ITEMS 数组中添加：

```typescript
{ type: 'stats', label: '统计', icon: '📊', defaultProps: { items: ['posts', 'users', 'comments', 'pages'], layout: 'horizontal', showLabels: true } },
```

### Step 2: 更新ComponentType类型

修改类型定义：

```typescript
type ComponentType = 'heading' | 'paragraph' | 'image' | 'button' | 'divider'
  | 'list' | 'card' | 'columns' | 'spacer' | 'html' | 'stats'
```

### Step 3: 在PreviewComponent中添加stats渲染

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

### Step 4: 在PropsEditor中添加stats配置

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

### Step 5: 测试页面编辑器中的stats组件

1. 启动开发服务器：`npm run dev`
2. 登录管理后台
3. 进入页面管理，创建新页面
4. 从控件仓库拖拽"统计"组件到画布
5. 配置组件属性（选择显示项目、布局方式等）
6. 预览组件效果

### Step 6: 提交更改

```bash
git add client/src/pages/admin/PageEditor.tsx
git commit -m "feat: add stats component type to page editor"
```

## 全局约束
- 使用现有的LiquidGlass组件保持设计一致性
- 公开API无需认证，只返回总数不返回详细信息
- 数据缓存5分钟避免频繁请求
- 组件支持三种布局方式：horizontal、vertical、grid
- 错误时显示友好提示，加载时显示骨架屏