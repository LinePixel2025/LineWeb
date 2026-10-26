/**
 * UNO 纯规则引擎（无状态、无数据库、无网络依赖）
 *
 * 站内规则口径（经典 UNO，2–10 人）：
 *   - 一副 108 张：四色（红 / 黄 / 绿 / 蓝）各 0×1、1–9×2、禁止×2、反转×2、+2×2，
 *     外加万能牌×4、万能+4×4；
 *   - 每人发 7 张，翻开第一张非万能牌作为起始弃牌，座位 0（房主）先手；
 *   - 出牌必须与当前颜色相同，或数字 / 功能类型相同；万能牌可随时出并指定颜色；
 *     万能+4 采用官方限制：手里还有当前颜色的牌时不能出；
 *   - 禁止：跳过下一家；反转：2 人局视作禁止，3 人以上反向；+2 / 万能+4：
 *     下一家摸牌并被跳过（不叠加）；
 *   - 摸牌：摸 1 张，若可出则可以选择立即打出或跳过（pass）；不可出自动轮转；
 *   - 手牌出完即获胜（不结算剩余牌分）；认输 / 掉线判负会出局，最后存活者获胜；
 *   - 牌堆用尽时把弃牌堆（保留顶牌）洗回牌堆；仍无牌可摸则本次摸牌为空并轮转。
 *
 * ⚠️ 前后端唯一真相源：本文件与 client/src/lib/games/uno.ts 必须逐字一致（除头注释），
 *    任何改动必须同步另一端；client 侧的 uno.test.ts 会对齐两份源码，漂移会让测试失败。
 *    联机回合超时托管与单机 AI 共用 suggestUnoMove。
 */

// === 常量（前后端逐字一致，勿改） ===

export const UNO_MIN_PLAYERS = 2
export const UNO_MAX_PLAYERS = 10
export const UNO_HAND_SIZE = 7
export const UNO_DECK_SIZE = 108
export const UNO_COLORS = ['red', 'yellow', 'green', 'blue'] as const

export type UnoColor = (typeof UNO_COLORS)[number]
export type UnoCardKind = 'number' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4'

/** 一张 UNO 牌。id 0–107 固定编排，牌 id 一经发出不再改变。 */
export interface UnoCard {
  id: number
  /** 万能牌为 'wild'，普通牌为四种颜色之一 */
  color: UnoColor | 'wild'
  kind: UnoCardKind
  /** 数字牌为 0–9，功能牌 / 万能牌为 null */
  number: number | null
}

/** 牌桌座位 */
export interface UnoTablePlayer {
  seat: number
  hand: UnoCard[]
  /** 是否仍在场（认输 / 掉线判负后为 false） */
  alive: boolean
  /** 累计出牌张数（展示用） */
  plays: number
}

/** 公开事件流条目（不包含他人手牌） */
export type UnoLogEntry =
  | { type: 'play'; seat: number; card: UnoCard; color: UnoColor }
  | { type: 'draw'; seat: number; count: number }
  | { type: 'pass'; seat: number }
  | { type: 'skip'; seat: number }
  | { type: 'reverse'; seat: number }
  | { type: 'eliminate'; seat: number }
  | { type: 'reshuffle' }
  | { type: 'win'; seat: number }

export type UnoEndReason = 'hand_empty' | 'last_standing'

/** 牌桌完整状态（联机时由服务端持有，单机时由前端持有） */
export interface UnoTableState {
  players: UnoTablePlayer[]
  /** 牌堆（末尾为下一张要摸的牌） */
  deck: UnoCard[]
  /** 弃牌堆（末尾为当前顶牌） */
  discard: UnoCard[]
  /** 当前生效颜色（万能牌打出后由出牌者指定） */
  currentColor: UnoColor
  /** 出牌方向：1 = 座位递增，-1 = 座位递减 */
  direction: 1 | -1
  /** 当前回合座位（结束为 null） */
  turnSeat: number | null
  /** 本回合摸到的牌（可立即打出或 pass；未摸牌为 null） */
  drawnCardId: number | null
  status: 'playing' | 'finished'
  winnerSeat: number | null
  endReason: UnoEndReason | null
  log: UnoLogEntry[]
}

/** 服务端 / 单机的一次动作 */
export type UnoMoveSuggestion =
  | { action: 'play'; cardId: number; color?: UnoColor }
  | { action: 'draw' }
  | { action: 'pass' }

/** 事件日志封顶长度 */
const UNO_LOG_MAX = 160

