import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../lib/api'

interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
}

let nextId = 1

export default function AiAssistant() {
  const [enabled, setEnabled] = useState(false)
  const [checked, setChecked] = useState(false) // 是否已检查过启用状态
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 检查 AI 是否启用
  useEffect(() => {
    api.get<{ enabled: boolean }>('/ai/chat/public')
      .then(res => setEnabled(res.enabled))
      .catch(() => setEnabled(false))
      .finally(() => setChecked(true))
  }, [])

  // 自动滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (open) scrollToBottom()
  }, [messages, open, scrollToBottom])

  // 打开面板时聚焦输入框
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: ChatMessage = { id: nextId++, role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    // 构建历史消息（不含当前刚发的）
    const history = [...messages, userMsg]
      .slice(0, -1) // 排除刚发的 user 消息，API 会单独接收
      .map(m => ({ role: m.role, content: m.content }))

    try {
      const res = await api.post<{ reply: string; model: string }>('/ai/chat', {
        message: text,
        history,
      })
      setMessages(prev => [...prev, { id: nextId++, role: 'assistant', content: res.reply }])
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : '请求失败，请稍后再试'
      setMessages(prev => [...prev, { id: nextId++, role: 'assistant', content: `⚠️ ${errMsg}` }])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // 未检查或未启用时不渲染
  if (!checked || !enabled) return null

  return (
    <>
      {/* 浮动按钮 */}
      {!open && (
        <button
          className="ai-assistant-fab"
          onClick={() => setOpen(true)}
          aria-label="AI 助手"
          title="AI 助手"
        >
          <span className="ai-assistant-fab-icon">🤖</span>
        </button>
      )}

      {/* 聊天面板 */}
      {open && (
        <div className="ai-assistant-panel">
          {/* 头部 */}
          <div className="ai-assistant-header">
            <div className="ai-assistant-header-left">
              <span className="ai-assistant-header-icon">🤖</span>
              <span className="ai-assistant-header-title">AI 助手</span>
            </div>
            <button
              className="ai-assistant-close"
              onClick={() => setOpen(false)}
              aria-label="关闭 AI 助手"
            >
              ✕
            </button>
          </div>

          {/* 消息列表 */}
          <div className="ai-chat-messages">
            {messages.length === 0 && (
              <div className="ai-chat-empty">
                <div className="ai-chat-empty-icon">💬</div>
                <div className="ai-chat-empty-text">
                  你好！我是 LineWeb 的 AI 助手。<br />
                  我可以回答关于网站内容、文章、功能等问题。
                </div>
              </div>
            )}
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`ai-chat-message ${msg.role === 'user' ? 'ai-chat-message--user' : 'ai-chat-message--ai'}`}
              >
                <div className="ai-chat-bubble">
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="ai-chat-message ai-chat-message--ai">
                <div className="ai-chat-bubble ai-chat-typing">
                  <span className="ai-chat-dot" />
                  <span className="ai-chat-dot" />
                  <span className="ai-chat-dot" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 输入区域 */}
          <div className="ai-chat-input-area">
            <textarea
              ref={inputRef}
              className="ai-chat-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息… (Enter 发送, Shift+Enter 换行)"
              rows={1}
              disabled={loading}
            />
            <button
              className="ai-chat-send"
              onClick={handleSend}
              disabled={loading || !input.trim()}
              aria-label="发送"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  )
}
