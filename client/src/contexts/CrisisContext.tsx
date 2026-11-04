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
import { usePoints } from './PointsContext'
import type { CrisisPayResult, CrisisStateDto } from '../types/crisis'

/** 任意 API 请求被危机守卫挡下时，lib/api.ts 会派发这个事件（与 401 集中处理同构） */
export const CRISIS_BLOCKED_EVENT = 'crisis:blocked'

interface CrisisContextValue {
  state: CrisisStateDto | null
  ready: boolean
  /** 当前是否处于「已缴清」以外的状态（有待缴账单） */
  hasLevy: boolean
  blocked: boolean
  refresh: () => Promise<CrisisStateDto | null>
  pay: (amount: number) => Promise<CrisisPayResult>
  /**
   * 切换积分税款开关（PUT /api/crisis/tax）。
   * 乐观更新本地 state，失败回滚并抛出原始错误（由页面决定怎么提示）；
   * 成功后异步重拉一次权威 state（带最新税率等），不阻塞开关交互。
   */
  setTaxEnabled: (enabled: boolean) => Promise<void>
}

const CrisisContext = createContext<CrisisContextValue | null>(null)

/** 待缴状态下每分钟校准一次；已封锁时每 5 秒一次——弹窗写着「缴清即刻恢复」，不能让人等一个分钟级轮询 */
const DUE_POLL_MS = 60_000
const BLOCKED_POLL_MS = 5000

export function CrisisProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { refresh: refreshPoints } = usePoints()
  const userId = user?.id ?? null
  const [state, setState] = useState<CrisisStateDto | null>(null)
  const [ready, setReady] = useState(false)
  const loadingRef = useRef(false)
  const stateRef = useRef<CrisisStateDto | null>(null)

  const refresh = useCallback(async (): Promise<CrisisStateDto | null> => {
    if (!userId) {
      stateRef.current = null
      setState(null)
      setReady(true)
      return null
    }
    if (loadingRef.current) return stateRef.current
    loadingRef.current = true
    try {
      const data = await api.get<CrisisStateDto>('/crisis/me')
      stateRef.current = data
      setState(data)
      return data
    } catch (err) {
      // 读账单失败不阻断站点：服务端守卫才是封锁的权威
      console.warn('[crisis] 读取危机账单失败：', err instanceof Error ? err.message : err)
      return stateRef.current
    } finally {
      loadingRef.current = false
      setReady(true)
    }
  }, [userId])

  const pay = useCallback(async (amount: number): Promise<CrisisPayResult> => {
    const result = await api.post<CrisisPayResult>('/crisis/pay', { amount })
    stateRef.current = result.state
    setState(result.state)
    // 上缴直接扣积分，余额要立刻跟上，否则积分页与危机页两处数字对不上
    void refreshPoints()
    return result
  }, [refreshPoints])

  const setTaxEnabled = useCallback(async (enabled: boolean): Promise<void> => {
    const prev = stateRef.current
    // 乐观更新：开关行立即翻转（state 是开关展示的唯一真相源）
    if (prev) {
      const optimistic = { ...prev, taxOptIn: enabled }
      stateRef.current = optimistic
      setState(optimistic)
    }
    try {
      await api.put<{ enabled: boolean }>('/crisis/tax', { enabled })
      // 服务端权威数据（含累计缴税等）异步跟上；不阻塞开关交互
      void refresh()
    } catch (err) {
      // 失败回滚到切换前的快照，再原样抛给页面提示
      if (prev) {
        stateRef.current = prev
        setState(prev)
      }
      throw err
    }
  }, [refresh])

  useEffect(() => {
    setReady(false)
    void refresh()
  }, [refresh])

  // 被封锁的即时感知：任意端点回 403 CRISIS_BLOCKED 就重新拉一次账单
  useEffect(() => {
    const onBlocked = () => {
      // 事件来自「已经封锁」的响应，强制刷新一次，让弹窗立刻带出准确数字
      loadingRef.current = false
      void refresh()
    }
    window.addEventListener(CRISIS_BLOCKED_EVENT, onBlocked)
    return () => window.removeEventListener(CRISIS_BLOCKED_EVENT, onBlocked)
  }, [refresh])

  useEffect(() => {
    if (!state?.enabled) return
    // 封锁中问得勤（外部缴清 / 管理员豁免都要尽快恢复），待缴时按分钟级就够
    const period = state.status === 'blocked' ? BLOCKED_POLL_MS : DUE_POLL_MS
    const interval = window.setInterval(() => {
      if (document.hidden) return
      const current = stateRef.current?.status
      if (current === 'due' || current === 'blocked') void refresh()
    }, period)
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [refresh, state?.enabled, state?.status])

  const value = useMemo<CrisisContextValue>(() => ({
    state,
    ready,
    hasLevy: state ? state.status !== 'clear' : false,
    blocked: state?.blocked === true,
    refresh,
    pay,
    setTaxEnabled,
  }), [state, ready, refresh, pay, setTaxEnabled])

  return <CrisisContext.Provider value={value}>{children}</CrisisContext.Provider>
}

export function useCrisis(): CrisisContextValue {
  const ctx = useContext(CrisisContext)
  if (!ctx) throw new Error('useCrisis must be used within CrisisProvider')
  return ctx
}

/** 无 Provider 场景（孤立组件 / 测试）下安全取用 */
export function useOptionalCrisis(): CrisisContextValue | null {
  return useContext(CrisisContext)
}
