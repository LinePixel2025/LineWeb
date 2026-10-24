import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { GAME_POLL_INTERVALS } from '../lib/realtime'
import { useAuth } from './AuthContext'
import { useChat } from './ChatContext'
import type {
  AnyGameMatch,
  GameInvite,
  GameInviteRespondResponse,
  GameInviteResponse,
  GameInvitesResponse,
  GameKind,
} from '../types/game'

/** 邀请过期清理间隔：前端按时剔除已过期邀请，避免弹窗/列表残留 */
const INVITE_SWEEP_MS = 1_000

/**
 * 五款游戏的 API 前缀唯一映射（新增游戏时改这里 + catalog + App 路由）。
 */
const GAME_API_BASE: Record<GameKind, string> = {
  '2048': '/games/2048',
  doudizhu: '/games/doudizhu',
  snake: '/games/snake',
  minesweeper: '/games/minesweeper',
  jump: '/games/jump',
}

/** 需要一并拉取邀请 / 对局状态的全部游戏 */
const ALL_GAME_KINDS = Object.keys(GAME_API_BASE) as GameKind[]

/** 对局详情页路由（五款游戏统一 /games/<game>/online/:matchId） */
export function gameMatchPath(match: Pick<AnyGameMatch, 'game' | 'id'>): string {
  return `/games/${match.game}/online/${match.id}`
}

/** 游戏 API 前缀 */
function gameApiBase(game: GameKind): string {
  return GAME_API_BASE[game] ?? GAME_API_BASE['2048']
}

/** 任一游戏的 sync 载荷（match 形状按 game 判别） */
interface AnyGameSyncPayload {
  serverTime: string
  invites: GameInvitesResponse
  match: AnyGameMatch | null
}

export interface GameContextValue {
  /** 收到的邀请（2048 + 斗地主合并，按创建时间升序，已剔除过期项） */
  incomingInvites: GameInvite[]
  /** 自己发出、仍有效的邀请 */
  outgoingInvites: GameInvite[]
  /** 刚开局、需要提示用户进入的对局（由 WS game:match:started 或轮询 sync 发现） */
  startedMatch: AnyGameMatch | null
  /** 首次加载邀请列表 */
  loading: boolean
  /** 最近一次主动拉取邀请列表的错误 */
  error: string | null
  /** 重新拉取邀请列表（登录后、WS 建立、窗口重新可见时自动调用） */
  refreshInvites: () => Promise<void>
  /** 向好友发起对战邀请；同时返回邀请加入的等待房间 */
  createInvite: (friendId: number, game?: GameKind) => Promise<{ invite: GameInvite; match?: AnyGameMatch }>
  /** 取消自己发出的邀请 */
  cancelInvite: (inviteId: number, game?: GameKind) => Promise<void>
  /** 接受 / 拒绝收到的邀请；接受成功时返回新对局 */
  respondInvite: (inviteId: number, action: 'accept' | 'decline', game?: GameKind) => Promise<AnyGameMatch | null>
  /** 关闭“对局已开始”提示（同一对局不会再次弹出） */
  dismissStartedMatch: () => void
}

const GameContext = createContext<GameContextValue | null>(null)

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

function isAlive(invite: GameInvite, now = Date.now()): boolean {
  const expiresAt = Date.parse(invite.expiresAt)
  return Number.isFinite(expiresAt) ? expiresAt > now : false
}

/** 给邀请补上所属游戏（旧载荷可能缺省 game 字段） */
function tagInvites(list: GameInvite[], game: GameKind): GameInvite[] {
  return list.map((invite) => ({ ...invite, game: invite.game ?? game }))
}

function sortByCreatedAt(list: GameInvite[]): GameInvite[] {
  return [...list].sort((a, b) => {
    const timeA = Date.parse(a.createdAt)
    const timeB = Date.parse(b.createdAt)
    const diff = (Number.isNaN(timeA) ? 0 : timeA) - (Number.isNaN(timeB) ? 0 : timeB)
    return diff !== 0 ? diff : a.id - b.id
  })
}

function upsertById(list: GameInvite[], invite: GameInvite): GameInvite[] {
  const index = list.findIndex((item) => item.id === invite.id)
  if (index === -1) return sortByCreatedAt([...list, invite])
  const next = [...list]
  next[index] = invite
  return next
}

function removeById(list: GameInvite[], inviteId: number): GameInvite[] {
  return list.filter((item) => item.id !== inviteId)
}

function aliveOnly(list: GameInvite[], now = Date.now()): GameInvite[] {
  return sortByCreatedAt(list.filter((invite) => isAlive(invite, now)))
}

