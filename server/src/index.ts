import express from 'express'
import cors from 'cors'
import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from './config/index.js'
import authRoutes from './routes/auth.js'
import postRoutes from './routes/posts.js'
import bingRoutes from './routes/bing.js'
import pageRoutes from './routes/pages.js'
import commentRoutes from './routes/comments.js'
import userRoutes from './routes/users.js'
import driveRoutes from './routes/drive.js'
import deviceRoutes from './routes/devices.js'
import statsRoutes from './routes/stats.js'
import apiKeyRoutes from './routes/apiKeys.js'
import { authenticate } from './middleware/auth.js'
import { errorHandler } from './middleware/errorHandler.js'
import { initStorageTunnel } from './services/storageTunnel.js'
import { syncDriveFiles } from './services/storageSync.js'
import { deduplicateDriveFiles } from './services/dedupDriveFiles.js'
import { recordRequest, startTracking } from './services/deviceTracker.js'

const app = express()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? true  // allow same-origin when Express serves the frontend
    : config.corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}))
app.set('trust proxy', 1)  // 信任反向代理（Railway），用于 rate-limiter 正确获取客户端 IP
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ limit: '10mb', extended: true }))

// 设备追踪中间件 — 记录所有 API 请求来源
app.use('/api', (req, _res, next) => {
  recordRequest(req)
  next()
})

// 全局认证中间件 — 除公开路径外，所有 API 请求必须携带 JWT 或 API Key
// 注意：req.path 在 /api 中间件中不含 /api 前缀（如 /auth/login 而非 /api/auth/login）
const publicApiPaths = ['/auth/login', '/auth/register', '/health', '/posts', '/pages/featured', '/pages/slug', '/bing-wallpaper']
app.use('/api', (req, res, next) => {
  if (publicApiPaths.some(p => req.path === p || req.path.startsWith(p + '/'))) {
    next()
    return
  }
  authenticate(req, res, next)
})

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/posts', postRoutes)
app.use('/api/bing-wallpaper', bingRoutes)
app.use('/api/pages', pageRoutes)
app.use('/api/comments', commentRoutes)
app.use('/api/users', userRoutes)
app.use('/api/drive', driveRoutes)
app.use('/api/devices', deviceRoutes)
app.use('/api/stats', statsRoutes)
app.use('/api/api-keys', apiKeyRoutes)

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
    bingWallpaper: {
      get: { method: 'GET', path: '/api/bing-wallpaper?mode=&date=&history=', auth: true, description: '获取 Bing 每日壁纸（需认证）' },
      proxy: { method: 'GET', path: '/api/bing-wallpaper/proxy?url=', auth: true, description: '代理壁纸图片（需认证）' },
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
      delete: { method: 'DELETE', path: '/api/users/:id', auth: 'admin', description: '删除用户' },
    },
    devices: {
      list: { method: 'GET', path: '/api/devices', auth: 'admin', description: '设备监控列表' },
    },
    stats: {
      dashboard: { method: 'GET', path: '/api/stats', auth: 'admin', description: 'Dashboard 统计汇总' },
    },
    apiKeys: {
      create: { method: 'POST', path: '/api/api-keys', auth: 'admin', description: '创建 API Key（返回完整 key 仅此一次）' },
      list: { method: 'GET', path: '/api/api-keys', auth: 'admin', description: '列出所有 API Key' },
      detail: { method: 'GET', path: '/api/api-keys/:id', auth: 'admin', description: '获取 API Key 详情' },
      update: { method: 'PUT', path: '/api/api-keys/:id', auth: 'admin', description: '更新 API Key（名称/状态/过期）' },
      delete: { method: 'DELETE', path: '/api/api-keys/:id', auth: 'admin', description: '删除 API Key' },
    },
    system: {
      health: { method: 'GET', path: '/api/health', auth: 'public', description: '服务健康检查（唯一公开端点之一）' },
      apiIndex: { method: 'GET', path: '/api', auth: true, description: 'API 端点列表（需认证）' },
      authMethods: '支持 JWT (Authorization: Bearer <token>) 和 API Key (X-API-Key: <key>) 两种认证方式。所有端点（除 login/register/health 外）均需认证。',
    },
  })
})

// Global error handler
app.use(errorHandler)

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Production: serve built frontend + SPA fallback
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../../client/dist')
  app.use(express.static(clientDist))
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/ws')) {
      res.sendFile(path.join(clientDist, 'index.html'))
    }
  })
}

// 创建 HTTP Server（用于同时支持 Express + WebSocket）
const server = http.createServer(app)

// 初始化 WebSocket 隧道
initStorageTunnel(server)

// 网盘文件定期同步
const syncInterval = setInterval(() => {
  syncDriveFiles().catch(err => console.error('[Sync] 定时同步失败:', err))
}, config.driveSyncIntervalMs)

// 启动后延迟 10 秒执行去重 + 首次同步（等待节点连接）
setTimeout(async () => {
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

// 进程退出时清理定时器
process.on('SIGTERM', () => clearInterval(syncInterval))
process.on('SIGINT', () => clearInterval(syncInterval))

startTracking()

const port = config.port
server.listen(port, () => {
  console.log(`✦ LineWeb Server running on port ${port}`)
})
