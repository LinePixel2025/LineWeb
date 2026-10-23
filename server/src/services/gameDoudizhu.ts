/**
 * 斗地主纯规则引擎（服务端权威）
 *
 * 纯函数、无 IO、无隐式随机源：随机数由显式传入的 `random()` 产生。
 * 与前端单机引擎 `client/src/lib/games/doudizhu.ts` 保持一致
 * （由 `client/src/lib/games/__tests__/doudizhu.test.ts` 的对齐测试兜底）。
 *
 * 规则口径（经典 3 人斗地主）：
 * - 54 张牌（52 常规 + 大小王），3 名玩家各 17 张，3 张底牌归地主；
 * - 叫分定地主：依次叫 0–3 分（0 = 不叫），必须高于当前最高分，3 分立即成交；
 * - 牌型：单张 / 对子 / 三张 / 三带一 / 三带二 / 顺子(≥5) / 连对(≥3连) /
 *   飞机(≥2连三，可带同数量单牌或对子) / 四带二单 / 四带二对 / 炸弹 / 王炸；
 * - 2 与双王不参与顺子 / 连对 / 飞机本体；炸弹与王炸可压任意牌型，
 *   其余牌型必须同型同长度比主牌点数；
 * - 炸弹 / 王炸每出一个使倍率 ×2；春天（地主赢且农民整局未出牌）与
 *   反春（农民赢且地主只出过第一手）同样 ×2。
 */

// === 卡牌 ===

/** 一张牌：id 全牌堆唯一（0–53），rank 为比较用点数，suit 0–3 为 ♠♥♣♦、4 为王 */
export interface DoudizhuCard {
  id: number
  rank: number
  suit: number
}

export const DOUDIZHU_RANK_J = 11
export const DOUDIZHU_RANK_Q = 12
export const DOUDIZHU_RANK_K = 13
export const DOUDIZHU_RANK_A = 14
export const DOUDIZHU_RANK_2 = 16
export const DOUDIZHU_RANK_JOKER_S = 18
export const DOUDIZHU_RANK_JOKER_B = 19

/** 顺子 / 连对 / 飞机本体允许的最大点数（A） */
const MAX_CHAIN_RANK = DOUDIZHU_RANK_A

/** 花色显示字符（下标即 suit；♥♦ 为红色） */
export const DOUDIZHU_SUIT_LABELS = ['♠', '♥', '♣', '♦'] as const

/** 点数显示字符 */
export const DOUDIZHU_RANK_LABELS: Record<number, string> = {
  3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 16: '2', 18: '王', 19: '王',
}

/** 卡牌显示文本（如 '♠3'、'♥A'、'大王'） */
export function doudizhuCardLabel(card: DoudizhuCard): string {
  if (card.rank === DOUDIZHU_RANK_JOKER_S) return '小王'
  if (card.rank === DOUDIZHU_RANK_JOKER_B) return '大王'
  return DOUDIZHU_SUIT_LABELS[card.suit] + DOUDIZHU_RANK_LABELS[card.rank]
}

/** 是否红色牌（♥ / ♦ / 大小王，用于样式着色） */
export function isDoudizhuRedCard(card: DoudizhuCard): boolean {
  if (card.suit === 4) return true
  return card.suit === 1 || card.suit === 3
}

/** 创建有序 54 张牌堆（id：suit*13+idx，52 = 小王，53 = 大王） */
export function createDoudizhuDeck(): DoudizhuCard[] {
  const deck: DoudizhuCard[] = []
  for (let suit = 0; suit < 4; suit += 1) {
    for (let idx = 0; idx < 13; idx += 1) {
      const rank = idx === 12 ? DOUDIZHU_RANK_2 : idx + 3
      deck.push({ id: suit * 13 + idx, rank, suit })
    }
  }
  deck.push({ id: 52, rank: DOUDIZHU_RANK_JOKER_S, suit: 4 })
  deck.push({ id: 53, rank: DOUDIZHU_RANK_JOKER_B, suit: 4 })
  return deck
}

/** Fisher–Yates 洗牌（不修改入参） */
export function shuffleDoudizhuDeck(deck: DoudizhuCard[], random: () => number): DoudizhuCard[] {
  const cards = deck.slice()
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.min(Math.floor(random() * (i + 1)), i)
    const temp = cards[i]
    cards[i] = cards[j]
    cards[j] = temp
  }
  return cards
}

