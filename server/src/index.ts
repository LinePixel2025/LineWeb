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
import { initStorageTunnel } from './services/storageTunnel.js'
import { syncDriveFiles } from './services/storageSync.js'

const app = express()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? true  // allow same-origin when Express serves the frontend
    : config.corsOrigin,
  credentials: true,
}))
app.use(express.json({ limit: '600mb' }))  // 提升请求体大小限制以支持大文件上传
app.use(express.urlencoded({ limit: '600mb', extended: true }))

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/posts', postRoutes)
app.use('/api/bing-wallpaper', bingRoutes)
app.use('/api/pages', pageRoutes)
app.use('/api/comments', commentRoutes)
app.use('/api/users', userRoutes)
app.use('/api/drive', driveRoutes)

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

// 启动后延迟 10 秒执行首次同步（等待节点连接）
setTimeout(() => {
  console.log(`[Sync] 首次同步 (间隔: ${config.driveSyncIntervalMs}ms)`)
  syncDriveFiles().catch(err => console.error('[Sync] 首次同步失败:', err))
}, 10000)

// 进程退出时清理定时器
process.on('SIGTERM', () => clearInterval(syncInterval))
process.on('SIGINT', () => clearInterval(syncInterval))

const port = config.port
server.listen(port, () => {
  console.log(`✦ LineWeb Server running on port ${port}`)
})
