import prisma from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'

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

/** 调用 NCM 包函数（带 timestamp 防缓存）；上游抛错/超时统一映射 502/504 */
async function callNcmRaw(fnName: string, query: Record<string, unknown> = {}): Promise<NcmResponse> {
  try {
    const api = await getNcmApi()
    const fn = api[fnName]
    if (typeof fn !== 'function') {
      throw new AppError(`网易云音乐接口 ${fnName} 不可用`, 502)
    }
    return await Promise.race([
      fn({ ...query, timestamp: Date.now() }),
      ncmTimeout(),
    ])
  } catch (err) {
    if (err instanceof AppError) throw err
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
    return { nickname: profile?.nickname ?? '', avatarUrl: profile?.avatarUrl ?? '' }
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

/** cookie 失效（code 301）：清除绑定并要求重新扫码 */
function throwSessionExpiredIfNeeded(body: unknown, userId: number): void {
  const code = (body as { code?: number } | null)?.code
  if (code === 301) {
    void prisma.musicAccount.deleteMany({ where: { userId } }).catch(() => {})
    throw new AppError('网易云登录已过期，请重新扫码绑定', 401, 'MUSIC_SESSION_EXPIRED')
  }
}

/**
 * 以用户身份调用 NCM 接口：已绑定带 cookie，未绑定匿名（包内自动注入匿名 token）。
 * requireBound = true 时未绑定直接 400。
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
  throwSessionExpiredIfNeeded(res.body, userId)
  return res.body
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