/** 手牌排序（点数升序，同点数按 id），不修改入参 */
export function sortDoudizhuCards(cards: DoudizhuCard[]): DoudizhuCard[] {
  return [...cards].sort((a, b) => a.rank - b.rank || a.id - b.id)
}

/** 发牌：17/17/17 + 3 张底牌（全部已排序） */
export function dealDoudizhu(random: () => number): {
  hands: DoudizhuCard[][]
  bottom: DoudizhuCard[]
} {
  const shuffled = shuffleDoudizhuDeck(createDoudizhuDeck(), random)
  return {
    hands: [
      sortDoudizhuCards(shuffled.slice(0, 17)),
      sortDoudizhuCards(shuffled.slice(17, 34)),
      sortDoudizhuCards(shuffled.slice(34, 51)),
    ],
    bottom: sortDoudizhuCards(shuffled.slice(51)),
  }
}

// === 牌型 ===

export type DoudizhuComboType =
  | 'single'
  | 'pair'
  | 'trio'
  | 'trio1'
  | 'trio2'
  | 'straight'
  | 'pairStraight'
  | 'plane'
  | 'plane1'
  | 'plane2'
  | 'four1'
  | 'four2'
  | 'bomb'
  | 'rocket'

/**
 * 牌型结构：
 * - type：牌型；
 * - rank：主牌点数（顺子 / 连对 / 飞机取本体最大点数）；
 * - size：总张数；
 * - chain：连续组数（顺子 = 张数、连对 = 对数、飞机 = 三张连数，其余 = 1）。
 */
export interface DoudizhuCombo {
  type: DoudizhuComboType
  rank: number
  size: number
  chain: number
}

function combo(type: DoudizhuComboType, rank: number, size: number, chain: number): DoudizhuCombo {
  return { type, rank, size, chain }
}

/** 牌型中文名（对局展示用） */
export function doudizhuComboLabel(c: DoudizhuCombo): string {
  switch (c.type) {
    case 'single': return '单张'
    case 'pair': return '对子'
    case 'trio': return '三张'
    case 'trio1': return '三带一'
    case 'trio2': return '三带二'
    case 'straight': return `顺子（${c.size} 张）`
    case 'pairStraight': return `连对（${c.chain} 连对）`
    case 'plane': return `飞机（${c.chain} 连三）`
    case 'plane1': return `飞机带单（${c.chain} 连三）`
    case 'plane2': return `飞机带对（${c.chain} 连三）`
    case 'four1': return '四带二单'
    case 'four2': return '四带二对'
    case 'bomb': return '炸弹'
    case 'rocket': return '王炸'
  }
}

function rankCounts(cards: DoudizhuCard[]): Map<number, number> {
  const counts = new Map<number, number>()
  for (const card of cards) {
    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1)
  }
  return counts
}

/** 点数是否连续递增（升序数组） */
function isConsecutiveRanks(ranks: number[]): boolean {
  for (let i = 1; i < ranks.length; i += 1) {
    if (ranks[i] !== ranks[i - 1] + 1) return false
  }
  return true
}

/**
 * 识别一组牌构成的牌型；非法返回 null。
 * 对多义牌型按「不拆炸弹、本体取最长」的口径解析（如 333444555 优先纯飞机）。
 */
