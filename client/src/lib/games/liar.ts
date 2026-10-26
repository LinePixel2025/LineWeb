/**
 * 骗子酒馆纯规则引擎（无状态、无数据库、无网络依赖）
 *
 * 站内规则口径（对标 Liar's Bar 卡牌模式，做了简洁化收口）：
 *   - 牌堆 20 张：K×6、Q×6、A×6、鬼牌×2；每局给每位存活玩家发 5 张；
 *   - 每局系统随机宣布目标牌面（K/Q/A 之一），鬼牌万能（开牌时视作目标牌面）；
 *   - 轮到时二选一：盖着出 1–3 张牌（声称是目标牌面，实际可任意），或质疑上一手；
 *   - 质疑即开牌：只翻开上一手打出的那组牌——全部为目标牌面/鬼牌 → 质疑者输，
 *     否则被打出者输；更早埋进牌堆的牌不开、不追溯；
 *   - 输家扣左轮扳机：6 弹巢，子弹数 = 本局累计死亡人数 + 1（1/6 → 2/6 → 3/6…），
 *     中弹即出局；扣扳机后无论生死都重洗重发、宣布新目标，开启下一局
 *     （站内口径：手牌不跨局保留，避免「手牌出完跳过」等边角状态）；
 *   - 全员手牌出完且无人质疑 → 本局流局（flush），无人扣扳机，直接重发下一局；
 *   - 死亡（含认输 / 掉线判负）都会推高子弹数；最后存活者获胜。
 *
 * ⚠️ 前后端唯一真相源：本文件与 client/src/lib/games/liar.ts 必须逐字一致（除头注释），
 *    任何改动必须同步另一端；client 侧的 liar.test.ts 会对齐两份源码，漂移会让测试失败。
 *    联机回合超时托管与单机 AI 共用 suggestLiarMove；联机对局流程与单机共用
 *    createLiarTable / applyLiarTablePlay / applyLiarTableChallenge 这套牌桌状态机。
 */

// === 常量（前后端逐字一致，勿改） ===

/** 牌堆总张数：K×6 + Q×6 + A×6 + 鬼牌×2 */
export const LIAR_DECK_SIZE = 20
/** 每局每位玩家发牌张数 */
export const LIAR_HAND_SIZE = 5
/** 一手最少张数 */
export const LIAR_PLAY_MIN = 1
/** 一手最多张数 */
export const LIAR_PLAY_MAX = 3
/** 每种目标牌面的张数 */
export const LIAR_TARGET_COPIES = 6
/** 鬼牌张数（万能） */
export const LIAR_JOKER_COPIES = 2
/** 左轮弹巢数 */
export const LIAR_GUN_CHAMBERS = 6
/** 房间最少开局人数 */
export const LIAR_MIN_PLAYERS = 2
/** 房间人数上限 */
export const LIAR_MAX_PLAYERS = 4

/** 可被宣布为目标的三种牌面 */
export const LIAR_TARGET_KINDS = ['K', 'Q', 'A'] as const

/** 目标牌面（每局随机其一） */
export type LiarTarget = (typeof LIAR_TARGET_KINDS)[number]

/** 一张牌的牌面：K / Q / A / 鬼牌 */
export type LiarCardKind = LiarTarget | 'JOKER'

/** 玩家死亡原因：质疑后中弹 / 掉线判负 / 认输 */
export type LiarDeathCause = 'trigger' | 'forfeit' | 'resign'

// === 牌与牌堆 ===

/**
 * 牌 id → 牌面。id 0–19 固定编排：K = 0–5、Q = 6–11、A = 12–17、鬼牌 = 18–19。
 * 牌 id 一经发出不再改变，开牌/手牌渲染直接用 id 查牌面。
 */
export function liarCardKind(card: number): LiarCardKind {
  if (card < 0 || card >= LIAR_DECK_SIZE) throw new Error(`无效的牌 id：${card}`)
  if (card < 6) return 'K'
  if (card < 12) return 'Q'
  if (card < 18) return 'A'
  return 'JOKER'
}

/** 一张牌对当前目标是否为「真牌」（目标牌面或鬼牌） */
export function liarCardIsTruthy(card: number, target: LiarTarget): boolean {
  const kind = liarCardKind(card)
  return kind === target || kind === 'JOKER'
}

/** 一组牌是否全部为真牌（质疑开牌的判定核心：一张假牌即整组为谎） */
export function liarCardsAreTruthy(cards: number[], target: LiarTarget): boolean {
  return cards.every((card) => liarCardIsTruthy(card, target))
}

