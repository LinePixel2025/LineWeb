import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import rateLimit from 'express-rate-limit'
import { config } from './config/index.js'
import authRoutes from './routes/auth.js'
import postRoutes from './routes/posts.js'
import pageRoutes from './routes/pages.js'
import commentRoutes from './routes/comments.js'
import userRoutes from './routes/users.js'
import driveRoutes from './routes/drive.js'
import driveFavoritesRoutes from './routes/driveFavorites.js'
import deviceRoutes from './routes/devices.js'
import statsRoutes from './routes/stats.js'
import apiKeyRoutes from './routes/apiKeys.js'
import avatarRoutes from './routes/avatar.js'
import healthRoutes from './routes/health.js'
import aiRoutes from './routes/ai.js'
import { authenticate } from './middleware/auth.js'
import { errorHandler } from './middleware/errorHandler.js'
import { initStorageTunnel, isNodeConnected } from './services/storageTunnel.js'
import { syncDriveFiles } from './services/storageSync.js'
import { deduplicateDriveFiles } from './services/dedupDriveFiles.js'
import { ensureFTSTable } from './services/ftsSearch.js'
import { recordRequest, startTracking } from './services/deviceTracker.js'
import prisma from './lib/prisma.js'

const app = express()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// === 安全中间件 ===
// helmet 设置安全 HTTP 头：CSP、X-Content-Type-Options、X-Frame-Options、HSTS 等
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      upgradeInsecureRequests: null,  // 无 HTTPS 时禁用，否则浏览器强制升级 HTTP → HTTPS
      defaultSrc: ["'self'"],
      scriptSrc: process.env.NODE_ENV === 'production'
        ? ["'self'"]
        : ["'self'", "'unsafe-inline'", "'unsafe-eval'", "'blob:'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'https:', 'http:'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://fonts.googleapis.com'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,  // 避免阻塞壁纸代理跨域资源
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  strictTransportSecurity: false,  // 无 HTTPS 时禁用 HSTS，避免浏览器缓存 HTTPS 重定向
}))

// CORS — 生产环境同源（不反射任意源），开发环境允许 Vite dev server
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? false  // 同源：Express 直接 serve 前端，无需 CORS
    : config.corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Screen-Time-Token'],
}))

// 压缩响应 — compression supports gzip/deflate/brotli based on Accept-Encoding
app.use(compression({ threshold: '2kb', filter: (req, _res) => !req.path.includes('/proxy') && !req.path.includes('/download') }))

app.set('trust proxy', 1)  // 信任反向代理，用于 rate-limiter 正确获取客户端 IP

// Body 解析 — 仅对 /api 路径启用，避免静态文件请求触发不必要的 JSON/URL 解析
app.use('/api', express.json({ limit: '1mb' }))
app.use('/api', express.urlencoded({ limit: '1mb', extended: true }))

// === 全局速率限制 ===
// 所有 /api 端点每 IP 每 15 分钟最多 200 次请求
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' },
})
app.use('/api', apiLimiter)

// 设备追踪中间件 — 记录所有 API 请求来源
app.use('/api', (req, _res, next) => {
  recordRequest(req)
  next()
})

// 全局认证中间件 — 除公开路径外，所有 API 请求必须携带 JWT 或 API Key
// 注意：req.path 在 /api 中间件中不含 /api 前缀（如 /auth/login 而非 /api/auth/login）
const publicApiPaths = ['/auth/login', '/auth/register', '/auth/avatar', '/health', '/health/push', '/posts', '/pages/featured', '/pages/slug', '/stats/public', '/version', '/comments/post', '/ai/chat']
app.use('/api', (req, res, next) => {
  if (publicApiPaths.some(p => req.path === p || req.path.startsWith(p + '/'))) {
    next()
    return
  }
  // 禁止浏览器缓存认证 API 的响应（避免 304 导致显示旧数据）
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.set('Pragma', 'no-cache')
  res.set('Expires', '0')
  // 禁用 Express 自动生成的 ETag，防止浏览器条件请求命中 304
  res.set('ETag', '')
  authenticate(req, res, next)
})

// 公开端点缓存中间件 — 减少不必要的 API 请求（仅对 GET 请求）
// 注意：排除 /admin 路径，管理端接口不应被浏览器缓存
const cachePublic = (maxAge = 300) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.method === 'GET' && !req.path.startsWith('/admin')) {
    res.set('Cache-Control', `public, max-age=${maxAge}`)
  }
  next()
}