export function parseDoudizhuCombo(cards: DoudizhuCard[]): DoudizhuCombo | null {
  const size = cards.length
  if (size === 0) return null

  const counts = rankCounts(cards)
  const ranks = [...counts.keys()].sort((a, b) => a - b)
  const ranksWithCount = (n: number): number[] => ranks.filter((r) => counts.get(r) === n)

  if (size === 2 && counts.get(DOUDIZHU_RANK_JOKER_S) === 1 && counts.get(DOUDIZHU_RANK_JOKER_B) === 1) {
    return combo('rocket', DOUDIZHU_RANK_JOKER_B, 2, 1)
  }
  if (size === 1) return combo('single', ranks[0], 1, 1)
  if (size === 2 && ranks.length === 1) return combo('pair', ranks[0], 2, 1)
  if (size === 3 && ranks.length === 1) return combo('trio', ranks[0], 3, 1)
  if (size === 4 && ranks.length === 1) return combo('bomb', ranks[0], 4, 1)
  if (size === 4 && ranksWithCount(3).length === 1) return combo('trio1', ranksWithCount(3)[0], 4, 1)
  if (size === 5 && ranksWithCount(3).length === 1 && ranksWithCount(2).length === 1) {
    return combo('trio2', ranksWithCount(3)[0], 5, 1)
  }

  // 顺子：全部单张、≥5 连、最大到 A
  if (
    size >= 5
    && ranks.length === size
    && isConsecutiveRanks(ranks)
    && ranks[ranks.length - 1] <= MAX_CHAIN_RANK
  ) {
    return combo('straight', ranks[ranks.length - 1], size, size)
  }

  // 连对：全部对子、≥3 连、最大到 A
  if (
    size >= 6
    && size % 2 === 0
    && ranks.length === size / 2
    && ranksWithCount(2).length === ranks.length
    && isConsecutiveRanks(ranks)
    && ranks[ranks.length - 1] <= MAX_CHAIN_RANK
  ) {
    return combo('pairStraight', ranks[ranks.length - 1], size, ranks.length)
  }

  // 纯飞机：全部三张、≥2 连、最大到 A
  if (
    size >= 6
    && size % 3 === 0
    && ranks.length === size / 3
    && ranksWithCount(3).length === ranks.length
    && isConsecutiveRanks(ranks)
    && ranks[ranks.length - 1] <= MAX_CHAIN_RANK
  ) {
    return combo('plane', ranks[ranks.length - 1], size, ranks.length)
  }

  // 飞机带翅膀：连续三张本体 + 同数量单牌（plane1，size=4n）或对子（plane2，size=5n）
  const trioCandidates = ranks.filter((r) => (counts.get(r) ?? 0) >= 3 && r <= MAX_CHAIN_RANK)
  for (let chain = trioCandidates.length; chain >= 2; chain -= 1) {
    // 从最长连数开始、同一连数从高点向低点找第一个可用窗口
    for (let end = trioCandidates.length - 1; end >= chain - 1; end -= 1) {
      const window = trioCandidates.slice(end - chain + 1, end + 1)
      if (!isConsecutiveRanks(window)) continue

      const kickers = new Map<number, number>()
      let valid = true
      for (const [rank, count] of counts) {
        const taken = window.includes(rank) ? 3 : 0
        const rest = count - taken
        if (rest > 0) kickers.set(rank, rest)
      }
      if (kickers.size === 0) continue

      let pairsOnly = true
      for (const [rank, rest] of kickers) {
        if (window.includes(rank)) {
          // 不允许拆本体第 4 张做翅膀（炸弹保持完整）
          valid = false
          break
        }
        if (rest >= 3) {
          // 三张 / 炸弹不拆做翅膀
          valid = false
          break
        }
        if (rest === 1) pairsOnly = false
      }
      if (!valid) continue

      const kickerTotal = size - chain * 3
      if (kickerTotal === chain) {
        // 带单：翅膀不能是双王（王炸不拆）
        if (kickers.get(DOUDIZHU_RANK_JOKER_S) === 1 && kickers.get(DOUDIZHU_RANK_JOKER_B) === 1) continue
        return combo('plane1', window[window.length - 1], size, chain)
      }
      if (kickerTotal === chain * 2 && pairsOnly) {
        return combo('plane2', window[window.length - 1], size, chain)
      }
    }
  }

  // 四带二
  const fours = ranksWithCount(4)
  if (fours.length === 1) {
    const main = fours[0]
    const restTotal = size - 4
    const restRanks = ranks.filter((r) => r !== main)
    if (restTotal === 2) {
      const bothJokers =
        counts.get(DOUDIZHU_RANK_JOKER_S) === 1 && counts.get(DOUDIZHU_RANK_JOKER_B) === 1
      const allSmall = restRanks.every((r) => (counts.get(r) ?? 0) <= 2)
      if (!bothJokers && allSmall) return combo('four1', main, size, 1)
    }
    if (restTotal === 4) {
      const twoPairs = restRanks.length === 2 && restRanks.every((r) => counts.get(r) === 2)
      if (twoPairs) return combo('four2', main, size, 1)
    }
  }

  return null
}

/** move 是否能压住 last（last 为 null 表示主动出牌，恒真） */
export function canDoudizhuBeat(move: DoudizhuCombo, last: DoudizhuCombo | null): boolean {
  if (last === null) return true
  if (move.type === 'rocket') return true
  if (last.type === 'rocket') return false
  if (move.type === 'bomb') {
    return last.type === 'bomb' ? move.rank > last.rank : true
  }
  if (last.type === 'bomb') return false
  return (
    move.type === last.type
    && move.size === last.size
    && move.chain === last.chain
    && move.rank > last.rank
  )
}

