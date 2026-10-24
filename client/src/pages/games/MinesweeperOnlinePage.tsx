import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import UserAvatar from '../../components/UserAvatar'
import GameFriendPicker from '../../components/games/GameFriendPicker'
import { useAuth } from '../../contexts/AuthContext'
import { useChat } from '../../contexts/ChatContext'
import { useGame } from '../../contexts/GameContext'
import api from '../../lib/api'
import { GAME_POLL_INTERVALS } from '../../lib/realtime'
import { MS_ONLINE, msColorForSeat } from '../../lib/games/minesweeper'
import { GAME_MINESWEEPER_ONLINE_ROUTE, GAME_MINESWEEPER_ROUTE } from '../../lib/games/catalog'
import type {
  GameFriend,
  GameFriendsResponse,
  GameInvite,
  GameInvitesResponse,
  GameMinesweeperEndReason,
  GameMinesweeperMatch,
  GameMinesweeperPlayer,
  MinesweeperActionBody,
  MinesweeperActiveMatchResponse,
  MinesweeperMatchResponse,
  MinesweeperSyncResponse,
} from '../../types/game'

/** 服务端前缀：与 2048 / 斗地主 / 贪吃蛇完全同构 */
const API_BASE = '/games/minesweeper'
const LOBBY_PATH = GAME_MINESWEEPER_ONLINE_ROUTE
/** 轮流扫雷房间：2–4 人 */
const MIN_PLAYERS = 2
const MAX_PLAYERS = 4
/** 格子边长范围（桌面 24–28，窄屏允许缩到 18 以内保证一屏装下） */
const CELL_MIN = 18
const CELL_MAX = 28
/** 提交一次动作后本地锁盘的兜底解锁时间（毫秒），防止漏事件导致永久卡住 */
const ACTION_LOCK_FALLBACK_MS = 10_000

/** 邀请端点响应（match 为扫雷 DTO，types/game.ts 的通用类型按 2048 声明，这里本地收窄） */
interface MinesweeperInviteResponse {
  invite: GameInvite
  match?: GameMinesweeperMatch
}
interface MinesweeperInviteRespondResponse {
  ok: boolean
  match?: GameMinesweeperMatch
}

