import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../lib/api'
import DOMPurify from 'dompurify'

interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTED_QUESTIONS = [
  '这个网站有哪些功能？',
  '推荐几篇值得阅读的文章',
  '我可以在这里做什么？',
]

let nextId = 1

function AiIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 .5l1.66 5.84L15.5 8l-5.84 1.66L8 15.5l-1.66-5.84L.5 8l5.84-1.66L8 .5z" />
      <circle cx="8" cy="8" r="1.7" fill="var(--gh-canvas)" />
    </svg>
  )
}

function CommentIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M1.75 1h12.5c.966 0 1.75.784 1.75 1.75v9.5A1.75 1.75 0 0 1 14.25 14H8.06l-2.57 2.57A1.46 1.46 0 0 1 3 15.54V14H1.75A1.75 1.75 0 0 1 0 12.25v-9.5C0 1.78.78 1 1.75 1Zm-.25 11.25c0 .14.11.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.75.75 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25h-12.5a.25.25 0 0 0-.25.25v9.5Z" />
    </svg>
  )
}

function XIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 0 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
    </svg>
  )
}

function SendIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
    </svg>
  )
}

function TrashIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M6.5.75A1.75 1.75 0 0 0 4.75 2.5v.75H2.5a.75.75 0 0 0 0 1.5h.75v8.5c0 1.1.9 2 2 2h5.5a2 2 0 0 0 2-2v-8.5h.75a.75.75 0 0 0 0-1.5h-2.25V2.5A1.75 1.75 0 0 0 9.5.75h-3Zm0 1.5h3a.25.25 0 0 1 .25.25v.75h-3.5V2.5a.25.25 0 0 1 .25-.25Zm-1.75 2.5h6.5v8.5a.5.5 0 0 1-.5.5h-5.5a.5.5 0 0 1-.5-.5v-8.5Zm2 2a.75.75 0 0 0-.75.75v3.25a.75.75 0 0 0 1.5 0V7.5a.75.75 0 0 0-.75-.75Zm2.5 0a.75.75 0 0 0-.75.75v3.25a.75.75 0 0 0 1.5 0V7.5a.75.75 0 0 0-.75-.75Z" />
    </svg>
  )
}

function renderMarkdown(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

  const codeBlocks: string[] = []
  let processed = escaped.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const index = codeBlocks.length
    const languageClass = lang ? ` class="language-${lang}"` : ''
    codeBlocks.push(`<pre><code${languageClass}>${code}</code></pre>`)
    return `%%CODEBLOCK_${index}%%`
  })

  processed = processed
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')

  const lines = processed.split('\n')
  let html = ''
  let inUl = false
  let inOl = false

  for (const line of lines) {
    const codeBlockMatch = line.match(/^%%CODEBLOCK_(\d+)%%$/)
    if (codeBlockMatch) {
      if (inUl) { html += '</ul>\n'; inUl = false }
      if (inOl) { html += '</ol>\n'; inOl = false }
      html += `${codeBlocks[parseInt(codeBlockMatch[1], 10)]}\n`
      continue
    }

    if (/^#{1,4}\s/.test(line)) {
      if (inUl) { html += '</ul>\n'; inUl = false }
      if (inOl) { html += '</ol>\n'; inOl = false }
      const level = line.match(/^#{1,4}/)![0].length
      html += `<h${level}>${line.replace(/^#+\s/, '')}</h${level}>\n`
      continue
    }

    if (/^\s*[-*]\s/.test(line)) {
      if (inOl) { html += '</ol>\n'; inOl = false }
      if (!inUl) { html += '<ul>\n'; inUl = true }
      html += `<li>${line.replace(/^\s*[-*]\s/, '')}</li>\n`
      continue
    }

    if (/^\s*\d+\.\s/.test(line)) {
      if (inUl) { html += '</ul>\n'; inUl = false }
      if (!inOl) { html += '<ol>\n'; inOl = true }
      html += `<li>${line.replace(/^\s*\d+\.\s/, '')}</li>\n`
      continue
    }

    if (inUl) { html += '</ul>\n'; inUl = false }
    if (inOl) { html += '</ol>\n'; inOl = false }
    html += line.trim() === '' ? '<br>\n' : `<p>${line}</p>\n`
  }

  if (inUl) html += '</ul>\n'
  if (inOl) html += '</ol>\n'

  return DOMPurify.sanitize(`<div class="gh-ai-markdown">${html}</div>`)
}

