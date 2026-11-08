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
import { useFeature } from './FeatureContext'
import { usePoints } from './PointsContext'
import { applySoloResult } from '../lib/games/gameStatsMerge'
import { clearLegacyStats, collectLegacyStats } from '../lib/games/legacyStats'
import type { GameStatDto, SoloResultInput } from '../types/gameStats'
import type { GamePointsResult } from '../types/points'

interface GameStatsValue {
  ready: boolean
  imported: boolean
  getStat: (game: string, variant?: string) => GameStatDto | null
  recordResult: (input: SoloResultInput) => void
  refresh: () => Promise<void>
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
  const userId = user?.id ?? null
  const [stats, setStats] = useState<Record<string, GameStatDto>>({})
  const [ready, setReady] = useState(false)
  const [imported, setImported] = useState(true)
  const migratingRef = useRef(false)

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

  const getStat = useCallback((game: string, variant = 'solo') => {
    return stats[keyOf(game, variant)] ?? null
  }, [stats])

  const recordResult = useCallback((input: SoloResultInput) => {
    if (!userId || !gamesEnabled) return
    const key = keyOf(input.game, input.variant)
    setStats((prev) => ({ ...prev, [key]: applySoloResult(prev[key] ?? null, input) }))
    void api.post<{ stat: GameStatDto; points?: GamePointsResult }>('/game-stats/result', input)
      .then((data) => {
        if (data?.stat) setStats((prev) => ({ ...prev, [key]: data.stat }))
        // 服务端已统一结算积分：刷新余额 / 排名 / 累计获得
        if (data?.points) void pointsRefresh()
      })
      .catch((err) => {
        console.warn('[gameStats] 上报战绩失败：', err instanceof Error ? err.message : err)
        void refresh().catch(() => {})
      })
  }, [userId, gamesEnabled, refresh, pointsRefresh])

  const value = useMemo<GameStatsValue>(() => ({
    ready,
    imported,
    getStat,
    recordResult,
    refresh,
  }), [ready, imported, getStat, recordResult, refresh])

  return (
    <GameStatsContext.Provider value={value}>
      {children}
    </GameStatsContext.Provider>
  )
}

export function useGameStats() {
  const ctx = useContext(GameStatsContext)
  if (!ctx) throw new Error('useGameStats must be used within GameStatsProvider')
  return ctx
}
