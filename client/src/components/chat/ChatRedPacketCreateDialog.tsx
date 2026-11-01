import { useEffect, useMemo, useState } from 'react'
import { usePoints } from '../../contexts/PointsContext'
import { useXmppChat } from '../../contexts/XmppChatContext'
import api from '../../lib/api'
import type { RedPacketCreateResult } from '../../types/redpacket'

/** 发红包目标（由 ChatThread 按当前会话构造） */
export interface ChatRedPacketTarget {
  /** 会话键（红包消息发往该会话） */
  key: string
  /** direct 单聊专属红包 / group 群聊拼手气红包 */
  type: 'direct' | 'group'
  /** 单聊对方的 neko id（= 1e12 + LineWeb 用户 id，服务端据此落账） */
  peerNekoId?: number
  /** 群聊会话 id */
  roomId?: number
}

interface Props {
  open: boolean
  target: ChatRedPacketTarget | null
  onClose: () => void
}

/** 单笔红包积分上限（与服务端约定一致） */
const RED_PACKET_MAX_POINTS = 50_000
/** 拼手气份数范围（与服务端约定一致） */
const RED_PACKET_MIN_COUNT = 2
const RED_PACKET_MAX_COUNT = 100
const RED_PACKET_DEFAULT_COUNT = 5
const DEFAULT_GREETING = '恭喜发财，大吉大利'
const GREETING_MAX_LENGTH = 50

/**
 * 发红包弹窗：单聊专属红包（对方领全部）/ 群聊拼手气红包（份数随机拆分）。
 *
 * 提交流程：REST 创建红包并扣分 → 本地先扣余额 → XMPP 发送红包消息 → refresh 校准。
 * 创建成功但消息发送失败时保留弹窗可重试，重试只重发消息、不会重复扣款。
 */
