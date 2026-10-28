import { z } from 'zod'
import { USER_ROLES } from '../lib/permissions.js'
import { APP_SCOPES } from '../lib/appScopes.js'
// 世界尺寸常量来自无依赖的叶子模块（世界生成双端拷贝），不会有循环导入
import { MC_BLOCK_COUNT, MC_WORLD_HEIGHT, MC_WORLD_SIZE } from '../services/gameMinecraftWorld.js'

function parseCorsOrigins(raw: string | undefined): string | string[] | boolean {
  if (!raw) return 'http://localhost:5173'
  if (raw === '*') return true  // 允许任意源（生产环境慎用）
  const origins = raw.split(',').map(s => s.trim()).filter(Boolean)
  return origins.length === 1 ? origins[0] : origins
}

/**
 * 要求环境变量必须存在
 * 生产环境：缺失时直接抛错，防止使用不安全的默认值
 * 开发环境：允许使用 fallback 默认值
 */
function requireEnv(key: string, fallback?: string): string {
  const value = process.env[key] || fallback
  if (!value) {
    throw new Error(`环境变量 ${key} 未设置，请检查 .env 或 Railway 配置`)
  }
  return value
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  jwtSecret: requireEnv('JWT_SECRET', process.env.NODE_ENV === 'production' ? undefined : 'lineweb-dev-secret'),
  jwtExpiresIn: '7d' as const,
  downloadTicketExpiresIn: '5m' as const,
  // === 第三方应用授权（OAuth 2.0 授权码 + PKCE）时效 ===
  oauthCodeTtlMs: 5 * 60 * 1000,           // 授权码 5 分钟有效，且只能使用一次
  oauthAccessTokenTtl: '1h' as const,      // 应用访问令牌 1 小时（短期，靠刷新令牌续期）
  oauthAccessTokenTtlSeconds: 3600,
  oauthRefreshTokenTtlMs: 30 * 24 * 60 * 60 * 1000, // 刷新令牌 30 天
  oauthRefreshTokenTtlSeconds: 2592000,
  oauthAccessTokenType: 'app' as const,    // 应用令牌的 type claim，用于与下载票据区分
  corsOrigin: parseCorsOrigins(process.env.CORS_ORIGIN),
  storageNodeToken: requireEnv('STORAGE_NODE_TOKEN', process.env.NODE_ENV === 'production' ? undefined : 'lineweb-storage-node-secret'),
  maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB || '500', 10),
  uploadChunkKB: parseInt(process.env.UPLOAD_CHUNK_KB || '64', 10),
  downloadChunkKB: parseInt(process.env.DOWNLOAD_CHUNK_KB || '256', 10),
  streamChunkKB: parseInt(process.env.STREAM_CHUNK_KB || '4096', 10),
  driveSyncIntervalMs: parseInt(process.env.DRIVE_SYNC_INTERVAL_MS || '300000', 10),
  // === 网页反代并发闸门（防止同时打开多个站点时把进程打满） ===
  // 同时进行中的反代请求上限（不含管理员）；超出后进入 FIFO 队列
  proxyMaxConcurrent: Math.max(1, parseInt(process.env.PROXY_MAX_CONCURRENT || '24', 10)),
  // 排队队列长度上限；队列也满时直接 503（前端显示排队页）
  proxyQueueLimit: Math.max(0, parseInt(process.env.PROXY_QUEUE_LIMIT || '64', 10)),
  // 单个请求最长排队时间；超时 503
  proxyQueueTimeoutMs: Math.max(1000, parseInt(process.env.PROXY_QUEUE_TIMEOUT_MS || '15000', 10)),
  // 反代 WebSocket 同时连接数上限（不含管理员）
  proxyWsMaxConnections: Math.max(1, parseInt(process.env.PROXY_WS_MAX_CONNECTIONS || '100', 10)),
  // === 聊天服务（neko XMPP）===
  // 聊天已迁移到独立的 internet_neko XMPP 服务；本服务只做代理与账号映射，不存聊天数据。
  // 令牌只在服务端使用（x-internal-token），绝不能下发浏览器；缺失时聊天降级为未配置。
  nekoChatEnabled: process.env.NEKO_CHAT_ENABLED === 'true' && !!process.env.NEKO_CHAT_TOKEN,
  nekoChatInternalUrl: (process.env.NEKO_CHAT_INTERNAL_URL || 'http://8.148.238.168:8090').replace(/\/+$/, ''),
  nekoChatToken: process.env.NEKO_CHAT_TOKEN || '',
  nekoChatWsPath: process.env.NEKO_CHAT_WS_PATH || '/xmpp-websocket',
  // LineWeb 用户 id → neko 账号 id 的固定偏移（neko 账号 id 必须是整数）
  nekoChatAccountBase: parseInt(process.env.NEKO_CHAT_ACCOUNT_BASE || '1000000000000', 10),
  // LineWeb 账号在 neko 侧的用户名前缀（固定不变，改名只更新 displayName）
  nekoChatUsernamePrefix: process.env.NEKO_CHAT_USERNAME_PREFIX || 'lw_',
  // 是否允许与 neko 原生用户互通（好友关系仍只存在于 LineWeb 账号之间）
  nekoChatAllowNative: process.env.NEKO_CHAT_ALLOW_NATIVE !== 'false',
  nekoChatTimeoutMs: parseInt(process.env.NEKO_CHAT_TIMEOUT_MS || '10000', 10),
  // 消息与未读口径（与 neko 服务端一致）
  nekoChatRecallWindowMs: 5 * 60 * 1000,
  nekoChatHistoryLimit: 30,
}

