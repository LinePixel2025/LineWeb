# 首页统计组件设计文档

## 概述

在首页添加统计组件，展示网站概览数据（文章数、用户数、评论数、页面数）。统计组件作为页面编辑器中的新组件类型，可拖拽到任何页面。数据通过公开API获取，无需登录即可查看。

## 架构设计

### 数据流

1. **后端**：新增公开API端点 `/api/stats/public`，返回网站统计数据
2. **前端**：在PageEditor中添加新的 `stats` 组件类型
3. **组件渲染**：组件从公开API获取数据并显示为数字卡片
4. **缓存**：API数据缓存5分钟，避免频繁请求

### 组件结构

```
PageEditor
├── PALETTE_ITEMS (新增 'stats' 类型)
├── PreviewComponent (渲染统计组件)
└── PropsEditor (配置统计组件属性)
```

## 详细设计

### 1. 后端API设计

#### 新增端点：`/api/stats/public`

**请求**：`GET /api/stats/public`

**响应**：
```json
{
  "posts": 42,
  "users": 128,
  "comments": 256,
  "pages": 12
}
```

**实现要点**：
- 无需认证，公开访问
- 复用现有 `computeStats()` 函数的部分逻辑
- 5分钟内存缓存
- 只返回总数，不返回详细信息

### 2. 前端组件设计

#### 新增组件类型：`stats`

**Props**：
```typescript
interface StatsComponentProps {
  items: ('posts' | 'users' | 'comments' | 'pages')[]  // 显示哪些统计项
  layout: 'horizontal' | 'vertical' | 'grid'  // 布局方式
  showLabels: boolean  // 是否显示标签
}
```

**默认值**：
```typescript
{
  items: ['posts', 'users', 'comments', 'pages'],
  layout: 'horizontal',
  showLabels: true
}
```

#### 组件渲染

**数字卡片样式**：
- 使用LiquidGlass组件保持设计一致性
- 数字显示为大字体，标签显示为小字体
- 支持加载状态（骨架屏）
- 错误时显示 `--`

**布局方式**：
- `horizontal`：水平排列，适合窄区域
- `vertical`：垂直排列，适合侧边栏
- `grid`：网格排列，适合宽区域

### 3. 页面编辑器集成

#### PALETTE_ITEMS新增项

```typescript
{
  type: 'stats',
  label: '统计',
  icon: '📊',
  defaultProps: {
    items: ['posts', 'users', 'comments', 'pages'],
    layout: 'horizontal',
    showLabels: true
  }
}
```

#### PropsEditor配置界面

为 `stats` 类型添加配置界面：
- 多选框选择显示哪些统计项
- 下拉框选择布局方式
- 开关控制是否显示标签

### 4. 首页默认添加

在HomePage.tsx中，最新文章预览部分之前添加统计组件。使用现有的页面组件系统，通过页面管理创建包含统计组件的首页内容。

## 实现步骤

### 后端实现

1. 在 `server/src/routes/stats.ts` 中添加公开端点
2. 实现数据缓存逻辑
3. 测试API响应

### 前端实现

1. 在 `PageEditor.tsx` 的 PALETTE_ITEMS 中添加 `stats` 类型
2. 在 PreviewComponent 中添加 `stats` 的渲染逻辑
3. 在 PropsEditor 中添加 `stats` 的配置界面
4. 创建统计数字卡片组件
5. 实现API调用和数据缓存

### 测试

1. 手动测试页面编辑器中的统计组件拖拽和配置
2. 测试公开API端点返回正确数据
3. 测试错误处理场景
4. 测试不同布局方式

## 验收标准

1. ✅ 统计组件可在页面编辑器中拖拽添加
2. ✅ 组件显示文章数、用户数、评论数、页面数
3. ✅ 数据通过公开API获取，无需登录
4. ✅ 支持配置显示哪些统计项
5. ✅ 支持三种布局方式
6. ✅ 错误时显示友好提示
7. ✅ 加载时显示骨架屏

## 风险与缓解

### 风险1：公开API可能暴露敏感信息
**缓解**：只返回总数，不返回详细信息；不暴露用户个人信息

### 风险2：频繁请求影响性能
**缓解**：5分钟缓存；前端也实现本地缓存

### 风险3：组件样式与现有设计不一致
**缓解**：使用LiquidGlass组件，保持设计语言一致

## 未来扩展

1. 支持自定义统计项（管理员添加的数字）
2. 支持更多图表样式（柱状图、饼图）
3. 支持动画数字滚动效果
4. 支持按时间范围筛选统计