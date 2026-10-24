/**
 * 我的世界 · 好友联机（2–8 人共享体素世界）
 *
 * 结构与扫雷联机页同构（大厅 → 等待房间 → 对局 → 结算），差异在「对局」：
 *   - 世界不在服务端：开局拿到权威 seed 后各端本地生成（mcCreateWorld），
 *     并用 sync?since=0 拉全量修改日志回放，之后走增量；
 *   - 玩家位置：客户端权威（本地物理），~2Hz POST state 上报，
 *     其他玩家经 WS game:minecraft:state 到达（轮询模式下随 sync 2 秒一拍）；
 *   - 方块修改：本地立即生效，批量（150ms 窗口）POST edit；远端修改经
 *     WS game:minecraft:edit 到达，ref 句柄注入游戏视图重建受影响区块；
 *   - 没有胜负：Esc 菜单的「离开世界」= POST leave（房主离开会移交房主位）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import UserAvatar from '../../components/UserAvatar'
import GameFriendPicker from '../../components/games/GameFriendPicker'
import MinecraftGameView, { type MinecraftGameViewHandle } from '../../components/games/minecraft/MinecraftGameView'
import type { McRemotePlayerView } from '../../lib/games/minecraftScene'
import {
  mcApplyEdits,
  mcCreateWorld,
  mcSpawnForSeed,
  type McBlockEdit,
  type McWorld,
} from '../../lib/games/minecraft'
import { useAuth } from '../../contexts/AuthContext'
import { useChat } from '../../contexts/ChatContext'
import { useGame } from '../../contexts/GameContext'
import api from '../../lib/api'
import { GAME_POLL_INTERVALS } from '../../lib/realtime'
import { GAME_MINECRAFT_ONLINE_ROUTE, GAME_MINECRAFT_ROUTE } from '../../lib/games/catalog'
import type {
  GameFriend,
  GameFriendsResponse,
  GameInvite,
  GameInvitesResponse,
  GameMinecraftMatch,
  MinecraftActionBody,
  MinecraftEditDto,
  MinecraftMatchResponse,
  MinecraftActiveMatchResponse,
  MinecraftSyncResponse,
} from '../../types/game'

const API_BASE = '/games/minecraft'
const LOBBY_PATH = GAME_MINECRAFT_ONLINE_ROUTE
/** 共享世界房间：2–8 人 */
const MIN_PLAYERS = 2
const MAX_PLAYERS = 8

/** 位置上报间隔（毫秒）：~2Hz，配合服务端转发与端内插值 */
const STATE_SEND_INTERVAL_MS = 500
/** 本地方块修改的批量窗口（毫秒） */
const EDIT_FLUSH_INTERVAL_MS = 150
/** 远端玩家视图的刷新间隔（毫秒） */
const REMOTE_FLUSH_INTERVAL_MS = 250

interface MinecraftInviteResponse {
  invite: GameInvite
  match?: GameMinecraftMatch
}
interface MinecraftInviteRespondResponse {
  ok: boolean
  match?: GameMinecraftMatch
}
interface MinecraftActionResponse {
  applied: MinecraftEditDto[]
}

