import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import UserAvatar from '../../components/UserAvatar'
import GameFriendPicker from '../../components/games/GameFriendPicker'
import { useAuth } from '../../contexts/AuthContext'
import { useChat } from '../../contexts/ChatContext'
import { useGame } from '../../contexts/GameContext'
import { useTheme } from '../../contexts/ThemeContext'
import api from '../../lib/api'
import { GAME_POLL_INTERVALS } from '../../lib/realtime'
import {
  SNAKE_DEAD_COLOR,
  isOppositeDirection,
  snakeColorForSeat,
} from '../../lib/games/snake'
import { GAME_SNAKE_ONLINE_ROUTE, GAME_SNAKE_ROUTE } from '../../lib/games/catalog'
import type {
  GameFriend,
  GameFriendsResponse,
  GameInvite,
  GameInvitesResponse,
  GameSnakeEndReason,
  GameSnakeMatch,
  GameSnakePlayer,
  SnakeActionBody,
  SnakeActiveMatchResponse,
  SnakeCellDto,
  SnakeDirection,
  SnakeMatchResponse,
  SnakeSyncResponse,
} from '../../types/game'

/** 服务端前缀：与 2048 / 斗地主完全同构 */
const API_BASE = '/games/snake'
const LOBBY_PATH = GAME_SNAKE_ONLINE_ROUTE
/** 大地图房间：2–8 人 */
const MIN_PLAYERS = 2
const MAX_PLAYERS = 8

/** 邀请端点响应（match 为贪吃蛇 DTO，types/game.ts 的通用类型按 2048 声明，这里本地收窄） */
interface SnakeInviteResponse {
  invite: GameInvite
  match?: GameSnakeMatch
}
interface SnakeInviteRespondResponse {
  ok: boolean
  match?: GameSnakeMatch
}

const END_REASON_LABELS: Record<GameSnakeEndReason, string> = {
  last_standing: '最后存活的蛇赢了 —— 其他蛇都已撞线',
  elimination: '全部蛇同归于尽，本局没有赢家',
  timeout: '时间到，按当前分数排名结算',
  resign: '有玩家认输，对局提前结束',
  forfeit: '有玩家掉线超时被判负',
  cancelled: '房间已解散',
}

const KEY_MAP: Record<string, SnakeDirection | undefined> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  W: 'up',
  s: 'down',
  S: 'down',
  a: 'left',
  A: 'left',
  d: 'right',
  D: 'right',
}

const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

function matchPath(matchId: number): string {
  return `${LOBBY_PATH}/${matchId}`
}

// ==================== canvas 渲染（大地图 + 插值动画） ====================

interface OnlineLayout {
  cssWidth: number
  cssHeight: number
  cell: number
  dpr: number
}

interface BoardSize {
  width: number
  height: number
}

/** canvas 调色板（亮 / 暗主题各一套，与 snake.css 的令牌保持一致） */
interface SnakeBoardPalette {
  board: string
  grid: string
  border: string
  food: string
  gold: string
  goldGlow: string
  eye: string
  eyeWhite: string
}

function paletteFor(dark: boolean): SnakeBoardPalette {
  return dark
    ? {
        board: '#0b1220',
        grid: 'rgba(240, 246, 252, 0.05)',
        border: '#30363d',
        food: '#f85149',
        gold: '#f5c518',
        goldGlow: 'rgba(245, 197, 24, 0.35)',
        eye: '#0b1220',
        eyeWhite: '#f0f6fc',
      }
    : {
        board: '#f6f8fa',
        grid: 'rgba(31, 35, 40, 0.07)',
        border: '#d1d9e0',
        food: '#cf222e',
        gold: '#b08800',
        goldGlow: 'rgba(176, 136, 0, 0.28)',
        eye: '#1f2328',
        eyeWhite: '#ffffff',
      }
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  size: BoardSize,
  layout: OnlineLayout,
  palette: SnakeBoardPalette
): void {
  const { cell } = layout
  const w = cell * size.width
  const h = cell * size.height
  ctx.fillStyle = palette.board
  ctx.fillRect(0, 0, w, h)

  ctx.strokeStyle = palette.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 1; i < size.width; i += 1) {
    const offset = Math.round(i * cell) + 0.5
    ctx.moveTo(offset, 0)
    ctx.lineTo(offset, h)
  }
  for (let j = 1; j < size.height; j += 1) {
    const offset = Math.round(j * cell) + 0.5
    ctx.moveTo(0, offset)
    ctx.lineTo(w, offset)
  }
  ctx.stroke()

  ctx.strokeStyle = palette.border
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1)
}

