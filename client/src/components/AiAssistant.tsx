import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../lib/api'
import { renderMarkdown } from '../lib/markdown'
import Icon from './ui/Icon'

interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTED_QUESTIONS = [
  '这个网站有哪些功能？',
  '推荐几篇值得阅读的文章',
  '这个网站最近有哪些评论？',
  '我最近用电脑多长时间？',
  '这个网站有多少篇文章？',
]

let nextId = 1

function AiIcon({ size = 16 }: { size?: number }) {
  return <Icon name="sparkles" size={size} strokeWidth={1.6} />
}

function CommentIcon({ size = 16 }: { size?: number }) {
  return <Icon name="message" size={size} />
}

function XIcon({ size = 16 }: { size?: number }) {
  return <Icon name="close" size={size} />
}

function SendIcon({ size = 16 }: { size?: number }) {
  return <Icon name="send" size={size} />
}

function TrashIcon({ size = 16 }: { size?: number }) {
  return <Icon name="trash" size={size} />
}

// renderMarkdown 已抽取到 lib/markdown.ts 共享（DeepSeek 对话页复用同一实现）

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
                <p className="gh-ai-empty-text">我可以帮你查找站点内容、文章、功能、评论和屏幕使用时间信息。</p>
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
                placeholder="问问文章、功能、评论或站点信息"
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