export const registerSchema = z.object({
  username: z.string().min(2).max(50),
  email: z.string().email().max(100),
  password: z.string().min(6).max(100),
})

export const loginSchema = z.object({
  identifier: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  username: z.string().min(1).max(50).optional(),
  password: z.string().min(1).max(100),
  // 设备长期登录：第三方脚本/桌面应用可申请更长的令牌有效期（仍是同一个账号登录令牌）
  rememberDays: z.number().int().min(1).max(90).optional(),
}).refine((d) => d.identifier || d.email || d.username, {
  message: '请输入邮箱或用户名',
})

export const postSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  summary: z.string().max(500).optional(),
  slug: z.string().min(1).max(255),
  published: z.boolean().optional().default(false),
})

export const postUpdateSchema = postSchema.partial()

export const pageSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(255),
  schema: z.string().min(1, '页面 Schema 不能为空'),
  published: z.boolean().optional().default(false),
  featured: z.boolean().optional().default(false),
  featureEmoji: z.string().max(10).nullish(),
  featureDesc: z.string().max(200).nullish(),
})

export const pageUpdateSchema = pageSchema.partial()

export const updateSettingsSchema = z.object({
  settings: z.string().min(1, '设置不能为空'),
})

export const updateProfileSchema = z.object({
  username: z.string().min(2).max(50).optional(),
  currentPassword: z.string().min(1).max(100).optional(),
  newPassword: z.string().min(6).max(100).optional(),
}).refine((d) => d.username || d.newPassword, {
  message: '请提供要修改的用户名或新密码',
})

export const commentSchema = z.object({
  content: z.string().min(1, '评论不能为空').max(2000, '评论过长'),
  postId: z.number().int().positive(),
  parentId: z.number().int().positive().optional(),
})

export const commentUpdateSchema = z.object({
  content: z.string().min(1, '评论内容不能为空').max(2000, '评论过长'),
})

export const updateUserSchema = z.object({
  role: z.enum(USER_ROLES).optional(),
  password: z.string().min(6).max(100).optional(),
})

export const pushScreenTimeSchema = z.object({
  totalSeconds: z.number().int().min(0).max(86400),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export const setDailyGoalSchema = z.object({
  goalSeconds: z.number().int().min(0).max(86400).nullable(),
})

export const screenTimeRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).refine(({ from, to }) => to >= from, {
  message: '结束日期不能早于起始日期',
  path: ['to'],
}).refine(({ from, to }) => {
  const spanDays = Math.round((Date.parse(to) - Date.parse(from)) / 86400000)
  return spanDays <= 62
}, {
  message: '查询跨度不能超过 62 天',
  path: ['to'],
})

// === AI 助手 Schemas ===

export const aiChatSchema = z.object({
  message: z.string().min(1, '消息不能为空').max(2000, '消息过长'),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).max(20).optional().default([]),
})

export const aiConfigUpdateSchema = z.object({
  provider: z.string().min(1).max(50).optional(),
  model: z.string().min(1).max(100).optional(),
  apiKey: z.string().max(200).optional(),
  baseUrl: z.string().max(500).nullable().optional(),
  systemPrompt: z.string().max(3000).optional(),
  isEnabled: z.boolean().optional(),
})

// === AI 写作辅助 Schemas（/ai/write/*，管理端专用） ===

export const aiWriteSummarySchema = z.object({
  content: z.string().min(1, '正文不能为空').max(20000, '正文过长，请缩减后重试'),
})

export const aiWritePolishSchema = z.object({
  text: z.string().min(1, '请先选中要处理的文字').max(6000, '选中文字过长'),
  action: z.enum(['polish', 'expand', 'fix']).optional().default('polish'),
})

