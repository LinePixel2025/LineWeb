import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import UserAvatar from '../../components/UserAvatar'
import GameFriendPicker from '../../components/games/GameFriendPicker'
import DoudizhuTable, { type DoudizhuSeatInfo } from '../../components/games/doudizhu/DoudizhuTable'
import { useAuth } from '../../contexts/AuthContext'
import { useChat } from '../../contexts/ChatContext'
import { useGame } from '../../contexts/GameContext'
import api from '../../lib/api'
import { GAME_POLL_INTERVALS } from '../../lib/realtime'
import {
  canDoudizhuBeat,
  doudizhuComboLabel,
  generateDoudizhuMoves,
  parseDoudizhuCombo,
  sortDoudizhuCards,
  type DoudizhuCard,
} from '../../lib/games/doudizhu'
import { GAME_DOUDIZHU_ROUTE } from '../../lib/games/catalog'
import type {
  DoudizhuActionBody,
  DoudizhuTrickMoveDto,
  DoudizhuActiveMatchResponse,
  DoudizhuMatchResponse,
  DoudizhuSyncResponse,
  GameDoudizhuEndReason,
  GameDoudizhuMatch,
  GameFriend,
  GameFriendsResponse,
} from '../../types/game'

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

const LOBBY_PATH = '/games/doudizhu/online'
const REQUIRED_PLAYERS = 3

function matchPath(matchId: number): string {
  return `${LOBBY_PATH}/${matchId}`
}

const END_REASON_LABELS: Record<GameDoudizhuEndReason, string> = {
  hand_empty: '有玩家出完了手牌',
  resign: '有人认输',
  no_bid: '连续三轮无人叫地主，房间已解散',
  cancelled: '房间已解散',
  abandoned: '全员离线过久，对局已废弃',
}

/**
 * 斗地主好友联机（3 人房间）：
 * - 无 matchId：先查进行中的对局（有则跳转），否则展示大厅（好友列表 + 邀请）。
 * - 有 matchId：等待房间 / 叫分 / 出牌 / 结算；WS 推送 game:match:*，
 *   轮询模式下每 2s 拉 sync（对局 DTO 按观看者裁剪，只能看到自己的手牌）。
 */
