import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
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
  JUMP_ISO_RATIO,
  JUMP_LANDING_TEXT,
  JUMP_MAX_CHARGE_MS,
  JUMP_MAX_DISTANCE,
  JUMP_MAX_PLAYERS,
  JUMP_MIN_PLAYERS,
  jumpArcLift,
  jumpAxisOfBox,
  jumpBoxColors,
  jumpColorForSeat,
  jumpDistance,
  jumpFlightMs,
  jumpIso,
  jumpLandingAxis,
  jumpPowerRatio,
  jumpSquash,
  formatJumpBroadcast,
  formatJumpOffset,
} from '../../lib/games/jump'
import { GAME_JUMP_ONLINE_ROUTE, GAME_JUMP_ROUTE } from '../../lib/games/catalog'
import type {
  GameFriend,
  GameFriendsResponse,
  GameInvite,
  GameInvitesResponse,
  GameJumpEndReason,
  GameJumpMatch,
  GameJumpPlayer,
  JumpActionBody,
  JumpBoxDto,
  JumpLanding as JumpLandingDto,
  JumpMatchResponse,
  JumpActiveMatchResponse,
  JumpSyncResponse,
} from '../../types/game'

/** 服务端前缀：与 2048 / 斗地主 / 贪吃蛇 / 扫雷完全同构 */
const API_BASE = '/games/jump'
const LOBBY_PATH = GAME_JUMP_ONLINE_ROUTE

/** 提交跳跃后的兜底解锁时间（毫秒）：漏事件时不至于永久卡住蓄力 */
const ACTION_LOCK_FALLBACK_MS = 10_000
/** 坠落动画时长 */
const FALL_MS = 760
/** 落地灰尘存活时间 */
const DUST_MS = 520
/** 镜头锚点（角色停在画面偏左位置） */
const CAMERA_ANCHOR_X = 0.38
const BASE_LINE_Y = 0.7
const VIEW_LOGICAL_SPAN = 470
const MIN_SCALE = 0.5
const MAX_SCALE = 1.35

/** 邀请端点响应（match 为跳一跳 DTO，types/game.ts 的通用类型按 2048 声明，这里本地收窄） */
interface JumpInviteResponse {
  invite: GameInvite
  match?: GameJumpMatch
}
interface JumpInviteRespondResponse {
  ok: boolean
  match?: GameJumpMatch
}

const END_REASON_LABELS: Record<GameJumpEndReason, string> = {
  last_standing: '其他玩家都已掉出盒子，你是最后站着的',
  elimination: '全员出局，按最终分数结算',
  timeout: '时长到，按当前分数结算',
  resign: '有玩家认输，本局提前结束',
  forfeit: '有玩家掉线或回合超时，被自动跳过并判负',
  cancelled: '房间已解散',
}

const STATUS_LABELS: Record<GameJumpPlayer['status'], string> = {
  waiting: '等待中',
  playing: '对局中',
  won: '获胜',
  lost: '掉出盒子',
}

interface JumpLayout {
  cssWidth: number
  cssHeight: number
  scale: number
  dpr: number
}

/** 一名玩家的动画（滞空 / 坠落） */
type JumpRenderAnim =
  | { kind: 'none' }
  | {
      kind: 'fly'
      start: number
      duration: number
      fromAxis: number
      toAxis: number
      distance: number
      landing: JumpLandingDto
      gained: number
      username: string
    }
  | { kind: 'fall'; start: number; axis: number; drift: number }

interface JumpParticle {
  axis: number
  lift: number
  vAxis: number
  vLift: number
  born: number
  life: number
  r: number
}

interface JumpFloatText {
  text: string
  axis: number
  lift: number
  born: number
  color: string
  username?: string
}

interface JumpRing {
  axis: number
  size: number
  born: number
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

function playerOf(match: GameJumpMatch, userId: number): GameJumpPlayer | null {
  return match.players.find((player) => player.userId === userId) ?? null
}

function nameOf(match: GameJumpMatch, userId: number): string {
  return match.players.find((player) => player.userId === userId)?.username ?? '某位玩家'
}

function seatOf(match: GameJumpMatch, userId: number): number {
  const index = match.players.findIndex((player) => player.userId === userId)
  return index < 0 ? 0 : index
}

/** 播报上一次跳跃结果（五种 JumpLanding 都有中文文案） */
function broadcastText(match: GameJumpMatch): string | null {
  const last = match.lastResult
  if (!last) return null
  return formatJumpBroadcast(nameOf(match, last.userId), last)
}

// ==================== 程序化绘制（与单机页同一套等距视觉语言） ====================

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

function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  layout: JumpLayout,
  dark: boolean,
  camAxis: number
): void {
  const { cssWidth, cssHeight } = layout
  const gradient = ctx.createLinearGradient(0, 0, 0, cssHeight)
  if (dark) {
    gradient.addColorStop(0, '#0b1220')
    gradient.addColorStop(0.62, '#131c2c')
    gradient.addColorStop(1, '#1b2536')
  } else {
    gradient.addColorStop(0, '#eef4fb')
    gradient.addColorStop(0.62, '#f6f8fa')
    gradient.addColorStop(1, '#e9eef5')
  }
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, cssWidth, cssHeight)

  const step = 58 * layout.scale
  const slide = ((camAxis * layout.scale) % step + step) % step
  ctx.lineWidth = 1
  ctx.strokeStyle = dark ? 'rgba(240, 246, 252, 0.045)' : 'rgba(31, 35, 40, 0.055)'
  ctx.beginPath()
  for (let i = -2; i < cssWidth / step + 2; i += 1) {
    const x = i * step - slide
    ctx.moveTo(x, 0)
    ctx.lineTo(x + cssHeight * JUMP_ISO_RATIO, cssHeight)
  }
  for (let j = 1; j < 5; j += 1) {
    const y = (cssHeight / 5) * j
    ctx.moveTo(0, y)
    ctx.lineTo(cssWidth, y)
  }
  ctx.stroke()
}

