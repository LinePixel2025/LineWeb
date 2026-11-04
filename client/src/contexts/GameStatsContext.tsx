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
import { Link } from 'react-router-dom'
import api, { ApiError } from '../lib/api'
import { useAuth } from './AuthContext'
import { useFeature } from './FeatureContext'
import { usePoints } from './PointsContext'
import { applySoloResult } from '../lib/games/gameStatsMerge'
import { clearLegacyStats, collectLegacyStats } from '../lib/games/legacyStats'
import type { GameStatDto, SoloResultInput } from '../types/gameStats'
import type { GamePointsResult } from '../types/points'

interface TicketStatusDto {
  enabled: boolean
  tickets: number
  price: number
  refundPoints: number
  netCostPerMatch: number
}

interface GameStatsValue {
  ready: boolean
  imported: boolean
  getStat: (game: string, variant?: string) => GameStatDto | null
  recordResult: (input: SoloResultInput) => void
  refresh: () => Promise<void>
  /** 门票余票（门票系统未开启时为 0，UI 据此决定要不要展示徽标） */
  tickets: number
  ticketEnabled: boolean
  ticketPrice: number
  ticketRefund: number
  /**
   * 单机开局买票闸门：扣 1 张票并拿到本局会话 id，返回 false 表示没票（会就地弹购买引导）。
   * 门票系统关闭 / 未登录 / 游戏总开关关闭时一律放行，绝不把游戏卡死。
   */
  ensureTicket: (game: string, variant?: string) => Promise<boolean>
  /**
   * 关闭本局会话（不报战绩的玩法用，如「我的世界」单机）。
   * 服务端会返还 20 积分；没有未结算会话时是无操作。
   */
  closeTicketSession: () => Promise<void>
}

const GameStatsContext = createContext<GameStatsValue | null>(null)

function keyOf(game: string, variant: string): string {
  return `${game}:${variant}`
}

function indexStats(rows: GameStatDto[]): Record<string, GameStatDto> {
  const map: Record<string, GameStatDto> = {}
  for (const row of rows) map[keyOf(row.game, row.variant)] = row
  return map
}

