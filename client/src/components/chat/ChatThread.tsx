import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import UserAvatar from '../UserAvatar'
import ChatComposer from './ChatComposer'
import ChatImageLightbox from './ChatImageLightbox'
import ChatStickerPanel from './ChatStickerPanel'
import { canRecall, chatImageUrl, senderLabel } from '../../lib/chat'
import type { NekoConversation, NekoMessage, NekoSticker } from '../../types/chat'

interface Props {
  conversation: NekoConversation | null
  /** 自己的 neko id（用于群成员「移出」按钮的显示） */
  selfNekoId: number | null
  messages: NekoMessage[]
  loading?: boolean
  loadingMore?: boolean
  hasMore?: boolean
  error?: string | null
  emptyMessage?: string
  onBack: () => void
  onSend: (content: string) => Promise<void> | void
  /** 发送图片（页面负责上传与错误提示） */
  onSendImage?: (file: File) => Promise<void> | void
  /** 表情包（三项都传入才渲染表情入口） */
  stickers?: NekoSticker[]
  onSendSticker?: (sticker: NekoSticker) => void
  onAddSticker?: (file: File) => Promise<void> | void
  onRemoveSticker?: (id: number) => Promise<void> | void
  /** 撤回消息（确认逻辑在 ChatThread 内，页面只负责请求） */
  onRecall?: (messageId: number) => Promise<void> | void
  onLoadMore: () => void
  onAddMembers: () => void
  onRemoveMember: (nekoId: number) => void
  onRename: (name: string) => Promise<void> | void
  onDissolve: () => void
  onLeave: () => void
}

function formatMessageTime(value: number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function avatarOf(conversation: NekoConversation, message: NekoMessage): { id: number; name: string } {
  if (conversation.kind === 'direct') {
    return { id: conversation.avatarId, name: conversation.avatarName }
  }
  const member = conversation.members.find((item) => item.username === message.fromUsername)
  if (!member) return { id: -1, name: message.fromUsername || '未知用户' }
  return {
    id: member.linewebId ?? -member.nekoId,
    name: member.displayName || member.username,
  }
}

export default function ChatThread({
  conversation,
  selfNekoId,
  messages,
  loading = false,
  loadingMore = false,
  hasMore = false,
  error = null,
  emptyMessage = '选择一个会话，开始聊天',
  onBack,
  onSend,
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
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [stickersOpen, setStickersOpen] = useState(false)
  // 「撤回」按钮的 5 分钟窗口需要自动消失：低频 tick 触发重渲染
  const [now, setNow] = useState(() => Date.now())
  const menuRef = useRef<HTMLDivElement | null>(null)

  const conversationKey = conversation?.key ?? null
  const myRole = conversation?.room?.myRole ?? ''
  const isOwner = conversation?.kind === 'room' && (myRole === 'owner' || myRole === 'admin')
  const isGroup = conversation?.kind === 'room'

  // 切换会话时回到最新消息
  useEffect(() => {
    stickToBottomRef.current = true
    pendingPrependRef.current = false
    previousLastIdRef.current = null
    setMembersOpen(false)
    setMenuOpen(false)
    setRenaming(false)
    setPreviewImage(null)
    setStickersOpen(false)
    const element = listRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [conversationKey])

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

  const handleRecall = async (message: NekoMessage) => {
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

  const title = conversation.title
  const subtitle = isGroup
    ? `${conversation.members.length} 位成员`
    : conversation.contact
      ? conversation.contact.kind === 'native'
        ? `@${conversation.contact.username} · neko 用户`
        : conversation.contact.online
          ? '在线'
          : '私聊'
      : '私聊'

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
        <UserAvatar userId={conversation.avatarId} username={conversation.avatarName} size="md" />
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
              <p className="gh-chat-thread-name">{title}</p>
              <p className="gh-chat-thread-subtitle">{subtitle}</p>
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
                        setRenameValue(conversation.room?.name ?? '')
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
              {conversation.members.map((member) => {
                const isMe = selfNekoId !== null && member.nekoId === selfNekoId
                return (
                  <li key={member.nekoId} className="gh-chat-member-row">
                    <UserAvatar
                      userId={member.linewebId ?? -member.nekoId}
                      username={member.displayName || member.username}
                      size="sm"
                    />
                    <span className="gh-chat-member-name">
                      {member.displayName || member.username}
                      {member.kind === 'native' && <span className="gh-chat-member-tag">neko</span>}
                    </span>
                    {member.role === 'owner' && <span className="gh-chat-member-role">群主</span>}
                    {member.role === 'admin' && <span className="gh-chat-member-role">管理员</span>}
                    {isOwner && !isMe && member.role !== 'owner' && (
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
            </ul>
            <div className="gh-chat-members-footer">
              {myRole === 'owner' ? (
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
            const own = message.mine

            // 已撤回：不渲染气泡，改为居中系统行
            if (message.recalled) {
              const who = own ? '你' : senderLabel(message, conversation)
              return (
                <div key={message.id} className="gh-chat-recall-line" role="status">
                  {`${who}撤回了一条消息`}
                  {message.byAdmin && !own ? '（管理员）' : ''}
                </div>
              )
            }

            const recallable = own && onRecall !== undefined && canRecall(message, now)
            // neko 的表情消息 = body 固定 [表情] + XHTML 图片；渲染成无气泡贴纸
            const isSticker = Boolean(message.image) && message.body === '[表情]'
            const isImage = Boolean(message.image) && !isSticker
            const sender = avatarOf(conversation, message)

            return (
              <div
                key={message.id}
                className={`gh-chat-message ${own ? 'gh-chat-message--own' : ''}`}
              >
                {!own && <UserAvatar userId={sender.id} username={sender.name} size="sm" />}
                <div className="gh-chat-message-body">
                  <div className="gh-chat-message-meta">
                    {!own && <span className="gh-chat-message-sender">{sender.name}</span>}
                    <time className="gh-chat-message-time" dateTime={new Date(message.ts).toISOString()}>
                      {formatMessageTime(message.ts)}
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
                  {isSticker ? (
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
                      onClick={() => setPreviewImage(message.image)}
                    >
                      <img
                        className="gh-chat-message-image"
                        src={chatImageUrl(message.image)}
                        alt="图片消息"
                        loading="lazy"
                      />
                    </button>
                  ) : (
                    <div className="gh-chat-message-bubble">{message.body}</div>
                  )}
                </div>
              </div>
            )
          })}
      </div>

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

      <ChatComposer
        onSend={handleSend}
        onSendImage={onSendImage}
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
