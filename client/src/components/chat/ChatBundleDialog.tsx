import { useEffect } from 'react'
import { chatImageUrl } from '../../lib/chat'
import { extractImageSrc } from '../../lib/xmpp/protocol'
import type { NekoBundleItem, NekoConversation } from '../../types/chat'

interface Props {
  open: boolean
  /** 合并转发的聊天记录快照 */
  items: NekoBundleItem[]
  /** 用于把用户名还原成显示名（转发条目只有用户名） */
  conversation: NekoConversation | null
  selfNekoId: number | null
  onClose: () => void
}

function formatItemTime(value: number): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function displayName(
  username: string,
  conversation: NekoConversation | null,
  selfNekoId: number | null,
): string {
  if (!conversation) return username || '未知用户'
  const member = conversation.members.find((item) => item.username === username)
  if (member) {
    if (selfNekoId !== null && member.nekoId === selfNekoId) return '你'
    return member.displayName || member.username
  }
  if (conversation.kind === 'direct') {
    if (conversation.contact && username === conversation.contact.username) {
      return conversation.contact.displayName || conversation.contact.username
    }
    return '你'
  }
  return username || '未知用户'
}

/**
 * 聊天记录查看弹窗：合并转发的只读快照。
 *
 * 快照里的富文本只提取聊天上传图片（`/chat/uploads/<id>`），不渲染任意 HTML，
 * 避免转发内容成为注入入口。
 */
export default function ChatBundleDialog({
  open,
  items,
  conversation,
  selfNekoId,
  onClose,
}: Props) {
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="gh-chat-dialog-overlay" onClick={onClose}>
      <div
        className="gh-chat-dialog gh-chat-bundle-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="聊天记录"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="gh-chat-dialog-header">
          <h2 className="gh-chat-dialog-title">聊天记录（{items.length} 条）</h2>
          <button type="button" className="gh-chat-dialog-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="gh-chat-dialog-body gh-chat-bundle-body">
          {items.length === 0 ? (
            <p className="gh-chat-friend-empty">聊天记录为空。</p>
          ) : (
            <ul className="gh-chat-bundle-list">
              {items.map((item, index) => {
                const image = item.r ? null : extractImageSrc(item.h)
                return (
                  <li key={`${item.t}-${index}`} className="gh-chat-bundle-item">
                    <div className="gh-chat-bundle-item-meta">
                      <span className="gh-chat-bundle-item-name">
                        {displayName(item.n, conversation, selfNekoId)}
                      </span>
                      <time className="gh-chat-bundle-item-time" dateTime={new Date(item.t).toISOString()}>
                        {formatItemTime(item.t)}
                      </time>
                    </div>
                    {item.r ? (
                      <p className="gh-chat-bundle-item-recalled">消息已撤回</p>
                    ) : image ? (
                      <img
                        className="gh-chat-bundle-item-image"
                        src={chatImageUrl(image)}
                        alt="聊天图片"
                        loading="lazy"
                      />
                    ) : (
                      <p className="gh-chat-bundle-item-text">{item.b || '[消息]'}</p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <footer className="gh-chat-dialog-footer">
          <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  )
}
