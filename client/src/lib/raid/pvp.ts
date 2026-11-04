/**
 * 搜打撤 PvP 客户端（2026-11-04）
 *
 * 只做三件事：排队、上报位置、对玩家 / 佣兵开火。
 * 位置与状态都走 1.5 秒轮询（这个站点的联机功能本来就支持无 WebSocket 降级），
 * 伤害一律由服务端重算 —— 客户端拿到的 hp 只是展示值。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import api, { ApiError } from '../api'

export interface PvpLivePosition {
  x: number
  y: number
  angle: number
  roomId: number
  at: number
}

export interface PvpMerc {
  id: string
  faction: 'A' | 'B'
  name: string
  level: number
  hp: number
  maxHp: number
  roomId: number
  x: number
  y: number
}

export interface PvpPeer {
  userId: number
  username: string
  live: PvpLivePosition | null
}

export interface PvpQueueView {
  queueing: boolean
  position: number
  waitingMs: number
  matched: boolean
  matchId: string | null
  faction: 'A' | 'B' | null
  teammates: PvpPeer[]
  hostiles: PvpPeer[]
  mercs: PvpMerc[]
  teamSize: number
  fillMs: number
}

export interface PvpStateView {
  matchId: string
  faction: 'A' | 'B' | null
  hostiles: PvpPeer[]
  mercs: PvpMerc[]
  teammates: PvpPeer[]
  remainingMs: number
}

export interface PvpPosition {
  x: number
  y: number
  angle: number
  roomId: number
}

export interface PvpStrikeResult {
  ok: boolean
  damage: number
  targetHp: number
  targetMaxHp: number
  killed: boolean
  lootDropped: number
}

export interface PvpMercStrikeResult {
  ok: boolean
  mercId: string
  mercHp: number
  killed: boolean
}

const POS_INTERVAL_MS = 1500
const STATE_INTERVAL_MS = 1500

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message
  if (error instanceof Error && error.message) return error.message
  return fallback
}

interface UseRaidPvpOptions {
  /** 大厅里也想要排队状态，所以不要求处于对局中 */
  inMatch: boolean
  getPosition: () => PvpPosition | null
}

export function useRaidPvp({ inMatch, getPosition }: UseRaidPvpOptions) {
  const [queue, setQueue] = useState<PvpQueueView | null>(null)
  const [state, setState] = useState<PvpStateView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const posRef = useRef(getPosition)
  posRef.current = getPosition

  const refreshQueue = useCallback(async () => {
    try {
      const data = await api.get<PvpQueueView>('/pets/raid/pvp/queue')
      setQueue(data)
      return data
    } catch {
      return null
    }
  }, [])

  const enqueue = useCallback(async (mapKey: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      setQueue(await api.post<PvpQueueView>('/pets/raid/pvp/enqueue', { mapKey }))
    } catch (err) {
      setError(errorText(err, '进入匹配失败'))
    } finally {
      setBusy(false)
    }
  }, [busy])

  const cancel = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      setQueue(await api.post<PvpQueueView>('/pets/raid/pvp/cancel', {}))
      setState(null)
    } catch (err) {
      setError(errorText(err, '退出匹配失败'))
    } finally {
      setBusy(false)
    }
  }, [busy])

  const strike = useCallback(async (targetUserId: number) => {
    try {
      const result = await api.post<PvpStrikeResult>('/pets/raid/pvp/strike', { targetUserId })
      return result
    } catch (err) {
      // 409 PVP_RETRY 是目标刚被自己的事件写过，重试即可，不当成错误弹窗
      if (!(err instanceof ApiError && err.code === 'PVP_RETRY')) {
        setError(errorText(err, '开火失败'))
      }
      return null
    }
  }, [])

  const strikeMerc = useCallback(async (mercId: string) => {
    try {
      return await api.post<PvpMercStrikeResult>('/pets/raid/pvp/merc-strike', { mercId })
    } catch (err) {
      setError(errorText(err, '开火失败'))
      return null
    }
  }, [])

  // 排队 / 对局中的轮询：位置心跳 + 对手状态
  useEffect(() => {
    if (!inMatch) {
      // 没在对局里时只看排队状态（成局后 run 会自己出现，页面随之进入对局）
      const timer = window.setInterval(() => void refreshQueue(), STATE_INTERVAL_MS)
      void refreshQueue()
      return () => window.clearInterval(timer)
    }
    let alive = true
    const tick = async () => {
      const pos = posRef.current()
      if (pos) {
        void api.post('/pets/raid/pvp/pos', pos).catch(() => {})
      }
      try {
        const data = await api.get<{ state: PvpStateView | null }>('/pets/raid/pvp/state')
        if (alive) setState(data.state)
      } catch {
        // 404 表示对局已结束或不在匹配中：静默停掉面板即可
        if (alive) setState(null)
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), Math.max(POS_INTERVAL_MS, STATE_INTERVAL_MS))
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [inMatch, refreshQueue])

  return { queue, state, busy, error, setError, enqueue, cancel, strike, strikeMerc, refreshQueue }
}
