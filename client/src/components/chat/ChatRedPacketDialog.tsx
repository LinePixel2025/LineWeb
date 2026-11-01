import { useCallback, useEffect, useState } from 'react'
import { usePoints } from '../../contexts/PointsContext'
import api from '../../lib/api'
import type { RedPacketView } from '../../types/redpacket'

interface Props {
  open: boolean
  redPacketId: number | null
  onClose: () => void
}

/** 详情加载状态：loading / 错误 / 就绪 */
type DetailState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; view: RedPacketView }

/** 最佳手气标记只在拼手气（多于一份）时展示，避免单人红包显示无意义 */
function bestLuckAmount(claims: RedPacketView['claims']): number | null {
  if (claims.length < 2) return null
  return claims.reduce((max, claim) => (claim.amount > max ? claim.amount : max), 0)
}

/**
 * 红包详情 / 领取弹窗。
 *
 * open 时按红包 id 拉取 `GET /chat/xmpp/redpackets/:id`；
 * 可领取（active 且非本人且未领过）时展示「開」按钮，领取走
 * `POST /chat/xmpp/redpackets/:id/claim` 并同步积分余额。
 */
export default function ChatRedPacketDialog({ open, redPacketId, onClose }: Props) {
  const { applyLocalDelta, refresh } = usePoints()
  const [detail, setDetail] = useState<DetailState>({ phase: 'loading' })
  const [claiming, setClaiming] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)
  /** 本次会话刚领到的金额（展示大字结果态；旧领取记录走 view.myClaim） */
  const [justClaimed, setJustClaimed] = useState<number | null>(null)

  const loadDetail = useCallback(async (id: number, silent = false) => {
    // 静默刷新（领取后同步明细）不置 loading，避免结果大字闪回加载态
    if (!silent) setDetail({ phase: 'loading' })
    try {
      const view = await api.get<RedPacketView>(`/chat/xmpp/redpackets/${id}`)
      setDetail({ phase: 'ready', view })
    } catch (err) {
      if (!silent) {
        setDetail({
          phase: 'error',
          message: err instanceof Error && err.message ? err.message : '红包详情加载失败',
        })
      }
      // 静默刷新失败时保留现有视图，避免覆盖已展示的结果
    }
  }, [])

  useEffect(() => {
    if (!open) {
      // 关闭后重置内部状态（下次打开重新拉取详情）
      setDetail({ phase: 'loading' })
      setClaiming(false)
      setClaimError(null)
      setJustClaimed(null)
      return
    }
    if (redPacketId == null) return
    void loadDetail(redPacketId)
  }, [open, redPacketId, loadDetail])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  const claim = async () => {
    if (redPacketId == null || claiming) return
    setClaiming(true)
    setClaimError(null)
    try {
      const result = await api.post<{ amount: number; balance: number }>(
        `/chat/xmpp/redpackets/${redPacketId}/claim`,
      )
      setJustClaimed(result.amount)
      // 本地先加余额秒开，再由 refresh 以服务端台账校准
      applyLocalDelta(result.amount)
      void refresh()
      // 领取后静默刷新明细，让自己的记录出现在列表里
      await loadDetail(redPacketId, true)
    } catch (err) {
      setClaimError(err instanceof Error && err.message ? err.message : '领取失败')
      // 可能已被抢完 / 已领过：静默刷新详情对齐最新状态
      void loadDetail(redPacketId, true)
    } finally {
      setClaiming(false)
    }
  }

  if (!open || redPacketId == null) return null

  const view = detail.phase === 'ready' ? detail.view : null
  const senderName = view?.senderName || 'LineWeb 红包'
  const claimedAmount = justClaimed ?? view?.myClaim?.amount ?? null
  const canClaim = !!view
    && view.status === 'active'
    && !view.isMine
    && !view.myClaim
    && justClaimed === null
  const bestLuck = view ? bestLuckAmount(view.claims) : null

  return (
    <div className="gh-chat-dialog-overlay" onClick={onClose}>
      <div
        className="gh-chat-dialog gh-chat-redpacket-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="红包"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="gh-chat-redpacket-envelope">
          <button type="button" className="gh-chat-redpacket-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
          <p className="gh-chat-redpacket-greeting">
            {view ? (view.greeting || '恭喜发财，大吉大利') : '红包'}
          </p>
          <p className="gh-chat-redpacket-sender">来自 {senderName}</p>
        </header>

        <div className="gh-chat-dialog-body gh-chat-redpacket-body">
          {detail.phase === 'loading' && (
            <div className="gh-chat-redpacket-state">
              <div className="gh-spinner" />
              <span>正在打开红包…</span>
            </div>
          )}

          {detail.phase === 'error' && (
            <div className="gh-chat-redpacket-state">
              <div className="gh-alert gh-alert--danger" role="alert">{detail.message}</div>
              <button
                type="button"
                className="gh-btn gh-btn--secondary gh-btn--sm"
                onClick={() => void loadDetail(redPacketId)}
              >
                重试
              </button>
            </div>
          )}

          {view && (
            <>
              {claimedAmount != null ? (
                <div className="gh-chat-redpacket-result" role="status">
                  <span className="gh-chat-redpacket-result-amount">
                    {claimedAmount}
                    <small> 积分</small>
                  </span>
                  <span className="gh-chat-redpacket-result-hint">已存入积分余额</span>
                </div>
              ) : canClaim ? (
                <div className="gh-chat-redpacket-open-wrap">
                  <button
                    type="button"
                    className="gh-chat-redpacket-open-btn"
                    aria-label="领取红包"
                    disabled={claiming}
                    onClick={() => void claim()}
                  >
                    {claiming ? '…' : '開'}
                  </button>
                </div>
              ) : (
                <div className="gh-chat-redpacket-state">
                  {view.isMine ? (
                    <span>你发出的红包</span>
                  ) : view.status === 'finished' ? (
                    <span>手慢了，红包已被领完</span>
                  ) : null}
                  {view.status === 'expired' && (
                    <span>已过期，未领取金额已退回</span>
                  )}
                </div>
              )}

              {claimError && (
                <div className="gh-alert gh-alert--danger" role="alert">{claimError}</div>
              )}

              <ul className="gh-chat-redpacket-claims">
                {view.claims.map((claimRow) => (
                  <li key={`${claimRow.userId}-${claimRow.claimedAt}`} className="gh-chat-redpacket-claim">
                    <span className="gh-chat-redpacket-claim-name">
                      {claimRow.username || '未知用户'}
                      {bestLuck !== null && claimRow.amount === bestLuck && (
                        <span className="gh-chat-redpacket-claim-best" title="手气最佳">
                          👑 手气最佳
                        </span>
                      )}
                    </span>
                    <span className="gh-chat-redpacket-claim-amount">{claimRow.amount} 积分</span>
                  </li>
                ))}
                {view.claims.length === 0 && (
                  <li className="gh-chat-redpacket-claim gh-chat-redpacket-claim--empty">
                    还没有人领取
                  </li>
                )}
              </ul>

              <p className="gh-chat-redpacket-summary">
                {view.status === 'expired'
                  ? `已过期：${view.claimedCount}/${view.count} 份已领，共 ${view.claimedPoints} 积分，未领取金额已退回`
                  : `已领 ${view.claimedCount}/${view.count} 份，共 ${view.claimedPoints} 积分`}
              </p>
            </>
          )}
        </div>

        <footer className="gh-chat-dialog-footer">
          <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  )
}
