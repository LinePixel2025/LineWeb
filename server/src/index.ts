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
import avatarRoutes from './routes/avatar.js'
import healthRoutes from './routes/health.js'
import aiRoutes from './routes/ai.js'
import oauthRoutes from './routes/oauth.js'
import chatRoutes from './routes/chat.js'
import gameRoutes from './routes/games.js'
import { authenticate } from './middleware/auth.js'
import { errorHandler } from './middleware/errorHandler.js'
import { initStorageTunnel, isNodeConnected } from './services/storageTunnel.js'
import { initChatHub } from './services/chatHub.js'
import { startGameSweeper } from './services/gameService.js'
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
      // connectSrc 需允许 ws/wss：聊天实时推送走 /ws/chat
      connectSrc: ["'self'", 'https:', 'http:', 'ws:', 'wss:'],
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
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

// 压缩响应 — compression supports gzip/deflate/brotli based on Accept-Encoding
// 跳过 /proxy、/download（流式）、/ai/write/draft（SSE 不能被压缩缓冲）
// 以及聊天图片（/chat/messages/:id/image）：WebP 本身已压缩，再 gzip 只会浪费 CPU，
// 并让响应变成 chunked（丢失 Content-Length，浏览器无法显示下载进度）。
app.use(compression({
  threshold: '2kb',
  // 注意：filter 在响应头阶段执行，此时 Express 挂载路由会把 req.path 剥成路由内相对路径
  // （如 /messages/17/image），因此这里用 req.originalUrl（保留完整路径与查询串）。
  filter: (req, _res) =>
    !req.originalUrl.includes('/proxy')
    && !req.originalUrl.includes('/download')
    && !req.originalUrl.includes('/ai/write/draft')
    && !/\/chat\/messages\/\d+\/image(\?|$)/.test(req.originalUrl),
}))

app.set('trust proxy', 1)  // 信任反向代理，用于 rate-limiter 正确获取客户端 IP

// Body 解析 — 仅对 /api 路径启用，避免静态文件请求触发不必要的 JSON/URL 解析
app.use('/api', express.json({ limit: '1mb' }))
app.use('/api', express.urlencoded({ limit: '1mb', extended: true }))

// === 全局速率限制 ===
// 所有 /api 端点每 IP 每 15 分钟最多 600 次请求。
// 例外：游戏的高频端点（移动 / 轮询 sync / presence 心跳）由 routes/games.ts 内
// 按用户的精确限流接管，这里必须按精确路径跳过，否则正常对局/轮询会被全局 IP 限流卡住。
// 注意：apiLimiter 挂在 /api 上，req.path 不含 /api 前缀（如 /games/2048/sync）。
const apiLimiterSkipPaths = [
  /^\/games\/2048\/matches\/\d+\/moves\/?$/,
  /^\/games\/2048\/sync\/?$/,
  /^\/games\/2048\/presence\/?$/,
  /^\/games\/doudizhu\/matches\/\d+\/actions\/?$/,
  /^\/games\/doudizhu\/sync\/?$/,
  /^\/games\/doudizhu\/presence\/?$/,
  /^\/games\/snake\/matches\/\d+\/actions\/?$/,
  /^\/games\/snake\/sync\/?$/,
  /^\/games\/snake\/presence\/?$/,
  /^\/games\/minesweeper\/matches\/\d+\/actions\/?$/,
  /^\/games\/minesweeper\/sync\/?$/,
  /^\/games\/minesweeper\/presence\/?$/,
  /^\/games\/jump\/matches\/\d+\/actions\/?$/,
  /^\/games\/jump\/sync\/?$/,
  /^\/games\/jump\/presence\/?$/,
  /^\/games\/minecraft\/matches\/\d+\/actions\/?$/,
  /^\/games\/minecraft\/sync\/?$/,
  /^\/games\/minecraft\/presence\/?$/,
  /^\/games\/gomoku\/matches\/\d+\/actions\/?$/,
  /^\/games\/gomoku\/sync\/?$/,
  /^\/games\/gomoku\/presence\/?$/,
]
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => apiLimiterSkipPaths.some((pattern) => pattern.test(req.path)),
  message: { error: '请求过于频繁，请稍后再试' },
})
app.use('/api', apiLimiter)

// 设备追踪中间件 — 记录所有 API 请求来源
app.use('/api', (req, _res, next) => {
  recordRequest(req)
  next()
})

