/**
 * UNO 服务端引擎 + 联机状态机自检脚本（不依赖数据库 / 网络真实流量）
 *
 * 用法: cd server && npx tsx scripts/verify-uno.ts
 */

process.env.DATABASE_URL ||= 'file:./.verify-uno.db'
process.env.JWT_SECRET ||= 'verify-uno-secret'
process.env.NODE_ENV ||= 'development'

type UnoEngine = typeof import('../src/services/gameUno.js')
type UnoService = typeof import('../src/services/gameUnoService.js')
type GameService = typeof import('../src/services/gameService.js')
type PresenceModule = typeof import('../src/services/gamePresence.js')

let engine: UnoEngine
let service: UnoService
let game: GameService
let presence: PresenceModule

type MatchDto = ReturnType<UnoService['getUnoMatch']>

let passed = 0

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(`断言失败：${label}`)
  passed += 1
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const actualText = JSON.stringify(actual)
  const expectedText = JSON.stringify(expected)
  if (actualText !== expectedText) {
    throw new Error(`断言失败：${label}\n  实际: ${actualText}\n  期望: ${expectedText}`)
  }
  passed += 1
}

function expectThrow(fn: () => unknown, keyword: string, label: string): void {
  try {
    fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes(keyword)) {
      throw new Error(`断言失败：${label} —— 错误消息「${message}」应包含「${keyword}」`)
    }
    passed += 1
    return
  }
  throw new Error(`断言失败：${label} —— 期望抛错（${keyword}）但成功返回`)
}

const HOST = 9501
const P2 = 9502
const P3 = 9503
let clock = Date.now()
function tick(ms = 1_000): number {
  clock += ms
  return clock
}

const FULL_DECK = engine?.createUnoDeck?.() ?? []

function findCard(
  color: string,
  kind: string,
  number: number | null = null,
  excludeIds: number[] = [],
): number {
  const card = FULL_DECK.find(
    (item) =>
      item.color === color
      && item.kind === kind
      && item.number === number
      && !excludeIds.includes(item.id),
  )
  if (!card) throw new Error(`找不到牌：${color} ${kind} ${number ?? ''}`)
  return card.id
}

function cardOf(id: number) {
  const card = FULL_DECK.find((item) => item.id === id)
  if (!card) throw new Error(`找不到牌 id：${id}`)
  return card
}

/** 手工构造牌桌（默认 3 人；未列出的手牌为空） */
function buildState(
  hands: number[][],
  topId: number,
  color: string,
  options: { turnSeat?: number; direction?: 1 | -1; drawnCardId?: number | null } = {},
) {
  const state = engine.createUnoTable(Math.max(2, hands.length), () => 0.5)
  const allHandIds = hands.flat()
  state.players.forEach((player, seat) => {
    player.hand = (hands[seat] ?? []).map(cardOf)
    player.alive = true
  })
  state.discard = [cardOf(topId)]
  state.deck = FULL_DECK.filter((card) => !allHandIds.includes(card.id) && card.id !== topId)
  state.currentColor = color as never
  state.direction = options.direction ?? 1
  state.turnSeat = options.turnSeat ?? 0
  state.drawnCardId = options.drawnCardId ?? null
  state.status = 'playing'
  state.winnerSeat = null
  state.log = []
  return state
}

function turnHolder(dto: MatchDto): number {
  if (dto.turn === null) throw new Error('断言失败：进行中对局应有当前回合')
  return dto.turn.userId
}

function playerOf(dto: MatchDto, userId: number) {
  const player = dto.players.find((candidate) => candidate.userId === userId)
  if (!player) throw new Error(`断言失败：DTO 中找不到玩家 ${userId}`)
  return player
}

// === 引擎：牌堆与规则 ===