// === 候选出牌生成（提示 / AI / 校验参考） ===

export interface DoudizhuMove {
  cards: DoudizhuCard[]
  combo: DoudizhuCombo
}

/**
 * 生成手牌在 last 约束下的全部候选出牌（last 为 null 时为全部主动牌型）。
 *
 * 生成口径：
 * - 不拆炸弹：4 张相同的点数只作为炸弹整手出现，不参与单张 / 对子 / 顺子等拆牌形状；
 * - 翅膀 / 带牌取最小可用牌（每型只给一个代表组合，AI 与提示够用，
 *   人类出牌由 parseDoudizhuCombo 全量校验，不受此限制）；
 * - last 非 null 时仅保留能压住 last 的组合（含炸弹 / 王炸响应）。
 */
export function generateDoudizhuMoves(hand: DoudizhuCard[], last: DoudizhuCombo | null): DoudizhuMove[] {
  const sorted = sortDoudizhuCards(hand)
  const byRank = new Map<number, DoudizhuCard[]>()
  for (const card of sorted) {
    const list = byRank.get(card.rank)
    if (list) list.push(card)
    else byRank.set(card.rank, [card])
  }
  const ranks = [...byRank.keys()].sort((a, b) => a - b)
  const count = (rank: number): number => byRank.get(rank)?.length ?? 0
  const take = (rank: number, n: number): DoudizhuCard[] => (byRank.get(rank) ?? []).slice(0, n)

  /** 炸弹点数不参与拆牌形状 */
  const splittable = (rank: number): boolean => count(rank) < 4

  const moves: DoudizhuMove[] = []
  const push = (cards: DoudizhuCard[]): void => {
    if (cards.length === 0) return
    const parsed = parseDoudizhuCombo(cards)
    if (parsed && canDoudizhuBeat(parsed, last)) moves.push({ cards, combo: parsed })
  }

  /** 从可用牌里按点数升序挑 n 张单牌做翅膀（不含 excluded 点数；不拆炸弹 / 三张，同点数最多 2 张） */
  const pickSingles = (excluded: number[], n: number): DoudizhuCard[] => {
    const picked: DoudizhuCard[] = []
    for (const rank of ranks) {
      if (excluded.includes(rank)) continue
      const available = count(rank) >= 3 ? 0 : Math.min(count(rank), 2)
      for (let i = 0; i < available && picked.length < n; i += 1) {
        const card = byRank.get(rank)?.[i]
        if (card) picked.push(card)
      }
      if (picked.length >= n) break
    }
    return picked.length === n ? picked : []
  }

  /** 从可用牌里按点数升序挑 n 个对子做翅膀（不含 excluded 点数） */
  const pickPairs = (excluded: number[], n: number): DoudizhuCard[] => {
    const picked: DoudizhuCard[] = []
    for (const rank of ranks) {
      if (excluded.includes(rank) || count(rank) !== 2) continue
      picked.push(...take(rank, 2))
      if (picked.length / 2 >= n) break
    }
    return picked.length === n * 2 ? picked : []
  }

  // 单张 / 对子 / 三张
  for (const rank of ranks) {
    if (splittable(rank)) {
      if (count(rank) >= 1) push(take(rank, 1))
      if (count(rank) >= 2) push(take(rank, 2))
      if (count(rank) >= 3) push(take(rank, 3))
    }
  }

  // 三带一 / 三带二
  for (const rank of ranks) {
    if (count(rank) !== 3) continue
    const single = pickSingles([rank], 1)
    if (single.length === 1) push([...take(rank, 3), ...single])
    const pair = pickPairs([rank], 1)
    if (pair.length === 2) push([...take(rank, 3), ...pair])
  }

  // 顺子（5–12 张，最大到 A）
  for (let len = 5; len <= 12; len += 1) {
    for (let start = 3; start + len - 1 <= MAX_CHAIN_RANK; start += 1) {
      let ok = true
      const cards: DoudizhuCard[] = []
      for (let rank = start; rank < start + len; rank += 1) {
        if (!splittable(rank) || count(rank) < 1) {
          ok = false
          break
        }
        cards.push(take(rank, 1)[0])
      }
      if (ok) push(cards)
    }
  }

  // 连对（3–10 连）
  for (let chain = 3; chain <= 10; chain += 1) {
    for (let start = 3; start + chain - 1 <= MAX_CHAIN_RANK; start += 1) {
      let ok = true
      const cards: DoudizhuCard[] = []
      for (let rank = start; rank < start + chain; rank += 1) {
        if (!splittable(rank) || count(rank) < 2) {
          ok = false
          break
        }
        cards.push(...take(rank, 2))
      }
      if (ok) push(cards)
    }
  }

  // 飞机（纯 / 带单 / 带对，2–6 连三）
  for (let chain = 2; chain <= 6; chain += 1) {
    for (let start = 3; start + chain - 1 <= MAX_CHAIN_RANK; start += 1) {
      const window: number[] = []
      let ok = true
      for (let rank = start; rank < start + chain; rank += 1) {
        if (count(rank) !== 3) {
          ok = false
          break
        }
        window.push(rank)
      }
      if (!ok) continue

      const body: DoudizhuCard[] = []
      for (const rank of window) body.push(...take(rank, 3))
      push(body)

      const singles = pickSingles(window, chain)
      if (singles.length === chain) push([...body, ...singles])
      const pairs = pickPairs(window, chain)
      if (pairs.length === chain * 2) push([...body, ...pairs])
    }
  }

  // 四带二单 / 四带二对 + 炸弹
  for (const rank of ranks) {
    if (count(rank) !== 4) continue
    const body = take(rank, 4)
    push(body)
    const singles = pickSingles([rank], 2)
    if (singles.length === 2) push([...body, ...singles])
    const pairs = pickPairs([rank], 2)
    if (pairs.length === 4) push([...body, ...pairs])
  }

  // 王炸
  if (count(DOUDIZHU_RANK_JOKER_S) === 1 && count(DOUDIZHU_RANK_JOKER_B) === 1) {
    push([...take(DOUDIZHU_RANK_JOKER_S, 1), ...take(DOUDIZHU_RANK_JOKER_B, 1)])
  }

  return moves
}