export const aiWriteTitlesSchema = z.object({
  content: z.string().min(1, '正文不能为空').max(20000, '正文过长，请缩减后重试'),
  summary: z.string().max(500).optional(),
})

export const aiWriteDraftSchema = z.object({
  prompt: z.string().min(1, '请输入主题或要求').max(2000, '描述过长'),
  outline: z.string().max(2000).optional(),
  tone: z.enum(['formal', 'casual', 'tech', 'story']).optional(),
  length: z.enum(['short', 'medium', 'long']).optional(),
})

// === AI 对话（DeepSeek）Schemas（/ai-chat/*） ===

/** 管理员更新 AI 对话配置 */
export const aiChatConfigUpdateSchema = z.object({
  provider: z.string().min(1).max(50).optional(),
  model: z.string().min(1).max(100).optional(),
  apiKey: z.string().max(200).optional(),
  baseUrl: z.string().max(500).nullable().optional(),
  systemPrompt: z.string().max(3000).optional(),
  // 每用户每日提问上限；0 = 不限
  dailyLimit: z.number().int().min(0).max(100000).optional(),
  isEnabled: z.boolean().optional(),
  // 联网搜索（第三方搜索 API）
  searchEnabled: z.boolean().optional(),
  searchProvider: z.enum(['deepseek', 'bocha', 'tavily']).optional(),
  searchApiKey: z.string().max(200).optional(),
})

/** 发送 AI 对话消息（content 与 imageIds 至少其一，路由层校验以给出明确文案） */
export const aiChatMessageSchema = z.object({
  conversationId: z.number().int().positive().optional(),
  content: z.string().max(4000, '消息过长（上限 4000 字）').default(''),
  imageIds: z.array(z.number().int().positive()).max(4, '每条消息最多 4 张图片').default([]),
  // 思考模式开关：true 时向上游传 thinking:{type:'enabled'}，回复先产出思维链（reasoning_content）再给正文
  thinking: z.boolean().optional(),
  // 联网搜索开关：true 时先调用搜索服务，把网页资料注入本轮上下文
  search: z.boolean().optional(),
})

// === 第三方应用授权 Schemas（/oauth/*） ===

/** 授权页参数：应用名下的 client_id + 回调地址 + 申请的 scope + 防 CSRF 的 state */
export const oauthAuthorizeQuerySchema = z.object({
  client_id: z.string().min(1).max(100),
  redirect_uri: z.string().min(1).max(500),
  scope: z.string().min(1).max(500),
  state: z.string().max(200).optional(),
})

/** 用户在授权页的最终决定 */
export const oauthAuthorizeDecisionSchema = oauthAuthorizeQuerySchema.extend({
  decision: z.enum(['approve', 'deny']),
})

/** 令牌端点：授权码换令牌 / 刷新令牌轮换，字段按 grant_type 在路由内分别校验 */
export const oauthTokenSchema = z.object({
  grant_type: z.enum(['authorization_code', 'refresh_token']),
  client_id: z.string().min(1).max(100),
  client_secret: z.string().max(200).optional(),
  code: z.string().max(200).optional(),
  redirect_uri: z.string().max(500).optional(),
  code_verifier: z.string().max(200).optional(),
  refresh_token: z.string().max(200).optional(),
})

/** 撤销端点 */
export const oauthRevokeSchema = z.object({
  client_id: z.string().min(1).max(100),
  client_secret: z.string().max(200).optional(),
  token: z.string().min(1).max(200),
})

/** 管理员注册应用 */
export const oauthClientCreateSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(200).optional(),
  homepage: z.string().max(300).optional(),
  redirectUris: z.array(z.string().min(1).max(500)).min(1).max(20),
  allowedScopes: z.array(z.enum(APP_SCOPES)).min(1),
  clientType: z.enum(['confidential', 'public']).default('confidential'),
})

/** 管理员更新应用（可停用 / 启用） */
export const oauthClientUpdateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  description: z.string().max(200).optional(),
  homepage: z.string().max(300).optional(),
  redirectUris: z.array(z.string().min(1).max(500)).min(1).max(20).optional(),
  allowedScopes: z.array(z.enum(APP_SCOPES)).min(1).optional(),
  clientType: z.enum(['confidential', 'public']).optional(),
  isActive: z.boolean().optional(),
})

// === 好友 / 聊天 Schemas ===

export const chatUserTargetSchema = z.object({
  userId: z.number().int().positive(),
})

export const chatMessageSchema = z.object({
  content: z.string().trim().min(1, '消息不能为空').max(2000, '消息过长'),
})

