import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import NekoAvatar from './NekoAvatar'
import ChatComposer, { type ComposerReply } from './ChatComposer'
import ChatImageLightbox from './ChatImageLightbox'
import ChatStickerPanel from './ChatStickerPanel'
import ChatBundleDialog from './ChatBundleDialog'
import ChatForwardDialog from './ChatForwardDialog'
import MessageActionMenu, { type MessageActionItem } from './MessageActionMenu'
import { canRecall, chatImageUrl, contactLabel, senderLabel } from '../../lib/chat'
import { useLongPress } from '../../hooks/useLongPress'
import { extractImageSrc } from '../../lib/xmpp/protocol'
import type {
  NekoBundleItem,
  NekoContact,
  NekoConversation,
  NekoMessage,
  NekoSticker,
} from '../../types/chat'

/** 一次最多选择的消息条数（与 neko 合并转发上限一致） */
const SELECT_MAX = 30
/** 群公告横幅「不再显示」记忆：{ [roomId]: announcementUpdatedAt } */
const ANNOUNCEMENT_DISMISS_KEY = 'lineweb_chat_announcement_dismissed'
/** 同一发送者在此窗口内的连续消息合并为一组（隐藏重复头像与昵称） */
const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000

function readAnnouncementDismissed(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(ANNOUNCEMENT_DISMISS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const result: Record<string, number> = {}
    for (const [key, value] of Object.entries(parsed)) {
      const stamp = Number(value)
      if (Number.isFinite(stamp)) result[key] = stamp
    }
    return result
  } catch {
    return {}
  }
}

function writeAnnouncementDismissed(value: Record<string, number>): void {
  try {
    window.localStorage.setItem(ANNOUNCEMENT_DISMISS_KEY, JSON.stringify(value))
  } catch {
    // 隐私模式忽略
  }
}

