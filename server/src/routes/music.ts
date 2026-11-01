import { Readable } from 'node:stream'
import { Router, type Request, type Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { asyncHandler } from '../lib/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate } from '../middleware/auth.js'
import {
  assertNeteaseMediaUrl,
  callNcmForUser,
  checkLoginQr,
  createLoginQr,
  getMusicStatus,
  resolveSongStream,
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
// 中转端点会被 <audio> 的 Range 请求与封面图批量命中，额度放宽；仍按用户计，防滥用
const streamLimiter = limitFor(600, '音频中转请求太频繁，请稍后再试')
const imageLimiter = limitFor(600, '封面加载请求太频繁，请稍后再试')

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

// ============================================================
// 媒体中转（设备无法直连网易云 CDN 时由服务器流式转发）
// ============================================================

/** 只等响应头的超时：长音频不设总时长，拿到响应头后交给流式转发 */
const MEDIA_HEADER_TIMEOUT_MS = 20_000
/** 上游重定向最多跟随几跳（每跳都重新校验域名） */
const MEDIA_MAX_REDIRECTS = 4
/** 透传给浏览器的上游响应头（Range/缓存/长度语义靠它们维持） */
const MEDIA_PASS_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
] as const

interface ForwardMediaOptions {
  /** 上游没给 Content-Type 时的兜底 */
  defaultContentType: string
  cacheControl: string
  /** 图片中转：上游必须返回 image/*，避免被当成任意文件代理 */
  requireImage?: boolean
}

/**
 * 把网易云 CDN 的媒体流式转发给浏览器（支持 Range，拖动进度条可 seek）。
 *
 * 安全：地址由服务端解析或经白名单校验，重定向逐跳复核，客户端无法指定任意主机。
 * 说明：只对「等响应头」设超时，避免长音频被整体超时打断。
 */
async function forwardMedia(
  req: Request,
  res: Response,
  initial: URL,
  options: ForwardMediaOptions,
): Promise<void> {
  const controller = new AbortController()
  let headerTimer: ReturnType<typeof setTimeout> | null = setTimeout(
    () => controller.abort(),
    MEDIA_HEADER_TIMEOUT_MS,
  )
  const clearHeaderTimer = () => {
    if (headerTimer !== null) {
      clearTimeout(headerTimer)
      headerTimer = null
    }
  }

  const headers = new Headers()
  // 不压缩：保留 Content-Length / Content-Range，播放器才能精确 seek
  headers.set('accept-encoding', 'identity')
  headers.set('referer', 'https://music.163.com/')
  if (typeof req.headers.range === 'string') headers.set('range', req.headers.range)
  if (typeof req.headers['if-range'] === 'string') headers.set('if-range', req.headers['if-range'])

  let target = initial
  let upstream: globalThis.Response | null = null
  try {
    for (let hop = 0; hop <= MEDIA_MAX_REDIRECTS; hop += 1) {
      upstream = await fetch(target, {
        method: req.method === 'HEAD' ? 'HEAD' : 'GET',
        headers,
        redirect: 'manual',
        signal: controller.signal,
      })
      const location = upstream.headers.get('location')
      const isRedirect = upstream.status >= 300 && upstream.status < 400
      if (isRedirect && location) {
        if (hop === MEDIA_MAX_REDIRECTS) {
          throw new AppError('媒体地址重定向次数过多', 502, 'MUSIC_BAD_MEDIA_URL')
        }
        target = assertNeteaseMediaUrl(location, { base: target.href })
        continue
      }
      break
    }
  } catch (err) {
    clearHeaderTimer()
    if (err instanceof AppError) throw err
    throw new AppError('音频源暂时不可用，请稍后再试', 502, 'MUSIC_MEDIA_UNAVAILABLE')
  }
  clearHeaderTimer()

  if (!upstream) {
    throw new AppError('音频源暂时不可用，请稍后再试', 502, 'MUSIC_MEDIA_UNAVAILABLE')
  }
  if (upstream.status === 416) {
    const contentRange = upstream.headers.get('content-range')
    if (contentRange) res.setHeader('content-range', contentRange)
    res.status(416).end()
    return
  }
  if (upstream.status !== 200 && upstream.status !== 206) {
    throw new AppError(`音频源暂时不可用（上游 ${upstream.status}）`, 502, 'MUSIC_MEDIA_UNAVAILABLE')
  }

  const contentType = upstream.headers.get('content-type') || options.defaultContentType
  if (options.requireImage && !/^image\//i.test(contentType)) {
    throw new AppError('封面地址不是图片资源', 502, 'MUSIC_BAD_MEDIA_URL')
  }

  res.status(upstream.status)
  for (const name of MEDIA_PASS_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) res.setHeader(name, value)
  }
  if (!res.getHeader('content-type')) res.setHeader('content-type', contentType)
  // 覆盖全局认证中间件的 no-store：同一 URL（token 未变）可被浏览器复用，减少中转流量
  res.setHeader('cache-control', options.cacheControl)
  res.setHeader('x-accel-buffering', 'no')

  if (req.method === 'HEAD' || !upstream.body) {
    res.end()
    return
  }

  const stream = Readable.fromWeb(
    upstream.body as unknown as Parameters<typeof Readable.fromWeb>[0],
  )
  stream.on('error', () => {
    if (!res.headersSent) res.status(502).end()
    else res.end()
  })
  res.on('close', () => {
    // 浏览器中断（切歌 / 拖进度）时立刻断开上游，别让连接挂着
    controller.abort()
    stream.destroy()
  })
  stream.pipe(res)
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

// GET /api/music/stream?id=&level=&token= — 音频中转（设备无法直连网易云 CDN 时）
// 与 /song/url 的区别：音频字节经服务器转发，支持 Range（拖动进度条可 seek）。
router.get('/stream', streamLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const id = requireNcmId(req.query.id, '歌曲 ID')
  const level = parseSongLevel(req.query.level)
  const source = await resolveSongStream(userId, id, level)
  if (!source) throw new AppError('该歌曲暂无可播放的音频源（版权限制）', 404, 'MUSIC_NO_SOURCE')
  const target = assertNeteaseMediaUrl(source.url)
  await forwardMedia(req, res, target, {
    defaultContentType: 'audio/mpeg',
    cacheControl: 'private, max-age=600',
  })
}))

// GET /api/music/image?u=&token= — 封面中转（只代理网易云 CDN 图片，避免变成开放代理）
router.get('/image', imageLimiter, asyncHandler(async (req: Request, res: Response) => {
  const raw = typeof req.query.u === 'string' ? req.query.u : ''
  if (!raw || raw.length > 2048) throw new AppError('无效的图片地址', 400)
  const target = assertNeteaseMediaUrl(raw, { status: 400 })
  await forwardMedia(req, res, target, {
    defaultContentType: 'image/jpeg',
    cacheControl: 'private, max-age=86400',
    requireImage: true,
  })
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
