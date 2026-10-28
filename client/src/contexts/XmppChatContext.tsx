/**
 * neko XMPP 聊天数据层
 *
 * 浏览器只与 LineWeb 同源交互：`/api/chat/xmpp/bootstrap` 取一次性票据与过滤后的状态，
 * `/ws/xmpp`（或 `/api/chat/xmpp/http-*` 长轮询）承载 XMPP stanza。
 *
 * 本 Provider 负责：
 *   - 连接生命周期（票据过期换票重连、指数退避、WS → 长轮询降级）
 *   - 会话集合（`u<nekoId>` 单聊 / `r<roomId>` 群聊）与历史分页
 *   - 实时消息 / 撤回 / 群变更 / 在线状态
 *   - 客户端未读水位（neko 没有未读查询接口）
 *   - 发送文本 / 图片 / 表情包、撤回、群管理
 *   - 好友关系：LineWeb↔LineWeb 以 Prisma 为准，LineWeb↔neko 原生账号走 neko 好友系统，
 *     服务端把两套关系合并进 bootstrap，申请项用 `source` 区分来源
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import api, { getToken } from '../lib/api'
import {
  NEKO_PAGE_SIZE,
  chatImageUrl,
  isConversationKey,
  getXmppWsUrl,
  mergeNekoMessages,
  parseConversationKey,
  sortNekoConversations,
  totalUnread,
} from '../lib/chat'
import { XmppClient } from '../lib/xmpp/client'
import { prepareChatImage, prepareStickerImage } from '../lib/xmpp/image'
import {
  directJidOf,
  directKeyOf,
  escXml,
  localpartOfJid,
  parseHeadline,
  parseHistoryMessages,
  parseLiveMessage,
  parsePresence,
  readWatermark,
  roomIdOfJid,
  roomJidOf,
  roomKeyOf,
  writeWatermark,
  type ParseContext,
  type XmppElement,
} from '../lib/xmpp/protocol'
import { isWebSocketAvailable, readForcedPolling } from '../lib/realtime'
import { useAuth } from './AuthContext'
import { useChat } from './ChatContext'
import type {
  ChatConnectionState,
  ChatTransport,
  NekoBootstrap,
  NekoContact,
  NekoConversation,
  NekoDirectoryUser,
  NekoFriendRequest,
  NekoMessage,
  NekoMessageNotice,
  NekoRoom,
  NekoSelf,
  NekoStateView,
  NekoSticker,
} from '../types/chat'

const INITIAL_RECONNECT_DELAY = 1_000
const MAX_RECONNECT_DELAY = 30_000
/** WS 保活间隔（neko 不主动发心跳） */
const PING_INTERVAL_MS = 30_000
/** 轮询模式下刷新会话状态的间隔 */
const POLL_STATE_INTERVAL_MS = 20_000
/** 轮询模式下刷新当前会话的间隔 */
const POLL_ACTIVE_INTERVAL_MS = 15_000
/** 陌生来信反查的合并窗口 */
const LOOKUP_WINDOW_MS = 250
/** 预览预取的并发与上限（避免登录瞬间打出几十个 IQ） */
const PREVIEW_CONCURRENCY = 3
const PREVIEW_LIMIT = 40
/** 全局新消息提示：同一会话在此窗口内的多条消息只累加计数 */
const NOTICE_MERGE_WINDOW_MS = 10_000

interface HistoryMeta {
  loaded: boolean
  loading: boolean
  loadingMore: boolean
  complete: boolean
  error: string | null
}

const EMPTY_MESSAGES: NekoMessage[] = []
const DEFAULT_META: HistoryMeta = {
  loaded: false,
  loading: false,
  loadingMore: false,
  complete: false,
  error: null,
}

interface ViewState {
  domain: string
  mucDomain: string
  self: NekoSelf | null
}

interface HistoryTarget {
  to: string
  type: 'chat' | 'groupchat'
  context: ParseContext
}

export interface XmppChatValue {
  connectionState: ChatConnectionState
  transport: ChatTransport
  /** 首次 bootstrap 尚未返回 */
  loading: boolean
  error: string | null
  self: NekoSelf | null
  conversations: NekoConversation[]
  contacts: NekoContact[]
  friends: NekoContact[]
  rooms: NekoRoom[]
  incoming: NekoFriendRequest[]
  outgoing: NekoFriendRequest[]
  unreadTotal: number
  activeKey: string | null
  setActiveKey: (key: string | null) => void
  messages: NekoMessage[]
  messagesLoading: boolean
  messagesLoadingMore: boolean
  messagesHasMore: boolean
  messagesError: string | null
  loadMore: (key: string) => void
  /** 发送文本；replyTo 为被引用消息 id（neko 会快照原文并校验同会话） */
  sendText: (key: string, text: string, replyTo?: number) => Promise<void>
  sendImage: (key: string, file: File) => Promise<void>
  /**
   * 转发聊天记录：
   *   - merge：合并转发（服务端生成快照卡片）；neko 按「目标会话」校验快照来源，
   *     因此只能转发回原会话，跨会话请用 separate
   *   - separate：逐条转发（按原消息内容重新发送，可发往任意会话）
   */
  forwardMessages: (
    sourceKey: string,
    messageIds: number[],
    targetKeys: string[],
    mode: 'merge' | 'separate',
  ) => Promise<void>
  /** 发送表情包（与图片消息同构，body 固定 [表情]） */
  sendSticker: (key: string, sticker: NekoSticker) => void
  /** 收藏图片为表情（自动压到 360px PNG） */
  addSticker: (file: File) => Promise<void>
  removeSticker: (id: number) => Promise<void>
  recallMessage: (key: string, messageId: number, admin?: boolean) => Promise<void>
  /** 打开/创建单聊，返回会话键 */
  startDirect: (target: NekoContact | NekoDirectoryUser) => string
  createGroup: (name: string, memberNekoIds: number[]) => Promise<string>
  addMembers: (roomId: number, memberNekoIds: number[]) => Promise<void>
  removeMember: (roomId: number, nekoId: number) => Promise<void>
  renameRoom: (roomId: number, name: string) => Promise<void>
  leaveRoom: (roomId: number) => Promise<void>
  disbandRoom: (roomId: number) => Promise<void>
  acceptRequest: (request: NekoFriendRequest) => Promise<void>
  rejectRequest: (request: NekoFriendRequest) => Promise<void>
  addFriend: (linewebId: number) => Promise<void>
  /** 向 neko 原生账号发起好友申请 */
  addNativeFriend: (nekoId: number) => Promise<void>
  removeFriend: (contact: NekoContact) => Promise<void>
  searchDirectory: (query: string) => Promise<NekoDirectoryUser[]>
  refresh: () => Promise<void>
  stickers: NekoSticker[]
  /** 全局新消息提示（仅非当前会话的实时消息；点击/自动消失后清空） */
  messageNotice: NekoMessageNotice | null
  dismissMessageNotice: () => void
}