export function GameProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const { connectionState, transport, subscribe } = useChat()
  const navigate = useNavigate()
  const location = useLocation()
  const pathnameRef = useRef(location.pathname)

  useEffect(() => {
    pathnameRef.current = location.pathname
  }, [location.pathname])

  const goToMatch = useCallback((match: AnyGameMatch | null | undefined) => {
    if (!match) return
    const target = gameMatchPath(match)
    if (pathnameRef.current !== target) navigate(target)
  }, [navigate])

  const [incomingInvites, setIncomingInvites] = useState<GameInvite[]>([])
  const [outgoingInvites, setOutgoingInvites] = useState<GameInvite[]>([])
  const [startedMatch, setStartedMatch] = useState<AnyGameMatch | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 用户已关闭提示的对局 id —— 轮询再次同步到同一对局时不再弹出 */
  const dismissedMatchIdRef = useRef<number | null>(null)
  const startedMatchRef = useRef<AnyGameMatch | null>(null)
  const loadedRef = useRef(false)

  useEffect(() => {
    startedMatchRef.current = startedMatch
  }, [startedMatch])

  const acceptStartedMatch = useCallback((match: AnyGameMatch | null | undefined) => {
    if (!match || match.status === 'finished') return
    if (match.status === 'waiting') return
    if (dismissedMatchIdRef.current === match.id) return
    startedMatchRef.current = match
    setStartedMatch((prev) => (prev && prev.id === match.id ? prev : match))
  }, [])

  const refreshInvites = useCallback(async () => {
    if (!userId) return
    if (!loadedRef.current) setLoading(true)
    try {
      // 五款游戏的邀请各自独立存放；用 allSettled，某个游戏端点异常不影响其余展示
      const results = await Promise.allSettled(
        ALL_GAME_KINDS.map((game) => api.get<GameInvitesResponse>(`${gameApiBase(game)}/invites`)),
      )
      const now = Date.now()
      const incoming: GameInvite[] = []
      const outgoing: GameInvite[] = []
      results.forEach((result, index) => {
        if (result.status !== 'fulfilled') return
        const game = ALL_GAME_KINDS[index]
        incoming.push(...tagInvites(result.value.incoming ?? [], game))
        outgoing.push(...tagInvites(result.value.outgoing ?? [], game))
      })
      setIncomingInvites(aliveOnly(incoming, now))
      setOutgoingInvites(aliveOnly(outgoing, now))
      loadedRef.current = true
      setError(null)
    } catch (err) {
      setError(errorMessage(err, '加载游戏邀请失败'))
    } finally {
      setLoading(false)
    }
  }, [userId])

  // 登录 / 登出：初始化或清空
  useEffect(() => {
    if (!userId) {
      setIncomingInvites([])
      setOutgoingInvites([])
      setStartedMatch(null)
      setError(null)
      setLoading(false)
      dismissedMatchIdRef.current = null
      startedMatchRef.current = null
      loadedRef.current = false
      return
    }
    void refreshInvites()
  }, [userId, refreshInvites])

  // WS 建立后补拉一次邀请（登录后 WS 尚未 open 时可能错过事件）
  useEffect(() => {
    if (userId && connectionState === 'open') void refreshInvites()
  }, [userId, connectionState, refreshInvites])

  // 窗口重新可见 / 获得焦点时刷新，避免离开期间错过邀请
  useEffect(() => {
    if (!userId) return
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refreshInvites()
    }
    const handleFocus = () => {
      void refreshInvites()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleFocus)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleFocus)
    }
  }, [userId, refreshInvites])

  // WebSocket 推送：邀请新增 / 移除 / 对局开始（2048 与斗地主共用事件名，按 match.game 区分）
  useEffect(() => {
    if (!userId) return
    const unsubscribe = subscribe((event) => {
      switch (event.type) {
        case 'game:invite':
          if (isAlive(event.invite)) {
            setIncomingInvites((prev) => upsertById(prev, event.invite))
          }
          break
        case 'game:invite:removed':
          setIncomingInvites((prev) => removeById(prev, event.inviteId))
          setOutgoingInvites((prev) => removeById(prev, event.inviteId))
          break
        case 'game:match:started':
          // 邀请通过后房主开始游戏：所有参与者直接进入对应游戏的对局页
          acceptStartedMatch(event.match)
          goToMatch(event.match)
          break
        case 'game:match:ended':
          // 对局在用户进入前就结束（认输/超时/掉线）：撤掉「对局已开始」提示
          setStartedMatch((prev) => {
            if (prev?.id !== event.match.id) return prev
            startedMatchRef.current = null
            return null
          })
          break
        default:
          break
      }
    })
    return unsubscribe
  }, [userId, subscribe, acceptStartedMatch, goToMatch])

  // 无 WebSocket（transport === 'polling'）时：presence 心跳 + 两个游戏的全量 sync
  useEffect(() => {
    if (!userId || transport !== 'polling') return

    let disposed = false

    const pingPresence = async () => {
      try {
        // presence 存储跨游戏共享，报一个游戏即可
        await api.post('/games/2048/presence')
      } catch {
        // presence 失败由下一轮重试，不打断轮询
      }
    }

    const sync = async () => {
      try {
        const results = await Promise.allSettled(
          ALL_GAME_KINDS.map((game) => api.get<AnyGameSyncPayload>(`${gameApiBase(game)}/sync`)),
        )
        if (disposed) return
        const now = Date.now()
        const incoming: GameInvite[] = []
        const outgoing: GameInvite[] = []
        const active: AnyGameMatch[] = []
        results.forEach((result, index) => {
          if (result.status !== 'fulfilled') return
          const game = ALL_GAME_KINDS[index]
          incoming.push(...tagInvites(result.value.invites?.incoming ?? [], game))
          outgoing.push(...tagInvites(result.value.invites?.outgoing ?? [], game))
          const match = result.value.match
          // 与 2048 原行为一致：只有已开局（非 waiting）的对局才自动进入；等待房间由大厅自行处理
          if (match && (match.status === 'playing' || match.status === 'bidding')) active.push(match)
        })
        setIncomingInvites(aliveOnly(incoming, now))
        setOutgoingInvites(aliveOnly(outgoing, now))
        for (const match of active) {
          acceptStartedMatch(match)
          goToMatch(match)
        }
        if (active.length === 0 && startedMatchRef.current) {
          startedMatchRef.current = null
          setStartedMatch(null)
        }
      } catch {
        // 轮询失败静默重试
      }
    }

    void pingPresence()
    void sync()

    const presenceTimer = setInterval(() => {
      void pingPresence()
    }, GAME_POLL_INTERVALS.presence)
    const syncTimer = setInterval(() => {
      void sync()
    }, GAME_POLL_INTERVALS.sync)

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return
      void pingPresence()
      void sync()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      disposed = true
      clearInterval(presenceTimer)
      clearInterval(syncTimer)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [userId, transport, acceptStartedMatch, goToMatch])

  // 每秒剔除过期邀请（倒计时弹窗与列表保持一致）
  useEffect(() => {
    if (!userId) return
    const prune = (list: GameInvite[]) => {
      const next = aliveOnly(list)
      return next.length === list.length ? list : next
    }
    const timer = setInterval(() => {
      setIncomingInvites(prune)
      setOutgoingInvites(prune)
    }, INVITE_SWEEP_MS)
    return () => clearInterval(timer)
  }, [userId])

  const createInvite = useCallback(
    async (friendId: number, game: GameKind = '2048'): Promise<{ invite: GameInvite; match?: AnyGameMatch }> => {
      try {
        const data = await api.post<GameInviteResponse>(`${gameApiBase(game)}/invites`, { friendId })
        const invite = { game, ...data.invite }
        setOutgoingInvites((prev) => upsertById(prev, invite))
        setError(null)
        return { invite, match: data.match }
      } catch (err) {
        setError(errorMessage(err, '发送对战邀请失败'))
        throw err
      }
    },
    []
  )

  const cancelInvite = useCallback(async (inviteId: number, game?: GameKind): Promise<void> => {
    try {
      // 邀请所在游戏由调用方提供（列表项带 game 字段）；缺省按 2048 兼容
      await api.delete(`${gameApiBase(game ?? '2048')}/invites/${inviteId}`)
      setOutgoingInvites((prev) => removeById(prev, inviteId))
      setError(null)
    } catch (err) {
      setError(errorMessage(err, '取消对战邀请失败'))
      throw err
    }
  }, [])

  const respondInvite = useCallback(
    async (
      inviteId: number,
      action: 'accept' | 'decline',
      game: GameKind = '2048'
    ): Promise<AnyGameMatch | null> => {
      try {
        const data = await api.post<GameInviteRespondResponse>(
          `${gameApiBase(game)}/invites/${inviteId}/respond`,
          { action }
        )
        setIncomingInvites((prev) => removeById(prev, inviteId))
        if (action === 'accept' && data.match) {
          // 响应类型按 2048 声明，实际载荷由 game 参数对应的端点决定
          acceptStartedMatch(data.match as unknown as AnyGameMatch)
        }
        setError(null)
        return (data.match as unknown as AnyGameMatch) ?? null
      } catch (err) {
        setError(errorMessage(err, action === 'accept' ? '接受邀请失败' : '拒绝邀请失败'))
        throw err
      }
    },
    [acceptStartedMatch]
  )

  const dismissStartedMatch = useCallback(() => {
    const match = startedMatchRef.current
    if (match) dismissedMatchIdRef.current = match.id
    startedMatchRef.current = null
    setStartedMatch(null)
  }, [])

  const value = useMemo<GameContextValue>(
    () => ({
      incomingInvites,
      outgoingInvites,
      startedMatch,
      loading,
      error,
      refreshInvites,
      createInvite,
      cancelInvite,
      respondInvite,
      dismissStartedMatch,
    }),
    [
      incomingInvites,
      outgoingInvites,
      startedMatch,
      loading,
      error,
      refreshInvites,
      createInvite,
      cancelInvite,
      respondInvite,
      dismissStartedMatch,
    ]
  )

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext)
  if (!ctx) throw new Error('useGame must be used within GameProvider')
  return ctx
}
