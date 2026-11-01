import prisma from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { hostMatchesSuffix } from './webProxyHosts.js'

/**
 * 网易云音乐服务：对 @neteasecloudmusicapienhanced/api 的函数级薄封装（库挂载，不起独立 HTTP 服务）。
 *
 * 安全与合规约定：
 *   - 解灰绝不启用：本模块构造的 query 永不携带 unblock 参数（该包的解灰仅在
 *     query.unblock === 'true' 时触发），部署环境另外显式设 ENABLE_GENERAL_UNBLOCK=false 双保险
 *   - 登录 cookie（含 MUSIC_U）只存 MusicAccount 表，任何响应不回传前端
 *   - 上游 cookie 失效（code 301）时清除绑定并抛 401 MUSIC_SESSION_EXPIRED，前端引导重新扫码
 *   - 只做扫码登录（login_qr_* 三步），不做账密登录与任何自动化（签到/刷歌）
 */

/** NCM 包函数返回的原始响应 */
interface NcmResponse<T = Record<string, unknown>> {
  status: number
  body: T
  cookie?: string[]
}

type NcmFn = (query: Record<string, unknown>) => Promise<NcmResponse>
type NcmApiMap = Record<string, NcmFn>

/** NCM 包较重（axios/jsdom 等），按需懒加载一次（含启动例程） */
let ncmApiPromise: Promise<NcmApiMap> | null = null

/** NCM 包官方启动例程（app.js 同款）：注册真实匿名 token + 生成 xeapi 公钥 */
let ncmInitPromise: Promise<void> | null = null

function initNcmRuntime(): Promise<void> {
  if (!ncmInitPromise) {
    ncmInitPromise = (async () => {
      const mod = await import('@neteasecloudmusicapienhanced/api/generateConfig.js')
      const gen = mod as unknown as { default?: () => Promise<void> }
      const generateConfig = gen.default ?? (mod as unknown as () => Promise<void>)
      // 跑两遍：第一遍生成 xeapi 公钥（匿名注册的内部请求依赖它，可能失败被例程吞掉），
      // 第二遍公钥已就绪，真实匿名 token 稳定落盘。例程内部每步自 catch，不会 reject。
      await generateConfig()
      await generateConfig()
    })().catch((err) => {
      console.warn('[Music] NCM 启动例程失败（匿名播放地址可能受影响）:', err)
    })
  }
  return ncmInitPromise
}

function getNcmApi(): Promise<NcmApiMap> {
  if (!ncmApiPromise) {
    ncmApiPromise = (async () => {
      const mod = await import('@neteasecloudmusicapienhanced/api')
      const api = (mod as unknown as { default?: NcmApiMap }).default
        ?? (mod as unknown as NcmApiMap)
      // 必须在首个 API 调用前跑完启动例程：request.js 首次加载时会把匿名 token 缓存进
      // 内存（冷启动上该文件是占位空串），且 song_url_v1 走 xeapi 需要公钥文件。
      await initNcmRuntime()
      return api
    })().catch((err) => {
      ncmApiPromise = null // 加载失败允许下次重试
      throw err
    })
  }
  return ncmApiPromise
}

/**
 * 网易云媒体 CDN 域名（封面图 / 音频 / 头像）。
 * 这些主机同时提供 https，而上游接口返回的地址大多是明文 http：
 *   - 封面是 <img>，页面 CSP 的 img-src 只放行 https:，http 会被直接拦掉
 *     （线上现象：搜索结果「大多数封面无法显示」，排行榜封面却正常——后者上游给的是 https）
 *   - 音频是 <audio>，一旦站点将来跑在 HTTPS 上，http 就是混合内容被浏览器阻塞
 * 因此统一在服务端把已知网易 CDN 的 http 地址升级为 https，前端拿到的就都是可用地址。
 */
