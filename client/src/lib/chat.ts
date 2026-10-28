/**
 * 聊天工具函数
 *
 * 消息与会话已迁移到 neko XMPP 服务（见 `lib/xmpp/`），本文件只保留与后端无关的
 * 展示 / 排序 / 撤回判断等纯函数。`getChatWsUrl` 仍供游戏事件复用 `/ws/chat`。
 */

import type { NekoConversation, NekoMessage } from '../types/chat'
import { getToken } from './api'
import { localpartOfJid, withToken } from './xmpp/protocol'

const API_SUFFIX = /\/api\/?$/
const TRAILING_SLASHES = /\/+$/

/** 撤回时间窗口：5 分钟（neko 服务端固定值，文案与判断需同步） */
export const RECALL_WINDOW_MS = 5 * 60 * 1000

/** 单页消息条数（历史分页与首屏一致） */
export const NEKO_PAGE_SIZE = 30

/**
 * 游戏事件 WebSocket 地址（聊天已改走 `/ws/xmpp`，此地址仅承载 game:* 推送）。
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

/**
 * 聊天 WebSocket 地址（Express 字节级中继到 neko 的 `/xmpp-websocket`）。
 *
 * 与 `getChatWsUrl` 相同的基址推导规则，路径换成 `/ws/xmpp`，并附带登录令牌。
 */
export function getXmppWsUrl(token: string | null = getToken()): string {
  const suffix = `?token=${encodeURIComponent(token || '')}`
  const apiUrl = import.meta.env.VITE_API_URL
  if (apiUrl && /^https?:\/\//i.test(apiUrl)) {
    try {
      const url = new URL(apiUrl)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const pathname = url.pathname.replace(TRAILING_SLASHES, '').replace(API_SUFFIX, '')
      url.pathname = `${pathname}/ws/xmpp`
      url.search = ''
      url.hash = ''
      return `${url.toString()}${suffix}`
    } catch {
      // 解析失败时退回同源分支
    }
  }

  const { protocol, host } = window.location
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:'
  return `${wsProtocol}//${host}/ws/xmpp${suffix}`
}

/**
 * 未读数角标：0 → 空字符串，1-99 → 数字，>99 → '99+'
 */
export function formatUnread(count: number): string {
  if (!count || count <= 0) return ''
  if (count > 99) return '99+'
  return String(count)
}

function messageTime(message: NekoMessage): number {
  return Number.isFinite(message.ts) && message.ts > 0 ? message.ts : 0
}

/**
 * 合并消息：按 id 去重（后到的覆盖先到的），并按时间 + id 正序排序。
 */
export function mergeNekoMessages(
  existing: NekoMessage[],
  incoming: NekoMessage | NekoMessage[],
): NekoMessage[] {
  const merged = new Map<number, NekoMessage>()
  for (const message of existing) {
    if (message.id > 0) merged.set(message.id, message)
  }
  const additions = Array.isArray(incoming) ? incoming : [incoming]
  for (const message of additions) {
    if (message.id > 0) merged.set(message.id, message)
  }
  return Array.from(merged.values()).sort((a, b) => {
    const diff = messageTime(a) - messageTime(b)
    return diff !== 0 ? diff : a.id - b.id
  })
}

/** 会话键解析：`u<nekoId>` 单聊 / `r<roomId>` 群聊 */
export function parseConversationKey(
  key: string,
): { kind: 'direct'; nekoId: number } | { kind: 'room'; roomId: number } | null {
  const value = String(key || '').trim()
  const direct = /^u(\d+)$/.exec(value)
  if (direct) {
    const nekoId = Number.parseInt(direct[1], 10)
    return Number.isSafeInteger(nekoId) && nekoId > 0 ? { kind: 'direct', nekoId } : null
  }
  const room = /^r(\d+)$/.exec(value)
  if (room) {
    const roomId = Number.parseInt(room[1], 10)
    return Number.isSafeInteger(roomId) && roomId > 0 ? { kind: 'room', roomId } : null
  }
  return null
}

/** 会话键是否合法 */
export function isConversationKey(key: string): boolean {
  return parseConversationKey(key) !== null
}

