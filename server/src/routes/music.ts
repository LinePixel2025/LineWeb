import { Router, type Request, type Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { asyncHandler } from '../lib/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate } from '../middleware/auth.js'
import {
  callNcmForUser,
  checkLoginQr,
  createLoginQr,
  getMusicStatus,
  unbindMusicAccount,
} from '../services/neteaseMusic.js'

/**
 * 网易云音乐路由（挂载于 /api/music，受 music 功能开关控制）
 *
 * 全部端点要求账号登录令牌：
 *   - 本路由不在 index.ts 的 publicApiPaths 白名单，全局 authenticate 中间件已兜底，
 *     router 内再声明一次以保证独立于挂载方式
 *   - 不加入 appScopes 端点白名单，第三方应用令牌一律 403
 *
 * 职责：对 neteaseMusic 服务的薄代理。请求参数先经服务端白名单校验再透传，
 * 绝不透传 cookie；登录类端点限流从严（防上游风控），扫码轮询由前端 1.5s 一次。
 */
const router = Router()
router.use(authenticate)

function limitFor(max: number, message: string) {
  return rateLimit({
    windowMs: 5 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.user?.userId ?? ipKeyGenerator(req.ip ?? '')),
    message: { error: message },
    skip: (req) => req.user?.role === 'admin',
  })
}

const qrPrepareLimiter = limitFor(10, '登录二维码请求太频繁，请稍后再试')
const qrCheckLimiter = limitFor(240, '扫码状态查询太频繁，请稍后再试')
const searchLimiter = limitFor(60, '搜索太频繁，请稍后再试')
const playLimiter = limitFor(120, '操作太频繁，请稍后再试')

function currentUserId(req: Request): number {
  const userId = req.user?.userId
  if (!userId) throw new AppError('未登录', 401)
  return userId
}

/** 网易云资源 ID 为纯数字长串（可达 64 位，用字符串传递） */
function requireNcmId(raw: unknown, name: string): string {
  const value = typeof raw === 'string' ? raw : String(raw ?? '')
  if (!/^\d{1,20}$/.test(value)) throw new AppError(`无效的${name}`, 400)
  return value
}

/** 音质白名单（song/url/v1 level）；非黑胶账号由上游自动降级 */
const SONG_LEVELS = new Set(['standard', 'higher', 'exhigh', 'lossless', 'hires'])
function parseSongLevel(raw: unknown): string {
  const value = typeof raw === 'string' ? raw : ''
  return SONG_LEVELS.has(value) ? value : 'exhigh'
}

/** 搜索类型白名单：1 单曲 / 10 专辑 / 1000 歌单 */
function parseSearchType(raw: unknown): number {
  const value = Number(raw)
  return value === 10 || value === 1000 ? value : 1
}

// GET /api/music/status — 绑定状态（不返回 cookie）
router.get('/status', asyncHandler(async (req: Request, res: Response) => {
  res.json(await getMusicStatus(currentUserId(req)))
}))

// GET /api/music/login/qr/prepare — 生成登录二维码
router.get('/login/qr/prepare', qrPrepareLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await createLoginQr())
}))

// GET /api/music/login/qr/check?key= — 轮询扫码状态（803 时完成绑定）
router.get('/login/qr/check', qrCheckLimiter, asyncHandler(async (req: Request, res: Response) => {
  const key = typeof req.query.key === 'string' ? req.query.key : ''
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) throw new AppError('无效的二维码 key', 400)
  res.json(await checkLoginQr(currentUserId(req), key))
}))

// POST /api/music/logout — 解绑
router.post('/logout', playLimiter, asyncHandler(async (req: Request, res: Response) => {
  await unbindMusicAccount(currentUserId(req))
  res.json({ ok: true })
}))

// GET /api/music/search?keywords=&type=&limit=&offset= — 搜索（未绑定匿名可用）
router.get('/search', searchLimiter, asyncHandler(async (req: Request, res: Response) => {
  const keywords = typeof req.query.keywords === 'string' ? req.query.keywords.trim() : ''
  if (keywords.length < 1 || keywords.length > 80) throw new AppError('请输入 1–80 字的搜索关键词', 400)
  const type = parseSearchType(req.query.type)
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 30)
  const offset = Math.min(Math.max(Number(req.query.offset) || 0, 0), 1000)
  res.json(await callNcmForUser(currentUserId(req), 'cloudsearch', { keywords, type, limit, offset }))
}))

// GET /api/music/song/url?id=&level= — 播放地址（浏览器直连网易 CDN）
router.get('/song/url', playLimiter, asyncHandler(async (req: Request, res: Response) => {
  const id = requireNcmId(req.query.id, '歌曲 ID')
  const level = parseSongLevel(req.query.level)
  res.json(await callNcmForUser(currentUserId(req), 'song_url_v1', { id, level }))
}))

// GET /api/music/lyric?id= — 歌词（含翻译/罗马音）
router.get('/lyric', playLimiter, asyncHandler(async (req: Request, res: Response) => {
  const id = requireNcmId(req.query.id, '歌曲 ID')
  res.json(await callNcmForUser(currentUserId(req), 'lyric_new', { id }))
}))

// GET /api/music/recommend/songs — 每日推荐（需绑定）
router.get('/recommend/songs', playLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await callNcmForUser(currentUserId(req), 'recommend_songs', {}, { requireBound: true }))
}))

// GET /api/music/toplist — 官方排行榜列表
router.get('/toplist', playLimiter, asyncHandler(async (_req: Request, res: Response) => {
  res.json(await callNcmForUser(currentUserId(_req), 'toplist'))
}))

// GET /api/music/playlist/:id/tracks?limit=&offset= — 歌单/榜单曲目
router.get('/playlist/:id/tracks', playLimiter, asyncHandler(async (req: Request, res: Response) => {
  const id = requireNcmId(req.params.id, '歌单 ID')
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100)
  const offset = Math.min(Math.max(Number(req.query.offset) || 0, 0), 10000)
  res.json(await callNcmForUser(currentUserId(req), 'playlist_track_all', { id, limit, offset }))
}))

export default router
