/**
 * 斗地主单机 AI（仅客户端使用，联机对局由真人 + 超时托管接管）
 *
 * 启发式策略，不追求最优：
 * - 叫分：按王 / 炸弹 / 2 / A 数量估手牌强度，给出 0–3 分意愿；
 * - 出牌：能一波走完立即走；主动出牌选「剩余手数最少、出牌更大」的组合；
 *   跟牌选最小可压组合；农民之间不互相压牌（除非能直接走完）；
 *   炸弹只在对手报牌（≤2 张）或自己快走完时使用。
 */

import {
  DOUDIZHU_RANK_2,
  DOUDIZHU_RANK_A,
  countDoudizhuHands,
  generateDoudizhuMoves,
  type DoudizhuCard,
  type DoudizhuCombo,
  type DoudizhuMove,
} from './doudizhu'

/** AI 出牌决策上下文（由单机页面组装） */
export interface DoudizhuAiContext {
  /** 我的角色 */
  myRole: 'landlord' | 'farmer'
  /** 我的手牌 */
  hand: DoudizhuCard[]
  /** 需要压住的上一手牌（null = 我主动出牌） */
  lastCombo: DoudizhuCombo | null
  /** 上一手是谁出的：'landlord' | 'teammate' | null（主动出牌时） */
  lastPlayedBy: 'landlord' | 'teammate' | null
  /** 地主剩余牌数 */
  landlordCards: number
  /** 下家剩余牌数（用于判断压力） */
  nextCards: number
}

/** 手牌强度（越大越强）：双王 / 炸弹 / 2 / A 加权 */
export function doudizhuHandStrength(hand: DoudizhuCard[]): number {
  let strength = 0
  const byRank = new Map<number, number>()
  for (const card of hand) {
    byRank.set(card.rank, (byRank.get(card.rank) ?? 0) + 1)
  }
  const jokers = (byRank.get(18) ?? 0) + (byRank.get(19) ?? 0)
  strength += jokers >= 2 ? 8 : jokers * 3
  for (const [rank, count] of byRank) {
    if (count === 4) strength += 6
    if (rank === DOUDIZHU_RANK_2) strength += count * 2
    if (rank === DOUDIZHU_RANK_A) strength += count * 0.5
  }
  if (jokers >= 2) strength += 2
  return strength
}

/**
 * AI 叫分（0 = 不叫）：desired 为强度映射的心理价位，须高于 currentHighest 才有效。
 */
export function aiDoudizhuBid(hand: DoudizhuCard[], currentHighest: number): number {
  const strength = doudizhuHandStrength(hand)
  let desired = 0
  if (strength >= 9) desired = 3
  else if (strength >= 6) desired = 2
  else if (strength >= 3.5) desired = 1
  if (desired > currentHighest) return desired
  // 已有人叫 3 之外的最高分且自己牌很好时可以顶到 3
  if (currentHighest === 2 && strength >= 11) return 3
  return 0
}

/** 出完后剩余手牌的「手数」 */
function handsAfter(hand: DoudizhuCard[], move: DoudizhuMove): number {
  const ids = new Set(move.cards.map((card) => card.id))
  return countDoudizhuHands(hand.filter((card) => !ids.has(card.id)))
}

/**
 * AI 出牌决策；返回 null 表示不出（跟牌无可压 / 战术性过牌）。
 */
export function aiDoudizhuPlay(ctx: DoudizhuAiContext): DoudizhuMove | null {
  const { hand, lastCombo, myRole, landlordCards, nextCards } = ctx
  if (hand.length === 0) return null

  const moves = generateDoudizhuMoves(hand, lastCombo)

  // 能一手打完就直接赢
  const finisher = moves.find((move) => move.cards.length === hand.length)
  if (finisher) return finisher

  // === 跟牌 ===
  if (lastCombo !== null) {
    if (moves.length === 0) return null

    // 农民不压队友，除非能直接走完（上面已处理）
    if (myRole === 'farmer' && ctx.lastPlayedBy === 'teammate') {
      // 队友快走完了，让牌
      return null
    }

    const isOpponentLow = myRole === 'farmer' ? landlordCards <= 2 : nextCards <= 2
    const normal = moves.filter((move) => move.combo.type !== 'bomb' && move.combo.type !== 'rocket')

    if (normal.length > 0) {
      // 选「压完后手数最少」的最小组合；平手选主牌点数最小
      let best = normal[0]
      let bestScore = Number.POSITIVE_INFINITY
      for (const move of normal) {
        const score = handsAfter(hand, move) * 100 + move.combo.rank
        if (score < bestScore) {
          bestScore = score
          best = move
        }
      }
      // 对手报单时避免出小单张送牌
      if (
        isOpponentLow
        && best.combo.type === 'single'
        && best.combo.rank < DOUDIZHU_RANK_A
      ) {
        const higher = normal
          .filter((move) => move.combo.type === 'single')
          .sort((a, b) => b.combo.rank - a.combo.rank)[0]
        if (higher) return higher
      }
      return best
    }

    // 只剩炸弹 / 王炸能压：对手报牌或自己只剩 ≤4 张时才动用
    const bombs = moves // 此时全是 bomb/rocket
    if (bombs.length === 0) return null
    if (isOpponentLow || hand.length <= 4) return bombs[0]
    return null
  }

  // === 主动出牌 ===
  if (moves.length === 0) return null

  // 只剩 1 张：直接出；剩 2 张有对子出对子
  if (hand.length === 1) return moves.find((m) => m.combo.type === 'single') ?? moves[0]
  if (hand.length === 2) {
    const pair = moves.find((m) => m.combo.type === 'pair')
    if (pair) return pair
    return moves.find((m) => m.combo.type === 'single') ?? moves[0]
  }

  let best: DoudizhuMove | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const move of moves) {
    // 主动出牌偏好：手数少 > 出牌张数多（先跑量） > 主牌点数低（留大牌控场）
    const score =
      handsAfter(hand, move) * 1000 - move.combo.size * 10 + move.combo.rank
    if (score < bestScore) {
      bestScore = score
      best = move
    }
  }
  // 对手报单时主动出牌避免送小单张：有非单张选择就不出小单张
  const opponentLow = myRole === 'farmer' ? landlordCards <= 2 : nextCards <= 2
  if (opponentLow && best && best.combo.type === 'single' && best.combo.rank < DOUDIZHU_RANK_A) {
    const alternative = moves
      .filter((m) => m.combo.type !== 'single')
      .sort((a, b) => a.combo.rank - b.combo.rank)[0]
    if (alternative) return alternative
  }
  return best
}