function verifyDeck(): void {
  const deck = engine.createUnoDeck()
  assertEqual(deck.length, 108, 'UNO 牌堆应为 108 张')
  assertEqual(new Set(deck.map((card) => card.id)).size, 108, '牌 id 应唯一')
  assertEqual(deck.filter((card) => card.kind === 'wild').length, 4, '万能牌 4 张')
  assertEqual(deck.filter((card) => card.kind === 'wild4').length, 4, '万能+4 4 张')
  for (const color of engine.UNO_COLORS) {
    const cards = deck.filter((card) => card.color === color)
    assertEqual(cards.length, 25, `${color} 应有 25 张`)
    assertEqual(cards.filter((card) => card.kind === 'number' && card.number === 0).length, 1, `${color} 0 一张`)
    assertEqual(cards.filter((card) => card.kind === 'number' && card.number === 5).length, 2, `${color} 5 两张`)
    assertEqual(cards.filter((card) => card.kind === 'draw2').length, 2, `${color} +2 两张`)
  }
  const shuffled = engine.shuffleUnoDeck(deck, engine.createUnoRng(42))
  assertEqual(shuffled.length, 108, '洗牌不改变张数')
  assertEqual(shuffled.map((card) => card.id).sort((a, b) => a - b).join(','), deck.map((c) => c.id).join(','), '洗牌保持多重集')
}

function verifyPlayability(): void {
  const red5 = cardOf(findCard('red', 'number', 5))
  const red7 = cardOf(findCard('red', 'number', 7))
  const blue5 = cardOf(findCard('blue', 'number', 5))
  const blueSkip = cardOf(findCard('blue', 'skip'))
  const redSkip = cardOf(findCard('red', 'skip'))
  const wild = cardOf(findCard('wild', 'wild'))
  const wild4 = cardOf(findCard('wild', 'wild4'))

  assert(engine.unoIsPlayableCard(red7, [red7], red5, 'red'), '同色数字可出')
  assert(engine.unoIsPlayableCard(blue5, [blue5], red5, 'red'), '同数字异色可出')
  assert(engine.unoIsPlayableCard(redSkip, [redSkip], red5, 'red'), '同色功能牌可出')
  assert(engine.unoIsPlayableCard(blueSkip, [blueSkip], redSkip, 'red'), '同类型功能牌可出（颜色不同）')
  assert(!engine.unoIsPlayableCard(blueSkip, [blueSkip], red5, 'red'), '不同色不同功能不可出')
  assert(engine.unoIsPlayableCard(wild, [wild], red5, 'red'), '万能牌随时可出')

  // 万能+4 官方限制
  const blocked = [red7, wild4]
  assert(!engine.unoIsPlayableCard(wild4, blocked, red5, 'red'), '手里有当前颜色时不能出万能+4')
  const allowed = [blueSkip, wild4]
  assert(engine.unoIsPlayableCard(wild4, allowed, red5, 'red'), '手里没有当前颜色时可以出万能+4')
}

