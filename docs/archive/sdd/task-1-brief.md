# Task 1: 后端 - 添加公开统计API端点

## 任务概述
在stats.ts中添加公开统计API端点，无需认证即可访问。

## 文件
- Modify: `server/src/routes/stats.ts:52-70`

## 接口
- Produces: `GET /api/stats/public` 端点，返回 `{ posts: number, users: number, comments: number, pages: number }`

## 实现步骤

### Step 1: 更新缓存类型以支持key字段

修改缓存类型定义：

```typescript
let statsCache: { key: string; data: unknown; expireAt: number } | null = null
```

### Step 2: 在stats.ts中添加公开端点

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

### Step 3: 测试公开API端点

启动服务器后，使用curl测试：

```bash
curl http://localhost:3001/api/stats/public
```

预期响应：
```json
{"posts":42,"users":128,"comments":256,"pages":12}
```

### Step 4: 提交更改

```bash
git add server/src/routes/stats.ts
git commit -m "feat: add public stats API endpoint"
```

## 全局约束
- 使用现有的LiquidGlass组件保持设计一致性
- 公开API无需认证，只返回总数不返回详细信息
- 数据缓存5分钟避免频繁请求
- 组件支持三种布局方式：horizontal、vertical、grid
- 错误时显示友好提示，加载时显示骨架屏