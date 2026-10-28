import crypto from 'node:crypto'
import { config } from '../config/index.js'
import { AppError } from '../middleware/errorHandler.js'

/**
 * neko XMPP 聊天服务的服务端客户端
 *
 * 聊天数据全部存在独立的 internet_neko 聊天服务里（本仓库不读写），本模块只做三件事：
 *   1. 身份换算：LineWeb 用户 ↔ neko 账号 / JID（固定偏移 + `lw_` 前缀，改名只改 displayName）
 *   2. 内部 API：账号同步、一次性票据、聊天页状态（x-internal-token 保护，绝不下发浏览器）
 *   3. 浏览器 API 透传：群管理 / 撤回 / 上传（附带可信代理身份头，路径与 neko `/chat/*` 一致）
 *
 * 所有网络失败统一映射为 503（NEKO_UNAVAILABLE），由路由转成「聊天服务暂不可用」。
 */

/** 内部 API 返回的状态载荷（只声明本服务用到的字段） */
export interface NekoStateFriend {
  id: number
  username: string
  displayName: string
  remark: string
  isAdmin: boolean
  enabled: boolean
  avatarVersion: number
  lastMessageAt: number
  online: boolean
}

export interface NekoStateUser {
  id: number
  username: string
  displayName: string
  isAdmin: boolean
  avatarVersion: number
  lastMessageAt: number
  online: boolean
}

export interface NekoStateRoomMember {
  id: number
  username: string
  displayName: string
  role: string
  mutedUntil: number
  online: boolean
  avatarVersion: number
}

export interface NekoStateRoom {
  id: number
  name: string
  isLobby: boolean
  ownerId: number
  allMuted: boolean
  announcement: string
  announcementUpdatedAt: number
  myRole: string | null
  mutedUntil: number
  notifyMuted: boolean
  lastMessageAt: number
  members: NekoStateRoomMember[]
}

export interface NekoStateFriendRequest {
  requestId: number
  userId: number
  username: string
  displayName: string
  isAdmin: boolean
  /** neko 侧时间戳（毫秒）或 ISO 字符串，读取时两种都兼容 */
  createdAt: number | string
  /** neko 头像版本号（老响应可能没有） */
  avatarVersion?: number
}

/** 个人表情包（收藏的聊天图片） */
export interface NekoSticker {
  id: number
  /** 归一化后的图片地址：`/chat/uploads/<24hex>` */
  url: string
  mime: string
}

export interface NekoState {
  domain: string
  mucDomain: string
  systemUsername: string
  fileHelperUsername: string
  historyLimit: number
  friends: NekoStateFriend[]
  friendRequestsIn: NekoStateFriendRequest[]
  friendRequestsOut: NekoStateFriendRequest[]
  stickers: NekoSticker[]
  pinnedChats: string[]
  users: NekoStateUser[]
  rooms: NekoStateRoom[]
}

/** 同步到 neko 的账号字段（与 neko /internal/account 的 accountInput 对齐） */
export interface NekoAccountInput {
  id: number
  username: string
  displayName: string
  isAdmin: boolean
  enabled: boolean
  avatarVersion: number
}

/** LineWeb 用户的最小形状（Prisma User 子集，够换算与同步即可） */
export interface LineWebUserLike {
  id: number
  username: string
  enabled?: boolean
  avatarVersion?: number
}

export interface NekoJid {
  localpart: string
  domain: string
  resource: string
}

export function isNekoChatEnabled(): boolean {
  return config.nekoChatEnabled
}

/** 聊天不可用时抛出 503（前端提示「聊天服务未配置 / 暂不可用」） */
export function assertNekoChatEnabled(): void {
  if (!config.nekoChatEnabled) {
    throw new AppError('聊天服务未配置', 503)
  }
}

// === 身份换算 ===

/** LineWeb 用户 id → neko 账号 id（neko 账号 id 必须是正整数） */
export function toNekoId(linewebId: number): number {
  return config.nekoChatAccountBase + linewebId
}

/** neko 账号 id → LineWeb 用户 id；不在映射区间（原生账号 / 系统账号）返回 null */
export function linewebIdOf(nekoId: number): number | null {
  const linewebId = nekoId - config.nekoChatAccountBase
  return Number.isInteger(nekoId) && linewebId > 0 ? linewebId : null
}

export function toNekoUsername(linewebId: number): string {
  return `${config.nekoChatUsernamePrefix}${linewebId}`
}

