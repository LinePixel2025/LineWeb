# Task 2: 前端 - 创建统计数字卡片组件

## 实现内容

创建了 `StatsCard` 组件，用于显示网站统计数据（文章数、用户数、评论数、页面数）。

### 核心功能
- **数据获取**: 使用 `api.get('/stats/public')` 从公开 API 获取统计数据
- **三种布局**: 支持 `horizontal`（水平排列）、`vertical`（垂直排列）、`grid`（网格布局）
- **标签控制**: 通过 `showLabels` prop 控制是否显示中文标签
- **加载状态**: 显示骨架屏动画（shimmer 效果）
- **错误状态**: 友好显示 `--` 占位符

### 文件变更

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `client/src/components/StatsCard.tsx` | 新增 | StatsCard 组件实现 |
| `client/src/components/__tests__/StatsCard.test.tsx` | 新增 | 单元测试（6 个用例） |
| `client/src/styles/base.css` | 修改 | 添加 `.skeleton` CSS 动画 |

### 组件接口

```typescript
interface StatsCardProps {
  items: ('posts' | 'users' | 'comments' | 'pages')[]
  layout: 'horizontal' | 'vertical' | 'grid'
  showLabels: boolean
}
```

## 测试结果

```
✓ src/components/__tests__/StatsCard.test.tsx (6 tests) 114ms
  ✓ 加载时显示骨架屏
  ✓ 成功加载后显示数据
  ✓ 请求失败时显示 --
  ✓ showLabels=false 时不显示标签
  ✓ grid 布局使用正确的样式
  ✓ vertical 布局使用列方向

Test Files  1 passed (1)
     Tests  6 passed (6)
  Duration  2.28s
```

## 自审发现

1. **LiquidGlass 交互**: 在骨架屏和错误状态中添加了 `interactive={false} chromatic={false}`，避免不必要的交互效果影响加载动画
2. **CSS 一致性**: 使用 `var(--lg-glass-bg)` 作为骨架屏基础色，与项目设计系统保持一致
3. **TypeScript**: 客户端和服务端均通过类型检查，无错误

## 提交记录

```
91746a5 feat: create StatsCard component with skeleton loading
```