/** 果实：普通果圆点、金果带光晕脉动（服务端 DTO 坐标为整数格） */
function drawFoods(
  ctx: CanvasRenderingContext2D,
  match: GameSnakeMatch,
  layout: OnlineLayout,
  palette: SnakeBoardPalette,
  time: number
): void {
  const { cell } = layout
  for (const food of match.foods) {
    const cx = (food.x + 0.5) * cell
    const cy = (food.y + 0.5) * cell
    if (!food.big) {
      ctx.fillStyle = palette.food
      ctx.beginPath()
      ctx.arc(cx, cy, cell * 0.3, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    const pulse = 0.5 + 0.5 * Math.sin(time / 220)
    const glow = cell * (0.95 + pulse * 0.3)
    const gradient = ctx.createRadialGradient(cx, cy, cell * 0.2, cx, cy, glow)
    gradient.addColorStop(0, palette.goldGlow)
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(cx, cy, glow, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = palette.gold
    ctx.beginPath()
    ctx.arc(cx, cy, cell * (0.34 + pulse * 0.04), 0, Math.PI * 2)
    ctx.fill()
  }
}

/** 一条蛇（点为插值后的浮点网格坐标） */
function drawPlayerSnake(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  headDirection: SnakeDirection,
  color: string,
  alive: boolean,
  layout: OnlineLayout,
  palette: SnakeBoardPalette
): void {
  const { cell } = layout
  const inset = Math.max(0.5, cell * 0.1)
  ctx.globalAlpha = alive ? 1 : 0.5
  points.forEach((point, index) => {
    ctx.fillStyle = alive ? color : SNAKE_DEAD_COLOR
    ctx.globalAlpha = alive ? Math.max(0.6, 1 - index * 0.015) : 0.42
    roundRectPath(
      ctx,
      point.x * cell + inset,
      point.y * cell + inset,
      cell - inset * 2,
      cell - inset * 2,
      cell * 0.32
    )
    ctx.fill()
  })
  ctx.globalAlpha = 1

  const head = points[0]
  if (!head || !alive) return
  const delta = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }[
    headDirection
  ]
  const cx = (head.x + 0.5) * cell
  const cy = (head.y + 0.5) * cell
  for (const sign of [1, -1]) {
    const ex = cx + delta.x * cell * 0.18 - delta.y * cell * 0.16 * sign
    const ey = cy + delta.y * cell * 0.18 + delta.x * cell * 0.16 * sign
    ctx.fillStyle = palette.eyeWhite
    ctx.beginPath()
    ctx.arc(ex, ey, cell * 0.12, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = palette.eye
    ctx.beginPath()
    ctx.arc(ex + delta.x * cell * 0.03, ey + delta.y * cell * 0.03, cell * 0.06, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** 把服务端 body 与上一帧 body 做线性插值，得到平滑滑动坐标 */
function interpolateBody(
  from: SnakeCellDto[] | undefined,
  to: SnakeCellDto[],
  progress: number
): Array<{ x: number; y: number }> {
  if (!from || from.length === 0 || progress >= 1) return to.map((cell) => ({ x: cell.x, y: cell.y }))
  return to.map((cell, index) => {
    const prev = from[index] ?? cell
    return {
      x: prev.x + (cell.x - prev.x) * progress,
      y: prev.y + (cell.y - prev.y) * progress,
    }
  })
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
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

/**
 * 贪吃蛇大地图好友联机（2–8 人房间，服务端权威步进）：
 * - 无 matchId：先查进行中的对局（有则跳转），否则展示大厅（好友列表 + 邀请）。
 * - 有 matchId：等待房间 / 大地图对局 / 结算遮罩。
 * - WS 事件复用 /ws/chat 的 game:match:*（按 match.game === 'snake' 判别）；
 *   无 WebSocket 时按 GAME_POLL_INTERVALS 轮询 sync + presence 心跳降级。
 */
export default function SnakeOnlinePage() {
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

  const [match, setMatch] = useState<GameSnakeMatch | null>(null)
  const [matchLoading, setMatchLoading] = useState(matchId !== null)
  const [matchError, setMatchError] = useState<string | null>(null)
  const [friends, setFriends] = useState<GameFriend[]>([])
  const [friendsLoading, setFriendsLoading] = useState(matchId === null)
  const [friendsError, setFriendsError] = useState<string | null>(null)
  const [localIncoming, setLocalIncoming] = useState<GameInvite[]>([])
  const [localOutgoing, setLocalOutgoing] = useState<GameInvite[]>([])
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [turnPending, setTurnPending] = useState(false)

  const matchRef = useRef<GameSnakeMatch | null>(null)
  const matchIdRef = useRef<number | null>(matchId)
  const skipActiveCheckRef = useRef(false)
  const inFlightRef = useRef(false)
  const queuedDirectionRef = useRef<SnakeDirection | null>(null)
  const lastTurnAtRef = useRef(0)
  const performTurnRef = useRef<(direction: SnakeDirection) => void>(() => {})

  useEffect(() => {
    matchRef.current = match
  }, [match])

  useEffect(() => {
    matchIdRef.current = matchId
  }, [matchId])

  const applyMatch = useCallback((next: GameSnakeMatch) => {
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
        const data = await api.get<SnakeMatchResponse>(`${API_BASE}/matches/${id}`)
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

  /** 本页自己的贪吃蛇邀请列表（比全局 Context 更即时，也与其它游戏隔离） */
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
      .get<SnakeActiveMatchResponse>(`${API_BASE}/matches/active`)
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

  // WS：对局事件（与 2048 / 斗地主同名，按 game 判别）
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
      if (event.match.game !== 'snake') return
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

  // 轮询模式：每 2 秒拉一次 sync
  useEffect(() => {
    if (!user || !matchId || transport !== 'polling') return
    let disposed = false

    const poll = async () => {
      if (disposed) return
      if (matchRef.current?.status === 'finished') return
      try {
        const data = await api.get<SnakeSyncResponse>(`${API_BASE}/sync?matchId=${matchId}`)
        if (disposed || !data.match) return
        applyMatch(data.match)
        // sync 载荷里带本游戏的邀请，轮询模式下顺带刷新，等待房间也能看到新邀请
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

  // 大厅轮询模式下也要能看到邀请（Context 的 sync 不含贪吃蛇邀请）
  useEffect(() => {
    if (!user || matchId) return
    if (transport !== 'polling') return
    const timer = setInterval(() => void loadInvites(), GAME_POLL_INTERVALS.sync)
    return () => clearInterval(timer)
  }, [user, matchId, transport, loadInvites])

  // === 动作 ===

  const refreshMatch = useCallback(async () => {
    const id = matchIdRef.current
    if (!id) return
    try {
      const data = await api.get<SnakeMatchResponse>(`${API_BASE}/matches/${id}`)
      setMatch(data.match)
      setMatchError(null)
    } catch {
      // 保留当前棋盘，等待下一次同步
    }
  }, [])

  const performTurn = useCallback(
    async (direction: SnakeDirection) => {
      const id = matchIdRef.current
      if (!id) return
      const body: SnakeActionBody = { type: 'turn', direction }
      inFlightRef.current = true
      setTurnPending(true)
      try {
        const data = await api.post<SnakeMatchResponse>(`${API_BASE}/matches/${id}/actions`, body)
        setMatch(data.match)
        setActionError(null)
        if (data.match.status === 'finished') queuedDirectionRef.current = null
      } catch (err) {
        setActionError(errorMessage(err, '提交方向失败'))
        await refreshMatch()
      } finally {
        inFlightRef.current = false
        setTurnPending(false)
        const queued = queuedDirectionRef.current
        queuedDirectionRef.current = null
        if (queued && matchRef.current?.status === 'playing') performTurnRef.current(queued)
      }
    },
    [refreshMatch]
  )

  useEffect(() => {
    performTurnRef.current = (direction) => {
      void performTurn(direction)
    }
  }, [performTurn])

  const myPlayer = useMemo(
    () => match?.players.find((player) => player.userId === meId) ?? null,
    [match, meId]
  )

  const sendDirection = useCallback(
    (direction: SnakeDirection) => {
      const current = matchRef.current
      if (!current || current.status !== 'playing') return
      const me = current.players.find((player) => player.userId === meId)
      if (!me) return
      if (me.status !== 'playing') {
        setActionError('你已经出局，本局只能观战')
        return
      }
      const effective = me.pendingDirection ?? me.direction
      if (effective === direction) return
      if (isOppositeDirection(effective, direction)) {
        setActionError(`不能 180° 掉头（当前朝${CHINESE_DIRECTION[effective]}）`)
        return
      }
      // 连续按键限流：一步之内只认最后一次方向
      const now = Date.now()
      if (now - lastTurnAtRef.current < 80) return
      lastTurnAtRef.current = now
      if (inFlightRef.current) {
        queuedDirectionRef.current = direction
        return
      }
      void performTurn(direction)
    },
    [meId, performTurn]
  )

  // 键盘：对局中且自己存活时即时提交方向
  useEffect(() => {
    if (!matchId) return
    const enabled = myPlayer !== null && myPlayer.status === 'playing' && match?.status === 'playing'
    if (!enabled) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      const direction = KEY_MAP[event.key]
      if (!direction) return
      if (ARROW_KEYS.has(event.key)) event.preventDefault()
      sendDirection(direction)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [matchId, match?.status, myPlayer?.status, sendDirection, transport])

  const handleStart = useCallback(async () => {
    const id = matchIdRef.current
    if (!id) return
    setBusyKey('start')
    setActionError(null)
    try {
      const data = await api.post<SnakeMatchResponse>(`${API_BASE}/matches/${id}/start`)
      setMatch(data.match)
    } catch (err) {
      setActionError(errorMessage(err, '开始游戏失败'))
    } finally {
      setBusyKey(null)
    }
  }, [])

  const handleResign = useCallback(async () => {
    const id = matchIdRef.current
    const current = matchRef.current
    if (!id || !current || current.status !== 'playing') return
    if (!window.confirm('确定认输吗？你的蛇会立即出局，其他玩家继续。')) return
    setBusyKey('resign')
    setActionError(null)
    try {
      const data = await api.post<SnakeMatchResponse>(`${API_BASE}/matches/${id}/resign`)
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
        const data = await api.post<SnakeInviteResponse>(`${API_BASE}/invites`, { friendId })
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

  const handleCancelInvite = useCallback(
    async (inviteId: number) => {
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
    },
    []
  )

  const handleRespondInvite = useCallback(
    async (inviteId: number, action: 'accept' | 'decline') => {
      setBusyKey(`respond-${inviteId}`)
      setActionError(null)
      try {
        const data = await api.post<SnakeInviteRespondResponse>(
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

  /** 本页只处理贪吃蛇邀请：本页列表 + 全局 Context 列表（按 id 去重） */
  const pageIncomingInvites = useMemo(
    () =>
      dedupeInvites([
        ...localIncoming,
        ...incomingInvites.filter((invite) => invite.game === 'snake'),
      ]),
    [localIncoming, incomingInvites]
  )
  const pageOutgoingInvites = useMemo(
    () =>
      dedupeInvites([
        ...localOutgoing,
        ...outgoingInvites.filter((invite) => invite.game === 'snake'),
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
          : '轮询模式，约 2 秒延迟：对局状态每 2 秒同步一次，仍可正常对战。'}
      </span>
    </div>
  )

  if (!authLoading && !user) {
    return (
      <div className="gh-page-container gh-games-page gh-game-online-page">
        <section className="gh-snake-guest" aria-label="需要登录">
          <p className="gh-g2048-eyebrow">贪吃蛇 · 好友联机</p>
          <h1 className="gh-games-title">登录后即可邀请好友开黑</h1>
          <p className="gh-games-subtitle">
            大地图联机需要账号：好友关系、邀请与对局都以账号身份进行。不想登录也可以先玩单机或同屏双人。
          </p>
          <div className="gh-snake-guest-actions">
            <Link className="gh-btn gh-btn--primary gh-btn--md" to="/login">
              去登录
            </Link>
            <Link className="gh-btn gh-btn--secondary gh-btn--md" to="/register">
              注册账号
            </Link>
            <Link className="gh-btn gh-btn--ghost gh-btn--md" to={GAME_SNAKE_ROUTE}>
              单机 / 同屏双人
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
          <section className="gh-game-room" aria-label="贪吃蛇等待房间">
            <header className="gh-game-room-header">
              <div>
                <p className="gh-g2048-eyebrow">贪吃蛇大地图房间</p>
                <h1 className="gh-games-title">等待玩家加入</h1>
                <p className="gh-games-subtitle">
                  {MAX_PLAYERS} 人同框大地图混战：吃果变长、撞墙或撞别的蛇就出局，最后存活者获胜。
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
              <ul className="gh-snake-seat-list">
                {Array.from({ length: MAX_PLAYERS }, (_, seat) => {
                  const player = match.players[seat]
                  if (!player) {
                    return (
                      <li key={`empty-${seat}`} className="gh-snake-seat gh-snake-seat--empty">
                        <span
                          className="gh-snake-seat-swatch"
                          style={{ background: snakeColorForSeat(seat) }}
                          aria-hidden="true"
                        />
                        <span className="gh-snake-seat-name">空位 · {seat + 1} 号位</span>
                      </li>
                    )
                  }
                  const isMe = player.userId === meId
                  const isRoomHost = player.userId === match.hostId
                  return (
                    <li
                      key={player.userId}
                      className={`gh-snake-seat${isMe ? ' gh-snake-seat--me' : ''}`}
                    >
                      <span
                        className="gh-snake-seat-swatch"
                        style={{ background: snakeColorForSeat(player.colorIndex) }}
                        aria-hidden="true"
                      />
                      <UserAvatar userId={player.userId} username={player.username} size="md" />
                      <span className="gh-snake-seat-copy">
                        <span className="gh-snake-seat-name">
                          {player.username}
                          {isRoomHost && <span className="gh-game-room-badge">房主</span>}
                          {isMe && <span className="gh-game-room-badge gh-game-room-badge--me">你</span>}
                        </span>
                        <span className="gh-snake-seat-meta">
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
              房主开始后所有座位进入同一张 {match.board.width}×{match.board.height} 大地图，
              每步 {match.stepMs} 毫秒由服务端权威推进。
            </p>
          </section>
        </div>
      )
    }

    // === 对局 / 结算 ===
    return (
      <div className="gh-page-container gh-games-page gh-snake-online">
        <SnakeOnlineStage
          key={match.id}
          match={match}
          meId={meId}
          isHost={isHost}
          transport={transport}
          turnPending={turnPending}
          actionError={actionError ?? matchError}
          onDirection={sendDirection}
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
          <h1 className="gh-games-title">贪吃蛇 · 大地图好友联机</h1>
          <p className="gh-games-subtitle">
            邀请好友进 2–{MAX_PLAYERS} 人房间，房主开局后同框吃果：蛇越长越难回头，撞墙、撞别人的蛇都会出局，
            最后存活或时间到分数最高者获胜。
          </p>
        </div>
        <div className="gh-game-lobby-actions">
          <Link className="gh-btn gh-btn--secondary gh-btn--md" to={GAME_SNAKE_ROUTE}>
            单机 / 同屏双人
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

      <div className="gh-snake-lobby-tips">
        <h2 className="gh-snake-lobby-tips-title">房间规则</h2>
        <ul className="gh-snake-lobby-tips-list">
          <li>房间 2–{MAX_PLAYERS} 人，房主点击开始后统一进入大地图；座位号决定蛇的配色。</li>
          <li>方向即时提交给服务端，禁止 180° 掉头；服务端每步推进一次，客户端只做渲染。</li>
          <li>撞墙、撞别的蛇身、时间耗尽都会出局；认输只让自己退出，其他人继续。</li>
          <li>掉线超过判定时间会被判负，轮询模式同样可以正常对局（约 2 秒延迟）。</li>
        </ul>
      </div>

      <p className="gh-games-footnote">
        对局为服务端权威判定：客户端只发送方向与认输，吃果、碰撞与结算全部在服务端完成。
      </p>
    </div>
  )
}

const CHINESE_DIRECTION: Record<SnakeDirection, string> = {
  up: '上',
  down: '下',
  left: '左',
  right: '右',
}

// ==================== 对局舞台 ====================

interface SnakeOnlineStageProps {
  match: GameSnakeMatch
  meId: number
  isHost: boolean
  transport: 'ws' | 'polling'
  turnPending: boolean
  actionError: string | null
  resignBusy: boolean
  onDirection: (direction: SnakeDirection) => void
  onResign: () => void
  onBackToLobby: () => void
}

/**
 * 对局视图：大地图 canvas（按 version 更新 + 逐格插值动画）、侧栏计分板、
 * 移动端四向按钮、结算遮罩。倒计时直接用服务端 DTO 的 remainingMs。
 */
function SnakeOnlineStage({
  match,
  meId,
  isHost,
  transport,
  turnPending,
  actionError,
  resignBusy,
  onDirection,
  onResign,
  onBackToLobby,
}: SnakeOnlineStageProps) {
  const { resolvedTheme } = useTheme()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const layoutRef = useRef<OnlineLayout>({ cssWidth: 320, cssHeight: 320, cell: 8, dpr: 1 })
  /** 上一个版本的目标坐标（本次补间的起点） */
  const fromRef = useRef<Map<number, SnakeCellDto[]>>(new Map())
  /** 当前版本的目标坐标 */
  const targetRef = useRef<Map<number, SnakeCellDto[]>>(new Map())
  const renderedVersionRef = useRef<number>(-1)
  const transitionRef = useRef<{ start: number; duration: number }>({ start: 0, duration: 150 })
  const matchRef = useRef<GameSnakeMatch>(match)
  matchRef.current = match
  const darkRef = useRef(resolvedTheme === 'dark')
  darkRef.current = resolvedTheme === 'dark'

  // 尺寸自适应（大地图按容器宽度换算格子边长）
  useEffect(() => {
    const measure = () => {
      const stage = stageRef.current
      const canvas = canvasRef.current
      if (!stage || !canvas) return
      const board = matchRef.current.board
      const available = Math.max(220, Math.floor(stage.clientWidth || 320))
      const maxHeight = Math.max(220, Math.min(620, Math.floor(window.innerHeight * 0.62)))
      const cell = Math.max(4, Math.floor(Math.min(available / board.width, maxHeight / board.height)))
      const cssWidth = cell * board.width
      const cssHeight = cell * board.height
      const dpr = Math.min(3, Math.max(1, Math.round((window.devicePixelRatio || 1) * 100) / 100))
      layoutRef.current = { cssWidth, cssHeight, cell, dpr }
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`
      canvas.width = Math.round(cssWidth * dpr)
      canvas.height = Math.round(cssHeight * dpr)
    }

    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      if (stageRef.current) observer.observe(stageRef.current)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [match.board.width, match.board.height])

  // 逐帧重绘：版本变化时开启一次补间，时长取服务端 stepMs
  useEffect(() => {
    let raf = 0
    const frame = (time: number) => {
      raf = requestAnimationFrame(frame)
      const current = matchRef.current
      const canvas = canvasRef.current
      if (!canvas) return

      if (renderedVersionRef.current !== current.version) {
        // 起点 = 上一个版本的目标坐标；每条蛇每步只前进一格，逐段补间最自然
        fromRef.current = targetRef.current
        targetRef.current = new Map(
          current.players.map((player) => [player.userId, player.body])
        )
        transitionRef.current = {
          start: time,
          duration: Math.max(60, Math.min(current.stepMs * 1.1, 420)),
        }
        renderedVersionRef.current = current.version
      }

      const layout = layoutRef.current
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(layout.dpr, 0, 0, layout.dpr, 0, 0)
      ctx.clearRect(0, 0, layout.cssWidth, layout.cssHeight)

      const palette = paletteFor(darkRef.current)
      drawBackground(ctx, current.board, layout, palette)
      drawFoods(ctx, current, layout, palette, time)

      const elapsed = time - transitionRef.current.start
      const progress =
        current.status === 'playing'
          ? Math.max(0, Math.min(1, elapsed / transitionRef.current.duration))
          : 1

      for (const player of current.players) {
        if (player.body.length === 0) continue
        const points =
          player.status === 'playing'
            ? interpolateBody(fromRef.current.get(player.userId), player.body, progress)
            : player.body.map((cell) => ({ x: cell.x, y: cell.y }))
        drawPlayerSnake(
          ctx,
          points,
          player.direction,
          snakeColorForSeat(player.colorIndex),
          player.status === 'playing',
          layout,
          palette
        )
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  const playing = match.status === 'playing'
  const remainingSeconds = Math.max(0, Math.ceil(match.remainingMs / 1000))
  const winner = match.players.find((player) => player.userId === match.winnerId) ?? null
  const iAmAlive = myStatusOf(match, meId) === 'playing'
  const ranked = [...match.players].sort((a, b) => b.score - a.score || b.length - a.length)

  const boardLabel = playing
    ? `贪吃蛇大地图，${match.board.width} 乘 ${match.board.height} 格，第 ${match.step} 步，剩余 ${remainingSeconds} 秒。${match.players
        .map((player) => `${player.username} ${player.score} 分 ${player.length} 节${player.status === 'playing' ? '存活' : '已出局'}`)
        .join('；')}`
    : `贪吃蛇大地图对局结束。${winner ? `获胜者 ${winner.username}` : '没有赢家'}。${ranked
        .map((player) => `${player.username} ${player.score} 分`)
        .join('；')}`

  return (
    <>
      <header className="gh-snake-online-header">
        <div className="gh-snake-online-heading">
          <p className="gh-g2048-eyebrow">
            <Link to={LOBBY_PATH}>← 贪吃蛇联机大厅</Link>
          </p>
          <h1 className="gh-games-title">
            贪吃蛇 · 大地图对战
            <span className={`gh-game-conn-chip gh-game-conn-chip--${transport}`}>
              {transport === 'ws' ? '实时' : '轮询'}
            </span>
          </h1>
          <p className="gh-games-subtitle">
            {match.board.width}×{match.board.height} 地图 · 每步 {match.stepMs} 毫秒 · 第 {match.step} 步
            {playing ? ` · 剩余 ${remainingSeconds} 秒` : ''}
            {transport === 'polling' ? ' · 轮询模式，约 2 秒延迟' : ''}
          </p>
        </div>
        <div className="gh-snake-online-actions">
          {playing && (
            <button
              type="button"
              className="gh-btn gh-btn--danger gh-btn--sm"
              onClick={onResign}
              disabled={resignBusy || !iAmAlive}
              title={iAmAlive ? '认输退出本局' : '你已经出局'}
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

      {transport === 'polling' && playing && (
        <p className="gh-snake-polling-hint" role="status">
          当前为轮询模式，对局状态约 2 秒同步一次；方向提交仍然即时生效。
        </p>
      )}

      <div className="gh-snake-online-body">
        <div className="gh-snake-online-main">
          <div className="gh-snake-online-stage" ref={stageRef}>
            <canvas
              ref={canvasRef}
              className="gh-snake-canvas gh-snake-canvas--online"
              role="img"
              aria-label={boardLabel}
            />
            {match.status === 'finished' && (
              <div className="gh-snake-overlay" role="dialog" aria-modal="true" aria-label="对局结算">
                <div className="gh-snake-overlay-card">
                  <p className="gh-snake-overlay-eyebrow">大地图对战结束</p>
                  <h2
                    className={[
                      'gh-snake-overlay-title',
                      winner && winner.userId === meId ? 'gh-snake-overlay-title--win' : '',
                      winner === null ? 'gh-snake-overlay-title--draw' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {winner ? `${winner.username} 获胜` : '本局没有赢家'}
                  </h2>
                  <p className="gh-snake-overlay-detail">
                    {match.reason ? END_REASON_LABELS[match.reason] : '本局已结束'}
                  </p>
                  <ol className="gh-snake-result-ranks">
                    {ranked.map((player, index) => (
                      <li key={player.userId}>
                        <span
                          className="gh-snake-swatch"
                          style={{ background: snakeColorForSeat(player.colorIndex) }}
                          aria-hidden="true"
                        />
                        <span className="gh-snake-result-rank">
                          {index + 1}. {player.username}
                          {player.userId === meId ? '（你）' : ''}
                        </span>
                        <strong>{player.score}</strong>
                        <span className="gh-snake-result-meta">
                          {player.length} 节 ·{' '}
                          {player.status === 'playing' ? '存活到终局' : `第 ${player.deathStep ?? '-'} 步出局`}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <div className="gh-snake-overlay-actions">
                    <button type="button" className="gh-btn gh-btn--primary gh-btn--lg" onClick={onBackToLobby}>
                      {isHost ? '回大厅再开一局' : '返回大厅'}
                    </button>
                    <Link className="gh-btn gh-btn--secondary gh-btn--lg" to={GAME_SNAKE_ROUTE}>
                      单机练习
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>

          {playing && (
            <div className="gh-snake-dpad" aria-label="方向按钮（触屏可用）">
              {(['up', 'left', 'down', 'right'] as SnakeDirection[]).map((direction) => (
                <button
                  key={direction}
                  type="button"
                  className={`gh-snake-dpad-btn gh-snake-dpad-btn--${direction}`}
                  onClick={() => onDirection(direction)}
                  disabled={!iAmAlive || turnPending}
                  aria-label={`向${CHINESE_DIRECTION[direction]}移动`}
                >
                  {direction === 'up' ? '↑' : direction === 'down' ? '↓' : direction === 'left' ? '←' : '→'}
                </button>
              ))}
              <span className="gh-snake-dpad-hint">
                键盘方向键 / WASD 更快；掉头请求会被服务端拒绝（当前朝
                {CHINESE_DIRECTION[myDirectionOf(match, meId)]}）
              </span>
            </div>
          )}
        </div>

        <aside className="gh-snake-scoreboard" aria-label="计分板">
          <h2 className="gh-snake-scoreboard-title">计分板</h2>
          {playing ? (
            <p className="gh-snake-scoreboard-countdown" role="status">
              剩余 <strong>{remainingSeconds}</strong> 秒
            </p>
          ) : (
            <p className="gh-snake-scoreboard-countdown">
              {match.status === 'finished' ? '本局已结束' : '等待开始'}
            </p>
          )}
          <ul className="gh-snake-scoreboard-list">
            {ranked.map((player) => (
              <li
                key={player.userId}
                className={[
                  'gh-snake-scoreboard-row',
                  player.status === 'playing' ? '' : 'gh-snake-scoreboard-row--out',
                  player.userId === meId ? 'gh-snake-scoreboard-row--me' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span
                  className="gh-snake-swatch"
                  style={{
                    background:
                      player.status === 'playing'
                        ? snakeColorForSeat(player.colorIndex)
                        : SNAKE_DEAD_COLOR,
                  }}
                  aria-hidden="true"
                />
                <span className="gh-snake-scoreboard-copy">
                  <span className="gh-snake-scoreboard-name">
                    {player.username}
                    {player.userId === meId && <span className="gh-game-room-badge gh-game-room-badge--me">你</span>}
                    {player.userId === match.hostId && <span className="gh-game-room-badge">房主</span>}
                  </span>
                  <span className="gh-snake-scoreboard-meta">
                    <span
                      className={`gh-game-presence-dot${player.online ? ' gh-game-presence-dot--online' : ''}`}
                    />
                    {player.online ? '在线' : '离线'} ·{' '}
                    {player.status === 'playing'
                      ? `蛇长 ${player.length}`
                      : `第 ${player.deathStep ?? '?'} 步出局`}
                  </span>
                </span>
                <strong className="gh-snake-scoreboard-score">{player.score}</strong>
              </li>
            ))}
          </ul>
          {match.lastEvent && (
            <p className="gh-snake-last-event" role="status">
              {match.lastEvent.kind === 'eat' ? '吃到果实' : '撞线出局'}：
              {nameOf(match, match.lastEvent.userId)}（第 {match.lastEvent.step} 步）
            </p>
          )}
          <p className="gh-snake-scoreboard-foot">
            地图由服务端权威推进，本端只提交方向；蛇越长越难回头，卡住自己的死角前先看一眼计分板。
          </p>
        </aside>
      </div>
    </>
  )
}

function myStatusOf(match: GameSnakeMatch, meId: number): GameSnakePlayer['status'] | null {
  return match.players.find((player) => player.userId === meId)?.status ?? null
}

function myDirectionOf(match: GameSnakeMatch, meId: number): SnakeDirection {
  const me = match.players.find((player) => player.userId === meId)
  return me?.pendingDirection ?? me?.direction ?? 'right'
}

function nameOf(match: GameSnakeMatch, userId: number): string {
  return match.players.find((player) => player.userId === userId)?.username ?? '某位玩家'
}