function pushLog(state: UnoTableState, entry: UnoLogEntry): void {
  state.log.push(entry)
  if (state.log.length > UNO_LOG_MAX) state.log.splice(0, state.log.length - UNO_LOG_MAX)
}

// === 牌与牌堆 ===

/**
 * 生成完整牌堆（107? 不，108 张）。
 * 编排顺序：红→黄→绿→蓝，每色 0（1 张）、1–9（各 2 张）、禁止/反转/+2（各 2 张），
 * 最后万能×4、万能+4×4。
 */
export function createUnoDeck(): UnoCard[] {
  const cards: UnoCard[] = []
  let id = 0
  for (const color of UNO_COLORS) {
    const push = (kind: UnoCardKind, number: number | null) => {
      cards.push({ id: id++, color, kind, number })
    }
    push('number', 0)
    for (let n = 1; n <= 9; n += 1) {
      push('number', n)
      push('number', n)
    }
    for (const kind of ['skip', 'reverse', 'draw2'] as const) {
      push(kind, null)
      push(kind, null)
    }
  }
  for (let i = 0; i < 4; i += 1) cards.push({ id: id++, color: 'wild', kind: 'wild', number: null })
  for (let i = 0; i < 4; i += 1) cards.push({ id: id++, color: 'wild', kind: 'wild4', number: null })
  return cards
}

/** Fisher–Yates 洗牌（返回新数组，不改入参） */
export function shuffleUnoDeck(deck: UnoCard[], rand: () => number = Math.random): UnoCard[] {
  const result = [...deck]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = result[i]
    result[i] = result[j]
    result[j] = tmp
  }
  return result
}

/** 是否万能牌 */
export function unoIsWild(card: UnoCard): boolean {
  return card.kind === 'wild' || card.kind === 'wild4'
}

/** 牌面中文标签（数字牌返回数字） */
export function unoCardLabel(card: UnoCard): string {
  if (card.kind === 'number') return String(card.number ?? '?')
  if (card.kind === 'skip') return '禁止'
  if (card.kind === 'reverse') return '反转'
  if (card.kind === 'draw2') return '+2'
  if (card.kind === 'wild') return '万能'
  return '万能+4'
}

/** 颜色中文名 */
export const UNO_COLOR_LABELS: Record<UnoColor, string> = {
  red: '红',
  yellow: '黄',
  green: '绿',
  blue: '蓝',
}

/**
 * 牌是否与当前顶牌 / 颜色匹配（不考虑万能+4 的手牌限制）。
 * 规则：万能牌总是匹配；否则颜色相同，或数字相同，或功能类型相同。
 */
export function unoCardMatches(card: UnoCard, top: UnoCard, currentColor: UnoColor): boolean {
  if (unoIsWild(card)) return true
  if (card.color === currentColor) return true
  if (card.kind === 'number' && top.kind === 'number') return card.number === top.number
  if (card.kind !== 'number' && top.kind !== 'number') return card.kind === top.kind
  return false
}

/** 手里是否还有当前颜色的牌（万能+4 的官方限制判定） */
export function unoHandHasColor(hand: UnoCard[], color: UnoColor): boolean {
  return hand.some((card) => card.color === color)
}

/**
 * 某张牌此刻是否可出：
 *   - 必须与 top / currentColor 匹配；
 *   - 万能+4 在手里还有当前颜色牌时不可出（官方限制）；
 *   - 其余万能牌无限制。
 */
export function unoIsPlayableCard(
  card: UnoCard,
  hand: UnoCard[],
  top: UnoCard,
  currentColor: UnoColor,
): boolean {
  if (!unoCardMatches(card, top, currentColor)) return false
  if (card.kind === 'wild4' && unoHandHasColor(hand.filter((item) => item.id !== card.id), currentColor)) {
    return false
  }
  return true
}

/** 手牌中所有可出的牌 */
export function unoPlayableCards(hand: UnoCard[], top: UnoCard, currentColor: UnoColor): UnoCard[] {
  return hand.filter((card) => unoIsPlayableCard(card, hand, top, currentColor))
}

/** 当前顶牌（牌桌至少有一张弃牌） */
export function unoTopCard(state: UnoTableState): UnoCard {
  const top = state.discard[state.discard.length - 1]
  if (!top) throw new Error('弃牌堆为空')
  return top
}

// === 牌桌状态机 ===