/** 新牌堆（0–19 顺序排列） */
export function createLiarDeck(): number[] {
  return Array.from({ length: LIAR_DECK_SIZE }, (_, index) => index)
}

/** Fisher–Yates 洗牌（返回新数组，不改入参） */
export function shuffleLiarDeck(deck: number[], rand: () => number = Math.random): number[] {
  const result = [...deck]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = result[i]
    result[i] = result[j]
    result[j] = tmp
  }
  return result
}

/**
 * 给 playerCount 位玩家各发 LIAR_HAND_SIZE 张（返回每人一个升序不保证的手牌数组；
 * 多人时牌堆足够：4 × 5 = 20 恰好用完，2–3 人时余牌留底不参与本局）。
 */
export function dealLiarHands(playerCount: number, rand: () => number = Math.random): number[][] {
  if (playerCount < LIAR_MIN_PLAYERS || playerCount > LIAR_MAX_PLAYERS) {
    throw new Error(`骗子酒馆支持 ${LIAR_MIN_PLAYERS}–${LIAR_MAX_PLAYERS} 人`)
  }
  const deck = shuffleLiarDeck(createLiarDeck(), rand)
  const hands: number[][] = []
  for (let seat = 0; seat < playerCount; seat += 1) {
    hands.push(deck.slice(seat * LIAR_HAND_SIZE, (seat + 1) * LIAR_HAND_SIZE))
  }
  return hands
}

/** 随机宣布本局目标牌面 */
export function pickLiarTarget(rand: () => number = Math.random): LiarTarget {
  const index = Math.floor(rand() * LIAR_TARGET_KINDS.length)
  return LIAR_TARGET_KINDS[index] ?? 'K'
}

// === 出牌校验与左轮 ===

/** 一手出牌是否合法：1–3 张、全部来自手牌、不重复 */
export function isValidLiarPlay(hand: number[], cards: number[]): boolean {
  if (cards.length < LIAR_PLAY_MIN || cards.length > LIAR_PLAY_MAX) return false
  if (cards.length > hand.length) return false
  const remaining = new Set(hand)
  for (const card of cards) {
    if (!remaining.delete(card)) return false
  }
  return true
}

/**
 * 当前左轮里的子弹数：6 弹巢，第 1 次扣扳机 1 颗，之后每死一人 +1（封顶 6）。
 * 认输 / 掉线判负同样计入死亡人数（人没了就多一颗子弹）。
 */
export function liarGunBullets(deaths: number): number {
  return Math.min(LIAR_GUN_CHAMBERS, Math.max(0, deaths) + 1)
}

/** 扣扳机是否中弹：等概率命中 bullets / 6 个弹巢 */
export function liarTriggerHits(deaths: number, rand: () => number = Math.random): boolean {
  return rand() < liarGunBullets(deaths) / LIAR_GUN_CHAMBERS
}

// === 牌桌状态机（联机服务端与单机前端共用同一套流转） ===

/** 牌桌上的一个座位 */
export interface LiarTablePlayer {
  /** 座位号（0 起，开局后不变） */
  seat: number
  /** 手牌（仅属主可见；状态机内部持有） */
  hand: number[]
  /** 是否仍在场（false = 已出局） */
  alive: boolean
  /** 累计出牌手数（展示用） */
  plays: number
}

/**
 * 牌堆里的一手。牌面（cards）存在状态机内部供质疑开牌还原，
 * 下发 DTO 时必须裁剪成 {seat, count}（盖着的牌对所有人不可见）。
 */
export interface LiarTablePileEntry {
  seat: number
  count: number
  /** 该手打出的真实牌面（状态机内部持有，DTO 不下发） */
  cards: number[]
}

/** 下发用的牌堆条目（裁掉真实牌面） */
export interface LiarTablePileEntryDto {
  seat: number
  count: number
}

/** 最近一次质疑开牌结果（保留到下一次质疑，供开牌瞬间展示） */
export interface LiarTableReveal {
  round: number
  /** 被开牌者（上一手出牌人） */
  seat: number
  /** 翻开的牌（牌 id） */
  cards: number[]
  /** 是否全部为真牌（true → 质疑者输） */
  truthful: boolean
  /** 质疑发起者 */
  challengerSeat: number
}

/** 公开事件流（渲染对局记录用；数组顺序即发生顺序，封顶 200 条） */
export type LiarTableLogEntry =
  | { type: 'round'; round: number; target: LiarTarget; starterSeat: number }
  | { type: 'play'; round: number; seat: number; count: number }
  | { type: 'challenge'; round: number; seat: number; targetSeat: number }
  | { type: 'reveal'; round: number; seat: number; cards: number[]; truthful: boolean }
  | { type: 'trigger'; round: number; seat: number; bullets: number; died: boolean }
  | { type: 'death'; round: number; seat: number; cause: LiarDeathCause }
  | { type: 'flush'; round: number }