// Routes
app.use('/api/posts', cachePublic(300), postRoutes)
app.use('/api/pages', cachePublic(300), pageRoutes)
app.use('/api/comments', cachePublic(300), commentRoutes)
app.use('/api/stats', cachePublic(60), statsRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/drive', driveRoutes)
app.use('/api/drive/favorites', driveFavoritesRoutes)
app.use('/api/devices', deviceRoutes)
app.use('/api/api-keys', apiKeyRoutes)
app.use('/api/auth/avatar', avatarRoutes)
app.use('/api/health', healthRoutes)
app.use('/api/ai', aiRoutes)

// API 自描述端点 — 列出所有可用路由
app.get('/api', (_req, res) => {
  res.json({
    name: 'LineWeb API',
    version: '1.0.0',
    baseUrl: '/api',
    auth: {
      login: { method: 'POST', path: '/api/auth/login', auth: 'public', description: '用户登录（唯一公开端点之一）' },
      register: { method: 'POST', path: '/api/auth/register', auth: 'public', description: '用户注册（唯一公开端点之一）' },
      me: { method: 'GET', path: '/api/auth/me', auth: true, description: '获取当前用户信息' },
      settings: { method: 'PUT', path: '/api/auth/settings', auth: true, description: '更新用户设置' },
      avatarUpload: { method: 'POST', path: '/api/auth/avatar', auth: true, description: '上传/更新头像 (multipart/form-data)' },
      avatarGet: { method: 'GET', path: '/api/auth/avatar', auth: true, description: '获取当前用户头像' },
      avatarGetById: { method: 'GET', path: '/api/auth/avatar/:userId', auth: 'public', description: '获取指定用户头像' },
      avatarDelete: { method: 'DELETE', path: '/api/auth/avatar', auth: true, description: '删除头像' },
    },
    posts: {
      list: { method: 'GET', path: '/api/posts?page=&limit=', auth: true, description: '文章列表（需认证）' },
      detail: { method: 'GET', path: '/api/posts/:slug', auth: true, description: '按 slug 获取文章（需认证）' },
      adminAll: { method: 'GET', path: '/api/posts/admin/all?page=&limit=', auth: 'admin', description: '管理：所有文章列表' },
      adminDetail: { method: 'GET', path: '/api/posts/admin/:id', auth: 'admin', description: '管理：按 ID 获取文章' },
      create: { method: 'POST', path: '/api/posts', auth: 'admin', description: '创建文章' },
      update: { method: 'PUT', path: '/api/posts/:id', auth: 'admin', description: '更新文章' },
      delete: { method: 'DELETE', path: '/api/posts/:id', auth: 'admin', description: '删除文章' },
    },
    comments: {
      listByPost: { method: 'GET', path: '/api/comments?postId=', auth: true, description: '按文章获取评论列表（需认证）' },
      treeByPost: { method: 'GET', path: '/api/comments/post/:postId', auth: true, description: '按文章获取评论树（需认证）' },
      create: { method: 'POST', path: '/api/comments', auth: true, description: '发表评论' },
      adminPosts: { method: 'GET', path: '/api/comments/admin/posts', auth: 'admin', description: '管理：有评论的文章列表' },
      adminPostDetail: { method: 'GET', path: '/api/comments/admin/post/:postId', auth: 'admin', description: '管理：文章全部评论' },
      update: { method: 'PUT', path: '/api/comments/:id', auth: 'admin', description: '编辑评论' },
      delete: { method: 'DELETE', path: '/api/comments/:id', auth: 'admin', description: '删除评论' },
    },
    pages: {
      featured: { method: 'GET', path: '/api/pages/featured', auth: true, description: '获取所有 featured 页面（需认证）' },
      bySlug: { method: 'GET', path: '/api/pages/slug/:slug', auth: true, description: '按 slug 获取页面（需认证）' },
      list: { method: 'GET', path: '/api/pages?page=&limit=', auth: 'admin', description: '管理：页面列表（分页）' },
      create: { method: 'POST', path: '/api/pages', auth: 'admin', description: '创建页面' },
      detail: { method: 'GET', path: '/api/pages/:id', auth: 'admin', description: '管理：按 ID 获取页面' },
      update: { method: 'PUT', path: '/api/pages/:id', auth: 'admin', description: '更新页面' },
      delete: { method: 'DELETE', path: '/api/pages/:id', auth: 'admin', description: '删除页面' },
    },
    drive: {
      list: { method: 'GET', path: '/api/drive/files?parentId=&page=&limit=', auth: 'drive', description: '文件列表（分页，文件夹优先）' },
      detail: { method: 'GET', path: '/api/drive/files/:id', auth: 'drive', description: '文件/文件夹详情' },
      search: { method: 'GET', path: '/api/drive/search?q=', auth: 'drive', description: '搜索文件（最多 50 条）' },
      createFolder: { method: 'POST', path: '/api/drive/folders', auth: 'drive', description: '创建文件夹' },
      createFolderCompat: { method: 'POST', path: '/api/drive/files', auth: 'drive', description: '创建文件夹（兼容路径）' },
      upload: { method: 'POST', path: '/api/drive/upload', auth: 'drive', description: '上传文件（multipart/form-data）' },
      download: { method: 'GET', path: '/api/drive/download/:id', auth: 'drive', description: '下载文件（流式）' },
      downloadAlt: { method: 'GET', path: '/api/drive/files/:id/download', auth: 'drive', description: '下载文件（兼容路径）' },
      rename: { method: 'PUT', path: '/api/drive/files/:id', auth: 'drive', description: '重命名/移动文件' },
      delete: { method: 'DELETE', path: '/api/drive/files/:id', auth: 'drive', description: '删除文件/文件夹（递归）' },
      sync: { method: 'POST', path: '/api/drive/sync', auth: 'drive', description: '手动触发文件同步' },
    },
    users: {
      list: { method: 'GET', path: '/api/users?page=&limit=', auth: 'admin', description: '用户列表（分页）' },
      detail: { method: 'GET', path: '/api/users/:id', auth: 'admin', description: '用户详情' },
      update: { method: 'PUT', path: '/api/users/:id', auth: 'admin', description: '更新用户（角色/密码）' },
      driveAccess: { method: 'PUT', path: '/api/users/:id/drive-access', auth: 'admin', description: '切换网盘访问权限' },
      avatarSet: { method: 'PUT', path: '/api/users/:id/avatar', auth: 'admin', description: '管理员设置用户头像 (multipart/form-data)' },
      delete: { method: 'DELETE', path: '/api/users/:id', auth: 'admin', description: '删除用户' },
    },
    devices: {
      list: { method: 'GET', path: '/api/devices', auth: 'admin', description: '设备监控列表' },
    },
    stats: {
      dashboard: { method: 'GET', path: '/api/stats', auth: 'admin', description: 'Dashboard 统计汇总' },
      public: { method: 'GET', path: '/api/stats/public', auth: 'public', description: '公开统计数据（文章/用户/评论/页面数量）' },
    },
    apiKeys: {
      create: { method: 'POST', path: '/api/api-keys', auth: 'admin', description: '创建 API Key（返回完整 key 仅此一次）' },
      list: { method: 'GET', path: '/api/api-keys', auth: 'admin', description: '列出所有 API Key' },
      detail: { method: 'GET', path: '/api/api-keys/:id', auth: 'admin', description: '获取 API Key 详情' },
      update: { method: 'PUT', path: '/api/api-keys/:id', auth: 'admin', description: '更新 API Key（名称/状态/过期）' },
      delete: { method: 'DELETE', path: '/api/api-keys/:id', auth: 'admin', description: '删除 API Key' },
    },
    health: {
      screenTime: { method: 'GET', path: '/api/health/screen-time', auth: true, description: '获取今日屏幕时间' },
      screenTimeRange: { method: 'GET', path: '/api/health/screen-time/range?from=&to=', auth: true, description: '获取日期范围内的屏幕时间历史' },
      push: { method: 'POST', path: '/api/health/push', auth: 'X-Screen-Time-Token', description: '推送屏幕时间' },
      createToken: { method: 'POST', path: '/api/health/tokens', auth: true, description: '生成屏幕时间 Token' },
      listTokens: { method: 'GET', path: '/api/health/tokens', auth: true, description: '列出屏幕时间 Token' },
      deleteToken: { method: 'DELETE', path: '/api/health/tokens/:id', auth: true, description: '删除屏幕时间 Token' },
    },
    system: {
      health: { method: 'GET', path: '/api/health', auth: 'public', description: '服务健康检查（唯一公开端点之一）' },
      apiIndex: { method: 'GET', path: '/api', auth: true, description: 'API 端点列表（需认证）' },
      authMethods: '支持 JWT (Authorization: Bearer <token>) 和 API Key (X-API-Key: <key>) 两种认证方式。所有端点（除 login/register/health 外）均需认证。',
    },
  })
})

// 部署版本信息 — 用于 CI/CD 验证部署是否成功
app.get('/api/version', (_req, res) => {
  res.json({
    version: process.env.GIT_SHA || 'unknown',
    nodeVersion: process.version,
    nodeEnv: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  })
})

// 健康检查 — 异步检查 DB 连通性 + 存储节点状态（必须在 errorHandler 之前注册）
app.get('/api/health', async (_req, res) => {
  const timestamp = new Date().toISOString()
  try {
    // 检查 DB 连通性
    await prisma.$queryRaw`SELECT 1`
    res.json({
      status: 'ok',
      db: 'connected',
      storageNode: isNodeConnected() ? 'connected' : 'disconnected',
      timestamp,
    })
  } catch (err) {
    res.status(503).json({
      status: 'degraded',
      db: 'disconnected',
      storageNode: isNodeConnected() ? 'connected' : 'disconnected',
      error: err instanceof Error ? err.message : 'Unknown DB error',
      timestamp,
    })
  }
})

// 生产环境：serve 构建后的前端 + SPA fallback（必须在 errorHandler 之前）
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../../client/dist')
  // 静态资源缓存 1 年（带 immutable），HTML 不缓存
  app.use(express.static(clientDist, {
    maxAge: '1y',
    etag: true,
    immutable: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
      }
    },
  }))
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/ws')) {
      res.sendFile(path.join(clientDist, 'index.html'))
    }
  })
}