const END_REASON_LABELS: Record<GameMinecraftMatch['reason'] & string, string> = {
  cancelled: '房主解散了房间',
  abandoned: '所有玩家都离开了（或全员掉线超时），世界已关闭',
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

function toBlockEdit(edit: MinecraftEditDto): McBlockEdit {
  return { x: edit.x, y: edit.y, z: edit.z, b: edit.b }
}

/**
 * 我的世界好友联机：
 * - 无 matchId：先查进行中的世界（有则跳转），否则展示大厅（好友列表 + 邀请）。
 * - 有 matchId：等待房间 / 共享世界 / 关闭结算。
 * - 世界由各端按 seed 生成：服务端只存修改日志（增量 seq）与玩家快照。
 */
export default function MinecraftOnlinePage() {
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

  const matchId = matchIdParam && /^\d+$/.test(matchIdParam) ? Number.parseInt(matchIdParam, 10) : null
  const friendParam = searchParams.get('friend')
  const highlightFriendId = friendParam && /^\d+$/.test(friendParam) ? Number.parseInt(friendParam, 10) : null
  const loggedIn = user !== null

  const [match, setMatch] = useState<GameMinecraftMatch | null>(null)
  const [matchLoading, setMatchLoading] = useState(matchId !== null)
  const [matchError, setMatchError] = useState<string | null>(null)
  const [friends, setFriends] = useState<GameFriend[]>([])
  const [friendsLoading, setFriendsLoading] = useState(matchId === null)
  const [friendsError, setFriendsError] = useState<string | null>(null)
  const [localIncoming, setLocalIncoming] = useState<GameInvite[]>([])
  const [localOutgoing, setLocalOutgoing] = useState<GameInvite[]>([])
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  /** 世界构建三态：playing 且尚未构建完成时显示生成中 */
  const [worldPhase, setWorldPhase] = useState<'idle' | 'building' | 'ready'>('idle')
  const [remotePlayers, setRemotePlayers] = useState<McRemotePlayerView[]>([])

  const matchRef = useRef<GameMinecraftMatch | null>(null)
  const matchIdRef = useRef<number | null>(matchId)
  const skipActiveCheckRef = useRef(false)
  const worldRef = useRef<McWorld | null>(null)
  const spawnRef = useRef<{ x: number; y: number; z: number } | null>(null)
  /** 世界构建进行中标记（match 对象更新会重进构建 effect，避免重复生成） */
  const worldBuildingRef = useRef(false)
  const gameViewRef = useRef<MinecraftGameViewHandle | null>(null)
  /** 修改日志水位（增量同步） */
  const lastSeqRef = useRef(0)
  /** 待上送的本地修改队列 */
  const pendingEditsRef = useRef<McBlockEdit[]>([])
  /** 其他玩家的最新状态（WS / sync 到达，250ms 批量刷进视图） */
  const remoteStatesRef = useRef(new Map<number, GameMinecraftMatch['players'][number]['state']>())
  const remotePlayersRef = useRef<McRemotePlayerView[]>([])

  useEffect(() => {
    matchRef.current = match
  }, [match])

  useEffect(() => {
    matchIdRef.current = matchId
  }, [matchId])

  const applyMatch = useCallback((next: GameMinecraftMatch) => {
    setMatchError(null)
    setMatch((prev) => {
      if (!prev) return next
      if (next.id !== prev.id) return next
      if (next.version <= prev.version && next.status === prev.status) return prev
      return next
    })
  }, [])

  const loadMatch = useCallback(async (id: number, force = false) => {
    try {
      const data = await api.get<MinecraftMatchResponse>(`${API_BASE}/matches/${id}`)
      if (matchIdRef.current !== id) return
      if (force) setMatch(data.match)
      else applyMatch(data.match)
      setMatchError(null)
    } catch (err) {
      if (matchIdRef.current === id) setMatchError(errorMessage(err, '加载对局失败'))
    } finally {
      setMatchLoading(false)
    }
  }, [applyMatch])

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
    setActionError(null)
    setMatchError(null)

    if (matchId) {
      skipActiveCheckRef.current = false
      setMatch(null)
      setWorldPhase('idle')
      worldRef.current = null
      worldBuildingRef.current = false
      spawnRef.current = null
      lastSeqRef.current = 0
      remoteStatesRef.current.clear()
      setMatchLoading(true)
      void loadMatch(matchId, true)
      void loadInvites()
      return undefined
    }

    setMatch(null)
    if (skipActiveCheckRef.current) {
      // 主动返回大厅：不再自动跳回世界
      skipActiveCheckRef.current = false
      setMatchLoading(false)
      void loadFriends(true)
      void loadInvites()
      return undefined
    }

    setMatchLoading(true)
    setFriendsLoading(true)
    let cancelled = false
    api
      .get<MinecraftActiveMatchResponse>(`${API_BASE}/matches/active`)
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
    const timer = setInterval(() => void loadFriends(false), 15_000)
    return () => clearInterval(timer)
  }, [user, matchId, match?.status, loadFriends])

  useEffect(() => {
    if (!user || !matchId || match?.status !== 'waiting') return
    void loadFriends(true)
  }, [user, matchId, match?.status, loadFriends])

  // === 世界构建（seed → 本地生成 + 全量修改回放） ===

  useEffect(() => {
    if (!match || match.status !== 'playing' || match.seed === 0) return
    if (worldRef.current || worldBuildingRef.current) return
    worldBuildingRef.current = true
    setWorldPhase('building')
    let cancelled = false
    const buildMatchId = match.id
    const seed = match.seed
    const serverSpawn = match.world.spawn

    const buildPromise = new Promise<McWorld>((resolve) => {
      // 先让「正在生成世界」渲染一帧
      window.setTimeout(() => resolve(mcCreateWorld(seed)), 30)
    })
    const editsPromise = api
      .get<MinecraftSyncResponse>(`${API_BASE}/sync?matchId=${match.id}&since=0`)
      .then((data) => {
        const serverSeq = data.match?.editSeq ?? 0
        if (serverSeq > lastSeqRef.current) lastSeqRef.current = serverSeq
        return data.edits ?? []
      })
      .catch(() => [] as MinecraftEditDto[])

    void Promise.all([buildPromise, editsPromise]).then(([world, edits]) => {
      worldBuildingRef.current = false
      if (cancelled || matchIdRef.current !== buildMatchId) return
      mcApplyEdits(world, edits.map(toBlockEdit))
      worldRef.current = world
      spawnRef.current = serverSpawn ?? mcSpawnForSeed(seed)
      setWorldPhase('ready')
    })
    return () => {
      cancelled = true
    }
  }, [match])

  // === 远端玩家状态（WS state 事件 / sync 的 players 快照） → 视图批量刷新 ===

  useEffect(() => {
    if (!match || match.status !== 'playing' || worldPhase !== 'ready') return
    // 全量对局更新时顺带吸收 players 里的状态快照（从未上报的用出生点）
    for (const player of match.players) {
      if (player.userId === meId) continue
      if (player.state) remoteStatesRef.current.set(player.userId, player.state)
    }
  }, [match, meId, worldPhase])

  useEffect(() => {
    if (!match || match.status !== 'playing' || worldPhase !== 'ready') return undefined
    const timer = setInterval(() => {
      const views: McRemotePlayerView[] = []
      for (const player of match.players) {
        if (player.userId === meId) continue
        const state = remoteStatesRef.current.get(player.userId) ?? player.state
        if (!state) continue
        views.push({
          userId: player.userId,
          username: player.username,
          x: state.x,
          y: state.y,
          z: state.z,
          yaw: state.yaw,
          pitch: state.pitch,
        })
      }
      remotePlayersRef.current = views
      setRemotePlayers(views)
    }, REMOTE_FLUSH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [match, meId, worldPhase])

  // === WS 事件 ===

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
      if (event.match.game !== 'minecraft') return
      if (event.match.id !== matchId) return
      applyMatch(event.match)
      if (event.type === 'game:match:ended') {
        if (event.match.reason === 'cancelled') {
          skipActiveCheckRef.current = true
          navigate(LOBBY_PATH, { replace: true })
        }
        // abandoned：展示结算卡片（世界已关闭）
      }
    })
    return unsubscribe
  }, [matchId, transport, subscribe, applyMatch, navigate])

  // WS：玩家位置快照（轻量事件）
  useEffect(() => {
    if (!matchId || transport !== 'ws' || !user) return
    const unsubscribe = subscribe((event) => {
      if (event.type !== 'game:minecraft:state') return
      if (event.matchId !== matchId) return
      if (event.userId === meId) return
      remoteStatesRef.current.set(event.userId, event.state)
    })
    return unsubscribe
  }, [matchId, transport, user, meId])

  // WS：远端方块修改
  useEffect(() => {
    if (!matchId || transport !== 'ws' || !user) return
    const unsubscribe = subscribe((event) => {
      if (event.type !== 'game:minecraft:edit') return
      if (event.matchId !== matchId) return
      if (event.userId === meId) return
      const view = gameViewRef.current
      view?.applyRemoteEdits(event.edits.map(toBlockEdit))
      for (const edit of event.edits) {
        if (edit.seq > lastSeqRef.current) lastSeqRef.current = edit.seq
      }
    })
    return unsubscribe
  }, [matchId, transport, user, meId])

  // WS：邀请变化 → 补拉本页邀请
  useEffect(() => {
    if (!user || transport !== 'ws') return
    const unsubscribe = subscribe((event) => {
      if (event.type === 'game:invite' || event.type === 'game:invite:removed') void loadInvites()
    })
    return unsubscribe
  }, [user, transport, subscribe, loadInvites])

  // 传输模式切换时补拉一次对局
  useEffect(() => {
    if (!user || !matchId) return
    void loadMatch(matchId, false)
  }, [user, matchId, transport, loadMatch])

  // === 轮询降级 ===

  useEffect(() => {
    if (!user || !matchId || transport !== 'polling') return
    if (match?.status === 'finished') return undefined
    let disposed = false

    const poll = async () => {
      if (disposed) return
      try {
        const data = await api.get<MinecraftSyncResponse>(
          `${API_BASE}/sync?matchId=${matchId}&since=${lastSeqRef.current}`,
        )
        if (disposed) return
        if (data.match) applyMatch(data.match)
        if (data.match) {
          for (const player of data.match.players) {
            if (player.userId === meId) continue
            if (player.state) remoteStatesRef.current.set(player.userId, player.state)
          }
        }
        if (data.edits.length > 0) {
          gameViewRef.current?.applyRemoteEdits(data.edits.map(toBlockEdit))
          for (const edit of data.edits) {
            if (edit.seq > lastSeqRef.current) lastSeqRef.current = edit.seq
          }
        }
        if (data.match?.reason === 'cancelled' && data.match.status === 'finished') {
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
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [user, matchId, transport, applyMatch, navigate, match?.status, meId])

  // 轮询模式：20 秒 presence 心跳
  useEffect(() => {
    if (!user || !matchId || transport !== 'polling') return
    if (match?.status === 'finished') return undefined
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

  // 大厅轮询模式下也要能看到邀请
  useEffect(() => {
    if (!user || matchId) return
    if (transport !== 'polling') return
    const timer = setInterval(() => void loadInvites(), GAME_POLL_INTERVALS.sync)
    return () => clearInterval(timer)
  }, [user, matchId, transport, loadInvites])

  // === 本地 → 服务端 ===

  // 位置上报（~2Hz）：联机在玩时持续上报
  useEffect(() => {
    if (!user || !matchId || worldPhase !== 'ready') return undefined
    if (match?.status !== 'playing') return undefined
    const timer = setInterval(() => {
      const state = gameViewRef.current?.getPlayerState()
      if (!state) return
      const body: MinecraftActionBody = {
        type: 'state',
        x: state.x,
        y: state.y,
        z: state.z,
        yaw: state.yaw,
        pitch: state.pitch,
        flying: state.flying,
      }
      void api.post(`${API_BASE}/matches/${matchId}/actions`, body).catch(() => {
        // 上报失败静默：下一拍重试；位置只是快照，丢了不影响正确性
      })
    }, STATE_SEND_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [user, matchId, worldPhase, match?.status])

  // 本地修改批量上送（150ms 窗口，单批 ≤64）
  useEffect(() => {
    if (!user || !matchId || match?.status !== 'playing') return undefined
    const timer = setInterval(() => {
      const pending = pendingEditsRef.current
      if (pending.length === 0) return
      pendingEditsRef.current = []
      const body: MinecraftActionBody = { type: 'edit', edits: pending.slice(0, 64) }
      // 超过 64 的部分留给下一轮
      if (pending.length > 64) pendingEditsRef.current = pending.slice(64)
      void api
        .post<MinecraftActionResponse>(`${API_BASE}/matches/${matchId}/actions`, body)
        .then((data) => {
          for (const edit of data.applied ?? []) {
            if (edit.seq > lastSeqRef.current) lastSeqRef.current = edit.seq
          }
        })
        .catch(() => {
          // 上送失败：修改仍留在本地（其他玩家看不到这笔修改，直到重连后 sync 补齐口径——
          // 简化处理：不重试，避免编辑风暴；服务端水位于下次 sync 时对齐）
        })
    }, EDIT_FLUSH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [user, matchId, match?.status])

  const handleLocalEdit = useCallback((edit: McBlockEdit) => {
    pendingEditsRef.current.push(edit)
  }, [])

  // === 房间操作 ===

  const handleStart = useCallback(async () => {
    const id = matchIdRef.current
    if (!id) return
    setBusyKey('start')
    setActionError(null)
    try {
      const data = await api.post<MinecraftMatchResponse>(`${API_BASE}/matches/${id}/start`)
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
    const inWorld = current?.status === 'playing'
    const message = inWorld
      ? isHost
        ? '确定离开世界吗？房主位会移交给其他玩家，世界继续存在。'
        : '确定离开世界吗？世界会继续存在，想回来需要再次被邀请。'
      : isHost
        ? '确定解散房间吗？'
        : '确定离开房间吗？'
    if (!window.confirm(message)) return
    setBusyKey('leave')
    setActionError(null)
    try {
      await api.post(`${API_BASE}/matches/${id}/leave`)
      skipActiveCheckRef.current = true
      setMatch(null)
      worldRef.current = null
      worldBuildingRef.current = false
      setWorldPhase('idle')
      navigate(LOBBY_PATH, { replace: true })
    } catch (err) {
      setActionError(errorMessage(err, '离开失败'))
    } finally {
      setBusyKey(null)
    }
  }, [meId, navigate])

  const handleInvite = useCallback(
    async (friendId: number) => {
      setBusyKey(`invite-${friendId}`)
      setActionError(null)
      try {
        const data = await api.post<MinecraftInviteResponse>(`${API_BASE}/invites`, { friendId })
        setLocalOutgoing((prev) => dedupeInvites([data.invite, ...prev]))
        if (data.match && data.match.id !== matchIdRef.current) {
          navigate(matchPath(data.match.id))
        } else {
          void loadFriends(false)
        }
      } catch (err) {
        setActionError(errorMessage(err, '发送邀请失败'))
      } finally {
        setBusyKey(null)
      }
    },
    [navigate, loadFriends],
  )

  const handleCancelInvite = useCallback(async (inviteId: number) => {
    setBusyKey(`cancel-${inviteId}`)
    setActionError(null)
    try {
      await api.delete(`${API_BASE}/invites/${inviteId}`)
      setLocalOutgoing((prev) => prev.filter((invite) => invite.id !== inviteId))
    } catch (err) {
      setActionError(errorMessage(err, '取消邀请失败'))
    } finally {
      setBusyKey(null)
    }
  }, [])

  const handleRespondInvite = useCallback(
    async (inviteId: number, action: 'accept' | 'decline') => {
      setBusyKey(`respond-${inviteId}`)
      setActionError(null)
      try {
        const data = await api.post<MinecraftInviteRespondResponse>(
          `${API_BASE}/invites/${inviteId}/respond`,
          { action },
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
    [dismissStartedMatch, navigate, loadInvites],
  )

  const pageIncomingInvites = useMemo(
    () => dedupeInvites([...localIncoming, ...incomingInvites.filter((invite) => invite.game === 'minecraft')]),
    [localIncoming, incomingInvites],
  )
  const pageOutgoingInvites = useMemo(
    () => dedupeInvites([...localOutgoing, ...outgoingInvites.filter((invite) => invite.game === 'minecraft')]),
    [localOutgoing, outgoingInvites],
  )

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
          ? '位置与方块修改实时转发；世界由各端按 seed 本地生成。'
          : '轮询模式，约 2 秒延迟：位置与修改每 2 秒同步一次，仍可与好友共建世界。'}
      </span>
    </div>
  )

  if (!authLoading && !user) {
    return (
      <div className="gh-page-container gh-games-page gh-game-online-page">
        <section className="gh-ms-guest" aria-label="需要登录">
          <p className="gh-g2048-eyebrow">我的世界 · 好友联机</p>
          <h1 className="gh-games-title">登录后即可邀请好友共建世界</h1>
          <p className="gh-games-subtitle">
            联机需要账号：好友关系、邀请与世界修改都以账号身份进行。不想登录也可以先玩单机模式。
          </p>
          <div className="gh-ms-guest-actions">
            <Link className="gh-btn gh-btn--primary gh-btn--md" to="/login">
              去登录
            </Link>
            <Link className="gh-btn gh-btn--secondary gh-btn--md" to="/register">
              注册账号
            </Link>
            <Link className="gh-btn gh-btn--ghost gh-btn--md" to={GAME_MINECRAFT_ROUTE}>
              单机模式
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
          <section className="gh-game-room" aria-label="我的世界等待房间">
            <header className="gh-game-room-header">
              <div>
                <p className="gh-g2048-eyebrow">我的世界 · 共享世界房间</p>
                <h1 className="gh-games-title">等待玩家加入</h1>
                <p className="gh-games-subtitle">
                  开局后进入同一片 192×192 程序化世界：挖矿、建造、飞行，没有胜负，一起创造就好。
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
                  {busyKey === 'start' ? '正在生成世界…' : `开始游戏（${playerCount}/${MAX_PLAYERS}）`}
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

            {isHost && playerCount < MIN_PLAYERS && (
              <p className="gh-game-room-hint">至少 {MIN_PLAYERS} 人才能开始，先邀请好友进来吧。</p>
            )}

            <section className="gh-game-room-players" aria-label="房间成员">
              <h2 className="gh-game-room-section-title">成员（{playerCount}/{MAX_PLAYERS}）</h2>
              <ul className="gh-mc-seat-list">
                {match.players.map((player) => {
                  const isMe = player.userId === meId
                  const isRoomHost = player.userId === match.hostId
                  return (
                    <li key={player.userId} className={`gh-mc-seat${isMe ? ' gh-mc-seat--me' : ''}`}>
                      <UserAvatar userId={player.userId} username={player.username} size="md" />
                      <span className="gh-mc-seat-copy">
                        <span className="gh-mc-seat-name">
                          {player.username}
                          {isRoomHost && <span className="gh-game-room-badge">房主</span>}
                          {isMe && <span className="gh-game-room-badge gh-game-room-badge--me">你</span>}
                        </span>
                        <span className="gh-mc-seat-meta">
                          <span className={`gh-game-presence-dot${player.online ? ' gh-game-presence-dot--online' : ''}`} />
                          {player.online ? '在线' : '离线'}
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
              开局时服务端生成权威 seed，所有玩家在本地生成完全相同的世界（192×192×64）；
              服务端只保存方块修改日志与玩家位置快照。
            </p>
          </section>
        </div>
      )
    }

    // === 世界（进行中 / 已关闭） ===

    if (match.status === 'finished') {
      return (
        <div className="gh-page-container gh-games-page gh-game-online-page">
          <section className="gh-game-list-state gh-mc-closed" role="status">
            <p className="gh-game-list-state-title">🌐 世界已关闭</p>
            <p className="gh-game-list-state-hint">
              {match.reason ? END_REASON_LABELS[match.reason] : '这个世界已经结束。'}
            </p>
            <p className="gh-mc-closed-meta">本局共 {match.editCount} 笔方块修改 · 成员 {match.players.map((p) => p.username).join('、')}</p>
            <div className="gh-game-list-state-actions">
              <Link className="gh-btn gh-btn--primary gh-btn--md" to={LOBBY_PATH}>
                返回联机大厅
              </Link>
              <Link className="gh-btn gh-btn--secondary gh-btn--md" to={GAME_MINECRAFT_ROUTE}>
                去玩单机模式
              </Link>
            </div>
          </section>
        </div>
      )
    }

    if (worldPhase !== 'ready' || !worldRef.current || !spawnRef.current) {
      return (
        <div className="gh-page-container gh-games-page gh-mc-full">
          <div className="gh-mc-loading gh-mc-loading--dark">
            <div className="gh-spinner" />
            <p>正在生成共享世界…（seed {match.seed}）</p>
          </div>
        </div>
      )
    }

    return (
      <div className="gh-page-container gh-mc-full">
        <MinecraftGameView
          key={`mc-online-${match.id}`}
          ref={gameViewRef}
          world={worldRef.current}
          initialPlayer={spawnRef.current}
          selfUserId={meId}
          remotePlayers={remotePlayers}
          isOnline
          dayEnabled
          onLocalEdit={handleLocalEdit}
          exitLabel="离开世界"
          onExit={() => void handleLeaveRoom()}
        />
        <button
          type="button"
          className="gh-mc-back"
          onClick={() => void handleLeaveRoom()}
          title="离开世界"
        >
          ←
        </button>
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
          <h1 className="gh-games-title">我的世界 · 好友联机</h1>
          <p className="gh-games-subtitle">
            邀请好友进 2–{MAX_PLAYERS} 人共享世界：同一片程序化地形，各自挖掘建造，
            看得到彼此的小人与每一次方块变化。没有胜负，一起创造就好。
          </p>
        </div>
        <div className="gh-ms-header-actions">
          <Link className="gh-btn gh-btn--secondary gh-btn--md" to={GAME_MINECRAFT_ROUTE}>
            单机模式
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

      <div className="gh-ms-lobby-tips">
        <h2 className="gh-ms-lobby-tips-title">世界规则</h2>
        <ul className="gh-ms-lobby-tips-list">
          <li>房间 2–{MAX_PLAYERS} 人：房主开局后所有人进入由同一 seed 生成的 192×192×64 世界。</li>
          <li>创造式玩法：无限方块、即时挖掘（基岩除外）、双击空格飞行、10 分钟昼夜循环。</li>
          <li>你看到别人的方块小人与名字，你的每一次挖掘 / 放置也会实时出现在别人屏幕上。</li>
          <li>没有对局时长：想玩多久都行；全员离开或全员掉线 10 分钟后世界自动关闭。</li>
          <li>单个世界最多 3 万笔修改；服务端只存修改日志，世界本体在各端本地生成。</li>
        </ul>
      </div>

      <p className="gh-games-footnote">
        联机同步是「乐观」的：你自己的操作立即生效，服务端负责把修改与位置转发给别人；
        无 WebSocket 时自动降级为 2 秒轮询（位置为跳步而非补间）。
      </p>
    </div>
  )
}
