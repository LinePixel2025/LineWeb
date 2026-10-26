import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useChat } from '../contexts/ChatContext'
import { useGame } from '../contexts/GameContext'
import api from '../lib/api'
import { GAME_POLL_INTERVALS } from '../lib/realtime'
import type {
  AnyGameMatch,
  GameFriend,
  GameFriendsResponse,
  GameInvite,
  GameInvitesResponse,
  GameKind,
} from '../types/game'

/** 邀请端点响应（各游戏形状一致，match 为对应游戏的 DTO） */
interface InviteResponse {
  invite: GameInvite
  match?: AnyGameMatch
}
interface InviteRespondResponse {
  ok: boolean
  match?: AnyGameMatch
}
interface MatchResponse {
  match: AnyGameMatch
}
interface SyncResponse {
  serverTime: string
  invites: GameInvitesResponse
  match: AnyGameMatch | null
}
interface ActiveResponse {
  match: AnyGameMatch | null
}

export interface OnlineGameRoomOptions {
  game: GameKind
  /** REST 前缀（如 '/games/uno'） */
  apiBase: string
  /** 联机大厅路由（如 '/games/uno/online'） */
  lobbyPath: string
  minPlayers: number
  maxPlayers: number
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

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
 * 联机游戏房间的通用状态机：大厅好友 / 邀请、对局详情、WS 事件与轮询降级、
 * 开始 / 离开 / 认输 / 邀请 / 提交动作。各游戏页面只负责渲染自己的等待房间与棋盘。
 *
 * 约定与既有单游戏页面一致：
 *   - WS 事件 game:match:* 按 match.game + match.id 过滤，只接受版本更新的 DTO；
 *   - 无 WebSocket 时用 sync 轮询 + presence 心跳；serverTime 用于校准回合倒计时；
 *   - 房间解散（cancelled）自动回大厅，且不会被 active 查询送回已结束对局。
 */
export function useOnlineGameRoom<T extends AnyGameMatch>(options: OnlineGameRoomOptions) {
  const { game, apiBase, lobbyPath, minPlayers, maxPlayers } = options
  const { matchId: matchIdParam } = useParams<{ matchId?: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const meId = user?.id ?? 0
  const { transport, subscribe } = useChat()
  const {
    incomingInvites: globalIncoming,
    outgoingInvites: globalOutgoing,
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

  const [match, setMatch] = useState<T | null>(null)
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
  const [nowTick, setNowTick] = useState(0)

  const matchRef = useRef<T | null>(null)
  const matchIdRef = useRef<number | null>(matchId)
  const skipActiveCheckRef = useRef(false)
  const inFlightRef = useRef(false)
  const clockOffsetRef = useRef(0)

  useEffect(() => {
    matchRef.current = match
  }, [match])

  useEffect(() => {
    matchIdRef.current = matchId
  }, [matchId])

  const matchPath = useCallback((id: number) => `${lobbyPath}/${id}`, [lobbyPath])

  const applyMatch = useCallback((next: T) => {
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
        const data = await api.get<MatchResponse>(`${apiBase}/matches/${id}`)
        if (matchIdRef.current !== id) return
        if (data.match.game !== game) throw new Error('对局类型不匹配')
        const next = data.match as T
        if (force) setMatch(next)
        else applyMatch(next)
        setMatchError(null)
      } catch (err) {
        if (matchIdRef.current === id) setMatchError(errorMessage(err, '加载对局失败'))
      } finally {
        setMatchLoading(false)
      }
    },
    [apiBase, game, applyMatch],
  )

  const loadFriends = useCallback(
    async (showLoading = true) => {
      if (showLoading) setFriendsLoading(true)
      try {
        const data = await api.get<GameFriendsResponse>(`${apiBase}/friends`)
        setFriends(data.friends ?? [])
        setFriendsError(null)
      } catch (err) {
        setFriendsError(errorMessage(err, '加载好友列表失败'))
      } finally {
        setFriendsLoading(false)
        setMatchLoading(false)
      }
    },
    [apiBase],
  )

  const loadInvites = useCallback(async () => {
    try {
      const data = await api.get<GameInvitesResponse>(`${apiBase}/invites`)
      setLocalIncoming((data.incoming ?? []).map((invite) => ({ ...invite, game })))
      setLocalOutgoing((data.outgoing ?? []).map((invite) => ({ ...invite, game })))
    } catch {
      // 邀请列表失败不打断对局，下一次刷新再试
    }
  }, [apiBase, game])

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
      .get<ActiveResponse>(`${apiBase}/matches/active`)
      .then((data) => {
        if (cancelled) return
        const active = data.match && data.match.game === game ? (data.match as T) : null
        if (active && (active.status === 'playing' || active.status === 'waiting')) {
          navigate(matchPath(active.id), { replace: true })
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
  }, [loggedIn, matchId, apiBase, game, loadMatch, loadFriends, loadInvites, navigate, matchPath])

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

  // WS：对局事件
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
      if (event.match.game !== game) return
      if (event.match.id !== matchId) return
      applyMatch(event.match as T)
      if (event.type === 'game:match:ended' && event.match.reason === 'cancelled') {
        skipActiveCheckRef.current = true
        navigate(lobbyPath, { replace: true })
      }
    })
    return unsubscribe
  }, [matchId, transport, subscribe, game, applyMatch, navigate, lobbyPath])

  // WS：邀请变化 → 补拉本页邀请
  useEffect(() => {
    if (!user || transport !== 'ws') return
    const unsubscribe = subscribe((event) => {
      if (event.type === 'game:invite' || event.type === 'game:invite:removed') void loadInvites()
    })
    return unsubscribe
  }, [user, transport, subscribe, loadInvites])

  // 传输模式切换时补拉一次
  useEffect(() => {
    if (!user || !matchId) return
    void loadMatch(matchId, false)
  }, [user, matchId, transport, loadMatch])

  // 轮询模式：对局 sync + 邀请 + 时钟校准
  useEffect(() => {
    if (!user || !matchId || transport !== 'polling') return
    let disposed = false
    const poll = async () => {
      if (disposed) return
      if (matchRef.current?.status === 'finished') return
      try {
        const data = await api.get<SyncResponse>(`${apiBase}/sync?matchId=${matchId}`)
        if (disposed) return
        const serverTime = Date.parse(data.serverTime)
        if (Number.isFinite(serverTime)) clockOffsetRef.current = serverTime - Date.now()
        if (data.match && data.match.game === game) applyMatch(data.match as T)
        if (data.invites) {
          setLocalIncoming((data.invites.incoming ?? []).map((invite) => ({ ...invite, game })))
          setLocalOutgoing((data.invites.outgoing ?? []).map((invite) => ({ ...invite, game })))
        }
        if (data.match?.reason === 'cancelled') {
          skipActiveCheckRef.current = true
          navigate(lobbyPath, { replace: true })
        }
      } catch {
        // 轮询失败静默重试
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), GAME_POLL_INTERVALS.match)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void poll()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      disposed = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [user, matchId, transport, apiBase, game, applyMatch, navigate, lobbyPath])

  // 轮询模式：presence 心跳
  useEffect(() => {
    if (!user || !matchId || transport !== 'polling') return
    if (match?.status === 'finished') return
    let disposed = false
    const ping = async () => {
      try {
        await api.post(`${apiBase}/presence`)
      } catch {
        // 下一轮重试
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
  }, [user, matchId, transport, apiBase, match?.status])

  // 大厅轮询模式下刷新邀请
  useEffect(() => {
    if (!user || matchId) return
    if (transport !== 'polling') return
    const timer = setInterval(() => void loadInvites(), GAME_POLL_INTERVALS.sync)
    return () => clearInterval(timer)
  }, [user, matchId, transport, loadInvites])

  // WS 模式进对局时校准一次时钟
  useEffect(() => {
    if (!user || !matchId || transport !== 'ws') return
    let cancelled = false
    api
      .get<SyncResponse>(`${apiBase}/sync?matchId=${matchId}`)
      .then((data) => {
        if (cancelled) return
        const serverTime = Date.parse(data.serverTime)
        if (Number.isFinite(serverTime)) clockOffsetRef.current = serverTime - Date.now()
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user, matchId, transport, apiBase])

  const turnDeadline = match?.status === 'playing'
    ? ((match as unknown as { turn?: { userId: number; deadline: string } | null }).turn?.deadline ?? null)
    : null
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

  const submitAction = useCallback(
    async (body: unknown): Promise<T | null> => {
      const id = matchIdRef.current
      const current = matchRef.current
      if (!id || !current || current.status !== 'playing') return null
      if (inFlightRef.current) return null
      inFlightRef.current = true
      setActionPending(true)
      try {
        const data = await api.post<MatchResponse>(`${apiBase}/matches/${id}/actions`, body)
        if (data.match.game !== game) throw new Error('对局类型不匹配')
        const next = data.match as T
        setMatch(next)
        setActionError(null)
        return next
      } catch (err) {
        setActionError(errorMessage(err, '提交失败，已重新同步'))
        void loadMatch(id, true)
        return null
      } finally {
        inFlightRef.current = false
        setActionPending(false)
      }
    },
    [apiBase, game, loadMatch],
  )

  const startMatch = useCallback(async () => {
    const id = matchIdRef.current
    if (!id) return
    setBusyKey('start')
    setActionError(null)
    try {
      const data = await api.post<MatchResponse>(`${apiBase}/matches/${id}/start`)
      setMatch(data.match as T)
    } catch (err) {
      setActionError(errorMessage(err, '开始对局失败'))
    } finally {
      setBusyKey(null)
    }
  }, [apiBase])

  const leaveRoom = useCallback(async () => {
    const id = matchIdRef.current
    const current = matchRef.current
    if (!id) return
    const isHost = current?.hostId === meId
    if (!window.confirm(isHost ? '确定解散房间吗？' : '确定离开房间吗？')) return
    setBusyKey('leave')
    setActionError(null)
    try {
      await api.post(`${apiBase}/matches/${id}/leave`)
      skipActiveCheckRef.current = true
      setMatch(null)
      navigate(lobbyPath, { replace: true })
    } catch (err) {
      setActionError(errorMessage(err, '离开房间失败'))
    } finally {
      setBusyKey(null)
    }
  }, [apiBase, meId, navigate, lobbyPath])

  const resign = useCallback(async () => {
    const id = matchIdRef.current
    const current = matchRef.current
    if (!id || !current || current.status !== 'playing') return
    if (!window.confirm('确定认输吗？本局你会记为失败。')) return
    setBusyKey('resign')
    setActionError(null)
    try {
      const data = await api.post<MatchResponse>(`${apiBase}/matches/${id}/resign`)
      setMatch(data.match as T)
    } catch (err) {
      setActionError(errorMessage(err, '认输失败'))
    } finally {
      setBusyKey(null)
    }
  }, [apiBase])

  const invite = useCallback(
    async (friendId: number) => {
      setBusyKey(`invite-${friendId}`)
      setActionError(null)
      try {
        const data = await api.post<InviteResponse>(`${apiBase}/invites`, { friendId })
        setLocalOutgoing((prev) => dedupeInvites([{ ...data.invite, game }, ...prev]))
        if (data.match && data.match.game === game && data.match.id !== matchIdRef.current) {
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
    [apiBase, game, navigate, matchPath, loadFriends],
  )

  const cancelInvite = useCallback(
    async (inviteId: number) => {
      setBusyKey(`cancel-${inviteId}`)
      setActionError(null)
      try {
        await api.delete(`${apiBase}/invites/${inviteId}`)
        setLocalOutgoing((prev) => prev.filter((item) => item.id !== inviteId))
      } catch (err) {
        setActionError(errorMessage(err, '取消对战邀请失败'))
      } finally {
        setBusyKey(null)
      }
    },
    [apiBase],
  )

  const respondInvite = useCallback(
    async (inviteId: number, action: 'accept' | 'decline') => {
      setBusyKey(`respond-${inviteId}`)
      setActionError(null)
      try {
        const data = await api.post<InviteRespondResponse>(
          `${apiBase}/invites/${inviteId}/respond`,
          { action },
        )
        setLocalIncoming((prev) => prev.filter((item) => item.id !== inviteId))
        if (action === 'accept' && data.match && data.match.game === game) {
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
    [apiBase, game, dismissStartedMatch, navigate, matchPath, loadInvites],
  )

  const pageIncomingInvites = useMemo(
    () => dedupeInvites([...localIncoming, ...globalIncoming.filter((invite) => invite.game === game)]),
    [localIncoming, globalIncoming, game],
  )
  const pageOutgoingInvites = useMemo(
    () => dedupeInvites([...localOutgoing, ...globalOutgoing.filter((invite) => invite.game === game)]),
    [localOutgoing, globalOutgoing, game],
  )

  const backToLobby = useCallback(() => {
    const current = matchRef.current
    if (current && current.status === 'playing') {
      const leave = window.confirm('对局仍在进行中，确定返回大厅吗？掉线超时会判负。')
      if (!leave) return
    }
    skipActiveCheckRef.current = true
    setMatch(null)
    setMatchError(null)
    setActionError(null)
    navigate(lobbyPath, { replace: true })
  }, [navigate, lobbyPath])

  const isHost = match !== null && match.hostId === meId
  const playerCount = match?.players.length ?? 0

  return {
    // 上下文
    user,
    authLoading,
    meId,
    loggedIn,
    transport,
    invitesError,
    // 路由
    matchId,
    highlightFriendId,
    lobbyPath,
    minPlayers,
    maxPlayers,
    // 数据
    match,
    matchLoading,
    matchError,
    friends,
    friendsLoading,
    friendsError,
    pageIncomingInvites,
    pageOutgoingInvites,
    actionError,
    setActionError,
    busyKey,
    actionPending,
    turnRemainingMs,
    isHost,
    playerCount,
    // 操作
    loadMatch,
    refreshLobby,
    startMatch,
    leaveRoom,
    resign,
    invite,
    cancelInvite,
    respondInvite,
    submitAction,
    backToLobby,
    applyMatch,
  }
}