function cloneUnoTable(state: UnoTableState): UnoTableState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player, hand: player.hand.map((card) => ({ ...card })) })),
    deck: state.deck.map((card) => ({ ...card })),
    discard: state.discard.map((card) => ({ ...card })),
    log: [...state.log],
  }
}

/** 以当前方向找 fromSeat 之后的下一位在场玩家；找不到返回 -1 */
export function unoNextAliveSeat(state: UnoTableState, fromSeat: number): number {
  const total = state.players.length
  for (let offset = 1; offset <= total; offset += 1) {
    const seat = ((fromSeat + offset * state.direction) % total + total) % total
    if (state.players[seat]?.alive) return seat
  }
  return -1
}

/** 从 fromSeat 起顺方向走 steps 位在场玩家 */
function advanceUnoTurn(state: UnoTableState, fromSeat: number, steps: number): void {
  let seat = fromSeat
  for (let i = 0; i < steps; i += 1) {
    const next = unoNextAliveSeat(state, seat)
    if (next < 0) break
    seat = next
  }
  state.turnSeat = seat
}

/**
 * 从牌堆摸 count 张（改动 state）：
 * 牌堆不足时把弃牌堆除顶牌外的牌洗回牌堆；仍不足则尽可能摸。
 * 返回实际摸到的牌。
 */
function drawUnoCards(state: UnoTableState, count: number, rand: () => number): UnoCard[] {
  const drawn: UnoCard[] = []
  for (let i = 0; i < count; i += 1) {
    if (state.deck.length === 0) {
      if (state.discard.length <= 1) break
      const top = state.discard[state.discard.length - 1]
      const recycled = state.discard.slice(0, -1)
      state.discard = top ? [top] : []
      state.deck = shuffleUnoDeck(recycled, rand)
      pushLog(state, { type: 'reshuffle' })
      if (state.deck.length === 0) break
    }
    const card = state.deck.pop()
    if (!card) break
    drawn.push(card)
  }
  return drawn
}

/** 创建一张新牌桌（发牌 + 翻起始牌，座位 0 先手） */
export function createUnoTable(playerCount: number, rand: () => number = Math.random): UnoTableState {
  if (playerCount < UNO_MIN_PLAYERS || playerCount > UNO_MAX_PLAYERS) {
    throw new Error(`UNO 支持 ${UNO_MIN_PLAYERS}–${UNO_MAX_PLAYERS} 人`)
  }
  let deck = shuffleUnoDeck(createUnoDeck(), rand)
  const players: UnoTablePlayer[] = Array.from({ length: playerCount }, (_, seat) => ({
    seat,
    hand: [],
    alive: true,
    plays: 0,
  }))
  for (let round = 0; round < UNO_HAND_SIZE; round += 1) {
    for (const player of players) {
      const card = deck.pop()
      if (card) player.hand.push(card)
    }
  }
  // 起始牌：一直翻到非万能牌（避免开局就要指定颜色；这是站内简化口径）
  let top: UnoCard | undefined
  while (deck.length > 0) {
    const card = deck.pop()
    if (!card) break
    if (!unoIsWild(card)) {
      top = card
      break
    }
    // 万能牌直接塞回牌堆底部，不进入弃牌堆
    deck.unshift(card)
  }
  if (!top) top = { id: -1, color: 'red', kind: 'number', number: 0 }
  const state: UnoTableState = {
    players,
    deck,
    discard: [top],
    currentColor: top.color === 'wild' ? 'red' : top.color,
    direction: 1,
    turnSeat: 0,
    drawnCardId: null,
    status: 'playing',
    winnerSeat: null,
    endReason: null,
    log: [],
  }
  return state
}

/**
 * 出牌。牌面合法后结算功能效果并轮转；手牌出完立即获胜。
 * @param chosenColor 万能牌必须指定的颜色（非万能牌忽略）
 */