function verifyEffects(): void {
  const red5 = findCard('red', 'number', 5)
  const redSkip = findCard('red', 'skip')
  const redReverse = findCard('red', 'reverse')
  const redDraw2 = findCard('red', 'draw2')
  const blue1 = findCard('blue', 'number', 1)
  const green1 = findCard('green', 'number', 1)
  const wild = findCard('wild', 'wild')
  const wild4 = findCard('wild', 'wild4')

  // 禁止：3 人局跳过下家
  let state = buildState([[redSkip, blue1], [blue1], [green1]], red5, 'red')
  state = engine.playUnoCard(state, 0, redSkip)
  assertEqual(state.turnSeat, 2, '禁止应跳过下一家（3 人局到座位 2）')
  assertEqual(state.direction, 1, '禁止不改变方向')

  // 反转：3 人反向；2 人视作禁止（自己继续）
  state = buildState([[redReverse, blue1], [blue1], [green1]], red5, 'red')
  state = engine.playUnoCard(state, 0, redReverse)
  assertEqual(state.direction, -1, '反转改变方向')
  assertEqual(state.turnSeat, 2, '3 人局反转后轮到座位 2')
  state = buildState([[redReverse, blue1], [blue1]], red5, 'red')
  state = engine.playUnoCard(state, 0, redReverse)
  assertEqual(state.turnSeat, 0, '2 人局反转视作禁止，打出者继续')

  // +2：下家摸 2 张并被跳过
  state = buildState([[redDraw2, blue1], [blue1], [green1]], red5, 'red')
  const beforeP2 = state.players[1].hand.length
  state = engine.playUnoCard(state, 0, redDraw2)
  assertEqual(state.turnSeat, 2, '+2 后应跳过下家')
  assertEqual(state.players[1].hand.length, beforeP2 + 2, '+2 下家摸 2 张')

  // 万能：必须指定颜色
  state = buildState([[wild, blue1], [blue1], [green1]], red5, 'red')
  expectThrow(() => engine.playUnoCard(state, 0, wild), '指定颜色', '万能牌未指定颜色应报错')
  state = engine.playUnoCard(state, 0, wild, 'green')
  assertEqual(state.currentColor, 'green', '万能牌指定绿色后当前颜色为绿色')
  assertEqual(state.turnSeat, 1, '万能牌正常轮转')

  // 万能+4：下家摸 4 张并被跳过
  state = buildState([[wild4, blue1], [blue1], [green1]], red5, 'red')
  const before = state.players[1].hand.length
  state = engine.playUnoCard(state, 0, wild4, 'blue')
  assertEqual(state.players[1].hand.length, before + 4, '万能+4 下家摸 4 张')
  assertEqual(state.turnSeat, 2, '万能+4 后跳过下家')

  // 摸牌后只能出刚摸到的牌
  state = buildState([[red5, blue1], [green1], [blue1]], red5, 'red')
  state.drawnCardId = blue1
  expectThrow(() => engine.playUnoCard(state, 0, red5), '刚摸到', '摸牌后不能打其他手牌')
  state = engine.passUnoTurn(state, 0)
  assertEqual(state.turnSeat, 1, '摸牌后跳过应轮转')
  assertEqual(state.drawnCardId, null, 'pass 后清空 drawnCardId')

  // 出完手牌立即获胜
  state = buildState([[red5], [blue1], [green1]], red5, 'red')
  state = engine.playUnoCard(state, 0, red5)
  assertEqual(state.status, 'finished', '出完手牌应结束')
  assertEqual(state.winnerSeat, 0, '出完手牌者获胜')
  assertEqual(state.endReason, 'hand_empty', '结束原因 hand_empty')

  // 淘汰：只剩一人终局
  state = buildState([[red5], [blue1], [green1]], red5, 'red')
  state = engine.eliminateUnoPlayer(state, 1)
  assertEqual(state.status, 'playing', '多人局淘汰一人不结束')
  state = engine.eliminateUnoPlayer(state, 2)
  assertEqual(state.status, 'finished', '只剩一人应结束')
  assertEqual(state.winnerSeat, 0, '最后存活者获胜')
  assertEqual(state.endReason, 'last_standing', '结束原因 last_standing')
}

function verifySuggest(): void {
  const red5 = cardOf(findCard('red', 'number', 5))
  const redDraw2 = cardOf(findCard('red', 'draw2'))
  const blue1 = cardOf(findCard('blue', 'number', 1))
  const wild = cardOf(findCard('wild', 'wild'))

  assertEqual(
    engine.suggestUnoMove({ hand: [blue1], top: red5, currentColor: 'red', drawnCardId: null }),
    { action: 'draw' },
    '无牌可出时 AI 应摸牌',
  )
  const withAction = engine.suggestUnoMove({
    hand: [redDraw2, red5],
    top: red5,
    currentColor: 'red',
    drawnCardId: null,
    nextHandCount: 1,
  })
  assertEqual(withAction.action, 'play', '下家只剩 1 张时优先功能牌')
  assertEqual(withAction.cardId, redDraw2.id, '应优先打出 +2')
  const wildChoice = engine.suggestUnoMove({
    hand: [wild, blue1, blue1, blue1],
    top: red5,
    currentColor: 'red',
    drawnCardId: null,
  })
  assertEqual(wildChoice.action, 'play', '万能牌可出时应出牌')
  assertEqual((wildChoice as { color?: string }).color, 'blue', '万能牌应选择手牌最多的颜色')
}

function verifyAiSelfPlay(): void {
  const rng = engine.createUnoRng(20261026)
  let state = engine.createUnoTable(4, rng)
  let steps = 0
  while (state.status === 'playing' && steps < 2000) {
    const seat = state.turnSeat
    assert(seat !== null, '进行中应有回合')
    if (seat === null) break
    const player = state.players[seat]
    const top = state.discard[state.discard.length - 1]
    assert(Boolean(player && top), '牌桌状态完整')
    if (!player || !top) break
    const move = engine.suggestUnoMove({
      hand: player.hand,
      top,
      currentColor: state.currentColor,
      drawnCardId: state.drawnCardId,
      nextHandCount: state.players[(seat + 1) % state.players.length]?.hand.length,
    }, rng)
    try {
      state = move.action === 'play'
        ? engine.playUnoCard(state, seat, move.cardId, move.color, rng)
        : move.action === 'draw'
          ? engine.drawUnoTurn(state, seat, rng)
          : engine.passUnoTurn(state, seat)
    } catch (error) {
      throw new Error(`AI 自对弈第 ${steps} 步非法：${error instanceof Error ? error.message : error}`)
    }
    steps += 1
  }
  assert(state.status === 'finished', 'AI 自对弈应能分出胜负（或只剩一人）')
  assert(steps < 2000, 'AI 自对弈步数不应失控')
  assert(state.winnerSeat !== null, '自对弈应产生胜者')
  for (const player of state.players) {
    for (const card of player.hand) assert(card.id >= 0 && card.id < 108, '手牌 id 合法')
  }
}

