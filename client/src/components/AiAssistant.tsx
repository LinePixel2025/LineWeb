import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../lib/api'
import DOMPurify from 'dompurify'

interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
}

let nextId = 1

/* ============================================================
   GitHub Primer 风格图标（全部手绘 SVG，不使用 emoji）
   ============================================================ */

/** AI 星标图标 — 仿 GitHub Copilot 星形 */
function AiIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 .5l1.66 5.84L15.5 8l-5.84 1.66L8 15.5l-1.66-5.84L.5 8l5.84-1.66L8 .5z" />
      <circle cx="8" cy="8" r="1.7" fill="var(--gh-canvas)" />
    </svg>
  )
}

/** 聊天气泡图标 */
function CommentIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M1.75 1h12.5c.966 0 1.75.784 1.75 1.75v9.5A1.75 1.75 0 0 1 14.25 14H8.06l-2.57 2.57A1.46 1.46 0 0 1 3 15.54V14H1.75A1.75 1.75 0 0 1 0 12.25v-9.5C0 1.78.78 1 1.75 1Zm-.25 11.25c0 .14.11.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.75.75 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25h-12.5a.25.25 0 0 0-.25.25v9.5Z" />
    </svg>
  )
}

/** 关闭图标 */
function XIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 0 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
    </svg>
  )
}

/** 发送图标 — 纸飞机 */
function SendIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
    </svg>
  )
}

/** 轻量 markdown → HTML 渲染器 */
function renderMarkdown(text: string): string {
  // 1. HTML 转义
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

  // 2. 提取代码块为占位符
  const codeBlocks: string[] = []
  let processed = escaped.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length
    const langClass = lang ? ` class="language-${lang}"` : ''
    codeBlocks.push(`<pre><code${langClass}>${code}</code></pre>`)
    return `%%CODEBLOCK_${idx}%%`
  })

  // 3. 行内模式处理
  processed = processed
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')

  // 4. 按行处理块级元素
  const lines = processed.split('\n')
  let html = ''
  let inUl = false
  let inOl = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const codeBlockMatch = line.match(/^%%CODEBLOCK_(\d+)%%$/)
    if (codeBlockMatch) {
      if (inUl) { html += '</ul>\n'; inUl = false }
      if (inOl) { html += '</ol>\n'; inOl = false }
      html += codeBlocks[parseInt(codeBlockMatch[1])] + '\n'
      continue
    }

    // 标题
    if (/^#{1,4}\s/.test(line)) {
      if (inUl) { html += '</ul>\n'; inUl = false }
      if (inOl) { html += '</ol>\n'; inOl = false }
      const level = line.match(/^#{1,4}/)![0].length
      html += `<h${level}>${line.replace(/^#+\s/, '')}</h${level}>\n`
      continue
    }

    // 无序列表
    if (/^\s*[-*]\s/.test(line)) {
      if (inOl) { html += '</ol>\n'; inOl = false }
      if (!inUl) { html += '<ul>\n'; inUl = true }
      html += `<li>${line.replace(/^\s*[-*]\s/, '')}</li>\n`
      continue
    }

    // 有序列表
    if (/^\s*\d+\.\s/.test(line)) {
      if (inUl) { html += '</ul>\n'; inUl = false }
      if (!inOl) { html += '<ol>\n'; inOl = true }
      html += `<li>${line.replace(/^\s*\d+\.\s/, '')}</li>\n`
      continue
    }

    if (inUl) { html += '</ul>\n'; inUl = false }
    if (inOl) { html += '</ol>\n'; inOl = false }

    if (line.trim() === '') {
      html += '<br>\n'
      continue
    }

    html += `<p>${line}</p>\n`
  }

  if (inUl) html += '</ul>\n'
  if (inOl) html += '</ol>\n'

  return DOMPurify.sanitize(`<div class="gh-ai-markdown">${html}</div>`)
}

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
          className="gh-ai-fab"
          onClick={() => setOpen(true)}
          aria-label="打开 AI 助手"
          title="AI 助手"
        >
          <AiIcon size={22} />
          <span className="gh-ai-fab-dot" aria-hidden="true" />
        </button>
      )}

      {/* 聊天面板 */}
      {open && (
        <div
          className="gh-ai-panel"
          role="dialog"
          aria-label="AI 助手"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '20px',
            zIndex: 1000,
            width: '380px',
            height: '540px',
            maxHeight: 'calc(100dvh - 48px)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            animation: 'gh-ai-panel-in 0.22s cubic-bezier(0.25, 0.1, 0.25, 1)',
            padding: 0,
          }}
        >
          {/* 头部 */}
          <div className="gh-ai-header">
            <div className="gh-ai-header-left">
              <span className="gh-ai-header-icon">
                <AiIcon size={16} />
              </span>
              <span className="gh-ai-header-title">AI 助手</span>
              <span className="gh-ai-header-status" aria-label="在线">在线</span>
            </div>
            <button
              className="gh-ai-header-btn"
              onClick={() => setOpen(false)}
              aria-label="关闭 AI 助手"
            >
              <XIcon size={16} />
            </button>
          </div>

          {/* 消息列表 */}
          <div className="gh-ai-messages">
            {messages.length === 0 && (
              <div className="gh-ai-empty">
                <span className="gh-ai-empty-icon">
                  <CommentIcon size={28} />
                </span>
                <div className="gh-ai-empty-title">开始对话</div>
                <div className="gh-ai-empty-text">
                  你好！我是 LineWeb 的 AI 助手，
                  <br />
                  可以回答关于网站内容、文章、功能等问题。
                </div>
              </div>
            )}
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`gh-ai-message ${msg.role === 'user' ? 'gh-ai-message--user' : 'gh-ai-message--ai'}`}
              >
                {msg.role === 'assistant' && (
                  <span className="gh-ai-message-avatar" aria-hidden="true">
                    <AiIcon size={13} />
                  </span>
                )}
                <div className="gh-ai-bubble">
                  {msg.role === 'assistant' ? (
                    <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="gh-ai-message gh-ai-message--ai">
                <span className="gh-ai-message-avatar" aria-hidden="true">
                  <AiIcon size={13} />
                </span>
                <div className="gh-ai-bubble gh-ai-typing">
                  <span className="gh-ai-typing-label">思考中</span>
                  <span className="gh-ai-dot" />
                  <span className="gh-ai-dot" />
                  <span className="gh-ai-dot" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 输入区域 */}
          <div className="gh-ai-input-area">
            <textarea
              ref={inputRef}
              className="gh-ai-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息… (Enter 发送, Shift+Enter 换行)"
              rows={1}
              disabled={loading}
            />
            <button
              className="gh-ai-send"
              onClick={handleSend}
              disabled={loading || !input.trim()}
              aria-label="发送"
            >
              <SendIcon size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
