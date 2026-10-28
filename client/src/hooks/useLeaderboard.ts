import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'
import { queryKeys } from '../lib/queryKeys'
import type { LeaderboardResponse } from '../types/gameStats'

export function useLeaderboard(game: string, variant: string, page = 1) {
  return useQuery({
    queryKey: queryKeys.games.leaderboard(game, variant, page),
    queryFn: () => api.get<LeaderboardResponse>(
      `/game-stats/leaderboard?game=${encodeURIComponent(game)}&variant=${encodeURIComponent(variant)}&limit=50&page=${page}`,
    ),
    enabled: !!game && !!variant,
    staleTime: 60_000,
  })
}
