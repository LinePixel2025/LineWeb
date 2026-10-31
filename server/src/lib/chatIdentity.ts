/**
 * 自建聊天的身份换算与 JID 约定（前端 lib/xmpp/protocol.ts 的服务端对偶）
 *
 * 前端硬契约（不可变更，否则 localStorage 未读水位与会话键全部失效）：
 *   - nekoId = CHAT_ACCOUNT_BASE + LineWeb 用户 id（会话键 `u<nekoId>` / `r<roomId>`）
 *   - 用户名 = `lw_<LineWeb 用户 id>`（JID localpart；裸 id，不带偏移）
 *   - 群 JID = `room-<会话 id>@<MUC_DOMAIN>[/<发送者用户名>]`
 *   - 上传 id = 24 位小写 hex（地址 `/chat/uploads/<24hex>`）
 */

import crypto from 'crypto'

/** LineWeb 用户 id → 联系人 id（原 neko 账号 id；前端只认这个键空间） */
export const CHAT_ACCOUNT_BASE = 1_000_000_000_000
/** LineWeb 用户在聊天侧的用户名前缀（JID localpart = `lw_<LineWeb id>`） */
export const CHAT_USERNAME_PREFIX = 'lw_'
/** 单聊域与群聊域（仅在本服务内部流转；bootstrap 下发后前端原样回传） */
export const CHAT_DOMAIN = 'lineweb'
export const CHAT_MUC_DOMAIN = 'muc.lineweb'
/** 历史分页大小（前端 NEKO_PAGE_SIZE 一致） */
export const CHAT_HISTORY_LIMIT = 30
/** 撤回时限（前端 RECALL_WINDOW_MS 一致） */
export const CHAT_RECALL_WINDOW_MS = 5 * 60 * 1000
/** 单条消息正文上限（前端输入框 2000 字） */
export const CHAT_MESSAGE_MAX_LENGTH = 2000
/** 群成员上限（含群主） */
export const CHAT_GROUP_MEMBER_LIMIT = 50
/** 合并转发最多条数（前端 forward 扩展 30 条一致） */
export const CHAT_FORWARD_MAX = 30
/** 合并转发快照体积上限（neko 口径 64KB） */
export const CHAT_BUNDLE_MAX_BYTES = 64 * 1024
/** 群公告上限（与前端公告编辑框一致） */
export const CHAT_ANNOUNCEMENT_MAX = 500

export function toNekoId(linewebId: number): number {
  return CHAT_ACCOUNT_BASE + linewebId
}

/** 联系人 id → LineWeb 用户 id；不在映射区间返回 null */
export function linewebIdOf(nekoId: number): number | null {
  if (!Number.isInteger(nekoId)) return null
  const linewebId = nekoId - CHAT_ACCOUNT_BASE
  return linewebId > 0 ? linewebId : null
}

/** LineWeb 用户 id → 聊天用户名（`lw_<id>`；禁前导零） */
export function toNekoUsername(linewebId: number): string {
  return `${CHAT_USERNAME_PREFIX}${linewebId}`
}

/** 聊天用户名 → LineWeb 用户 id；非 `lw_` 前缀 / 前导零 / 非法数字返回 null */
export function linewebIdOfUsername(username: string): number | null {
  const value = String(username || '')
  if (!value.startsWith(CHAT_USERNAME_PREFIX)) return null
  const rest = value.slice(CHAT_USERNAME_PREFIX.length)
  if (!/^[1-9]\d*$/.test(rest)) return null
  const id = Number.parseInt(rest, 10)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** 解析 `local@domain/resource`（resource 可空）；非法 JID 返回 null */
export interface ChatJid {
  localpart: string
  domain: string
  resource: string
}

export function parseChatJid(jid: string): ChatJid | null {
  const raw = String(jid || '').trim()
  const match = /^([^@/\s]+)@([^@/\s]+)(?:\/([^@/\s]*))?$/.exec(raw)
  if (!match) return null
  return { localpart: match[1], domain: match[2], resource: match[3] || '' }
}

export function directJidOf(linewebId: number): string {
  return `${toNekoUsername(linewebId)}@${CHAT_DOMAIN}`
}

export function roomJidOf(conversationId: number): string {
  return `room-${conversationId}@${CHAT_MUC_DOMAIN}`
}

/** 群 JID 中的发言人形式：`room-<id>@muc/<用户名>` */
export function roomJidWithResource(conversationId: number, linewebId: number): string {
  return `${roomJidOf(conversationId)}/${toNekoUsername(linewebId)}`
}

/** `room-<id>@…[/res]` → 会话 id；非群 JID 返回 null */
export function conversationIdOfRoomJid(jid: string): number | null {
  const parsed = parseChatJid(jid)
  if (!parsed) return null
  const match = /^room-(\d+)$/.exec(parsed.localpart)
  if (!match) return null
  const id = Number.parseInt(match[1], 10)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** 24 位小写 hex 上传 id（前端 uploadIdOf 只认这个格式） */
export function newUploadId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 24)
}

const UPLOAD_ID_RE = /^[0-9a-f]{24}$/

export function isUploadId(value: unknown): value is string {
  return typeof value === 'string' && UPLOAD_ID_RE.test(value)
}

/** 上传文件在存储节点上的路径 */
export function uploadPathOf(uploadId: string, mime: string): string {
  const ext = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : mime === 'image/gif' ? 'gif' : 'webp'
  return `_chat/uploads/${uploadId}.${ext}`
}