// === 服务：房间 / 动作 / 结算 ===

function verifyServiceLifecycle(): void {
  // 发牌是随机的，极小概率房主起手无牌可出；重发直到出现可出牌的局
  let base = tick()
  let matchId = 0
  let hostView: ReturnType<typeof service.getUnoMatch> | null = null
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (attempt > 0) service.resetUnoStateForTest()
    base = tick()
    matchId = service.createUnoRoomForTest(HOST, 'u9501', [P2, P3], base).matchId
    service.startUnoMatch(HOST, matchId, base + 1)
    const view = service.getUnoMatch(HOST, matchId, base + 2)
    const topCard = view.topCard
    const playable = topCard ? engine.unoPlayableCards(view.myHand, topCard, view.currentColor ?? 'red') : []
    if (playable.length > 0) {
      hostView = view
      break
    }
  }
  if (!hostView) throw new Error('50 次发牌内应出现房主可出牌的起始手牌')

  assertEqual(hostView.status, 'playing', '开局后状态为 playing')
  assertEqual(hostView.players.length, 3, '3 人房间')
  assertEqual(hostView.myHand.length, 7, '每人发 7 张')
  assertEqual(hostView.deckCount, 108 - 21 - 1, '牌堆剩余张数 = 108 - 手牌 - 顶牌')
  assert(Boolean(hostView.topCard && hostView.topCard.color !== 'wild'), '起始顶牌不是万能牌')
  assertEqual(turnHolder(hostView), HOST, '房主先手')
  const p2View = service.getUnoMatch(P2, matchId, base + 2)
  assertEqual(p2View.myHand.length, 7, 'P2 手牌 7 张')
  assert(p2View.myHand.map((c) => c.id).join(',') !== hostView.myHand.map((c) => c.id).join(','), 'DTO 按观看者裁剪手牌')

  // 非回合动作 409
  expectThrow(
    () => service.applyUnoAction(P2, matchId, { type: 'draw' }, base + 3),
    '还没轮到你',
    '非当前回合摸牌应 409',
  )

  // HOST 出一张合法牌
  const top = hostView.topCard
  assert(Boolean(top), '应有顶牌')
  if (!top) return
  const playable = engine.unoPlayableCards(hostView.myHand, top, hostView.currentColor ?? 'red')
  // 优先出无功能牌（数字 / 万能），保证下家就是 P2；只有全是功能牌时才按效果推算
  const card =
    playable.find((item) => item.kind === 'number')
    ?? playable.find((item) => item.kind === 'wild')
    ?? playable[0]
  const afterPlay = service.applyUnoAction(
    HOST,
    matchId,
    { type: 'play', cardId: card.id, color: card.color === 'wild' ? 'red' : undefined },
    base + 4,
  )
  const turnEffect =
    card.kind === 'skip' || card.kind === 'reverse' || card.kind === 'draw2' || card.kind === 'wild4'
  assertEqual(afterPlay.match.version, hostView.version + 1, '出牌推进版本')
  assertEqual(turnHolder(afterPlay.match), turnEffect ? P3 : P2, '出牌后轮到下家（功能牌跳过一位）')
  assertEqual(playerOf(afterPlay.match, HOST).handCount, 6, '出牌者手牌 -1')

  // 认输：P3 出局，剩 2 人继续
  const afterResign = service.resignUnoMatch(P3, matchId, base + 5)
  assertEqual(afterResign.match.status, 'playing', '3 人局认输 1 人不应终局')
  assertEqual(playerOf(afterResign.match, P3).status, 'lost', '认输者出局')
  // 再认输 → 只剩 HOST
  const finished = service.resignUnoMatch(P2, matchId, base + 6)
  assertEqual(finished.match.status, 'finished', '只剩一人应终局')
  assertEqual(finished.match.reason, 'last_standing', '结束原因 last_standing')
  assertEqual(finished.match.winnerId, HOST, '最后存活者获胜')
}