/** 牌桌完整状态（联机时由服务端持有，单机时由前端持有） */
export interface LiarTableState {
  players: LiarTablePlayer[]
  /** 局号（从 1 开始；每次重发 +1） */
  round: number
  /** 本局目标牌面（finished 后保留最后一局的值） */
  target: LiarTarget
  /** 当前回合座位（finished 后为 null） */
  turnSeat: number | null
  /** 当前桌面牌堆（盖着的，只记谁出了几张） */
  pile: LiarTablePileEntry[]
  /** 最近一次质疑开牌结果（保留到下一次质疑；重发后仍可回看上一局的开牌） */
  lastReveal: LiarTableReveal | null
  log: LiarTableLogEntry[]
  /** 本场累计死亡人数（决定下一发子弹数） */
  deaths: number
  finished: boolean
  /** 最后存活者座位（finished 且有胜者时非 null） */
  winnerSeat: number | null
}

/** 事件日志封顶长度（对局很长时防止状态无限膨胀） */
const LIAR_LOG_MAX = 200

function pushLog(state: LiarTableState, entry: LiarTableLogEntry): void {
  state.log.push(entry)
  if (state.log.length > LIAR_LOG_MAX) state.log.splice(0, state.log.length - LIAR_LOG_MAX)
}

/** 仍在场的座位列表（按座位升序） */
export function liarAliveSeats(state: LiarTableState): number[] {
  return state.players.filter((player) => player.alive).map((player) => player.seat)
}

/** 从 fromSeat 之后按座位循环找下一位在场玩家；无则返回 -1 */
export function nextLiarAliveSeat(state: LiarTableState, fromSeat: number): number {
  const total = state.players.length
  for (let offset = 1; offset <= total; offset += 1) {
    const seat = (fromSeat + offset) % total
    if (state.players[seat]?.alive) return seat
  }
  return -1
}

/**
 * 从 fromSeat 之后按座位循环找下一位「在场且有手牌」的玩家；
 * 兜底：若其他人都没有手牌但当前座位自己还有牌，则返回当前座位（继续出牌直到被质疑或流局）；
 * 全场都没有手牌时返回 -1（调用方负责流局重发）。
 */
function nextLiarSeatWithCards(state: LiarTableState, fromSeat: number): number {
  const total = state.players.length
  for (let offset = 1; offset <= total; offset += 1) {
    const seat = (fromSeat + offset) % total
    const player = state.players[seat]
    if (player?.alive && player.hand.length > 0) return seat
  }
  const current = state.players[fromSeat]
  if (current?.alive && current.hand.length > 0) return fromSeat
  return -1
}

/**
 * 开启新的一局：重洗重发、宣布新目标、由 starterSeat 先行。
 * 死亡玩家不参与发牌（手牌清空）。
 */
function startLiarRound(state: LiarTableState, starterSeat: number, rand: () => number): void {
  state.round += 1
  state.target = pickLiarTarget(rand)
  state.pile = []
  // lastReveal 不清空：保留最近一次开牌结果供开牌瞬间展示，直到下一次质疑覆盖
  const hands = dealLiarHands(state.players.length, rand)
  state.players.forEach((player, seat) => {
    player.hand = player.alive ? hands[seat] ?? [] : []
  })
  const aliveSeats = liarAliveSeats(state)
  state.turnSeat = state.players[starterSeat]?.alive ? starterSeat : aliveSeats[0] ?? null
  pushLog(state, { type: 'round', round: state.round, target: state.target, starterSeat: state.turnSeat ?? 0 })
}

/**
 * 创建一张新牌桌（第 1 局立即发牌，座位 0 先行）。
 * playerCount 为座位数（2–4），座位号 = 0..playerCount-1。
 */
export function createLiarTable(playerCount: number, rand: () => number = Math.random): LiarTableState {
  if (playerCount < LIAR_MIN_PLAYERS || playerCount > LIAR_MAX_PLAYERS) {
    throw new Error(`骗子酒馆支持 ${LIAR_MIN_PLAYERS}–${LIAR_MAX_PLAYERS} 人`)
  }
  const state: LiarTableState = {
    players: Array.from({ length: playerCount }, (_, seat) => ({
      seat,
      hand: [],
      alive: true,
      plays: 0,
    })),
    round: 0,
    target: 'K',
    turnSeat: null,
    pile: [],
    lastReveal: null,
    log: [],
    deaths: 0,
    finished: false,
    winnerSeat: null,
  }
  startLiarRound(state, 0, rand)
  return state
}