const NCM_MEDIA_HTTP_RE = /^http:\/\/((?:[a-z0-9-]+\.)*(?:music\.126\.net|126\.net|127\.net|netease\.com))([/?#].*)?$/i

/** 把单条网易 CDN 的 http 地址升级为 https（其它域名原样返回） */
export function upgradeNcmMediaUrl(url: string): string {
  return url.replace(NCM_MEDIA_HTTP_RE, (_, host: string, rest = '') => `https://${host}${rest}`)
}

/**
 * 递归升级响应体里的网易 CDN 地址（封面、音频、头像、歌单封面等）。
 * 只改字符串值，键名与结构保持不变；深度遍历的是一般音乐响应（最多百来首歌），开销可忽略。
 */
export function upgradeNcmMediaUrlsIn<T>(value: T): T {
  if (typeof value === 'string') return upgradeNcmMediaUrl(value) as unknown as T
  if (Array.isArray(value)) return value.map(item => upgradeNcmMediaUrlsIn(item)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = upgradeNcmMediaUrlsIn(item)
    }
    return out as unknown as T
  }
  return value
}

/** 上游 cookie 失效（登录态过期）返回码 */
const NCM_SESSION_EXPIRED_CODE = 301

/** 上游初始化未就绪的报错特征（xeapi 公钥缺失 / 匿名 token 未注册） */
function isNcmInitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '')
  return /xeapi public key/i.test(message) || /anonymous_token|anonimous/i.test(message)
}

/** 重置初始化例程，让下次调用重新生成匿名 token 与 xeapi 公钥（自愈） */
function resetNcmRuntime(): void {
  ncmInitPromise = null
}

const NCM_CALL_TIMEOUT_MS = 15_000

function ncmTimeout(): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(
      () => reject(new AppError('网易云音乐接口响应超时，请稍后再试', 504)),
      NCM_CALL_TIMEOUT_MS,
    )
    timer.unref?.()
  })
}

/**
 * 调用 NCM 包函数（带 timestamp 防缓存）；上游抛错/超时统一映射 502/504。
 *
 * 自愈：容器刚启动时首次请求可能撞上「xeapi public key is missing」——启动例程里
 * 注册匿名 token 失败会连带公钥生成失败，之后 song/url 就一直 502（线上「无法听歌」
 * 的成因之一）。这里识别出初始化类错误后重置并重跑一次初始化例程再重试，避免必须重启进程。
 */
async function callNcmRaw(
  fnName: string,
  query: Record<string, unknown> = {},
  retried = false,
): Promise<NcmResponse> {
  // 整个调用（含首次懒加载与运行时初始化）都纳入超时：初始化在弱网/出站受限时
  // 也可能卡住，此前只包住 fn()，会让前端一直停在「加载中」。
  const invoke = async (): Promise<NcmResponse> => {
    const api = await getNcmApi()
    const fn = api[fnName]
    if (typeof fn !== 'function') {
      throw new AppError(`网易云音乐接口 ${fnName} 不可用`, 502)
    }
    return fn({ ...query, timestamp: Date.now() })
  }

  try {
    return await Promise.race([invoke(), ncmTimeout()])
  } catch (err) {
    if (err instanceof AppError) throw err
    if (!retried && isNcmInitError(err)) {
      console.warn(`[Music] 网易云运行时未就绪，重新初始化后重试 ${fnName}:`, err)
      resetNcmRuntime()
      await initNcmRuntime()
      return callNcmRaw(fnName, query, true)
    }
    console.error(`[Music] 网易云接口 ${fnName} 调用失败:`, err)
    throw new AppError('网易云音乐接口暂时不可用，请稍后再试', 502)
  }
}

// ============================================================
// 账号绑定（MusicAccount）
// ============================================================

export interface MusicAccountView {
  bound: boolean
  nickname: string
  avatarUrl: string
}

function toAccountView(row: { nickname: string; avatarUrl: string } | null): MusicAccountView {
  return row
    ? { bound: true, nickname: row.nickname, avatarUrl: row.avatarUrl }
    : { bound: false, nickname: '', avatarUrl: '' }
}

export async function getMusicStatus(userId: number): Promise<MusicAccountView> {
  const row = await prisma.musicAccount.findUnique({
    where: { userId },
    select: { nickname: true, avatarUrl: true },
  })
  return toAccountView(row)
}

/** 从登录 cookie 解析昵称/头像（失败不阻断绑定） */
async function fetchProfile(cookie: string): Promise<{ nickname: string; avatarUrl: string }> {
  try {
    const body = await callNcmRaw('login_status', { cookie })
    const profile = (body.body as { data?: { profile?: { nickname?: string; avatarUrl?: string } } })?.data?.profile
    return {
      nickname: profile?.nickname ?? '',
      // 头像也是网易 CDN 的 http 地址，页面 CSP 只放行 https 的图片
      avatarUrl: profile?.avatarUrl ? upgradeNcmMediaUrl(profile.avatarUrl) : '',
    }
  } catch {
    return { nickname: '', avatarUrl: '' }
  }
}

