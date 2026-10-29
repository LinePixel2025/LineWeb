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
import api from '../lib/api'
import { useAuth } from './AuthContext'
import type { LeaderTitleDto, PointsProfile, UserTitleDto } from '../types/points'

interface PointsContextValue {
  profile: PointsProfile | null
  ready: boolean
  /** 是否已登录（未登录时不请求 /points/me） */
  enabled: boolean
  balance: number
  title: UserTitleDto | null
  /** 当前持有的单机榜一传说称号 */
  leaderTitles: LeaderTitleDto[]
  /** 已购表情包 / 称号 key，用于表情商店解锁判断 */
  ownedKeys: string[]
  refresh: () => Promise<PointsProfile | null>
  /** 本地先扣减余额（购买后秒开），随后可用 refresh 校准 */
  applyLocalDelta: (delta: number) => void
}

const PointsContext = createContext<PointsContextValue | null>(null)

/**
 * 积分体系上下文：全站共享余额、佩戴称号与已购商品。
 * 游戏结算（单机 / 联机）后由调用方 refresh()，服务端台账为准。
 */
export function PointsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const enabled = !!user
  const userId = user?.id ?? null
  const [profile, setProfile] = useState<PointsProfile | null>(null)
  const [ready, setReady] = useState(false)
  const profileRef = useRef<PointsProfile | null>(null)

  const refresh = useCallback(async (): Promise<PointsProfile | null> => {
    if (!userId || !enabled) {
      profileRef.current = null
      setProfile(null)
      setReady(true)
      return null
    }
    try {
      const data = await api.get<PointsProfile>('/points/me')
      profileRef.current = data
      setProfile(data)
      return data
    } catch (err) {
      console.warn('[points] 加载积分失败：', err instanceof Error ? err.message : err)
      return profileRef.current
    } finally {
      setReady(true)
    }
  }, [userId, enabled])

  useEffect(() => {
    setReady(false)
    void refresh()
  }, [userId, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  const applyLocalDelta = useCallback((delta: number) => {
    if (!delta) return
    setProfile((prev) => {
      if (!prev) return prev
      const balance = Math.max(0, prev.balance + delta)
      const earned = delta > 0 ? prev.earned + delta : prev.earned
      return { ...prev, balance, earned }
    })
  }, [])

  const value = useMemo<PointsContextValue>(() => ({
    profile,
    ready,
    enabled,
    balance: profile?.balance ?? 0,
    title: profile?.title ?? null,
    leaderTitles: profile?.leaderTitles ?? [],
    ownedKeys: profile?.ownedKeys ?? [],
    refresh,
    applyLocalDelta,
  }), [profile, ready, enabled, refresh, applyLocalDelta])

  return <PointsContext.Provider value={value}>{children}</PointsContext.Provider>
}

export function usePoints() {
  const ctx = useContext(PointsContext)
  if (!ctx) throw new Error('usePoints must be used within PointsProvider')
  return ctx
}

/**
 * 允许在没有 PointsProvider 的极少数场景（孤立组件 / 测试）里安全取用，
 * 供 UserAvatar 这类被大量复用的基础组件读取「本人头像框」。
 */
export function useOptionalPoints(): PointsContextValue | null {
  return useContext(PointsContext)
}
