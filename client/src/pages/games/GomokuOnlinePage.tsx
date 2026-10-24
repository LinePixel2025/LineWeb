import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import UserAvatar from '../../components/UserAvatar'
import GameFriendPicker from '../../components/games/GameFriendPicker'
import { useAuth } from '../../contexts/AuthContext'
import { useChat } from '../../contexts/ChatContext'
import { useGame } from '../../contexts/GameContext'
import api from '../../lib/api'
import { GAME_POLL_INTERVALS } from '../../lib/realtime'
import { GAME_GOMOKU_ONLINE_ROUTE, GAME_GOMOKU_ROUTE } from '../../lib/games/catalog'
import { GOMOKU_BLACK, GOMOKU_BOARD_SIZE } from '../../lib/games/gomoku'
import type {
  GameFriend,
  GameFriendsResponse,
  GameInvite,
  GameInvitesResponse,
  GameGomokuEndReason,
  GameGomokuMatch,
  GameGomokuPlayer,
  GomokuActionBody,
  GomokuActiveMatchResponse,
  GomokuMatchResponse,
  GomokuSyncResponse,
} from '../../types/game'

/** 服务端前缀：与其他轮流制游戏完全同构 */
const API_BASE = '/games/gomoku'
const LOBBY_PATH = GAME_GOMOKU_ONLINE_ROUTE
/** 五子棋是双人对局 */
const MIN_PLAYERS = 2
const MAX_PLAYERS = 2
/** 提交一手后本地锁盘的兜底解锁时间（毫秒），防止漏事件导致永久卡住 */
const ACTION_LOCK_FALLBACK_MS = 10_000

/** 邀请端点响应（match 为五子棋 DTO，通用类型按 2048 声明，这里本地收窄） */
interface GomokuInviteResponse {
  invite: GameInvite
  match?: GameGomokuMatch
}
interface GomokuInviteRespondResponse {
  ok: boolean
  match?: GameGomokuMatch
}

const END_REASON_LABELS: Record<GameGomokuEndReason, string> = {
  five: '连成五子，本局分出胜负',
  resign: '有玩家认输，本局提前结束',
  forfeit: '有玩家掉线超过 120 秒，被判负',
  timeout: '全局 30 分钟超时，未分胜负按平局结算',
  draw: '棋盘已下满且无人连五，平局',
  cancelled: '房间已解散',
}

