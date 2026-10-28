import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import UserAvatar from '../UserAvatar'
import { useXmppChat } from '../../contexts/XmppChatContext'

const PORTAL_ROOT = document.body
/** 自动消失时间（毫秒）；比游戏邀请短，避免打断操作 */
const AUTO_DISMISS_MS = 6_000

/**
 * 全局新消息提示
 *
 * 挂在 Routes 之外，任何页面（含游戏对局）收到非当前会话的实时消息时都会弹出。
 * 点击整卡跳到 `/chat/<key>`，也可点右上角关闭；6 秒后自动消失。
 * 同一会话 10 秒内的多条消息由 XmppChatContext 聚合成一条并累加计数。
 */
export default function ChatMessageToast() {
  const navigate = useNavigate()
  const location = useLocation()
  const { messageNotice, dismissMessageNotice } = useXmppChat()

  const key = messageNotice?.key ?? null
  const receivedAt = messageNotice?.receivedAt ?? 0
  const count = messageNotice?.count ?? 0

  // 已经停在该会话页面时收起提示（例如从别处跳转过来）
  useEffect(() => {
    if (!key) return
    if (location.pathname === `/chat/${key}`) dismissMessageNotice()
  }, [key, location.pathname, dismissMessageNotice])

  // 自动消失；聚合到新消息时 receivedAt 变化会重置计时
  useEffect(() => {
    if (!key || !receivedAt) return
    const timer = setTimeout(() => {
      dismissMessageNotice()
    }, AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [key, receivedAt, dismissMessageNotice])

  if (!messageNotice) return null

  const openConversation = () => {
    const target = messageNotice.key
    dismissMessageNotice()
    if (location.pathname !== `/chat/${target}`) navigate(`/chat/${target}`)
  }

  return createPortal(
    <section
      className="gh-msg-toast"
      role="status"
      aria-live="polite"
      aria-label="新消息提示"
    >
      <button type="button" className="gh-msg-toast-main" onClick={openConversation}>
        <UserAvatar userId={messageNotice.avatarId} username={messageNotice.title} size="md" />
        <span className="gh-msg-toast-copy">
          <span className="gh-msg-toast-head">
            <span className="gh-msg-toast-title">{messageNotice.title}</span>
            {count > 1 && <span className="gh-msg-toast-count">{count > 99 ? '99+' : count}</span>}
          </span>
          <span className="gh-msg-toast-preview">
            {messageNotice.kind === 'room' ? `${messageNotice.fromName}：` : ''}
            {messageNotice.preview}
          </span>
          <span className="gh-msg-toast-hint">点击查看</span>
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
    </section>,
    PORTAL_ROOT,
  )
}