const XmppChatContext = createContext<XmppChatValue | null>(null)

function toContact(user: NekoDirectoryUser): NekoContact {
  return {
    key: directKeyOf(user.nekoId),
    nekoId: user.nekoId,
    linewebId: user.linewebId,
    username: user.username,
    displayName: user.displayName,
    kind: user.isLineWeb ? 'lineweb' : 'native',
    online: user.online,
    lastMessageAt: user.lastMessageAt,
    isFriend: false,
    remark: '',
    avatarVersion: user.avatarVersion ?? 0,
  }
}

function makeDirectConversation(
  contact: NekoContact,
  pinned: Set<string>,
): NekoConversation {
  return {
    key: contact.key,
    kind: 'direct',
    title: contact.displayName || contact.username,
    avatarId: contact.linewebId ?? -contact.nekoId,
    avatarName: contact.displayName || contact.username,
    avatarNekoId: contact.nekoId,
    avatarVersion: contact.avatarVersion || 0,
    contact,
    room: null,
    lastMessage: null,
    lastMessageAt: contact.lastMessageAt || 0,
    unread: 0,
    pinned: pinned.has(contact.key),
    online: contact.online,
    members: [],
    isFriend: contact.isFriend,
    canSend: true,
  }
}

function makeRoomConversation(room: NekoRoom, pinned: Set<string>): NekoConversation {
  const muted = room.allMuted && room.myRole !== 'owner' && room.myRole !== 'admin'
  return {
    key: room.key,
    kind: 'room',
    title: room.name || '群聊',
    avatarId: -room.id,
    avatarName: room.name || '群聊',
    avatarNekoId: null,
    avatarVersion: 0,
    contact: null,
    room,
    lastMessage: null,
    lastMessageAt: room.lastMessageAt || 0,
    unread: 0,
    pinned: pinned.has(room.key),
    online: false,
    members: room.members,
    isFriend: true,
    canSend: !muted,
  }
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export function XmppChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  // 好友申请的角标仍由 Prisma 侧的 /ws/chat 负责，接受/拒绝后需要同步
  const { refreshSummary } = useChat()

  const [connectionState, setConnectionState] = useState<ChatConnectionState>('closed')
  const [transport, setTransport] = useState<ChatTransport>('polling')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [self, setSelf] = useState<NekoSelf | null>(null)
  const [conversations, setConversations] = useState<NekoConversation[]>([])
  const [contacts, setContacts] = useState<NekoContact[]>([])
  const [rooms, setRooms] = useState<NekoRoom[]>([])
  const [incoming, setIncoming] = useState<NekoFriendRequest[]>([])
  const [outgoing, setOutgoing] = useState<NekoFriendRequest[]>([])
  const [stickers, setStickers] = useState<NekoSticker[]>([])
  const [activeKey, setActiveKeyState] = useState<string | null>(null)
  const [messagesByKey, setMessagesByKey] = useState<Record<string, NekoMessage[]>>({})
  const [historyMeta, setHistoryMeta] = useState<Record<string, HistoryMeta>>({})
  const [messageNotice, setMessageNotice] = useState<NekoMessageNotice | null>(null)

  // === 可变状态（事件回调里读，避免闭包过期）===
  const viewRef = useRef<ViewState>({ domain: '', mucDomain: '', self: null })
  const contactsRef = useRef<NekoContact[]>([])
  const contactByIdRef = useRef<Map<number, NekoContact>>(new Map())
  const contactByNameRef = useRef<Map<string, NekoContact>>(new Map())
  const roomsRef = useRef<NekoRoom[]>([])
  const conversationsRef = useRef<NekoConversation[]>([])
  const pinnedRef = useRef<string[]>([])
  const openedKeysRef = useRef<Set<string>>(new Set())
  const activeKeyRef = useRef<string | null>(null)
  const messagesRef = useRef<Record<string, NekoMessage[]>>({})
  const historyRef = useRef<Record<string, HistoryMeta>>({})
  const unreadRef = useRef<Record<string, number>>({})
  const peerReadRef = useRef<Record<string, number>>({})
  const clientRef = useRef<XmppClient | null>(null)
  const previewDoneRef = useRef<Set<string>>(new Set())
  const previewQueueRef = useRef<string[]>([])
  const previewQueuedRef = useRef<Set<string>>(new Set())
  const previewRunningRef = useRef(0)
  const lookupQueueRef = useRef<Set<string>>(new Set())
  const lookupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const commitConversations = useCallback(
    (updater: (prev: NekoConversation[]) => NekoConversation[]) => {
      const next = updater(conversationsRef.current)
      conversationsRef.current = next
      setConversations(next)
    },
    [],
  )

  const commitContacts = useCallback((list: NekoContact[]) => {
    contactsRef.current = list
    contactByIdRef.current = new Map(list.map((contact) => [contact.nekoId, contact]))
    contactByNameRef.current = new Map(list.map((contact) => [contact.username, contact]))
    setContacts(list)
  }, [])

  const commitRooms = useCallback((list: NekoRoom[]) => {
    roomsRef.current = list
    setRooms(list)
  }, [])

  const commitMessages = useCallback(
    (key: string, updater: (prev: NekoMessage[]) => NekoMessage[]) => {
      const next = mergeNekoMessages(updater(messagesRef.current[key] ?? []), [])
      messagesRef.current = { ...messagesRef.current, [key]: next }
      setMessagesByKey(messagesRef.current)
    },
    [],
  )

  const commitMeta = useCallback((key: string, patch: Partial<HistoryMeta>) => {
    const next = { ...(historyRef.current[key] ?? DEFAULT_META), ...patch }
    historyRef.current = { ...historyRef.current, [key]: next }
    setHistoryMeta(historyRef.current)
  }, [])

  const targetOf = useCallback((key: string): HistoryTarget | null => {
    const parsed = parseConversationKey(key)
    const view = viewRef.current
    if (!parsed || !view.self) return null
    if (parsed.kind === 'room') {
      const room = roomsRef.current.find((item) => item.id === parsed.roomId)
      if (!room) return null
      return {
        to: roomJidOf(room.id, view.mucDomain),
        type: 'groupchat',
        context: {
          selfUsername: view.self.username,
          mucDomain: view.mucDomain,
          key,
          roomId: room.id,
        },
      }
    }
    const contact = contactByIdRef.current.get(parsed.nekoId)
    if (!contact) return null
    return {
      to: directJidOf(contact.username, view.domain),
      type: 'chat',
      context: {
        selfUsername: view.self.username,
        mucDomain: view.mucDomain,
        key,
        roomId: null,
      },
    }
  }, [])

  // === 会话状态 ===

  const setUnread = useCallback(
    (key: string, value: number) => {
      unreadRef.current[key] = Math.max(0, value)
      commitConversations((prev) =>
        prev.map((conversation) =>
          conversation.key === key ? { ...conversation, unread: Math.max(0, value) } : conversation,
        ),
      )
    },
    [commitConversations],
  )

  /** 把最新一条消息落到会话列表（不存在则按联系人 / 房间补建） */
  const upsertFromMessage = useCallback(
    (key: string, message: NekoMessage, unread?: number) => {
      commitConversations((prev) => {
        const index = prev.findIndex((conversation) => conversation.key === key)
        const isActive = key === activeKeyRef.current
        const nextUnread =
          unread !== undefined ? unread : isActive || message.mine ? 0 : prev[index]?.unread ?? 0

        if (index >= 0) {
          const current = prev[index]
          const latest =
            !current.lastMessage || message.ts >= current.lastMessage.ts ? message : current.lastMessage
          const copy = [...prev]
          copy[index] = {
            ...current,
            lastMessage: latest,
            lastMessageAt: Math.max(current.lastMessageAt, message.ts),
            unread: nextUnread,
          }
          return sortNekoConversations(copy, pinnedRef.current)
        }

        const parsed = parseConversationKey(key)
        if (!parsed) return prev
        let created: NekoConversation | null = null
        if (parsed.kind === 'room') {
          const room = roomsRef.current.find((item) => item.id === parsed.roomId)
          if (room) created = makeRoomConversation(room, new Set(pinnedRef.current))
        } else {
          const contact = contactByIdRef.current.get(parsed.nekoId)
          if (contact) created = makeDirectConversation(contact, new Set(pinnedRef.current))
        }
        if (!created) return prev
        created.lastMessage = message
        created.lastMessageAt = Math.max(created.lastMessageAt, message.ts)
        created.unread = nextUnread
        return sortNekoConversations([created, ...prev], pinnedRef.current)
      })
    },
    [commitConversations],
  )

  /**
   * 生成全局新消息提示（仅非当前会话、非本人、非免打扰群）。
   * 同一会话 10 秒内多条只累加 count，避免连发消息刷屏。
   */
  const pushMessageNotice = useCallback((key: string, roomId: number | null, message: NekoMessage) => {
    const room = roomId ? roomsRef.current.find((item) => item.id === roomId) ?? null : null
    if (room?.notifyMuted) return
    const contact = contactByNameRef.current.get(message.fromUsername) ?? null
    const body = message.body.replace(/\s+/g, ' ').trim()
    const preview = message.image
      ? '[图片]'
      : body === '[表情]'
        ? '[表情]'
        : body.slice(0, 80) || '[消息]'
    const next: NekoMessageNotice = {
      key,
      kind: room ? 'room' : 'direct',
      fromName: contact?.displayName || contact?.username || message.fromUsername || '对方',
      avatarId: room ? -room.id : contact?.linewebId ?? contact?.nekoId ?? 0,
      avatarNekoId: room ? null : contact?.nekoId ?? null,
      avatarVersion: room ? 0 : contact?.avatarVersion ?? 0,
      title: room ? room.name : contact?.displayName || contact?.username || message.fromUsername || '聊天',
      preview,
      image: message.image ? chatImageUrl(message.image) : null,
      ts: message.ts || Date.now(),
      receivedAt: Date.now(),
      count: 1,
    }
    setMessageNotice((prev) => {
      if (prev && prev.key === key && next.receivedAt - prev.receivedAt < NOTICE_MERGE_WINDOW_MS) {
        return { ...next, count: prev.count + 1 }
      }
      return next
    })
  }, [])

  const dismissMessageNotice = useCallback(() => setMessageNotice(null), [])

  const markRead = useCallback(
    (key: string) => {
      const list = messagesRef.current[key] ?? []
      let maxId = 0
      for (const message of list) if (message.id > maxId) maxId = message.id
      if (!maxId) return
      if (maxId > readWatermark(key)) writeWatermark(key, maxId)
      if (unreadRef.current[key] !== 0) setUnread(key, 0)

      const parsed = parseConversationKey(key)
      if (parsed?.kind !== 'direct') return
      const contact = contactByIdRef.current.get(parsed.nekoId)
      const client = clientRef.current
      if (!contact || !client || !client.isOpen) return
      client.sendRead(directJidOf(contact.username, viewRef.current.domain), maxId)
    },
    [setUnread],
  )

  // === 历史分页 ===

  const fetchPage = useCallback(
    async (key: string, before?: number) => {
      const client = clientRef.current
      const target = targetOf(key)
      if (!client || !client.isOpen) throw new Error('聊天尚未连接')
      if (!target) throw new Error('会话不存在或已退出')
      const result = await client.fetchHistory({
        ...(target.type === 'groupchat' ? { roomJid: target.to } : { withJid: target.to }),
        max: NEKO_PAGE_SIZE,
        before,
      })
      return { result, parsed: parseHistoryMessages(result.query, target.context) }
    },
    [targetOf],
  )

  const loadInitial = useCallback(
    async (key: string) => {
      if (historyRef.current[key]?.loading) return
      commitMeta(key, { loading: true, error: null })
      try {
        const { result, parsed } = await fetchPage(key)
        commitMessages(key, (prev) => mergeNekoMessages(prev, parsed.messages))
        if (parsed.peerRead) peerReadRef.current[key] = parsed.peerRead
        commitMeta(key, {
          loaded: true,
          loading: false,
          complete: parsed.complete || result.rows.length < NEKO_PAGE_SIZE,
        })
        const last = parsed.messages[parsed.messages.length - 1]
        if (last) {
          const watermark = readWatermark(key)
          const unread = parsed.messages.filter((message) => !message.mine && message.id > watermark).length
          upsertFromMessage(key, last, key === activeKeyRef.current ? 0 : unread)
        }
        if (key === activeKeyRef.current) markRead(key)
      } catch (err) {
        commitMeta(key, { loading: false, error: errorText(err, '加载消息失败') })
      }
    },
    [commitMessages, commitMeta, fetchPage, markRead, upsertFromMessage],
  )

  const refreshLatest = useCallback(
    async (key: string, previewOnly = false) => {
      try {
        const { result, parsed } = await fetchPage(key)
        if (parsed.messages.length === 0) return
        commitMessages(key, (prev) => mergeNekoMessages(prev, parsed.messages))
        if (parsed.peerRead) peerReadRef.current[key] = parsed.peerRead
        commitMeta(key, {
          loaded: true,
          complete: parsed.complete || result.rows.length < NEKO_PAGE_SIZE,
          loading: false,
          error: null,
        })
        const last = parsed.messages[parsed.messages.length - 1]
        if (!previewOnly) {
          upsertFromMessage(key, last)
          return
        }
        const existingUnread = unreadRef.current[key]
        if (existingUnread === undefined || existingUnread === 0) {
          const watermark = readWatermark(key)
          const unread = parsed.messages.filter(
            (message) => !message.mine && message.id > watermark,
          ).length
          upsertFromMessage(key, last, unread)
        } else {
          upsertFromMessage(key, last)
        }
      } catch {
        // 预览失败静默忽略（打开会话时会重新拉取）
      }
    },
    [commitMessages, commitMeta, fetchPage, upsertFromMessage],
  )

  const loadMore = useCallback(
    async (key: string) => {
      const meta = historyRef.current[key] ?? DEFAULT_META
      const list = messagesRef.current[key] ?? []
      if (meta.loadingMore || meta.loading || meta.complete || list.length === 0) return
      const before = list[0]?.id
      if (!before) return
      commitMeta(key, { loadingMore: true, error: null })
      try {
        const { result, parsed } = await fetchPage(key, before)
        commitMessages(key, (prev) => mergeNekoMessages(prev, parsed.messages))
        commitMeta(key, {
          loadingMore: false,
          complete: parsed.complete || result.rows.length < NEKO_PAGE_SIZE,
        })
      } catch (err) {
        commitMeta(key, { loadingMore: false, error: errorText(err, '加载更早的消息失败') })
      }
    },
    [commitMessages, commitMeta, fetchPage],
  )

  const ensureLoaded = useCallback(
    (key: string) => {
      const meta = historyRef.current[key]
      if (meta?.loaded || meta?.loading) return
      void loadInitial(key)
    },
    [loadInitial],
  )

  // === 预览预取（未读与最后一条消息）===

  const pumpPreviewQueue = useCallback(
    function pump() {
      while (previewRunningRef.current < PREVIEW_CONCURRENCY && previewQueueRef.current.length > 0) {
        const key = previewQueueRef.current.shift()
        if (!key) break
        previewQueuedRef.current.delete(key)
        previewRunningRef.current += 1
        void refreshLatest(key, true).finally(() => {
          previewRunningRef.current -= 1
          pump()
        })
      }
    },
    [refreshLatest],
  )

  const queuePreview = useCallback(
    (key: string) => {
      if (previewQueuedRef.current.has(key)) return
      if (previewDoneRef.current.has(key)) return
      previewDoneRef.current.add(key)
      previewQueuedRef.current.add(key)
      previewQueueRef.current.push(key)
      pumpPreviewQueue()
    },
    [pumpPreviewQueue],
  )

  const ensurePreviews = useCallback(() => {
    const pinned = new Set(pinnedRef.current)
    const list = [...conversationsRef.current].sort(
      (a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0),
    )
    let count = 0
    for (const conversation of list) {
      if (count >= PREVIEW_LIMIT) break
      if (previewDoneRef.current.has(conversation.key)) continue
      if (!conversation.lastMessageAt && !pinned.has(conversation.key)) continue
      if (!conversation.lastMessageAt) continue
      count += 1
      queuePreview(conversation.key)
    }
  }, [queuePreview])

  // === 状态同步 ===

  const applyView = useCallback(
    (view: NekoStateView) => {
      viewRef.current = { domain: view.domain, mucDomain: view.mucDomain, self: view.self }
      setSelf(view.self)
      pinnedRef.current = view.pinnedChats ?? []
      commitRooms(view.rooms ?? [])
      commitContacts(view.contacts ?? [])
      setIncoming(view.requestsIn ?? [])
      setOutgoing(view.requestsOut ?? [])
      setStickers(view.stickers ?? [])

      const pinned = new Set(pinnedRef.current)
      const prevMap = new Map(conversationsRef.current.map((conversation) => [conversation.key, conversation]))
      const active = activeKeyRef.current
      const next: NekoConversation[] = []

      for (const contact of view.contacts ?? []) {
        const key = contact.key
        const hasTraffic = contact.lastMessageAt > 0
        if (!hasTraffic && !openedKeysRef.current.has(key) && key !== active && !pinned.has(key)) {
          continue
        }
        const previous = prevMap.get(key)
        const conversation = makeDirectConversation(contact, pinned)
        next.push({
          ...conversation,
          lastMessage: previous?.lastMessage ?? null,
          lastMessageAt: Math.max(conversation.lastMessageAt, previous?.lastMessageAt ?? 0),
          unread: unreadRef.current[key] ?? previous?.unread ?? 0,
          pinned: pinned.has(key),
          online: contact.online,
          isFriend: contact.isFriend,
        })
      }

      for (const room of view.rooms ?? []) {
        const previous = prevMap.get(room.key)
        const conversation = makeRoomConversation(room, pinned)
        next.push({
          ...conversation,
          lastMessage: previous?.lastMessage ?? null,
          lastMessageAt: Math.max(conversation.lastMessageAt, previous?.lastMessageAt ?? 0),
          unread: unreadRef.current[room.key] ?? previous?.unread ?? 0,
          pinned: pinned.has(room.key),
        })
      }

      commitConversations(() => sortNekoConversations(next, pinnedRef.current))
    },
    [commitContacts, commitConversations, commitRooms],
  )

  const refreshView = useCallback(async () => {
    try {
      const view = await api.get<NekoStateView>('/chat/xmpp/state')
      if (view?.self) applyView(view)
    } catch {
      // 状态刷新失败等下个周期
    }
  }, [applyView])

  const scheduleViewRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) return
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null
      void refreshView()
    }, 300)
  }, [refreshView])

  // === 陌生来信反查 ===

  const addExtraContact = useCallback(
    (contact: NekoContact) => {
      if (contactByIdRef.current.has(contact.nekoId)) return
      commitContacts([...contactsRef.current, contact])
    },
    [commitContacts],
  )

  const resolveUnknown = useCallback(
    (username: string) => {
      if (!username) return
      lookupQueueRef.current.add(username)
      if (lookupTimerRef.current !== null) return
      lookupTimerRef.current = setTimeout(() => {
        lookupTimerRef.current = null
        const names = Array.from(lookupQueueRef.current).slice(0, 20)
        lookupQueueRef.current.clear()
        if (names.length === 0) return
        const domain = viewRef.current.domain
        const jids = names.map((name) => directJidOf(name, domain)).join(',')
        void api
          .get<{ users: NekoDirectoryUser[] }>(
            `/chat/xmpp/users?jids=${encodeURIComponent(jids)}`,
          )
          .then((data) => {
            for (const item of data?.users ?? []) {
              if (!item?.nekoId) continue
              const contact = toContact(item)
              addExtraContact(contact)
              queuePreview(contact.key)
            }
          })
          .catch(() => {
            // 下一次来信会重新入队
          })
      }, LOOKUP_WINDOW_MS)
    },
    [addExtraContact, queuePreview],
  )

  // === 实时事件 ===

  const handleRecall = useCallback(
    (key: string, messageId: number, byAdmin: boolean) => {
      commitMessages(key, (prev) =>
        prev.map((message) =>
          message.id === messageId
            ? {
                ...message,
                recalled: true,
                body: '消息已撤回',
                image: null,
                quote: null,
                bundle: null,
                byAdmin: message.byAdmin || byAdmin,
              }
            : message,
        ),
      )
      commitConversations((prev) =>
        prev.map((conversation) =>
          conversation.key === key && conversation.lastMessage?.id === messageId
            ? {
                ...conversation,
                lastMessage: {
                  ...conversation.lastMessage,
                  recalled: true,
                  body: '消息已撤回',
                  image: null,
                  quote: null,
                  bundle: null,
                },
              }
            : conversation,
        ),
      )
    },
    [commitConversations, commitMessages],
  )

  const handleHeadline = useCallback(
    (el: XmppElement) => {
      const event = parseHeadline(el)
      if (!event) return
      if (event.event === 'msg-recall') {
        let key: string | null = event.roomId ? roomKeyOf(event.roomId) : null
        if (!key && event.peer) {
          const contact = contactByNameRef.current.get(event.peer)
          if (contact) key = contact.key
        }
        if (!key) {
          const matched = conversationsRef.current.find(
            (conversation) => conversation.kind === 'direct' && conversation.lastMessage?.id === event.msgId,
          )
          key = matched?.key ?? null
        }
        if (key) handleRecall(key, event.msgId, event.byAdmin)
        return
      }
      if (event.event === 'read') {
        if (event.peer) {
          const contact = contactByNameRef.current.get(event.peer)
          if (contact) peerReadRef.current[contact.key] = event.msgId
        }
        return
      }
      // 好友 / 群成员 / 群设置 / 解散：刷新状态即可（好友关系以 Prisma 为准）
      if (event.event === 'friend-request' || event.event === 'friend-update') {
        scheduleViewRefresh()
        void refreshSummary()
        return
      }
      scheduleViewRefresh()
    },
    [handleRecall, refreshSummary, scheduleViewRefresh],
  )

  const handlePresence = useCallback(
    (el: XmppElement) => {
      const presence = parsePresence(el)
      if (!presence) return
      const contact = contactByNameRef.current.get(presence.username)
      if (!contact || contact.online === presence.online) return
      commitContacts(
        contactsRef.current.map((item) =>
          item.username === presence.username ? { ...item, online: presence.online } : item,
        ),
      )
      commitConversations((prev) =>
        prev.map((conversation) =>
          conversation.contact?.username === presence.username
            ? { ...conversation, online: presence.online }
            : conversation,
        ),
      )
      const roomTouched = roomsRef.current.some((room) =>
        room.members.some((member) => member.username === presence.username),
      )
      if (roomTouched) {
        commitRooms(
          roomsRef.current.map((room) => ({
            ...room,
            members: room.members.map((member) =>
              member.username === presence.username ? { ...member, online: presence.online } : member,
            ),
          })),
        )
      }
    },
    [commitContacts, commitConversations, commitRooms],
  )

  const handleMessage = useCallback(
    (el: XmppElement) => {
      const view = viewRef.current
      if (!view.self) return
      const isRoom = el.attrs.type === 'groupchat'
      let key: string | null = null
      let roomId: number | null = null

      if (isRoom) {
        roomId = roomIdOfJid(el.attrs.from || '')
        if (!roomId) return
        // 全员大厅与未加入的 room 一律丢弃
        if (!roomsRef.current.some((room) => room.id === roomId)) return
        key = roomKeyOf(roomId)
      } else {
        const fromUser = localpartOfJid(el.attrs.from || '')
        const toUser = localpartOfJid(el.attrs.to || '')
        const peer = fromUser === view.self.username ? toUser : fromUser
        if (!peer) return
        const contact = contactByNameRef.current.get(peer)
        if (!contact) {
          resolveUnknown(peer)
          return
        }
        key = contact.key
      }
      if (!key) return

      const message = parseLiveMessage(el, {
        selfUsername: view.self.username,
        mucDomain: view.mucDomain,
        key,
        roomId,
        now: Date.now(),
      })
      if (!message) return
      // 没有存证 id（极少见）：直接拉一次历史，避免本地出现无法撤回/去重的消息
      if (!message.id) {
        void refreshLatest(key)
        return
      }
      message.fromNekoId = contactByNameRef.current.get(message.fromUsername)?.nekoId ?? null
      commitMessages(key, (prev) => mergeNekoMessages(prev, message))
      if (key === activeKeyRef.current) {
        markRead(key)
        upsertFromMessage(key, message, 0)
      } else {
        const prevUnread = unreadRef.current[key] ?? 0
        const unread = message.mine ? prevUnread : prevUnread + 1
        unreadRef.current[key] = unread
        upsertFromMessage(key, message, unread)
        // 全局提示：不在该会话页面时也弹出（普通页面、游戏对局中都生效）
        if (!message.mine) pushMessageNotice(key, roomId, message)
      }
    },
    [commitMessages, markRead, pushMessageNotice, refreshLatest, resolveUnknown, upsertFromMessage],
  )

  const handleStanza = useCallback(
    (el: XmppElement) => {
      if (el.name === 'presence') {
        handlePresence(el)
        return
      }
      if (el.name !== 'message') return
      if (el.attrs.type === 'headline') {
        handleHeadline(el)
        return
      }
      handleMessage(el)
    },
    [handleHeadline, handleMessage, handlePresence],
  )

  // === 连接生命周期 ===

  const resetState = useCallback(() => {
    clientRef.current = null
    viewRef.current = { domain: '', mucDomain: '', self: null }
    conversationsRef.current = []
    contactsRef.current = []
    roomsRef.current = []
    pinnedRef.current = []
    openedKeysRef.current = new Set()
    activeKeyRef.current = null
    messagesRef.current = {}
    historyRef.current = {}
    unreadRef.current = {}
    peerReadRef.current = {}
    previewDoneRef.current = new Set()
    previewQueueRef.current = []
    previewQueuedRef.current = new Set()
    previewRunningRef.current = 0
    setSelf(null)
    setConversations([])
    setContacts([])
    setRooms([])
    setIncoming([])
    setOutgoing([])
    setActiveKeyState(null)
    setMessagesByKey({})
    setHistoryMeta({})
    setMessageNotice(null)
    setConnectionState('closed')
    setTransport('polling')
  }, [])

  useEffect(() => {
    if (!userId) {
      resetState()
      setError(null)
      setLoading(false)
      return
    }

    let disposed = false
    let attempts = 0
    let connecting = false
    let authFailed = false
    let wsFailures = 0
    let instance: XmppClient | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let pingTimer: ReturnType<typeof setInterval> | null = null
    let pollStateTimer: ReturnType<typeof setInterval> | null = null
    let pollActiveTimer: ReturnType<typeof setInterval> | null = null

    const forcedPolling = readForcedPolling()
    let preferHttp = forcedPolling || !isWebSocketAvailable()

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
    }
    const clearPing = () => {
      if (pingTimer !== null) {
        clearInterval(pingTimer)
        pingTimer = null
      }
    }
    const clearPollingTimers = () => {
      if (pollStateTimer !== null) {
        clearInterval(pollStateTimer)
        pollStateTimer = null
      }
      if (pollActiveTimer !== null) {
        clearInterval(pollActiveTimer)
        pollActiveTimer = null
      }
    }

    const scheduleReconnect = () => {
      if (disposed || authFailed) return
      clearReconnectTimer()
      const delay = Math.min(INITIAL_RECONNECT_DELAY * 2 ** attempts, MAX_RECONNECT_DELAY)
      attempts += 1
      setConnectionState('connecting')
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        void start(false)
      }, delay)
    }

    const onStanzaEvent = (event: Event) => {
      const detail = (event as CustomEvent<XmppElement>).detail
      if (detail) handleStanza(detail)
    }

    const onClose = () => {
      if (disposed || instance !== clientRef.current) return
      if (connecting) return
      clearPing()
      clearPollingTimers()
      setConnectionState('closed')
      if (authFailed) return
      scheduleReconnect()
    }

    const onAuthError = () => {
      authFailed = true
      clearReconnectTimer()
      setError('聊天连接认证失败，请重新登录')
    }

    const startPollingTimers = (client: XmppClient) => {
      if (client.mode !== 'http') return
      pollStateTimer = setInterval(() => void refreshView(), POLL_STATE_INTERVAL_MS)
      pollActiveTimer = setInterval(() => {
        const key = activeKeyRef.current
        if (key) void refreshLatest(key)
      }, POLL_ACTIVE_INTERVAL_MS)
    }

    const start = async (bootstrap: boolean) => {
      if (disposed) return
      setConnectionState('connecting')
      if (!viewRef.current.self) setLoading(true)

      let ticket = ''
      previewDoneRef.current = new Set()
      try {
        if (bootstrap) {
          const data = await api.get<NekoBootstrap>('/chat/xmpp/bootstrap')
          if (disposed) return
          ticket = data.ticket
          applyView(data)
        } else {
          const data = await api.get<{ ticket: string }>('/chat/xmpp/ticket')
          if (disposed) return
          ticket = data.ticket
        }
      } catch (err) {
        if (disposed) return
        setLoading(false)
        setError(errorText(err, '聊天服务暂时不可用'))
        setConnectionState('closed')
        scheduleReconnect()
        return
      }

      const view = viewRef.current
      if (!view.self) {
        setLoading(false)
        setConnectionState('closed')
        setError('聊天服务返回的身份信息缺失')
        return
      }

      const client = new XmppClient()
      instance = client
      clientRef.current = client
      client.addEventListener('stanza', onStanzaEvent)
      client.addEventListener('close', onClose)
      client.addEventListener('auth-error', onAuthError)
      connecting = true

      const credentials = { username: view.self.username, password: ticket }
      try {
        if (!preferHttp) {
          try {
            await client.connect({
              url: getXmppWsUrl(getToken()),
              domain: view.domain,
              ...credentials,
            })
          } catch {
            if (disposed) return
            // WS 握手失败：本次立刻改用长轮询；连续两次失败则本会话不再尝试 WS
            wsFailures += 1
            if (wsFailures >= 2) preferHttp = true
            client.close()
            // 票据是一次性的：超时的 WS 可能已被上游消费，降级前必须换新的
            const fresh = await api.get<{ ticket: string }>('/chat/xmpp/ticket')
            if (disposed) return
            if (fresh?.ticket) credentials.password = fresh.ticket
            await client.connectHttp(view.domain, credentials)
          }
        } else {
          await client.connectHttp(view.domain, credentials)
        }
        if (disposed) {
          client.close()
          return
        }
        if (!client.isOpen) throw new Error('聊天连接失败')
        connecting = false
        attempts = 0
        wsFailures = 0
        setLoading(false)
        setError(null)
        setConnectionState('open')
        setTransport(client.mode === 'http' ? 'polling' : 'ws')
        client.sendPresence()
        clearPing()
        if (client.mode === 'ws') {
          pingTimer = setInterval(() => client.ping(), PING_INTERVAL_MS)
        }
        startPollingTimers(client)
        if (!bootstrap) void refreshView()
        ensurePreviews()
        const current = activeKeyRef.current
        if (current) ensureLoaded(current)
      } catch (err) {
        connecting = false
        if (disposed) return
        client.close()
        setLoading(false)
        setConnectionState('closed')
        setError(errorText(err, '聊天连接失败，正在重试…'))
        scheduleReconnect()
      }
    }

    if (forcedPolling) {
      setTransport('polling')
    }
    void start(true)

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return
      const key = activeKeyRef.current
      if (key) {
        void refreshLatest(key)
        markRead(key)
      }
      if (clientRef.current?.mode === 'http') void refreshView()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', handleVisibility)
      clearReconnectTimer()
      clearPing()
      clearPollingTimers()
      if (lookupTimerRef.current !== null) {
        clearTimeout(lookupTimerRef.current)
        lookupTimerRef.current = null
      }
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
      const client = instance
      instance = null
      clientRef.current = null
      if (client) client.close()
    }
    // 依赖全部是稳定回调；userId 变化时才重建连接
  }, [
    userId,
    applyView,
    ensureLoaded,
    ensurePreviews,
    handleStanza,
    markRead,
    refreshLatest,
    refreshView,
    resetState,
  ])

  // === 对页面暴露的操作 ===

  const setActiveKey = useCallback(
    (key: string | null) => {
      const next = key && isConversationKey(key) ? key : null
      activeKeyRef.current = next
      setActiveKeyState(next)
      // 打开某会话时收起指向它的全局提示
      setMessageNotice((prev) => (prev && prev.key === next ? null : prev))
      if (!next) return
      openedKeysRef.current.add(next)
      // 深链 / 刷新：新对话还没有任何消息，不会出现在会话列表里，
      // 这里按已知联系人或群补一条，否则会被当成「会话不存在」。
      const parsed = parseConversationKey(next)
      if (parsed?.kind === 'direct') {
        const contact = contactByIdRef.current.get(parsed.nekoId)
        if (contact) {
          commitConversations((prev) => {
            if (prev.some((conversation) => conversation.key === next)) return prev
            const created = makeDirectConversation(contact, new Set(pinnedRef.current))
            return sortNekoConversations([created, ...prev], pinnedRef.current)
          })
        }
      } else if (parsed?.kind === 'room') {
        const room = roomsRef.current.find((item) => item.key === next)
        if (room) {
          commitConversations((prev) => {
            if (prev.some((conversation) => conversation.key === next)) return prev
            const created = makeRoomConversation(room, new Set(pinnedRef.current))
            return sortNekoConversations([created, ...prev], pinnedRef.current)
          })
        }
      }
      ensureLoaded(next)
      markRead(next)
    },
    [commitConversations, ensureLoaded, markRead],
  )

  const startDirect = useCallback(
    (target: NekoContact | NekoDirectoryUser): string => {
      const contact = 'key' in target ? target : toContact(target)
      if (!contactByIdRef.current.has(contact.nekoId)) addExtraContact(contact)
      const key = contact.key
      openedKeysRef.current.add(key)
      commitConversations((prev) => {
        if (prev.some((conversation) => conversation.key === key)) return prev
        const created = makeDirectConversation(contact, new Set(pinnedRef.current))
        return sortNekoConversations([created, ...prev], pinnedRef.current)
      })
      ensureLoaded(key)
      return key
    },
    [addExtraContact, commitConversations, ensureLoaded],
  )

  const requireTarget = useCallback(
    (key: string): HistoryTarget => {
      const target = targetOf(key)
      if (!target) throw new Error('会话不存在或已退出')
      return target
    },
    [targetOf],
  )

  const requireClient = useCallback((): XmppClient => {
    const client = clientRef.current
    if (!client || !client.isOpen) throw new Error('聊天尚未连接，请稍候重试')
    return client
  }, [])

  const sendText = useCallback(
    async (key: string, text: string, replyTo?: number) => {
      const body = text.trim()
      if (!body) return
      const client = requireClient()
      const target = requireTarget(key)
      const reply = Math.max(0, Math.trunc(replyTo || 0))
      client.sendMessage({ to: target.to, type: target.type, body, ...(reply ? { reply } : {}) })
    },
    [requireClient, requireTarget],
  )

  /**
   * 转发聊天记录。
   *
   * 合并转发依赖 neko 按「目标会话」生成快照（单聊双方匹配 / 同群），因此跨会话
   * 只能逐条转发；这条限制来自上游协议，不是前端取舍。
   */
  const forwardMessages = useCallback(
    async (
      sourceKey: string,
      messageIds: number[],
      targetKeys: string[],
      mode: 'merge' | 'separate',
    ) => {
      const client = requireClient()
      const ids = Array.from(
        new Set(messageIds.filter((id) => Number.isInteger(id) && id > 0)),
      ).slice(0, 30)
      if (ids.length === 0) throw new Error('没有可转发的消息')
      const targets = Array.from(new Set(targetKeys.filter((key) => isConversationKey(key))))
      if (targets.length === 0) throw new Error('请选择转发对象')
      if (mode === 'merge' && targets.some((key) => key !== sourceKey)) {
        throw new Error('合并转发只能发回原会话，跨会话请使用逐条转发')
      }
      if (mode === 'separate' && ids.length * targets.length > 100) {
        throw new Error('一次最多逐条转发 100 条（消息数 × 会话数），请减少选择')
      }

      if (mode === 'merge') {
        const target = requireTarget(sourceKey)
        for (const key of targets) {
          if (key !== sourceKey) continue
          client.sendMessage({
            to: target.to,
            type: target.type,
            body: '[聊天记录]',
            forward: ids,
          })
        }
        return
      }

      const source = messagesRef.current[sourceKey] ?? []
      const payloads = ids
        .map((id) => source.find((message) => message.id === id))
        .filter((message): message is NekoMessage => !!message && !message.recalled)
        .map((message) => ({
          body: message.body || (message.image ? '[图片]' : '[消息]'),
          ...(message.image
            ? { xhtml: `<img src="${escXml(message.image)}" alt="${message.body === '[表情]' ? '表情' : '图片'}"/>` }
            : {}),
        }))
      if (payloads.length === 0) throw new Error('所选消息已失效，请重新选择')

      for (const key of targets) {
        const target = requireTarget(key)
        for (const payload of payloads) {
          client.sendMessage({ to: target.to, type: target.type, ...payload })
        }
      }
    },
    [requireClient, requireTarget],
  )

  const sendImage = useCallback(
    async (key: string, file: File) => {
      const client = requireClient()
      const target = requireTarget(key)
      const prepared = await prepareChatImage(file)
      const form = new FormData()
      form.append('file', prepared)
      const uploaded = await api.postForm<{ ok: boolean; url: string; id: string }>(
        '/chat/xmpp/uploads',
        form,
      )
      const id = uploaded?.id || ''
      if (!id) throw new Error('图片上传失败')
      const src = `/chat/uploads/${id}`
      client.sendMessage({
        to: target.to,
        type: target.type,
        body: '[图片]',
        xhtml: `<img src="${escXml(src)}" alt="图片"/>`,
      })
    },
    [requireClient, requireTarget],
  )

  const sendSticker = useCallback(
    (key: string, sticker: NekoSticker) => {
      if (!sticker?.url) return
      const client = requireClient()
      const target = requireTarget(key)
      // 与 neko 原生客户端一致：正文固定 [表情]，图片走 XHTML-IM
      client.sendMessage({
        to: target.to,
        type: target.type,
        body: '[表情]',
        xhtml: `<img src="${escXml(sticker.url)}" alt="表情"/>`,
      })
    },
    [requireClient, requireTarget],
  )

  /** 上传图片并收藏为表情（复用聊天图片上传通道） */
  const addSticker = useCallback(
    async (file: File) => {
      const prepared = await prepareStickerImage(file)
      const form = new FormData()
      form.append('file', prepared)
      const uploaded = await api.postForm<{ ok: boolean; url: string; id: string }>(
        '/chat/xmpp/uploads',
        form,
      )
      const uploadId = uploaded?.id || ''
      if (!uploadId) throw new Error('图片上传失败')
      await api.post('/chat/xmpp/stickers', { uploadId })
      await refreshView()
    },
    [refreshView],
  )

  const removeSticker = useCallback(
    async (id: number) => {
      await api.post('/chat/xmpp/stickers/remove', { id })
      await refreshView()
    },
    [refreshView],
  )

  const recallMessage = useCallback(
    async (key: string, messageId: number, admin = false) => {
      await api.post(admin ? '/chat/xmpp/messages/admin-recall' : '/chat/xmpp/messages/recall', {
        id: messageId,
      })
      handleRecall(key, messageId, admin)
    },
    [handleRecall],
  )

  const createGroup = useCallback(
    async (name: string, memberNekoIds: number[]) => {
      const data = await api.post<{ ok: boolean; roomId: number }>('/chat/xmpp/rooms', {
        name: name.trim(),
        memberIds: memberNekoIds,
      })
      const roomId = Number(data?.roomId) || 0
      if (!roomId) throw new Error('群聊创建失败')
      const key = roomKeyOf(roomId)
      openedKeysRef.current.add(key)
      await refreshView()
      commitMeta(key, { loaded: false, complete: false })
      return key
    },
    [commitMeta, refreshView],
  )

  const addMembers = useCallback(
    async (roomId: number, memberNekoIds: number[]) => {
      await api.post(`/chat/xmpp/rooms/${roomId}/members`, { addIds: memberNekoIds })
      await refreshView()
    },
    [refreshView],
  )

  const removeMember = useCallback(
    async (roomId: number, nekoId: number) => {
      await api.post(`/chat/xmpp/rooms/${roomId}/members`, { removeIds: [nekoId] })
      await refreshView()
    },
    [refreshView],
  )

  const renameRoom = useCallback(
    async (roomId: number, name: string) => {
      await api.post(`/chat/xmpp/rooms/${roomId}/name`, { name: name.trim() })
      await refreshView()
    },
    [refreshView],
  )

  const leaveRoom = useCallback(
    async (roomId: number) => {
      await api.post(`/chat/xmpp/rooms/${roomId}/leave`)
      const key = roomKeyOf(roomId)
      openedKeysRef.current.delete(key)
      if (activeKeyRef.current === key) setActiveKey(null)
      commitConversations((prev) => prev.filter((conversation) => conversation.key !== key))
      await refreshView()
    },
    [commitConversations, refreshView, setActiveKey],
  )

  const disbandRoom = useCallback(
    async (roomId: number) => {
      await api.post(`/chat/xmpp/rooms/${roomId}/disband`)
      const key = roomKeyOf(roomId)
      openedKeysRef.current.delete(key)
      if (activeKeyRef.current === key) setActiveKey(null)
      commitConversations((prev) => prev.filter((conversation) => conversation.key !== key))
      await refreshView()
    },
    [commitConversations, refreshView, setActiveKey],
  )

  const acceptRequest = useCallback(
    async (request: NekoFriendRequest) => {
      if (request.source === 'neko') {
        await api.post('/chat/xmpp/friends/respond', { requestId: request.id, accept: true })
      } else {
        await api.post(`/chat/friend-requests/${request.id}/accept`)
      }
      await refreshView()
      void refreshSummary()
    },
    [refreshSummary, refreshView],
  )

  const rejectRequest = useCallback(
    async (request: NekoFriendRequest) => {
      if (request.source === 'neko') {
        await api.post('/chat/xmpp/friends/respond', { requestId: request.id, accept: false })
      } else {
        await api.post(`/chat/friend-requests/${request.id}/reject`)
      }
      await refreshView()
      void refreshSummary()
    },
    [refreshSummary, refreshView],
  )

  const addFriend = useCallback(
    async (linewebId: number) => {
      await api.post('/chat/friend-requests', { userId: linewebId })
      await refreshView()
      void refreshSummary()
    },
    [refreshSummary, refreshView],
  )

  const addNativeFriend = useCallback(
    async (nekoId: number) => {
      await api.post('/chat/xmpp/friends/request', { nekoId })
      await refreshView()
    },
    [refreshView],
  )

  const removeFriend = useCallback(
    async (contact: NekoContact) => {
      if (contact.linewebId !== null) {
        await api.delete(`/chat/friends/${contact.linewebId}`)
        void refreshSummary()
      } else {
        await api.post('/chat/xmpp/friends/remove', { nekoId: contact.nekoId })
      }
      await refreshView()
    },
    [refreshSummary, refreshView],
  )

  const searchDirectory = useCallback(async (query: string): Promise<NekoDirectoryUser[]> => {
    const keyword = query.trim()
    if (!keyword) return []
    const data = await api.get<{ users: NekoDirectoryUser[] }>(
      `/chat/xmpp/directory?q=${encodeURIComponent(keyword)}`,
    )
    return data?.users ?? []
  }, [])

  const refresh = useCallback(async () => {
    await refreshView()
  }, [refreshView])

  const loadMoreFor = useCallback(
    (key: string) => {
      void loadMore(key)
    },
    [loadMore],
  )

  // === 派生 ===

  const friends = useMemo(
    // 好友 = LineWeb（Prisma）+ neko 原生（neko 好友系统），以服务端 isFriend 为准
    () => contacts.filter((contact) => contact.isFriend),
    [contacts],
  )
  const unreadTotal = useMemo(() => totalUnread(conversations), [conversations])

  const activeMessages = activeKey ? messagesByKey[activeKey] ?? EMPTY_MESSAGES : EMPTY_MESSAGES
  const activeMeta = activeKey ? historyMeta[activeKey] ?? DEFAULT_META : DEFAULT_META

  const value = useMemo<XmppChatValue>(
    () => ({
      connectionState,
      transport,
      loading,
      error,
      self,
      conversations,
      contacts,
      friends,
      rooms,
      incoming,
      outgoing,
      unreadTotal,
      activeKey,
      setActiveKey,
      messages: activeMessages,
      messagesLoading: activeMeta.loading,
      messagesLoadingMore: activeMeta.loadingMore,
      messagesHasMore: !activeMeta.complete && activeMeta.loaded,
      messagesError: activeMeta.error,
      loadMore: loadMoreFor,
      sendText,
      forwardMessages,
      sendImage,
      sendSticker,
      addSticker,
      removeSticker,
      recallMessage,
      startDirect,
      createGroup,
      addMembers,
      removeMember,
      renameRoom,
      leaveRoom,
      disbandRoom,
      acceptRequest,
      rejectRequest,
      addFriend,
      addNativeFriend,
      removeFriend,
      searchDirectory,
      refresh,
      stickers,
      messageNotice,
      dismissMessageNotice,
    }),
    [
      connectionState,
      transport,
      loading,
      error,
      self,
      conversations,
      contacts,
      friends,
      rooms,
      incoming,
      outgoing,
      unreadTotal,
      activeKey,
      setActiveKey,
      activeMessages,
      activeMeta,
      loadMoreFor,
      sendText,
      forwardMessages,
      sendImage,
      sendSticker,
      addSticker,
      removeSticker,
      recallMessage,
      startDirect,
      createGroup,
      addMembers,
      removeMember,
      renameRoom,
      leaveRoom,
      disbandRoom,
      acceptRequest,
      rejectRequest,
      addFriend,
      addNativeFriend,
      removeFriend,
      searchDirectory,
      refresh,
      stickers,
      messageNotice,
      dismissMessageNotice,
    ],
  )

  return <XmppChatContext.Provider value={value}>{children}</XmppChatContext.Provider>
}

export function useXmppChat(): XmppChatValue {
  const context = useContext(XmppChatContext)
  if (!context) throw new Error('useXmppChat must be used within XmppChatProvider')
  return context
}