function verifyTimeoutAndForfeit(): void {
  // 回合超时托管
  service.resetUnoStateForTest()
  const base = tick()
  const { matchId } = service.createUnoRoomForTest(HOST, 'u9501', [P2], base)
  service.startUnoMatch(HOST, matchId, base + 1)
  presence.markGamePresence(HOST, base + 2)
  presence.markGamePresence(P2, base + 2)
  const before = service.getUnoMatch(HOST, matchId, base + 2)
  service.runUnoSweeper(base + service.UNO_TURN_MS + 2_000)
  const after = service.getUnoMatch(HOST, matchId, base + service.UNO_TURN_MS + 2_500)
  assert(after.version > before.version, '回合超时应自动托管')
  assert(after.status === 'playing' || after.status === 'finished', '托管后对局状态合法')

  // 掉线判负：HOST 保持在线，P2 从无心跳
  service.resetUnoStateForTest()
  const base2 = tick()
  const { matchId: ffMatch } = service.createUnoRoomForTest(HOST, 'u9501', [P2], base2)
  service.startUnoMatch(HOST, ffMatch, base2 + 1)
  presence.clearGamePresence(HOST)
  presence.clearGamePresence(P2)
  presence.markGamePresence(HOST, base2 + service.UNO_DISCONNECT_FORFEIT_MS + 9_000)
  service.runUnoSweeper(base2 + service.UNO_DISCONNECT_FORFEIT_MS + 10_000)
  const ffView = service.getUnoMatch(HOST, ffMatch, base2 + service.UNO_DISCONNECT_FORFEIT_MS + 10_500)
  assertEqual(ffView.status, 'finished', '对手掉线后应终局')
  assertEqual(ffView.reason, 'last_standing', '掉线判负结束原因')
  assertEqual(ffView.winnerId, HOST, '在线房主获胜')
  assertEqual(playerOf(ffView, P2).status, 'lost', '掉线者出局')
}

function verifySyncAndMutex(): void {
  service.resetUnoStateForTest()
  const base = tick()
  const { matchId } = service.createUnoRoomForTest(HOST, 'u9501', [P2], base)
  service.startUnoMatch(HOST, matchId, base + 1)
  assertEqual(service.getActiveUnoMatch(HOST, base + 2)?.id, matchId, 'active 返回当前对局')
  assertEqual(service.getUnoSync(P2, matchId, base + 2).match?.id, matchId, 'sync 指定 matchId 返回对局')
  expectThrow(() => service.getUnoSync(P3, matchId, base + 2), '对局不存在', '非参与者 sync 应 404')
  assert(game.isUserBusyInOtherGames(HOST), 'UNO 玩家应被其他游戏视为忙')
  assert(game.isUserBusyInOtherGames(HOST, 'uno') === false, '自家检查应排除自己')

  // 等待房间解散 + 结束回收
  service.resetUnoStateForTest()
  const base2 = tick()
  const { matchId: idle } = service.createUnoRoomForTest(HOST, 'u9501', [], base2)
  const cancelled = service.getUnoMatch(HOST, idle, base2 + service.UNO_WAITING_ROOM_TTL_MS + 1_000)
  assertEqual(cancelled.reason, 'cancelled', '等待房间超时应解散')
}

async function main(): Promise<void> {
  engine = await import('../src/services/gameUno.js')
  service = await import('../src/services/gameUnoService.js')
  game = await import('../src/services/gameService.js')
  presence = await import('../src/services/gamePresence.js')

  // FULL_DECK 在 engine 动态导入后再取
  const deck = engine.createUnoDeck()
  FULL_DECK.length = 0
  FULL_DECK.push(...deck)

  verifyDeck()
  verifyPlayability()
  verifyEffects()
  verifySuggest()
  verifyAiSelfPlay()
  verifyServiceLifecycle()
  verifyTimeoutAndForfeit()
  verifySyncAndMutex()

  service.resetUnoStateForTest()
  console.log(`✓ verify-uno 全部通过（${passed} 条断言）`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