export const chatReadSchema = z.object({
  lastMessageId: z.number().int().nonnegative(),
})

export const chatGroupCreateSchema = z.object({
  name: z.string().trim().min(1, '群名不能为空').max(60, '群名过长'),
  memberIds: z.array(z.number().int().positive()).min(1, '至少选择一位好友').max(49),
})

export const chatGroupUpdateSchema = z.object({
  name: z.string().trim().min(1, '群名不能为空').max(60, '群名过长'),
})

export const chatGroupMembersSchema = z.object({
  userIds: z.array(z.number().int().positive()).min(1).max(49),
})

export const chatSearchSchema = z.object({
  q: z.string().trim().min(1).max(50),
})

// === 网盘空间配额 Schema ===

export const updateUserQuotaSchema = z.object({
  // 用纯数字字符串传输，避免 JS number 在超大字节数上的精度问题
  storageQuotaBytes: z.string().regex(/^\d{1,16}$/, '请提供字节数（字符串）'),
})

// === 游戏（2048 好友联机）Schemas ===

/** POST /api/games/2048/invites —— 邀请好友对战 */
export const gameInviteCreateSchema = z.object({
  friendId: z.number().int().positive(),
})

/** POST /api/games/2048/invites/:id/respond —— 接受 / 拒绝邀请 */
export const gameInviteRespondSchema = z.object({
  action: z.enum(['accept', 'decline']),
})

/** POST /api/games/2048/matches/:id/start —— 房主开始游戏（可选竞速时长，1–60 分钟） */
export const gameStartSchema = z.object({
  durationMinutes: z.number().int().min(1).max(60).optional(),
})

/** POST /api/games/2048/matches/:id/moves —— 服务端权威移动（客户端只提交方向） */
export const gameMoveSchema = z.object({
  direction: z.enum(['up', 'down', 'left', 'right']),
})

/** GET /api/games/2048/sync?matchId= —— 轮询降级时的统一状态同步 */
export const gameSyncQuerySchema = z.object({
  matchId: z.coerce.number().int().positive().optional(),
})

// === 游戏（斗地主好友联机）Schemas ===

/**
 * POST /api/games/doudizhu/matches/:id/actions —— 服务端权威动作
 * bid：叫分（0 = 不叫，1–3 分）；play：出牌（手牌 id 列表）；pass：不出。
 */
export const doudizhuActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('bid'),
    bid: z.number().int().min(0).max(3),
  }),
  z.object({
    type: z.literal('play'),
    cards: z.array(z.number().int().min(0).max(53)).min(1).max(20),
  }),
  z.object({ type: z.literal('pass') }),
])

// === 游戏（贪吃蛇大地图联机）Schemas ===

/** POST /api/games/snake/matches/:id/actions —— 提交下一步方向（服务端权威推进） */
export const snakeActionSchema = z.object({
  type: z.literal('turn'),
  direction: z.enum(['up', 'down', 'left', 'right']),
})

// === 游戏（扫雷好友联机，轮流点）Schemas ===

/**
 * POST /api/games/minesweeper/matches/:id/actions —— 一人只许下一次
 * open：翻开格子（越界由服务层按棋盘尺寸再校验）；flag：插旗 / 拔旗。
 */
export const minesweeperActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('open'), index: z.number().int().min(0).max(4095) }),
  z.object({ type: z.literal('flag'), index: z.number().int().min(0).max(4095) }),
])

// === 游戏（跳一跳好友联机，轮流跳）Schemas ===

/**
 * POST /api/games/jump/matches/:id/actions —— 蓄力起跳
 * chargeMs：按住到松手的蓄力毫秒数（1–2000，与服务端物理引擎一致）。
 */
export const jumpActionSchema = z.object({
  type: z.literal('jump'),
  chargeMs: z.number().int().min(1).max(2000),
})

// === 游戏（我的世界体素沙盒联机）Schemas ===

/**
 * POST /api/games/minecraft/matches/:id/actions —— 状态上报 / 方块编辑
 * state：玩家位置快照（~2Hz，坐标为脚底中心，允许小越界缓冲便于边界体感）；
 * edit：一批方块修改（y=0 基岩层在 schema 层就拒绝，越界由服务层再校验）。
 */