/** neko username → LineWeb 用户 id（非 `lw_` 前缀返回 null） */
export function linewebIdOfUsername(username: string): number | null {
  const prefix = config.nekoChatUsernamePrefix
  if (!username.startsWith(prefix)) return null
  const rest = username.slice(prefix.length)
  // 禁止前导零：neko 侧原生用户注册 `lw_01` 时不能被误认为 LineWeb 用户 1
  if (!/^[1-9]\d*$/.test(rest)) return null
  const id = Number.parseInt(rest, 10)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function isLineWebUsername(username: string): boolean {
  return linewebIdOfUsername(username) !== null
}

export function toNekoJid(linewebId: number, domain: string): string {
  return `${toNekoUsername(linewebId)}@${domain.split('/')[0]}`
}

/** 解析 `local@domain/resource`（resource 可空）；非法 JID 返回 null */
export function parseNekoJid(jid: string): NekoJid | null {
  const raw = String(jid || '').trim()
  const match = /^([^@/\s]+)@([^@/\s]+)(?:\/([^@/\s]*))?$/.exec(raw)
  if (!match) return null
  return { localpart: match[1], domain: match[2], resource: match[3] || '' }
}

export function roomJid(roomId: number, mucDomain: string): string {
  return `room-${roomId}@${mucDomain}`
}

/** 从 `room-<id>@muc.<domain>[/resource]` 取出房间 id；不匹配返回 null */
export function roomIdOfJid(jid: string): number | null {
  const parsed = parseNekoJid(jid)
  if (!parsed) return null
  const match = /^room-(\d+)$/.exec(parsed.localpart)
  if (!match) return null
  const id = Number.parseInt(match[1], 10)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** LineWeb 用户 → neko 账号同步载荷 */
export function accountPayload(user: LineWebUserLike): NekoAccountInput {
  return {
    id: toNekoId(user.id),
    username: toNekoUsername(user.id),
    displayName: user.username,
    isAdmin: false,
    enabled: user.enabled !== false,
    avatarVersion: Number(user.avatarVersion) || 0,
  }
}

/** 登录令牌 → 轮询会话哈希（neko 用它把 HTTP 长轮询会话绑定到同一次登录） */
export function sessionHashOf(token: string): string {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex').slice(0, 32)
}

// === 传输层 ===

interface NekoRequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  headers?: Record<string, string>
  timeoutMs?: number
  /** 直接返回原始响应（图片字节流） */
  raw?: boolean
}

function unavailable(err: unknown): AppError {
  const detail = err instanceof Error ? err.message : String(err)
  console.warn(`[nekoChat] 聊天服务请求失败：${detail}`)
  return new AppError('聊天服务暂不可用', 503)
}

async function request(path: string, options: NekoRequestOptions = {}): Promise<Response> {
  assertNekoChatEnabled()
  type FetchInit = NonNullable<Parameters<typeof fetch>[1]>
  type FetchBody = FetchInit['body']
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? config.nekoChatTimeoutMs)
  timeout.unref?.()
  try {
    const headers: Record<string, string> = {
      'x-internal-token': config.nekoChatToken,
      ...options.headers,
    }
    let body: FetchBody
    if (options.body === undefined) {
      // 无请求体
    } else if (Buffer.isBuffer(options.body)) {
      // 原始字节（图片上传）；Buffer 就是 Uint8Array，仅类型层面需要收窄
      body = options.body as unknown as FetchBody
    } else if (typeof options.body === 'string') {
      body = options.body
      headers['content-type'] = headers['content-type'] || 'application/json'
    } else {
      body = JSON.stringify(options.body)
      headers['content-type'] = headers['content-type'] || 'application/json'
    }
    return await fetch(`${config.nekoChatInternalUrl}${path}`, {
      method: options.method || 'GET',
      headers,
      body,
      signal: controller.signal,
    })
  } catch (err) {
    throw unavailable(err)
  } finally {
    clearTimeout(timeout)
  }
}