function dayKey(ts: number): string {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function formatDaySeparator(ts: number): string {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const diffDays = Math.round((startOfToday - startOfDate) / 86_400_000)
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
  }
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

interface Props {
  conversation: NekoConversation | null
  /** 自己的 neko id（用于群成员「移出」按钮的显示） */
  selfNekoId: number | null
  messages: NekoMessage[]
  /** 单聊对方已读到的消息 id（群聊不使用） */
  peerRead?: number
  loading?: boolean
  loadingMore?: boolean
  hasMore?: boolean
  error?: string | null
  emptyMessage?: string
  /** 可选的转发目标会话 */
  forwardTargets?: NekoConversation[]
  onBack: () => void
  /** replyTo 为被引用消息 id；mentions 为群聊 @ 的 neko id（0 = 所有人） */
  onSend: (content: string, replyTo?: number, mentions?: number[]) => Promise<void> | void
  /** 拍一拍指定成员（双击头像 / 长按菜单） */
  onPoke?: (targetNekoId: number) => void | Promise<void>
  /** 收藏别人发来的表情 */
  onSaveSticker?: (message: NekoMessage) => void | Promise<void>
  /** 打开联系人备注弹窗 */
  onSetRemark?: (contact: NekoContact) => void
  /** 转发聊天记录（merge = 合并转发，separate = 逐条转发） */
  onForward: (
    messageIds: number[],
    targetKeys: string[],
    mode: 'merge' | 'separate',
  ) => Promise<void> | void
  /** 发送图片（页面负责上传与错误提示） */
  onSendImage?: (file: File) => Promise<void> | void
  /** 表情包（三项都传入才渲染表情入口） */
  stickers?: NekoSticker[]
  onSendSticker?: (sticker: NekoSticker) => void
  onAddSticker?: (file: File) => Promise<void> | void
  onRemoveSticker?: (id: number) => Promise<void> | void
  /** 撤回消息（确认逻辑在 ChatThread 内，页面只负责请求）；admin=true 为管理员撤回 */
  onRecall?: (messageId: number, admin?: boolean) => Promise<void> | void
  onLoadMore: () => void
  onAddMembers: () => void
  onRemoveMember: (nekoId: number) => void
  onRename: (name: string) => Promise<void> | void
  onDissolve: () => void
  onLeave: () => void
  /** 保存 neko 群公告（群主/管理员；留空清除） */
  onSaveAnnouncement?: (text: string, ackRequired: boolean) => Promise<void> | void
  /** 确认当前群公告（需要确认的公告） */
  onAckAnnouncement?: () => Promise<void> | void
}

function formatMessageTime(value: number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 群聊正文里的 @昵称 高亮（纯文本切分，不渲染 HTML） */
function renderMentionText(body: string, members: NekoConversation['members']): ReactNode {
  if (!body || members.length === 0) return body
  const names = [...new Set([
    ...members.map((member) => member.displayName || member.username),
    '所有人',
  ])].filter(Boolean).sort((a, b) => b.length - a.length)
  if (names.length === 0) return body
  const regex = new RegExp(`(@(?:${names.map(escapeRegExp).join('|')}))`, 'g')
  const parts = body.split(regex)
  return parts.map((part, index) =>
    part.startsWith('@') && names.includes(part.slice(1))
      ? <span key={index} className="gh-chat-mention">{part}</span>
      : <span key={index}>{part}</span>
  )
}

function avatarOf(
  conversation: NekoConversation,
  message: NekoMessage,
): { id: number; nekoId: number | null; avatarVersion: number; name: string } {
  if (conversation.kind === 'direct') {
    return {
      id: conversation.avatarId,
      nekoId: conversation.avatarNekoId,
      avatarVersion: conversation.avatarVersion,
      name: conversation.avatarName,
    }
  }
  const member = conversation.members.find((item) => item.username === message.fromUsername)
  if (!member) {
    return { id: -1, nekoId: null, avatarVersion: 0, name: message.fromUsername || '未知用户' }
  }
  return {
    id: member.linewebId ?? -member.nekoId,
    nekoId: member.nekoId,
    avatarVersion: member.avatarVersion,
    name: member.displayName || member.username,
  }
}

export default function ChatThread({
  conversation,
  selfNekoId,
  messages,
  peerRead = 0,
  loading = false,
  loadingMore = false,
  hasMore = false,
  error = null,
  emptyMessage = '选择一个会话，开始聊天',
  forwardTargets = [],
  onBack,
  onSend,
  onPoke,
  onSaveSticker,
  onSetRemark,
  onForward,
  onSendImage,
  stickers = [],
  onSendSticker,
  onAddSticker,
  onRemoveSticker,
  onRecall,
  onLoadMore,
  onAddMembers,
  onRemoveMember,
  onRename,
  onDissolve,
  onLeave,
  onSaveAnnouncement,
  onAckAnnouncement,
}: Props) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const lastAvatarTapRef = useRef<{ id: number; at: number } | null>(null)
  const lastPokeSentRef = useRef(0)
  const [actionMenu, setActionMenu] = useState<{ message: NekoMessage; x: number; y: number } | null>(null)
  const pressedMessageRef = useRef<NekoMessage | null>(null)
  const longPress = useLongPress((x, y) => {
    const message = pressedMessageRef.current
    if (message) setActionMenu({ message, x, y })
  })
  const stickToBottomRef = useRef(true)
  const pendingPrependRef = useRef(false)
  const previousScrollHeightRef = useRef(0)
  const previousLastIdRef = useRef<number | null>(null)
  const previousCountRef = useRef(0)

  const [membersOpen, setMembersOpen] = useState(false)
  const [memberQuery, setMemberQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [announcementOpen, setAnnouncementOpen] = useState(false)
  const [announcementEditing, setAnnouncementEditing] = useState(false)
  const [announcementText, setAnnouncementText] = useState('')
  const [announcementAck, setAnnouncementAck] = useState(false)
  const [announcementSaving, setAnnouncementSaving] = useState(false)
  const [announcementError, setAnnouncementError] = useState('')
  const [ackOpen, setAckOpen] = useState(false)
  const [ackSaving, setAckSaving] = useState(false)
  const [ackError, setAckError] = useState('')
  const [dismissedAnnouncements, setDismissedAnnouncements] = useState<Record<string, number>>(
    () => readAnnouncementDismissed(),
  )
  const [atBottom, setAtBottom] = useState(true)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [stickersOpen, setStickersOpen] = useState(false)
  const [replyTo, setReplyTo] = useState<ComposerReply | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  const [forwardOpen, setForwardOpen] = useState(false)
  const [forwarding, setForwarding] = useState(false)
  const [forwardError, setForwardError] = useState<string | null>(null)
  const [bundlePreview, setBundlePreview] = useState<NekoBundleItem[] | null>(null)
  const [flashId, setFlashId] = useState<number | null>(null)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 「撤回」按钮的 5 分钟窗口需要自动消失：低频 tick 触发重渲染
  const [now, setNow] = useState(() => Date.now())
  const menuRef = useRef<HTMLDivElement | null>(null)

  const conversationKey = conversation?.key ?? null
  const roomInfo = conversation?.kind === 'room' ? conversation.room ?? null : null
  const myRole = roomInfo?.myRole ?? ''
  const isOwner = conversation?.kind === 'room' && (myRole === 'owner' || myRole === 'admin')
  const isGroup = conversation?.kind === 'room'
  const isLobby = !!roomInfo?.isLobby
  const isBigGroup = !!roomInfo?.isBigGroup
  const canEditAnnouncement = isGroup && isOwner

  // 切换会话时回到最新消息
  useEffect(() => {
    stickToBottomRef.current = true
    pendingPrependRef.current = false
    previousLastIdRef.current = null
    setMembersOpen(false)
    setMemberQuery('')
    setMenuOpen(false)
    setRenaming(false)
    setPreviewImage(null)
    setStickersOpen(false)
    setReplyTo(null)
    setSelecting(false)
    setSelectedIds(new Set())
    setForwardOpen(false)
    setForwardError(null)
    setBundlePreview(null)
    setFlashId(null)
    setAnnouncementOpen(false)
    setAnnouncementEditing(false)
    setAnnouncementError('')
    setAckOpen(false)
    setAckError('')
    setAtBottom(true)
    const element = listRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [conversationKey])

  // 需要确认的群公告：进入/切换群时，未确认则弹窗（与 neko 一致）
  useEffect(() => {
    if (!roomInfo || !roomInfo.announcement || !roomInfo.announcementAckRequired) return
    if (!onAckAnnouncement) return
    if ((roomInfo.announcementConfirmedAt || 0) >= (roomInfo.announcementUpdatedAt || 0)) return
    setAckOpen(true)
    // 只在房间/公告版本变化时触发；确认后 announcementConfirmedAt 变大，自然不会重开
  }, [
    roomInfo?.id,
    roomInfo?.announcement,
    roomInfo?.announcementUpdatedAt,
    roomInfo?.announcementAckRequired,
    roomInfo?.announcementConfirmedAt,
    onAckAnnouncement,
  ])

  // 引用高亮定时器在卸载时清理
  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) clearTimeout(flashTimerRef.current)
    }
  }, [])

  // 群聊操作菜单：点击外部关闭
  useEffect(() => {
    if (!menuOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [menuOpen])

  // 低频刷新当前时间，让超过 5 分钟的「撤回」按钮自动消失（卸载时清理）
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  // 消息变化时同步一次时间，避免刚加载的消息用的是旧时间导致按钮不出现
  useEffect(() => {
    setNow(Date.now())
  }, [messages])

  // 维护滚动位置：追加新消息时贴底，加载历史时保持视口不跳
  useLayoutEffect(() => {
    const element = listRef.current
    if (!element) return

    if (pendingPrependRef.current) {
      const delta = element.scrollHeight - previousScrollHeightRef.current
      if (delta > 0) element.scrollTop = delta
      pendingPrependRef.current = false
    } else {
      const lastId = messages.length > 0 ? messages[messages.length - 1].id : null
      const appended = messages.length > previousCountRef.current
      if (appended && (stickToBottomRef.current || previousLastIdRef.current === null)) {
        element.scrollTop = element.scrollHeight
      }
      previousLastIdRef.current = lastId
    }
    previousCountRef.current = messages.length
  }, [messages])

  const handleScroll = () => {
    const element = listRef.current
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    stickToBottomRef.current = distance < 80
    setAtBottom(distance < 120)
    if (element.scrollTop < 48 && hasMore && !loadingMore && !loading && messages.length > 0) {
      pendingPrependRef.current = true
      previousScrollHeightRef.current = element.scrollHeight
      onLoadMore()
    }
  }

  const scrollToLatest = () => {
    const element = listRef.current
    if (!element) return
    stickToBottomRef.current = true
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
    setAtBottom(true)
  }

  const handleSend = async (content: string, mentions?: number[]) => {
    stickToBottomRef.current = true
    const replyId = replyTo?.id
    await onSend(content, replyId, mentions)
    setReplyTo(null)
  }

  /** 用户名 → 当前会话里的显示名（引用 / 聊天记录的发送者都只有用户名） */
  const displayNameOf = (username: string): string => {
    if (!conversation) return username
    const member = conversation.members.find((item) => item.username === username)
    if (member) {
      if (selfNekoId !== null && member.nekoId === selfNekoId) return '你'
      return member.displayName || member.username
    }
    if (conversation.kind === 'direct') {
      if (conversation.contact && username === conversation.contact.username) {
        return contactLabel(conversation.contact)
      }
      return '你'
    }
    return username || '未知用户'
  }

  const handlePoke = (targetNekoId: number): void => {
    if (!onPoke) return
    const now = Date.now()
    const last = lastAvatarTapRef.current
    if (last && last.id === targetNekoId && now - last.at < 320) {
      lastAvatarTapRef.current = null
      lastPokeSentRef.current = now
      void onPoke(targetNekoId)
      return
    }
    lastAvatarTapRef.current = { id: targetNekoId, at: now }
  }

  const nameOfNekoId = (nekoId: number): string => {
    if (selfNekoId !== null && nekoId === selfNekoId) return '你'
    const member = conversation?.members.find((item) => item.nekoId === nekoId)
    if (member) return member.displayName || member.username
    if (conversation?.contact?.nekoId === nekoId) return contactLabel(conversation.contact)
    return '对方'
  }

  /** 消息的引用预览文本 */
  const previewOf = (message: NekoMessage): string => {
    if (message.recalled) return '消息已撤回'
    if (message.poke) return '[拍一拍]'
    if (message.image) return message.body === '[表情]' ? '[表情]' : '[图片]'
    if (message.bundle) return '[聊天记录]'
    return message.body
  }

  const startReply = (message: NekoMessage) => {
    if (message.recalled) return
    setReplyTo({
      id: message.id,
      name: senderLabel(message, conversation),
      text: previewOf(message),
    })
  }

  /** 跳到被引用的消息；不在已加载范围内时给出提示 */
  const jumpToMessage = (messageId: number) => {
    const element = listRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${messageId}"]`,
    )
    if (!element) {
      window.alert('被引用的消息不在当前已加载的记录里，可向上滚动加载更早消息后再试。')
      return
    }
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlashId(messageId)
    if (flashTimerRef.current !== null) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => {
      flashTimerRef.current = null
      setFlashId((current) => (current === messageId ? null : current))
    }, 1_600)
  }

  const enterSelectMode = () => {
    setSelecting(true)
    setSelectedIds(new Set())
    setReplyTo(null)
  }

  /** 单条消息快捷转发：进入多选并直接打开转发目标弹窗 */
  const startForward = (message: NekoMessage) => {
    if (message.recalled) return
    setSelecting(true)
    setSelectedIds(new Set([message.id]))
    setReplyTo(null)
    setForwardError(null)
    setForwardOpen(true)
  }

  const exitSelectMode = () => {
    setSelecting(false)
    setSelectedIds(new Set())
    setForwardOpen(false)
    setForwardError(null)
  }

  const toggleSelect = (messageId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(messageId)) {
        next.delete(messageId)
      } else if (next.size < SELECT_MAX) {
        next.add(messageId)
      }
      return next
    })
  }

  const submitForward = async (
    targetKeys: string[],
    mode: 'merge' | 'separate',
  ) => {
    setForwarding(true)
    setForwardError(null)
    try {
      await onForward([...selectedIds], targetKeys, mode)
      setForwardOpen(false)
      exitSelectMode()
    } catch (err) {
      setForwardError(err instanceof Error && err.message ? err.message : '转发失败')
    } finally {
      setForwarding(false)
    }
  }

  const handleRecall = async (message: NekoMessage, admin = false) => {
    if (!onRecall) return
    if (!window.confirm(admin ? '确定以管理员身份撤回这条消息吗？' : '确定撤回这条消息吗？')) return
    try {
      await onRecall(message.id, admin)
    } catch {
      // 撤回失败由页面 actionError banner 展示
    }
  }

  const buildActionItems = (
    message: NekoMessage,
    own: boolean,
    sticker: boolean,
    senderNekoId: number | null,
  ): MessageActionItem[] => {
    if (message.poke) return []
    const items: MessageActionItem[] = []
    if (message.body && !message.image && !message.bundle) {
      items.push({
        key: 'copy',
        label: '复制',
        onSelect: () => {
          void navigator.clipboard.writeText(message.body).catch(() => window.alert('复制失败，请手动选择文字'))
        },
      })
    }
    if (!message.recalled) {
      items.push({ key: 'reply', label: '回复', onSelect: () => startReply(message) })
      items.push({ key: 'forward', label: '转发', onSelect: () => startForward(message) })
      items.push({
        key: 'select',
        label: '多选',
        onSelect: () => {
          enterSelectMode()
          toggleSelect(message.id)
        },
      })
    }
    if (own && recallableOf(message) && onRecall) {
      items.push({ key: 'recall', label: '撤回', danger: true, onSelect: () => void handleRecall(message) })
    }
    if (!own && conversation?.kind === 'room' && isOwner && onRecall) {
      items.push({
        key: 'admin-recall',
        label: '管理员撤回',
        danger: true,
        onSelect: () => void handleRecall(message, true),
      })
    }
    if (!own && sticker && onSaveSticker) {
      items.push({ key: 'save-sticker', label: '添加到表情', onSelect: () => void onSaveSticker(message) })
    }
    if (!own && senderNekoId && onPoke) {
      items.push({ key: 'poke', label: '拍一拍', onSelect: () => void onPoke(senderNekoId) })
    }
    return items
  }

  const recallableOf = (message: NekoMessage): boolean => {
    return !!onRecall && canRecall(message, Date.now())
  }

  const openAnnouncement = (editing = false) => {
    if (!roomInfo) return
    setAnnouncementText(roomInfo.announcement ?? '')
    setAnnouncementAck(!!roomInfo.announcementAckRequired)
    setAnnouncementError('')
    setAnnouncementEditing(editing && canEditAnnouncement)
    setAnnouncementOpen(true)
  }

  const saveAnnouncement = async () => {
    if (!onSaveAnnouncement) return
    setAnnouncementSaving(true)
    setAnnouncementError('')
    try {
      await onSaveAnnouncement(announcementText, announcementAck)
      setAnnouncementEditing(false)
    } catch (err) {
      setAnnouncementError(err instanceof Error && err.message ? err.message : '保存群公告失败')
    } finally {
      setAnnouncementSaving(false)
    }
  }

  const confirmAnnouncement = async () => {
    if (!onAckAnnouncement) return
    setAckSaving(true)
    setAckError('')
    try {
      await onAckAnnouncement()
      setAckOpen(false)
    } catch (err) {
      setAckError(err instanceof Error && err.message ? err.message : '确认公告失败')
    } finally {
      setAckSaving(false)
    }
  }

  const dismissAnnouncementBanner = () => {
    if (!roomInfo) return
    setDismissedAnnouncements((prev) => {
      const next = { ...prev, [String(roomInfo.id)]: roomInfo.announcementUpdatedAt || 0 }
      writeAnnouncementDismissed(next)
      return next
    })
  }

  const announcementDismissed = roomInfo
    ? dismissedAnnouncements[String(roomInfo.id)] === (roomInfo.announcementUpdatedAt || 0)
    : false
  const showAnnouncementBanner = !!roomInfo?.announcement && !announcementDismissed

  if (!conversation) {
    return (
      <section className="gh-chat-thread gh-chat-thread--empty" aria-label="聊天窗口">
        <div className="gh-chat-empty">
          <svg width="48" height="48" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 2.75c-3.1 0-5.5 2.1-5.5 4.7 0 1.4.72 2.62 1.87 3.44l-.57 2.11 2.35-1.1c.58.17 1.2.26 1.85.26 3.1 0 5.5-2.1 5.5-4.71S11.1 2.75 8 2.75Z" />
          </svg>
          <p className="gh-chat-empty-title">{emptyMessage}</p>
          <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm gh-chat-back-inline" onClick={onBack}>
            返回会话列表
          </button>
        </div>
      </section>
    )
  }

  const title = conversation.title
  const onlineMembers = isGroup ? conversation.members.filter((member) => member.online).length : 0
  const subtitle = isGroup
    ? [
        `${conversation.members.length} 位成员`,
        onlineMembers > 0 ? `${onlineMembers} 在线` : '',
        isLobby ? '全员大厅' : isBigGroup ? 'LineWeb 官方大群' : '',
      ].filter(Boolean).join(' · ')
    : conversation.contact
      ? conversation.contact.kind === 'native'
        ? `@${conversation.contact.username} · neko 用户`
        : conversation.contact.online
          ? '在线'
          : '私聊'
      : '私聊'
  const memberKeyword = memberQuery.trim().toLowerCase()
  const visibleMemberList = memberKeyword
    ? conversation.members.filter((member) =>
        (member.displayName || member.username).toLowerCase().includes(memberKeyword)
        || member.username.toLowerCase().includes(memberKeyword),
      )
    : conversation.members

  const submitRename = async () => {
    const next = renameValue.trim()
    if (!next || next === conversation.room?.name) {
      setRenaming(false)
      return
    }
    try {
      await onRename(next)
      setRenaming(false)
    } catch {
      // 错误由页面统一展示，保持编辑状态方便重试
    }
  }

  return (
    <section className="gh-chat-thread" aria-label="聊天窗口">
      <header className="gh-chat-thread-header">
        <button type="button" className="gh-chat-back" aria-label="返回会话列表" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9.5 3.5-4.5 4.5 4.5 4.5" />
          </svg>
        </button>
        <NekoAvatar
          nekoId={conversation.avatarNekoId}
          avatarVersion={conversation.avatarVersion}
          fallbackId={conversation.avatarId}
          name={conversation.avatarName}
          size="md"
        />
        <div className="gh-chat-thread-title">
          {renaming ? (
            <form
              className="gh-chat-rename-form"
              onSubmit={(event) => {
                event.preventDefault()
                void submitRename()
              }}
            >
              <input
                className="gh-input gh-chat-rename-input"
                value={renameValue}
                maxLength={30}
                aria-label="群聊名称"
                onChange={(event) => setRenameValue(event.target.value)}
              />
              <button type="submit" className="gh-btn gh-btn--primary gh-btn--sm">保存</button>
              <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={() => setRenaming(false)}>取消</button>
            </form>
          ) : (
            <>
              <p className="gh-chat-thread-name">
                <span className="gh-chat-thread-name-text">{title}</span>
                {isLobby && <span className="gh-chat-official-tag gh-chat-official-tag--lobby">大厅</span>}
                {isBigGroup && <span className="gh-chat-official-tag">官方</span>}
              </p>
              <p className="gh-chat-thread-subtitle">{subtitle}</p>
            </>
          )}
        </div>
        <div className="gh-chat-thread-actions">
          {isGroup && !selecting && (
            <button
              type="button"
              className={`gh-chat-thread-icon-btn ${showAnnouncementBanner ? 'gh-chat-thread-icon-btn--active' : ''}`}
              title={roomInfo?.announcement ? '查看群公告' : canEditAnnouncement ? '发布群公告' : '暂无群公告'}
              aria-label="群公告"
              onClick={() => openAnnouncement(false)}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2.5 6.5v3l1.5.5 8 3.5V3L4 6.5z" />
                <path d="M4.5 10v2.5a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1V10M14 7v2" />
              </svg>
            </button>
          )}
          {!selecting && (
            <button
              type="button"
              className="gh-chat-thread-text-btn"
              title="多选转发聊天记录"
              disabled={messages.length === 0}
              onClick={enterSelectMode}
            >
              多选
            </button>
          )}
          {!isGroup && !selecting && conversation.contact?.isFriend && onSetRemark && (
            <div className="gh-chat-thread-more" ref={menuRef}>
              <button
                type="button"
                className="gh-chat-thread-more-btn"
                aria-label="会话操作"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((prev) => !prev)}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <circle cx="3" cy="8" r="1.4" />
                  <circle cx="8" cy="8" r="1.4" />
                  <circle cx="13" cy="8" r="1.4" />
                </svg>
              </button>
              {menuOpen && (
                <div className="gh-chat-thread-menu" role="menu" aria-label="会话操作">
                  <button
                    type="button"
                    role="menuitem"
                    className="gh-chat-thread-menu-item"
                    onClick={() => {
                      setMenuOpen(false)
                      onSetRemark(conversation.contact!)
                    }}
                  >
                    设置备注
                  </button>
                </div>
              )}
            </div>
          )}
          {isGroup && !selecting && (
            <div className="gh-chat-thread-more" ref={menuRef}>
              <button
                type="button"
                className="gh-chat-thread-more-btn"
                aria-label="群聊操作"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((prev) => !prev)}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <circle cx="3" cy="8" r="1.4" />
                  <circle cx="8" cy="8" r="1.4" />
                  <circle cx="13" cy="8" r="1.4" />
                </svg>
              </button>
              {menuOpen && (
                <div className="gh-chat-thread-menu" role="menu" aria-label="群聊操作">
                  <button
                    type="button"
                    role="menuitem"
                    className="gh-chat-thread-menu-item"
                    onClick={() => {
                      setMenuOpen(false)
                      openAnnouncement(false)
                    }}
                  >
                    {roomInfo?.announcement ? '查看群公告' : '群公告'}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="gh-chat-thread-menu-item"
                    onClick={() => {
                      setMenuOpen(false)
                      setMemberQuery('')
                      setMembersOpen(true)
                    }}
                  >
                    群成员（{conversation.members.length}）
                  </button>
                  {isOwner && !isLobby && !isBigGroup && (
                    <button
                      type="button"
                      role="menuitem"
                      className="gh-chat-thread-menu-item"
                      onClick={() => {
                        setMenuOpen(false)
                        onAddMembers()
                      }}
                    >
                      添加成员
                    </button>
                  )}
                  {isOwner && !isLobby && (
                    <button
                      type="button"
                      role="menuitem"
                      className="gh-chat-thread-menu-item"
                      onClick={() => {
                        setMenuOpen(false)
                        setRenameValue(conversation.room?.name ?? '')
                        setRenaming(true)
                      }}
                    >
                      修改群名
                    </button>
                  )}
                  {(isLobby || isBigGroup) && (
                    <p className="gh-chat-thread-menu-note">
                      {isLobby ? '全员大厅由聊天服务维护，成员自动同步' : '官方大群由 LineWeb 自动维护成员'}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {isGroup && membersOpen && (
          <div className="gh-chat-members-popover" role="dialog" aria-label="群聊成员">
            <div className="gh-chat-members-head">
              <p className="gh-chat-members-title">成员（{conversation.members.length}）</p>
              <button
                type="button"
                className="gh-chat-members-close"
                aria-label="关闭成员列表"
                onClick={() => setMembersOpen(false)}
              >
                ×
              </button>
            </div>
            {conversation.members.length > 12 && (
              <input
                className="gh-input gh-chat-members-search"
                type="search"
                value={memberQuery}
                placeholder={`搜索 ${conversation.members.length} 位成员`}
                aria-label="搜索群成员"
                onChange={(event) => setMemberQuery(event.target.value)}
              />
            )}
            <ul className="gh-chat-members-list">
              {visibleMemberList.map((member) => {
                const isMe = selfNekoId !== null && member.nekoId === selfNekoId
                return (
                  <li key={member.nekoId} className="gh-chat-member-row">
                    <NekoAvatar
                      nekoId={member.nekoId}
                      avatarVersion={member.avatarVersion}
                      fallbackId={member.linewebId ?? -member.nekoId}
                      name={member.displayName || member.username}
                      size="sm"
                    />
                    <span className="gh-chat-member-name">
                      {member.displayName || member.username}
                      {member.kind === 'native' && <span className="gh-chat-member-tag">neko</span>}
                      {member.online && <span className="gh-chat-member-online" title="在线" />}
                    </span>
                    {member.role === 'owner' && <span className="gh-chat-member-role">群主</span>}
                    {member.role === 'admin' && <span className="gh-chat-member-role">管理员</span>}
                    {isOwner && !isLobby && !isBigGroup && !isMe && member.role !== 'owner' && (
                      <button
                        type="button"
                        className="gh-btn gh-btn--danger gh-btn--sm"
                        onClick={() => onRemoveMember(member.nekoId)}
                      >
                        移出
                      </button>
                    )}
                  </li>
                )
              })}
              {visibleMemberList.length === 0 && (
                <li className="gh-chat-member-empty">没有匹配的成员</li>
              )}
            </ul>
            <div className="gh-chat-members-footer">
              {isLobby || isBigGroup ? (
                <span className="gh-chat-members-note">
                  {isLobby ? '全员大厅成员自动同步，不可退出或解散' : '官方大群成员由 LineWeb 自动维护'}
                </span>
              ) : myRole === 'owner' ? (
                <button type="button" className="gh-btn gh-btn--danger gh-btn--sm" onClick={onDissolve}>
                  解散群聊
                </button>
              ) : (
                <button type="button" className="gh-btn gh-btn--danger gh-btn--sm" onClick={onLeave}>
                  退出群聊
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      {isGroup && showAnnouncementBanner && (
        <div className={`gh-chat-announce-banner ${roomInfo?.announcementAckRequired ? 'gh-chat-announce-banner--ack' : ''}`}>
          <span className="gh-chat-announce-icon" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2.5 6.5v3l1.5.5 8 3.5V3L4 6.5z" />
              <path d="M4.5 10v2.5a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1V10M14 7v2" />
            </svg>
          </span>
          <button type="button" className="gh-chat-announce-body" onClick={() => openAnnouncement(false)}>
            <span className="gh-chat-announce-label">
              群公告
              {roomInfo?.announcementAckRequired
                && (roomInfo.announcementConfirmedAt || 0) < (roomInfo.announcementUpdatedAt || 0)
                && <span className="gh-chat-announce-pending">待确认</span>}
            </span>
            <span className="gh-chat-announce-text">{roomInfo?.announcement}</span>
          </button>
          <button
            type="button"
            className="gh-chat-announce-close"
            aria-label="不再显示这条群公告"
            title="不再显示这条公告（公告更新后会重新出现）"
            onClick={dismissAnnouncementBanner}
          >
            ×
          </button>
        </div>
      )}

      {selecting && (
        <div className="gh-chat-select-bar" role="toolbar" aria-label="转发聊天记录">
          <span className="gh-chat-select-count">已选 {selectedIds.size} 条</span>
          <span className="gh-chat-select-hint">最多 {SELECT_MAX} 条</span>
          <button
            type="button"
            className="gh-btn gh-btn--primary gh-btn--sm"
            disabled={selectedIds.size === 0}
            onClick={() => {
              setForwardError(null)
              setForwardOpen(true)
            }}
          >
            转发
          </button>
          <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={exitSelectMode}>
            取消
          </button>
        </div>
      )}

      <div className="gh-chat-messages" ref={listRef} onScroll={handleScroll} role="log" aria-label="消息列表">
        {loading && (
          <div className="gh-chat-messages-state">
            <div className="gh-spinner" />
            <span>正在加载消息…</span>
          </div>
        )}

        {!loading && loadingMore && (
          <div className="gh-chat-messages-state">
            <div className="gh-spinner" />
            <span>正在加载更早的消息…</span>
          </div>
        )}

        {!loading && !loadingMore && hasMore && messages.length > 0 && (
          <div className="gh-chat-messages-hint">滚动到顶部加载更早消息</div>
        )}

        {!loading && error && <div className="gh-chat-messages-state gh-chat-messages-state--error">{error}</div>}

        {!loading && !error && messages.length === 0 && (
          <div className="gh-chat-messages-state">
            <p className="gh-chat-messages-empty-title">还没有消息</p>
            <p className="gh-chat-messages-empty-hint">发送第一条消息，开始对话吧。</p>
          </div>
        )}

        {!loading &&
          messages.map((message, index) => {
            const own = message.mine
            const prev = index > 0 ? messages[index - 1] : null
            const showDay = !prev || dayKey(prev.ts) !== dayKey(message.ts)
            const grouped = !!prev
              && !prev.recalled
              && !message.recalled
              && !prev.poke
              && !message.poke
              && prev.fromUsername === message.fromUsername
              && message.ts - prev.ts >= 0
              && message.ts - prev.ts < MESSAGE_GROUP_WINDOW_MS

            // 已撤回：不渲染气泡，改为居中系统行
            if (message.recalled) {
              const who = own ? '你' : senderLabel(message, conversation)
              return (
                <Fragment key={message.id}>
                  {showDay && <div className="gh-chat-day-sep">{formatDaySeparator(message.ts)}</div>}
                  <div className="gh-chat-recall-line" role="status">
                    {`${who}撤回了一条消息`}
                    {message.byAdmin && !own ? '（管理员）' : ''}
                  </div>
                </Fragment>
              )
            }

            const recallable = own && onRecall !== undefined && canRecall(message, now)
            // neko 的表情消息 = body 固定 [表情] + XHTML 图片；渲染成无气泡贴纸
            const isSticker = Boolean(message.image) && message.body === '[表情]'
            const isImage = Boolean(message.image) && !isSticker
            const sender = avatarOf(conversation, message)
            const selected = selectedIds.has(message.id)

            return (
              <Fragment key={message.id}>
              {showDay && <div className="gh-chat-day-sep">{formatDaySeparator(message.ts)}</div>}
              <div
                data-message-id={message.id}
                className={`gh-chat-message ${own ? 'gh-chat-message--own' : ''} ${
                  grouped ? 'gh-chat-message--grouped' : ''
                } ${
                  selecting ? 'gh-chat-message--selectable' : ''
                } ${selected ? 'gh-chat-message--selected' : ''} ${
                  flashId === message.id ? 'gh-chat-message--flash' : ''
                } ${actionMenu?.message.id === message.id ? 'gh-chat-message--active' : ''}`}
                onPointerDown={(event) => {
                  if (selecting) return
                  pressedMessageRef.current = message
                  longPress.begin(event)
                }}
                onPointerMove={longPress.move}
                onPointerUp={longPress.end}
                onPointerCancel={longPress.end}
                onContextMenu={(event) => {
                  if (selecting) return
                  event.preventDefault()
                  setActionMenu({ message, x: event.clientX, y: event.clientY })
                }}
              >
                {selecting && (
                  <button
                    type="button"
                    className={`gh-chat-select-toggle ${selected ? 'gh-chat-select-toggle--on' : ''}`}
                    aria-label={selected ? '取消选择该消息' : '选择该消息'}
                    aria-pressed={selected}
                    onClick={() => toggleSelect(message.id)}
                  >
                    {selected ? '✓' : ''}
                  </button>
                )}
                {!own && grouped && <span className="gh-chat-avatar-spacer" aria-hidden="true" />}
                {!own && !grouped && (
                  <span
                    className="gh-chat-avatar-poke"
                    title="双击拍一拍"
                    onDoubleClick={() => {
                      if (!sender.nekoId) return
                      // 触屏双击路径已经发过时跳过浏览器补发的 dblclick
                      if (Date.now() - lastPokeSentRef.current < 500) return
                      lastPokeSentRef.current = Date.now()
                      void onPoke?.(sender.nekoId)
                    }}
                    onTouchEnd={() => {
                      if (sender.nekoId) handlePoke(sender.nekoId)
                    }}
                  >
                    <NekoAvatar
                      nekoId={sender.nekoId}
                      avatarVersion={sender.avatarVersion}
                      fallbackId={sender.id}
                      name={sender.name}
                      size="sm"
                    />
                  </span>
                )}
                <div className="gh-chat-message-body">
                  <div className={`gh-chat-message-meta ${grouped ? 'gh-chat-message-meta--grouped' : ''}`}>
                    {!own && !grouped && <span className="gh-chat-message-sender">{sender.name}</span>}
                    <time className="gh-chat-message-time" dateTime={new Date(message.ts).toISOString()}>
                      {formatMessageTime(message.ts)}
                    </time>
                    {own && conversation?.kind === 'direct' && !message.recalled && (
                      <span className="gh-chat-read-tag" title="对方是否已读">
                        {message.id <= peerRead ? '已读' : '未读'}
                      </span>
                    )}
                    {message.mentionedMe && <span className="gh-chat-at-badge">@我</span>}
                    {!selecting && (
                      <button
                        type="button"
                        className="gh-chat-message-more"
                        aria-label="消息操作"
                        title="消息操作"
                        onClick={(event) => {
                          event.stopPropagation()
                          const rect = event.currentTarget.getBoundingClientRect()
                          setActionMenu({ message, x: rect.left, y: rect.bottom + 4 })
                        }}
                      >
                        ···
                      </button>
                    )}
                  </div>
                  {message.quote && (
                    <button
                      type="button"
                      className="gh-chat-quote"
                      title="跳到被引用的消息"
                      onClick={() => jumpToMessage(message.quote!.id)}
                    >
                      <span className="gh-chat-quote-name">{displayNameOf(message.quote.from)}</span>
                      <span className="gh-chat-quote-text">{message.quote.text}</span>
                    </button>
                  )}
                  {message.poke ? (
                    <div className={`gh-chat-poke ${message.poke.toNekoId === selfNekoId ? 'gh-chat-poke--me' : ''}`} role="note">
                      {message.mine ? '你' : sender.name} 拍了拍 {nameOfNekoId(message.poke.toNekoId)}
                    </div>
                  ) : message.bundle ? (
                    <button
                      type="button"
                      className="gh-chat-bundle"
                      aria-label="查看聊天记录"
                      onClick={() => {
                        if (longPress.wasLongPress()) return
                        setBundlePreview(message.bundle)
                      }}
                    >
                      <span className="gh-chat-bundle-title">聊天记录</span>
                      <span className="gh-chat-bundle-lines">
                        {message.bundle.slice(0, 3).map((item, index) => (
                          <span key={`${item.t}-${index}`} className="gh-chat-bundle-line">
                            {`${displayNameOf(item.n)}：${item.r ? '消息已撤回' : item.b || '[图片]'}`}
                          </span>
                        ))}
                      </span>
                      <span className="gh-chat-bundle-more">
                        共 {message.bundle.length} 条 · 点击查看
                      </span>
                    </button>
                  ) : isSticker ? (
                    <img
                      className="gh-chat-message-sticker"
                      src={chatImageUrl(message.image)}
                      alt="表情"
                      loading="lazy"
                    />
                  ) : isImage ? (
                    <button
                      type="button"
                      className="gh-chat-message-image-wrap"
                      aria-label="查看大图"
                      onClick={() => {
                        if (longPress.wasLongPress()) return
                        setPreviewImage(message.image)
                      }}
                    >
                      <img
                        className="gh-chat-message-image"
                        src={chatImageUrl(message.image)}
                        alt="图片消息"
                        loading="lazy"
                      />
                    </button>
                  ) : (
                    <div className={`gh-chat-message-bubble ${message.mentionedMe ? 'gh-chat-message-bubble--mention' : ''}`}>
                      {conversation?.kind === 'room'
                        ? renderMentionText(message.body, conversation.members)
                        : message.body}
                    </div>
                  )}
                </div>
              </div>
              </Fragment>
            )
          })}
      </div>

      {!atBottom && !loading && messages.length > 0 && (
        <button type="button" className="gh-chat-jump-latest" onClick={scrollToLatest}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" />
          </svg>
          回到最新
        </button>
      )}

      {announcementOpen && roomInfo && (
        <div
          className="gh-dialog-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !announcementSaving) setAnnouncementOpen(false)
          }}
        >
          <div className="gh-dialog gh-chat-announce-dialog" role="dialog" aria-modal="true" aria-label="群公告">
            <div className="gh-chat-announce-dialog-head">
              <div>
                <p className="gh-announce-eyebrow">neko · 群公告</p>
                <h3 className="gh-dialog-title">{isLobby ? '全员大厅公告' : roomInfo.name}</h3>
              </div>
              <button
                type="button"
                className="gh-announce-close"
                aria-label="关闭群公告"
                onClick={() => setAnnouncementOpen(false)}
              >
                ×
              </button>
            </div>
            {announcementError && <div className="gh-alert gh-alert--danger" role="alert">{announcementError}</div>}
            {announcementEditing ? (
              <>
                <textarea
                  className="gh-input gh-chat-announce-input"
                  rows={6}
                  maxLength={500}
                  value={announcementText}
                  placeholder="输入群公告（留空则清除）"
                  onChange={(event) => setAnnouncementText(event.target.value)}
                  disabled={announcementSaving}
                />
                <label className="gh-chat-announce-ack">
                  <input
                    type="checkbox"
                    checked={announcementAck}
                    onChange={(event) => setAnnouncementAck(event.target.checked)}
                    disabled={announcementSaving}
                  />
                  需要群员确认（未确认的成员进群时弹窗展示公告）
                </label>
                <div className="gh-dialog-actions">
                  <span className="gh-chat-announce-count">{announcementText.length}/500</span>
                  <button
                    type="button"
                    className="gh-btn gh-btn--secondary gh-btn--md"
                    disabled={announcementSaving}
                    onClick={() => setAnnouncementEditing(false)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="gh-btn gh-btn--primary gh-btn--md"
                    disabled={announcementSaving}
                    onClick={() => void saveAnnouncement()}
                  >
                    {announcementSaving ? '保存中…' : '保存公告'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="gh-chat-announce-view">
                  {roomInfo.announcement
                    ? roomInfo.announcement
                    : <span className="gh-text-tertiary">本群暂无公告。</span>}
                </div>
                <div className="gh-chat-announce-meta">
                  {roomInfo.announcementUpdatedAt
                    ? `更新于 ${new Date(roomInfo.announcementUpdatedAt).toLocaleString('zh-CN')}`
                    : ''}
                  {roomInfo.announcementAckRequired ? ' · 需要群员确认' : ''}
                </div>
                <div className="gh-dialog-actions">
                  <button
                    type="button"
                    className="gh-btn gh-btn--secondary gh-btn--md"
                    onClick={() => setAnnouncementOpen(false)}
                  >
                    关闭
                  </button>
                  {canEditAnnouncement && (
                    <button
                      type="button"
                      className="gh-btn gh-btn--primary gh-btn--md"
                      onClick={() => setAnnouncementEditing(true)}
                    >
                      编辑公告
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {ackOpen && roomInfo && (
        <div className="gh-dialog-overlay gh-dialog-overlay--ack" role="presentation">
          <div className="gh-dialog gh-chat-announce-dialog" role="dialog" aria-modal="true" aria-label="群公告确认">
            <div className="gh-chat-announce-dialog-head">
              <div>
                <p className="gh-announce-eyebrow">需要确认的群公告</p>
                <h3 className="gh-dialog-title">{isLobby ? '全员大厅公告' : roomInfo.name}</h3>
              </div>
              <button
                type="button"
                className="gh-announce-close"
                aria-label="关闭"
                onClick={() => setAckOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="gh-chat-announce-view">{roomInfo.announcement}</div>
            {ackError && <div className="gh-alert gh-alert--danger" role="alert">{ackError}</div>}
            <div className="gh-dialog-actions">
              <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={() => setAckOpen(false)}>
                稍后确认
              </button>
              <button
                type="button"
                className="gh-btn gh-btn--primary gh-btn--md"
                disabled={ackSaving}
                onClick={() => void confirmAnnouncement()}
              >
                {ackSaving ? '确认中…' : '我知道了'}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewImage && (
        <ChatImageLightbox
          src={chatImageUrl(previewImage)}
          alt="图片预览"
          onClose={() => setPreviewImage(null)}
        />
      )}

      {onSendSticker && onAddSticker && onRemoveSticker && (
        <ChatStickerPanel
          open={stickersOpen}
          stickers={stickers}
          onSend={(sticker) => {
            onSendSticker(sticker)
            setStickersOpen(false)
          }}
          onAdd={onAddSticker}
          onRemove={onRemoveSticker}
          onClose={() => setStickersOpen(false)}
        />
      )}

      <ChatBundleDialog
        open={bundlePreview !== null}
        items={bundlePreview ?? []}
        conversation={conversation}
        selfNekoId={selfNekoId}
        resolveSender={(item) => {
          // 跨会话转发的发送者可能不在当前会话里：按全部会话成员/联系人解析，解析不到回退用户名
          if (selfNekoId !== null && item.u === selfNekoId) return '你'
          const pools = [
            ...forwardTargets,
            ...(conversation ? [conversation] : []),
          ]
          for (const target of pools) {
            const member = target.members.find((entry) => entry.nekoId === item.u)
            if (member) return member.displayName || member.username
            const contact = target.contact
            if (contact && contact.nekoId === item.u) {
              return contact.remark || contact.displayName || contact.username
            }
          }
          return null
        }}
        onClose={() => setBundlePreview(null)}
      />

      {actionMenu && (() => {
        const message = actionMenu.message
        const key = conversation?.key
        const senderNekoId = message.fromNekoId
          ?? (conversation?.kind === 'direct'
            ? conversation.contact?.nekoId ?? null
            : conversation?.members.find((member) => member.username === message.fromUsername)?.nekoId ?? null)
        const items = buildActionItems(
          message,
          message.mine,
          Boolean(message.image) && message.body === '[表情]',
          senderNekoId,
        )
        return (
          <MessageActionMenu
            key={key}
            x={actionMenu.x}
            y={actionMenu.y}
            items={items}
            onClose={() => setActionMenu(null)}
          />
        )
      })()}

      <ChatForwardDialog
        open={forwardOpen}
        sourceKey={conversation.key}
        sourceTitle={conversation.title}
        count={selectedIds.size}
        conversations={forwardTargets}
        loading={forwarding}
        error={forwardError}
        onClose={() => {
          if (forwarding) return
          setForwardOpen(false)
          setForwardError(null)
        }}
        onSubmit={(targets, mode) => void submitForward(targets, mode)}
      />

      <ChatComposer
        onSend={handleSend}
        members={conversation.kind === 'room' ? conversation.members : []}
        selfNekoId={selfNekoId}
        canMentionAll={conversation.kind === 'room'
          && (conversation.room?.myRole === 'owner' || conversation.room?.myRole === 'admin')}
        onSendImage={onSendImage}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onToggleStickers={
          onSendSticker ? () => setStickersOpen((open) => !open) : undefined
        }
        stickersOpen={stickersOpen}
        disabled={!conversation.canSend}
        disabledHint={
          conversation.kind === 'room'
            ? '全员禁言中，只有群主和管理员可以发言'
            : '当前会话已禁止发送消息'
        }
      />
    </section>
  )
}
