import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import UserAvatar from '../UserAvatar'
import ChatComposer from './ChatComposer'
import ChatImageLightbox from './ChatImageLightbox'
import { canRecall, chatImageUrl, displayName } from '../../lib/chat'
import type { Conversation, Message } from '../../types/chat'

interface Props {
  conversation: Conversation | null
  meId: number
  messages: Message[]
  loading?: boolean
  loadingMore?: boolean
  hasMore?: boolean
  error?: string | null
  emptyMessage?: string
  onBack: () => void
  onSend: (content: string) => Promise<void> | void
  /** 发送图片（页面负责上传与错误提示） */
  onSendImage?: (file: File) => Promise<void> | void
  /** 撤回消息（确认逻辑在 ChatThread 内，页面只负责请求） */
  onRecall?: (messageId: number) => Promise<void> | void
  onLoadMore: () => void
  onAddMembers: () => void
  onRemoveMember: (userId: number) => void
  onRename: (name: string) => Promise<void> | void
  onDissolve: () => void
  onLeave: () => void
}

function formatMessageTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

/** 图片消息的 width/height 属性（有元数据时用于占位防跳动） */
function imageDimensions(message: Message): { width?: number; height?: number } {
  const width = message.image?.width
  const height = message.image?.height
  if (typeof width === 'number' && width > 0 && typeof height === 'number' && height > 0) {
    return { width, height }
  }
  return {}
}

function groupAvatarName(conversation: Conversation, meId: number): string {
  return displayName(conversation, meId)
}