/** 读取上游 JSON（必要时把上游的中文错误文案透传给前端） */
async function requestJson<T>(path: string, options: NekoRequestOptions = {}): Promise<T> {
  const res = await request(path, options)
  if (!res.ok) {
    let message = ''
    try {
      const data = (await res.json()) as { error?: unknown }
      message = typeof data.error === 'string' ? data.error : ''
    } catch {
      // 上游返回非 JSON（网关错误页等），用通用文案
    }
    if (res.status >= 500) throw new AppError(message || '聊天服务暂不可用', 503)
    throw new AppError(message || '聊天服务拒绝了该请求', res.status)
  }
  try {
    return (await res.json()) as T
  } catch (err) {
    throw unavailable(err)
  }
}

// === 内部 API ===

export async function health(): Promise<{ ok: boolean; domain: string; online: number }> {
  return requestJson('/internal/health', { timeoutMs: 5000 })
}

/** 幂等创建/同步账号；kick=true 时断开该账号现有连接（改名后让客户端重连） */
export async function ensureAccount(
  user: LineWebUserLike,
  options: { kick?: boolean } = {},
): Promise<{ id: number; username: string }> {
  const payload = { ...accountPayload(user), ...(options.kick ? { kick: true } : {}) }
  const data = await requestJson<{ ok: boolean; account: { id: number; username: string } }>('/internal/account', {
    method: 'POST',
    body: payload,
  })
  return data.account
}

/** 批量同步（启动时全量对齐）；失败由调用方决定是否告警 */
export async function ensureAccounts(users: LineWebUserLike[]): Promise<number> {
  const data = await requestJson<{ ok: boolean; count: number }>('/internal/accounts', {
    method: 'POST',
    body: { users: users.map(accountPayload) },
    timeoutMs: 30000,
  })
  return data.count
}

/** 停用 / 删除账号（聊天数据保留，仅踢线并禁止再登录） */
export async function removeAccount(nekoId: number): Promise<void> {
  await requestJson('/internal/account-remove', { method: 'POST', body: { id: nekoId } })
}

/** 签发一次性 SASL 票据（顺带完成账号注册/资料同步） */
export async function issueTicket(user: LineWebUserLike): Promise<string> {
  const data = await requestJson<{ ticket: string }>('/internal/ticket', {
    method: 'POST',
    body: accountPayload(user),
  })
  if (!data.ticket) throw new AppError('聊天票据签发失败', 503)
  return data.ticket
}

/** 聊天页完整状态（含好友/群/联系人/置顶，账号同样顺带同步） */
export async function fetchState(user: LineWebUserLike): Promise<NekoState> {
  return requestJson<NekoState>('/internal/state', {
    method: 'POST',
    body: accountPayload(user),
  })
}

// === 浏览器 API 透传（群管理 / 撤回 / 上传 / 长轮询）===

export interface BrowserApiOptions {
  user: LineWebUserLike
  /** 登录令牌指纹（neko 用它绑定 HTTP 长轮询会话） */
  sessionHash?: string
  body?: unknown
  /** 原始字节（图片上传） */
  raw?: Buffer
  contentType?: string
  timeoutMs?: number
}

/** 以「可信代理」身份调用 neko 的 /chat/* 接口 */
export async function callBrowserApi<T = unknown>(
  method: 'GET' | 'POST',
  path: string,
  options: BrowserApiOptions,
): Promise<T> {
  const headers: Record<string, string> = {
    'x-proxy-user-id': String(toNekoId(options.user.id)),
    'x-proxy-username': toNekoUsername(options.user.id),
    'x-proxy-admin': '0',
    'x-session-hash': options.sessionHash || '',
  }
  let body: unknown = options.body
  if (options.raw) {
    body = options.raw
    headers['content-type'] = options.contentType || 'application/octet-stream'
  }
  const res = await request(path, { method, headers, body, timeoutMs: options.timeoutMs })
  if (res.status === 204) return undefined as T
  if (!res.ok) {
    let message = ''
    try {
      const data = (await res.json()) as { error?: unknown }
      message = typeof data.error === 'string' ? data.error : ''
    } catch {
      // ignore
    }
    if (res.status >= 500) throw new AppError(message || '聊天服务暂不可用', 503)
    throw new AppError(message || '聊天服务拒绝了该请求', res.status)
  }
  try {
    return (await res.json()) as T
  } catch {
    return undefined as T
  }
}

