import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import UserAvatar from '../UserAvatar'
import { useAuth } from '../../contexts/AuthContext'
import { useChat } from '../../contexts/ChatContext'
import { gameMatchPath, useGame } from '../../contexts/GameContext'
import { inviteGameLabel, inviteKey, invitePath } from '../../lib/invites'
import type { GameInvite } from '../../types/game'

const PORTAL_ROOT = document.body

function countdownText(seconds: number): string {
  if (seconds <= 0) return '已过期'
  if (seconds < 60) return `${seconds} 秒后过期`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')} 后过期`
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

/**
 * 全局游戏邀请提示：挂在 Routes 外，任意页面都能收到好友邀请或开局提醒。
 * 收到邀请时显示倒计时与接受/拒绝；对局开始时显示「进入对局」。一次只展示一条。
 */
export default function GameInviteToast() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const meId = user?.id ?? 0
  const { transport } = useChat()
  const {
    incomingInvites,
    startedMatch,
    externalMatch,
    respondInvite,
    dismissStartedMatch,
    dismissExternalMatch,
  } = useGame()

  const [hiddenInviteIds, setHiddenInviteIds] = useState<string[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 邀请从列表消失后释放本地隐藏标记，避免服务重启后复用 id 时被错误屏蔽
  useEffect(() => {
    if (hiddenInviteIds.length === 0) return
    const liveIds = new Set(incomingInvites.map((item) => inviteKey(item)))
    setHiddenInviteIds((prev) => {
      const next = prev.filter((id) => liveIds.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [incomingInvites, hiddenInviteIds.length])

  const invite = useMemo(
    () => incomingInvites.find((item) => !hiddenInviteIds.includes(inviteKey(item))) ?? null,
    [incomingInvites, hiddenInviteIds]
  )

  const matchPath = startedMatch ? gameMatchPath(startedMatch) : externalMatch?.path ?? null
  // 已经在对局页面时不再重复提示
  const onStartedMatchPage = matchPath !== null && location.pathname === matchPath
  const showStarted = Boolean(startedMatch || externalMatch) && !onStartedMatchPage

  // 倒计时每秒刷新（邀请与对局提示都需要最新时间）
  useEffect(() => {
    if (!invite && !showStarted) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [invite?.id, showStarted])

  const remainingSeconds = invite
    ? Math.max(0, Math.ceil((Date.parse(invite.expiresAt) - now) / 1_000) || 0)
    : 0

  const hideInvite = useCallback((key: string) => {
    setHiddenInviteIds((prev) => (prev.includes(key) ? prev : [...prev, key]))
  }, [])

  const handleAccept = useCallback(async () => {
    if (!invite) return
    setBusy('accept')
    setError(null)
    try {
      const match = await respondInvite(invite.id, 'accept', invite.game ?? '2048')
      if (match) {
        dismissStartedMatch()
        navigate(gameMatchPath(match))
      } else {
        const target = invitePath(invite)
        if (target) navigate(target)
        hideInvite(inviteKey(invite))
      }
    } catch (err) {
      setError(errorMessage(err, '接受邀请失败'))
    } finally {
      setBusy(null)
    }
  }, [invite, respondInvite, dismissStartedMatch, navigate, hideInvite])

  const handleDecline = useCallback(async () => {
    if (!invite) return
    setBusy('decline')
    setError(null)
    try {
      await respondInvite(invite.id, 'decline', invite.game ?? '2048')
      hideInvite(inviteKey(invite))
    } catch (err) {
      setError(errorMessage(err, '拒绝邀请失败'))
    } finally {
      setBusy(null)
    }
  }, [invite, respondInvite, hideInvite])

  const handleEnterMatch = useCallback(() => {
    if (startedMatch) {
      dismissStartedMatch()
      navigate(gameMatchPath(startedMatch))
      return
    }
    if (externalMatch) {
      dismissExternalMatch()
      navigate(externalMatch.path)
    }
  }, [startedMatch, externalMatch, dismissStartedMatch, dismissExternalMatch, navigate])

  const opponents = (startedMatch?.players ?? []).filter((player) => player.userId !== meId)
  const opponentNames = opponents.map((player) => player.username).join('、')

  if (!showStarted && !invite) return null

  return createPortal(
    <section className="gh-game-toast" aria-live="polite" aria-label="游戏邀请">
      <div className="gh-game-toast-head">
        <span className="gh-game-toast-eyebrow">
          {showStarted
            ? '对局已开始'
            : `${inviteGameLabel(invite)}邀请`}
        </span>
        <button
          type="button"
          className="gh-game-toast-close"
          aria-label="关闭游戏邀请提示"
          onClick={() => {
            if (showStarted) {
              dismissStartedMatch()
              dismissExternalMatch()
            } else if (invite) {
              hideInvite(inviteKey(invite))
            }
          }}
        >
          ×
        </button>
      </div>

      {showStarted ? (
        <div className="gh-game-toast-body">
          <p className="gh-game-toast-text">
            {startedMatch
              ? opponentNames
                ? `${opponentNames} 与你的${inviteGameLabel(startedMatch)}对局已开始。`
                : '你的对局已开始。'
              : `${externalMatch?.label ?? '对局'}已经开始了。`}
          </p>
          <div className="gh-game-toast-actions">
            <button type="button" className="gh-btn gh-btn--primary gh-btn--md" onClick={handleEnterMatch}>
              进入对局
            </button>
            <button
              type="button"
              className="gh-btn gh-btn--secondary gh-btn--md"
              onClick={() => {
                dismissStartedMatch()
                dismissExternalMatch()
              }}
            >
              稍后
            </button>
          </div>
        </div>
      ) : (
        invite && (
          <div className="gh-game-toast-body">
            <div className="gh-game-toast-user">
              <UserAvatar userId={invite.from.id} username={invite.from.username} size="md" />
              <div className="gh-game-toast-user-copy">
                <strong className="gh-game-toast-username">{invite.from.username}</strong>
                <span className="gh-game-toast-desc">
                  {invite.game === 'raid'
                    ? '邀请你组队出击搜打撤'
                    : invite.game === 'petbattle'
                      ? '邀请你进行宠物对决'
                      : `邀请你进行 ${inviteGameLabel(invite)} 对战`}
                </span>
              </div>
            </div>
            <p className={`gh-game-toast-countdown${remainingSeconds <= 10 ? ' gh-game-toast-countdown--urgent' : ''}`}>
              {countdownText(remainingSeconds)}
            </p>
            <div className="gh-game-toast-actions">
              <button
                type="button"
                className="gh-btn gh-btn--primary gh-btn--md"
                disabled={busy !== null || remainingSeconds <= 0}
                onClick={() => void handleAccept()}
              >
                {busy === 'accept' ? '接受中…' : '接受'}
              </button>
              <button
                type="button"
                className="gh-btn gh-btn--secondary gh-btn--md"
                disabled={busy !== null}
                onClick={() => void handleDecline()}
              >
                {busy === 'decline' ? '拒绝中…' : '拒绝'}
              </button>
            </div>
          </div>
        )
      )}

      {error && (
        <p className="gh-game-toast-error" role="alert">
          {error}
        </p>
      )}
      {transport === 'polling' && (
        <p className="gh-game-toast-hint">轮询模式：邀请与对局状态约有 2–5 秒延迟</p>
      )}
    </section>,
    PORTAL_ROOT
  )
}