/** 用扫码得到的 cookie 建立绑定（upsert；cookie 不回传） */
export async function bindMusicAccount(userId: number, cookie: string): Promise<MusicAccountView> {
  const profile = await fetchProfile(cookie)
  const row = await prisma.musicAccount.upsert({
    where: { userId },
    update: { cookie, nickname: profile.nickname, avatarUrl: profile.avatarUrl, loggedInAt: new Date() },
    create: { userId, cookie, nickname: profile.nickname, avatarUrl: profile.avatarUrl },
    select: { nickname: true, avatarUrl: true },
  })
  return toAccountView(row)
}

export async function unbindMusicAccount(userId: number): Promise<void> {
  await prisma.musicAccount.deleteMany({ where: { userId } })
}

// ============================================================
// 业务调用（携带用户 cookie 或匿名）
// ============================================================

/** 上游是否返回了登录态失效（301） */
function isSessionExpired(body: unknown): boolean {
  return (body as { code?: number } | null)?.code === NCM_SESSION_EXPIRED_CODE
}

/** 绑定账号的 cookie 失效（code 301）：清除绑定并要求重新扫码 */
function throwSessionExpired(userId: number): never {
  void prisma.musicAccount.deleteMany({ where: { userId } }).catch(() => {})
  throw new AppError('网易云登录已过期，请重新扫码绑定', 401, 'MUSIC_SESSION_EXPIRED')
}

/**
 * 以用户身份调用 NCM 接口：已绑定带 cookie，未绑定匿名（包内自动注入匿名 token）。
 * requireBound = true 时未绑定直接 400。
 *
 * 返回前统一把网易 CDN 的 http 媒体地址升级为 https（封面在 CSP img-src 下只允许 https）。
 */
export async function callNcmForUser(
  userId: number,
  fnName: string,
  query: Record<string, unknown> = {},
  options: { requireBound?: boolean } = {},
): Promise<Record<string, unknown>> {
  const row = await prisma.musicAccount.findUnique({
    where: { userId },
    select: { cookie: true },
  })
  if (options.requireBound && !row) {
    throw new AppError('请先绑定网易云账号', 400, 'MUSIC_NOT_BOUND')
  }

  const res = await callNcmRaw(fnName, row ? { ...query, cookie: row.cookie } : query)

  if (isSessionExpired(res.body)) {
    if (row) throwSessionExpired(userId)
    // 匿名用户的 301 = 包内的匿名 token 过期，重新注册匿名 token 后重试一次
    resetNcmRuntime()
    await initNcmRuntime()
    const retried = await callNcmRaw(fnName, query)
    return upgradeNcmMediaUrlsIn(retried.body)
  }

  return upgradeNcmMediaUrlsIn(res.body)
}

// ============================================================
// 音频中转（设备无法直连网易云 CDN 时经服务器流式转发）
// ============================================================

/** 网易云媒体 CDN 域名后缀（音频 / 封面 / 头像）。只允许这些域名，永不放行任意 URL */
const NCM_MEDIA_HOST_SUFFIXES = ['music.126.net', '126.net', '127.net', 'netease.com']

/** 解析结果缓存：音频元素每个 Range 请求都会打 /stream，不能每次都查库 + 打上游 */
const SONG_URL_CACHE_TTL_MS = 5 * 60 * 1000
const SONG_URL_CACHE_MAX = 400

export interface SongStreamSource {
  /** 可直接下载的音频地址（已升级为 https） */
  url: string
  /** VIP 试听片段的结束秒数；完整歌曲为 null */
  trialEnd: number | null
}

const songUrlCache = new Map<string, SongStreamSource & { expiresAt: number }>()

/**
 * 校验媒体地址：仅允许 http(s) + 网易云 CDN 域名，拒绝账号密码与其它主机。
 *
 * 地址只应来自上游接口响应（或上游 302 的 Location），绝不直接采用客户端传入的
 * URL；图片中转虽由客户端传 `u`，也必须过这道白名单，避免变成开放代理 / SSRF。
 */
