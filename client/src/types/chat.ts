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
  MinecraftEditEvent,
  MinecraftStateEvent,
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
 * 聊天消息已迁移到 neko XMPP（见 XmppChatContext），这里只剩好友关系与游戏事件。
 * ping / pong 为心跳，ChatProvider 内部处理，不会转发给页面订阅者。
 */
export type ChatServerEvent =
  | { type: 'auth_ok' }
  | { type: 'friend:request'; request: FriendRequestEventPayload }
  | { type: 'friend:accepted'; friend: Friend }
  | { type: 'friend:rejected'; userId: number }
  | { type: 'friend:removed'; userId: number }
  | { type: 'game:invite'; invite: GameInvite }
  | { type: 'game:invite:removed'; inviteId: number; reason: GameInviteRemovalReason }
  | { type: 'game:match:started'; match: AnyGameMatch }
  | { type: 'game:match:update'; match: AnyGameMatch }
  | { type: 'game:match:ended'; match: AnyGameMatch }
  | MinecraftStateEvent
  | MinecraftEditEvent
  | { type: 'ping' }
  | { type: 'pong' }

/** 转发给页面订阅者的事件（心跳事件被过滤） */
export type ChatEvent = Exclude<ChatServerEvent, { type: 'ping' } | { type: 'pong' }>

/** 实时连接状态 */
export type ChatConnectionState = 'connecting' | 'open' | 'closed'

/** 事件监听器 */
export type ChatEventListener = (event: ChatEvent) => void

// === neko XMPP 聊天（数据层已迁移；旧类型保留供游戏与历史代码引用） ===

/** 单条消息（neko 存证 id 全局唯一） */
export interface NekoMessage {
  /** neko 消息 id（用于历史分页、去重、撤回） */
  id: number
  /** 所属会话键：单聊 u<nekoId> / 群聊 r<roomId> */
  key: string
  /** 发送者完整 JID */
  from: string
  /** 发送者用户名（lw_<id> 或 neko 原生用户名） */
  fromUsername: string
  /** 发送者 neko id（由上下文补齐；未知时为 null） */
  fromNekoId: number | null
  /** 接收方 JID（群聊为空串） */
  to: string
  /** 群聊 id（单聊为 null） */
  roomId: number | null
  /** 发送时间（毫秒时间戳） */
  ts: number
  body: string
  mine: boolean
  recalled: boolean
  /** 被群主/管理员撤回 */
  byAdmin: boolean
  /** 图片地址（已归一化为 /chat/uploads/<id>，渲染时再追加 token） */
  image: string | null
}

/** 联系人（LineWeb 好友 / 有往来的 neko 原生账号） */
export interface NekoContact {
  key: string
  nekoId: number
  /** LineWeb 用户 id；neko 原生账号为 null */
  linewebId: number | null
  username: string
  displayName: string
  kind: 'lineweb' | 'native'
  online: boolean
  /** 最近消息时间（毫秒），0 表示没有往来 */
  lastMessageAt: number
  isFriend: boolean
  remark: string
}

export interface NekoRoomMember {
  nekoId: number
  linewebId: number | null
  username: string
  displayName: string
  role: 'owner' | 'admin' | 'member' | string
  online: boolean
  kind: 'lineweb' | 'native'
}

export interface NekoRoom {
  key: string
  id: number
  name: string
  ownerId: number
  myRole: string
  allMuted: boolean
  announcement: string
  notifyMuted: boolean
  lastMessageAt: number
  members: NekoRoomMember[]
}

export interface NekoSelf {
  nekoId: number
  linewebId: number
  username: string
  displayName: string
}

/** 好友申请（LineWeb Prisma 或 neko 好友系统；source 决定接受/拒绝走哪套接口） */
export interface NekoFriendRequest {
  id: number
  source: 'lineweb' | 'neko'
  /** LineWeb 用户 id；neko 原生账号为 null */
  linewebId: number | null
  nekoId: number
  username: string
  displayName: string
  createdAt: string
}

/** 表情包（neko 收藏的聊天图片） */
export interface NekoSticker {
  id: number
  /** 归一化地址 `/chat/uploads/<24hex>`，渲染时再追加登录令牌 */
  url: string
  mime: string
}

/** GET /api/chat/xmpp/bootstrap 的响应 */
export interface NekoBootstrap {
  ticket: string
  domain: string
  mucDomain: string
  historyLimit: number
  wsPath: string
  self: NekoSelf
  friends: NekoContact[]
  contacts: NekoContact[]
  requestsIn: NekoFriendRequest[]
  requestsOut: NekoFriendRequest[]
  stickers: NekoSticker[]
  rooms: NekoRoom[]
  pinnedChats: string[]
}

/** GET /api/chat/xmpp/state 的响应（无 ticket） */
export type NekoStateView = Omit<NekoBootstrap, 'ticket' | 'wsPath'>

/** GET /api/chat/xmpp/directory、/users 的条目 */
export interface NekoDirectoryUser {
  nekoId: number
  linewebId: number | null
  username: string
  displayName: string
  isLineWeb: boolean
  online: boolean
  lastMessageAt: number
}

/**
 * 全局新消息提示（任意页面右下角弹出，包括游戏对局中）
 *
 * 由 XmppChatContext 在收到「非当前会话」的实时消息时生成，
 * 同一会话 10 秒内多条只累加 count，避免连发消息刷屏。
 */
export interface NekoMessageNotice {
  /** 会话键（点击后跳转 /chat/<key>） */
  key: string
  kind: 'direct' | 'room'
  /** 发送者显示名 */
  fromName: string
  /** 发送者头像用 id（原生 neko 账号取 nekoId，群聊取负数避免与用户撞色） */
  avatarId: number
  /** 会话标题（群名 / 对方显示名） */
  title: string
  /** 正文预览：图片与表情已归一为占位文字 */
  preview: string
  /** 图片消息缩略图（已追加登录令牌；非图片为 null） */
  image: string | null
  /** 最新一条消息时间（毫秒） */
  ts: number
  /** 前端收到提示的时间（用于同会话聚合与自动消失，不展示） */
  receivedAt: number
  /** 聚合条数（同一会话连续消息累加） */
  count: number
}

/** 聊天页的会话聚合（联系人 + 群 + 最近消息 + 未读） */
export interface NekoConversation {
  key: string
  kind: 'direct' | 'room'
  title: string
  /** 头像用的用户 id（LineWeb 用户取 id，原生账号取 nekoId 负数域不会命中头像 → 首字母兜底） */
  avatarId: number
  avatarName: string
  contact: NekoContact | null
  room: NekoRoom | null
  lastMessage: NekoMessage | null
  lastMessageAt: number
  unread: number
  pinned: boolean
  online: boolean
  /** 群成员（仅群聊） */
  members: NekoRoomMember[]
  /** 私聊对象是否为好友（非好友仍可发消息，仅提示） */
  isFriend: boolean
  canSend: boolean
}

