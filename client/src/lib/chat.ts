import type { Conversation, Message } from '../types/chat'

const API_SUFFIX = /\/api\/?$/
const TRAILING_SLASHES = /\/+$/

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