export default function DoudizhuOnlinePage() {
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

  const [match, setMatch] = useState<GameDoudizhuMatch | null>(null)
  const [matchLoading, setMatchLoading] = useState(matchId !== null)
  const [matchError, setMatchError] = useState<string | null>(null)
  const [friends, setFriends] = useState<GameFriend[]>([])
  const [friendsLoading, setFriendsLoading] = useState(matchId === null)
  const [friendsError, setFriendsError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [hintIndex, setHintIndex] = useState(0)
  const [remainingMs, setRemainingMs] = useState(0)

  const matchRef = useRef<GameDoudizhuMatch | null>(null)
  const matchIdRef = useRef<number | null>(matchId)
  const skipActiveCheckRef = useRef(false)

  useEffect(() => {
    matchRef.current = match
  }, [match])

  useEffect(() => {
    matchIdRef.current = matchId
  }, [matchId])

  // 只在自己的手牌或行进阶段变化时清选牌：对手出牌 / 在线状态刷新不打断我正在选牌
  const myHandKey = match?.myHand.map((card) => card.id).join(',') ?? ''
  const phaseKey = `${match?.id ?? 0}:${match?.status ?? ''}:${match?.bidding?.turnUserId ?? ''}:${match?.playing?.turnUserId ?? ''}`
  useEffect(() => {
    setSelectedIds(new Set())
  }, [myHandKey, phaseKey])

  const applyMatch = useCallback((next: GameDoudizhuMatch) => {
    setMatchError(null)
    setMatch((prev) => {
      if (!prev) return next
      if (next.id !== prev.id) return next
      if (next.version <= prev.version) return prev
      return next
    })
  }, [])

  const loadMatch = useCallback(
    async (id: number, force = false) => {
      try {
        const data = await api.get<DoudizhuMatchResponse>(`/games/doudizhu/matches/${id}`)
        if (matchIdRef.current !== id) return
        if (force) {
          setMatch(data.match)
          setSelectedIds(new Set())
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
      const data = await api.get<GameFriendsResponse>('/games/doudizhu/friends')
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
      .get<DoudizhuActiveMatchResponse>('/games/doudizhu/matches/active')
      .then((data) => {
        if (cancelled) return
        if (data.match && (data.match.status === 'bidding' || data.match.status === 'playing')) {
          navigate(matchPath(data.match.id), { replace: true })
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

  // 大厅/等待房间：好友在线状态定期刷新
  useEffect(() => {
    if (matchId && match?.status !== 'waiting') return
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

  useEffect(() => {
    if (!matchId || match?.status !== 'waiting') return
    void loadFriends(true)
  }, [matchId, match?.status, loadFriends])

  // WS 模式：订阅对局事件（斗地主与 2048 共用事件名，按 game 过滤）
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
      if (event.match.game !== 'doudizhu') return
      if (event.match.id !== matchId) return
      applyMatch(event.match)
      if (event.type === 'game:match:ended' && (event.match.reason === 'cancelled' || event.match.reason === 'no_bid')) {
        skipActiveCheckRef.current = true
        navigate(LOBBY_PATH, { replace: true })
      }
    })
    return unsubscribe
  }, [matchId, transport, subscribe, applyMatch, navigate])

  useEffect(() => {
    if (!matchId) return
    void loadMatch(matchId, false)
  }, [matchId, transport, loadMatch])

  // 轮询模式：每 2 秒拉一次 sync
  useEffect(() => {
    if (!matchId || transport !== 'polling') return
    let disposed = false

    const poll = async () => {
      if (disposed) return
      if (matchRef.current?.status === 'finished') return
      try {
        const data = await api.get<DoudizhuSyncResponse>(`/games/doudizhu/sync?matchId=${matchId}`)
        if (disposed || !data.match) return
        applyMatch(data.match)
        if (data.match.reason === 'cancelled' || data.match.reason === 'no_bid') {
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

  // 回合倒计时（以服务端 deadline 为准）
  const deadline = match?.bidding?.deadline ?? match?.playing?.deadline ?? null
  const matchStatus = match?.status
  const currentMatchId = match?.id
  useEffect(() => {
    if (matchStatus === 'finished' || !deadline) {
      setRemainingMs(0)
      return
    }
    const deadlineMs = Date.parse(deadline)
    if (Number.isNaN(deadlineMs)) {
      setRemainingMs(0)
      return
    }
    const tick = () => setRemainingMs(Math.max(0, deadlineMs - Date.now()))
    tick()
    const timer = setInterval(tick, 1_000)
    return () => clearInterval(timer)
  }, [currentMatchId, matchStatus, deadline])

  // === 动作 ===

  const sendAction = useCallback(async (body: DoudizhuActionBody): Promise<GameDoudizhuMatch | null> => {
    const id = matchIdRef.current
    if (!id) return null
    try {
      const data = await api.post<DoudizhuMatchResponse>(`/games/doudizhu/matches/${id}/actions`, body)
      setMatch(data.match)
      setSelectedIds(new Set())
      setActionError(null)
      return data.match
    } catch (err) {
      setActionError(errorMessage(err, '操作失败'))
      // 以服务端为准补拉一次
      if (matchIdRef.current) void loadMatch(matchIdRef.current, true)
      return null
    }
  }, [loadMatch])

  const myTurn =
    match !== null
    && ((match.bidding?.turnUserId ?? match.playing?.turnUserId) === meId)
    && match.status !== 'finished'

  const myHand: DoudizhuCard[] = useMemo(
    () => sortDoudizhuCards(match?.myHand ?? []),
    [match?.myHand]
  )

  const toggleCard = useCallback((card: DoudizhuCard) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(card.id)) next.delete(card.id)
      else next.add(card.id)
      return next
    })
    setActionError(null)
  }, [])

  const selectedCards = useMemo(
    () => myHand.filter((card) => selectedIds.has(card.id)),
    [myHand, selectedIds]
  )

  const lastCombo = match?.playing?.lastMove?.combo ?? null
  const leading = match?.playing?.lastMove == null
  const selectedCombo = selectedCards.length > 0 ? parseDoudizhuCombo(selectedCards) : null
  const canPlaySelected =
    match?.status === 'playing'
    && myTurn
    && selectedCombo !== null
    && canDoudizhuBeat(selectedCombo, leading ? null : lastCombo)

  const handlePlay = useCallback(() => {
    if (selectedCombo === null) {
      setActionError('所选牌不是合法牌型')
      return
    }
    if (!leading && !canDoudizhuBeat(selectedCombo, lastCombo)) {
      setActionError('压不住上一手牌')
      return
    }
    void sendAction({ type: 'play', cards: selectedCards.map((card) => card.id) })
    setHintIndex(0)
  }, [selectedCombo, leading, lastCombo, sendAction, selectedCards])

  const handlePass = useCallback(() => {
    if (leading) {
      setActionError('新一轮出牌必须出牌')
      return
    }
    void sendAction({ type: 'pass' })
    setHintIndex(0)
  }, [leading, sendAction])

  const hints = useMemo(() => {
    if (match?.status !== 'playing' || !myTurn) return []
    return generateDoudizhuMoves(myHand, leading ? null : lastCombo)
  }, [match?.status, myTurn, myHand, leading, lastCombo])

  const handleHint = useCallback(() => {
    if (hints.length === 0) return
    const move = hints[hintIndex % hints.length]
    setHintIndex((prev) => prev + 1)
    setSelectedIds(new Set(move.cards.map((card) => card.id)))
    setActionError(null)
  }, [hints, hintIndex])

  const handleBid = useCallback((bid: number) => {
    void sendAction({ type: 'bid', bid })
  }, [sendAction])

  const handleResign = useCallback(async () => {
    const id = matchIdRef.current
    const current = matchRef.current
    if (!id || !current || current.status === 'finished') return
    if (!window.confirm('确定认输吗？本方阵营将按当前倍率判负。')) return
    setBusyKey('resign')
    try {
      const data = await api.post<DoudizhuMatchResponse>(`/games/doudizhu/matches/${id}/resign`)
      setMatch(data.match)
      setActionError(null)
    } catch (err) {
      setActionError(errorMessage(err, '认输失败'))
    } finally {
      setBusyKey(null)
    }
  }, [])

  const handleStart = useCallback(async () => {
    const id = matchIdRef.current
    if (!id) return
    setBusyKey('start')
    setActionError(null)
    try {
      const data = await api.post<DoudizhuMatchResponse>(`/games/doudizhu/matches/${id}/start`)
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
      await api.post(`/games/doudizhu/matches/${id}/leave`)
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
        const result = await createInvite(friendId, 'doudizhu')
        if (result.match && result.match.id !== matchIdRef.current) {
          navigate(matchPath(result.match.id))
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
        await cancelInvite(inviteId, 'doudizhu')
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
        const nextMatch = await respondInvite(inviteId, action, 'doudizhu')
        if (action === 'accept' && nextMatch) {
          dismissStartedMatch()
          navigate(gameOnlinePath(nextMatch.id, nextMatch.game), { replace: true })
        }
      } catch (err) {
        setActionError(errorMessage(err, action === 'accept' ? '接受邀请失败' : '拒绝邀请失败'))
      } finally {
        setBusyKey(null)
      }
    },
    [respondInvite, dismissStartedMatch, navigate]
  )

  /** 双游戏共用邀请列表：本页只处理斗地主的邀请 */
  const pageIncomingInvites = incomingInvites.filter((invite) => invite.game === 'doudizhu')
  const pageOutgoingInvites = outgoingInvites.filter((invite) => invite.game === 'doudizhu')

  const refreshLobby = useCallback(() => {
    void loadFriends(true)
    void refreshInvites()
  }, [loadFriends, refreshInvites])

  const handleBackToLobby = useCallback(() => {
    const current = matchRef.current
    if (current && current.status !== 'finished') {
      const leave = window.confirm('对局仍在进行中，确定返回大厅吗？超时未操作会被自动托管。')
      if (!leave) return
    }
    skipActiveCheckRef.current = true
    setMatch(null)
    setMatchError(null)
    setActionError(null)
    navigate(LOBBY_PATH, { replace: true })
  }, [navigate])

  // === 渲染 ===

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

    const isHost = match.hostId === meId
    const playerCount = match.players.length

    // 每个座位最近一次动作
    const latestByUserId = new Map<number, DoudizhuTrickMoveDto>()
    for (const move of match.playing?.recentMoves ?? []) {
      latestByUserId.set(move.userId, move)
    }

    const myPlayer = match.players.find((player) => player.userId === meId) ?? null
    const myRole = myPlayer?.role ?? null
    const iWon =
      match.winnerSide !== null && myRole !== null && (myRole === 'landlord') === (match.winnerSide === 'landlord')
    const remainingSeconds = Math.ceil(remainingMs / 1000)

    // === 等待房间 ===
    if (match.status === 'waiting') {
      return (
        <div className="gh-page-container gh-games-page gh-game-online-page">
          <section className="gh-game-room" aria-label="斗地主等待房间">
            <header className="gh-game-room-header">
              <div>
                <p className="gh-g2048-eyebrow">斗地主好友房间</p>
                <h1 className="gh-games-title">等待玩家加入</h1>
                <p className="gh-games-subtitle">
                  斗地主需要恰好 3 名玩家：房主开始后自动发牌进入叫分。
                </p>
              </div>
              <span className="gh-game-room-count">
                {playerCount}/{REQUIRED_PLAYERS}
              </span>
            </header>

            {errorBanner(actionError ?? matchError)}

            <div className="gh-game-room-actions">
              {isHost ? (
                <button
                  type="button"
                  className="gh-btn gh-btn--primary gh-btn--lg"
                  onClick={() => void handleStart()}
                  disabled={playerCount !== REQUIRED_PLAYERS || busyKey === 'start'}
                >
                  {busyKey === 'start' ? '正在开始…' : `开始游戏（${playerCount}/${REQUIRED_PLAYERS}）`}
                </button>
              ) : (
                <span className="gh-game-room-waiting">等待房主开始游戏…</span>
              )}
              <button
                type="button"
                className="gh-btn gh-btn--danger gh-btn--md"
                onClick={() => void handleLeaveRoom()}
                disabled={busyKey === 'leave'}
              >
                {busyKey === 'leave' ? '正在离开…' : isHost ? '解散房间' : '离开房间'}
              </button>
            </div>

            {isHost && playerCount < REQUIRED_PLAYERS && (
              <p className="gh-game-room-hint">
                还差 {REQUIRED_PLAYERS - playerCount} 人，邀请好友加入后即可开始。
              </p>
            )}

            <section className="gh-game-room-players" aria-label="房间玩家">
              <h2 className="gh-game-room-section-title">玩家（{playerCount}/{REQUIRED_PLAYERS}）</h2>
              <ul className="gh-game-room-player-list">
                {match.players.map((player) => {
                  const isMe = player.userId === meId
                  const isRoomHost = player.userId === match.hostId
                  return (
                    <li key={player.userId} className={`gh-game-room-player${isMe ? ' gh-game-room-player--me' : ''}`}>
                      <UserAvatar userId={player.userId} username={player.username} size="md" />
                      <span className="gh-game-room-player-copy">
                        <span className="gh-game-room-player-name">
                          {player.username}
                          {isRoomHost && <span className="gh-game-room-badge">房主</span>}
                          {isMe && <span className="gh-game-room-badge gh-game-room-badge--me">你</span>}
                        </span>
                        <span className="gh-game-room-player-meta">
                          <span className={`gh-game-presence-dot${player.online ? ' gh-game-presence-dot--online' : ''}`} />
                          {player.online ? '在线' : '离线'} · 等待开始
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section className="gh-game-room-invite" aria-label="邀请好友">
              <h2 className="gh-game-room-section-title">邀请好友</h2>
              {playerCount >= REQUIRED_PLAYERS ? (
                <p className="gh-game-room-hint">房间已满（3 人），不能再邀请。</p>
              ) : (
                <GameFriendPicker
                  friends={friends}
                  incomingInvites={pageIncomingInvites}
                  outgoingInvites={pageOutgoingInvites}
                  loading={friendsLoading}
                  error={friendsError}
                  highlightFriendId={highlightFriendId}
                  excludeIds={match.players.map((player) => player.userId)}
                  busyKey={busyKey}
                  onInvite={handleInvite}
                  onCancelInvite={handleCancelInvite}
                  onRespondInvite={handleRespondInvite}
                  onRefresh={refreshLobby}
                />
              )}
            </section>
          </section>
        </div>
      )
    }

    // === 叫分 / 出牌 / 结算共用牌桌（经典布局，全屏沉浸） ===
    const turnUserId = match.bidding?.turnUserId ?? match.playing?.turnUserId ?? null

    const seatInfoOf = (userId: number): DoudizhuSeatInfo => {
      const player = match.players.find((item) => item.userId === userId)
      if (!player) {
        return { name: '—', role: null, cardCount: 0, isTurn: false, bid: null, lastAction: null }
      }
      const action = latestByUserId.get(userId)
      const bidEntry = [...(match.bidding?.bids ?? [])].reverse().find((b) => b.userId === userId)
      return {
        name: player.username,
        role: player.role,
        cardCount: player.cardCount,
        online: player.online,
        isTurn: turnUserId === userId && match.status !== 'finished',
        bid: bidEntry ? bidEntry.bid : null,
        lastAction: action
          ? action.action === 'pass'
            ? 'pass'
            : { cards: action.cards }
          : null,
      }
    }

    const leftSeat = seatInfoOf(match.players[(match.seat + 2) % 3].userId)
    const rightSeat = seatInfoOf(match.players[(match.seat + 1) % 3].userId)
    const meSeat = seatInfoOf(meId)

    const centerHint = (() => {
      if (match.status === 'bidding') {
        return match.bidding?.turnUserId === meId
          ? '轮到你叫分：牌越强叫得越高（底分 100 × 倍率结算）'
          : `等待 ${match.players.find((p) => p.userId === match.bidding?.turnUserId)?.username ?? ''} 叫分…`
      }
      if (match.status === 'playing' && match.playing) {
        if (match.playing.turnUserId === meId) {
          return match.playing.lastMove?.combo
            ? `轮到你 —— 压住 ${doudizhuComboLabel(match.playing.lastMove.combo)}`
            : '轮到你出牌（新一轮）'
        }
        return `等待 ${match.players.find((p) => p.userId === match.playing?.turnUserId)?.username ?? ''} 出牌…`
      }
      if (match.status === 'finished') {
        const side = match.winnerSide === 'landlord' ? '地主阵营获胜' : match.winnerSide === 'farmers' ? '农民阵营获胜' : '本局未分胜负'
        return `${side}${match.multiplier > 1 ? ` · 倍率 ×${match.multiplier}` : ''}`
      }
      return ''
    })()

    const actions = (() => {
      if (match.status === 'bidding' && myTurn) {
        return (
          <>
            <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={() => handleBid(0)}>
              不叫
            </button>
            {[1, 2, 3].map((bid) => (
              <button
                key={bid}
                type="button"
                className="gh-btn gh-btn--primary gh-btn--md"
                disabled={bid <= (match.bidding?.highestBid ?? 0)}
                onClick={() => handleBid(bid)}
              >
                {bid} 分
              </button>
            ))}
          </>
        )
      }
      if (match.status === 'playing' && myTurn) {
        return (
          <>
            <button
              type="button"
              className="gh-btn gh-btn--secondary gh-btn--md"
              disabled={hints.length === 0}
              onClick={handleHint}
            >
              提示
            </button>
            <button
              type="button"
              className="gh-btn gh-btn--secondary gh-btn--md"
              disabled={leading}
              onClick={handlePass}
            >
              不出
            </button>
            <button
              type="button"
              className="gh-btn gh-btn--primary gh-btn--md gh-ddz-play-btn"
              disabled={!canPlaySelected}
              onClick={handlePlay}
            >
              出牌
            </button>
          </>
        )
      }
      return null
    })()

    const overlay = match.status === 'finished' ? (
      <div className="gh-ddz-overlay" role="dialog" aria-modal="true" aria-label="对局结果">
        <div className="gh-ddz-overlay-card">
          <h2 className={`gh-ddz-overlay-title${iWon ? ' gh-ddz-overlay-title--win' : ' gh-ddz-overlay-title--lose'}`}>
            {match.winnerSide === null ? '本局结束' : iWon ? '恭喜获胜！' : '本局告负'}
          </h2>
          <p className="gh-ddz-overlay-detail">{END_REASON_LABELS[match.reason ?? 'cancelled']}</p>
          <div className="gh-ddz-scores">
            {match.players.map((player) => (
              <span key={player.userId} className="gh-ddz-score">
                <span className="gh-ddz-score-name">
                  {player.username}
                  {player.role === 'landlord' ? '（地主）' : ''}
                </span>
                <span className={`gh-ddz-score-value${(player.scoreDelta ?? 0) >= 0 ? ' gh-ddz-score-value--up' : ' gh-ddz-score-value--down'}`}>
                  {player.scoreDelta === null ? '—' : `${player.scoreDelta >= 0 ? '+' : ''}${player.scoreDelta}`}
                </span>
              </span>
            ))}
          </div>
          <div className="gh-ddz-overlay-actions">
            <button type="button" className="gh-btn gh-btn--primary gh-btn--lg" onClick={handleBackToLobby}>
              返回大厅
            </button>
            <Link className="gh-btn gh-btn--secondary gh-btn--lg" to={GAME_DOUDIZHU_ROUTE}>
              单机练习
            </Link>
          </div>
        </div>
      </div>
    ) : null

    return (
      <div className="gh-ddz-game">
        <header className="gh-ddz-gamebar">
          <button type="button" className="gh-ddz-gamebar-back" onClick={handleBackToLobby}>
            ← 斗地主大厅
          </button>
          <span className="gh-ddz-gamebar-title">
            斗地主 · 好友联机
            <span className={`gh-game-conn-chip gh-game-conn-chip--${transport}`}>
              {transport === 'ws' ? '实时' : '轮询'}
            </span>
          </span>
          <div className="gh-ddz-gamebar-actions">
            {match.status !== 'finished' && (
              <button
                type="button"
                className="gh-btn gh-btn--danger gh-btn--sm"
                onClick={() => void handleResign()}
                disabled={busyKey === 'resign'}
              >
                {busyKey === 'resign' ? '提交中…' : '认输'}
              </button>
            )}
            <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={handleBackToLobby}>
              返回大厅
            </button>
          </div>
        </header>

        {(actionError ?? matchError) && (
          <div className="gh-ddz-notice gh-ddz-notice--error" role="alert">{actionError ?? matchError}</div>
        )}

        <DoudizhuTable
          phase={match.status === 'bidding' ? 'bidding' : match.status === 'playing' ? 'playing' : 'finished'}
          leftSeat={leftSeat}
          rightSeat={rightSeat}
          me={{
            name: myPlayer?.username ?? '我',
            role: myRole,
            bid: meSeat.bid,
            isTurn: myTurn,
            hand: myHand,
            lastAction: meSeat.lastAction,
          }}
          bottomCards={match.bottomCards}
          multiplier={match.multiplier}
          centerHint={centerHint}
          remainingSeconds={match.status === 'finished' ? null : remainingSeconds}
          selectedIds={selectedIds}
          onToggleCard={match.status === 'playing' && myTurn ? toggleCard : undefined}
          handDisabled={!(match.status === 'playing' && myTurn)}
          actions={actions}
          overlay={overlay}
        />
      </div>
    )
  }

  // === 大厅 ===
  return (
    <div className="gh-page-container gh-games-page gh-game-online-page">
      <header className="gh-games-header">
        <div className="gh-games-header-copy">
          <p className="gh-g2048-eyebrow">
            <Link to="/games">← 游戏大厅</Link>
          </p>
          <h1 className="gh-games-title">斗地主好友联机</h1>
          <p className="gh-games-subtitle">
            邀请好友凑齐 3 人房间：房主开局后自动发牌、叫分定地主、轮流出牌，先出完者所在阵营获胜。
          </p>
        </div>
        <div className="gh-game-lobby-actions">
          <Link className="gh-btn gh-btn--secondary gh-btn--md" to={GAME_DOUDIZHU_ROUTE}>
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
          incomingInvites={pageIncomingInvites}
          outgoingInvites={pageOutgoingInvites}
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
        对局为服务端权威判定：客户端只发送叫分与出牌，手牌结算全部在服务端完成。
      </p>
    </div>
  )
}

/** 按游戏跳转到对应联机页（接受邀请时可能是 2048 邀请，路由不同） */
function gameOnlinePath(matchId: number, game: string): string {
  return game === 'doudizhu' ? `/games/doudizhu/online/${matchId}` : `/games/2048/online/${matchId}`
}