// Global error handler — 必须是最后一个 app.use
app.use(errorHandler)

// 创建 HTTP Server（用于同时支持 Express + WebSocket）
const server = http.createServer(app)

// 初始化 WebSocket 隧道
initStorageTunnel(server)

// 网盘文件定期同步
const syncInterval = setInterval(() => {
  syncDriveFiles().catch(err => console.error('[Sync] 定时同步失败:', err))
}, config.driveSyncIntervalMs)
syncInterval.unref()  // 不阻止进程退出

// 启动时初始化 FTS5 表（非阻塞）
ensureFTSTable().catch(err => {
  console.warn('[FTS] Initialization skipped:', err.message)
})

// 启动后延迟 10 秒执行去重 + 首次同步（等待节点连接）
const startupTimer = setTimeout(async () => {
  try {
    const removed = await deduplicateDriveFiles()
    if (removed > 0) {
      console.log(`[Dedup] 已清理 ${removed} 条重复的 DriveFile 记录`)
    }
  } catch (err) {
    console.error('[Dedup] 去重失败:', err)
  }
  console.log(`[Sync] 首次同步 (间隔: ${config.driveSyncIntervalMs}ms)`)
  syncDriveFiles().catch(err => console.error('[Sync] 首次同步失败:', err))
}, 10000)
startupTimer.unref()

// === 进程级错误处理 ===
process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason)
})

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err)
  // 不立即退出，记录后让现有请求完成；下次出错再退出
  // 生产环境由 Docker restart: unless-stopped 自动重启
})

// === 优雅停机 ===
let isShuttingDown = false
const shutdown = (signal: string) => {
  if (isShuttingDown) return
  isShuttingDown = true
  console.log(`\n[${signal}] 正在关闭服务器...`)

  clearInterval(syncInterval)
  clearTimeout(startupTimer)

  server.close((err) => {
    if (err) {
      console.error('[Shutdown] HTTP server 关闭失败:', err)
      process.exit(1)
    }
    console.log('[Shutdown] HTTP server 已关闭')

    prisma.$disconnect()
      .then(() => {
        console.log('[Shutdown] Prisma 已断开')
        process.exit(0)
      })
      .catch((e) => {
        console.error('[Shutdown] Prisma 断开失败:', e)
        process.exit(1)
      })
  })

  // 10 秒后强制退出
  setTimeout(() => {
    console.error('[Shutdown] 强制退出（超时）')
    process.exit(1)
  }, 10000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

startTracking()

const port = config.port
server.listen(port, () => {
  console.log(`✦ LineWeb Server running on port ${port}`)
})
