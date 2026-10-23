/**
 * 聊天模块类型定义
 *
 * 与后端 REST / WebSocket 契约保持一致：
 * - REST 响应统一包裹在具名字段中（如 { conversations }、{ messages }）
 * - WebSocket 事件统一为 { type, ...payload } 结构
 */

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

/** 单条聊天消息 */
export interface Message {
  id: number
  conversationId: number
  senderId: number
  sender: MessageSender
  content: string
  createdAt: string
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
  | { type: 'conversation:updated'; conversationId: number }
  | { type: 'conversation:removed'; conversationId: number }
  | { type: 'friend:request'; request: FriendRequestEventPayload }
  | { type: 'friend:accepted'; friend: Friend }
  | { type: 'friend:rejected'; userId: number }
  | { type: 'friend:removed'; userId: number }
  | { type: 'ping' }
  | { type: 'pong' }

/** 转发给页面订阅者的事件（心跳事件被过滤） */
export type ChatEvent = Exclude<ChatServerEvent, { type: 'ping' } | { type: 'pong' }>

/** 实时连接状态 */
export type ChatConnectionState = 'connecting' | 'open' | 'closed'

/** 事件监听器 */
export type ChatEventListener = (event: ChatEvent) => void