/** 深拷贝牌桌状态（不可变更新的基础） */
export function cloneLiarTable(state: LiarTableState): LiarTableState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player, hand: [...player.hand] })),
    pile: state.pile.map((entry) => ({ ...entry, cards: [...entry.cards] })),
    lastReveal: state.lastReveal === null ? null : { ...state.lastReveal, cards: [...state.lastReveal.cards] },
    log: [...state.log],
  }
}

/**
 * 按当前状态把回合交给下一位该出牌的玩家；全场无牌可出时流局重发。
 * （出牌 / 质疑 / 淘汰之后统一走这里收敛回合。）
 */
function settleLiarTurn(state: LiarTableState, fromSeat: number, rand: () => number): void {
  if (state.finished) return
  const next = nextLiarSeatWithCards(state, fromSeat)
  if (next < 0) {
    // 全员手牌出完且无人质疑 → 流局：无人扣扳机，直接重发
    pushLog(state, { type: 'flush', round: state.round })
    startLiarRound(state, nextLiarAliveSeat(state, fromSeat), rand)
    return
  }
  state.turnSeat = next
}
/**
 * 出牌：盖着把 1–3 张牌压上牌堆（声称是目标牌面，实际可任意）。
 * 非回合 / 非法牌组抛错；出牌后轮转下一位（手牌出完会被自动跳过）。
 */
export function applyLiarTablePlay(
  state: LiarTableState,
  seat: number,
  cards: number[],
  rand: () => number = Math.random,
): LiarTableState {
  if (state.finished) throw new Error('对局已结束')
  if (state.turnSeat !== seat) throw new Error('还没轮到你')
  const player = state.players[seat]
  if (!player || !player.alive) throw new Error('你已出局')
  if (!isValidLiarPlay(player.hand, cards)) {
    throw new Error(`要出的牌必须是自己手牌中的 ${LIAR_PLAY_MIN}–${LIAR_PLAY_MAX} 张`)
  }
  const next = cloneLiarTable(state)
  const nextPlayer = next.players[seat]
  nextPlayer.hand = nextPlayer.hand.filter((card) => !cards.includes(card))
  nextPlayer.plays += 1
  next.pile = [...next.pile, { seat, count: cards.length, cards: [...cards] }]
  pushLog(next, { type: 'play', round: next.round, seat, count: cards.length })
  settleLiarTurn(next, seat, rand)
  return next
}

/**
 * 质疑上一手：翻开牌堆顶那组牌定真假，输家扣左轮扳机。
 * 质疑结算后一律重洗重发开启下一局（生死都一样）；有人中弹且只剩一人 → 终局。
 */
export function applyLiarTableChallenge(
  state: LiarTableState,
  seat: number,
  rand: () => number = Math.random,
): LiarTableState {
  if (state.finished) throw new Error('对局已结束')
  if (state.turnSeat !== seat) throw new Error('还没轮到你')
  const player = state.players[seat]
  if (!player || !player.alive) throw new Error('你已出局')
  const top = state.pile[state.pile.length - 1]
  if (!top) throw new Error('桌上还没有可以质疑的出牌，先出牌或等待')
  if (top.seat === seat) throw new Error('不能质疑自己的出牌')

  const next = cloneLiarTable(state)
  const revealedSeat = top.seat
  const revealedCards = [...top.cards]
  const truthful = liarCardsAreTruthy(revealedCards, next.target)
  // 输家：开出的牌全真 → 质疑者输；掺了假牌 → 被打出者输
  const loserSeat = truthful ? seat : revealedSeat
  next.pile = []
  next.lastReveal = { round: next.round, seat: revealedSeat, cards: revealedCards, truthful, challengerSeat: seat }
  pushLog(next, { type: 'challenge', round: next.round, seat, targetSeat: revealedSeat })
  pushLog(next, { type: 'reveal', round: next.round, seat: revealedSeat, cards: revealedCards, truthful })

  // 输家扣左轮扳机：无论生死都重洗重发开启下一局
  const bullets = liarGunBullets(next.deaths)
  const died = liarTriggerHits(next.deaths, rand)
  pushLog(next, { type: 'trigger', round: next.round, seat: loserSeat, bullets, died })

  if (died) {
    const loser = next.players[loserSeat]
    loser.alive = false
    loser.hand = []
    next.deaths += 1
    pushLog(next, { type: 'death', round: next.round, seat: loserSeat, cause: 'trigger' })
    const alive = liarAliveSeats(next)
    if (alive.length <= 1) {
      next.finished = true
      next.winnerSeat = alive[0] ?? null
      next.turnSeat = null
      return next
    }
  }
  // 下一局由扣扳机者（无论生死）的下一位存活玩家开局
  startLiarRound(next, nextLiarAliveSeat(next, loserSeat), rand)
  return next
}

