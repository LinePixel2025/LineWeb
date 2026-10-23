import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import GameFriendPicker from '../../components/games/GameFriendPicker'
import GameMatchPanel from '../../components/games/GameMatchPanel'
import GameRoomPanel from '../../components/games/GameRoomPanel'
import { useGame2048Input } from '../../hooks/useGame2048Input'
import { useAuth } from '../../contexts/AuthContext'
import { useChat } from '../../contexts/ChatContext'
import { useGame } from '../../contexts/GameContext'
import api from '../../lib/api'
import { GAME_POLL_INTERVALS } from '../../lib/realtime'
import { GAME_2048_ROUTE } from '../../lib/games/catalog'
import type {
  Game2048Direction,
  Game2048Match,
  GameActiveMatchResponse,
  GameFriend,
  GameFriendsResponse,
  GameMatchResponse,
  GameMoveResponse,
  GameSyncResponse,
} from '../../types/game'

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

const LOBBY_PATH = '/games/2048/online'

function matchPath(matchId: number): string {
  return `${LOBBY_PATH}/${matchId}`
}

/**
 * 2048 好友联机：
 * - 无 matchId：先查进行中的对局（有则跳转），否则展示大厅（好友列表 + 邀请）。
 * - 有 matchId：展示对局面板；WS 模式下订阅 game:match:update/ended，轮询模式下每 2s 拉 sync。
 * 移动请求串行化（同时只有一个在途，只保留最新一次方向），应用服务端棋盘前比较版本号。
 */