export function assertNeteaseMediaUrl(
  raw: string,
  options: { base?: string; status?: number } = {},
): URL {
  const status = options.status ?? 502
  let url: URL
  try {
    url = options.base ? new URL(raw, options.base) : new URL(raw)
  } catch {
    throw new AppError('媒体地址无效', status, 'MUSIC_BAD_MEDIA_URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('媒体地址协议不受支持', status, 'MUSIC_BAD_MEDIA_URL')
  }
  if (url.username || url.password) {
    throw new AppError('媒体地址包含不受支持的凭证', status, 'MUSIC_BAD_MEDIA_URL')
  }
  if (!NCM_MEDIA_HOST_SUFFIXES.some((suffix) => hostMatchesSuffix(url.hostname, suffix))) {
    throw new AppError('媒体地址不在网易云 CDN 允许范围内', status, 'MUSIC_BAD_MEDIA_URL')
  }
  return url
}

/**
 * 取某首歌在指定音质下的可播放地址（5 分钟内存缓存）。
 *
 * 返回 null 表示上游没有给出地址（版权限制 / 需要付费），与调用失败区分开。
 */
export async function resolveSongStream(
  userId: number,
  songId: string,
  level: string,
): Promise<SongStreamSource | null> {
  const key = `${userId}:${songId}:${level}`
  const now = Date.now()
  const cached = songUrlCache.get(key)
  if (cached) {
    if (cached.expiresAt > now) return { url: cached.url, trialEnd: cached.trialEnd }
    songUrlCache.delete(key)
  }

  const body = await callNcmForUser(userId, 'song_url_v1', { id: songId, level })
  const entry = (body as {
    data?: Array<{ url?: string | null; freeTrialInfo?: { end?: number } | null }>
  })?.data?.[0]
  const url = typeof entry?.url === 'string' ? entry.url : ''
  if (!url) return null

  const trialEndRaw = entry?.freeTrialInfo?.end
  const trialEnd = typeof trialEndRaw === 'number' && trialEndRaw > 0 ? trialEndRaw : null

  songUrlCache.set(key, { url, trialEnd, expiresAt: now + SONG_URL_CACHE_TTL_MS })
  if (songUrlCache.size > SONG_URL_CACHE_MAX) {
    const oldest = songUrlCache.keys().next().value
    if (oldest !== undefined) songUrlCache.delete(oldest)
  }
  return { url, trialEnd }
}

// ============================================================
// 扫码登录三步
// ============================================================

/** 生成登录二维码：返回 key 与 base64 图片（data URL） */
export async function createLoginQr(): Promise<{ key: string; qrimg: string }> {
  const keyRes = await callNcmRaw('login_qr_key', {})
  const key = (keyRes.body as { data?: { unikey?: string } })?.data?.unikey
  if (!key) throw new AppError('生成登录二维码失败，请稍后再试', 502)

  const qrRes = await callNcmRaw('login_qr_create', { key, qrimg: true })
  const qrimg = (qrRes.body as { data?: { qrimg?: string } })?.data?.qrimg
  if (!qrimg) throw new AppError('生成登录二维码失败，请稍后再试', 502)

  return { key, qrimg }
}

export interface LoginQrCheckResult {
  /** 网易云状态码：800 过期 / 801 待扫 / 802 已扫待确认 / 803 成功 */
  code: number
  message: string
  /** code=803 时返回绑定后的账号视图 */
  account: MusicAccountView | null
}

const QR_CODE_MESSAGES: Record<number, string> = {
  800: '二维码已过期，请刷新重试',
  801: '等待扫码',
  802: '已扫码，请在手机上确认',
  803: '登录成功',
}

/** 轮询扫码状态；code=803 时取出响应 cookie 完成绑定 */
export async function checkLoginQr(userId: number, key: string): Promise<LoginQrCheckResult> {
  const res = await callNcmRaw('login_qr_check', { key })
  const code = (res.body as { code?: number })?.code ?? 0

  if (code === 803 && Array.isArray(res.cookie) && res.cookie.length > 0) {
    const cookie = res.cookie.join('; ')
    const account = await bindMusicAccount(userId, cookie)
    return { code, message: QR_CODE_MESSAGES[803], account }
  }

  return { code, message: QR_CODE_MESSAGES[code] ?? `未知状态（${code}）`, account: null }
}
