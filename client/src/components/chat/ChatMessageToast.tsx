import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import NekoAvatar from './NekoAvatar'
import { useXmppChat } from '../../contexts/XmppChatContext'

const PORTAL_ROOT = document.body
/** 自动消失时间（毫秒）；比游戏邀请短，避免打断操作 */
const AUTO_DISMISS_MS = 6_000
/** 快速回复的常用短语（点一下直接发送） */
const QUICK_PHRASES = ['收到', '好的', '稍等，我马上看', '现在不方便，晚点回你']

/**
 * 全局新消息提示
 *
 * 挂在 Routes 之外，任何页面（含游戏对局）收到非当前会话的实时消息时都会弹出。
 * 点击整卡跳到 `/chat/<key>`，也可点右上角关闭；6 秒后自动消失（展开快速回复时暂停）。
 * 同一会话 10 秒内的多条消息由 XmppChatContext 聚合成一条并累加计数。
 * 免打扰开启时不会出现本提示（消息照常落库、未读角标照常）。
 */
export default function ChatMessageToast() {
  const navigate = useNavigate()
  const location = useLocation()
  const { messageNotice, dismissMessageNotice, sendText } = useXmppChat()

  const key = messageNotice?.key ?? null
  const receivedAt = messageNotice?.receivedAt ?? 0
  const count = messageNotice?.count ?? 0

  const [replyOpen, setReplyOpen] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [replyError, setReplyError] = useState('')
  const replyRef = useRef<HTMLTextAreaElement>(null)

  // 已经停在该会话页面时收起提示（例如从别处跳转过来）
  useEffect(() => {
    if (!key) return
    if (location.pathname === `/chat/${key}`) dismissMessageNotice()
  }, [key, location.pathname, dismissMessageNotice])

  // 换会话/提示消失时重置快速回复状态（同一会话聚合新消息不动输入内容）
  useEffect(() => {
    if (key) return
    setReplyOpen(false)
    setReplyText('')
    setReplyError('')
  }, [key])

  // 自动消失；聚合到新消息时 receivedAt 变化会重置计时；展开快速回复时暂停
  useEffect(() => {
    if (!key || !receivedAt || replyOpen) return
    const timer = setTimeout(() => {
      dismissMessageNotice()
    }, AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [key, receivedAt, replyOpen, dismissMessageNotice])

  // 展开后聚焦输入框
  useEffect(() => {
    if (replyOpen) replyRef.current?.focus()
  }, [replyOpen])

  if (!messageNotice) return null

  const openConversation = () => {
    const target = messageNotice.key
    dismissMessageNotice()
    if (location.pathname !== `/chat/${target}`) navigate(`/chat/${target}`)
  }

  const prepareReply = () => {
    setReplyOpen(true)
    setReplyError('')
  }

  const sendReply = async (text: string) => {
    const body = text.replace(/\s+/g, ' ').trim()
    if (!body || sending) return
    setSending(true)
    setReplyError('')
    try {
      await sendText(messageNotice.key, body)
      setReplyText('')
      setReplyOpen(false)
      dismissMessageNotice()
    } catch (err) {
      setReplyError(err instanceof Error && err.message ? err.message : '发送失败，请重试')
    } finally {
      setSending(false)
    }
  }

  return createPortal(
    <section
      className={`gh-msg-toast ${replyOpen ? 'gh-msg-toast--reply' : ''}`}
      role="status"
      aria-live="polite"
      aria-label="新消息提示"
    >
      <div className="gh-msg-toast-body">
        <button type="button" className="gh-msg-toast-main" onClick={openConversation}>
          <NekoAvatar
            nekoId={messageNotice.avatarNekoId}
            avatarVersion={messageNotice.avatarVersion}
            fallbackId={messageNotice.avatarId}
            name={messageNotice.title}
            size="md"
          />
          <span className="gh-msg-toast-copy">
            <span className="gh-msg-toast-head">
              <span className="gh-msg-toast-title">{messageNotice.title}</span>
              {count > 1 && <span className="gh-msg-toast-count">{count > 99 ? '99+' : count}</span>}
            </span>
            <span className="gh-msg-toast-preview">
              {messageNotice.kind === 'room' ? `${messageNotice.fromName}：` : ''}
              {messageNotice.preview}
            </span>
            <span className="gh-msg-toast-hint">
              {replyOpen ? '回复将直接发送到该会话' : '点击查看'}
            </span>
          </span>
          {messageNotice.image && (
            <img className="gh-msg-toast-thumb" src={messageNotice.image} alt="" loading="lazy" />
          )}
        </button>
        <button
          type="button"
          className="gh-msg-toast-close"
          aria-label="关闭新消息提示"
          onClick={dismissMessageNotice}
        >
          ×
        </button>
      </div>

      {replyOpen ? (
        <div className="gh-msg-toast-reply">
          {QUICK_PHRASES.length > 0 && (
            <div className="gh-msg-toast-phrases">
              {QUICK_PHRASES.map((phrase) => (
                <button
                  key={phrase}
                  type="button"
                  className="gh-msg-toast-phrase"
                  disabled={sending}
                  onClick={() => void sendReply(phrase)}
                >
                  {phrase}
                </button>
              ))}
            </div>
          )}
          <div className="gh-msg-toast-reply-row">
            <textarea
              ref={replyRef}
              className="gh-input gh-msg-toast-input"
              rows={1}
              value={replyText}
              maxLength={2000}
              placeholder={`回复 ${messageNotice.title}`}
              disabled={sending}
              onChange={(event) => setReplyText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void sendReply(replyText)
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setReplyOpen(false)
                }
              }}
            />
            <button
              type="button"
              className="gh-btn gh-btn--primary gh-btn--sm"
              disabled={sending || !replyText.trim()}
              onClick={() => void sendReply(replyText)}
            >
              {sending ? '发送中…' : '发送'}
            </button>
          </div>
          {replyError && <p className="gh-msg-toast-error">{replyError}</p>}
        </div>
      ) : (
        <div className="gh-msg-toast-actions">
          <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={prepareReply}>
            快速回复
          </button>
        </div>
      )}
    </section>,
    PORTAL_ROOT,
  )
}