// === 手数评估（提示排序 / AI 启发） ===

/**
 * 把手牌贪心分解成尽量少的出手次数（手数）：
 * 王炸 → 炸弹 → 最长顺子 → 最长连对 → 最长纯飞机 → 三张 → 对子 → 单张。
 * 结果不必最优，仅用于比较候选出牌的优劣。
 */
export function countDoudizhuHands(hand: DoudizhuCard[]): number {
  const counts = rankCounts(hand)
  const remove = (rank: number, n: number): void => {
    const rest = (counts.get(rank) ?? 0) - n
    if (rest > 0) counts.set(rank, rest)
    else counts.delete(rank)
  }
  const has = (rank: number, n: number): boolean => (counts.get(rank) ?? 0) >= n

  let hands = 0

  if (has(DOUDIZHU_RANK_JOKER_S, 1) && has(DOUDIZHU_RANK_JOKER_B, 1)) {
    hands += 1
    remove(DOUDIZHU_RANK_JOKER_S, 1)
    remove(DOUDIZHU_RANK_JOKER_B, 1)
  }

  for (const rank of [...counts.keys()]) {
    if (has(rank, 4)) {
      hands += 1
      remove(rank, 4)
    }
  }

  /** 贪心找最长的连续段（每点数至少 n 张，最长优先，低点数优先），找到就整段移除 */
  const extractRuns = (n: number, minChain: number, takeCount: number): void => {
    for (;;) {
      let best: number[] = []
      let run: number[] = []
      for (let rank = 3; rank <= MAX_CHAIN_RANK; rank += 1) {
        if (has(rank, n)) run.push(rank)
        else run = []
        if (run.length > best.length) best = [...run]
      }
      if (best.length < minChain) return
      hands += 1
      for (const rank of best) remove(rank, takeCount)
    }
  }

  extractRuns(1, 5, 1) // 顺子
  extractRuns(2, 3, 2) // 连对
  extractRuns(3, 2, 3) // 飞机本体

  for (const rank of [...counts.keys()]) {
    if (has(rank, 3)) {
      hands += 1
      remove(rank, 3)
    }
  }
  for (const rank of [...counts.keys()]) {
    if (has(rank, 2)) {
      hands += 1
      remove(rank, 2)
    }
  }
  hands += [...counts.values()].reduce((sum, n) => sum + n, 0)

  return hands
}