/**
 * 图片消息的访问地址。
 *
 * `<img src>` 无法携带 Authorization 头，因此服务端允许用 `?token=` 登录令牌鉴权；
 * 只接受 `/chat/uploads/<24hex>`，其他地址原样返回（防止拼进外链）。
 */
export function chatImageUrl(src: string | null | undefined): string {
  if (!src) return ''
  return withToken(src, getToken() ?? '')
}

/**
 * 是否允许撤回该消息：仅本人的消息、未撤回、且距发送时间不超过 5 分钟。
 */
export function canRecall(message: NekoMessage, now: number = Date.now()): boolean {
  if (!message.mine) return false
  if (message.recalled) return false
  if (!messageTime(message)) return false
  return now - message.ts <= RECALL_WINDOW_MS
}

/**
 * 会话列表 / 最后一条消息的预览文案。
 */
export function messagePreview(message: NekoMessage): string {
  if (message.recalled) return '[已撤回]'
  if (message.poke) return '[拍一拍]'
  if (message.image) return message.body === '[表情]' ? '[表情]' : '[图片]'
  return message.body
}

/** 群聊预览前缀：`发送者：内容`；单聊不加前缀 */
export function conversationPreview(conversation: NekoConversation): string {
  const last = conversation.lastMessage
  if (!last) return '暂无消息'
  const prefix = conversation.kind === 'room' && !last.mine ? `${senderLabel(last, conversation)}：` : ''
  return `${prefix}${messagePreview(last)}`
}

/** 消息发送者显示名：单聊备注 > 群成员/联系人 displayName > 用户名 */
export function senderLabel(message: NekoMessage, conversation: NekoConversation | null): string {
  if (message.mine && conversation) return '你'
  if (
    conversation?.kind === 'direct'
    && conversation.contact
    && message.fromUsername === conversation.contact.username
  ) {
    const direct = contactLabel(conversation.contact)
    if (direct) return direct
  }
  const member = conversation?.members.find((item) => item.username === message.fromUsername)
  if (member?.displayName && member.displayName !== member.username) return member.displayName
  return message.fromUsername || localpartOfJid(message.from) || '未知用户'
}

/** 联系人的展示名（备注优先；原生账号补上 @username） */
export function contactLabel(
  contact: {
    username: string
    displayName: string
    remark?: string
    kind?: 'lineweb' | 'native'
    isLineWeb?: boolean
  } | null,
): string {
  if (!contact) return ''
  const remark = (contact.remark ?? '').trim()
  // 备注是用户自己起的名字，直接覆盖显示名，不追加原生账号标识
  if (remark) return remark
  const name = contact.displayName || contact.username
  // 只有 neko 原生账号需要补 @username 区分；lw_* 是内部用户名，不展示给用户
  const native = contact.kind === 'native' || contact.isLineWeb === false
  if (!native || name === contact.username) return name
  return `${name} (@${contact.username})`
}

/**
 * 会话排序：置顶优先（按 pinnedChats 顺序），其余按最近消息时间倒序，再按标题。
 */
export function sortNekoConversations(
  list: NekoConversation[],
  pinnedChats: string[] = [],
): NekoConversation[] {
  const pinnedIndex = new Map<string, number>()
  pinnedChats.forEach((key, index) => pinnedIndex.set(key, index))
  return [...list].sort((a, b) => {
    const aPin = pinnedIndex.get(a.key)
    const bPin = pinnedIndex.get(b.key)
    if (aPin !== undefined || bPin !== undefined) {
      if (aPin === undefined) return 1
      if (bPin === undefined) return -1
      if (aPin !== bPin) return aPin - bPin
    } else if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1
    }
    const diff = (b.lastMessageAt || 0) - (a.lastMessageAt || 0)
    if (diff !== 0) return diff
    return a.title.localeCompare(b.title, 'zh-CN')
  })
}

/** 会话未读总数（侧边栏角标） */
export function totalUnread(conversations: NekoConversation[]): number {
  return conversations.reduce((sum, conversation) => sum + Math.max(0, conversation.unread), 0)
}
