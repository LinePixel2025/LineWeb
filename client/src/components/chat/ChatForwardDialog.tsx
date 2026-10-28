import { useEffect, useMemo, useState } from 'react'
import NekoAvatar from './NekoAvatar'
import type { NekoConversation } from '../../types/chat'

interface Props {
  open: boolean
  /** 当前会话键（用于标记「当前会话」，不再限制合并转发目标） */
  sourceKey: string
  sourceTitle: string
  /** 待转发的消息条数 */
  count: number
  /** 可选目标（全部会话，含来源会话） */
  conversations: NekoConversation[]
  loading?: boolean
  error?: string | null
  onClose: () => void
  onSubmit: (targetKeys: string[], mode: 'merge' | 'separate') => void
}

type Mode = 'separate' | 'merge'

/**
 * 转发目标选择弹窗。
 *
 * 两种模式都支持跨会话：合并转发由 neko 按所选消息行推导源会话并生成快照，
 * 目标可以是任意好友或群；逐条转发则按原消息内容重新发送。
 */
export default function ChatForwardDialog({
  open,
  sourceKey,
  sourceTitle,
  count,
  conversations,
  loading = false,
  error = null,
  onClose,
  onSubmit,
}: Props) {
  const [mode, setMode] = useState<Mode>('separate')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    setMode('separate')
    setQuery('')
    setSelected(new Set())
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [open, loading, onClose])

  const rows = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return conversations.filter((conversation) =>
      keyword ? conversation.title.toLowerCase().includes(keyword) : true,
    )
  }, [conversations, query])

  if (!open) return null

  const canSubmit = !loading && selected.size > 0 && count > 0

  const switchMode = (next: Mode) => {
    setMode(next)
  }

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="gh-chat-dialog-overlay" onClick={() => !loading && onClose()}>
      <div
        className="gh-chat-dialog gh-chat-forward-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="选择转发对象"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="gh-chat-dialog-header">
          <h2 className="gh-chat-dialog-title">转发 {count} 条消息</h2>
          <button
            type="button"
            className="gh-chat-dialog-close"
            aria-label="关闭"
            disabled={loading}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="gh-chat-dialog-body">
          <div className="gh-chat-forward-modes" role="group" aria-label="转发方式">
            <button
              type="button"
              className={`gh-chat-forward-mode ${mode === 'separate' ? 'gh-chat-forward-mode--active' : ''}`}
              aria-pressed={mode === 'separate'}
              onClick={() => switchMode('separate')}
            >
              逐条转发
              <span className="gh-chat-forward-mode-hint">每条消息单独发送，可发往任意会话</span>
            </button>
            <button
              type="button"
              className={`gh-chat-forward-mode ${mode === 'merge' ? 'gh-chat-forward-mode--active' : ''}`}
              aria-pressed={mode === 'merge'}
              onClick={() => switchMode('merge')}
            >
              合并转发
              <span className="gh-chat-forward-mode-hint">打包成聊天记录卡片，可发往任意会话</span>
            </button>
          </div>

          <input
            className="gh-input gh-chat-forward-search"
            value={query}
            placeholder="搜索联系人或群聊"
            aria-label="搜索转发对象"
            onChange={(event) => setQuery(event.target.value)}
          />

          <ul className="gh-chat-forward-list" aria-label="转发对象">
            {rows.map((conversation) => {
              const isSource = conversation.key === sourceKey
              const checked = selected.has(conversation.key)
              return (
                <li key={conversation.key}>
                  <label
                    className="gh-chat-forward-row"
                    title={isSource ? '当前会话（也可转发回这里）' : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={loading}
                      onChange={() => toggle(conversation.key)}
                    />
                    <NekoAvatar
                      nekoId={conversation.avatarNekoId}
                      avatarVersion={conversation.avatarVersion}
                      fallbackId={conversation.avatarId}
                      name={conversation.avatarName}
                      size="sm"
                    />
                    <span className="gh-chat-forward-name">
                      {conversation.kind === 'room' && <span className="gh-chat-group-tag">群</span>}
                      {conversation.title}
                      {isSource && <span className="gh-chat-forward-source">当前会话</span>}
                    </span>
                  </label>
                </li>
              )
            })}
            {rows.length === 0 && <li className="gh-chat-forward-empty">没有匹配的会话。</li>}
          </ul>

          {mode === 'merge' && (
            <p className="gh-chat-forward-note">
              会把「{sourceTitle}」中选中的 {count} 条消息打包成一张聊天记录卡片（单包上限 30 条），
              可选择任意好友或群作为目标。
            </p>
          )}

          {error && <p className="gh-chat-dialog-error">{error}</p>}
        </div>

        <footer className="gh-chat-dialog-footer">
          <button
            type="button"
            className="gh-btn gh-btn--secondary gh-btn--sm"
            disabled={loading}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="gh-btn gh-btn--primary gh-btn--sm"
            disabled={!canSubmit}
            onClick={() => onSubmit([...selected], mode)}
          >
            {loading ? '转发中…' : `转发到 ${selected.size} 个会话`}
          </button>
        </footer>
      </div>
    </div>
  )
}
