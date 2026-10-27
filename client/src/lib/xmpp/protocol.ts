/**
 * neko XMPP 聊天的纯函数协议层
 *
 * 只做字符串 / DOM 层面的解析与换算，不发起任何网络请求，便于单元测试。
 * 术语：
 *   - 单聊 JID：`lw_<linewebId>@<domain>`（LineWeb 用户）/ `<username>@<domain>`（neko 原生用户）
 *   - 群聊 JID：`room-<roomId>@muc.<domain>[/<username>]`
 *   - 会话键：单聊 `u<nekoId>`、群聊 `r<roomId>`（原生联系人与 LineWeb 好友共用同一键空间）
 */

import type { NekoMessage } from '../../types/chat'

/** LineWeb 用户在 neko 侧的用户名前缀（与服务端 NEKO_CHAT_USERNAME_PREFIX 保持一致） */
export const NEKO_USERNAME_PREFIX = 'lw_'

export interface XmppElement {
  name: string
  attrs: Record<string, string>
  children: XmppElement[]
  text: string
  /** 序列化后的 XML（保留 XHTML-IM 内部标记） */
  xml: string
}

/** XML 文本转义（属性与文本共用） */
export function escXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function toObj(node: Element): XmppElement {
  const attrs: Record<string, string> = {}
  for (const attr of Array.from(node.attributes)) attrs[attr.name] = attr.value
  const children: XmppElement[] = []
  for (const child of Array.from(node.children)) children.push(toObj(child))
  return {
    name: node.localName,
    attrs,
    children,
    text: node.textContent ?? '',
    xml: new XMLSerializer().serializeToString(node),
  }
}

/**
 * 解析一帧（RFC 7395 每帧一个完整 stanza）。
 *
 * 用 `<wrap>` 包一层再解析：即使一帧内出现多个顶层元素也能全部取出；
 * 解析失败返回 []（坏帧直接丢弃，等待下一帧）。
 */
export function parseStanza(text: string): XmppElement[] {
  const raw = String(text || '').trim()
  if (!raw) return []
  try {
    const doc = new DOMParser().parseFromString(`<wrap>${raw}</wrap>`, 'text/xml')
    if (doc.querySelector('parsererror')) return []
    const root = doc.documentElement
    return Array.from(root.children).map(toObj)
  } catch {
    return []
  }
}

// === 身份与 JID ===

/** LineWeb 用户 id → neko 用户名 */
export function usernameOfNekoId(nekoId: number): string {
  return `${NEKO_USERNAME_PREFIX}${nekoId}`
}

/** `lw_<id>` → LineWeb 用户 id；其他用户名返回 null（拒绝前导零，避免冒充） */
export function linewebIdOfUsername(username: string): number | null {
  const value = String(username || '')
  if (!value.startsWith(NEKO_USERNAME_PREFIX)) return null
  const rest = value.slice(NEKO_USERNAME_PREFIX.length)
  if (!/^[1-9]\d*$/.test(rest)) return null
  const id = Number.parseInt(rest, 10)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** 单聊 JID 的 localpart（资源部分忽略） */
export function localpartOfJid(jid: string): string {
  const value = String(jid || '').trim()
  const withoutResource = value.split('/')[0]
  return withoutResource.split('@')[0] || ''
}

/** 单聊 JID → neko 账号用户名 */
export function usernameOfJid(jid: string): string {
  return localpartOfJid(jid)
}

/** `room-<id>@muc…[/resource]` → 房间 id；非群 JID 返回 null */
export function roomIdOfJid(jid: string): number | null {
  const match = /^room-(\d+)@/.exec(String(jid || '').trim())
  if (!match) return null
  const id = Number.parseInt(match[1], 10)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** 群 JID 中携带的发言人（resource） */
export function resourceOfJid(jid: string): string {
  const value = String(jid || '')
  const index = value.indexOf('/')
  return index >= 0 ? value.slice(index + 1) : ''
}

export function directJidOf(username: string, domain: string): string {
  return `${username}@${domain}`
}

export function roomJidOf(roomId: number, mucDomain: string): string {
  return `room-${roomId}@${mucDomain}`
}

/** 会话键：单聊 u<nekoId> / 群聊 r<roomId> */
export function directKeyOf(nekoId: number): string {
  return `u${nekoId}`
}

export function roomKeyOf(roomId: number): string {
  return `r${roomId}`
}

// === 图片 ===

const UPLOAD_SRC_RE = /\/chat\/uploads\/([0-9a-f]{24})$/

/** 从上传地址中取 24 位 id（非上传地址返回 null） */
export function uploadIdOf(src: string): string | null {
  const match = UPLOAD_SRC_RE.exec(String(src || '').split('?')[0])
  return match ? match[1] : null
}

/**
 * 从 stanza 的 XML 中提取图片地址（只认 `/chat/uploads/<24hex>`）。
 *
 * 正文（body）中的 `<` 已被转义成 `&lt;`，因此正则只可能命中真实的 XHTML 图片元素；
 * 外部图片一律忽略，避免消息里出现第三方追踪像素。
 */
export function extractImageSrc(xml: string): string | null {
  const regex = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(String(xml || ''))) !== null) {
    const src = match[1].replace(/&amp;/g, '&')
    const id = uploadIdOf(src)
    if (id) return `/chat/uploads/${id}`
  }
  return null
}