export default function AiAssistant() {
  const [enabled, setEnabled] = useState(false)
  const [checked, setChecked] = useState(false)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fabRef = useRef<HTMLButtonElement>(null)

  const handleClose = useCallback(() => {
    setOpen(false)
    window.setTimeout(() => fabRef.current?.focus(), 0)
  }, [])

  const resizeInput = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`
  }

  useEffect(() => {
    api.get<{ enabled: boolean }>('/ai/chat/public')
      .then(res => setEnabled(res.enabled))
      .catch(() => setEnabled(false))
      .finally(() => setChecked(true))
  }, [])

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (open) scrollToBottom()
  }, [messages, open, scrollToBottom])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 100)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [open, handleClose])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: ChatMessage = { id: nextId++, role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
    setLoading(true)

    const history = [...messages, userMsg]
      .slice(0, -1)
      .map(message => ({ role: message.role, content: message.content }))

    try {
      const response = await api.post<{ reply: string; model: string }>('/ai/chat', { message: text, history })
      setMessages(prev => [...prev, { id: nextId++, role: 'assistant', content: response.reply }])
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '请求失败，请稍后再试'
      setMessages(prev => [...prev, { id: nextId++, role: 'assistant', content: `错误：${message}` }])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  const handleSuggestion = (question: string) => {
    setInput(question)
    window.requestAnimationFrame(() => {
      if (inputRef.current) {
        resizeInput(inputRef.current)
        inputRef.current.focus()
      }
    })
  }

  const handleClear = () => {
    setMessages([])
    setInput('')
    window.requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.style.height = 'auto'
        inputRef.current.focus()
      }
    })
  }

  if (!checked || !enabled) return null

  return (
    <>
      {!open && (
        <button
          ref={fabRef}
          className="gh-ai-fab"
          onClick={() => setOpen(true)}
          aria-label="打开 AI 助手"
          title="向 LineWeb AI 提问"
        >
          <AiIcon size={22} />
          <span className="gh-ai-fab-label">问 AI</span>
          <span className="gh-ai-fab-dot" aria-hidden="true" />
        </button>
      )}

      {open && (
        <section className="gh-ai-panel" role="dialog" aria-modal="false" aria-label="LineWeb AI 助手">
          <header className="gh-ai-header">
            <div className="gh-ai-header-left">
              <span className="gh-ai-header-icon"><AiIcon size={16} /></span>
              <span className="gh-ai-header-title">LineWeb AI</span>
              <span className="gh-ai-header-status" aria-label="服务可用">可用</span>
            </div>
            <div className="gh-ai-header-actions">
              {messages.length > 0 && (
                <button className="gh-ai-header-btn" onClick={handleClear} disabled={loading} aria-label="清空对话" title="清空对话">
                  <TrashIcon size={16} />
                </button>
              )}
              <button className="gh-ai-header-btn" onClick={handleClose} aria-label="关闭 AI 助手" title="关闭">
                <XIcon size={16} />
              </button>
            </div>
          </header>

          <div className="gh-ai-messages" role="log" aria-live="polite" aria-relevant="additions text">
            {messages.length === 0 && (
              <section className="gh-ai-empty" aria-labelledby="gh-ai-empty-title">
                <span className="gh-ai-empty-icon" aria-hidden="true"><CommentIcon size={24} /></span>
                <p className="gh-ai-empty-kicker">站点问答</p>
                <h2 id="gh-ai-empty-title" className="gh-ai-empty-title">想了解 LineWeb 的什么？</h2>
                <p className="gh-ai-empty-text">我可以帮你查找站点内容、文章和功能信息。</p>
                <div className="gh-ai-suggestions" aria-label="推荐问题">
                  {SUGGESTED_QUESTIONS.map(question => (
                    <button key={question} type="button" onClick={() => handleSuggestion(question)}>{question}</button>
                  ))}
                </div>
              </section>
            )}

            {messages.map(message => (
              <div key={message.id} className={`gh-ai-message gh-ai-message--${message.role}`}>
                {message.role === 'assistant' && <span className="gh-ai-message-avatar" aria-hidden="true"><AiIcon size={13} /></span>}
                <div className="gh-ai-bubble">
                  {message.role === 'assistant'
                    ? <div dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
                    : message.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="gh-ai-message gh-ai-message--assistant">
                <span className="gh-ai-message-avatar" aria-hidden="true"><AiIcon size={13} /></span>
                <div className="gh-ai-bubble gh-ai-typing">
                  <span className="gh-ai-typing-label">正在思考</span>
                  <span className="gh-ai-dot" />
                  <span className="gh-ai-dot" />
                  <span className="gh-ai-dot" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form className="gh-ai-input-area" onSubmit={event => { event.preventDefault(); handleSend() }}>
            <label className="gh-ai-sr-only" htmlFor="gh-ai-input">向 LineWeb AI 提问</label>
            <div className="gh-ai-compose">
              <textarea
                id="gh-ai-input"
                ref={inputRef}
                className="gh-ai-input"
                value={input}
                onChange={event => {
                  setInput(event.target.value)
                  resizeInput(event.currentTarget)
                }}
                onKeyDown={handleKeyDown}
                placeholder="问问文章、功能或站点信息"
                rows={1}
                disabled={loading}
              />
              <button className="gh-ai-send" type="submit" disabled={loading || !input.trim()} aria-label="发送消息" title="发送消息">
                <SendIcon size={16} />
              </button>
            </div>
            <span className="gh-ai-sr-only">按 Enter 发送，按 Shift 加 Enter 换行。</span>
          </form>
        </section>
      )}
    </>
  )
}