export default function Game2048OnlinePage() {
  const { matchId: matchIdParam } = useParams<{ matchId?: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const meId = user?.id ?? 0
  const { connectionState, transport, subscribe } = useChat()
  const {
    incomingInvites,
    outgoingInvites,
    createInvite,
    cancelInvite,
    respondInvite,
    refreshInvites,
    dismissStartedMatch,
    startedMatch,
    error: invitesError,
  } = useGame()

  const matchId =
    matchIdParam && /^\d+$/.test(matchIdParam) ? Number.parseInt(matchIdParam, 10) : null
  const friendParam = searchParams.get('friend')
  const highlightFriendId =
    friendParam && /^\d+$/.test(friendParam) ? Number.parseInt(friendParam, 10) : null

  const [match, setMatch] = useState<Game2048Match | null>(null)
  const [matchLoading, setMatchLoading] = useState(matchId !== null)
  const [matchError, setMatchError] = useState<string | null>(null)
  const [friends, setFriends] = useState<GameFriend[]>([])
  const [friendsLoading, setFriendsLoading] = useState(matchId === null)
  const [friendsError, setFriendsError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [movesPending, setMovesPending] = useState(false)
  const [remainingMs, setRemainingMs] = useState(0)

  const matchRef = useRef<Game2048Match | null>(null)
  const matchIdRef = useRef<number | null>(matchId)
  const inFlightRef = useRef(false)
  const queuedDirectionRef = useRef<Game2048Direction | null>(null)
  /** 明确「返回大厅」时跳过 active 对局查询，避免被立即送回对局 */
  const skipActiveCheckRef = useRef(false)

  useEffect(() => {
    matchRef.current = match
  }, [match])

  useEffect(() => {
    matchIdRef.current = matchId
  }, [matchId])

  const applyMatch = useCallback((next: Game2048Match) => {
    setMatchError(null)
    setMatch((prev) => {
      if (!prev) return next
      if (next.id !== prev.id) return next
      // 只接受更新版本，避免乱序响应把棋盘回退
      if (next.version <= prev.version) return prev
      return next
    })
  }, [])

  const loadMatch = useCallback(
    async (id: number, force = false) => {
      try {
        const data = await api.get<GameMatchResponse>(`/games/2048/matches/${id}`)
        // 页面已切换到别的对局 / 返回大厅时丢弃过期响应
        if (matchIdRef.current !== id) return
        if (force) {
          setMatch(data.match)
        } else {
          applyMatch(data.match)
        }
        setMatchError(null)
      } catch (err) {
        if (matchIdRef.current === id) {
          setMatchError(errorMessage(err, '加载对局失败'))
        }
      } finally {
        setMatchLoading(false)
      }
    },
    [applyMatch]
  )

  const loadFriends = useCallback(async (showLoading = true) => {
    if (showLoading) setFriendsLoading(true)
    try {
      const data = await api.get<GameFriendsResponse>('/games/2048/friends')
      setFriends(data.friends ?? [])
      setFriendsError(null)
    } catch (err) {
      setFriendsError(errorMessage(err, '加载好友列表失败'))
    } finally {
      setFriendsLoading(false)
      setMatchLoading(false)
    }
  }, [])

  // 初始化：对局详情 / active 对局 / 大厅
  useEffect(() => {
    let cancelled = false
    setActionError(null)
    setMatchError(null)

    if (matchId) {
      skipActiveCheckRef.current = false
      setMatch(null)
      setMatchLoading(true)
      void loadMatch(matchId, true)
      return () => {
        cancelled = true
      }
    }

    setMatch(null)
    if (skipActiveCheckRef.current) {
      // 从对局主动返回大厅：不再自动跳回对局
      skipActiveCheckRef.current = false
      setMatchLoading(false)
      void loadFriends(true)
      return () => {
        cancelled = true
      }
    }

    setMatchLoading(true)
    setFriendsLoading(true)
    api
      .get<GameActiveMatchResponse>('/games/2048/matches/active')
      .then((data) => {
        if (cancelled) return
        const active = data.match
        if (active && active.status === 'playing') {
          navigate(matchPath(active.id), { replace: true })
          return
        }
        void loadFriends(true)
      })
      .catch((err) => {
        if (cancelled) return
        setFriendsError(errorMessage(err, '加载大厅失败'))
        setMatchLoading(false)
        setFriendsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [matchId, loadMatch, loadFriends, navigate])

  // 已进入对局页：清掉全局「对局已开始」提示
  useEffect(() => {
    if (matchId && startedMatch?.id === matchId) dismissStartedMatch()
  }, [matchId, startedMatch, dismissStartedMatch])

  // 大厅/等待房间的好友在线状态：定期刷新，并在本端 WS 建立/恢复后立即刷新一次，
  // 避免页面加载早于对方 WS 连接时一直显示「离线」。
  useEffect(() => {
    if (matchId && match?.status !== 'waiting') return
    // 首次 3 秒补一次，解决「本页先加载、对方 WS 后连接」时的离线误判
    const quickRefresh = setTimeout(() => void loadFriends(false), 3_000)
    const timer = setInterval(() => void loadFriends(false), 15_000)
    return () => {
      clearTimeout(quickRefresh)
      clearInterval(timer)
    }
  }, [matchId, match?.status, loadFriends])

  useEffect(() => {
    if (matchId && match?.status !== 'waiting') return
    if (connectionState !== 'open') return
    void loadFriends(false)
  }, [matchId, match?.status, connectionState, loadFriends])

  // 等待房间：加载一次好友列表用于邀请（大厅初始化只加载了 match）
  useEffect(() => {
    if (!matchId || match?.status !== 'waiting') return
    void loadFriends(true)
  }, [matchId, match?.status, loadFriends])

  // WS 模式：订阅房间更新 / 开局 / 结束
  useEffect(() => {
    if (!matchId || transport !== 'ws') return
    const unsubscribe = subscribe((event) => {
      if (
        event.type !== 'game:match:update'
        && event.type !== 'game:match:started'
        && event.type !== 'game:match:ended'
      ) {
        return
      }
      if (event.match.id !== matchId) return
      applyMatch(event.match)
      if (event.type === 'game:match:ended' && event.match.reason === 'cancelled') {
        skipActiveCheckRef.current = true
        navigate(LOBBY_PATH, { replace: true })
      }
    })
    return unsubscribe
  }, [matchId, transport, subscribe, applyMatch, navigate])

  // 传输模式切换时补拉一次对局，避免 WS 建立/断开瞬间漏掉版本
  useEffect(() => {
    if (!matchId) return
    void loadMatch(matchId, false)
  }, [matchId, transport, loadMatch])

  // 轮询模式：每 2 秒拉一次 sync（对局结束或离开后自动停止）
  useEffect(() => {
    if (!matchId || transport !== 'polling') return
    let disposed = false

    const poll = async () => {
      if (disposed) return
      if (matchRef.current?.status === 'finished') return
      try {
        const data = await api.get<GameSyncResponse>(`/games/2048/sync?matchId=${matchId}`)
        if (disposed || !data.match) return
        applyMatch(data.match)
        if (data.match.reason === 'cancelled') {
          skipActiveCheckRef.current = true
          navigate(LOBBY_PATH, { replace: true })
        }
      } catch {
        // 轮询失败静默重试
      }
    }

    void poll()
    const timer = setInterval(() => {
      void poll()
    }, GAME_POLL_INTERVALS.match)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void poll()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      disposed = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [matchId, transport, applyMatch, navigate])

  // 倒计时（以服务端 endsAt 为准）
  const endsAtMs = match?.endsAt ? Date.parse(match.endsAt) : Number.NaN
  const matchStatus = match?.status
  const currentMatchId = match?.id
  useEffect(() => {
    if (matchStatus !== 'playing' || Number.isNaN(endsAtMs)) {
      setRemainingMs(0)
      return
    }
    const tick = () => setRemainingMs(Math.max(0, endsAtMs - Date.now()))
    tick()
    const timer = setInterval(tick, 1_000)
    return () => clearInterval(timer)
  }, [currentMatchId, matchStatus, endsAtMs])

  const refreshMatch = useCallback(async () => {
    const id = matchIdRef.current
    if (!id) return
    try {
      const data = await api.get<GameMatchResponse>(`/games/2048/matches/${id}`)
      setMatch(data.match)
      setMatchError(null)
    } catch {
      // 保留当前棋盘，等待下一次同步
    }
  }, [])

  const performMoveRef = useRef<(direction: Game2048Direction) => void>(() => {})
  const performMove = useCallback(
    async (direction: Game2048Direction) => {
      const id = matchIdRef.current
      if (!id) return
      inFlightRef.current = true
      setMovesPending(true)
      try {
        const data = await api.post<GameMoveResponse>(`/games/2048/matches/${id}/moves`, {
          direction,
        })
        applyMatch(data.match)
        if (data.match.status === 'finished') queuedDirectionRef.current = null
      } catch {
        // 移动失败（版本冲突 / 网络异常）时以服务端为准刷新
        await refreshMatch()
      } finally {
        inFlightRef.current = false
        setMovesPending(false)
        const queued = queuedDirectionRef.current
        queuedDirectionRef.current = null
        // 对局可能已在本轮请求中结束；结束时不再发送排队的移动
        if (queued && matchRef.current?.status === 'playing') performMoveRef.current(queued)
      }
    },
    [applyMatch, refreshMatch]
  )

  useEffect(() => {
    performMoveRef.current = (direction) => {
      void performMove(direction)
    }
  }, [performMove])

  const sendMove = useCallback(
    (direction: Game2048Direction) => {
      const current = matchRef.current
      if (!current || current.status !== 'playing') return
      if (inFlightRef.current) {
        // 串行化：在途请求只保留最新一次方向
        queuedDirectionRef.current = direction
        return
      }
      void performMove(direction)
    },
    [performMove]
  )

  // 联机棋盘同样支持键盘方向键/WASD；触摸滑动由 Game2048Board 内部处理
  const me = match?.players.find((player) => player.userId === meId) ?? null
  const keyboardEnabled =
    match !== null && match.status === 'playing' && me !== null && me.status === 'playing'
  useGame2048Input({
    onMove: sendMove,
    enabled: keyboardEnabled,
    keyboard: true,
    touch: false,
  })

  const handleResign = useCallback(async () => {
    const id = matchIdRef.current
    const current = matchRef.current
    if (!id || !current || current.status !== 'playing') return
    if (!window.confirm('确定认输吗？你将退出本局竞速，其他玩家继续。')) return
    setBusyKey('resign')
    try {
      const data = await api.post<GameMatchResponse>(`/games/2048/matches/${id}/resign`)
      setMatch(data.match)
      setActionError(null)
    } catch (err) {
      setActionError(errorMessage(err, '认输失败'))
    } finally {
      setBusyKey(null)
    }
  }, [])

  const handleBackToLobby = useCallback(() => {
    const current = matchRef.current
    if (current && current.status === 'playing') {
      const leave = window.confirm('对局仍在进行中，确定返回大厅吗？你可以重新进入该对局。')
      if (!leave) return
    }
    skipActiveCheckRef.current = true
    setMatch(null)
    setMatchError(null)
    setActionError(null)
    navigate(LOBBY_PATH, { replace: true })
  }, [navigate])

  const handleRematch = useCallback(() => {
    skipActiveCheckRef.current = true
    setMatch(null)
    setMatchError(null)
    setActionError(null)
    navigate(LOBBY_PATH, { replace: true })
  }, [navigate])

  const handleStart = useCallback(async () => {
    const id = matchIdRef.current
    if (!id) return
    setBusyKey('start')
    setActionError(null)
    try {
      const data = await api.post<GameMatchResponse>(`/games/2048/matches/${id}/start`)
      setMatch(data.match)
    } catch (err) {
      setActionError(errorMessage(err, '开始游戏失败'))
    } finally {
      setBusyKey(null)
    }
  }, [])

  const handleLeaveRoom = useCallback(async () => {
    const id = matchIdRef.current
    const current = matchRef.current
    if (!id) return
    const isHost = current?.hostId === meId
    if (!window.confirm(isHost ? '确定解散房间吗？' : '确定离开房间吗？')) return
    setBusyKey('leave')
    setActionError(null)
    try {
      await api.post(`/games/2048/matches/${id}/leave`)
      skipActiveCheckRef.current = true
      setMatch(null)
      navigate(LOBBY_PATH, { replace: true })
    } catch (err) {
      setActionError(errorMessage(err, '离开房间失败'))
    } finally {
      setBusyKey(null)
    }
  }, [meId, navigate])

  const handleInvite = useCallback(
    async (friendId: number) => {
      setBusyKey(`invite-${friendId}`)
      setActionError(null)
      try {
        const result = await createInvite(friendId)
        // 从大厅发起邀请时，房主立即进入等待房间；房间内邀请则原地等待更多玩家
        if (result.match && result.match.id !== matchIdRef.current) {
          navigate(`/games/2048/online/${result.match.id}`)
        }
      } catch (err) {
        setActionError(errorMessage(err, '发送对战邀请失败'))
      } finally {
        setBusyKey(null)
      }
    },
    [createInvite, navigate]
  )

  const handleCancelInvite = useCallback(
    async (inviteId: number) => {
      setBusyKey(`cancel-${inviteId}`)
      setActionError(null)
      try {
        await cancelInvite(inviteId)
      } catch (err) {
        setActionError(errorMessage(err, '取消对战邀请失败'))
      } finally {
        setBusyKey(null)
      }
    },
    [cancelInvite]
  )

  const handleRespondInvite = useCallback(
    async (inviteId: number, action: 'accept' | 'decline') => {
      setBusyKey(`respond-${inviteId}`)
      setActionError(null)
      try {
        const nextMatch = await respondInvite(inviteId, action)
        if (action === 'accept' && nextMatch) {
          dismissStartedMatch()
          navigate(matchPath(nextMatch.id), { replace: true })
        }
      } catch (err) {
        setActionError(errorMessage(err, action === 'accept' ? '接受邀请失败' : '拒绝邀请失败'))
      } finally {
        setBusyKey(null)
      }
    },
    [respondInvite, dismissStartedMatch, navigate]
  )

  const refreshLobby = useCallback(() => {
    void loadFriends(true)
    void refreshInvites()
  }, [loadFriends, refreshInvites])

  const renderError = (message: string, onRetry: () => void) => (
    <div className="gh-game-list-state gh-game-list-state--error" role="alert">
      <p className="gh-game-list-state-title">加载失败</p>
      <p className="gh-game-list-state-hint">{message}</p>
      <div className="gh-game-list-state-actions">
        <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={onRetry}>
          重试
        </button>
        <Link className="gh-btn gh-btn--ghost gh-btn--md" to="/games">
          返回游戏大厅
        </Link>
      </div>
    </div>
  )

  const errorBanner = (message: string | null) =>
    message ? (
      <div className="gh-alert gh-alert--danger gh-game-alert" role="alert">
        {message}
      </div>
    ) : null

  if (matchId) {
    if (!match && matchLoading) {
      return (
        <div className="gh-page-container gh-games-page gh-game-online-page">
          <div className="gh-game-list-state" role="status">
            <div className="gh-spinner" />
            <span>正在加载对局…</span>
          </div>
        </div>
      )
    }

    if (!match) {
      return (
        <div className="gh-page-container gh-games-page gh-game-online-page">
          {renderError(matchError ?? '对局不存在或已结束，返回大厅重新邀请好友吧。', () => {
            if (matchId) void loadMatch(matchId, true)
          })}
          <p className="gh-game-inline-link">
            <Link to={LOBBY_PATH}>返回联机大厅</Link>
          </p>
        </div>
      )
    }

    if (match.status === 'waiting') {
      return (
        <div className="gh-page-container gh-games-page gh-game-online-page">
          <GameRoomPanel
            match={match}
            meId={meId}
            friends={friends}
            incomingInvites={incomingInvites}
            outgoingInvites={outgoingInvites}
            friendsLoading={friendsLoading}
            friendsError={friendsError}
            highlightFriendId={highlightFriendId}
            busyKey={busyKey}
            error={actionError ?? matchError}
            onInvite={handleInvite}
            onCancelInvite={handleCancelInvite}
            onRespondInvite={handleRespondInvite}
            onStart={handleStart}
            onLeave={handleLeaveRoom}
            onRefresh={refreshLobby}
          />
        </div>
      )
    }

    return (
      <div className="gh-page-container gh-games-page gh-game-online-page">
        {errorBanner(actionError ?? matchError)}
        <GameMatchPanel
          match={match}
          meId={meId}
          transport={transport}
          remainingMs={remainingMs}
          moving={movesPending}
          onMove={sendMove}
          onResign={() => void handleResign()}
          onBackToLobby={handleBackToLobby}
          onRematch={handleRematch}
        />
        {busyKey === 'resign' && <p className="gh-game-inline-link">正在提交认输…</p>}
      </div>
    )
  }

  return (
    <div className="gh-page-container gh-games-page gh-game-online-page">
      <header className="gh-games-header">
        <div className="gh-games-header-copy">
          <p className="gh-g2048-eyebrow">
            <Link to="/games">← 游戏大厅</Link>
          </p>
          <h1 className="gh-games-title">2048 好友对战</h1>
          <p className="gh-games-subtitle">
            邀请最多 9 位好友（共 10 人）进入房间，房主开始后同步竞速：10 分钟内率先合成 2048 或分数最高者获胜。
          </p>
        </div>
        <div className="gh-game-lobby-actions">
          <Link className="gh-btn gh-btn--secondary gh-btn--md" to={GAME_2048_ROUTE}>
            单机练习
          </Link>
          <button
            type="button"
            className="gh-btn gh-btn--secondary gh-btn--md"
            onClick={refreshLobby}
            disabled={friendsLoading}
          >
            刷新列表
          </button>
        </div>
      </header>

      <div className="gh-game-conn-bar">
        <span className={`gh-game-conn-chip gh-game-conn-chip--${transport}`}>
          {transport === 'ws' ? '实时连接' : '轮询模式'}
        </span>
        <span className="gh-game-conn-desc">
          {transport === 'ws'
            ? '邀请与对局状态通过 WebSocket 实时推送。'
            : '当前使用轮询同步，邀请与对局状态约有 2–5 秒延迟，仍可正常对战。'}
        </span>
      </div>

      {errorBanner(actionError ?? invitesError)}
      {highlightFriendId !== null && (
        <p className="gh-game-highlight-hint">
          已从聊天页跳转：向高亮好友发送邀请即可开始对战。
        </p>
      )}

      {friendsError ? (
        renderError(friendsError, refreshLobby)
      ) : (
        <GameFriendPicker
          friends={friends}
          incomingInvites={incomingInvites}
          outgoingInvites={outgoingInvites}
          loading={friendsLoading || matchLoading}
          highlightFriendId={highlightFriendId}
          busyKey={busyKey}
          onInvite={handleInvite}
          onCancelInvite={handleCancelInvite}
          onRespondInvite={handleRespondInvite}
          onRefresh={refreshLobby}
        />
      )}

      <p className="gh-games-footnote">
        对局为服务端权威判定：客户端只发送方向，服务端返回最新棋盘与版本号。
      </p>
    </div>
  )
}
