import type { GameStatDto, SoloResultInput } from '../../types/gameStats'

export const EMPTY_GAME_STAT: Omit<GameStatDto, 'game' | 'variant'> = {
  games: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  deaths: 0,
  scoreTotal: 0,
  bestScore: 0,
  bestTimeMs: null,
  bestCombo: 0,
  bestCoins: 0,
  bestDistance: 0,
  totalJumps: 0,
  offsetSum: 0,
  offsetCount: 0,
}

/** 与服务端 gameStatsRules.buildSoloDelta 同口径的客户端乐观合并 */
export function applySoloResult(
  prev: GameStatDto | null,
  input: SoloResultInput,
): GameStatDto {
  const base = prev ?? { ...EMPTY_GAME_STAT, game: input.game, variant: input.variant }
  const next: GameStatDto = { ...base, game: input.game, variant: input.variant }
  next.games += 1
  if (input.outcome === 'win') next.wins += 1
  else if (input.outcome === 'loss') next.losses += 1
  else if (input.outcome === 'draw') next.draws += 1

  if (input.score !== undefined) {
    next.scoreTotal += input.score
    next.bestScore = Math.max(next.bestScore, input.score)
  }
  if (input.scoreDelta !== undefined) next.scoreTotal += input.scoreDelta
  if (input.timeMs !== undefined && input.outcome === 'win' && input.timeMs > 0) {
    next.bestTimeMs = next.bestTimeMs == null ? input.timeMs : Math.min(next.bestTimeMs, input.timeMs)
  }
  if (input.distanceM !== undefined) next.bestDistance = Math.max(next.bestDistance, input.distanceM)
  if (input.coins !== undefined) next.bestCoins = Math.max(next.bestCoins, input.coins)
  if (input.maxCombo !== undefined) next.bestCombo = Math.max(next.bestCombo, input.maxCombo)
  if (input.jumps !== undefined) next.totalJumps += input.jumps
  if (input.offset !== undefined) {
    next.offsetSum += Math.abs(input.offset)
    next.offsetCount += 1
  }
  if (input.deaths !== undefined) next.deaths += input.deaths
  return next
}
