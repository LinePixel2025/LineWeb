import { memo } from 'react'
import UserAvatar from '../UserAvatar'
import { displayName, formatUnread, messagePreview } from '../../lib/chat'
import type { Conversation } from '../../types/chat'

interface Props {
  conversations: Conversation[]
  activeId: number | null
  meId: number
  loading?: boolean
  error?: string | null
  onSelect: (conversation: Conversation) => void
}

function formatListTime(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

function previewText(conversation: Conversation): string {
  const lastMessage = conversation.lastMessage
  if (!lastMessage) return '暂无消息'
  const prefix = conversation.type === 'group' ? `${lastMessage.sender.username}：` : ''
  // 图片消息显示 [图片]，已撤回显示 [已撤回]
  return `${prefix}${messagePreview(lastMessage)}`
}

function avatarTarget(conversation: Conversation, meId: number): { id: number; username: string; name: string } {
  const name = displayName(conversation, meId)
  if (conversation.type === 'group') {
    return { id: conversation.id, username: name, name }
  }
  const other = conversation.members.find((member) => member.id !== meId)
  return { id: other?.id ?? conversation.id, username: other?.username ?? name, name }
}

export default memo(function ChatConversationList({
  conversations,
  activeId,
  meId,
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
        const target = avatarTarget(conversation, meId)
        const unread = formatUnread(conversation.unreadCount)
        const active = conversation.id === activeId
        return (
          <li key={conversation.id}>
            <button
              type="button"
              className={`gh-chat-conv-item ${active ? 'gh-chat-conv-item--active' : ''}`}
              aria-current={active ? 'true' : undefined}
              onClick={() => onSelect(conversation)}
            >
              <UserAvatar userId={target.id} username={target.username} size="md" />
              <span className="gh-chat-conv-main">
                <span className="gh-chat-conv-top">
                  <span className="gh-chat-conv-name">
                    {conversation.type === 'group' && <span className="gh-chat-group-tag">群</span>}
                    {target.name}
                  </span>
                  <span className="gh-chat-conv-time">{formatListTime(conversation.lastMessageAt)}</span>
                </span>
                <span className="gh-chat-conv-bottom">
                  <span className="gh-chat-conv-preview">{previewText(conversation)}</span>
                  {unread && (
                    <span className="gh-chat-unread" aria-label={`${conversation.unreadCount} 条未读`}>
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