export function GameStatsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { isEnabled } = useFeature()
  const points = usePoints()
  const pointsRefresh = points.refresh
  const gamesEnabled = isEnabled('games')
  const ticketFeatureOn = isEnabled('gameTicket')
  const userId = user?.id ?? null
  const [stats, setStats] = useState<Record<string, GameStatDto>>({})
  const [ready, setReady] = useState(false)
  const [imported, setImported] = useState(true)
  const [tickets, setTickets] = useState(0)
  const [ticketEnabled, setTicketEnabled] = useState(false)
  const [ticketDialog, setTicketDialog] = useState(false)
  const [ticketBusy, setTicketBusy] = useState(false)
  const migratingRef = useRef(false)
  /** 本局已付票的会话 id：终局上报带上它，服务端才会认可这一局的战绩与积分 */
  const sessionIdRef = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    if (!userId || !gamesEnabled) {
      setStats({})
      setImported(true)
      setReady(true)
      return
    }
    const data = await api.get<{ imported: boolean; stats: GameStatDto[] }>('/game-stats')
    setStats(indexStats(data.stats ?? []))
    setImported(!!data.imported)
    setReady(true)
    if (!data.imported && !migratingRef.current) {
      migratingRef.current = true
      try {
        const legacy = collectLegacyStats()
        const result = await api.post<{ imported: boolean; stats: GameStatDto[] }>(
          '/game-stats/import',
          { records: legacy.records },
        )
        setStats(indexStats(result.stats ?? []))
        setImported(!!result.imported)
        // 服务端幂等：无论本次是否真正导入，成功后都可以清理旧键
        clearLegacyStats(legacy.keys)
      } catch (err) {
        console.warn('[gameStats] 旧战绩迁移失败，下次登录重试：', err instanceof Error ? err.message : err)
      } finally {
        migratingRef.current = false
      }
    }
  }, [userId, gamesEnabled])

  useEffect(() => {
    setReady(false)
    void refresh().catch((err) => {
      console.warn('[gameStats] 加载战绩失败：', err instanceof Error ? err.message : err)
      setReady(true)
    })
  }, [refresh])

  const refreshTicket = useCallback(async () => {
    if (!userId || !gamesEnabled || !ticketFeatureOn) {
      setTicketEnabled(false)
      setTickets(0)
      return
    }
    try {
      const data = await api.get<TicketStatusDto>('/game-stats/ticket')
      setTicketEnabled(!!data.enabled)
      setTickets(Number.isFinite(data.tickets) ? data.tickets : 0)
    } catch (err) {
      // 门票状态读不到不阻塞游戏：只把界面上的票数藏起来
      setTicketEnabled(false)
      console.warn('[gameStats] 门票状态加载失败：', err instanceof Error ? err.message : err)
    }
  }, [userId, gamesEnabled, ticketFeatureOn])

  useEffect(() => {
    void refreshTicket()
  }, [refreshTicket])

  const getStat = useCallback((game: string, variant = 'solo') => {
    return stats[keyOf(game, variant)] ?? null
  }, [stats])

  const ensureTicket = useCallback(async (game: string, variant = 'single') => {
    if (!userId || !gamesEnabled) return true
    try {
      const data = await api.post<{ sessionId: number; ticketsLeft: number; balance: number }>(
        '/game-stats/session/start',
        { game, variant },
      )
      sessionIdRef.current = data.sessionId
      setTickets(Number.isFinite(data.ticketsLeft) ? data.ticketsLeft : 0)
      setTicketEnabled(true)
      return true
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TICKET_REQUIRED') {
        setTicketDialog(true)
        return false
      }
      // 服务端异常时放行：宁可少扣一张票，也不能让整站游戏打不开
      console.warn('[gameStats] 门票校验失败：', err instanceof Error ? err.message : err)
      return true
    }
  }, [userId, gamesEnabled])

  const recordResult = useCallback((input: SoloResultInput) => {
    if (!userId || !gamesEnabled) return
    const sessionId = sessionIdRef.current ?? undefined
    sessionIdRef.current = null
    const key = keyOf(input.game, input.variant)
    setStats((prev) => ({ ...prev, [key]: applySoloResult(prev[key] ?? null, input) }))
    void api.post<{ stat: GameStatDto; points?: GamePointsResult; ticket?: unknown }>(
      '/game-stats/result',
      sessionId ? { ...input, sessionId } : input,
    )
      .then((data) => {
        if (data?.stat) setStats((prev) => ({ ...prev, [key]: data.stat }))
        // 服务端已统一结算积分：刷新余额 / 排名 / 累计获得
        if (data?.points) void pointsRefresh()
        // 门票的 20 分返还走同一本积分台账，刷新余票与余额后界面立刻对得上
        if (data?.ticket) void refreshTicket()
      })
      .catch((err) => {
        console.warn('[gameStats] 上报战绩失败：', err instanceof Error ? err.message : err)
        void refresh().catch(() => {})
      })
  }, [userId, gamesEnabled, refresh, pointsRefresh, refreshTicket])

  const buyTicket = useCallback(async () => {
    if (ticketBusy) return
    setTicketBusy(true)
    try {
      await api.post('/pets/raid/shop/buy', { kind: 'item', key: 'game_ticket', amount: 1 })
      await Promise.all([refreshTicket(), pointsRefresh()])
      setTicketDialog(false)
    } catch (err) {
      console.warn('[gameStats] 购买门票失败：', err instanceof Error ? err.message : err)
    } finally {
      setTicketBusy(false)
    }
  }, [ticketBusy, refreshTicket, pointsRefresh])

  const closeTicketSession = useCallback(async () => {
    const sessionId = sessionIdRef.current
    sessionIdRef.current = null
    if (!sessionId) return
    try {
      await api.post('/game-stats/session/close', { sessionId })
      await Promise.all([refreshTicket(), pointsRefresh()])
    } catch (err) {
      console.warn('[gameStats] 关闭开局会话失败：', err instanceof Error ? err.message : err)
    }
  }, [refreshTicket, pointsRefresh])

  const value = useMemo<GameStatsValue>(() => ({
    ready,
    imported,
    getStat,
    recordResult,
    refresh,
    tickets,
    ticketEnabled,
    ticketPrice: 40,
    ticketRefund: 20,
    ensureTicket,
    closeTicketSession,
  }), [ready, imported, getStat, recordResult, refresh, tickets, ticketEnabled, ensureTicket, closeTicketSession])

  return (
    <GameStatsContext.Provider value={value}>
      {children}
      {ticketDialog && (
        <div className="gh-dialog-overlay" role="dialog" aria-modal="true" aria-label="需要游戏门票">
          <div className="gh-dialog gh-ticket-dialog">
            <h2 className="gh-dialog-title">🎟️ 还需要一张游戏门票</h2>
            <p className="gh-ticket-dialog-lead">
              游戏大厅每局都要消耗 1 张门票（{value.ticketPrice} 积分）。局终无论胜负都会返还{' '}
              {value.ticketRefund} 积分，所以每局净花 {value.ticketPrice - value.ticketRefund} 分，
              胜利积分另算。
            </p>
            <ul className="gh-ticket-dialog-hints">
              <li>官方商店可以直接买，40 积分一张，买多少都能堆在仓库里</li>
              <li>搜打撤的容器里也能摸到门票</li>
              <li>当前余票：{tickets} 张</li>
            </ul>
            <div className="gh-dialog-actions">
              <button type="button" className="gh-btn gh-btn--ghost" onClick={() => setTicketDialog(false)}>
                取消
              </button>
              <Link className="gh-btn gh-btn--secondary" to="/pets/raid/storage?tab=shop">
                去搜打撤商店
              </Link>
              <button
                type="button"
                className="gh-btn gh-btn--primary"
                disabled={ticketBusy}
                onClick={() => void buyTicket()}
              >
                {ticketBusy ? '购买中…' : `直接买 1 张（${value.ticketPrice} 积分）`}
              </button>
            </div>
          </div>
        </div>
      )}
    </GameStatsContext.Provider>
  )
}

export function useGameStats() {
  const ctx = useContext(GameStatsContext)
  if (!ctx) throw new Error('useGameStats must be used within GameStatsProvider')
  return ctx
}