/**
 * 取 `<html>` 子节点的文本（XHTML-IM）。
 *
 * neko 的历史查询把 XHTML 当**转义文本**塞进 `<html>`（`msg.c('html').t(row.xhtml)`），
 * DOM 解析后 `.text` 就是还原好的 XHTML 字符串；实时消息则直接是元素结构。
 * 两条路径都要能提取图片，因此历史解析需要这个回退。
 */
export function xhtmlTextOf(el: XmppElement): string {
  return el.children.find((child) => child.name === 'html')?.text ?? ''
}

/** 给 `/chat/uploads/<id>` 追加登录令牌（`<img>` 无法带 Authorization 头） */
export function withToken(src: string, token: string): string {
  const id = uploadIdOf(src)
  if (!id) return src
  const suffix = token ? `?token=${encodeURIComponent(token)}` : '?token='
  return `/chat/uploads/${id}${suffix}`
}

// === 未读水位（客户端统计；neko 没有未读查询接口）===

export const READ_STORAGE_PREFIX = 'lineweb_neko_read:'

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage ?? null
  } catch {
    return null
  }
}

export function readWatermark(key: string): number {
  try {
    const raw = storage()?.getItem(`${READ_STORAGE_PREFIX}${key}`)
    const value = Number.parseInt(raw || '0', 10)
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

export function writeWatermark(key: string, messageId: number): void {
  try {
    storage()?.setItem(`${READ_STORAGE_PREFIX}${key}`, String(Math.max(0, Math.trunc(messageId))))
  } catch {
    // 隐私模式下写入被拒绝：本次按已读处理即可
  }
}

// === 消息解析 ===

export interface ParseContext {
  /** 自己的 neko 用户名（`lw_<id>`） */
  selfUsername: string
  /** 群聊域名（用于拼 room JID） */
  mucDomain: string
  /** 解析出的消息归属哪个会话键 */
  key: string
  /** 群聊 id（单聊为 null） */
  roomId: number | null
  /** 当前时间（live 消息无时间戳时的兜底） */
  now?: number
}

function bodyOf(el: XmppElement): string {
  return el.children.find((child) => child.name === 'body')?.text ?? ''
}

function delayStamp(el: XmppElement): number {
  const delay = el.children.find((child) => child.name === 'delay')
  const stamp = delay?.attrs.stamp ? Date.parse(delay.attrs.stamp) : Number.NaN
  return Number.isNaN(stamp) ? 0 : stamp
}

/** 实时投递的 `<message>` → NekoMessage；无正文（已读标记等）返回 null */
export function parseLiveMessage(
  el: XmppElement,
  context: ParseContext,
): NekoMessage | null {
  if (el.name !== 'message') return null
  const type = el.attrs.type || 'normal'
  if (type !== 'chat' && type !== 'normal' && type !== 'groupchat') return null

  const isRoom = type === 'groupchat'
  const body = bodyOf(el)
  if (!body) return null

  const from = el.attrs.from || ''
  const fromUsername = isRoom ? resourceOfJid(from) || localpartOfJid(from) : localpartOfJid(from)
  const mine = fromUsername.toLowerCase() === context.selfUsername.toLowerCase()
  const recalled = el.attrs.recalled === '1'
  const id = Number.parseInt(el.attrs.id || '0', 10) || 0
  const ts = delayStamp(el) || context.now || Date.now()

  return {
    id,
    key: context.key,
    from,
    fromUsername,
    fromNekoId: null,
    to: el.attrs.to || '',
    roomId: isRoom ? context.roomId : null,
    ts,
    body: recalled ? '消息已撤回' : body,
    mine,
    recalled,
    byAdmin: el.attrs.byAdmin === '1',
    image: recalled ? null : extractImageSrc(el.xml),
  }
}

/** 历史查询结果 `<query>` 中的 `<msg>` 行 → NekoMessage[] */
export function parseHistoryMessages(
  query: XmppElement | null,
  context: ParseContext,
): { messages: NekoMessage[]; complete: boolean; peerRead: number } {
  if (!query || query.name !== 'query') return { messages: [], complete: true, peerRead: 0 }
  const messages: NekoMessage[] = []
  for (const row of query.children) {
    if (row.name !== 'msg') continue
    const id = Number.parseInt(row.attrs.id || '0', 10) || 0
    if (!id) continue
    const mine = row.attrs.mine === '1'
    const recalled = row.attrs.recalled === '1'
    const from = row.attrs.from || ''
    const isRoom = !!(row.attrs.room || context.roomId)
    const fromUsername = isRoom ? resourceOfJid(from) || localpartOfJid(from) : localpartOfJid(from)
    messages.push({
      id,
      key: context.key,
      from,
      fromUsername,
      fromNekoId: null,
      to: row.attrs.to || '',
      roomId: context.roomId,
      ts: Number.parseInt(row.attrs.ts || '0', 10) || 0,
      body: recalled ? '消息已撤回' : bodyOf(row),
      mine,
      recalled,
      byAdmin: row.attrs.byAdmin === '1',
      // 历史行里的 XHTML 是转义文本（见 xhtmlTextOf），必须两条路径都试
      image: recalled ? null : extractImageSrc(row.xml) || extractImageSrc(xhtmlTextOf(row)),
    })
  }
  return {
    messages,
    complete: query.attrs.complete === '1',
    peerRead: Math.max(Number.parseInt(query.attrs.read || '0', 10) || 0, 0),
  }
}

/** headline 事件（撤回 / 好友 / 群变更） */
export interface HeadlineEvent {
  event: string
  roomId: number | null
  msgId: number
  byAdmin: boolean
  peer: string
  from: string
}

export function parseHeadline(el: XmppElement): HeadlineEvent | null {
  if (el.name !== 'message' || el.attrs.type !== 'headline') return null
  const x = el.children.find((child) => child.name === 'x')
  if (!x) return null
  const event = String(x.attrs.event || '')
  if (!event) return null
  return {
    event,
    roomId: roomIdOfJid(el.attrs.from || ''),
    msgId: Number.parseInt(x.attrs.msgId || '0', 10) || 0,
    byAdmin: x.attrs.byAdmin === '1',
    peer: String(x.attrs.peer || ''),
    from: el.attrs.from || '',
  }
}

/** 在线状态变化（presence）→ 用户名 + 是否在线 */
export function parsePresence(el: XmppElement): { username: string; online: boolean } | null {
  if (el.name !== 'presence') return null
  const username = localpartOfJid(el.attrs.from || '')
  if (!username) return null
  return { username, online: el.attrs.type !== 'unavailable' }
}
