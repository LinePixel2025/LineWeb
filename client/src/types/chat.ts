/**
 * 聊天模块类型定义
 *
 * 与后端 REST / WebSocket 契约保持一致：
 * - REST 响应统一包裹在具名字段中（如 { conversations }、{ messages }）
 * - WebSocket 事件统一为 { type, ...payload } 结构
 */

import type {
  Game2048Match, AnyGameMatch,
  GameInvite,
  GameInviteRemovalReason,
} from './game'

/** 实时传输模式：WebSocket 优先，失败/不支持时降级为 HTTP 轮询 */
export type ChatTransport = 'ws' | 'polling'

/** 用户与当前登录用户的关系 */
export type ChatRelation = 'none' | 'friend' | 'outgoing' | 'incoming'

/** 聊天场景下的用户简要信息 */
export interface ChatUser {
  id: number
  username: string
  relation?: ChatRelation
}

/** 好友列表项 */
export interface Friend {
  id: number
  username: string
}

/** 好友申请事件载荷（WS 里用 from 表示申请人，REST 列表项里用 user） */
export interface FriendRequestEventPayload {
  id: number
  from?: ChatUser
  user?: ChatUser
  status?: string
  createdAt: string
}

/** 好友申请 */
export interface FriendRequest {
  id: number
  user: ChatUser
  status: 'pending' | 'accepted' | 'rejected' | string
  createdAt: string
}

/** 消息发送者 */
export interface MessageSender {
  id: number
  username: string
}

/** 消息类型：文本 / 图片 */
export type MessageType = 'text' | 'image'

/** 图片消息的附加信息（非图片消息为 null） */
export interface MessageImage {
  /** 原图宽度（服务端处理成功时提供，用于渲染时占位防跳动） */
  width: number | null
  /** 原图高度 */
  height: number | null
  /** 处理后的图片字节数（字符串，避免大数精度问题） */
  size: string | null
}

/** 单条聊天消息 */
export interface Message {
  id: number
  conversationId: number
  senderId: number
  sender: MessageSender
  /** 文本正文；图片消息与已撤回消息为 '' */
  content: string
  createdAt: string
  /** 消息类型（老数据按文本处理） */
  type: MessageType
  /** 非空表示已撤回 */
  recalledAt: string | null
  /** 图片信息，仅 type === 'image' 时非空 */
  image: MessageImage | null
}

/** 会话成员 */
export interface ConversationMember {
  id: number
  username: string
  role: 'owner' | 'member' | string
}

/** 会话（私聊 / 群聊） */
export interface Conversation {
  id: number
  type: 'direct' | 'group'
  name: string
  ownerId: number
  members: ConversationMember[]
  lastMessage: Message | null
  unreadCount: number
  lastMessageAt: string
  /** 私聊对象不是好友时为 false（服务端拒发消息） */
  canSend: boolean
}

/** GET /chat/summary */
export interface ChatSummary {
  unreadTotal: number
  pendingFriendRequests: number
}

/** GET /chat/friends */
export interface FriendsResponse {
  friends: Friend[]
}

/** GET /chat/friend-requests */
export interface FriendRequestsResponse {
  incoming: FriendRequest[]
  outgoing: FriendRequest[]
}

/** GET /chat/users/search */
export interface UserSearchResponse {
  users: ChatUser[]
}

/** GET /chat/conversations */
export interface ConversationsResponse {
  conversations: Conversation[]
}

/** GET /chat/conversations/:id/messages */
export interface MessagesResponse {
  messages: Message[]
  hasMore: boolean
}

/** POST /chat/conversations/direct | /group 的响应（兼容直接返回会话或包裹在 conversation 中） */
export interface ConversationResponse {
  conversation?: Conversation
}

/** POST /chat/conversations/:id/messages 的响应（兼容直接返回消息或包裹在 message 中） */
export interface SendMessageResponse {
  message?: Message
}

/**
 * 服务端通过 /ws/chat 推送的事件。
 * ping / pong 为心跳，ChatProvider 内部处理，不会转发给页面订阅者。
 */
export type ChatServerEvent =
  | { type: 'auth_ok' }
  | { type: 'message:new'; conversationId: number; message: Message }
  | { type: 'message:recalled'; conversationId: number; message: Message }
  | { type: 'conversation:updated'; conversationId: number }
  | { type: 'conversation:removed'; conversationId: number }
  | { type: 'friend:request'; request: FriendRequestEventPayload }
  | { type: 'friend:accepted'; friend: Friend }
  | { type: 'friend:rejected'; userId: number }
  | { type: 'friend:removed'; userId: number }
  | { type: 'game:invite'; invite: GameInvite }
  | { type: 'game:invite:removed'; inviteId: number; reason: GameInviteRemovalReason }
  | { type: 'game:match:started'; match: AnyGameMatch }
  | { type: 'game:match:update'; match: AnyGameMatch }
  | { type: 'game:match:ended'; match: AnyGameMatch }
  | { type: 'ping' }
  | { type: 'pong' }

/** 转发给页面订阅者的事件（心跳事件被过滤） */
export type ChatEvent = Exclude<ChatServerEvent, { type: 'ping' } | { type: 'pong' }>

/** 实时连接状态 */
export type ChatConnectionState = 'connecting' | 'open' | 'closed'

/** 事件监听器 */
export type ChatEventListener = (event: ChatEvent) => void
