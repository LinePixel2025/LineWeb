/**
 * 搜打撤好友组队：状态获取、WS 订阅与轮询降级、邀请与出击动作。
 *
 * 口径与站内其他联机游戏一致：有 WebSocket 时靠 `raid:squad:*` 事件推送，
 * 没有 WebSocket（transport === 'polling'）时按间隔轮询；页面隐藏时暂停轮询。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api, { ApiError } from '../api'
import { useChat } from '../../contexts/ChatContext'
import type {
  RaidSquad,
  RaidSquadFriend,
  RaidSquadInvite,
  RaidSquadMember,
  RaidSquadStartResult,
  RaidSquadView,
  RaidSquadWorldDelta,
} from '../../types/raidSquad'

const SQUAD_API = '/pets/raid/squad'
/** 大厅轮询间隔（无 WS 时） */
const LOBBY_POLL_MS = 3000
/** 战斗中队友状态轮询间隔（无 WS 时） */
const MATCH_POLL_MS = 2000

function errMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.message ? error.message : fallback
}

export interface UseRaidSquadOptions {
  enabled?: boolean
  /** 当前登录用户 id，用于判断是否为房主 */
  selfUserId?: number
  onWorld?: (delta: RaidSquadWorldDelta) => void
  onStarted?: (squad: RaidSquad) => void
}

export interface UseRaidSquadResult {
  squad: RaidSquad | null
  members: RaidSquadMember[]
  friends: RaidSquadFriend[]
  incoming: RaidSquadInvite[]
  outgoing: RaidSquadInvite[]
  loading: boolean
  busy: boolean
  error: string
  failed: RaidSquadStartResult['failed']
  isHost: boolean
  inSquad: boolean
  inMatch: boolean
  refresh: () => Promise<void>
  invite: (userId: number) => Promise<void>
  respond: (inviteId: number, accept: boolean) => Promise<void>
  cancel: (inviteId: number) => Promise<void>
  leave: () => Promise<void>
  kick: (userId: number) => Promise<void>
  start: (mapKey: string, insured: boolean) => Promise<void>
  /** 对局事件批处理响应里带回的队友状态（轮询降级路径） */
  applyEventBatchSquad: (payload: { members?: RaidSquadMember[] } | null | undefined) => void
}