export function playUnoCard(
  state: UnoTableState,
  seat: number,
  cardId: number,
  chosenColor?: UnoColor,
  rand: () => number = Math.random,
): UnoTableState {
  if (state.status === 'finished') throw new Error('对局已结束')
  if (state.turnSeat !== seat) throw new Error('还没轮到你')
  const player = state.players[seat]
  if (!player || !player.alive) throw new Error('你已出局')
  const top = unoTopCard(state)
  const index = player.hand.findIndex((card) => card.id === cardId)
  if (index < 0) throw new Error('这张牌不在你的手牌中')
  const card = player.hand[index]
  if (!unoIsPlayableCard(card, player.hand, top, state.currentColor)) {
    throw new Error(card.kind === 'wild4' ? '手里还有当前颜色的牌，不能出万能+4' : '这张牌现在不能出')
  }
  if (state.drawnCardId !== null && card.id !== state.drawnCardId) {
    throw new Error('摸牌后只能打出刚摸到的那张牌，或选择跳过')
  }
  if (unoIsWild(card) && !chosenColor) throw new Error('万能牌需要指定颜色')

  const next = cloneUnoTable(state)
  const nextPlayer = next.players[seat]
  nextPlayer.hand.splice(index, 1)
  nextPlayer.plays += 1
  next.discard.push({ ...card })
  next.currentColor = unoIsWild(card) ? (chosenColor ?? 'red') : (card.color as UnoColor)
  next.drawnCardId = null
  pushLog(next, { type: 'play', seat, card: { ...card }, color: next.currentColor })

  if (nextPlayer.hand.length === 0) {
    next.status = 'finished'
    next.winnerSeat = seat
    next.endReason = 'hand_empty'
    next.turnSeat = null
    pushLog(next, { type: 'win', seat })
    return next
  }

  const totalAlive = next.players.filter((item) => item.alive).length
  if (card.kind === 'skip') {
    const skipped = unoNextAliveSeat(next, seat)
    if (skipped >= 0) pushLog(next, { type: 'skip', seat: skipped })
    advanceUnoTurn(next, seat, 2)
  } else if (card.kind === 'reverse') {
    next.direction = next.direction === 1 ? -1 : 1
    pushLog(next, { type: 'reverse', seat })
    // 2 人局反转视作禁止：打出者继续行动
    advanceUnoTurn(next, seat, totalAlive === 2 ? 2 : 1)
  } else if (card.kind === 'draw2' || card.kind === 'wild4') {
    const target = unoNextAliveSeat(next, seat)
    if (target >= 0) {
      const count = card.kind === 'draw2' ? 2 : 4
      const targetPlayer = next.players[target]
      const drawn = drawUnoCards(next, count, rand)
      targetPlayer.hand.push(...drawn)
      pushLog(next, { type: 'draw', seat: target, count: drawn.length })
    }
    advanceUnoTurn(next, seat, 2)
  } else {
    advanceUnoTurn(next, seat, 1)
  }
  return next
}

/**
 * 摸一张牌。可出时留在本回合（drawnCardId 指向这张牌，玩家可出或 pass）；
 * 不可出 / 牌堆彻底空了则自动轮转。
 */
export function drawUnoTurn(
  state: UnoTableState,
  seat: number,
  rand: () => number = Math.random,
): UnoTableState {
  if (state.status === 'finished') throw new Error('对局已结束')
  if (state.turnSeat !== seat) throw new Error('还没轮到你')
  const player = state.players[seat]
  if (!player || !player.alive) throw new Error('你已出局')
  if (state.drawnCardId !== null) throw new Error('本回合已经摸过牌，请出牌或跳过')

  const next = cloneUnoTable(state)
  const nextPlayer = next.players[seat]
  const top = unoTopCard(next)
  const drawn = drawUnoCards(next, 1, rand)
  const card = drawn[0]
  if (!card) {
    pushLog(next, { type: 'draw', seat, count: 0 })
    advanceUnoTurn(next, seat, 1)
    return next
  }
  nextPlayer.hand.push(card)
  pushLog(next, { type: 'draw', seat, count: 1 })
  if (unoIsPlayableCard(card, nextPlayer.hand, top, next.currentColor)) {
    next.drawnCardId = card.id
    return next
  }
  advanceUnoTurn(next, seat, 1)
  return next
}

/** 摸牌后选择不出（仅 drawnCardId 非 null 时可用） */
export function passUnoTurn(state: UnoTableState, seat: number): UnoTableState {
  if (state.status === 'finished') throw new Error('对局已结束')
  if (state.turnSeat !== seat) throw new Error('还没轮到你')
  if (state.drawnCardId === null) throw new Error('只有摸牌后才能跳过')
  const next = cloneUnoTable(state)
  next.drawnCardId = null
  pushLog(next, { type: 'pass', seat })
  advanceUnoTurn(next, seat, 1)
  return next
}

/**
 * 淘汰一名玩家（认输 / 掉线判负）：手牌移出游戏，只剩一人时终局。
 * 若当前回合正是该玩家，回合顺延给下一位在场玩家。
 */