const END_REASON_LABELS: Record<GameMinesweeperEndReason, string> = {
  boom: '有人踩响了雷 —— 踩雷的那位出局，其他玩家继续',
  cleared: '安全格全部翻开，按翻开数结算',
  timeout: '对局超时，按当前翻开数结算',
  resign: '有玩家认输，本局提前结束',
  forfeit: '有玩家掉线或连续跳过回合，被判负',
  cancelled: '房间已解散',
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

/** 玩家座位号（按 players 数组下标，决定插旗配色） */
function seatOf(match: GameMinesweeperMatch, userId: number): number {
  const index = match.players.findIndex((player) => player.userId === userId)
  return index < 0 ? 0 : index
}

function playerOf(match: GameMinesweeperMatch, userId: number): GameMinesweeperPlayer | null {
  return match.players.find((player) => player.userId === userId) ?? null
}

function nameOf(match: GameMinesweeperMatch, userId: number): string {
  return match.players.find((player) => player.userId === userId)?.username ?? '某位玩家'
}

/** 索引 → 「(列,行)」人类可读坐标（1 起） */
function cellLabel(match: GameMinesweeperMatch, index: number): string {
  const x = index % match.board.width
  const y = Math.floor(index / match.board.width)
  return `(${x + 1},${y + 1})`
}

/** 播报最近一次动作 */
function actionText(match: GameMinesweeperMatch): string | null {
  const last = match.lastAction
  if (!last) return null
  const who = nameOf(match, last.userId)
  if (last.kind === 'open') return `${who} 翻开了 ${cellLabel(match, last.index)}`
  if (last.kind === 'flag') return `${who} 在 ${cellLabel(match, last.index)} 插了一面旗`
  return `${who} 撤掉了 ${cellLabel(match, last.index)} 的旗`
}

/**
 * 扫雷好友联机（2–4 人轮流点）：
 * - 无 matchId：先查进行中的对局（有则跳转），否则展示大厅（好友列表 + 邀请）。
 * - 有 matchId：等待房间 / 轮流对局 / 结算遮罩。
 * - 盘面由服务端权威持有：DTO 只给已翻开格（含数字）与旗子，雷位不泄露。
 * - WS 事件复用 /ws/chat 的 game:match:*（按 match.game === 'minesweeper' 判别）；
 *   无 WebSocket 时按 GAME_POLL_INTERVALS 轮询 sync + presence 心跳降级。
 */
export default function MinesweeperOnlinePage() {
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

  const [match, setMatch] = useState<GameMinesweeperMatch | null>(null)
  const [matchLoading, setMatchLoading] = useState(matchId !== null)
  const [matchError, setMatchError] = useState<string | null>(null)
  const [friends, setFriends] = useState<GameFriend[]>([])
  const [friendsLoading, setFriendsLoading] = useState(matchId === null)
  const [friendsError, setFriendsError] = useState<string | null>(null)
  const [localIncoming, setLocalIncoming] = useState<GameInvite[]>([])
  const [localOutgoing, setLocalOutgoing] = useState<GameInvite[]>([])
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  /** 「一人只许下一次」：本手提交时的对局版本，版本变化才解锁 */
  const [lockVersion, setLockVersion] = useState<number | null>(null)
  const [actionPending, setActionPending] = useState(false)
  const [nowTick, setNowTick] = useState(0)

  const matchRef = useRef<GameMinesweeperMatch | null>(null)
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

  const applyMatch = useCallback((next: GameMinesweeperMatch) => {
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
        const data = await api.get<MinesweeperMatchResponse>(`${API_BASE}/matches/${id}`)
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

  /** 本页自己的扫雷邀请列表（比全局 Context 更即时，也与其它游戏隔离） */
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
      .get<MinesweeperActiveMatchResponse>(`${API_BASE}/matches/active`)
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
      if (event.match.game !== 'minesweeper') return
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
        const data = await api.get<MinesweeperSyncResponse>(`${API_BASE}/sync?matchId=${matchId}`)
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

  // 大厅轮询模式下也要能看到邀请（Context 的 sync 不含扫雷邀请）
  useEffect(() => {
    if (!user || matchId) return
    if (transport !== 'polling') return
    const timer = setInterval(() => void loadInvites(), GAME_POLL_INTERVALS.sync)
    return () => clearInterval(timer)
  }, [user, matchId, transport, loadInvites])

  // 时钟校准：对局 DTO 不带 serverTime，进对局时单独拉一次 sync 估算与服务端的时差，
  // 回合倒计时按 deadline - (本地时间 + 偏移) 计算（服务端每秒 sweeper 会推进 deadline）
  useEffect(() => {
    if (!user || !matchId || transport !== 'ws') return
    let cancelled = false
    api
      .get<MinesweeperSyncResponse>(`${API_BASE}/sync?matchId=${matchId}`)
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

  // 版本前进（服务端处理完本手或别人落子）即解锁棋盘；另有兜底超时
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
      const data = await api.get<MinesweeperMatchResponse>(`${API_BASE}/matches/${id}`)
      setMatch(data.match)
      setMatchError(null)
    } catch {
      // 保留当前棋盘，等待下一次同步
    }
  }, [])

  const submitAction = useCallback(
    async (body: MinesweeperActionBody) => {
      const id = matchIdRef.current
      const current = matchRef.current
      if (!id || !current || current.status !== 'playing') return
      if (inFlightRef.current) return
      if (current.turn?.userId !== meId) {
        setActionError('还没轮到你，等上一位玩家点完')
        return
      }
      const me = playerOf(current, meId)
      if (!me || me.status !== 'playing') {
        setActionError('你已经出局，本局只能观战')
        return
      }

      inFlightRef.current = true
      setActionPending(true)
      try {
        const data = await api.post<MinesweeperMatchResponse>(
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
      const data = await api.post<MinesweeperMatchResponse>(`${API_BASE}/matches/${id}/start`)
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
    if (!window.confirm('确定认输吗？本局你会记为失败，其他玩家继续。')) return
    setBusyKey('resign')
    setActionError(null)
    try {
      const data = await api.post<MinesweeperMatchResponse>(`${API_BASE}/matches/${id}/resign`)
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
        const data = await api.post<MinesweeperInviteResponse>(`${API_BASE}/invites`, { friendId })
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
        const data = await api.post<MinesweeperInviteRespondResponse>(
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

  /** 本页只处理扫雷邀请：本页列表 + 全局 Context 列表（按 id 去重） */
  const pageIncomingInvites = useMemo(
    () =>
      dedupeInvites([
        ...localIncoming,
        ...incomingInvites.filter((invite) => invite.game === 'minesweeper'),
      ]),
    [localIncoming, incomingInvites]
  )
  const pageOutgoingInvites = useMemo(
    () =>
      dedupeInvites([
        ...localOutgoing,
        ...outgoingInvites.filter((invite) => invite.game === 'minesweeper'),
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
          : '轮询模式，约 2 秒延迟：盘面状态每 2 秒同步一次，仍可正常轮流扫雷。'}
      </span>
    </div>
  )

  if (!authLoading && !user) {
    return (
      <div className="gh-page-container gh-games-page gh-game-online-page">
        <section className="gh-ms-guest" aria-label="需要登录">
          <p className="gh-g2048-eyebrow">扫雷 · 好友轮流</p>
          <h1 className="gh-games-title">登录后即可邀请好友轮流扫雷</h1>
          <p className="gh-games-subtitle">
            联机需要账号：好友关系、邀请与对局都以账号身份进行。不想登录也可以先玩单机三档难度。
          </p>
          <div className="gh-ms-guest-actions">
            <Link className="gh-btn gh-btn--primary gh-btn--md" to="/login">
              去登录
            </Link>
            <Link className="gh-btn gh-btn--secondary gh-btn--md" to="/register">
              注册账号
            </Link>
            <Link className="gh-btn gh-btn--ghost gh-btn--md" to={GAME_MINESWEEPER_ROUTE}>
              单机扫雷
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
          <section className="gh-game-room" aria-label="扫雷等待房间">
            <header className="gh-game-room-header">
              <div>
                <p className="gh-g2048-eyebrow">扫雷轮流房间</p>
                <h1 className="gh-games-title">等待玩家加入</h1>
                <p className="gh-games-subtitle">
                  共享一张 {match.board.width}×{match.board.height} 盘面、{match.board.mines} 颗雷：
                  每人轮到自己只许点一次（开一格或插一面旗），谁踩雷谁出局。
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
                  {busyKey === 'start' ? '正在开始…' : `开始对局（${playerCount}/${MAX_PLAYERS}）`}
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
              <p className="gh-game-room-hint">至少 {MIN_PLAYERS} 人才能开始，先邀请好友进来吧。</p>
            )}

            <section className="gh-game-room-players" aria-label="房间座位">
              <h2 className="gh-game-room-section-title">座位（{playerCount}/{MAX_PLAYERS}）</h2>
              <ul className="gh-ms-seat-list">
                {Array.from({ length: MAX_PLAYERS }, (_, seat) => {
                  const player = match.players[seat]
                  if (!player) {
                    return (
                      <li key={`empty-${seat}`} className="gh-ms-seat gh-ms-seat--empty">
                        <span
                          className="gh-ms-seat-swatch"
                          style={{ background: msColorForSeat(seat) }}
                          aria-hidden="true"
                        />
                        <span className="gh-ms-seat-name">空位 · {seat + 1} 号位</span>
                      </li>
                    )
                  }
                  const isMe = player.userId === meId
                  const isRoomHost = player.userId === match.hostId
                  return (
                    <li
                      key={player.userId}
                      className={`gh-ms-seat${isMe ? ' gh-ms-seat--me' : ''}`}
                    >
                      <span
                        className="gh-ms-seat-swatch"
                        style={{ background: msColorForSeat(seat) }}
                        aria-hidden="true"
                      />
                      <UserAvatar userId={player.userId} username={player.username} size="md" />
                      <span className="gh-ms-seat-copy">
                        <span className="gh-ms-seat-name">
                          {player.username}
                          {isRoomHost && <span className="gh-game-room-badge">房主</span>}
                          {isMe && <span className="gh-game-room-badge gh-game-room-badge--me">你</span>}
                        </span>
                        <span className="gh-ms-seat-meta">
                          <span
                            className={`gh-game-presence-dot${
                              player.online ? ' gh-game-presence-dot--online' : ''
                            }`}
                          />
                          {player.online ? '在线' : '离线'} · {seat + 1} 号位
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
                <p className="gh-game-room-hint">房间已满（{MAX_PLAYERS} 人），不能再邀请。</p>
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
              盘面由服务端一次生成并对所有人一致；开局后按座位顺序轮流，每人每次只能点一格。
            </p>
          </section>
        </div>
      )
    }

    // === 对局 / 结算 ===
    return (
      <div className="gh-page-container gh-games-page gh-ms-online">
        <MinesweeperOnlineStage
          key={match.id}
          match={match}
          meId={meId}
          isHost={isHost}
          transport={transport}
          actionPending={actionPending || lockVersion === match.version}
          turnRemainingMs={turnRemainingMs}
          actionError={actionError ?? matchError}
          onOpen={(index) => void submitAction({ type: 'open', index })}
          onFlag={(index) => void submitAction({ type: 'flag', index })}
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
          <h1 className="gh-games-title">扫雷 · 好友轮流扫雷</h1>
          <p className="gh-games-subtitle">
            邀请好友进 2–{MAX_PLAYERS} 人房间，共享一张 {MS_ONLINE.width}×{MS_ONLINE.height} 盘面：
            轮到你时只能点一次（开一格或插一面旗），踩雷就出局，最后按翻开格数计分。
          </p>
        </div>
        <div className="gh-ms-header-actions">
          <Link className="gh-btn gh-btn--secondary gh-btn--md" to={GAME_MINESWEEPER_ROUTE}>
            单机扫雷
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

      <div className="gh-ms-lobby-tips">
        <h2 className="gh-ms-lobby-tips-title">房间规则</h2>
        <ul className="gh-ms-lobby-tips-list">
          <li>房间 2–{MAX_PLAYERS} 人，房主开局后进入同一张 {MS_ONLINE.width}×{MS_ONLINE.height} 盘面，共 {MS_ONLINE.mines} 颗雷。</li>
          <li>一人一次：轮到自己只能提交一个动作（翻开一格或插一面旗），提交后立刻交给下一位。</li>
          <li>踩雷的人记一次 boom 并交出回合权，其他人继续；安全格全清或对局超时按翻开数结算。</li>
          <li>回合有截止时间，超时算跳过；连续跳过或掉线超时会判负，轮询模式同样可以正常对局（约 2 秒延迟）。</li>
          <li>旗子按插旗者的颜色显示，看图例就知道是谁埋的记号。</li>
        </ul>
      </div>

      <p className="gh-games-footnote">
        对局为服务端权威判定：客户端只提交「开哪格 / 插哪格」，雷位与结算全部在服务端完成，
        未翻开的格子永远不会泄露雷的位置。
      </p>
    </div>
  )
}

// ==================== 对局舞台 ====================

interface MinesweeperOnlineStageProps {
  match: GameMinesweeperMatch
  meId: number
  isHost: boolean
  transport: 'ws' | 'polling'
  /** 本手已提交、等待盘面更新（棋盘禁用） */
  actionPending: boolean
  /** 当前回合剩余毫秒（用服务端 deadline 校准） */
  turnRemainingMs: number | null
  actionError: string | null
  onOpen: (index: number) => void
  onFlag: (index: number) => void
  /** 被本地规则挡下时给出中文提示（不发请求） */
  onBlocked: (reason: string) => void
  onResign: () => void
  onBackToLobby: () => void
  resignBusy: boolean
}

/**
 * 轮流扫雷视图：共享 DOM 网格盘面（只渲染 DTO 给的已开格与旗子）、
 * 回合条 + 倒计时、玩家图例、计分板、结算遮罩。
 */
function MinesweeperOnlineStage({
  match,
  meId,
  isHost,
  transport,
  actionPending,
  turnRemainingMs,
  actionError,
  onOpen,
  onFlag,
  onBlocked,
  onResign,
  onBackToLobby,
  resignBusy,
}: MinesweeperOnlineStageProps) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [cell, setCell] = useState(CELL_MAX)

  const width = match.board.width
  const height = match.board.height
  const total = width * height
  const playing = match.status === 'playing'
  const me = playerOf(match, meId)
  const myTurn = playing && match.turn?.userId === meId && me?.status === 'playing'
  const winner = playerOf(match, match.winnerId ?? -1)

  // 已开格 / 旗子索引化，渲染时 O(1) 查表
  const openedMap = useMemo(() => {
    const map = new Map<number, { mine: boolean; adjacent: number }>()
    for (const cellDto of match.opened) {
      map.set(cellDto.index, { mine: cellDto.mine, adjacent: cellDto.adjacent })
    }
    return map
  }, [match.opened])

  const flagMap = useMemo(() => {
    const map = new Map<number, number>()
    for (const flag of match.flags) map.set(flag.index, flag.by)
    return map
  }, [match.flags])

  const colorByUser = useMemo(() => {
    const map = new Map<number, string>()
    match.players.forEach((player, seat) => map.set(player.userId, msColorForSeat(seat)))
    return map
  }, [match.players])

  // 格子尺寸自适应（容器宽度换算，移动端可横向滚动）
  useEffect(() => {
    const measure = () => {
      const stage = stageRef.current
      if (!stage) return
      const available = Math.max(240, Math.floor(stage.clientWidth || 320))
      const gap = 2
      const fit = Math.floor((available - gap * (width - 1)) / width)
      setCell(Math.max(CELL_MIN, Math.min(CELL_MAX, fit)))
    }
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      if (stageRef.current) observer.observe(stageRef.current)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [width])

  const boardStyle = {
    gridTemplateColumns: `repeat(${width}, ${cell}px)`,
    '--gh-ms-cell': `${cell}px`,
  } as CSSProperties

  const clickBlockReason = (): string | null => {
    if (!playing) return '本局已结束'
    if (me && me.status !== 'playing') return '你已经出局，本局只能观战'
    if (actionPending) return '本手已提交，等盘面更新后才能再点'
    if (match.turn?.userId !== meId) return '还没轮到你'
    return null
  }

  const handleCellClick = (index: number) => {
    const reason = clickBlockReason()
    if (reason) {
      onBlocked(reason)
      return
    }
    onOpen(index)
  }

  const handleCellContext = (event: ReactMouseEvent<HTMLButtonElement>, index: number) => {
    event.preventDefault()
    const reason = clickBlockReason()
    if (reason) {
      onBlocked(reason)
      return
    }
    onFlag(index)
  }

  const disabledReason = clickBlockReason()
  const openedCount = match.opened.filter((item) => !item.mine).length
  const safeTotal = match.board.width * match.board.height - match.board.mines
  const flaggedCount = match.flags.length
  const remainingMines = Math.max(0, match.board.mines - flaggedCount)
  const turnSeconds = turnRemainingMs === null ? null : Math.ceil(turnRemainingMs / 1000)
  const broadcast = actionText(match)

  const rankedPlayers = useMemo(
    () =>
      [...match.players].sort(
        (a, b) => b.score - a.score || b.opened - a.opened || a.username.localeCompare(b.username)
      ),
    [match.players]
  )

  const boardLabel = playing
    ? `轮流扫雷盘面，${width} 乘 ${height}，共 ${match.board.mines} 雷，已翻开 ${openedCount} 格（安全格 ${safeTotal}），剩余雷数 ${remainingMines}，版本 ${match.version}。${
        match.turn ? `当前回合：${nameOf(match, match.turn.userId)}` : '等待回合'
      }`
    : `轮流扫雷对局结束。${winner ? `获胜者 ${winner.username}` : '没有赢家'}。${rankedPlayers
        .map((player) => `${player.username} 翻开 ${player.opened} 格、踩雷 ${player.booms} 次`)
        .join('；')}`

  return (
    <>
      <header className="gh-ms-online-header">
        <div className="gh-ms-online-heading">
          <p className="gh-g2048-eyebrow">
            <Link to={LOBBY_PATH}>← 扫雷联机大厅</Link>
          </p>
          <h1 className="gh-games-title">
            扫雷 · 轮流开格
            <span className={`gh-game-conn-chip gh-game-conn-chip--${transport}`}>
              {transport === 'ws' ? '实时' : '轮询'}
            </span>
          </h1>
          <p className="gh-games-subtitle">
            {width}×{height} 盘面 · {match.board.mines} 颗雷 · 已翻开 {openedCount}/{safeTotal} ·
            剩余雷数 {remainingMines}
            {transport === 'polling' ? ' · 轮询模式，约 2 秒延迟' : ''}
          </p>
        </div>
        <div className="gh-ms-online-actions">
          {playing && (
            <button
              type="button"
              className="gh-btn gh-btn--danger gh-btn--sm"
              onClick={onResign}
              disabled={resignBusy || me?.status !== 'playing'}
              title={me?.status === 'playing' ? '认输退出本局' : '你已经出局'}
            >
              {resignBusy ? '提交中…' : '认输'}
            </button>
          )}
          <button
            type="button"
            className="gh-btn gh-btn--secondary gh-btn--sm"
            onClick={onBackToLobby}
          >
            {match.status === 'finished' ? (isHost ? '再来一局' : '返回大厅') : '返回大厅'}
          </button>
        </div>
      </header>

      {actionError && (
        <div className="gh-alert gh-alert--danger gh-game-alert" role="alert">
          {actionError}
        </div>
      )}

      <div className="gh-ms-turn-bar" data-mine={myTurn ? 'me' : 'other'}>
        <span className="gh-ms-turn-label">当前回合</span>
        {match.turn ? (
          <>
            <span
              className="gh-ms-turn-user"
              style={{ color: colorByUser.get(match.turn.userId) ?? undefined }}
            >
              <span
                className="gh-ms-turn-swatch"
                style={{ background: colorByUser.get(match.turn.userId) ?? 'var(--gh-text-tertiary)' }}
                aria-hidden="true"
              />
              {nameOf(match, match.turn.userId)}
              {match.turn.userId === meId ? '（你）' : ''}
            </span>
            {playing && turnSeconds !== null && (
              <span
                className={`gh-ms-turn-countdown${turnSeconds <= 10 ? ' gh-ms-turn-countdown--low' : ''}`}
                role="timer"
              >
                {turnSeconds} 秒
              </span>
            )}
            <span className="gh-ms-turn-skips">
              本回合已跳过 {match.turn.skips} 次{match.turn.skips >= 3 ? ' —— 连续跳过会判负' : ''}
            </span>
          </>
        ) : (
          <span className="gh-ms-turn-user">等待服务端安排回合…</span>
        )}
        <span className="gh-ms-turn-hint">
          {myTurn ? '轮到你了：左键开一格，右键插旗，一次只许点一下。' : disabledReason ?? '等待其他玩家落子'}
        </span>
      </div>

      <div className="gh-ms-online-body">
        <div className="gh-ms-online-main">
          <div
            className={`gh-ms-stage gh-ms-stage--online${
              myTurn && !actionPending ? ' gh-ms-stage--live' : ' gh-ms-stage--waiting'
            }`}
            ref={stageRef}
            role="group"
            aria-label={boardLabel}
          >
            <div className="gh-ms-board gh-ms-board--online" style={boardStyle}>
              {Array.from({ length: total }, (_, index) => {
                const opened = openedMap.get(index)
                const flagBy = flagMap.get(index)
                const x = index % width
                const y = Math.floor(index / width)
                let kind = 'closed'
                let text: string | number | null = null
                if (opened) {
                  if (opened.mine) {
                    kind = 'mine'
                    text = '💣'
                  } else if (opened.adjacent > 0) {
                    kind = 'number'
                    text = opened.adjacent
                  } else {
                    kind = 'blank'
                  }
                } else if (flagBy !== undefined) {
                  kind = 'flag'
                  text = '🚩'
                }
                const flagColor = flagBy !== undefined ? colorByUser.get(flagBy) : undefined
                const ariaSuffix =
                  kind === 'number'
                    ? `数字 ${opened?.adjacent ?? 0}`
                    : kind === 'blank'
                      ? '空白'
                      : kind === 'mine'
                        ? '地雷'
                        : kind === 'flag'
                          ? `由 ${flagBy !== undefined ? nameOf(match, flagBy) : '玩家'} 插的旗`
                          : '未翻开'
                return (
                  <button
                    key={index}
                    type="button"
                    className={[
                      'gh-ms-cell',
                      `gh-ms-cell--${kind}`,
                      kind === 'number' ? `gh-ms-cell--n${opened?.adjacent ?? 0}` : '',
                      kind === 'closed' && myTurn && !actionPending ? 'gh-ms-cell--clickable' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={flagColor ? ({ '--gh-ms-flag-color': flagColor } as CSSProperties) : undefined}
                    data-n={kind === 'number' ? opened?.adjacent : undefined}
                    aria-label={`第 ${y + 1} 行第 ${x + 1} 列，${ariaSuffix}`}
                    aria-disabled={myTurn && !actionPending ? undefined : true}
                    tabIndex={-1}
                    onClick={() => handleCellClick(index)}
                    onContextMenu={(event) => handleCellContext(event, index)}
                  >
                    {text}
                  </button>
                )
              })}
            </div>

            {actionPending && (
              <p className="gh-ms-locked-hint" role="status">
                本手已提交，等盘面更新后下一轮才轮到你。
              </p>
            )}

            {match.status === 'finished' && (
              <div className="gh-ms-overlay" role="dialog" aria-modal="true" aria-label="对局结算">
                <div className="gh-ms-overlay-card">
                  <p className="gh-ms-overlay-eyebrow">轮流扫雷结束</p>
                  <h2
                    className={[
                      'gh-ms-overlay-title',
                      winner && winner.userId === meId ? 'gh-ms-overlay-title--win' : '',
                      winner === null ? 'gh-ms-overlay-title--draw' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {winner ? `${winner.username} 获胜` : '本局没有赢家'}
                  </h2>
                  <p className="gh-ms-overlay-detail">
                    {match.reason ? END_REASON_LABELS[match.reason] : '本局已结束'}
                  </p>
                  <ol className="gh-ms-result-ranks">
                    {rankedPlayers.map((player, index) => (
                      <li key={player.userId}>
                        <span
                          className="gh-ms-swatch"
                          style={{ background: msColorForSeat(seatOf(match, player.userId)) }}
                          aria-hidden="true"
                        />
                        <span className="gh-ms-result-rank">
                          {index + 1}. {player.username}
                          {player.userId === meId ? '（你）' : ''}
                        </span>
                        <strong>{player.score}</strong>
                        <span className="gh-ms-result-meta">
                          翻开 {player.opened} 格 · 踩雷 {player.booms} 次 ·{' '}
                          {player.userId === match.winnerId
                            ? '获胜'
                            : match.winnerId === null
                              ? '本局并列 / 无赢家'
                              : STATUS_LABELS[player.status]}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <div className="gh-ms-overlay-actions">
                    <button type="button" className="gh-btn gh-btn--primary gh-btn--lg" onClick={onBackToLobby}>
                      {isHost ? '回大厅再开一局' : '返回大厅'}
                    </button>
                    <Link className="gh-btn gh-btn--secondary gh-btn--lg" to={GAME_MINESWEEPER_ROUTE}>
                      单机练习
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>

          {broadcast && (
            <p className="gh-ms-broadcast" role="status">
              最近一手：{broadcast}
            </p>
          )}

          <div className="gh-ms-legend" aria-label="旗子配色图例">
            <span className="gh-ms-legend-title">旗子归属</span>
            {match.players.map((player, seat) => (
              <span key={player.userId} className="gh-ms-legend-item">
                <span
                  className="gh-ms-swatch"
                  style={{ background: msColorForSeat(seat) }}
                  aria-hidden="true"
                />
                {player.username}
                {player.userId === meId ? '（你）' : ''}
              </span>
            ))}
          </div>
        </div>

        <aside className="gh-ms-scoreboard" aria-label="计分板">
          <h2 className="gh-ms-scoreboard-title">计分板</h2>
          {playing ? (
            <p className="gh-ms-scoreboard-countdown" role="status">
              {turnSeconds !== null ? (
                <>
                  本回合剩 <strong>{turnSeconds}</strong> 秒
                </>
              ) : (
                '等待回合开始'
              )}
            </p>
          ) : (
            <p className="gh-ms-scoreboard-countdown">
              {match.status === 'finished' ? '本局已结束' : '等待开始'}
            </p>
          )}
          <ul className="gh-ms-scoreboard-list">
            {rankedPlayers.map((player) => (
              <li
                key={player.userId}
                className={[
                  'gh-ms-scoreboard-row',
                  player.status === 'playing' ? '' : 'gh-ms-scoreboard-row--out',
                  player.userId === meId ? 'gh-ms-scoreboard-row--me' : '',
                  match.turn?.userId === player.userId ? 'gh-ms-scoreboard-row--turn' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span
                  className="gh-ms-swatch"
                  style={{
                    background:
                      player.status === 'waiting' || player.status === 'playing'
                        ? msColorForSeat(seatOf(match, player.userId))
                        : 'var(--gh-text-disabled)',
                  }}
                  aria-hidden="true"
                />
                <span className="gh-ms-scoreboard-copy">
                  <span className="gh-ms-scoreboard-name">
                    {player.username}
                    {player.userId === meId && (
                      <span className="gh-game-room-badge gh-game-room-badge--me">你</span>
                    )}
                    {player.userId === match.hostId && <span className="gh-game-room-badge">房主</span>}
                    {match.turn?.userId === player.userId && playing && (
                      <span className="gh-game-room-badge gh-ms-turn-badge">回合中</span>
                    )}
                  </span>
                  <span className="gh-ms-scoreboard-meta">
                    <span
                      className={`gh-game-presence-dot${
                        player.online ? ' gh-game-presence-dot--online' : ''
                      }`}
                    />
                    {player.online ? '在线' : '离线'} · {STATUS_LABELS[player.status]}
                  </span>
                </span>
                <span className="gh-ms-scoreboard-numbers">
                  <strong className="gh-ms-scoreboard-score">{player.score}</strong>
                  <span className="gh-ms-scoreboard-split">
                    开 {player.opened} / 炸 {player.booms}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="gh-ms-scoreboard-foot">
            计分 = 名下安全翻开格数，踩雷不扣分但会交出回合权；盘面与雷位由服务端权威持有。
          </p>
        </aside>
      </div>
    </>
  )
}

const STATUS_LABELS: Record<GameMinesweeperPlayer['status'], string> = {
  waiting: '等待中',
  playing: '对局中',
  won: '获胜',
  lost: '出局',
}