function drawJumpBox(
  ctx: CanvasRenderingContext2D,
  box: JumpBoxDto,
  sx: number,
  sy: number,
  scale: number,
  dark: boolean,
  highlight: boolean
): void {
  const half = box.size * scale
  const depth = half * JUMP_ISO_RATIO
  const body = Math.max(12, box.size * 1.5) * scale
  const colors = jumpBoxColors(box.index, dark)

  if (box.kind === 'cylinder') {
    ctx.fillStyle = colors.right
    ctx.beginPath()
    ctx.moveTo(sx - half, sy)
    ctx.lineTo(sx - half, sy + body)
    ctx.ellipse(sx, sy + body, half, depth, 0, Math.PI, 0, true)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = colors.top
    ctx.beginPath()
    ctx.ellipse(sx, sy, half, depth, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = colors.edge
    ctx.lineWidth = 1
    ctx.stroke()
  } else {
    ctx.fillStyle = colors.left
    ctx.beginPath()
    ctx.moveTo(sx - half, sy)
    ctx.lineTo(sx, sy + depth)
    ctx.lineTo(sx, sy + depth + body)
    ctx.lineTo(sx - half, sy + body)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = colors.right
    ctx.beginPath()
    ctx.moveTo(sx + half, sy)
    ctx.lineTo(sx, sy + depth)
    ctx.lineTo(sx, sy + depth + body)
    ctx.lineTo(sx + half, sy + body)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = colors.top
    ctx.beginPath()
    ctx.moveTo(sx, sy - depth)
    ctx.lineTo(sx + half, sy)
    ctx.lineTo(sx, sy + depth)
    ctx.lineTo(sx - half, sy)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = colors.edge
    ctx.lineWidth = 1
    ctx.stroke()
  }

  // 当前回合玩家所在盒：把靶心涂亮一点
  if (highlight) {
    ctx.save()
    ctx.globalAlpha = 0.75
    ctx.strokeStyle = dark ? '#f5c518' : '#b08800'
    ctx.lineWidth = 2
    ctx.beginPath()
    if (box.kind === 'cylinder') {
      ctx.ellipse(sx, sy, half * 0.32, depth * 0.32, 0, 0, Math.PI * 2)
    } else {
      ctx.moveTo(sx, sy - depth * 0.32)
      ctx.lineTo(sx + half * 0.32, sy)
      ctx.lineTo(sx, sy + depth * 0.32)
      ctx.lineTo(sx - half * 0.32, sy)
      ctx.closePath()
    }
    ctx.stroke()
    ctx.restore()
  }
}

function drawCharacter(
  ctx: CanvasRenderingContext2D,
  footX: number,
  footY: number,
  scale: number,
  color: string,
  opts: { squash: number; rotate: number; alpha: number; shadowAlpha: number; crown: string | null }
): void {
  const w = 21 * scale
  const h = 33 * scale
  const scaleX = 1 + opts.squash * 0.55
  const scaleY = 1 - opts.squash

  if (opts.shadowAlpha > 0) {
    ctx.save()
    ctx.globalAlpha = opts.shadowAlpha
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)'
    ctx.beginPath()
    ctx.ellipse(footX, footY + 2 * scale, w * 0.52, w * 0.2, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  ctx.save()
  ctx.globalAlpha = opts.alpha
  ctx.translate(footX, footY)
  if (opts.rotate !== 0) ctx.rotate(opts.rotate)
  ctx.scale(scaleX, scaleY)

  ctx.fillStyle = color
  roundRectPath(ctx, -w * 0.36, -h * 0.3, w * 0.26, h * 0.3, w * 0.08)
  ctx.fill()
  roundRectPath(ctx, w * 0.1, -h * 0.3, w * 0.26, h * 0.3, w * 0.08)
  ctx.fill()
  roundRectPath(ctx, -w * 0.46, -h * 0.82, w * 0.92, h * 0.55, w * 0.2)
  ctx.fill()
  roundRectPath(ctx, -w * 0.34, -h, w * 0.68, h * 0.24, w * 0.14)
  ctx.fill()

  ctx.fillStyle = '#ffffff'
  const eyeY = -h * 0.88
  ctx.beginPath()
  ctx.arc(-w * 0.13, eyeY, w * 0.09, 0, Math.PI * 2)
  ctx.arc(w * 0.13, eyeY, w * 0.09, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#1f2328'
  ctx.beginPath()
  ctx.arc(-w * 0.11, eyeY, w * 0.042, 0, Math.PI * 2)
  ctx.arc(w * 0.15, eyeY, w * 0.042, 0, Math.PI * 2)
  ctx.fill()

  // 回合中标记：头顶一个小三角
  if (opts.crown) {
    ctx.fillStyle = opts.crown
    ctx.beginPath()
    ctx.moveTo(0, -h - 8 * scale)
    ctx.lineTo(6 * scale, -h - 1 * scale)
    ctx.lineTo(-6 * scale, -h - 1 * scale)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

// ==================== 页面 ====================

/**
 * 跳一跳好友轮流对战（2–6 人）：
 * - 无 matchId：先查进行中的对局（有则跳转），否则展示大厅（好友列表 + 邀请）。
 * - 有 matchId：等待房间 / 轮流对局 / 结算遮罩。
 * - 得分与落点全部由服务端权威判定（客户端只提交本地测量的 chargeMs）；
 *   同一条盒子路线由服务端按 seed 生成，与引擎 createJumpCourse 同一算法。
 * - WS 事件复用 /ws/chat 的 game:match:*（按 match.game === 'jump' 判别）；
 *   无 WebSocket 时按 GAME_POLL_INTERVALS 轮询 sync + presence 心跳降级。
 */
export default function JumpOnlinePage() {
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

  const [match, setMatch] = useState<GameJumpMatch | null>(null)
  const [matchLoading, setMatchLoading] = useState(matchId !== null)
  const [matchError, setMatchError] = useState<string | null>(null)
  const [friends, setFriends] = useState<GameFriend[]>([])
  const [friendsLoading, setFriendsLoading] = useState(matchId === null)
  const [friendsError, setFriendsError] = useState<string | null>(null)
  const [localIncoming, setLocalIncoming] = useState<GameInvite[]>([])
  const [localOutgoing, setLocalOutgoing] = useState<GameInvite[]>([])
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [actionPending, setActionPending] = useState(false)
  const [lockVersion, setLockVersion] = useState<number | null>(null)
  const [nowTick, setNowTick] = useState(0)

  const matchRef = useRef<GameJumpMatch | null>(null)
  const matchIdRef = useRef<number | null>(matchId)
  const skipActiveCheckRef = useRef(false)
  const inFlightRef = useRef(false)
  /** 服务端与本地时钟的偏移（用 sync 的 serverTime 校准，回合倒计时更准） */
  const clockOffsetRef = useRef(0)

  useEffect(() => {
    matchRef.current = match
  }, [match])

  useEffect(() => {
    matchIdRef.current = matchId
  }, [matchId])

  const applyMatch = useCallback((next: GameJumpMatch) => {
    setMatchError(null)
    setMatch((prev) => {
      if (!prev) return next
      if (next.id !== prev.id) return next
      // 只接受更新版本，避免乱序响应把对局回退
      if (next.version <= prev.version) return prev
      return next
    })
  }, [])

  const loadMatch = useCallback(
    async (id: number, force = false) => {
      try {
        const data = await api.get<JumpMatchResponse>(`${API_BASE}/matches/${id}`)
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

  /** 本页自己的跳一跳邀请列表（比全局 Context 更即时，也与其他游戏隔离） */
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
      .get<JumpActiveMatchResponse>(`${API_BASE}/matches/active`)
      .then((data) => {
        if (cancelled) return
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

  // WS：对局事件（与其它游戏同名，按 match.game === 'jump' 判别）
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
      if (event.match.game !== 'jump') return
      if (event.match.id !== matchId) return
      applyMatch(event.match)
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
        const data = await api.get<JumpSyncResponse>(`${API_BASE}/sync?matchId=${matchId}`)
        if (disposed) return
        const serverTime = Date.parse(data.serverTime)
        if (Number.isFinite(serverTime)) clockOffsetRef.current = serverTime - Date.now()
        if (!data.match) return
        applyMatch(data.match)
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

  // 大厅轮询模式下也要能看到邀请（Context 的 sync 不含跳一跳邀请）
  useEffect(() => {
    if (!user || matchId) return
    if (transport !== 'polling') return
    const timer = setInterval(() => void loadInvites(), GAME_POLL_INTERVALS.sync)
    return () => clearInterval(timer)
  }, [user, matchId, transport, loadInvites])

  // WS 模式：进对局时单独拉一次 sync 估算与服务端的时差（回合倒计时用 deadline 校准）
  useEffect(() => {
    if (!user || !matchId || transport !== 'ws') return
    let cancelled = false
    api
      .get<JumpSyncResponse>(`${API_BASE}/sync?matchId=${matchId}`)
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

  // 提交后兜底解锁：版本前进即解锁，另有超时保护
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
      const data = await api.get<JumpMatchResponse>(`${API_BASE}/matches/${id}`)
      setMatch(data.match)
      setMatchError(null)
    } catch {
      // 保留当前状态，等待下一次同步
    }
  }, [])

  /** 松手即提交：chargeMs 由客户端 performance.now() 差值测量后钳制到 1–2000 */
  const submitJump = useCallback(
    async (chargeMs: number) => {
      const id = matchIdRef.current
      const current = matchRef.current
      if (!id || !current || current.status !== 'playing') return
      const clamped = Math.max(1, Math.min(JUMP_MAX_CHARGE_MS, Math.round(chargeMs)))
      const body: JumpActionBody = { type: 'jump', chargeMs: clamped }
      inFlightRef.current = true
      setActionPending(true)
      try {
        const data = await api.post<JumpMatchResponse>(`${API_BASE}/matches/${id}/actions`, body)
        setMatch(data.match)
        setLockVersion(data.match.version)
        setActionError(null)
      } catch (err) {
        setActionError(errorMessage(err, '提交跳跃失败，已重新同步对局'))
        setLockVersion(null)
        await refreshMatch()
      } finally {
        inFlightRef.current = false
        setActionPending(false)
      }
    },
    [refreshMatch]
  )

  const handleStart = useCallback(async () => {
    const id = matchIdRef.current
    if (!id) return
    setBusyKey('start')
    setActionError(null)
    try {
      const data = await api.post<JumpMatchResponse>(`${API_BASE}/matches/${id}/start`)
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
    if (!window.confirm('确定认输吗？本局你会记为出局，其他玩家继续。')) return
    setBusyKey('resign')
    setActionError(null)
    try {
      const data = await api.post<JumpMatchResponse>(`${API_BASE}/matches/${id}/resign`)
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
        const data = await api.post<JumpInviteResponse>(`${API_BASE}/invites`, { friendId })
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
        const data = await api.post<JumpInviteRespondResponse>(
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

  /** 本页只处理跳一跳邀请：本页列表 + 全局 Context 列表（按 id 去重） */
  const pageIncomingInvites = useMemo(
    () =>
      dedupeInvites([...localIncoming, ...incomingInvites.filter((invite) => invite.game === 'jump')]),
    [localIncoming, incomingInvites]
  )
  const pageOutgoingInvites = useMemo(
    () =>
      dedupeInvites([...localOutgoing, ...outgoingInvites.filter((invite) => invite.game === 'jump')]),
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
          : '轮询模式，约 2 秒延迟：对局状态每 2 秒同步一次，仍可正常轮流跳。'}
      </span>
    </div>
  )

  if (!authLoading && !user) {
    return (
      <div className="gh-page-container gh-games-page gh-game-online-page">
        <section className="gh-jump-guest" aria-label="需要登录">
          <p className="gh-g2048-eyebrow">跳一跳 · 好友轮流</p>
          <h1 className="gh-games-title">登录后即可邀请好友轮流跳</h1>
          <p className="gh-games-subtitle">
            联机需要账号：好友关系、邀请与对局都以账号身份进行。不想登录也可以先玩单机冲分。
          </p>
          <div className="gh-jump-guest-actions">
            <Link className="gh-btn gh-btn--primary gh-btn--md" to="/login">
              去登录
            </Link>
            <Link className="gh-btn gh-btn--secondary gh-btn--md" to="/register">
              注册账号
            </Link>
            <Link className="gh-btn gh-btn--ghost gh-btn--md" to={GAME_JUMP_ROUTE}>
              单机跳一跳
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
          <section className="gh-game-room" aria-label="跳一跳等待房间">
            <header className="gh-game-room-header">
              <div>
                <p className="gh-g2048-eyebrow">跳一跳轮流房间</p>
                <h1 className="gh-games-title">等待玩家加入</h1>
                <p className="gh-games-subtitle">
                  同一条盒子路线，轮流各跳一次：落在盒面 +1，正中靶心连击翻倍，掉出盒子即出局，
                  最后按分数与存活定胜负。
                </p>
              </div>
              <span className="gh-game-room-count">
                {playerCount}/{JUMP_MAX_PLAYERS}
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
                  disabled={playerCount < JUMP_MIN_PLAYERS || busyKey === 'start'}
                >
                  {busyKey === 'start' ? '正在开始…' : `开始对局（${playerCount}/${JUMP_MAX_PLAYERS}）`}
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

            {isHost && playerCount < JUMP_MIN_PLAYERS && (
              <p className="gh-game-room-hint">
                至少 {JUMP_MIN_PLAYERS} 人才能开始，先邀请好友进来吧。
              </p>
            )}

            <section className="gh-game-room-players" aria-label="房间座位">
              <h2 className="gh-game-room-section-title">
                座位（{playerCount}/{JUMP_MAX_PLAYERS}）
              </h2>
              <ul className="gh-jump-seat-list">
                {Array.from({ length: JUMP_MAX_PLAYERS }, (_, seat) => {
                  const player = match.players[seat]
                  if (!player) {
                    return (
                      <li key={`empty-${seat}`} className="gh-jump-seat gh-jump-seat--empty">
                        <span
                          className="gh-jump-seat-swatch"
                          style={{ background: jumpColorForSeat(seat) }}
                          aria-hidden="true"
                        />
                        <span className="gh-jump-seat-name">空位 · {seat + 1} 号位</span>
                      </li>
                    )
                  }
                  const isMe = player.userId === meId
                  const isRoomHost = player.userId === match.hostId
                  return (
                    <li key={player.userId} className={`gh-jump-seat${isMe ? ' gh-jump-seat--me' : ''}`}>
                      <span
                        className="gh-jump-seat-swatch"
                        style={{ background: jumpColorForSeat(seat) }}
                        aria-hidden="true"
                      />
                      <UserAvatar userId={player.userId} username={player.username} size="md" />
                      <span className="gh-jump-seat-copy">
                        <span className="gh-jump-seat-name">
                          {player.username}
                          {isRoomHost && <span className="gh-game-room-badge">房主</span>}
                          {isMe && <span className="gh-game-room-badge gh-game-room-badge--me">你</span>}
                        </span>
                        <span className="gh-jump-seat-meta">
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
              {playerCount >= JUMP_MAX_PLAYERS ? (
                <p className="gh-game-room-hint">
                  房间已满（{JUMP_MAX_PLAYERS} 人），不能再邀请。
                </p>
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
              盒子路线由服务端按同一套常量（间距 60–150、半宽 26–36）一次生成，所有玩家看到的是同一条路线。
            </p>
          </section>
        </div>
      )
    }

    // === 对局 / 结算 ===
    return (
      <div className="gh-page-container gh-games-page gh-jump-online">
        <JumpOnlineStage
          key={match.id}
          match={match}
          meId={meId}
          isHost={isHost}
          transport={transport}
          actionBusy={actionPending || lockVersion === match.version}
          turnRemainingMs={turnRemainingMs}
          actionError={actionError ?? matchError}
          onChargeMs={submitJump}
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
          <h1 className="gh-games-title">跳一跳 · 好友轮流跳</h1>
          <p className="gh-games-subtitle">
            邀请好友进 {JUMP_MIN_PLAYERS}–{JUMP_MAX_PLAYERS} 人房间，同一条盒子路线轮流各跳一次：
            蓄力时长在本地测量后提交，落点与得分由服务端权威判定，掉出盒子即出局。
          </p>
        </div>
        <div className="gh-jump-header-actions">
          <Link className="gh-btn gh-btn--secondary gh-btn--md" to={GAME_JUMP_ROUTE}>
            单机跳一跳
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
        <p className="gh-game-highlight-hint">已从聊天页跳转：向高亮好友发送邀请即可开局。</p>
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

      <div className="gh-jump-lobby-tips">
        <h2 className="gh-jump-lobby-tips-title">房间规则</h2>
        <ul className="gh-jump-lobby-tips-list">
          <li>
            房间 {JUMP_MIN_PLAYERS}–{JUMP_MAX_PLAYERS} 人，房主开局后按座位顺序轮流，每人一轮只跳一次。
          </li>
          <li>
            蓄力上限 {JUMP_MAX_CHARGE_MS} 毫秒，满蓄力跳 260 逻辑距离；落点与盒面中心的偏差在半宽 0.3
            倍以内算正中靶心。
          </li>
          <li>连击中心按 2 / 4 / 8 / 16 / 32 翻倍（第 5 次起固定 32），普通落盒 +1 且连击归零。</li>
          <li>跳短或跳过都会掉出盒子并出局；剩下的人继续，全员出局按分数结算。</li>
          <li>
            回合有截止时间，超时或掉线会被自动跳过并判负；轮询模式同样可以正常对局（约 2 秒延迟）。
          </li>
        </ul>
      </div>

      <p className="gh-games-footnote">
        对局为服务端权威判定：本端只在松手时提交「蓄力了多少毫秒」，距离换算、落点判定与计分全在服务端完成，
        本地不会自行加分。
      </p>
    </div>
  )
}

// ==================== 对局舞台 ====================

interface JumpOnlineStageProps {
  match: GameJumpMatch
  meId: number
  isHost: boolean
  transport: 'ws' | 'polling'
  /** 本跳已提交、等待服务端结果（蓄力禁用） */
  actionBusy: boolean
  turnRemainingMs: number | null
  actionError: string | null
  /** 松手时提交本地测量的蓄力毫秒数 */
  onChargeMs: (chargeMs: number) => Promise<void> | void
  onResign: () => void
  onBackToLobby: () => void
  resignBusy: boolean
}

/**
 * 轮流跳视图：等距盒子路线 canvas（镜头对准当前回合玩家所在盒）、
 * 每位玩家一个不同颜色的小人、蓄力力度条、回合条 + 倒计时、计分板、结算遮罩。
 */
function JumpOnlineStage({
  match,
  meId,
  isHost,
  transport,
  actionBusy,
  turnRemainingMs,
  actionError,
  onChargeMs,
  onResign,
  onBackToLobby,
  resignBusy,
}: JumpOnlineStageProps) {
  const { resolvedTheme } = useTheme()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)

  const layoutRef = useRef<JumpLayout>({ cssWidth: 320, cssHeight: 220, scale: 1, dpr: 1 })
  const camRef = useRef(0)
  const matchRef = useRef<GameJumpMatch>(match)
  matchRef.current = match
  const darkRef = useRef(resolvedTheme === 'dark')
  darkRef.current = resolvedTheme === 'dark'

  const chargeRef = useRef<{ active: boolean; startedAt: number }>({ active: false, startedAt: 0 })
  const animRef = useRef<Map<number, JumpRenderAnim>>(new Map())
  /** 各玩家当前「站立的逻辑轴坐标」：下一次跳跃的动画起点 */
  const standingRef = useRef<Map<number, number>>(new Map())
  /** 已坠落的玩家（掉出盒子后在原地留一个淡出标记） */
  const fallenRef = useRef<Map<number, number>>(new Map())
  /** 已经演过动画的 lastResult 签名，避免 presence / 回合推进导致重播 */
  const playedSigRef = useRef<string | null>(null)
  const renderedVersionRef = useRef<number>(-1)
  const particlesRef = useRef<JumpParticle[]>([])
  const floatsRef = useRef<JumpFloatText[]>([])
  const ringsRef = useRef<JumpRing[]>([])

  const [charging, setCharging] = useState(false)
  const [chargeMs, setChargeMs] = useState(0)
  const [blocked, setBlocked] = useState<string | null>(null)

  const playing = match.status === 'playing'
  const me = playerOf(match, meId)
  const myTurn = playing && match.turn?.userId === meId && me?.status === 'playing'
  const canCharge = myTurn && !actionBusy

  const blockReason = useCallback((): string | null => {
    if (!playing) return '本局已结束'
    if (me && me.status !== 'playing') return '你已经掉出盒子，本局只能观战'
    if (actionBusy) return '本跳已提交，等服务端判定落点'
    if (match.turn?.userId !== meId) return '还没轮到你，按住也不会蓄力'
    return null
  }, [playing, me?.status, actionBusy, match.turn?.userId, meId])

  // 尺寸自适应
  useEffect(() => {
    const measure = () => {
      const stage = stageRef.current
      const canvas = canvasRef.current
      if (!stage || !canvas) return
      const cssWidth = Math.max(240, Math.floor(stage.clientWidth || 320))
      const cssHeight = Math.max(220, Math.min(560, Math.floor(cssWidth * 0.56)))
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cssWidth / VIEW_LOGICAL_SPAN))
      const dpr = Math.min(3, Math.max(1, Math.round((window.devicePixelRatio || 1) * 100) / 100))
      layoutRef.current = { cssWidth, cssHeight, scale, dpr }
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
  }, [])

  /** 对局版本变化 → 按服务端 lastResult 生成一次落地/坠落动画（本地不判定得分） */
  const syncAnims = useCallback((current: GameJumpMatch, now: number) => {
    const boxes = current.boxes

    // 新出现 / 已变化的玩家：没有动画时直接站在自己当前盒子上
    for (const player of current.players) {
      if (animRef.current.has(player.userId)) continue
      const axis =
        player.boxIndex === null
          ? standingRef.current.get(player.userId) ?? jumpAxisOfBox(boxes, 0)
          : jumpAxisOfBox(boxes, player.boxIndex)
      standingRef.current.set(player.userId, axis)
      animRef.current.set(player.userId, { kind: 'none' })
    }

    const last = current.lastResult
    if (!last) return
    // 同一条结果只演一次（presence / 回合推进也会让 version 前进）
    const signature = `${last.userId}:${last.kind}:${last.gained}:${last.offset}:${last.scoreAfter}`
    if (playedSigRef.current === signature) return
    playedSigRef.current = signature

    const player = current.players.find((item) => item.userId === last.userId)
    if (!player) return
    const dead = last.kind === 'short' || last.kind === 'long' || last.kind === 'off'
    const fromAxis = standingRef.current.get(last.userId) ?? jumpAxisOfBox(boxes, 0)
    // 命中落在新盒中心 + 偏移；落空则落在「上一格 + 1」的外侧再坠落
    const targetIndex = dead
      ? standingIndex(fromAxis, boxes) + 1
      : player.boxIndex ?? standingIndex(fromAxis, boxes)
    const toAxis = jumpLandingAxis(boxes, targetIndex, last.offset)
    const distance = Math.max(0, toAxis - fromAxis)
    // 动画时长按等效蓄力换算（服务端没给时长，用距离反推，保持同样的手感节奏）
    const equivalentCharge = Math.min(
      JUMP_MAX_CHARGE_MS,
      (distance / JUMP_MAX_DISTANCE) * JUMP_MAX_CHARGE_MS
    )

    animRef.current.set(last.userId, {
      kind: 'fly',
      start: now,
      duration: jumpFlightMs(equivalentCharge),
      fromAxis,
      toAxis,
      distance,
      landing: last.kind,
      gained: last.gained,
      username: player.username,
    })
  }, [])

  // 主循环
  useEffect(() => {
    let raf = 0
    const frame = (time: number) => {
      raf = requestAnimationFrame(frame)
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const current = matchRef.current
      const layout = layoutRef.current

      if (renderedVersionRef.current !== current.version) {
        renderedVersionRef.current = current.version
        syncAnims(current, time)
      }

      ctx.setTransform(layout.dpr, 0, 0, layout.dpr, 0, 0)
      ctx.clearRect(0, 0, layout.cssWidth, layout.cssHeight)
      drawBackdrop(ctx, layout, darkRef.current, camRef.current)

      // 镜头目标：当前回合玩家所在盒（再加一点前瞻，让下一格露出来）
      const focusId = current.turn?.userId ?? current.players[0]?.userId ?? 0
      const focusAxis = (standingRef.current.get(focusId) ?? 0) + 30
      camRef.current += (focusAxis - camRef.current) * 0.08
      const camAxis = camRef.current

      const project = (axis: number, lift: number) => {
        const iso = jumpIso(axis - camAxis, lift)
        return {
          x: layout.cssWidth * CAMERA_ANCHOR_X + iso.x * layout.scale,
          y: layout.cssHeight * BASE_LINE_Y + iso.y * layout.scale,
        }
      }

      // 盒子：先一次性算好累计轴坐标（O(n)），再远处先画
      const turnUserId = current.turn?.userId
      const turnPlayer = turnUserId === undefined ? undefined : current.players.find((p) => p.userId === turnUserId)
      const turnBoxIndex = turnPlayer?.boxIndex ?? null
      const axes: number[] = []
      let cumulative = 0
      for (let index = 0; index < current.boxes.length; index += 1) {
        cumulative += index === 0 ? 0 : current.boxes[index].gap
        axes[index] = cumulative
      }
      for (let index = current.boxes.length - 1; index >= 0; index -= 1) {
        const box = current.boxes[index]
        const point = project(axes[index] ?? 0, 0)
        if (point.x < -160 || point.x > layout.cssWidth + 160) continue
        drawJumpBox(ctx, box, point.x, point.y, layout.scale, darkRef.current, index === turnBoxIndex)
      }

      // 光环
      ringsRef.current = ringsRef.current.filter((ring) => time - ring.born < 620)
      for (const ring of ringsRef.current) {
        const age = (time - ring.born) / 620
        const point = project(ring.axis, 0)
        ctx.save()
        ctx.globalAlpha = 1 - age
        ctx.strokeStyle = darkRef.current ? '#f5c518' : '#b08800'
        ctx.lineWidth = 2
        const grow = 1 + age * 0.9
        ctx.beginPath()
        ctx.ellipse(
          point.x,
          point.y,
          ring.size * layout.scale * 0.55 * grow,
          ring.size * layout.scale * 0.55 * JUMP_ISO_RATIO * grow,
          0,
          0,
          Math.PI * 2
        )
        ctx.stroke()
        ctx.restore()
      }

      // 灰尘
      particlesRef.current = particlesRef.current.filter((dust) => time - dust.born < dust.life)
      for (const dust of particlesRef.current) {
        const age = (time - dust.born) / dust.life
        const point = project(dust.axis + dust.vAxis * age, dust.lift + dust.vLift * age * (1 - age))
        ctx.save()
        ctx.globalAlpha = 0.5 * (1 - age)
        ctx.fillStyle = darkRef.current ? '#c9d1d9' : '#8c959f'
        ctx.beginPath()
        ctx.arc(point.x, point.y, dust.r * layout.scale, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      // 玩家小人（每位玩家一个不同颜色的小方块人，站在各自 boxIndex 的盒子上）
      current.players.forEach((player, seat) => {
        const anim = animRef.current.get(player.userId) ?? { kind: 'none' }
        const alive = player.status === 'playing'
        const fallenAxis = fallenRef.current.get(player.userId)
        let axis = standingRef.current.get(player.userId) ?? jumpAxisOfBox(current.boxes, 0)
        let lift = 0
        let rotate = 0
        let squash = 0
        let alpha = alive ? 1 : 0.55

        if (anim.kind === 'fly') {
          const progress = Math.max(0, Math.min(1, (time - anim.start) / anim.duration))
          axis = anim.fromAxis + (anim.toAxis - anim.fromAxis) * progress
          lift = jumpArcLift(anim.distance, progress)
          rotate = progress * Math.PI * 2
          if (progress >= 1) {
            standingRef.current.set(player.userId, anim.toAxis)
            const landed = anim.landing
            if (landed === 'short' || landed === 'long' || landed === 'off') {
              animRef.current.set(player.userId, {
                kind: 'fall',
                start: time,
                axis: anim.toAxis,
                drift: landed === 'long' ? 26 : -18,
              })
            } else {
              animRef.current.set(player.userId, { kind: 'none' })
              const box = current.boxes[Math.max(0, player.boxIndex ?? 0)]
              if (box) {
                for (let i = 0; i < 10; i += 1) {
                  const angle = (i / 10) * Math.PI * 2
                  particlesRef.current.push({
                    axis: anim.toAxis + Math.cos(angle) * box.size * 0.5,
                    lift: 0,
                    vAxis: Math.cos(angle) * 22,
                    vLift: 16 + Math.abs(Math.sin(angle)) * 20,
                    born: time,
                    life: DUST_MS + Math.random() * 160,
                    r: 1.8 + Math.random() * 2.2,
                  })
                }
                if (landed === 'center') {
                  ringsRef.current.push({ axis: anim.toAxis, size: box.size, born: time })
                }
              }
              if (anim.gained > 0) {
                floatsRef.current.push({
                  text: `+${anim.gained}`,
                  axis: anim.toAxis,
                  lift: 42,
                  born: time,
                  username: anim.username,
                  color: anim.gained >= 8 ? '#f5c518' : darkRef.current ? '#3fb950' : '#1a7f37',
                })
              }
            }
          }
        } else if (anim.kind === 'fall') {
          const progress = Math.max(0, Math.min(1, (time - anim.start) / FALL_MS))
          axis = anim.axis + anim.drift * progress
          lift = -progress * 150
          rotate = progress * 2.2
          alpha = Math.max(0.12, 1 - progress * 0.75)
          if (progress >= 1) {
            animRef.current.set(player.userId, { kind: 'none' })
            fallenRef.current.set(player.userId, axis)
          }
        } else {
          // 站在盒面上：从实际落点缓回到盒面中心（服务端按中心间距结算）
          if (player.boxIndex !== null && player.status !== 'lost') {
            const centerAxis = jumpAxisOfBox(current.boxes, player.boxIndex)
            const eased = axis + (centerAxis - axis) * 0.3
            standingRef.current.set(player.userId, eased)
            axis = eased
          }
          if (player.userId === meId && chargeRef.current.active) {
            squash = jumpSquash(time - chargeRef.current.startedAt)
          }
        }

        // 已坠落且动画结束：只留一个淡出的落点标记
        if (fallenAxis !== undefined && anim.kind === 'none') {
          const marker = project(fallenAxis, -78)
          ctx.save()
          ctx.globalAlpha = 0.45
          ctx.strokeStyle = darkRef.current ? '#8b949e' : '#6e7781'
          ctx.lineWidth = 2 * layout.scale
          const arm = 7 * layout.scale
          ctx.beginPath()
          ctx.moveTo(marker.x - arm, marker.y - arm)
          ctx.lineTo(marker.x + arm, marker.y + arm)
          ctx.moveTo(marker.x + arm, marker.y - arm)
          ctx.lineTo(marker.x - arm, marker.y + arm)
          ctx.stroke()
          ctx.restore()
          return
        }

        const point = project(axis, lift)
        drawCharacter(ctx, point.x, point.y, layout.scale, alive ? jumpColorForSeat(seat) : '#8c959f', {
          squash,
          rotate,
          alpha,
          shadowAlpha: lift > 0 ? 0.3 * (1 - Math.min(1, lift / 90)) : 0.28,
          crown: current.turn?.userId === player.userId && current.status === 'playing'
            ? jumpColorForSeat(seat)
            : null,
        })
      })

      // 飘字（+2 / +4 …，带玩家名）
      floatsRef.current = floatsRef.current.filter((item) => time - item.born < 1200)
      for (const item of floatsRef.current) {
        const age = (time - item.born) / 1200
        const point = project(item.axis, item.lift + age * 40)
        ctx.save()
        ctx.globalAlpha = 1 - age
        ctx.fillStyle = item.color
        ctx.font = `700 ${Math.round(18 * layout.scale)}px 'SFMono-Regular', Consolas, monospace`
        ctx.textAlign = 'center'
        ctx.fillText(item.username ? `${item.username} ${item.text}` : item.text, point.x, point.y)
        ctx.restore()
      }
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [syncAnims, meId])

  // 蓄力输入
  const startCharge = useCallback(() => {
    if (!canCharge || chargeRef.current.active) return
    const reason = blockReason()
    if (reason) return
    chargeRef.current = { active: true, startedAt: performance.now() }
    setCharging(true)
  }, [canCharge, blockReason])

  const releaseCharge = useCallback(() => {
    const charge = chargeRef.current
    chargeRef.current = { active: false, startedAt: 0 }
    setCharging(false)
    if (!charge.active) return
    const measured = Math.round(performance.now() - charge.startedAt)
    const clamped = Math.max(1, Math.min(JUMP_MAX_CHARGE_MS, measured))
    setChargeMs(clamped)
    void onChargeMs(clamped)
  }, [onChargeMs])

  // 轮到自己（或提交状态变化）→ 清掉「现在不能蓄力」的提示
  useEffect(() => {
    if (canCharge) setBlocked(null)
  }, [canCharge, actionBusy])

  useEffect(() => {
    const isTyping = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false
      if (target.isContentEditable) return true
      const tag = target.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTyping(event.target) || event.repeat) return
      if (event.code === 'Space') {
        event.preventDefault()
        startCharge()
      }
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        event.preventDefault()
        releaseCharge()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [startCharge, releaseCharge])

  // 蓄力中：力度条直改 DOM + 每 80 毫秒同步一次文案
  useEffect(() => {
    if (!charging) {
      if (barRef.current) barRef.current.style.width = '0%'
      return
    }
    let raf = 0
    const tick = (time: number) => {
      raf = requestAnimationFrame(tick)
      const ratio = jumpPowerRatio(time - chargeRef.current.startedAt)
      if (barRef.current) barRef.current.style.width = `${(ratio * 100).toFixed(1)}%`
    }
    raf = requestAnimationFrame(tick)
    const timer = setInterval(() => {
      setChargeMs(Math.round(performance.now() - chargeRef.current.startedAt))
    }, 80)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(timer)
    }
  }, [charging])

  const winner = playerOf(match, match.winnerId ?? -1)
  const ranked = [...match.players].sort(
    (a, b) =>
      (a.status === 'playing' ? 0 : 1) - (b.status === 'playing' ? 0 : 1)
      || b.score - a.score
      || (b.boxIndex ?? -1) - (a.boxIndex ?? -1)
      || a.username.localeCompare(b.username)
  )
  const turnSeconds = turnRemainingMs === null ? null : Math.ceil(turnRemainingMs / 1000)
  const broadcast = broadcastText(match)
  const progressBox = Math.max(...match.players.map((player) => player.boxIndex ?? 0), 0)
  const shownCharge = Math.min(JUMP_MAX_CHARGE_MS, chargeMs)
  const powerPercent = Math.round(jumpPowerRatio(shownCharge) * 100)
  const myLastResult = match.lastResult?.userId === meId ? match.lastResult : null
  const stageLabel = playing
    ? `跳一跳轮流对局，共 ${match.boxes.length} 格盒子路线，当前最远到第 ${progressBox + 1} 格。${
        match.turn ? `轮到 ${nameOf(match, match.turn.userId)}` : '等待回合'
      }。${match.players
        .map((player) => `${player.username} ${player.score} 分、第 ${(player.boxIndex ?? 0) + 1} 格`)
        .join('；')}`
    : `跳一跳对局结束。${winner ? `获胜者 ${winner.username}` : '平局：没有人胜出'}。${ranked
        .map((player) => `${player.username} ${player.score} 分`)
        .join('；')}`

  return (
    <>
      <header className="gh-jump-online-header">
        <div className="gh-jump-online-heading">
          <p className="gh-g2048-eyebrow">
            <Link to={LOBBY_PATH}>← 跳一跳联机大厅</Link>
          </p>
          <h1 className="gh-games-title">
            跳一跳 · 轮流对战
            <span className={`gh-game-conn-chip gh-game-conn-chip--${transport}`}>
              {transport === 'ws' ? '实时' : '轮询'}
            </span>
          </h1>
          <p className="gh-games-subtitle">
            共享一条 {match.boxes.length} 格盒子路线 · 最远到第 {progressBox + 1} 格 ·{' '}
            你站在第 {(me?.boxIndex ?? 0) + 1} 格
            {transport === 'polling' ? ' · 轮询模式，约 2 秒延迟' : ''}
          </p>
        </div>
        <div className="gh-jump-online-actions">
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
          <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={onBackToLobby}>
            {match.status === 'finished' ? (isHost ? '再来一局' : '返回大厅') : '返回大厅'}
          </button>
        </div>
      </header>

      {actionError && (
        <div className="gh-alert gh-alert--danger gh-game-alert" role="alert">{actionError}</div>
      )}

      <div className="gh-jump-turnbar" data-mine={myTurn ? 'me' : 'other'}>
        <span className="gh-jump-turn-label">当前回合</span>
        {match.turn ? (
          <>
            <span
              className="gh-jump-turn-user"
              style={{ color: jumpColorForSeat(seatOf(match, match.turn.userId)) }}
            >
              {nameOf(match, match.turn.userId)}
              {match.turn.userId === meId ? '（你）' : ''}
            </span>
            {playing && turnSeconds !== null && (
              <span
                className={`gh-jump-turn-countdown${turnSeconds <= 10 ? ' gh-jump-turn-countdown--low' : ''}`}
                role="timer"
              >
                {turnSeconds} 秒
              </span>
            )}
          </>
        ) : (
          <span className="gh-jump-turn-user">等待服务端安排回合…</span>
        )}
        <span className="gh-jump-turn-hint">
          {canCharge
            ? '轮到你了：按住画面蓄力，松手起跳（空格同样可用）'
            : blockReason() ?? '等待其他玩家落子'}
        </span>
      </div>

      <div className="gh-jump-online-body">
        <div className="gh-jump-online-main">
          <div
            className={`gh-jump-stage gh-jump-stage--online${charging ? ' gh-jump-stage--charging' : ''}`}
            ref={stageRef}
            onPointerDown={(event) => {
              event.preventDefault()
              if (!canCharge) {
                setBlocked(blockReason() ?? '现在不能蓄力')
                return
              }
              startCharge()
            }}
            onPointerUp={releaseCharge}
            onPointerCancel={releaseCharge}
            onPointerLeave={() => {
              if (chargeRef.current.active) releaseCharge()
            }}
            onContextMenu={(event) => event.preventDefault()}
            role="group"
            aria-label={stageLabel}
          >
            <canvas ref={canvasRef} className="gh-jump-canvas" role="img" aria-label={stageLabel} />

            <div className="gh-jump-power gh-jump-power--online" aria-hidden="true">
              <div className="gh-jump-power-track">
                <div ref={barRef} className="gh-jump-power-bar" style={{ width: '0%' }} />
              </div>
              <span className="gh-jump-power-text">
                {charging
                  ? `蓄力中 ${shownCharge} / ${JUMP_MAX_CHARGE_MS} 毫秒（约 ${Math.round(jumpDistance(shownCharge))} 距离）`
                  : actionBusy
                    ? '本跳已提交，等服务端判定落点…'
                    : canCharge
                      ? '按住蓄力，松手起跳'
                      : blockReason() ?? '等待回合'}
              </span>
            </div>

            {blocked ? (
              <p className="gh-jump-blocked-hint" role="status">
                {blocked}
              </p>
            ) : null}

            {match.status === 'finished' && (
              <div className="gh-jump-overlay" role="dialog" aria-modal="true" aria-label="对局结算">
                <div className="gh-jump-overlay-card">
                  <p className="gh-jump-overlay-eyebrow">轮流跳结束</p>
                  <h2
                    className={[
                      'gh-jump-overlay-title',
                      winner && winner.userId === meId ? 'gh-jump-overlay-title--win' : '',
                      winner === null ? 'gh-jump-overlay-title--draw' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {winner ? `${winner.username} 获胜` : '平局：本局没有赢家'}
                  </h2>
                  <p className="gh-jump-overlay-detail">
                    {match.reason ? END_REASON_LABELS[match.reason] : '本局已结束'}
                  </p>
                  <ol className="gh-jump-result-ranks">
                    {ranked.map((player, index) => (
                      <li key={player.userId}>
                        <span
                          className="gh-jump-swatch"
                          style={{
                            background:
                              player.status === 'lost'
                                ? '#8c959f'
                                : jumpColorForSeat(seatOf(match, player.userId)),
                          }}
                          aria-hidden="true"
                        />
                        <span className="gh-jump-result-rank">
                          {index + 1}. {player.username}
                          {player.userId === meId ? '（你）' : ''}
                        </span>
                        <strong>{player.score}</strong>
                        <span className="gh-jump-result-meta">
                          第 {((player.boxIndex ?? progressBox) + 1)} 格 · 连击 x{player.combo} · 跳{' '}
                          {player.jumps} 次 ·{' '}
                          {player.userId === match.winnerId
                            ? '获胜'
                            : match.winnerId === null
                              ? '并列 / 无赢家'
                              : STATUS_LABELS[player.status]}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <div className="gh-jump-overlay-actions">
                    <button type="button" className="gh-btn gh-btn--primary gh-btn--lg" onClick={onBackToLobby}>
                      {isHost ? '回大厅再开一局' : '返回大厅'}
                    </button>
                    <Link className="gh-btn gh-btn--secondary gh-btn--lg" to={GAME_JUMP_ROUTE}>
                      单机练习
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>

          {broadcast && (
            <p className="gh-jump-broadcast" role="status">
              最近一跳：{broadcast}
            </p>
          )}

          {playing && (
            <div className="gh-jump-hold-row">
              <button
                type="button"
                className="gh-jump-hold-btn"
                onPointerDown={(event) => {
                  event.preventDefault()
                  if (!canCharge) {
                    setBlocked(blockReason() ?? '现在不能蓄力')
                    return
                  }
                  startCharge()
                }}
                onPointerUp={releaseCharge}
                onPointerCancel={releaseCharge}
                disabled={!canCharge}
                aria-label="按住蓄力，松手起跳"
              >
                {charging ? `蓄力中 ${powerPercent}%` : canCharge ? '按住蓄力' : '不能蓄力'}
              </button>
              <span className="gh-jump-hold-meta">
                力度 {powerPercent}% ≈ {Math.round(jumpDistance(shownCharge))} / {JUMP_MAX_DISTANCE} 距离 ·
                你上一跳：
                {myLastResult
                  ? `${JUMP_LANDING_TEXT[myLastResult.kind]}（偏移 ${formatJumpOffset(myLastResult.offset)}，+${myLastResult.gained}）`
                  : '尚未起跳'}
              </span>
            </div>
          )}
        </div>

        <aside className="gh-jump-scoreboard" aria-label="计分板">
          <h2 className="gh-jump-scoreboard-title">计分板</h2>
          {playing ? (
            <p className="gh-jump-scoreboard-countdown" role="status">
              {turnSeconds !== null ? (
                <>
                  本回合剩 <strong>{turnSeconds}</strong> 秒
                </>
              ) : (
                '等待回合开始'
              )}
            </p>
          ) : (
            <p className="gh-jump-scoreboard-countdown">
              {match.status === 'finished' ? '本局已结束' : '等待开始'}
            </p>
          )}
          <ul className="gh-jump-scoreboard-list">
            {ranked.map((player) => (
              <li
                key={player.userId}
                className={[
                  'gh-jump-scoreboard-row',
                  player.status === 'playing' ? '' : 'gh-jump-scoreboard-row--out',
                  player.userId === meId ? 'gh-jump-scoreboard-row--me' : '',
                  match.turn?.userId === player.userId ? 'gh-jump-scoreboard-row--turn' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span
                  className="gh-jump-swatch"
                  style={{
                    background:
                      player.status === 'playing' || player.status === 'waiting'
                        ? jumpColorForSeat(seatOf(match, player.userId))
                        : 'var(--gh-text-disabled)',
                  }}
                  aria-hidden="true"
                />
                <span className="gh-jump-scoreboard-copy">
                  <span className="gh-jump-scoreboard-name">
                    {player.username}
                    {player.userId === meId && (
                      <span className="gh-game-room-badge gh-game-room-badge--me">你</span>
                    )}
                    {player.userId === match.hostId && <span className="gh-game-room-badge">房主</span>}
                    {match.turn?.userId === player.userId && playing && (
                      <span className="gh-game-room-badge gh-jump-turn-badge">回合中</span>
                    )}
                  </span>
                  <span className="gh-jump-scoreboard-meta">
                    <span
                      className={`gh-game-presence-dot${
                        player.online ? ' gh-game-presence-dot--online' : ''
                      }`}
                    />
                    {player.online ? '在线' : '离线'} · {STATUS_LABELS[player.status]} · 第{' '}
                    {(player.boxIndex ?? 0) + 1} 格 · 跳 {player.jumps} 次
                  </span>
                </span>
                <span className="gh-jump-scoreboard-numbers">
                  <strong className="gh-jump-scoreboard-score">{player.score}</strong>
                  <span className="gh-jump-scoreboard-split">
                    连击 x{player.combo} · 偏移 {formatJumpOffset(player.offset)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="gh-jump-scoreboard-foot">
            服务端按同一套常量结算：偏差在半宽 0.3 倍内算中心、连击 2/4/8/16/32，越过盒面半宽即掉出盒子。
          </p>
        </aside>
      </div>
    </>
  )
}

/** 由轴坐标反查所站立的盒序号（累计间距单调递增，取不超过轴坐标的最大格） */
function standingIndex(axis: number, boxes: JumpBoxDto[]): number {
  let cumulative = 0
  let best = boxes.length > 0 ? boxes[0].index : 0
  for (const box of boxes) {
    cumulative += box.index === 0 ? 0 : box.gap
    if (cumulative > axis + 0.0001) break
    best = box.index
  }
  return best
}