export default function ChatRedPacketCreateDialog({ open, target, onClose }: Props) {
  const { balance, applyLocalDelta, refresh } = usePoints()
  const { sendRedPacketMessage } = useXmppChat()
  const [amountText, setAmountText] = useState('')
  const [countText, setCountText] = useState(String(RED_PACKET_DEFAULT_COUNT))
  const [greeting, setGreeting] = useState(DEFAULT_GREETING)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 已创建的红包 id 与扣分额（消息发送失败后重试时跳过创建，避免双花） */
  const [createdId, setCreatedId] = useState<number | null>(null)
  const [createdTotal, setCreatedTotal] = useState<number | null>(null)

  const isGroup = target?.type === 'group'

  useEffect(() => {
    if (!open) return
    // 打开时重置表单（关闭态由父级条件挂载，挂载即全新状态）
    setAmountText('')
    setCountText(String(RED_PACKET_DEFAULT_COUNT))
    setGreeting(DEFAULT_GREETING)
    setSubmitting(false)
    setError(null)
    setCreatedId(null)
    setCreatedTotal(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  const amount = amountText ? Number.parseInt(amountText, 10) : Number.NaN
  const count = isGroup ? (countText ? Number.parseInt(countText, 10) : Number.NaN) : 1

  /** 客户端预校验：非法时返回原因（按钮置灰并提示） */
  const validationError = useMemo(() => {
    if (!Number.isInteger(amount) || amount < 1) return '请输入不小于 1 的积分金额'
    if (amount > RED_PACKET_MAX_POINTS) return `单次最多 ${RED_PACKET_MAX_POINTS} 积分`
    if (isGroup) {
      if (!Number.isInteger(count) || count < RED_PACKET_MIN_COUNT || count > RED_PACKET_MAX_COUNT) {
        return `份数需在 ${RED_PACKET_MIN_COUNT}–${RED_PACKET_MAX_COUNT} 之间`
      }
      if (amount < count) return '金额不能小于份数（每份至少 1 积分）'
    }
    if (amount > balance) return '余额不足'
    return null
  }, [amount, count, isGroup, balance])

  if (!open || !target) return null

  const submit = async () => {
    if (!target || validationError || submitting) return
    if (isGroup && !target.roomId) {
      setError('当前会话不支持发红包')
      return
    }
    if (!isGroup && !target.peerNekoId) {
      setError('当前会话不支持发红包')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      let packetId = createdId
      let deducted = createdTotal
      if (packetId == null) {
        const payload = isGroup
          ? {
              roomId: target.roomId,
              totalPoints: amount,
              count,
              type: 'lucky' as const,
              greeting: greeting.trim(),
            }
          : {
              peer: target.peerNekoId,
              totalPoints: amount,
              type: 'single' as const,
              greeting: greeting.trim(),
            }
        const created = await api.post<RedPacketCreateResult>('/chat/xmpp/redpackets', payload)
        packetId = created.id
        deducted = created.totalPoints
        setCreatedId(packetId)
        setCreatedTotal(deducted)
        // 本地先扣减余额秒开，随后 refresh 以服务端台账校准
        applyLocalDelta(-deducted)
      }
      try {
        await sendRedPacketMessage(target.key, packetId, greeting)
      } catch (sendErr) {
        // 红包已创建并扣分，只是消息没发出去：保留弹窗可重试，重试只重发消息
        const reason = sendErr instanceof Error && sendErr.message ? sendErr.message : '未知错误'
        setError(`红包已创建并扣除 ${deducted ?? amount} 积分，但消息发送失败：${reason}。可直接重试，不会重复扣款。`)
        void refresh()
        return
      }
      void refresh()
      onClose()
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : '发送红包失败，请稍后再试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="gh-chat-dialog-overlay" onClick={onClose}>
      <div
        className="gh-chat-dialog gh-chat-redpacket-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={isGroup ? '发拼手气红包' : '发红包'}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="gh-chat-dialog-header">
          <h2 className="gh-chat-dialog-title">{isGroup ? '发拼手气红包' : '发红包'}</h2>
          <button type="button" className="gh-chat-dialog-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="gh-chat-dialog-body gh-chat-redpacket-form">
          <p className="gh-chat-redpacket-balance">
            当前积分：<strong>{balance}</strong>
          </p>

          <label className="gh-chat-field">
            <span className="gh-chat-field-label">积分金额</span>
            <input
              className="gh-input gh-chat-field-input"
              inputMode="numeric"
              autoComplete="off"
              placeholder="输入积分金额"
              value={amountText}
              disabled={submitting}
              onChange={(event) => setAmountText(event.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </label>

          {isGroup && (
            <>
              <label className="gh-chat-field">
                <span className="gh-chat-field-label">份数</span>
                <input
                  className="gh-input gh-chat-field-input"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={`${RED_PACKET_MIN_COUNT}–${RED_PACKET_MAX_COUNT} 份`}
                  value={countText}
                  disabled={submitting}
                  onChange={(event) => setCountText(event.target.value.replace(/\D/g, '').slice(0, 3))}
                />
              </label>
              <p className="gh-chat-redpacket-hint">拼手气红包：金额随机拆分</p>
            </>
          )}

          <label className="gh-chat-field">
            <span className="gh-chat-field-label">祝福语</span>
            <input
              className="gh-input gh-chat-field-input"
              autoComplete="off"
              maxLength={GREETING_MAX_LENGTH}
              placeholder={DEFAULT_GREETING}
              value={greeting}
              disabled={submitting}
              onChange={(event) => setGreeting(event.target.value)}
            />
          </label>

          {amountText && validationError && (
            <p className="gh-chat-redpacket-warn" role="status">{validationError}</p>
          )}
          {error && <div className="gh-alert gh-alert--danger" role="alert">{error}</div>}
        </div>

        <footer className="gh-chat-dialog-footer">
          <button
            type="button"
            className="gh-btn gh-btn--secondary gh-btn--md"
            disabled={submitting}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="gh-btn gh-btn--primary gh-btn--md"
            disabled={submitting || validationError !== null}
            title={validationError ?? undefined}
            onClick={() => void submit()}
          >
            {submitting ? '发送中…' : '塞钱进红包'}
          </button>
        </footer>
      </div>
    </div>
  )
}