export function useRaidSquad(options: UseRaidSquadOptions = {}): UseRaidSquadResult {
  const { enabled = true, selfUserId = 0 } = options
  const { transport, subscribe } = useChat()
  const callbacksRef = useRef({ onWorld: options.onWorld, onStarted: options.onStarted })
  callbacksRef.current = { onWorld: options.onWorld, onStarted: options.onStarted }

  const [squad, setSquad] = useState<RaidSquad | null>(null)
  const [friends, setFriends] = useState<RaidSquadFriend[]>([])
  const [incoming, setIncoming] = useState<RaidSquadInvite[]>([])
  const [outgoing, setOutgoing] = useState<RaidSquadInvite[]>([])
  const [loading, setLoading] = useState(enabled)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [failed, setFailed] = useState<RaidSquadStartResult['failed']>([])

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const load = useCallback(async (silent: boolean): Promise<void> => {
    if (!enabled) return
    if (!silent) setLoading(true)
    try {
      const view = await api.get<RaidSquadView>(SQUAD_API)
      if (!mountedRef.current) return
      setSquad(view.squad)
      setFriends(view.friends ?? [])
      setIncoming(view.incoming ?? [])
      setOutgoing(view.outgoing ?? [])
      if (!silent) setError('')
    } catch (err) {
      if (mountedRef.current && !silent) setError(errMessage(err, '加载组队信息失败'))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    void load(false)
  }, [enabled, load])

  const loadState = useCallback(async (): Promise<void> => {
    if (!enabled) return
    try {
      const view = await api.get<{ serverTime: string; squad: RaidSquad | null }>(`${SQUAD_API}/state`)
      if (mountedRef.current && view.squad) setSquad(view.squad)
    } catch {
      /* 轮询失败保持旧数据，下个周期自愈 */
    }
  }, [enabled])

  /* ---------- WS 事件 ---------- */

  useEffect(() => {
    if (!enabled) return
    const unsubscribe = subscribe((event) => {
      switch (event.type) {
        case 'raid:squad:invite':
          setIncoming((current) => (current.some((item) => item.id === event.invite.id) ? current : [event.invite, ...current]))
          break
        case 'raid:squad:invite:removed':
          setIncoming((current) => current.filter((item) => item.id !== event.inviteId))
          setOutgoing((current) => current.filter((item) => item.id !== event.inviteId))
          break
        case 'raid:squad:update':
          setSquad(event.squad)
          break
        case 'raid:squad:state':
          if (event.squad) setSquad(event.squad)
          break
        case 'raid:squad:started':
          setSquad(event.squad)
          callbacksRef.current.onStarted?.(event.squad)
          break
        case 'raid:squad:world':
          callbacksRef.current.onWorld?.({
            squadId: event.squadId,
            byUserId: event.byUserId,
            byName: event.byName,
            killedEnemies: event.killedEnemies,
            openedContainers: event.openedContainers,
            takenLoot: event.takenLoot,
          })
          break
        default:
          break
      }
    })
    return unsubscribe
  }, [enabled, subscribe])

  /* ---------- 无 WebSocket 时轮询 ---------- */

  useEffect(() => {
    if (!enabled || transport !== 'polling') return
    const interval = squad?.status === 'match' ? MATCH_POLL_MS : LOBBY_POLL_MS
    let timer = 0
    const tick = (): void => {
      if (document.hidden) return
      void (squad?.status === 'match' ? loadState() : load(true))
    }
    timer = window.setInterval(tick, interval)
    const onVisible = (): void => {
      if (!document.hidden) tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, transport, squad?.status, load, loadState])

  /* ---------- 动作 ---------- */

  const run = useCallback(async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await action()
      setError('')
    } catch (err) {
      setError(errMessage(err, '操作失败'))
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }, [])

  const invite = useCallback((userId: number) => run(async () => {
    const result = await api.post<{ squad: RaidSquad }>(`${SQUAD_API}/invite`, { userId })
    setSquad(result.squad)
    await load(true)
  }), [run, load])

  const respond = useCallback((inviteId: number, accept: boolean) => run(async () => {
    const result = await api.post<{ squad: RaidSquad | null }>(`${SQUAD_API}/respond`, { inviteId, accept })
    if (result.squad) setSquad(result.squad)
    await load(true)
  }), [run, load])

  const cancel = useCallback((inviteId: number) => run(async () => {
    await api.post<{ ok: boolean }>(`${SQUAD_API}/cancel`, { inviteId })
    setOutgoing((current) => current.filter((item) => item.id !== inviteId))
  }), [run])

  const leave = useCallback(() => run(async () => {
    const result = await api.post<{ ok: boolean; squad: RaidSquad | null }>(`${SQUAD_API}/leave`, {})
    setSquad(result.squad)
    setFailed([])
  }), [run])

  const kick = useCallback((userId: number) => run(async () => {
    const result = await api.post<{ ok: boolean; squad: RaidSquad }>(`${SQUAD_API}/kick`, { userId })
    setSquad(result.squad)
  }), [run])

  const start = useCallback((mapKey: string, insured: boolean) => run(async () => {
    const result = await api.post<RaidSquadStartResult>(`${SQUAD_API}/start`, { mapKey, insured })
    setSquad(result.squad)
    setFailed(result.failed ?? [])
    callbacksRef.current.onStarted?.(result.squad)
  }), [run])

  const applyEventBatchSquad = useCallback((payload: { members?: RaidSquadMember[] } | null | undefined): void => {
    if (!payload?.members) return
    setSquad((current) => (current ? { ...current, members: payload.members as RaidSquadMember[] } : current))
  }, [])

  const members = squad?.members ?? []
  const isHost = Boolean(squad && squad.hostUserId === selfUserId)
  const inSquad = Boolean(squad)
  const inMatch = squad?.status === 'match'

  return useMemo(() => ({
    squad,
    members,
    friends,
    incoming,
    outgoing,
    loading,
    busy,
    error,
    failed,
    isHost,
    inSquad,
    inMatch,
    refresh: () => load(false),
    invite,
    respond,
    cancel,
    leave,
    kick,
    start,
    applyEventBatchSquad,
  }), [
    squad, members, friends, incoming, outgoing, loading, busy, error, failed,
    isHost, inSquad, inMatch, load, invite, respond, cancel, leave, kick, start, applyEventBatchSquad,
  ])
}
