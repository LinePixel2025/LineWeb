import { useState, type KeyboardEvent } from 'react'

const DEFAULT_MAX_LENGTH = 2000

interface Props {
  onSend: (content: string) => Promise<void> | void
  /** 禁用输入（如对方已不是好友） */
  disabled?: boolean
  disabledHint?: string
  placeholder?: string
  maxLength?: number
}

export default function ChatComposer({
  onSend,
  disabled = false,
  disabledHint,
  placeholder = '输入消息…',
  maxLength = DEFAULT_MAX_LENGTH,
}: Props) {
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)

  const canSubmit = !disabled && !sending && value.trim().length > 0

  const submit = async () => {
    if (!canSubmit) return
    const content = value.trim()
    setSending(true)
    try {
      await onSend(content)
      setValue('')
    } catch {
      // 发送失败保留草稿，由页面展示错误
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    // 中文输入法组合中按 Enter 是确认候选词，不应发送
    if (event.nativeEvent.isComposing) return
    event.preventDefault()
    void submit()
  }

  if (disabled) {
    return (
      <div className="gh-chat-composer gh-chat-composer--disabled">
        <p className="gh-chat-composer-hint">{disabledHint || '当前无法发送消息'}</p>
      </div>
    )
  }

  return (
    <div className="gh-chat-composer">
      <textarea
        className="gh-chat-composer-input"
        value={value}
        rows={2}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label="消息输入框"
        onChange={(event) => setValue(event.target.value.slice(0, maxLength))}
        onKeyDown={handleKeyDown}
      />
      <div className="gh-chat-composer-bar">
        <span className={`gh-chat-composer-count ${value.length > maxLength - 200 ? 'gh-chat-composer-count--warn' : ''}`}>
          {value.length}/{maxLength}
        </span>
        <span className="gh-chat-composer-tip">Enter 发送 · Shift+Enter 换行</span>
        <button
          type="button"
          className="gh-btn gh-btn--primary gh-btn--sm"
          aria-label="发送消息"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          {sending ? '发送中…' : '发送'}
        </button>
      </div>
    </div>
  )
}
