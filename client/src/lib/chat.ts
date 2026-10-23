import type { Conversation, Message } from '../types/chat'
import { getToken } from './api'

const API_SUFFIX = /\/api\/?$/
const TRAILING_SLASHES = /\/+$/

/** 撤回时间窗口：2 分钟（与服务端一致） */
export const RECALL_WINDOW_MS = 2 * 60 * 1000

/**
 * 计算聊天 WebSocket 地址。
 *
 * 1. `VITE_API_URL` 为绝对 URL 时：http(s) → ws(s)，去掉末尾 `/api` 后拼 `/ws/chat`
 * 2. 否则使用同源地址：https → wss，http → ws，路径固定 `/ws/chat`
 */
export function getChatWsUrl(): string {
  const apiUrl = import.meta.env.VITE_API_URL
  if (apiUrl && /^https?:\/\//i.test(apiUrl)) {
    try {
      const url = new URL(apiUrl)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const pathname = url.pathname.replace(TRAILING_SLASHES, '').replace(API_SUFFIX, '')
      url.pathname = `${pathname}/ws/chat`
      url.search = ''
      url.hash = ''
      return url.toString()
    } catch {
      // 解析失败时退回同源分支
    }
  }

  const { protocol, host } = window.location
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:'
  return `${wsProtocol}//${host}/ws/chat`
}

function messageTimestamp(message: Message): number {
  const parsed = Date.parse(message.createdAt)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * 合并消息：按 id 去重（后到的覆盖先到的），并按 createdAt + id 正序排序。
 */
export function mergeMessages(list: Message[], incoming: Message | Message[]): Message[] {
  const merged = new Map<number, Message>()
  for (const message of list) merged.set(message.id, message)
  const additions = Array.isArray(incoming) ? incoming : [incoming]
  for (const message of additions) merged.set(message.id, message)
  return Array.from(merged.values()).sort((a, b) => {
    const diff = messageTimestamp(a) - messageTimestamp(b)
    return diff !== 0 ? diff : a.id - b.id
  })
}

/**
 * 未读数角标：0 → 空字符串，1-99 → 数字，>99 → '99+'
 */
export function formatUnread(count: number): string {
  if (!count || count <= 0) return ''
  if (count > 99) return '99+'
  return String(count)
}

/**
 * 会话显示名：群聊取群名，私聊取对方用户名。
 */
export function displayName(conversation: Conversation, meId: number): string {
  if (conversation.type === 'group') {
    return conversation.name || '群聊'
  }
  const other = conversation.members.find((member) => member.id !== meId)
  return other?.username || conversation.name || '私聊'
}

/**
 * 私聊会话中对方的用户 id（群聊返回 null）。
 */
export function directPartnerId(conversation: Conversation, meId: number): number | null {
  if (conversation.type !== 'direct') return null
  return conversation.members.find((member) => member.id !== meId)?.id ?? null
}

/**
 * 图片消息的访问地址。
 *
 * `<img src>` 无法携带 Authorization 头，因此服务端允许用 `?token=` 登录令牌鉴权。
 * 无 token 时仍拼出 URL（token 参数为空），由服务端返回 401。
 */
export function chatImageUrl(messageId: number): string {
  // 运行时读取环境变量，便于测试用 vi.stubEnv 覆盖；去掉末尾斜杠避免出现双斜杠
  const base = (import.meta.env.VITE_API_URL || '/api').replace(TRAILING_SLASHES, '')
  const token = getToken() ?? ''
  return `${base}/chat/messages/${messageId}/image?token=${encodeURIComponent(token)}`
}

/**
 * 是否允许撤回该消息：仅本人的消息、未撤回、且距发送时间不超过 2 分钟。
 */
export function canRecall(message: Message, meId: number, now: number = Date.now()): boolean {
  if (message.senderId !== meId) return false
  if (message.recalledAt) return false
  const createdAt = Date.parse(message.createdAt)
  if (Number.isNaN(createdAt)) return false
  return now - createdAt <= RECALL_WINDOW_MS
}

/**
 * 会话列表 / 最后一条消息的预览文案。
 */
export function messagePreview(message: Message): string {
  if (message.recalledAt) return '[已撤回]'
  if (message.type === 'image') return '[图片]'
  return message.content
}