/**
 * 淘汰一名玩家（服务端认输 / 掉线判负用）：立即出局并推高子弹数；
 * 若只剩一人则终局，否则照常轮转（轮到被淘汰者时顺延给下一位）。
 */
export function eliminateLiarTablePlayer(
  state: LiarTableState,
  seat: number,
  cause: LiarDeathCause,
  rand: () => number = Math.random,
): LiarTableState {
  if (state.finished) throw new Error('对局已结束')
  const player = state.players[seat]
  if (!player || !player.alive) throw new Error('该玩家已出局')
  const next = cloneLiarTable(state)
  const target = next.players[seat]
  target.alive = false
  target.hand = []
  next.deaths += 1
  pushLog(next, { type: 'death', round: next.round, seat, cause })

  const alive = liarAliveSeats(next)
  if (alive.length <= 1) {
    next.finished = true
    next.winnerSeat = alive[0] ?? null
    next.turnSeat = null
    return next
  }
  if (next.turnSeat === seat) {
    settleLiarTurn(next, seat, rand)
  }
  return next
}

/** 直接终局（全局超时用）：不产生胜者（winnerSeat = null 表示平局/废弃） */
export function finishLiarTable(state: LiarTableState, winnerSeat: number | null): LiarTableState {
  if (state.finished) return state
  const next = cloneLiarTable(state)
  next.finished = true
  next.winnerSeat = winnerSeat
  next.turnSeat = null
  return next
}

// === 启发式决策（联机回合超时托管与单机 AI 共用） ===

/** 一次决策结果：play 带 cards（1–3 张手牌），challenge 不带牌 */
export interface LiarMoveSuggestion {
  action: 'play' | 'challenge'
  cards: number[]
}

export interface LiarSuggestInput {
  /** 决策者当前手牌 */
  hand: number[]
  /** 本局目标牌面 */
  target: LiarTarget
  /** 桌面牌堆顶（null = 本局还没人出过牌，只能出牌） */
  lastPlay: { seat: number; count: number } | null
  rand?: () => number
}

/** 挑一手要出的牌：优先出真牌（≤3 张），约 1/5 概率虚张声势出 1–2 张任意牌 */
function pickLiarPlayCards(hand: number[], target: LiarTarget, rand: () => number): number[] {
  const truthy = hand.filter((card) => liarCardIsTruthy(card, target))
  const mustBluff = truthy.length === 0
  const bluff = mustBluff || rand() < 0.22
  if (bluff) {
    const maxCount = Math.min(2, hand.length)
    const count = 1 + Math.floor(rand() * maxCount)
    return hand.slice(0, count)
  }
  const count = 1 + Math.floor(rand() * Math.min(LIAR_PLAY_MAX, truthy.length))
  return truthy.slice(0, count)
}

/**
 * 启发式决策（托管与单机 AI 共用同一实现）：
 *   - 本局还没人出过牌 → 只能出牌；
 *   - 上一手张数越多越可疑：p(质疑) ≈ 0.14 + 0.15×(张数−1)，自己完全没有真牌时
 *     更倾向靠质疑翻盘（+0.12），真牌充足时更愿意先出牌施压（−0.06），整体夹在 0.05–0.75；
 *   - 决定出牌时优先打真牌，少数情况下虚张声势。固定 rand 时决策可复现。
 */
export function suggestLiarMove(input: LiarSuggestInput, rand: () => number = Math.random): LiarMoveSuggestion | null {
  const { hand, target, lastPlay } = input
  if (hand.length === 0) return null
  const truthyCount = hand.filter((card) => liarCardIsTruthy(card, target)).length

  if (lastPlay !== null && lastPlay.count > 0) {
    let challengeP = 0.14 + 0.15 * (lastPlay.count - 1)
    if (truthyCount === 0) challengeP += 0.12
    if (truthyCount >= 4) challengeP -= 0.06
    challengeP = Math.min(0.75, Math.max(0.05, challengeP))
    if (rand() < challengeP) return { action: 'challenge', cards: [] }
  }
  return { action: 'play', cards: pickLiarPlayCards(hand, target, rand) }
}

// === 确定性随机源（自检脚本 / 测试用） ===

/** mulberry32：给定种子的可复现随机序列（0 ≤ x < 1） */
export function createLiarRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
