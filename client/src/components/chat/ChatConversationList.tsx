import { memo } from 'react'
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

  return (
    <ul className="gh-chat-conv-list" aria-label="会话列表">
      {conversations.map((conversation) => {
        const unread = formatUnread(conversation.unread)
        const active = conversation.key === activeKey
        return (
          <li key={conversation.key}>
            <button
              type="button"
              className={`gh-chat-conv-item ${active ? 'gh-chat-conv-item--active' : ''}`}
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
                    {conversation.kind === 'room' && <span className="gh-chat-group-tag">群</span>}
                    {conversation.title}
                    {conversation.kind === 'direct' && conversation.online && (
                      <span className="gh-chat-online-dot" aria-label="在线" title="在线" />
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
  )
})