// 全局认证中间件 — 除公开路径外，所有 API 请求必须携带账号登录令牌
// 注意：req.path 在 /api 中间件中不含 /api 前缀（如 /auth/login 而非 /api/auth/login）
// 共 13 条；OAuth 的 token / revoke 端点是应用侧匿名调用入口（授权页等其他端点仍需登录令牌）
const publicApiPaths = ['/auth/login', '/auth/register', '/auth/avatar', '/health', '/posts', '/pages/featured', '/pages/slug', '/stats/public', '/version', '/comments/post', '/ai/chat', '/oauth/token', '/oauth/revoke']
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
app.use('/api/auth/avatar', avatarRoutes)
app.use('/api/health', healthRoutes)
app.use('/api/ai', aiRoutes)
app.use('/api/oauth', oauthRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/games', gameRoutes)

// API 自描述端点 — 列出所有可用路由
app.get('/api', (_req, res) => {
  res.json({
    name: 'LineWeb API',
    version: '1.0.0',
    baseUrl: '/api',
    auth: {
      login: { method: 'POST', path: '/api/auth/login', auth: 'public', description: '账号登录，返回访问令牌（可选 rememberDays 申请最多 90 天有效期）' },
      register: { method: 'POST', path: '/api/auth/register', auth: 'public', description: '用户注册（默认 author 角色，可发布文章）' },
      me: { method: 'GET', path: '/api/auth/me', auth: true, description: '获取当前用户信息（含角色与 capabilities 能力清单）' },
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
    apiKeys: '已废弃 —— LineWeb 只使用账号登录令牌访问全部端点，不再提供 API Key。',

    health: {
      screenTime: { method: 'GET', path: '/api/health/screen-time', auth: true, description: '获取今日屏幕时间' },
      screenTimeRange: { method: 'GET', path: '/api/health/screen-time/range?from=&to=', auth: true, description: '获取日期范围内的屏幕时间历史' },
      push: { method: 'POST', path: '/api/health/push', auth: true, description: '推送屏幕时间（设备登录后的同一令牌）' },
      dailyGoal: { method: 'GET', path: '/api/health/daily-goal', auth: true, description: '获取今日使用目标' },
      setDailyGoal: { method: 'PUT', path: '/api/health/daily-goal', auth: true, description: '设置今日使用目标' },
    },
    system: {
      health: { method: 'GET', path: '/api/health', auth: 'public', description: '服务健康检查（公开端点之一）' },
      apiIndex: { method: 'GET', path: '/api', auth: true, description: 'API 端点列表（需认证）' },
      authMethods: '账号登录令牌：POST /api/auth/login → Authorization: Bearer <token>。权限由账号角色的 capabilities 决定（admin 自动拥有全部能力；普通账号可访问全部非管理端点，网盘受 canAccessDrive 开关约束）。第三方应用请改用 OAuth 2.0 授权码 + PKCE 流程（见 docs/app-auth-api.md），不要保存用户密码；应用令牌只能访问白名单端点。',
    },
    oauth: {
      token: { method: 'POST', path: '/api/oauth/token', auth: 'public', description: '授权码换令牌 / 刷新令牌轮换（支持 PKCE，JSON 或表单编码）' },
      revoke: { method: 'POST', path: '/api/oauth/revoke', auth: 'public', description: '撤销刷新令牌' },
      authorizeContext: { method: 'GET', path: '/api/oauth/authorize-context?client_id=&redirect_uri=&scope=&state=', auth: true, description: '授权页读取应用信息与权限清单（校验回调地址与账号能力）' },
      authorize: { method: 'POST', path: '/api/oauth/authorize', auth: true, description: '用户同意或拒绝授权，返回跳转地址（授权码由服务端签发）' },
      grantsList: { method: 'GET', path: '/api/oauth/grants', auth: true, description: '当前用户已授权的应用列表' },
      grantsRevoke: { method: 'DELETE', path: '/api/oauth/grants/:id', auth: true, description: '撤销某应用的授权（令牌立即失效）' },
      clientsList: { method: 'GET', path: '/api/oauth/clients', auth: 'app:manage', description: '管理：第三方应用列表' },
      clientsCreate: { method: 'POST', path: '/api/oauth/clients', auth: 'app:manage', description: '管理：注册应用（密钥仅返回一次）' },
      clientsUpdate: { method: 'PUT', path: '/api/oauth/clients/:id', auth: 'app:manage', description: '管理：更新 / 停用应用' },
      clientsResetSecret: { method: 'POST', path: '/api/oauth/clients/:id/secret', auth: 'app:manage', description: '管理：重置应用密钥（仅返回一次）' },
      clientsDelete: { method: 'DELETE', path: '/api/oauth/clients/:id', auth: 'app:manage', description: '管理：删除应用（授权一并撤销）' },
      flow: '授权码 + PKCE：应用跳转 /authorize?client_id&redirect_uri&scope&state&code_challenge → 用户登录并同意 → 回调带回一次性 code → 应用用 code + code_verifier 调用 /api/oauth/token 换取 access_token（1 小时）与 refresh_token（30 天，每次刷新轮换）。应用令牌是作用域令牌（role=app），只能访问白名单端点，无法获得任何管理能力。',
    },
    chat: {
      summary: { method: 'GET', path: '/api/chat/summary', auth: true, description: '未读消息总数与待处理好友申请数' },
      friends: { method: 'GET', path: '/api/chat/friends', auth: true, description: '好友列表（DELETE /api/chat/friends/:userId 删除好友）' },
      friendRequests: { method: 'GET', path: '/api/chat/friend-requests', auth: true, description: '收到/发出的好友申请；POST /api/chat/friend-requests 发送，POST /api/chat/friend-requests/:id/accept|reject 处理' },
      conversations: { method: 'GET', path: '/api/chat/conversations', auth: true, description: '我的会话列表（含最后一条消息与未读数）；POST /api/chat/conversations/direct 发起私聊，POST /api/chat/conversations/group 创建群聊（≤50 人，仅可邀请好友）' },
      messages: { method: 'GET', path: '/api/chat/conversations/:id/messages?before=&limit=', auth: true, description: '历史消息（游标分页，id 正序）；POST /api/chat/conversations/:id/messages 发送纯文本消息；POST /api/chat/conversations/:id/images 发送图片（multipart/form-data，字段名 file）；GET /api/chat/messages/:id/image 读取图片（支持 ?token= 直链）；POST /api/chat/messages/:id/recall 撤回自己发送的消息（2 分钟内）；PUT /api/chat/conversations/:id/read 更新已读位置' },
      ws: '实时推送：ws(s)://<host>/ws/chat，连接后 5 秒内发送 {"type":"auth","token":"<登录令牌>"}，服务端回 {"type":"auth_ok","userId":N}；推送 message:new / message:recalled / conversation:updated / conversation:removed / friend:request / friend:accepted / friend:rejected / friend:removed，客户端 {type:"ping"} ↔ 服务端 {type:"pong"}。认证失败以 close code 4001 断开。',
    },
    games: {
      friends: { method: 'GET', path: '/api/games/2048/friends', auth: true, description: '好友对战大厅：好友列表（含 online / inMatch）' },
      invites: { method: 'GET', path: '/api/games/2048/invites', auth: true, description: '收到/发出的待处理邀请（60 秒有效）' },
      inviteCreate: { method: 'POST', path: '/api/games/2048/invites', auth: true, description: '邀请好友加入等待房间（body: {friendId}；没有房间会自动创建；同一房间可邀请多人，最多 10 人；返回 invite + match）' },
      inviteRespond: { method: 'POST', path: '/api/games/2048/invites/:id/respond', auth: true, description: '接受/拒绝邀请（body: {action:"accept"|"decline"}；接受成功返回 match）' },
      inviteCancel: { method: 'DELETE', path: '/api/games/2048/invites/:id', auth: true, description: '取消自己发出的邀请' },
      sync: { method: 'GET', path: '/api/games/2048/sync?matchId=', auth: true, description: '轮询降级：返回 serverTime + 邀请列表 + 当前/指定对局（对局结束 5 分钟内仍可取结果）' },
      presence: { method: 'POST', path: '/api/games/2048/presence', auth: true, description: '轮询降级心跳（建议 20 秒一次，服务端 TTL 90 秒；在线判定 = 聊天 WS 在线 || presence 有效）' },
      activeMatch: { method: 'GET', path: '/api/games/2048/matches/active', auth: true, description: '当前等待房间或进行中对局（无则 match: null）' },
      matchDetail: { method: 'GET', path: '/api/games/2048/matches/:id', auth: true, description: '房间/对局详情（非参与者 404）' },
      start: { method: 'POST', path: '/api/games/2048/matches/:id/start', auth: true, description: '房主开始游戏（2–10 人；body: {durationMinutes?:1-60}，默认 10 分钟；同一 seed 发牌，status: waiting → playing）' },
      leave: { method: 'POST', path: '/api/games/2048/matches/:id/leave', auth: true, description: '离开等待房间；房主离开即解散房间（status: finished, reason: cancelled）' },
      move: { method: 'POST', path: '/api/games/2048/matches/:id/moves', auth: true, description: '服务端权威移动（body: {direction:"up"|"down"|"left"|"right"}；无效移动返回 moved:false 且不广播）；限流 900/5min/用户' },
      resign: { method: 'POST', path: '/api/games/2048/matches/:id/resign', auth: true, description: '认输：该玩家淘汰，其余玩家继续（最后存活者/分数最高者获胜）' },
      rules: '服务端权威：邀请加入等待房间（2–10 人），房主开始后可选择 1–60 分钟竞速时长（默认 10 分钟），所有玩家同一 seed 得到相同初始棋盘，先合成 2048 者获胜；无路可走/认输/掉线会淘汰该玩家，其余玩家继续；最后存活者获胜，全部出局按分数判定；超时在存活玩家中按分数判定（平分平局）；邀请 60 秒有效、等待房间 30 分钟过期、对局结束保留 5 分钟；对局/房间/邀请均为内存态，无数据库表。',
      ws: '实时推送（复用 /ws/chat，不新增 WS 服务）：game:invite {invite}、game:invite:removed {inviteId, reason}、game:match:started/update/ended {match}。无 WebSocket 时客户端用 POST /presence（20 秒心跳）+ GET /sync（2–5 秒轮询）降级。',
    },
    doudizhu: {
      friends: { method: 'GET', path: '/api/games/doudizhu/friends', auth: true, description: '斗地主好友大厅：好友列表（含 online / inMatch，inMatch 覆盖全部游戏）' },
      invites: { method: 'GET', path: '/api/games/doudizhu/invites', auth: true, description: '收到/发出的斗地主邀请（60 秒有效；invite 带 game:"doudizhu"）' },
      inviteCreate: { method: 'POST', path: '/api/games/doudizhu/invites', auth: true, description: '邀请好友加入 3 人等待房间（body: {friendId}；没有房间会自动创建；返回 invite + match）' },
      inviteRespond: { method: 'POST', path: '/api/games/doudizhu/invites/:id/respond', auth: true, description: '接受/拒绝邀请（body: {action:"accept"|"decline"}；接受成功返回 match）' },
      inviteCancel: { method: 'DELETE', path: '/api/games/doudizhu/invites/:id', auth: true, description: '取消自己发出的邀请' },
      sync: { method: 'GET', path: '/api/games/doudizhu/sync?matchId=', auth: true, description: '轮询降级：返回 serverTime + 邀请列表 + 当前/指定对局（按观看者裁剪，myHand 仅自己的牌）' },
      presence: { method: 'POST', path: '/api/games/doudizhu/presence', auth: true, description: '轮询降级心跳（与 2048 共用 presence TTL 存储）' },
      activeMatch: { method: 'GET', path: '/api/games/doudizhu/matches/active', auth: true, description: '当前等待房间 / 叫分 / 出牌中的对局（无则 match: null）' },
      matchDetail: { method: 'GET', path: '/api/games/doudizhu/matches/:id', auth: true, description: '房间/对局详情（非参与者 404；每个玩家只看到自己的手牌）' },
      start: { method: 'POST', path: '/api/games/doudizhu/matches/:id/start', auth: true, description: '房主开始游戏（需恰好 3 人；发牌进入叫分，status: waiting → bidding）' },
      leave: { method: 'POST', path: '/api/games/doudizhu/matches/:id/leave', auth: true, description: '离开等待房间；房主离开即解散房间（已开局请用 resign）' },
      action: { method: 'POST', path: '/api/games/doudizhu/matches/:id/actions', auth: true, description: '统一动作入口（body: {type:"bid",bid:0-3} 叫分 / {type:"play",cards:[牌id]} 出牌 / {type:"pass"} 不出）；服务端权威校验牌型与压牌；限流 900/5min/用户' },
      resign: { method: 'POST', path: '/api/games/doudizhu/matches/:id/resign', auth: true, description: '认输：本方阵营按当前倍率判负（叫分阶段认输直接解散）' },
      rules: '斗地主（3 人）：邀请凑齐 3 人后房主开局 → 叫分（0–3 分，3 分立即成交，连续 3 轮无人叫分流局解散）→ 地主拿 3 张底牌先行出牌 → 先出完者所在阵营获胜。计分 = 底分 100 × 倍率（炸弹/王炸/春天/反春各 ×2），地主赢 +2 份、输 -2 份。回合限时 90 秒，超时或离线 30 秒自动托管（应叫=不叫、领出=最小单张、跟牌=不出）；全员离线 10 分钟废弃对局。与 2048 跨游戏互斥：同时在任意游戏中即不能被邀请。对局/邀请均为内存态，无数据库表。',
      ws: '实时推送复用 /ws/chat 的事件名：game:invite / game:invite:removed / game:match:started|update|ended（match.game === "doudizhu"，每个玩家收到自己视角的 DTO）。无 WebSocket 时用 POST /presence + GET /sync 轮询降级。',
    },
    snake: {
      friends: { method: 'GET', path: '/api/games/snake/friends', auth: true, description: '贪吃蛇大地图好友大厅：好友列表（online / inMatch 覆盖全部游戏）' },
      invites: { method: 'GET', path: '/api/games/snake/invites', auth: true, description: '收到/发出的贪吃蛇邀请（60 秒有效；invite 带 game:"snake"）' },
      inviteCreate: { method: 'POST', path: '/api/games/snake/invites', auth: true, description: '邀请好友加入大地图等待房间（body: {friendId}；2–8 人；返回 invite + match）' },
      inviteRespond: { method: 'POST', path: '/api/games/snake/invites/:id/respond', auth: true, description: '接受/拒绝邀请（body: {action:"accept"|"decline"}）' },
      inviteCancel: { method: 'DELETE', path: '/api/games/snake/invites/:id', auth: true, description: '取消自己发出的邀请' },
      sync: { method: 'GET', path: '/api/games/snake/sync?matchId=', auth: true, description: '轮询降级：serverTime + 邀请 + 当前/指定对局（40×40 世界全量可见）' },
      presence: { method: 'POST', path: '/api/games/snake/presence', auth: true, description: '轮询降级心跳（与 2048 共用 presence TTL 存储）' },
      activeMatch: { method: 'GET', path: '/api/games/snake/matches/active', auth: true, description: '当前等待房间或进行中对局（无则 match: null）' },
      matchDetail: { method: 'GET', path: '/api/games/snake/matches/:id', auth: true, description: '房间/对局详情（非参与者 404）' },
      start: { method: 'POST', path: '/api/games/snake/matches/:id/start', auth: true, description: '房主开始游戏（2–8 人；按 seed 生成同一世界，8 个固定出生点按座位分配，status: waiting → playing）' },
      leave: { method: 'POST', path: '/api/games/snake/matches/:id/leave', auth: true, description: '离开等待房间；房主离开即解散（reason: cancelled）' },
      action: { method: 'POST', path: '/api/games/snake/matches/:id/actions', auth: true, description: '提交下一步方向（body: {type:"turn", direction:"up"|"down"|"left"|"right"}）；180° 掉头返回 applied:false 且不广播；限流 900/5min/用户' },
      resign: { method: 'POST', path: '/api/games/snake/matches/:id/resign', auth: true, description: '认输：本蛇判死淘汰，其余继续（最后存活者获胜）' },
      rules: '贪吃蛇大地图联机：40×40 共享世界，服务端每 220ms 权威推进一步（stepMs/step/remainingMs 均在 DTO 里），客户端只提交方向并渲染。吃普通果 +10 长 1 节、金果 +30 长 3 节；撞墙、撞蛇身、双头对撞即淘汰。默认 5 分钟一局：只剩一条存活蛇即 last_standing 获胜，全灭/超时按分数判定（并列平局）。掉线 120 秒淘汰（forfeit）；回合内 180° 掉头无效。与其余游戏跨游戏互斥。对局/邀请均为内存态，无数据库表。单机与同屏双人为纯前端玩法，不走这些端点。',
      ws: '实时推送复用 /ws/chat：game:match:started/update/ended（match.game === "snake"，每步一次 update）。无 WebSocket 时客户端用 POST /presence（20 秒）+ GET /sync（2 秒）降级，画面为跳步而非补间。',
    },
    minesweeper: {
      friends: { method: 'GET', path: '/api/games/minesweeper/friends', auth: true, description: '扫雷好友大厅：好友列表（online / inMatch 覆盖全部游戏）' },
      invites: { method: 'GET', path: '/api/games/minesweeper/invites', auth: true, description: '收到/发出的扫雷邀请（60 秒有效；invite 带 game:"minesweeper"）' },
      inviteCreate: { method: 'POST', path: '/api/games/minesweeper/invites', auth: true, description: '邀请好友加入轮流扫雷等待房间（body: {friendId}；2–4 人）' },
      inviteRespond: { method: 'POST', path: '/api/games/minesweeper/invites/:id/respond', auth: true, description: '接受/拒绝邀请（body: {action:"accept"|"decline"}）' },
      inviteCancel: { method: 'DELETE', path: '/api/games/minesweeper/invites/:id', auth: true, description: '取消自己发出的邀请' },
      sync: { method: 'GET', path: '/api/games/minesweeper/sync?matchId=', auth: true, description: '轮询降级：serverTime + 邀请 + 当前/指定对局（仅已翻开格，雷位不泄露）' },
      presence: { method: 'POST', path: '/api/games/minesweeper/presence', auth: true, description: '轮询降级心跳（与 2048 共用 presence TTL 存储）' },
      activeMatch: { method: 'GET', path: '/api/games/minesweeper/matches/active', auth: true, description: '当前等待房间或轮到你操作的对局（无则 match: null）' },
      matchDetail: { method: 'GET', path: '/api/games/minesweeper/matches/:id', auth: true, description: '房间/对局详情（非参与者 404）' },
      start: { method: 'POST', path: '/api/games/minesweeper/matches/:id/start', auth: true, description: '房主开始游戏（2–4 人；按 seed 生成 12×12 / 22 雷盘面，status → playing，回合给座位 0）' },
      leave: { method: 'POST', path: '/api/games/minesweeper/matches/:id/leave', auth: true, description: '离开等待房间；房主离开即解散（reason: cancelled）' },
      action: { method: 'POST', path: '/api/games/minesweeper/matches/:id/actions', auth: true, description: '一人只许下一次（body: {type:"open",index} 翻开 / {type:"flag",index} 插拔旗）；非当前回合 409「还没轮到你」；点已翻开格返回 applied:false 不轮转；限流 900/5min/用户' },
      resign: { method: 'POST', path: '/api/games/minesweeper/matches/:id/resign', auth: true, description: '认输：自己淘汰出局，其余玩家继续' },
      rules: '扫雷好友联机（轮流点）：共享 12×12 盘面、22 颗雷，翻开数字为 0 时自动洪水展开，这些合起来仍算「一次」。每人一次动作后立刻轮到下一名存活玩家（回合 30 秒，连续 3 次超时跳过即淘汰）。踩雷者出局（booms 计数），全清或 10 分钟时长到则按安全翻开格数（opened）判定胜者，并列平局。DTO 只含已翻开格与旗子，雷位不泄露。单机三档难度为纯前端玩法，不走这些端点。',
      ws: '实时推送复用 /ws/chat：game:match:started/update/ended（match.game === "minesweeper"，所有玩家看到同一份公开盘面）。无 WebSocket 时 POST /presence + GET /sync 轮询降级。',
    },
    jump: {
      friends: { method: 'GET', path: '/api/games/jump/friends', auth: true, description: '跳一跳好友大厅：好友列表（online / inMatch 覆盖全部游戏）' },
      invites: { method: 'GET', path: '/api/games/jump/invites', auth: true, description: '收到/发出的跳一跳邀请（60 秒有效；invite 带 game:"jump"）' },
      inviteCreate: { method: 'POST', path: '/api/games/jump/invites', auth: true, description: '邀请好友加入轮流跳等待房间（body: {friendId}；2–6 人）' },
      inviteRespond: { method: 'POST', path: '/api/games/jump/invites/:id/respond', auth: true, description: '接受/拒绝邀请（body: {action:"accept"|"decline"}）' },
      inviteCancel: { method: 'DELETE', path: '/api/games/jump/invites/:id', auth: true, description: '取消自己发出的邀请' },
      sync: { method: 'GET', path: '/api/games/jump/sync?matchId=', auth: true, description: '轮询降级：serverTime + 邀请 + 当前/指定对局（含共享盒子序列）' },
      presence: { method: 'POST', path: '/api/games/jump/presence', auth: true, description: '轮询降级心跳（与 2048 共用 presence TTL 存储）' },
      activeMatch: { method: 'GET', path: '/api/games/jump/matches/active', auth: true, description: '当前等待房间或轮到你跳的对局（无则 match: null）' },
      matchDetail: { method: 'GET', path: '/api/games/jump/matches/:id', auth: true, description: '房间/对局详情（非参与者 404）' },
      start: { method: 'POST', path: '/api/games/jump/matches/:id/start', auth: true, description: '房主开始游戏（2–6 人；按 seed 生成共享盒子路线，每人各自前进，status → playing）' },
      leave: { method: 'POST', path: '/api/games/jump/matches/:id/leave', auth: true, description: '离开等待房间；房主离开即解散（reason: cancelled）' },
      action: { method: 'POST', path: '/api/games/jump/matches/:id/actions', auth: true, description: '轮流一跳（body: {type:"jump", chargeMs:1-2000}，客户端测按住时长）；服务端用同一物理引擎判定落点与得分；非当前回合 409；限流 900/5min/用户' },
      resign: { method: 'POST', path: '/api/games/jump/matches/:id/resign', auth: true, description: '认输：自己出局（分数保留），其余继续' },
      rules: '跳一跳（对齐微信小游戏逻辑）：蓄力时长线性映射跳跃距离（≤2000ms → ≤260 逻辑单位），落点相对目标盒中心的偏移 |offset| ≤ size×0.30 判定正中靶心、≤ size 判定命中。命中 +1 分，连续正中按 2/4/8/16/32 翻倍（第 5 次起封顶 32），非中心命中清空连击；落空（short/long）即淘汰。好友轮流各跳一次、走同一条盒子路线，最后存活者获胜（last_standing），6 分钟内全淘汰或超时按分数判定（并列平局）；回合 20 秒未跳则自动以极小蓄力起跳（必落空，forfeit）。盒子序列由 seed 确定性生成并按需续写。单机模式为纯前端玩法，不走这些端点。',
      ws: '实时推送复用 /ws/chat：game:match:started/update/ended（match.game === "jump"，lastResult 带 kind/gained/offset/scoreAfter/comboAfter）。无 WebSocket 时 POST /presence + GET /sync 轮询降级。',
    },
    minecraft: {
      friends: { method: 'GET', path: '/api/games/minecraft/friends', auth: true, description: '我的世界好友大厅：好友列表（online / inMatch 覆盖全部游戏）' },
      invites: { method: 'GET', path: '/api/games/minecraft/invites', auth: true, description: '收到/发出的我的世界邀请（60 秒有效；invite 带 game:"minecraft"）' },
      inviteCreate: { method: 'POST', path: '/api/games/minecraft/invites', auth: true, description: '邀请好友加入共享世界等待房间（body: {friendId}；2–8 人）' },
      inviteRespond: { method: 'POST', path: '/api/games/minecraft/invites/:id/respond', auth: true, description: '接受/拒绝邀请（body: {action:"accept"|"decline"}）' },
      inviteCancel: { method: 'DELETE', path: '/api/games/minecraft/invites/:id', auth: true, description: '取消自己发出的邀请' },
      sync: { method: 'GET', path: '/api/games/minecraft/sync?matchId=&since=', auth: true, description: '轮询降级：serverTime + 邀请 + 当前/指定世界 + 自 since 水位之后的方块修改（增量）' },
      presence: { method: 'POST', path: '/api/games/minecraft/presence', auth: true, description: '轮询降级心跳（与 2048 共用 presence TTL 存储）' },
      activeMatch: { method: 'GET', path: '/api/games/minecraft/matches/active', auth: true, description: '当前等待房间或进行中世界（无则 match: null）' },
      matchDetail: { method: 'GET', path: '/api/games/minecraft/matches/:id', auth: true, description: '房间/世界详情（含 seed 与出生点；非参与者 404）' },
      start: { method: 'POST', path: '/api/games/minecraft/matches/:id/start', auth: true, description: '房主开始世界（2–8 人；服务端生成权威 seed 与出生点，各端按 seed 本地生成同一世界）' },
      leave: { method: 'POST', path: '/api/games/minecraft/matches/:id/leave', auth: true, description: '离开房间/世界（等待与进行中都允许；房主离开进行中的世界会把房主位移交出去；最后一人离开世界关闭）' },
      action: { method: 'POST', path: '/api/games/minecraft/matches/:id/actions', auth: true, description: 'state：玩家位置快照上报（~2Hz，服务端转发其他人）；edit：一批方块修改（≤64 格/次，y=0 基岩层拒绝，追加修改日志并转发）；限流 3000/5min/用户（专用限流，位置+挖掘叠加需要更高配额）' },
      resign: { method: 'POST', path: '/api/games/minecraft/matches/:id/resign', auth: true, description: '与其他游戏端点形状一致（沙盒没有认输语义，行为与 leave 相同）' },
      rules: '我的世界好友联机（共享体素沙盒，没有胜负与回合）：世界 192×192×64，由权威 seed 在各端确定性生成（服务端只存 seed + 方块修改日志 + 玩家快照）。方块修改带增量 seq，断线用 sync?since= 补拉；单个世界最多 30000 条修改。掉线不淘汰，掉线超过 10 分钟移出世界，全员掉线 10 分钟后世界按 abandoned 关闭。单机模式为纯前端玩法（存档在浏览器 localStorage），不走这些端点。',
      ws: '实时推送复用 /ws/chat：game:match:started/update/ended（match.game === "minecraft"）之外，还有轻量事件 game:minecraft:state（单人位置快照）与 game:minecraft:edit（新增方块修改），都不携带完整对局 DTO。无 WebSocket 时 POST /presence + GET /sync?since= 轮询降级（位置 2 秒一拍，画面为跳步而非补间）。',
    },
    gomoku: {
      friends: { method: 'GET', path: '/api/games/gomoku/friends', auth: true, description: '五子棋好友大厅：好友列表（online / inMatch 覆盖全部游戏）' },
      invites: { method: 'GET', path: '/api/games/gomoku/invites', auth: true, description: '收到/发出的五子棋邀请（60 秒有效；invite 带 game:"gomoku"）' },
      inviteCreate: { method: 'POST', path: '/api/games/gomoku/invites', auth: true, description: '邀请好友加入五子棋等待房间（body: {friendId}；恰好 2 人；返回 invite + match）' },
      inviteRespond: { method: 'POST', path: '/api/games/gomoku/invites/:id/respond', auth: true, description: '接受/拒绝邀请（body: {action:"accept"|"decline"}；接受成功返回 match）' },
      inviteCancel: { method: 'DELETE', path: '/api/games/gomoku/invites/:id', auth: true, description: '取消自己发出的邀请' },
      sync: { method: 'GET', path: '/api/games/gomoku/sync?matchId=', auth: true, description: '轮询降级：serverTime + 邀请 + 当前/指定对局（棋盘全量可见，无隐藏信息）' },
      presence: { method: 'POST', path: '/api/games/gomoku/presence', auth: true, description: '轮询降级心跳（与 2048 共用 presence TTL 存储）' },
      activeMatch: { method: 'GET', path: '/api/games/gomoku/matches/active', auth: true, description: '当前等待房间或轮到你落子的对局（无则 match: null）' },
      matchDetail: { method: 'GET', path: '/api/games/gomoku/matches/:id', auth: true, description: '房间/对局详情（含棋盘、回合与最后一手；非参与者 404）' },
      start: { method: 'POST', path: '/api/games/gomoku/matches/:id/start', auth: true, description: '房主开始对局（恰好 2 人；房主 = 座位 0 执黑先行，另一位执白；15×15 空盘，回合 60 秒、全局 30 分钟）' },
      leave: { method: 'POST', path: '/api/games/gomoku/matches/:id/leave', auth: true, description: '离开等待房间；房主离开即解散（reason: cancelled；已开局请用 resign）' },
      action: { method: 'POST', path: '/api/games/gomoku/matches/:id/actions', auth: true, description: '轮流落子（body: {type:"place", x:0-14, y:0-14}）；连五及以上即胜（含长连，无禁手），下满平局；回合 60 秒超时由服务端自动托管落子（lastMove.auto=true）；非当前回合 409；限流 900/5min/用户' },
      resign: { method: 'POST', path: '/api/games/gomoku/matches/:id/resign', auth: true, description: '认输：对方获胜' },
      rules: '五子棋好友联机（2 人轮流落子）：15×15 标准棋盘、无禁手 freestyle（连成五子及以上即胜，长连同样获胜），棋盘下满且无人连五为平局。房主执黑先行；回合 60 秒，超时自动托管落子（不淘汰）；掉线超过 120 秒且对方在线判负（forfeit）；全局 30 分钟超时未分胜负按平局结算（timeout）。棋盘无隐藏信息，DTO 全量下发（board 为 225 长一维数组，下标 = y×15+x）。单机模式为纯前端人机对战（AI 与服务端托管共用同一引擎），不走这些端点。',
      ws: '实时推送复用 /ws/chat：game:match:started/update/ended（match.game === "gomoku"），无专用轻量事件（落子频率低，全量 DTO 足够）。无 WebSocket 时 POST /presence + GET /sync 轮询降级。',
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

// 初始化聊天 WebSocket Hub（/ws/chat）
initChatHub(server)

// 游戏定时器：邀请过期、超时结算、掉线判负、结束对局回收（每 15 秒，unref）
startGameSweeper()

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