const STATUS_LABELS: Record<GameGomokuPlayer['status'], string> = {
  waiting: '等待中',
  playing: '对局中',
  won: '获胜',
  lost: '失败',
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

function matchPath(matchId: number): string {
  return `${LOBBY_PATH}/${matchId}`
}

/** 邀请按 id 去重（本页列表 + 全局 Context 列表可能同时包含同一条邀请） */
function dedupeInvites(list: GameInvite[]): GameInvite[] {
  const seen = new Set<number>()
  const result: GameInvite[] = []
  for (const invite of list) {
    if (seen.has(invite.id)) continue
    seen.add(invite.id)
    result.push(invite)
  }
  return result
}

function playerOf(match: GameGomokuMatch, userId: number): GameGomokuPlayer | null {
  return match.players.find((player) => player.userId === userId) ?? null
}

function nameOf(match: GameGomokuMatch, userId: number): string {
  return match.players.find((player) => player.userId === userId)?.username ?? '某位玩家'
}

/** 颜色值 → 中文名 */
function colorName(color: 1 | 2 | null): string {
  if (color === GOMOKU_BLACK) return '黑'
  if (color === 2) return '白'
  return '未定'
}

/** 星位坐标（0 起下标）：天元 + 四星 */
const GOMOKU_STARS: ReadonlyArray<readonly [number, number]> = [
  [3, 3],
  [11, 3],
  [3, 11],
  [11, 11],
  [7, 7],
]

/**
 * 五子棋好友联机（恰好 2 人轮流落子）：
 * - 无 matchId：先查进行中的对局（有则跳转），否则展示大厅（好友列表 + 邀请）。
 * - 有 matchId：等待房间 / 轮流对局 / 结算遮罩。
 * - 棋盘由服务端权威持有并全量下发（无隐藏信息）；连五 / 满盘 / 超时 / 掉线全部由服务端判定。
 * - WS 事件复用 /ws/chat 的 game:match:*（按 match.game === 'gomoku' 判别）；
 *   无 WebSocket 时按 GAME_POLL_INTERVALS 轮询 sync + presence 心跳降级。
 */
export default function GomokuOnlinePage() {
  const { matchId: matchIdParam } = useParams<{ matchId?: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const meId = user?.id ?? 0
  const { transport, subscribe } = useChat()
  const {
    incomingInvites,
    outgoingInvites,
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
  const loggedIn = user !== null

  const [match, setMatch] = useState<GameGomokuMatch | null>(null)
  const [matchLoading, setMatchLoading] = useState(matchId !== null)
  const [matchError, setMatchError] = useState<string | null>(null)
  const [friends, setFriends] = useState<GameFriend[]>([])
  const [friendsLoading, setFriendsLoading] = useState(matchId === null)
  const [friendsError, setFriendsError] = useState<string | null>(null)
  const [localIncoming, setLocalIncoming] = useState<GameInvite[]>([])
  const [localOutgoing, setLocalOutgoing] = useState<GameInvite[]>([])
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  /** 「一手一锁」：本手提交时的对局版本，版本变化才解锁 */
  const [lockVersion, setLockVersion] = useState<number | null>(null)
  const [actionPending, setActionPending] = useState(false)
  const [nowTick, setNowTick] = useState(0)

  const matchRef = useRef<GameGomokuMatch | null>(null)
  const matchIdRef = useRef<number | null>(matchId)
  const skipActiveCheckRef = useRef(false)
  const inFlightRef = useRef(false)
  /** 服务端与本地时钟的偏移（轮询 sync 的 serverTime 校准） */
  const clockOffsetRef = useRef(0)

  useEffect(() => {
    matchRef.current = match
  }, [match])

  useEffect(() => {
    matchIdRef.current = matchId
  }, [matchId])

  const applyMatch = useCallback((next: GameGomokuMatch) => {
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
        const data = await api.get<GomokuMatchResponse>(`${API_BASE}/matches/${id}`)
        if (matchIdRef.current !== id) return
        if (force) setMatch(data.match)
        else applyMatch(data.match)
        setMatchError(null)
      } catch (err) {
        if (matchIdRef.current === id) setMatchError(errorMessage(err, '加载对局失败'))
      } finally {
        setMatchLoading(false)
      }
    },
    [applyMatch]
  )

  const loadFriends = useCallback(async (showLoading = true) => {
    if (showLoading) setFriendsLoading(true)
    try {
      const data = await api.get<GameFriendsResponse>(`${API_BASE}/friends`)
      setFriends(data.friends ?? [])
      setFriendsError(null)
    } catch (err) {
      setFriendsError(errorMessage(err, '加载好友列表失败'))
    } finally {
      setFriendsLoading(false)
      setMatchLoading(false)
    }
  }, [])

  /** 本页自己的五子棋邀请列表（比全局 Context 更即时，也与其它游戏隔离） */
  const loadInvites = useCallback(async () => {
    try {
      const data = await api.get<GameInvitesResponse>(`${API_BASE}/invites`)
      setLocalIncoming(data.incoming ?? [])
      setLocalOutgoing(data.outgoing ?? [])
    } catch {
      // 邀请列表失败不打断对局，下一次刷新再试
    }
  }, [])

  const refreshLobby = useCallback(() => {
    void loadFriends(true)
    void loadInvites()
    void refreshInvites()
  }, [loadFriends, loadInvites, refreshInvites])

  // 初始化：对局详情 / active 对局 / 大厅
  useEffect(() => {
    if (!loggedIn) return undefined
    let cancelled = false
    setActionError(null)
    setMatchError(null)

    if (matchId) {
      skipActiveCheckRef.current = false
      setMatch(null)
      setLockVersion(null)
      setMatchLoading(true)
      void loadMatch(matchId, true)
      void loadInvites()
      return () => {
        cancelled = true
      }
    }

    setMatch(null)
    if (skipActiveCheckRef.current) {
      // 主动返回大厅：不再自动跳回对局
      skipActiveCheckRef.current = false
      setMatchLoading(false)
      void loadFriends(true)
      void loadInvites()
      return () => {
        cancelled = true
      }
    }

    setMatchLoading(true)
    setFriendsLoading(true)
    api
      .get<GomokuActiveMatchResponse>(`${API_BASE}/matches/active`)
      .then((data) => {
        if (cancelled) return
        // 进行中或等待中的房间都自动回到对局页：刷新页面后不会滞留在大厅
        if (data.match && (data.match.status === 'playing' || data.match.status === 'waiting')) {
          navigate(matchPath(data.match.id), { replace: true })
          return
        }
        void loadFriends(true)
        void loadInvites()
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
  }, [loggedIn, matchId, loadMatch, loadFriends, loadInvites, navigate])

  // 已进入对局页：清掉全局「对局已开始」提示
  useEffect(() => {
    if (matchId && startedMatch?.id === matchId) dismissStartedMatch()
  }, [matchId, startedMatch, dismissStartedMatch])

  // 大厅 / 等待房间：好友在线状态定期刷新
  useEffect(() => {
    if (!user || (matchId && match?.status !== 'waiting')) return
    const quickRefresh = setTimeout(() => void loadFriends(false), 3_000)
    const timer = setInterval(() => void loadFriends(false), 15_000)
    return () => {
      clearTimeout(quickRefresh)
      clearInterval(timer)
    }
  }, [user, matchId, match?.status, loadFriends])

  useEffect(() => {
    if (!user || !matchId || match?.status !== 'waiting') return
    void loadFriends(true)
  }, [user, matchId, match?.status, loadFriends])

  // WS：对局事件（与其他游戏同名，按 game 判别）
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
      if (event.match.game !== 'gomoku') return
      if (event.match.id !== matchId) return
      applyMatch(event.match)
      // 房间解散后回到大厅，避免 active 查询又把用户送回已结束对局
      if (event.type === 'game:match:ended' && event.match.reason === 'cancelled') {
        skipActiveCheckRef.current = true
        navigate(LOBBY_PATH, { replace: true })
      }
    })
    return unsubscribe
  }, [matchId, transport, subscribe, applyMatch, navigate])

  // WS：邀请变化 → 立刻补拉本页邀请
  useEffect(() => {
    if (!user || transport !== 'ws') return
    const unsubscribe = subscribe((event) => {
      if (event.type === 'game:invite' || event.type === 'game:invite:removed') void loadInvites()
    })
    return unsubscribe
  }, [user, transport, subscribe, loadInvites])

  // 传输模式切换时补拉一次对局，避免 WS 建立/断开瞬间漏掉版本
  useEffect(() => {
    if (!user || !matchId) return
    void loadMatch(matchId, false)
  }, [user, matchId, transport, loadMatch])

  // 轮询模式：每 2 秒拉一次 sync（顺带用 serverTime 校准时钟）
  useEffect(() => {
    if (!user || !matchId || transport !== 'polling') return
    let disposed = false

    const poll = async () => {
      if (disposed) return
      if (matchRef.current?.status === 'finished') return
      try {
        const data = await api.get<GomokuSyncResponse>(`${API_BASE}/sync?matchId=${matchId}`)
        if (disposed) return
        const serverTime = Date.parse(data.serverTime)
        if (Number.isFinite(serverTime)) clockOffsetRef.current = serverTime - Date.now()
        if (!data.match) return
        applyMatch(data.match)
        // sync 载荷里带本游戏的邀请，轮询模式下顺带刷新
        if (data.invites) {
          setLocalIncoming(data.invites.incoming ?? [])
          setLocalOutgoing(data.invites.outgoing ?? [])
        }
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
  }, [user, matchId, transport, applyMatch, navigate])

  // 轮询模式：20 秒一次 presence 心跳，让服务端认定本端仍在线
  useEffect(() => {
    if (!user || !matchId || transport !== 'polling') return
    if (match?.status === 'finished') return
    let disposed = false
    const ping = async () => {
      try {
        await api.post(`${API_BASE}/presence`)
      } catch {
        // 心跳失败由下一轮重试
      }
    }
    void ping()
    const timer = setInterval(() => {
      if (!disposed) void ping()
    }, GAME_POLL_INTERVALS.presence)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [user, matchId, transport, match?.status])

  // 大厅轮询模式下也要能看到邀请（Context 的 sync 不含五子棋邀请）
  useEffect(() => {
    if (!user || matchId) return
    if (transport !== 'polling') return
    const timer = setInterval(() => void loadInvites(), GAME_POLL_INTERVALS.sync)
    return () => clearInterval(timer)
  }, [user, matchId, transport, loadInvites])

  // 时钟校准：进对局时单独拉一次 sync 估算与服务端的时差，回合倒计时按校准后的时间计算
  useEffect(() => {
    if (!user || !matchId || transport !== 'ws') return
    let cancelled = false
    api
      .get<GomokuSyncResponse>(`${API_BASE}/sync?matchId=${matchId}`)
      .then((data) => {
        if (cancelled) return
        const serverTime = Date.parse(data.serverTime)
        if (Number.isFinite(serverTime)) clockOffsetRef.current = serverTime - Date.now()
      })
      .catch(() => {
        // 校准失败就按本地时钟估算，倒计时略有偏差但不影响对局
      })
    return () => {
      cancelled = true
    }
  }, [user, matchId, transport])

  // === 回合倒计时与解锁 ===

  // 版本前进（服务端处理完本手或对方落子）即解锁棋盘；另有兜底超时
  useEffect(() => {
    if (lockVersion === null) return
    if (match && match.version !== lockVersion) {
      setLockVersion(null)
      return
    }
    if (!match || match.status === 'finished') {
      setLockVersion(null)
      return
    }
    const timer = setTimeout(() => setLockVersion(null), ACTION_LOCK_FALLBACK_MS)
    return () => clearTimeout(timer)
  }, [lockVersion, match])

  const turnDeadline = match?.status === 'playing' ? match?.turn?.deadline ?? null : null

  // 每半秒重算一次回合剩余时间（deadline 与校准后的服务端时间之差）
  useEffect(() => {
    if (!turnDeadline) return
    const timer = setInterval(() => setNowTick((value) => value + 1), 500)
    return () => clearInterval(timer)
  }, [turnDeadline])

  const turnRemainingMs = useMemo(() => {
    void nowTick
    if (!turnDeadline) return null
    const deadlineMs = Date.parse(turnDeadline)
    if (!Number.isFinite(deadlineMs)) return null
    return Math.max(0, deadlineMs - (Date.now() + clockOffsetRef.current))
  }, [turnDeadline, nowTick])

  // === 动作 ===

  const refreshMatch = useCallback(async () => {
    const id = matchIdRef.current
    if (!id) return
    try {
      const data = await api.get<GomokuMatchResponse>(`${API_BASE}/matches/${id}`)
      setMatch(data.match)
      setMatchError(null)
    } catch {
      // 保留当前棋盘，等待下一次同步
    }
  }, [])

  const submitAction = useCallback(
    async (body: GomokuActionBody) => {
      const id = matchIdRef.current
      const current = matchRef.current
      if (!id || !current || current.status !== 'playing') return
      if (inFlightRef.current) return
      if (current.turn?.userId !== meId) {
        setActionError('还没轮到你，等对方落子')
        return
      }
      const me = playerOf(current, meId)
      if (!me || me.status !== 'playing') {
        setActionError('对局未在进行中')
        return
      }

      inFlightRef.current = true
      setActionPending(true)
      try {
        const data = await api.post<GomokuMatchResponse>(
          `${API_BASE}/matches/${id}/actions`,
          body
        )
        setMatch(data.match)
        // 一次只许提交一手：锁定当前版本，等下一次版本变化再解锁
        setLockVersion(data.match.version)
        setActionError(null)
      } catch (err) {
        setActionError(errorMessage(err, '提交失败，已重新同步盘面'))
        setLockVersion(null)
        await refreshMatch()
      } finally {
        inFlightRef.current = false
        setActionPending(false)
      }
    },
    [meId, refreshMatch]
  )

  const handleStart = useCallback(async () => {
    const id = matchIdRef.current
    if (!id) return
    setBusyKey('start')
    setActionError(null)
    try {
      const data = await api.post<GomokuMatchResponse>(`${API_BASE}/matches/${id}/start`)
      setMatch(data.match)
      setLockVersion(null)
    } catch (err) {
      setActionError(errorMessage(err, '开始对局失败'))
    } finally {
      setBusyKey(null)
    }
  }, [])

  const handleResign = useCallback(async () => {
    const id = matchIdRef.current
    const current = matchRef.current
    if (!id || !current || current.status !== 'playing') return
    if (!window.confirm('确定认输吗？本局你会记为失败。')) return
    setBusyKey('resign')
    setActionError(null)
    try {
      const data = await api.post<GomokuMatchResponse>(`${API_BASE}/matches/${id}/resign`)
      setMatch(data.match)
    } catch (err) {
      setActionError(errorMessage(err, '认输失败'))
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
      await api.post(`${API_BASE}/matches/${id}/leave`)
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
        const data = await api.post<GomokuInviteResponse>(`${API_BASE}/invites`, { friendId })
        setLocalOutgoing((prev) => dedupeInvites([data.invite, ...prev]))
        if (data.match && data.match.id !== matchIdRef.current) {
          navigate(matchPath(data.match.id))
        } else {
          void loadFriends(false)
        }
      } catch (err) {
        setActionError(errorMessage(err, '发送对战邀请失败'))
      } finally {
        setBusyKey(null)
      }
    },
    [navigate, loadFriends]
  )

  const handleCancelInvite = useCallback(async (inviteId: number) => {
    setBusyKey(`cancel-${inviteId}`)
    setActionError(null)
    try {
      await api.delete(`${API_BASE}/invites/${inviteId}`)
      setLocalOutgoing((prev) => prev.filter((invite) => invite.id !== inviteId))
    } catch (err) {
      setActionError(errorMessage(err, '取消对战邀请失败'))
    } finally {
      setBusyKey(null)
    }
  }, [])

  const handleRespondInvite = useCallback(
    async (inviteId: number, action: 'accept' | 'decline') => {
      setBusyKey(`respond-${inviteId}`)
      setActionError(null)
      try {
        const data = await api.post<GomokuInviteRespondResponse>(
          `${API_BASE}/invites/${inviteId}/respond`,
          { action }
        )
        setLocalIncoming((prev) => prev.filter((invite) => invite.id !== inviteId))
        if (action === 'accept' && data.match) {
          dismissStartedMatch()
          navigate(matchPath(data.match.id), { replace: true })
        } else {
          void loadInvites()
        }
      } catch (err) {
        setActionError(errorMessage(err, action === 'accept' ? '接受邀请失败' : '拒绝邀请失败'))
      } finally {
        setBusyKey(null)
      }
    },
    [dismissStartedMatch, navigate, loadInvites]
  )

  /** 本页只处理五子棋邀请：本页列表 + 全局 Context 列表（按 id 去重） */
  const pageIncomingInvites = useMemo(
    () =>
      dedupeInvites([
        ...localIncoming,
        ...incomingInvites.filter((invite) => invite.game === 'gomoku'),
      ]),
    [localIncoming, incomingInvites]
  )
  const pageOutgoingInvites = useMemo(
    () =>
      dedupeInvites([
        ...localOutgoing,
        ...outgoingInvites.filter((invite) => invite.game === 'gomoku'),
      ]),
    [localOutgoing, outgoingInvites]
  )

  const handleBackToLobby = useCallback(() => {
    const current = matchRef.current
    if (current && current.status === 'playing') {
      const leave = window.confirm('对局仍在进行中，确定返回大厅吗？掉线超时会判负。')
      if (!leave) return
    }
    skipActiveCheckRef.current = true
    setMatch(null)
    setMatchError(null)
    setActionError(null)
    setLockVersion(null)
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

  const connBar = (
    <div className="gh-game-conn-bar">
      <span className={`gh-game-conn-chip gh-game-conn-chip--${transport}`}>
        {transport === 'ws' ? '实时连接' : '轮询模式'}
      </span>
      <span className="gh-game-conn-desc">
        {transport === 'ws'
          ? '邀请与对局状态通过 WebSocket 实时推送。'
          : '轮询模式，约 2 秒延迟：棋盘状态每 2 秒同步一次，仍可正常轮流落子。'}
      </span>
    </div>
  )

  if (!authLoading && !user) {
    return (
      <div className="gh-page-container gh-games-page gh-game-online-page">
        <section className="gh-gmk-guest" aria-label="需要登录">
          <p className="gh-g2048-eyebrow">五子棋 · 好友对弈</p>
          <h1 className="gh-games-title">登录后即可邀请好友对弈五子棋</h1>
          <p className="gh-games-subtitle">
            联机需要账号：好友关系、邀请与对局都以账号身份进行。不想登录也可以先玩单机人机对战。
          </p>
          <div className="gh-gmk-guest-actions">
            <Link className="gh-btn gh-btn--primary gh-btn--md" to="/login">
              去登录
            </Link>
            <Link className="gh-btn gh-btn--secondary gh-btn--md" to="/register">
              注册账号
            </Link>
            <Link className="gh-btn gh-btn--ghost gh-btn--md" to={GAME_GOMOKU_ROUTE}>
              单机人机对战
            </Link>
          </div>
        </section>
      </div>
    )
  }

  if (authLoading) {
    return (
      <div className="gh-page-container gh-games-page gh-game-online-page">
        <div className="gh-game-list-state" role="status">
          <div className="gh-spinner" />
          <span>正在确认登录状态…</span>
        </div>
      </div>
    )
  }

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
            void loadMatch(matchId, true)
          })}
          <p className="gh-game-inline-link">
            <Link to={LOBBY_PATH}>返回联机大厅</Link>
          </p>
        </div>
      )
    }

    const isHost = match.hostId === meId
    const playerCount = match.players.length

    // === 等待房间 ===
    if (match.status === 'waiting') {
      return (
        <div className="gh-page-container gh-games-page gh-game-online-page">
          <section className="gh-game-room" aria-label="五子棋等待房间">
            <header className="gh-game-room-header">
              <div>
                <p className="gh-g2048-eyebrow">五子棋对弈房间</p>
                <h1 className="gh-games-title">等待对手加入</h1>
                <p className="gh-games-subtitle">
                  15×15 标准棋盘、无禁手：房主执黑先行，率先连成五子（含长连）获胜，
                  每回合 60 秒，超时由服务端自动托管落子。
                </p>
              </div>
              <span className="gh-game-room-count">
                {playerCount}/{MAX_PLAYERS}
              </span>
            </header>

            {errorBanner(actionError ?? matchError)}
            {connBar}

            <div className="gh-game-room-actions">
              {isHost ? (
                <button
                  type="button"
                  className="gh-btn gh-btn--primary gh-btn--lg"
                  onClick={() => void handleStart()}
                  disabled={playerCount < MIN_PLAYERS || busyKey === 'start'}
                >
                  {busyKey === 'start' ? '正在开始…' : '开始对局（执黑先行）'}
                </button>
              ) : (
                <span className="gh-game-room-waiting">等待房主开始对局…</span>
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

            {isHost && playerCount < MIN_PLAYERS && (
              <p className="gh-game-room-hint">还需要邀请 1 位好友才能开始。</p>
            )}

            <section className="gh-game-room-players" aria-label="房间座位">
              <h2 className="gh-game-room-section-title">座位（{playerCount}/{MAX_PLAYERS}）</h2>
              <ul className="gh-gmk-seat-list">
                {Array.from({ length: MAX_PLAYERS }, (_, seat) => {
                  const player = match.players[seat]
                  const seatColor = seat === 0 ? '黑' : '白'
                  if (!player) {
                    return (
                      <li key={`empty-${seat}`} className="gh-gmk-seat gh-gmk-seat--empty">
                        <span className={`gh-gmk-seat-stone gh-gmk-seat-stone--${seat === 0 ? 'black' : 'white'}`} aria-hidden="true" />
                        <span className="gh-gmk-seat-name">等待加入 · {seatColor}方</span>
                      </li>
                    )
                  }
                  const isMe = player.userId === meId
                  const isRoomHost = player.userId === match.hostId
                  return (
                    <li
                      key={player.userId}
                      className={`gh-gmk-seat${isMe ? ' gh-gmk-seat--me' : ''}`}
                    >
                      <span className={`gh-gmk-seat-stone gh-gmk-seat-stone--${seat === 0 ? 'black' : 'white'}`} aria-hidden="true" />
                      <UserAvatar userId={player.userId} username={player.username} size="md" />
                      <span className="gh-gmk-seat-copy">
                        <span className="gh-gmk-seat-name">
                          {player.username}
                          {isRoomHost && <span className="gh-game-room-badge">房主</span>}
                          {isMe && <span className="gh-game-room-badge gh-game-room-badge--me">你</span>}
                        </span>
                        <span className="gh-gmk-seat-meta">
                          <span
                            className={`gh-game-presence-dot${
                              player.online ? ' gh-game-presence-dot--online' : ''
                            }`}
                          />
                          {player.online ? '在线' : '离线'} · 执{seatColor}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section className="gh-game-room-invite" aria-label="邀请好友">
              <h2 className="gh-game-room-section-title">邀请好友</h2>
              {playerCount >= MAX_PLAYERS ? (
                <p className="gh-game-room-hint">对手已就座（{MAX_PLAYERS} 人），房主可以开始对局。</p>
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

            <p className="gh-games-footnote">
              房主执黑先行；棋盘与胜负全部由服务端权威判定，双方看到同一份棋盘。
            </p>
          </section>
        </div>
      )
    }

    // === 对局 / 结算 ===
    return (
      <div className="gh-page-container gh-games-page gh-gmk-online">
        <GomokuOnlineStage
          key={match.id}
          match={match}
          meId={meId}
          isHost={isHost}
          transport={transport}
          actionPending={actionPending || lockVersion === match.version}
          turnRemainingMs={turnRemainingMs}
          actionError={actionError ?? matchError}
          onPlace={(x, y) => void submitAction({ type: 'place', x, y })}
          onBlocked={(reason) => setActionError(reason)}
          onResign={() => void handleResign()}
          onBackToLobby={handleBackToLobby}
          resignBusy={busyKey === 'resign'}
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
          <h1 className="gh-games-title">五子棋 · 好友对弈</h1>
          <p className="gh-games-subtitle">
            邀请好友进 2 人房间，{GOMOKU_BOARD_SIZE}×{GOMOKU_BOARD_SIZE} 标准棋盘：
            黑先白后轮流落子，率先连成五子（含长连）获胜，回合 60 秒超时自动托管。
          </p>
        </div>
        <div className="gh-gmk-header-actions">
          <Link className="gh-btn gh-btn--secondary gh-btn--md" to={GAME_GOMOKU_ROUTE}>
            单机人机对战
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

      {connBar}

      {errorBanner(actionError ?? invitesError)}
      {highlightFriendId !== null && (
        <p className="gh-game-highlight-hint">
          已从聊天页跳转：向高亮好友发送邀请即可开局。
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

      <div className="gh-gmk-lobby-tips">
        <h2 className="gh-gmk-lobby-tips-title">对局规则</h2>
        <ul className="gh-gmk-lobby-tips-list">
          <li>恰好 2 人对局：房主（座位 0）执黑先行，另一位执白。</li>
          <li>轮流在空交叉点落子，横、竖、斜任意方向连成五子及以上（含长连，无禁手）即获胜。</li>
          <li>棋盘下满且无人连五为平局；全局 30 分钟超时未分胜负同样按平局结算。</li>
          <li>回合 60 秒：超时由服务端自动托管落子（不淘汰）；掉线超过 120 秒且对方在线判负。</li>
          <li>轮询模式同样可以正常对局（约 2 秒延迟）。</li>
        </ul>
      </div>

      <p className="gh-games-footnote">
        对局为服务端权威判定：客户端只提交「落在哪个交叉点」，连五判定、托管与结算全部在服务端完成。
      </p>
    </div>
  )
}

// ==================== 对局舞台 ====================

interface GomokuOnlineStageProps {
  match: GameGomokuMatch
  meId: number
  isHost: boolean
  transport: 'ws' | 'polling'
  /** 本手已提交、等待盘面更新（棋盘禁用） */
  actionPending: boolean
  /** 当前回合剩余毫秒（用服务端 deadline 校准） */
  turnRemainingMs: number | null
  actionError: string | null
  onPlace: (x: number, y: number) => void
  /** 被本地规则挡下时给出中文提示（不发请求） */
  onBlocked: (reason: string) => void
  onResign: () => void
  onBackToLobby: () => void
  resignBusy: boolean
}

/**
 * 五子棋对局视图：CSS 网格棋盘（棋子 / 最后一手标记 / 获胜连线高亮）、
 * 回合条 + 倒计时、双方状态、结算遮罩。
 */
function GomokuOnlineStage({
  match,
  meId,
  isHost,
  transport,
  actionPending,
  turnRemainingMs,
  actionError,
  onPlace,
  onBlocked,
  onResign,
  onBackToLobby,
  resignBusy,
}: GomokuOnlineStageProps) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [cell, setCell] = useState(34)

  const size = match.boardSize || GOMOKU_BOARD_SIZE
  const total = size * size
  const playing = match.status === 'playing'
  const me = playerOf(match, meId)
  const myTurn = playing && match.turn?.userId === meId && me?.status === 'playing'
  const winner = playerOf(match, match.winnerId ?? -1)

  // 获胜连线索引化，渲染时 O(1) 查表
  const winningSet = useMemo(() => {
    const set = new Set<number>()
    for (const point of match.winningLine ?? []) set.add(point.y * size + point.x)
    return set
  }, [match.winningLine, size])

  // 格子尺寸自适应（容器宽度换算，移动端保持一屏装下）
  useEffect(() => {
    const measure = () => {
      const stage = stageRef.current
      if (!stage) return
      const available = Math.max(240, Math.floor(stage.clientWidth || 320))
      const fit = Math.floor(available / size)
      setCell(Math.max(18, Math.min(36, fit)))
    }
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      if (stageRef.current) observer.observe(stageRef.current)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [size])

  const boardStyle = {
    '--gh-gmk-size': `${size}`,
    '--gh-gmk-cell': `${cell}px`,
  } as CSSProperties

  const clickBlockReason = (): string | null => {
    if (!playing) return '本局已结束'
    if (actionPending) return '本手已提交，等盘面更新后才能再点'
    if (match.turn?.userId !== meId) return '还没轮到你'
    return null
  }

  const handlePointClick = (x: number, y: number) => {
    const reason = clickBlockReason()
    if (reason) {
      onBlocked(reason)
      return
    }
    if (match.board[y * size + x] !== 0) {
      onBlocked('该位置已有棋子')
      return
    }
    onPlace(x, y)
  }

  const disabledReason = clickBlockReason()
  const turnSeconds = turnRemainingMs === null ? null : Math.ceil(turnRemainingMs / 1000)
  const lastMove = match.lastMove

  const boardLabel = playing
    ? `五子棋盘面，${size} 乘 ${size}，黑先白后。${
        match.turn ? `当前回合：${nameOf(match, match.turn.userId)}` : '等待回合'
      }`
    : `五子棋对局结束。${winner ? `获胜者 ${winner.username}` : '平局'}。${
        END_REASON_LABELS[match.reason ?? 'five']
      }`

  return (
    <>
      <header className="gh-gmk-online-header">
        <div className="gh-gmk-online-heading">
          <p className="gh-g2048-eyebrow">
            <Link to={LOBBY_PATH}>← 五子棋联机大厅</Link>
          </p>
          <h1 className="gh-games-title">
            五子棋 · 轮流落子
            <span className={`gh-game-conn-chip gh-game-conn-chip--${transport}`}>
              {transport === 'ws' ? '实时' : '轮询'}
            </span>
          </h1>
          <p className="gh-games-subtitle">
            {size}×{size} 棋盘 · 黑先白后
            {transport === 'polling' ? ' · 轮询模式，约 2 秒延迟' : ''}
          </p>
        </div>
        <div className="gh-gmk-online-actions">
          {playing && (
            <button
              type="button"
              className="gh-btn gh-btn--danger gh-btn--sm"
              onClick={onResign}
              disabled={resignBusy || me?.status !== 'playing'}
              title={me?.status === 'playing' ? '认输退出本局' : '对局未在进行中'}
            >
              {resignBusy ? '提交中…' : '认输'}
            </button>
          )}
          <button
            type="button"
            className="gh-btn gh-btn--secondary gh-btn--sm"
            onClick={onBackToLobby}
          >
            {match.status === 'finished' ? (isHost ? '回大厅再开一局' : '返回大厅') : '返回大厅'}
          </button>
        </div>
      </header>

      {actionError && (
        <div className="gh-alert gh-alert--danger gh-game-alert" role="alert">
          {actionError}
        </div>
      )}

      <div className="gh-gmk-turn-bar" data-side={myTurn ? 'me' : 'other'}>
        <span className="gh-gmk-turn-label">当前回合</span>
        {match.turn ? (
          <>
            <span className="gh-gmk-turn-user">
              <span
                className={`gh-gmk-stone-mini gh-gmk-stone-mini--${
                  match.turn.userId === (match.players[0]?.userId ?? -1) ? 'black' : 'white'
                }`}
                aria-hidden="true"
              />
              {nameOf(match, match.turn.userId)}
              {match.turn.userId === meId ? '（你）' : ''}
            </span>
            {playing && turnSeconds !== null && (
              <span
                className={`gh-gmk-turn-countdown${turnSeconds <= 10 ? ' gh-gmk-turn-countdown--low' : ''}`}
                role="timer"
              >
                {turnSeconds} 秒
              </span>
            )}
          </>
        ) : (
          <span className="gh-gmk-turn-user">等待服务端安排回合…</span>
        )}
        <span className="gh-gmk-turn-hint">
          {myTurn ? '轮到你了：点击空交叉点落子。' : disabledReason ?? '等待对方落子'}
        </span>
      </div>

      <div className="gh-gmk-online-body">
        <div className="gh-gmk-online-main">
          <div
            className={`gh-gmk-stage gh-gmk-stage--online${
              myTurn && !actionPending ? ' gh-gmk-stage--live' : ' gh-gmk-stage--waiting'
            }`}
            ref={stageRef}
            role="group"
            aria-label={boardLabel}
          >
            <div className="gh-gmk-board" style={boardStyle}>
              <div className="gh-gmk-stars" aria-hidden="true">
                {GOMOKU_STARS.map(([sx, sy]) => (
                  <span
                    key={`star-${sx}-${sy}`}
                    className="gh-gmk-star"
                    style={{
                      left: `calc(var(--gh-gmk-cell) * ${sx + 0.5})`,
                      top: `calc(var(--gh-gmk-cell) * ${sy + 0.5})`,
                    }}
                  />
                ))}
              </div>
              {Array.from({ length: total }, (_, index) => {
                const x = index % size
                const y = Math.floor(index / size)
                const stone = match.board[index]
                const isWin = winningSet.has(index)
                const isLast = lastMove !== null && lastMove.x === x && lastMove.y === y
                const clickable = myTurn && !actionPending && stone === 0
                const ariaLabel = `第 ${y + 1} 行第 ${x + 1} 列，${
                  stone === 0 ? '空位' : stone === 1 ? '黑子' : '白子'
                }${isLast ? '，最后一手' : ''}`
                return (
                  <button
                    key={index}
                    type="button"
                    className={[
                      'gh-gmk-point',
                      stone !== 0 ? `gh-gmk-point--${stone === 1 ? 'black' : 'white'}` : '',
                      isWin ? 'gh-gmk-point--win' : '',
                      isLast ? 'gh-gmk-point--last' : '',
                      clickable ? 'gh-gmk-point--clickable' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    aria-label={ariaLabel}
                    aria-disabled={clickable ? undefined : true}
                    tabIndex={-1}
                    onClick={() => handlePointClick(x, y)}
                  >
                    {isLast && stone !== 0 && <span className="gh-gmk-point-mark" aria-hidden="true" />}
                  </button>
                )
              })}
            </div>

            {actionPending && (
              <p className="gh-gmk-locked-hint" role="status">
                本手已提交，等盘面更新。
              </p>
            )}

            {lastMove?.auto && playing && (
              <p className="gh-gmk-auto-hint" role="status">
                上一手为回合超时自动托管落子。
              </p>
            )}

            {match.status === 'finished' && (
              <div className="gh-gmk-overlay" role="dialog" aria-modal="true" aria-label="对局结算">
                <div className="gh-gmk-overlay-card">
                  <p className="gh-gmk-overlay-eyebrow">五子棋对局结束</p>
                  <h2
                    className={[
                      'gh-gmk-overlay-title',
                      winner && winner.userId === meId ? 'gh-gmk-overlay-title--win' : '',
                      winner === null ? 'gh-gmk-overlay-title--draw' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {winner ? `${winner.username} 获胜` : '本局平局'}
                  </h2>
                  <p className="gh-gmk-overlay-detail">
                    {match.reason ? END_REASON_LABELS[match.reason] : '本局已结束'}
                  </p>
                  <ul className="gh-gmk-result-list">
                    {match.players.map((player) => (
                      <li key={player.userId}>
                        <span
                          className={`gh-gmk-stone-mini gh-gmk-stone-mini--${
                            player.color === 1 ? 'black' : 'white'
                          }`}
                          aria-hidden="true"
                        />
                        <span className="gh-gmk-result-name">
                          {player.username}
                          {player.userId === meId ? '（你）' : ''}
                        </span>
                        <span className="gh-gmk-result-meta">
                          执{colorName(player.color)} · {player.moves} 手 · {STATUS_LABELS[player.status]}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="gh-gmk-overlay-actions">
                    <button type="button" className="gh-btn gh-btn--primary gh-btn--lg" onClick={onBackToLobby}>
                      {isHost ? '回大厅再开一局' : '返回大厅'}
                    </button>
                    <Link className="gh-btn gh-btn--secondary gh-btn--lg" to={GAME_GOMOKU_ROUTE}>
                      单机练习
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>

          {lastMove && !lastMove.auto && (
            <p className="gh-gmk-broadcast" role="status">
              最近一手：{nameOf(match, lastMove.userId)}（执{colorName(lastMove.color)}）落在
              （{lastMove.x + 1},{lastMove.y + 1}）
            </p>
          )}
        </div>

        <aside className="gh-gmk-scoreboard" aria-label="对局信息">
          <h2 className="gh-gmk-scoreboard-title">对局双方</h2>
          {playing ? (
            <p className="gh-gmk-scoreboard-countdown" role="status">
              {turnSeconds !== null ? (
                <>
                  本回合剩 <strong>{turnSeconds}</strong> 秒
                </>
              ) : (
                '等待回合开始'
              )}
            </p>
          ) : (
            <p className="gh-gmk-scoreboard-countdown">
              {match.status === 'finished' ? '本局已结束' : '等待开始'}
            </p>
          )}
          <ul className="gh-gmk-scoreboard-list">
            {match.players.map((player, seat) => (
              <li
                key={player.userId}
                className={[
                  'gh-gmk-scoreboard-row',
                  player.status === 'playing' ? '' : 'gh-gmk-scoreboard-row--out',
                  player.userId === meId ? 'gh-gmk-scoreboard-row--me' : '',
                  match.turn?.userId === player.userId ? 'gh-gmk-scoreboard-row--turn' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span
                  className={`gh-gmk-stone-mini gh-gmk-stone-mini--${
                    player.color === 2 ? 'white' : 'black'
                  }`}
                  aria-hidden="true"
                />
                <span className="gh-gmk-scoreboard-copy">
                  <span className="gh-gmk-scoreboard-name">
                    {player.username}
                    {player.userId === meId && (
                      <span className="gh-game-room-badge gh-game-room-badge--me">你</span>
                    )}
                    {player.userId === match.hostId && <span className="gh-game-room-badge">房主</span>}
                    {match.turn?.userId === player.userId && playing && (
                      <span className="gh-game-room-badge gh-gmk-turn-badge">回合中</span>
                    )}
                  </span>
                  <span className="gh-gmk-scoreboard-meta">
                    <span
                      className={`gh-game-presence-dot${
                        player.online ? ' gh-game-presence-dot--online' : ''
                      }`}
                    />
                    {player.online ? '在线' : '离线'} · 执{colorName(player.color)} · {seat + 1} 号位
                  </span>
                </span>
                <span className="gh-gmk-scoreboard-numbers">
                  <strong className="gh-gmk-scoreboard-score">{player.moves}</strong>
                  <span className="gh-gmk-scoreboard-split">手</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="gh-gmk-scoreboard-foot">
            棋盘与胜负由服务端权威判定；回合 60 秒超时自动托管，掉线超过 120 秒判负。
          </p>
        </aside>
      </div>
    </>
  )
}