export function eliminateUnoPlayer(state: UnoTableState, seat: number): UnoTableState {
  if (state.status === 'finished') throw new Error('对局已结束')
  const player = state.players[seat]
  if (!player || !player.alive) throw new Error('该玩家已出局')
  const next = cloneUnoTable(state)
  const target = next.players[seat]
  target.alive = false
  target.hand = []
  next.drawnCardId = null
  pushLog(next, { type: 'eliminate', seat })
  const alive = next.players.filter((item) => item.alive)
  if (alive.length <= 1) {
    next.status = 'finished'
    next.winnerSeat = alive[0]?.seat ?? null
    next.endReason = 'last_standing'
    next.turnSeat = null
    if (alive[0]) pushLog(next, { type: 'win', seat: alive[0].seat })
    return next
  }
  if (next.turnSeat === seat) advanceUnoTurn(next, seat, 1)
  return next
}

// === 启发式决策（联机回合超时托管与单机 AI 共用） ===

/** 手牌中数量最多的普通颜色（万能牌指定颜色用）；没有普通牌时按红黄绿蓝顺序 */
export function suggestUnoColor(hand: UnoCard[]): UnoColor {
  let best: UnoColor = 'red'
  let bestCount = -1
  for (const color of UNO_COLORS) {
    const count = hand.filter((card) => card.color === color).length
    if (count > bestCount) {
      best = color
      bestCount = count
    }
  }
  return best
}

/** 单次决策入参 */
export interface UnoSuggestInput {
  hand: UnoCard[]
  top: UnoCard
  currentColor: UnoColor
  /** 本回合摸到的牌 id（null = 还没摸牌） */
  drawnCardId: number | null
  /** 下一名在场玩家的手牌张数（用于决定是否优先打功能牌） */
  nextHandCount?: number
  rand?: () => number
}

/**
 * 启发式决策（托管与单机 AI 共用）：
 *   1. 摸过牌：能出就出摸到的牌，否则 pass；
 *   2. 手里只剩一张可出牌 → 直接出（获胜）；
 *   3. 下一家手牌 ≤ 2 → 优先 +2 / 万能+4 / 禁止 / 反转；
 *   4. 否则优先普通数字牌（保留功能牌），万能牌只在没有普通可出牌时使用；
 *   5. 万能牌颜色 = 手里最多的普通颜色。
 * 没有可出牌则 draw。固定 rand 时决策可复现（当前实现不含随机分支，保留参数兼容）。
 */
export function suggestUnoMove(input: UnoSuggestInput, _rand: () => number = Math.random): UnoMoveSuggestion {
  const { hand, top, currentColor, drawnCardId, nextHandCount = 5 } = input
  const playable = unoPlayableCards(hand, top, currentColor)

  if (drawnCardId !== null) {
    const drawn = playable.find((card) => card.id === drawnCardId)
    if (drawn) {
      return {
        action: 'play',
        cardId: drawn.id,
        color: unoIsWild(drawn) ? suggestUnoColor(hand.filter((card) => card.id !== drawn.id)) : undefined,
      }
    }
    return { action: 'pass' }
  }

  if (playable.length === 0) return { action: 'draw' }

  const toPlay = (card: UnoCard): UnoMoveSuggestion => ({
    action: 'play',
    cardId: card.id,
    color: unoIsWild(card) ? suggestUnoColor(hand.filter((item) => item.id !== card.id)) : undefined,
  })

  // 能一手出完 → 直接获胜
  if (hand.length === 1) return toPlay(playable[0])

  const actionCards = playable.filter((card) => card.kind !== 'number')
  const numberCards = playable.filter((card) => card.kind === 'number')

  if (nextHandCount <= 2 && actionCards.length > 0) {
    const priority: UnoCardKind[] = ['draw2', 'wild4', 'skip', 'reverse', 'wild']
    for (const kind of priority) {
      const card = actionCards.find((item) => item.kind === kind)
      if (card) return toPlay(card)
    }
  }

  if (numberCards.length > 0) {
    // 优先与当前颜色一致的普通牌（不消耗万能 / 功能牌）
    const sameColor = numberCards.find((card) => card.color === currentColor)
    return toPlay(sameColor ?? numberCards[0])
  }
  // 手里只剩功能牌 / 万能牌：先出不用指定颜色的功能牌，再出万能牌
  const nonWild = actionCards.find((card) => !unoIsWild(card))
  return toPlay(nonWild ?? actionCards[0] ?? playable[0])
}

// === 确定性随机源（自检脚本 / 测试用） ===

/** mulberry32：给定种子的可复现随机序列（0 ≤ x < 1） */
export function createUnoRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