export const minecraftActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('state'),
    x: z.number().finite().min(-4).max(MC_WORLD_SIZE + 4),
    y: z.number().finite().min(-4).max(MC_WORLD_HEIGHT + 4),
    z: z.number().finite().min(-4).max(MC_WORLD_SIZE + 4),
    yaw: z.number().finite().min(-12.6).max(12.6),
    pitch: z.number().finite().min(-1.58).max(1.58),
    flying: z.boolean(),
  }),
  z.object({
    type: z.literal('edit'),
    edits: z
      .array(
        z.object({
          x: z.number().int().min(0).max(MC_WORLD_SIZE - 1),
          y: z.number().int().min(1).max(MC_WORLD_HEIGHT - 1),
          z: z.number().int().min(0).max(MC_WORLD_SIZE - 1),
          b: z.number().int().min(0).max(MC_BLOCK_COUNT - 1),
        }),
      )
      .min(1)
      .max(64),
  }),
])

/** GET /api/games/minecraft/sync?matchId=&since= —— since 为修改日志水位（增量补拉） */
export const minecraftSyncQuerySchema = z.object({
  matchId: z.coerce.number().int().positive().optional(),
  since: z.coerce.number().int().min(0).max(100_000_000).optional(),
})

// === 游戏（五子棋好友联机，轮流落子）Schemas ===

/**
 * POST /api/games/gomoku/matches/:id/actions —— 在空交叉点落子
 * x 为列、y 为行（0–14，15×15 棋盘）；占用已有点由服务层再校验并返回 400。
 */
export const gomokuActionSchema = z.object({
  type: z.literal('place'),
  x: z.number().int().min(0).max(14),
  y: z.number().int().min(0).max(14),
})

// === 游戏（骗子酒馆好友联机，出牌 / 质疑）Schemas ===

/**
 * POST /api/games/liar/matches/:id/actions
 * play：盖着出 1–3 张牌（牌 id 0–19，必须来自自己手牌，服务层再校验）；
 * challenge：质疑上一手（开牌定真假，输家扣扳机）。
 */
export const liarActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('play'),
    cards: z.array(z.number().int().min(0).max(19)).min(1).max(3),
  }),
  z.object({ type: z.literal('challenge') }),
])

// === 游戏（UNO 好友联机，2–10 人）Schemas ===

/**
 * POST /api/games/uno/matches/:id/actions
 * play：出牌（万能牌必须带 color）；draw：摸一张；pass：摸牌后跳过。
 */
export const unoActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('play'),
    cardId: z.number().int().min(0).max(107),
    color: z.enum(['red', 'yellow', 'green', 'blue']).optional(),
  }),
  z.object({ type: z.literal('draw') }),
  z.object({ type: z.literal('pass') }),
])

// === 游戏（中国象棋好友联机，2 人）Schemas ===

/**
 * POST /api/games/xiangqi/matches/:id/actions —— 走子
 * from / to 为 0–89 的一维下标（y*9+x），合法性由服务端引擎判定。
 */
export const xiangqiActionSchema = z.object({
  type: z.literal('move'),
  from: z.number().int().min(0).max(89),
  to: z.number().int().min(0).max(89),
})

// === 游戏（霓虹跑酷 3D 三车道联机）Schemas ===

/**
 * POST /api/games/parkour/matches/:id/actions
 * progress：绝对进度上报（约 2Hz；距离单调、服务端再做速度/金币上限校验）；
 * finish：冲线，服务端按收到顺序排名。
 */
export const parkourActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('progress'),
    distanceM: z.number().finite().min(0).max(20_000),
    coins: z.number().int().min(0).max(10_000),
    maxCombo: z.number().int().min(0).max(10_000),
    lane: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    pose: z.enum(['run', 'jump', 'slide']),
    alive: z.boolean(),
    cause: z.enum(['hit', 'pit']).optional(),
  }),
  z.object({
    type: z.literal('finish'),
    distanceM: z.number().finite().min(0).max(20_000),
    coins: z.number().int().min(0).max(10_000),
    maxCombo: z.number().int().min(0).max(10_000),
  }),
])

// === 网页反代（/api/proxy）Schemas ===

/** 新建反代站点：输入域名或完整地址，name 可省略（默认取主机名） */
export const proxySiteCreateSchema = z.object({
  url: z.string().trim().min(1, '请输入网站地址').max(500),
  name: z.string().trim().min(1).max(60).optional(),
  /** 强制使用桌面浏览器 UA 访问上游 */
  forceDesktop: z.boolean().optional(),
})

/** 更新站点：重命名与「桌面 UA」开关都是可选字段 */
export const proxySiteUpdateSchema = z
  .object({
    name: z.string().trim().min(1, '名称不能为空').max(60).optional(),
    forceDesktop: z.boolean().optional(),
  })
  .refine((data) => data.name !== undefined || data.forceDesktop !== undefined, {
    message: '没有需要更新的字段',
  })