export default function ChatThread({
  conversation,
  meId,
  messages,
  loading = false,
  loadingMore = false,
  hasMore = false,
  error = null,
  emptyMessage = '选择一个会话，开始聊天',
  onBack,
  onSend,
  onSendImage,
  onRecall,
  onLoadMore,
  onAddMembers,
  onRemoveMember,
  onRename,
  onDissolve,
  onLeave,
}: Props) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const pendingPrependRef = useRef(false)
  const previousScrollHeightRef = useRef(0)
  const previousLastIdRef = useRef<number | null>(null)
  const previousCountRef = useRef(0)

  const [membersOpen, setMembersOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [previewImage, setPreviewImage] = useState<Message | null>(null)
  // 用于「撤回」按钮的 2 分钟窗口自动消失：低频 tick 触发重渲染
  const [now, setNow] = useState(() => Date.now())
  const menuRef = useRef<HTMLDivElement | null>(null)

  const conversationId = conversation?.id ?? null
  const isOwner = conversation !== null && conversation.ownerId === meId
  const isGroup = conversation?.type === 'group'

  // 切换会话时回到最新消息
  useEffect(() => {
    stickToBottomRef.current = true
    pendingPrependRef.current = false
    previousLastIdRef.current = null
    setMembersOpen(false)
    setMenuOpen(false)
    setRenaming(false)
    setPreviewImage(null)
    const element = listRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [conversationId])

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

  // 低频刷新当前时间，让超过 2 分钟的「撤回」按钮自动消失（卸载时清理）
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
    if (element.scrollTop < 48 && hasMore && !loadingMore && !loading && messages.length > 0) {
      pendingPrependRef.current = true
      previousScrollHeightRef.current = element.scrollHeight
      onLoadMore()
    }
  }

  const handleSend = async (content: string) => {
    stickToBottomRef.current = true
    await onSend(content)
  }

  const handleRecall = async (message: Message) => {
    if (!onRecall) return
    if (!window.confirm('确定撤回这条消息吗？')) return
    try {
      await onRecall(message.id)
    } catch {
      // 撤回失败由页面 actionError banner 展示
    }
  }

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

  const title = displayName(conversation, meId)
  const partner = conversation.type === 'direct'
    ? conversation.members.find((member) => member.id !== meId)
    : null
  const avatarId = partner?.id ?? conversation.id
  const avatarName = partner?.username ?? groupAvatarName(conversation, meId)
  const subtitle = conversation.type === 'group'
    ? `${conversation.members.length} 位成员`
    : conversation.canSend
      ? '私聊'
      : '你们已不是好友'

  const submitRename = async () => {
    const next = renameValue.trim()
    if (!next || next === conversation.name) {
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
        <UserAvatar userId={avatarId} username={avatarName} size="md" />
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
                maxLength={40}
                aria-label="群聊名称"
                onChange={(event) => setRenameValue(event.target.value)}
              />
              <button type="submit" className="gh-btn gh-btn--primary gh-btn--sm">保存</button>
              <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={() => setRenaming(false)}>取消</button>
            </form>
          ) : (
            <>
              <p className="gh-chat-thread-name">{title}</p>
              <p className={`gh-chat-thread-subtitle ${!conversation.canSend && conversation.type === 'direct' ? 'gh-chat-thread-subtitle--warn' : ''}`}>
                {subtitle}
              </p>
            </>
          )}
        </div>
        <div className="gh-chat-thread-actions">
          {isGroup && (
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
                      setMembersOpen(true)
                    }}
                  >
                    群成员（{conversation.members.length}）
                  </button>
                  {isOwner && (
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
                  {isOwner && (
                    <button
                      type="button"
                      role="menuitem"
                      className="gh-chat-thread-menu-item"
                      onClick={() => {
                        setMenuOpen(false)
                        setRenameValue(conversation.name)
                        setRenaming(true)
                      }}
                    >
                      修改群名
                    </button>
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
            <ul className="gh-chat-members-list">
              {conversation.members.map((member) => (
                <li key={member.id} className="gh-chat-member-row">
                  <UserAvatar userId={member.id} username={member.username} size="sm" />
                  <span className="gh-chat-member-name">{member.username}</span>
                  {(member.role === 'owner' || member.id === conversation.ownerId) && (
                    <span className="gh-chat-member-role">群主</span>
                  )}
                  {isOwner && member.id !== meId && (
                    <button
                      type="button"
                      className="gh-btn gh-btn--danger gh-btn--sm"
                      onClick={() => onRemoveMember(member.id)}
                    >
                      移出
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className="gh-chat-members-footer">
              {isOwner ? (
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
          messages.map((message) => {
            const own = message.senderId === meId

            // 已撤回：不渲染气泡，改为居中系统行
            if (message.recalledAt) {
              return (
                <div key={message.id} className="gh-chat-recall-line" role="status">
                  {own ? '你撤回了一条消息' : `${message.sender.username} 撤回了一条消息`}
                </div>
              )
            }

            const recallable = own && onRecall !== undefined && canRecall(message, meId, now)
            const isImage = message.type === 'image'

            return (
              <div
                key={message.id}
                className={`gh-chat-message ${own ? 'gh-chat-message--own' : ''}`}
              >
                {!own && <UserAvatar userId={message.sender.id} username={message.sender.username} size="sm" />}
                <div className="gh-chat-message-body">
                  <div className="gh-chat-message-meta">
                    {!own && <span className="gh-chat-message-sender">{message.sender.username}</span>}
                    <time className="gh-chat-message-time" dateTime={message.createdAt}>
                      {formatMessageTime(message.createdAt)}
                    </time>
                    {recallable && (
                      <button
                        type="button"
                        className="gh-chat-recall-btn"
                        title="撤回这条消息"
                        onClick={() => void handleRecall(message)}
                      >
                        撤回
                      </button>
                    )}
                  </div>
                  {isImage ? (
                    <button
                      type="button"
                      className="gh-chat-message-image-wrap"
                      aria-label="查看大图"
                      onClick={() => setPreviewImage(message)}
                    >
                      <img
                        className="gh-chat-message-image"
                        src={chatImageUrl(message.id)}
                        alt="图片消息"
                        loading="lazy"
                        {...imageDimensions(message)}
                      />
                    </button>
                  ) : (
                    <div className="gh-chat-message-bubble">{message.content}</div>
                  )}
                </div>
              </div>
            )
          })}
      </div>

      {previewImage && (
        <ChatImageLightbox
          src={chatImageUrl(previewImage.id)}
          alt="图片预览"
          onClose={() => setPreviewImage(null)}
        />
      )}

      <ChatComposer
        onSend={handleSend}
        onSendImage={onSendImage}
        disabled={!conversation.canSend}
        disabledHint={conversation.type === 'direct' ? '你们已不是好友，无法继续发送消息' : '当前会话已禁止发送消息'}
      />
    </section>
  )
}
