import { memo, useState } from 'react'
import NekoAvatar from './NekoAvatar'
import { conversationPreview, formatUnread } from '../../lib/chat'
import type { NekoConversation } from '../../types/chat'

interface Props {
  conversations: NekoConversation[]
  activeKey: string | null
  loading?: boolean
  error?: string | null
  onSelect: (conversation: NekoConversation) => void
}

function formatListTime(value: number): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

export default memo(function ChatConversationList({
  conversations,
  activeKey,
  loading = false,
  error = null,
  onSelect,
}: Props) {
  const [query, setQuery] = useState('')

  if (loading) {
    return (
      <div className="gh-chat-list-state">
        <div className="gh-spinner" />
        <span>正在加载会话…</span>
      </div>
    )
  }

  if (error) {
    return <div className="gh-chat-list-state gh-chat-list-state--error">{error}</div>
  }

  if (conversations.length === 0) {
    return (
      <div className="gh-chat-list-state">
        <p className="gh-chat-list-empty-title">还没有会话</p>
        <p className="gh-chat-list-empty-hint">在「好友」页签选择好友开始聊天，或新建群聊。</p>
      </div>
    )
  }

  const keyword = query.trim().toLowerCase()
  const list = keyword
    ? conversations.filter((conversation) =>
        conversation.title.toLowerCase().includes(keyword)
        || conversation.contact?.username.toLowerCase().includes(keyword))
    : conversations

  return (
    <div className="gh-chat-conv-wrap">
      {conversations.length >= 4 && (
        <div className="gh-chat-conv-search">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <circle cx="7" cy="7" r="4.2" />
            <path d="m10.2 10.2 2.8 2.8" />
          </svg>
          <input
            type="search"
            value={query}
            placeholder="搜索会话"
            aria-label="搜索会话"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}>×</button>
          )}
        </div>
      )}
      {list.length === 0 ? (
        <div className="gh-chat-list-state">
          <p className="gh-chat-list-empty-title">没有匹配的会话</p>
          <p className="gh-chat-list-empty-hint">换个关键词试试。</p>
        </div>
      ) : (
        <ul className="gh-chat-conv-list" aria-label="会话列表">
          {list.map((conversation) => {
            const unread = formatUnread(conversation.unread)
            const active = conversation.key === activeKey
            const isLobby = conversation.room?.isLobby
            const isBigGroup = conversation.room?.isBigGroup
            return (
              <li key={conversation.key} className={conversation.pinned ? 'gh-chat-conv-li--pinned' : undefined}>
                <button
                  type="button"
                  className={`gh-chat-conv-item ${active ? 'gh-chat-conv-item--active' : ''} ${
                    unread ? 'gh-chat-conv-item--unread' : ''
                  }`}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => onSelect(conversation)}
                >
                  <NekoAvatar
                    nekoId={conversation.avatarNekoId}
                    avatarVersion={conversation.avatarVersion}
                    fallbackId={conversation.avatarId}
                    name={conversation.avatarName}
                    size="md"
                  />
                  <span className="gh-chat-conv-main">
                    <span className="gh-chat-conv-top">
                      <span className="gh-chat-conv-name">
                        {conversation.kind === 'room' && (
                          <span className={`gh-chat-group-tag ${isLobby || isBigGroup ? 'gh-chat-group-tag--official' : ''}`}>
                            {isLobby ? '大厅' : isBigGroup ? '官方' : '群'}
                          </span>
                        )}
                        {conversation.title}
                        {conversation.kind === 'direct' && conversation.online && (
                          <span className="gh-chat-online-dot" aria-label="在线" title="在线" />
                        )}
                        {conversation.pinned && (
                          <span className="gh-chat-pin-dot" title="已置顶" aria-label="已置顶">置顶</span>
                        )}
                      </span>
                      <span className="gh-chat-conv-time">{formatListTime(conversation.lastMessageAt)}</span>
                    </span>
                    <span className="gh-chat-conv-bottom">
                      <span className="gh-chat-conv-preview">{conversationPreview(conversation)}</span>
                      {(conversation.mentionUnread ?? 0) > 0 && (
                        <span className="gh-chat-at-badge" aria-label="有人@我" title="有人@我">@</span>
                      )}
                      {unread && (
                        <span className="gh-chat-unread" aria-label={`${conversation.unread} 条未读`}>
                          {unread}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
})