/** 读取图片字节（同源中继用） */
export async function fetchUpload(
  uploadId: string,
  user: LineWebUserLike,
  sessionHash?: string,
): Promise<{ data: Buffer; mime: string } | null> {
  const res = await request(`/chat/uploads/${encodeURIComponent(uploadId)}`, {
    headers: {
      'x-proxy-user-id': String(toNekoId(user.id)),
      'x-proxy-username': toNekoUsername(user.id),
      'x-proxy-admin': '0',
      'x-session-hash': sessionHash || '',
    },
  })
  if (res.status === 404) return null
  if (!res.ok) throw new AppError('图片读取失败', res.status >= 500 ? 503 : res.status)
  const mime = res.headers.get('content-type') || 'application/octet-stream'
  const data = Buffer.from(await res.arrayBuffer())
  return { data, mime }
}

/** 读取 neko 头像字节（同源头像中继用）；账号没有头像返回 null */
export async function fetchAvatar(
  nekoId: number,
  user: LineWebUserLike,
  sessionHash?: string,
): Promise<{ data: Buffer; mime: string } | null> {
  const res = await request(`/chat/avatars/${encodeURIComponent(String(nekoId))}`, {
    headers: {
      'x-proxy-user-id': String(toNekoId(user.id)),
      'x-proxy-username': toNekoUsername(user.id),
      'x-proxy-admin': '0',
      'x-session-hash': sessionHash || '',
    },
  })
  if (res.status === 404) return null
  if (!res.ok) throw new AppError('头像读取失败', res.status >= 500 ? 503 : res.status)
  const mime = res.headers.get('content-type') || 'application/octet-stream'
  const data = Buffer.from(await res.arrayBuffer())
  return { data, mime }
}

/**
 * 把 LineWeb 头像同步到 neko（best-effort）。
 *
 * neko 头像存的是 `<200KB` 的 png/jpeg/webp dataURL；LineWeb 上传链路已经用 sharp
 * 压成 256×256 WebP，这里只做 base64 包装。同步失败不影响 LineWeb 头像本身，
 * 聊天页会回退到 LineWeb 头像（`lw_*` 账号）。
 */
export async function syncAvatarToNeko(
  linewebUserId: number,
  avatar: Buffer | null,
): Promise<void> {
  if (!isNekoChatEnabled()) return
  try {
    await requestJson('/internal/avatar', {
      method: 'POST',
      body: {
        id: toNekoId(linewebUserId),
        avatar: avatar && avatar.length > 0
          ? `data:image/webp;base64,${avatar.toString('base64')}`
          : null,
      },
      timeoutMs: 8000,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.warn(`[nekoChat] 同步聊天头像失败（user=${linewebUserId}）：${detail}`)
  }
}

/**
 * 删除 neko 侧的好友关系（best-effort）。
 *
 * LineWeb 的好友关系以 Prisma 为准；但同一个 `lw_*` 账号也可能用 neko 原生客户端登录，
 * neko 侧可能残留好友行，因此删除 LineWeb 好友时顺带清一次。失败只记日志、不影响主流程。
 */
export async function removeFriendOnNeko(
  linewebUserId: number,
  targetNekoId: number,
): Promise<void> {
  if (!isNekoChatEnabled()) return
  try {
    await callBrowserApi('POST', '/chat/friends/remove', {
      user: { id: linewebUserId, username: toNekoUsername(linewebUserId) },
      body: { userId: targetNekoId },
      timeoutMs: 5000,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.warn(
      `[nekoChat] 清理 neko 好友关系失败（user=${linewebUserId} → ${targetNekoId}）：${detail}`,
    )
  }
}

export interface NekoImportFriendship {
  requesterId: number
  addresseeId: number
  requesterRemark?: string
  addresseeRemark?: string
  createdAt?: number
}

/**
 * 幂等补齐 neko accepted 好友关系（用于 LineWeb 好友在 neko 侧没有行的情况）。
 * neko 的 import 只在关系不存在时插入，不会覆盖已有备注。
 */
export async function importFriendships(items: NekoImportFriendship[]): Promise<void> {
  if (items.length === 0) return
  await requestJson('/internal/import', {
    method: 'POST',
    body: { friendships: items },
    timeoutMs: 8000,
  })
}

/** 设置联系人备注（仅自己可见；成功后 neko 会给当前用户所有在线端发 friend-update） */
export async function setFriendRemarkOnNeko(
  user: LineWebUserLike,
  targetNekoId: number,
  remark: string,
): Promise<void> {
  await callBrowserApi('POST', '/chat/friends/remark', {
    user,
    body: { userId: targetNekoId, remark },
    timeoutMs: 5000,
  })
}
