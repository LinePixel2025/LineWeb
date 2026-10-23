import { useEffect, useState } from 'react'
import UserAvatar from '../UserAvatar'
import type { Friend } from '../../types/chat'

interface Props {
  open: boolean
  title: string
  submitLabel: string
  friends: Friend[]
  /** 已在该会话中的成员，从可选列表中排除 */
  excludeIds?: number[]
  /** 是否显示群名输入（新建群聊时需要，添加成员时不需要） */
  showNameInput?: boolean
  loading?: boolean
  error?: string | null
  onClose: () => void
  onSubmit: (name: string, memberIds: number[]) => void
}

export default function GroupDialog({
  open,
  title,
  submitLabel,
  friends,
  excludeIds = [],
  showNameInput = true,
  loading = false,
  error = null,
  onClose,
  onSubmit,
}: Props) {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (open) {
      setName('')
      setSelected(new Set())
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [open, onClose])

  if (!open) return null

  const candidates = friends.filter((friend) => !excludeIds.includes(friend.id))
  const nameInvalid = showNameInput && name.trim().length === 0
  const canSubmit = !loading && !nameInvalid && selected.size > 0

  const toggle = (userId: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  return (
    <div className="gh-chat-dialog-overlay" onClick={onClose}>
      <div
        className="gh-chat-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="gh-chat-dialog-header">
          <h2 className="gh-chat-dialog-title">{title}</h2>
          <button type="button" className="gh-chat-dialog-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="gh-chat-dialog-body">
          {showNameInput && (
            <label className="gh-chat-field">
              <span className="gh-chat-field-label">群聊名称</span>
              <input
                className="gh-input gh-chat-field-input"
                value={name}
                maxLength={40}
                placeholder="例如：周末出游"
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          )}

          <div className="gh-chat-field">
            <span className="gh-chat-field-label">
              选择成员（已选 {selected.size} 人）
            </span>
            {candidates.length === 0 ? (
              <p className="gh-chat-friend-empty">
                {friends.length === 0 ? '还没有好友，先去添加好友吧。' : '所有好友都已在该会话中。'}
              </p>
            ) : (
              <ul className="gh-chat-picker-list">
                {candidates.map((friend) => (
                  <li key={friend.id} className="gh-chat-picker-row">
                    <label className="gh-chat-picker-label">
                      <input
                        type="checkbox"
                        checked={selected.has(friend.id)}
                        onChange={() => toggle(friend.id)}
                      />
                      <UserAvatar userId={friend.id} username={friend.username} size="sm" />
                      <span className="gh-chat-friend-name">{friend.username}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && <p className="gh-chat-dialog-error">{error}</p>}
        </div>

        <footer className="gh-chat-dialog-footer">
          <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="gh-btn gh-btn--primary gh-btn--sm"
            disabled={!canSubmit}
            onClick={() => onSubmit(name.trim(), Array.from(selected))}
          >
            {loading ? '处理中…' : submitLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}
