# Task 4: 前端 - 在首页添加统计组件

## 任务概述
在首页添加统计组件，展示网站概览数据。

## 文件
- Modify: `client/src/pages/HomePage.tsx:76-123`

## 接口
- Consumes: `StatsCard` 组件

## 实现步骤

### Step 1: 在首页导入StatsCard组件

在 `client/src/pages/HomePage.tsx` 顶部添加导入：

```typescript
import StatsCard from '../components/StatsCard'
```

### Step 2: 在最新文章部分之前添加统计组件

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

### Step 3: 测试首页统计组件

1. 启动开发服务器：`npm run dev`
2. 访问首页：`http://localhost:5173`
3. 验证统计组件显示正确
4. 测试不同布局方式（修改layout prop）

### Step 4: 提交更改

```bash
git add client/src/pages/HomePage.tsx
git commit -m "feat: add stats component to homepage"
```

## 全局约束
- 使用现有的LiquidGlass组件保持设计一致性
- 公开API无需认证，只返回总数不返回详细信息
- 数据缓存5分钟避免频繁请求
- 组件支持三种布局方式：horizontal、vertical、grid
- 错误时显示友好提示，加载时显示骨架屏