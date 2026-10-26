/**
 * 骗子酒馆服务端引擎 + 联机状态机自检脚本（不依赖数据库 / 网络真实流量）
 *
 * 用法: cd server && npx tsx scripts/verify-liar.ts
 *
 * 覆盖：
 *   - 引擎：常量与牌堆编排（K×6 / Q×6 / A×6 / 鬼牌×2）、牌面映射、鬼牌万能、
 *     洗牌保多重集、发牌规模与不重不漏、目标牌面随机、出牌合法性（1–3 张 / 手牌子集 /
 *     不重复）、左轮子弹数递增与封顶、扣扳机命中率、牌桌状态机（出牌轮转 / 手牌出完
 *     跳过 / 质疑开牌真假定输家 / 扣扳机生死都重发 / 只剩一人终局 / 全员出完流局 /）
 *     认输淘汰不结束多人局、suggestLiarMove 决策（不空手质疑 / 概率档位 / 牌组合法）、
 *     AI 自对弈完整性（必然终止且每步合法）、mulberry32 可复现。
 *   - 服务：建房 → 邀请（接受 / 拒绝 / 过期 / 房间已满 4 人）→ 开始（2 人即可开局、
 *     座位 0 先行）→ DTO 隐藏信息裁剪（myHand 只有自己的牌、牌堆只下发张数）、
 *     非回合 409、非法牌组 400、质疑开牌与扳机（Math.random 桩定死生死两分支）、
 *     回合超时自动托管、认输淘汰（多人局继续 / 剩一人终局）、掉线判负出局、
 *     全局 timeout 废弃、leave 与房主解散、结束对局保留 5 分钟后回收、
 *     主 sweeper 驱动、跨游戏互斥探针。
 *
 * 说明：时间一律用显式 now 参数驱动（不依赖真实定时器）；
 * 邀请用测试入口直接登记，避开数据库里的好友关系校验；
 * 涉及随机生死的服务端路径用临时替换 Math.random 的方式定死（引擎默认参数按调用时取值）。
 */

// 依赖模块会读 DATABASE_URL / JWT_SECRET：先给默认值再动态 import，
// Prisma 为惰性连接，只要脚本不触发真实查询就不会碰到数据库。
process.env.DATABASE_URL ||= 'file:./.verify-liar.db'
process.env.JWT_SECRET ||= 'verify-liar-secret'
process.env.NODE_ENV ||= 'development'

type LiarEngine = typeof import('../src/services/gameLiar.js')
type LiarService = typeof import('../src/services/gameLiarService.js')
type GameService = typeof import('../src/services/gameService.js')
type PresenceModule = typeof import('../src/services/gamePresence.js')

let engine: LiarEngine
let service: LiarService
let game: GameService
let presence: PresenceModule

type MatchDto = ReturnType<LiarService['getLiarMatch']>

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

/** 期待同步调用抛错（错误消息包含 keyword） */
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

/** 当前回合持有者（进行中对局必须存在） */
function turnHolder(dto: MatchDto): number {
  if (dto.turn === null) throw new Error('断言失败：进行中对局应有当前回合')
  return dto.turn.userId
}

function playerOf(dto: MatchDto, userId: number) {
  const player = dto.players.find((candidate) => candidate.userId === userId)
  if (!player) throw new Error(`断言失败：DTO 中找不到玩家 ${userId}`)
  return player
}

/** 事件流里找某类最新条目 */
function lastLogOf<T extends { type: string }>(log: Array<{ type: string }>, type: string): T {
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const entry = log[i]
    if (entry && entry.type === type) return entry as T
  }
  throw new Error(`断言失败：事件流里没有 ${type} 条目`)
}

/** 临时把 Math.random 换成固定值（引擎与服务默认参数按调用时取 Math.random） */
function withRandom<T>(value: number, fn: () => T): T {
  const original = Math.random
  Math.random = () => value
  try {
    return fn()
  } finally {
    Math.random = original
  }
}

/** 走到「轮到 userId」需要的时间步进（避免回合超时干扰，每步 +1s） */
let clock = Date.now()

function tick(ms = 1_000): number {
  clock += ms
  return clock
}

// === 引擎：常量与牌堆 ===

function verifyEngineConstants(): void {
  assertEqual(
    {
      LIAR_DECK_SIZE: engine.LIAR_DECK_SIZE,
      LIAR_HAND_SIZE: engine.LIAR_HAND_SIZE,
      LIAR_PLAY_MIN: engine.LIAR_PLAY_MIN,
      LIAR_PLAY_MAX: engine.LIAR_PLAY_MAX,
      LIAR_TARGET_COPIES: engine.LIAR_TARGET_COPIES,
      LIAR_JOKER_COPIES: engine.LIAR_JOKER_COPIES,
      LIAR_GUN_CHAMBERS: engine.LIAR_GUN_CHAMBERS,
      LIAR_MIN_PLAYERS: engine.LIAR_MIN_PLAYERS,
      LIAR_MAX_PLAYERS: engine.LIAR_MAX_PLAYERS,
    },
    {
      LIAR_DECK_SIZE: 20,
      LIAR_HAND_SIZE: 5,
      LIAR_PLAY_MIN: 1,
      LIAR_PLAY_MAX: 3,
      LIAR_TARGET_COPIES: 6,
      LIAR_JOKER_COPIES: 2,
      LIAR_GUN_CHAMBERS: 6,
      LIAR_MIN_PLAYERS: 2,
      LIAR_MAX_PLAYERS: 4,
    },
    '骗子酒馆常量应与前后端唯一真相源逐字一致',
  )
}

function verifyDeckAndKinds(): void {
  const deck = engine.createLiarDeck()
  assertEqual(deck, Array.from({ length: 20 }, (_, index) => index), '新牌堆应为 0–19')

  // 牌面编排：K = 0–5、Q = 6–11、A = 12–17、鬼牌 = 18–19
  assertEqual(engine.liarCardKind(0), 'K', '牌 0 应为 K')
  assertEqual(engine.liarCardKind(5), 'K', '牌 5 应为 K')
  assertEqual(engine.liarCardKind(6), 'Q', '牌 6 应为 Q')
  assertEqual(engine.liarCardKind(11), 'Q', '牌 11 应为 Q')
  assertEqual(engine.liarCardKind(12), 'A', '牌 12 应为 A')
  assertEqual(engine.liarCardKind(17), 'A', '牌 17 应为 A')
  assertEqual(engine.liarCardKind(18), 'JOKER', '牌 18 应为鬼牌')
  assertEqual(engine.liarCardKind(19), 'JOKER', '牌 19 应为鬼牌')
  expectThrow(() => engine.liarCardKind(20), '无效的牌', '牌 id 越界应抛错')
  expectThrow(() => engine.liarCardKind(-1), '无效的牌', '负数牌 id 应抛错')

  // 鬼牌万能：对任何目标都算真牌
  for (const target of ['K', 'Q', 'A'] as const) {
    assert(engine.liarCardIsTruthy(18, target), `鬼牌对 ${target} 应视为真牌`)
    assert(engine.liarCardIsTruthy(19, target), `鬼牌对 ${target} 应视为真牌`)
  }
  assert(engine.liarCardIsTruthy(2, 'K'), 'K 对目标 K 应为真牌')
  assert(!engine.liarCardIsTruthy(8, 'K'), 'Q 对目标 K 应为假牌')
  assert(!engine.liarCardIsTruthy(13, 'K'), 'A 对目标 K 应为假牌')
  assert(engine.liarCardsAreTruthy([0, 6, 18], 'K') === false, '掺一张 Q 即整组为谎')
  assert(engine.liarCardsAreTruthy([0, 5, 18], 'K'), 'K + K + 鬼牌应为全真')

  // 洗牌保多重集且不改入参
  const shuffled = engine.shuffleLiarDeck(deck, engine.createLiarRng(7))
  assertEqual([...shuffled].sort((a, b) => a - b), deck, '洗牌应保持牌的多重集不变')
  assertEqual(deck, Array.from({ length: 20 }, (_, index) => index), '洗牌不应修改入参')
  assertEqual(
    engine.shuffleLiarDeck(deck, engine.createLiarRng(7)),
    shuffled,
    '固定种子洗牌应可复现',
  )

  // 发牌：2–4 人各 5 张、不重不漏、越界人数抛错
  for (const count of [2, 3, 4]) {
    const hands = engine.dealLiarHands(count, engine.createLiarRng(100 + count))
    assertEqual(hands.length, count, `${count} 人应发 ${count} 份手牌`)
    const seen = new Set<number>()
    for (const hand of hands) {
      assertEqual(hand.length, 5, '每份手牌应恰好 5 张')
      for (const card of hand) {
        assert(!seen.has(card), '发牌不应重复发同一张牌')
        seen.add(card)
        assert(card >= 0 && card < 20, '发牌牌 id 应在 0–19 内')
      }
    }
  }
  expectThrow(() => engine.dealLiarHands(1), '骗子酒馆支持', '1 人发牌应抛错')
  expectThrow(() => engine.dealLiarHands(5), '骗子酒馆支持', '5 人发牌应抛错')

  // 目标牌面：必然是 K/Q/A 之一，固定种子可复现
  for (let i = 0; i < 30; i += 1) {
    const target = engine.pickLiarTarget(engine.createLiarRng(i))
    assert(target === 'K' || target === 'Q' || target === 'A', '目标牌面应为 K/Q/A')
  }
  assertEqual(
    engine.pickLiarTarget(engine.createLiarRng(42)),
    engine.pickLiarTarget(engine.createLiarRng(42)),
    '固定种子的目标牌面应可复现',
  )
}

function validateValidLiarPlay(): void {
  const hand = [0, 6, 12, 18, 19]
  assert(engine.isValidLiarPlay(hand, [0]), '出 1 张手牌应合法')
  assert(engine.isValidLiarPlay(hand, [0, 6, 18]), '出 3 张手牌应合法')
  assert(!engine.isValidLiarPlay(hand, []), '出 0 张应非法')
  assert(!engine.isValidLiarPlay(hand, [0, 6, 12, 18]), '出 4 张应非法')
  assert(!engine.isValidLiarPlay(hand, [1]), '出非手牌应非法')
  assert(!engine.isValidLiarPlay(hand, [0, 0]), '重复出同一张应非法')
  assert(!engine.isValidLiarPlay([0], [0, 6]), '出手牌张数以上的牌应非法')
}

function verifyGun(): void {
  assertEqual(engine.liarGunBullets(0), 1, '0 死亡应为 1 颗子弹')
  assertEqual(engine.liarGunBullets(1), 2, '1 死亡应为 2 颗子弹')
  assertEqual(engine.liarGunBullets(5), 6, '5 死亡应为 6 颗子弹（封顶）')
  assertEqual(engine.liarGunBullets(9), 6, '超过弹巢数应封顶 6')

  // 固定随机源下的命中边界：rand < bullets/6
  assert(!engine.liarTriggerHits(0, () => 0.17), '1/6 概率下 rand=0.17 不应命中')
  assert(engine.liarTriggerHits(0, () => 0.16), '1/6 概率下 rand=0.16 应命中')
  assert(engine.liarTriggerHits(1, () => 0.2), '2/6 概率下 rand=0.2 应命中')
  assert(engine.liarTriggerHits(5, () => 0.99), '6/6 概率下 rand=0.99 应命中（<1 即命中）')
  assert(!engine.liarTriggerHits(0, () => 0.5), '1/6 概率下 rand=0.5 不应命中')

  const rngA = engine.createLiarRng(123)
  const rngB = engine.createLiarRng(123)
  for (let i = 0; i < 10; i += 1) {
    assertEqual(rngA(), rngB(), 'mulberry32 同种子序列应一致')
  }
  assert(rngA() !== rngA(), 'mulberry32 连续取值应变化')
}

// === 引擎：牌桌状态机 ===

/** 构造一张指定手牌的测试牌桌（直接改写引擎状态，控制真假牌面） */
function craftTable(hands: number[][], target: 'K' | 'Q' | 'A'): ReturnType<typeof engine.createLiarTable> {
  const table = engine.createLiarTable(hands.length, () => 0.5)
  table.target = target
  hands.forEach((hand, seat) => {
    const player = table.players[seat]
    if (player) {
      player.hand = [...hand]
    }
  })
  // 重写第 1 局日志里的目标，保持事件流与状态一致
  const roundEntry = table.log.find((entry) => entry.type === 'round')
  if (roundEntry && roundEntry.type === 'round') roundEntry.target = target
  return table
}

function verifyTablePlayFlow(): void {
  // 四人局：座位 0 出 2 张 → 座位 1；座位 1 只剩 1 张出完 → 跳过到座位 2
  let table = craftTable(
    [
      [0, 1, 2, 3, 4],
      [5, 6, 7, 8, 9],
      [10, 11, 12, 13, 14],
      [15, 16, 17, 18, 19],
    ],
    'K',
  )
  assertEqual(table.round, 1, '新牌桌应为第 1 局')
  assertEqual(table.turnSeat, 0, '第 1 局应由座位 0 先行')
  assert(table.players.every((player) => player.hand.length === 5), '开局每人应有 5 张手牌')

  table = engine.applyLiarTablePlay(table, 0, [0, 1])
  assertEqual(table.players[0]?.hand.length, 3, '出 2 张后手牌应剩 3 张')
  assertEqual(table.pile.length, 1, '牌堆应有 1 手')
  assertEqual(table.pile[0]?.count, 2, '牌堆顶应为 2 张')
  assertEqual(table.pile[0]?.cards.length, 2, '牌堆内部应保留真实牌面（DTO 层裁剪）')
  assertEqual(table.turnSeat, 1, '出牌后应轮到座位 1')

  expectThrow(() => engine.applyLiarTablePlay(table, 0, [2]), '还没轮到你', '非回合出牌应抛错')
  expectThrow(() => engine.applyLiarTablePlay(table, 1, [5, 6, 7, 8]), '要出的牌', '出 4 张应抛错')
  expectThrow(() => engine.applyLiarTablePlay(table, 1, [10]), '要出的牌', '出非手牌应抛错')

  // 座位 1 打出最后一张 → 轮转应跳过空手座位 1（到座位 2）
  const skipTable = craftTable(
    [
      [0, 1, 2, 3, 4],
      [5],
      [10, 11, 12, 13, 14],
      [15, 16, 17, 18, 19],
    ],
    'K',
  )
  const afterSkip = engine.applyLiarTablePlay(engine.applyLiarTablePlay(skipTable, 0, [0, 1]), 1, [5])
  assertEqual(afterSkip.players[1]?.hand.length, 0, '座位 1 手牌应出完')
  assertEqual(afterSkip.turnSeat, 2, '空手座位应被跳过，轮到座位 2')

  // 质疑自己的出牌应抛错：让座位 2 出完后全场只剩座位 2 有牌……此处直接构造
  const solo = craftTable([[0, 1, 2], [], [], []], 'K')
  const soloAfter = engine.applyLiarTablePlay(solo, 0, [0])
  assertEqual(soloAfter.turnSeat, 0, '只剩自己有牌时应轮回自己继续出')
  expectThrow(
    () => engine.applyLiarTableChallenge(soloAfter, 0),
    '不能质疑自己的出牌',
    '质疑自己的出牌应抛错',
  )

  // 桌上没牌时质疑应抛错
  expectThrow(
    () => engine.applyLiarTableChallenge(craftTable([[0], [1]], 'K'), 0),
    '桌上还没有可以质疑的出牌',
    '首手直接质疑应抛错',
  )
}

function verifyTableChallengeBluff(): void {
  // 目标 K：座位 0 出 [6, 7]（两张 Q，假牌），座位 1 质疑 → 座位 0 输
  const table = craftTable(
    [
      [6, 7, 0, 1, 2],
      [3, 4, 5, 18, 19],
    ],
    'K',
  )
  const played = engine.applyLiarTablePlay(table, 0, [6, 7])
  // rand=0.99：扣扳机永不命中（1/6 概率）
  const revealed = withRandom(0.99, () => engine.applyLiarTableChallenge(played, 1))

  assertEqual(revealed.lastReveal?.seat, 0, '开牌对象应为座位 0')
  assertEqual(revealed.lastReveal?.cards, [6, 7], '开牌应翻开真实牌面')
  assertEqual(revealed.lastReveal?.truthful, false, '两张 Q 应判为假牌')
  assertEqual(revealed.lastReveal?.challengerSeat, 1, '质疑发起者应为座位 1')
  const trigger = lastLogOf<{ type: string; seat: number; bullets: number; died: boolean }>(
    revealed.log,
    'trigger',
  )
  assertEqual(trigger.seat, 0, '输家（被打出者）应扣扳机')
  assertEqual(trigger.bullets, 1, '首次扣扳机应为 1 颗子弹')
  assertEqual(trigger.died, false, 'rand=0.99 不应中弹')
  // 生死都重发：进入第 2 局、手牌重新发满、牌堆清空、lastReveal 保留
  assertEqual(revealed.round, 2, '质疑结算后应进入第 2 局')
  assertEqual(revealed.pile.length, 0, '新局牌堆应清空')
  assertEqual(revealed.players[0]?.hand.length, 5, '第 2 局应重新发满 5 张')
  assertEqual(revealed.turnSeat, 1, '新局应由扣扳机者（座位 0）的下一位开局')
  assertEqual(revealed.deaths, 0, '无人中弹死亡数不变')
  const revealLog = lastLogOf<{ type: string; truthful: boolean }>(revealed.log, 'reveal')
  assertEqual(revealLog.truthful, false, '事件流应记录开牌结果')
}

function verifyTableChallengeTruth(): void {
  // 目标 K：座位 0 出 [0, 5, 18]（K + K + 鬼牌，全真），座位 1 质疑 → 质疑者输
  const table = craftTable(
    [
      [0, 5, 18, 6, 7],
      [8, 9, 10, 11, 19],
    ],
    'K',
  )
  const played = engine.applyLiarTablePlay(table, 0, [0, 5, 18])
  const revealed = withRandom(0.99, () => engine.applyLiarTableChallenge(played, 1))

  assertEqual(revealed.lastReveal?.truthful, true, 'K + K + 鬼牌应判为全真')
  const trigger = lastLogOf<{ type: string; seat: number }>(revealed.log, 'trigger')
  assertEqual(trigger.seat, 1, '质疑者应输并扣扳机')
  assertEqual(revealed.round, 2, '质疑结算后应进入第 2 局')
  assertEqual(revealed.turnSeat, 0, '新局应由扣扳机者（座位 1）的下一位（座位 0）开局')
}

function verifyTableChallengeDeath(): void {
  // 2 人局：rand=0 → 扳机必命中 → 输家死亡 → 只剩一人 → 终局
  const table = craftTable(
    [
      [6, 7, 0, 1, 2],
      [3, 4, 5, 18, 19],
    ],
    'K',
  )
  const played = engine.applyLiarTablePlay(table, 0, [6, 7])
  const finished = withRandom(0, () => engine.applyLiarTableChallenge(played, 1))

  assertEqual(finished.finished, true, '2 人局一人中弹即终局')
  assertEqual(finished.winnerSeat, 1, '质疑者应获胜')
  assertEqual(finished.turnSeat, null, '终局后回合应清空')
  assertEqual(finished.deaths, 1, '死亡人数应为 1')
  assertEqual(finished.players[0]?.alive, false, '输家应出局')
  assertEqual(finished.players[0]?.hand.length, 0, '出局者手牌应清空')
  assertEqual(finished.round, 1, '终局不应开启新局')
}

function verifyTableFlush(): void {
  // 全员只剩 1 张且都出完 → 流局重发，无人扣扳机
  const table = craftTable([[0], [1], [2], [3]], 'K')
  assertEqual(table.deaths, 0, '流局前死亡数应为 0')
  const afterP0 = engine.applyLiarTablePlay(table, 0, [0])
  assertEqual(afterP0.turnSeat, 1, '座位 0 出完应轮到座位 1')
  const afterP1 = engine.applyLiarTablePlay(afterP0, 1, [1])
  assertEqual(afterP1.turnSeat, 2, '座位 1 出完应轮到座位 2')
  const afterP2 = engine.applyLiarTablePlay(afterP1, 2, [2])
  assertEqual(afterP2.turnSeat, 3, '座位 2 出完应轮到座位 3')
  const flushed = engine.applyLiarTablePlay(afterP2, 3, [3])
  assertEqual(flushed.round, 2, '全员出完应流局并开启第 2 局')
  assertEqual(flushed.deaths, 0, '流局不应有人扣扳机')
  assertEqual(flushed.pile.length, 0, '流局后牌堆应清空')
  assertEqual(lastLogOf<{ type: string; round: number }>(flushed.log, 'flush').round, 1, '流局应记录发生局数')
  assert(flushed.players.every((player) => player.hand.length === 5), '流局重发应发满手牌')
}

function verifyTableEliminate(): void {
  // 四人局：座位 1 认输 → 对局继续、子弹 +1；轮到座位 1 时跳过
  const table = craftTable(
    [
      [0, 1, 2, 3, 4],
      [5, 6, 7, 8, 9],
      [10, 11, 12, 13, 14],
      [15, 16, 17, 18, 19],
    ],
    'K',
  )
  const afterPlay = engine.applyLiarTablePlay(table, 0, [0])
  assertEqual(afterPlay.turnSeat, 1, '座位 0 出牌后应轮到座位 1')

  const resigned = engine.eliminateLiarTablePlayer(afterPlay, 1, 'resign')
  assertEqual(resigned.finished, false, '4 人局认输 1 人不应终局')
  assertEqual(resigned.deaths, 1, '认输死亡应推高死亡数')
  assertEqual(resigned.turnSeat, 2, '认输者是当前回合持有者，应顺延给座位 2')
  assertEqual(resigned.players[1]?.alive, false, '认输者应出局')
  assertEqual(resigned.players[1]?.hand.length, 0, '认输者手牌应清空')
  expectThrow(() => engine.eliminateLiarTablePlayer(resigned, 1, 'resign'), '已出局', '重复淘汰应抛错')

  // 继续淘汰到只剩 1 人 → 终局
  const resigned2 = engine.eliminateLiarTablePlayer(resigned, 2, 'resign')
  assertEqual(resigned2.finished, false, '剩 2 人不应终局')
  const finished = engine.eliminateLiarTablePlayer(resigned2, 3, 'resign')
  assertEqual(finished.finished, true, '只剩 1 人应终局')
  assertEqual(finished.winnerSeat, 0, '最后存活者应为座位 0')

  expectThrow(
    () => engine.eliminateLiarTablePlayer(craftTable([[0], [1]], 'K'), 5, 'resign'),
    '已出局',
    '淘汰不存在的座位应抛错',
  )
  const doneTable = craftTable([[0], [1]], 'K')
  const done = engine.finishLiarTable(doneTable, null)
  assertEqual(done.finished, true, 'finishLiarTable 应立即终局')
  assertEqual(done.winnerSeat, null, 'finishLiarTable(null) 无胜者')
  assertEqual(engine.finishLiarTable(done, 0), done, '对已终局牌桌应幂等返回原状态')
  expectThrow(
    () => engine.eliminateLiarTablePlayer(done, 0, 'resign'),
    '对局已结束',
    '终局后淘汰应抛错',
  )
}

// === 引擎：启发式决策 ===

function verifySuggestLiarMove(): void {
  // 空手不决策
  assertEqual(engine.suggestLiarMove({ hand: [], target: 'K', lastPlay: null }), null, '空手应无决策')

  // 本局首手只能出牌（rand=0 也绝不质疑）
  const hand = [0, 6, 12, 18, 19]
  for (const rand of [0, 0.5, 0.99]) {
    const move = engine.suggestLiarMove({ hand, target: 'K', lastPlay: null }, () => rand)
    assert(move !== null && move.action === 'play', '没有上一手时只能出牌')
    assert(
      move !== null && move.cards.length >= 1 && move.cards.length <= 3,
      '建议出牌应为 1–3 张',
    )
    if (move) {
      const remaining = new Set(hand)
      for (const card of move.cards) {
        assert(remaining.delete(card), '建议出牌必须来自手牌且不重复')
      }
    }
  }

  // 概率档位（p = 0.14 + 0.15×(张数−1)，无真牌 +0.12，真牌 ≥4 −0.06）：
  //   rand=0.13 < 0.14 → 质疑；rand=0.5、张数 1（p=0.14）→ 出牌
  const lastPlay1 = { seat: 1, count: 1 }
  const lastPlay3 = { seat: 1, count: 3 }
  assertEqual(
    engine.suggestLiarMove({ hand, target: 'K', lastPlay: lastPlay1 }, () => 0.13)?.action,
    'challenge',
    'rand=0.13、上一手 1 张应质疑（p=0.14）',
  )
  assertEqual(
    engine.suggestLiarMove({ hand, target: 'K', lastPlay: lastPlay1 }, () => 0.5)?.action,
    'play',
    'rand=0.5、上一手 1 张应出牌',
  )
  assertEqual(
    engine.suggestLiarMove({ hand, target: 'K', lastPlay: lastPlay3 }, () => 0.4)?.action,
    'challenge',
    'rand=0.4、上一手 3 张应质疑（p=0.44）',
  )
  // 全假手牌（对目标 K 全是 Q/A）更倾向质疑：p = 0.14 + 0.12 = 0.26
  const noTruthy = [6, 7, 12, 13, 8]
  assertEqual(
    engine.suggestLiarMove({ hand: noTruthy, target: 'K', lastPlay: lastPlay1 }, () => 0.2)?.action,
    'challenge',
    '没有真牌时应更倾向质疑（p=0.26）',
  )
  // 真牌充足时更愿意出牌：p = 0.44 − 0.06 = 0.38
  const truthyRich = [0, 1, 2, 3, 4]
  assertEqual(
    engine.suggestLiarMove({ hand: truthyRich, target: 'K', lastPlay: lastPlay3 }, () => 0.4)?.action,
    'play',
    '真牌充足时应更愿意出牌（p=0.38）',
  )
}

function verifyAiSelfPlay(): void {
  // 双座位都用 suggestLiarMove 互打：必然在有限步内终局且每步合法
  const rng = engine.createLiarRng(42)
  let table = engine.createLiarTable(2, rng)
  let actions = 0
  while (!table.finished && actions < 500) {
    const seat = table.turnSeat
    if (seat === null) break
    const player = table.players[seat]
    const top = table.pile[table.pile.length - 1] ?? null
    const move = engine.suggestLiarMove(
      {
        hand: player?.hand ?? [],
        target: table.target,
        lastPlay: top === null ? null : { seat: top.seat, count: top.count },
      },
      rng,
    )
    if (move === null) break
    if (move.action === 'play') {
      table = engine.applyLiarTablePlay(table, seat, move.cards, rng)
    } else {
      table = engine.applyLiarTableChallenge(table, seat, rng)
    }
    actions += 1
  }
  assert(table.finished, 'AI 自对弈应在 500 步内终局')
  assert(table.winnerSeat !== null, 'AI 自对弈应产生胜者')
  assert(table.log.some((entry) => entry.type === 'death'), 'AI 自对弈应有人中弹出局')
  assert(table.log.some((entry) => entry.type === 'challenge'), 'AI 自对弈应发生过质疑')
}

// === 服务：房间 / 邀请 / 开始 ===

const HOST = 8801
const P2 = 8802
const P3 = 8803
const P4 = 8804

function verifyInviteLifecycle(): void {
  service.resetLiarStateForTest()
  const base = tick()

  // 拒绝：移除邀请
  const { matchId: declineRoom } = service.createLiarRoomForTest(HOST, 'u8801', [], base)
  const { inviteId: declineInvite } = service.createLiarInviteForTest(HOST, P2, declineRoom, base)
  const declined = service.respondLiarInvite(P2, declineInvite, 'decline', base + 1)
  assertEqual(declined.ok, true, '拒绝邀请应成功')
  expectThrow(() => service.respondLiarInvite(P2, declineInvite, 'accept', base + 2), '邀请不存在', '拒绝后邀请应移除')

  // 过期：TTL 60 秒
  const { matchId: expireRoom } = service.createLiarRoomForTest(HOST, 'u8801', [], base)
  const { inviteId: expireInvite } = service.createLiarInviteForTest(HOST, P2, expireRoom, base)
  expectThrow(
    () => service.respondLiarInvite(P2, expireInvite, 'accept', base + engine.LIAR_DECK_SIZE * 3_100),
    '邀请已过期',
    '超过 60 秒的邀请应过期',
  )

  // 接受：加入等待房间；房间满 4 人后再来一位应被拒
  const { matchId: roomId } = service.createLiarRoomForTest(HOST, 'u8801', [], base)
  const { inviteId: invite2 } = service.createLiarInviteForTest(HOST, P2, roomId, base)
  const accepted = service.respondLiarInvite(P2, invite2, 'accept', base + 1)
  assert(accepted.match !== null, '接受邀请应返回房间')
  assertEqual(accepted.match?.players.length, 2, '接受后房间应有 2 人')

  const { inviteId: invite3 } = service.createLiarInviteForTest(HOST, P3, roomId, base + 2)
  service.respondLiarInvite(P3, invite3, 'accept', base + 3)
  const { inviteId: invite4 } = service.createLiarInviteForTest(HOST, P4, roomId, base + 4)
  service.respondLiarInvite(P4, invite4, 'accept', base + 5)
  assertEqual(service.getLiarMatch(HOST, roomId, base + 6).players.length, 4, '房间应坐满 4 人')

  service.resetLiarStateForTest()
  const { matchId: fullRoom } = service.createLiarRoomForTest(HOST, 'u8801', [P2, P3, P4], base)
  const { inviteId: invite5 } = service.createLiarInviteForTest(HOST, 8899, fullRoom, base)
  expectThrow(
    () => service.respondLiarInvite(8899, invite5, 'accept', base + 1),
    '房间已满',
    '第 5 位玩家应被拒绝',
  )

  // 离开 / 解散
  const { matchId: leaveRoom } = service.createLiarRoomForTest(HOST, 'u8801', [P2], base)
  const left = service.leaveLiarMatch(P2, leaveRoom, base + 1)
  assertEqual(left.dissolved, false, '普通玩家离开不应解散房间')
  assertEqual(service.getLiarMatch(HOST, leaveRoom, base + 2).players.length, 1, '离开后房间应剩 1 人')
  expectThrow(() => service.leaveLiarMatch(P2, leaveRoom, base + 3), '房间不存在', '离开后不再是参与者')

  const dissolved = service.leaveLiarMatch(HOST, leaveRoom, base + 4)
  assertEqual(dissolved.dissolved, true, '房主离开应解散房间')
  expectThrow(() => service.getLiarMatch(P2, leaveRoom, base + 5), '对局不存在', '解散后对局应回收查询')

  // 非参与者查询 404
  const { matchId: hidden } = service.createLiarRoomForTest(HOST, 'u8801', [], base)
  expectThrow(() => service.getLiarMatch(P3, hidden, base + 1), '对局不存在', '非参与者查询应 404')
}

function verifyStartAndDtoCropping(): void {
  service.resetLiarStateForTest()
  const base = tick()

  const { matchId } = service.createLiarRoomForTest(HOST, 'u8801', [P2, P3], base)
  expectThrow(
    () => service.startLiarMatch(P2, matchId, base + 1),
    '只有房主可以开始游戏',
    '非房主开始应 403',
  )
  const { match: started } = service.startLiarMatch(HOST, matchId, base + 2)
  assertEqual(started.status, 'playing', '开始后应进入对局')
  assertEqual(started.round, 1, '开始后应为第 1 局')
  assert(started.target === 'K' || started.target === 'Q' || started.target === 'A', '应宣布目标牌面')
  assertEqual(started.turn?.userId, HOST, '座位 0（房主）应先行')
  assertEqual(started.players.length, 3, '对局应有 3 名玩家')
  assert(started.players.every((player) => player.handCount === 5), '开局每人手牌 5 张')

  // 隐藏信息裁剪：myHand 只有自己的牌，且各不相同；牌堆条目只有 userId + count
  const hostView = service.getLiarMatch(HOST, matchId, base + 3)
  const p2View = service.getLiarMatch(P2, matchId, base + 3)
  const p3View = service.getLiarMatch(P3, matchId, base + 3)
  assertEqual(hostView.myHand.length, 5, '房主视角应有 5 张手牌')
  assertEqual(p2View.myHand.length, 5, 'P2 视角应有 5 张手牌')
  assert(JSON.stringify(hostView.myHand) !== JSON.stringify(p2View.myHand), '各视角手牌应不同')
  assert(!('hand' in started.players[0]), '玩家 DTO 不应泄露手牌字段')
  assertEqual(started.pile.length, 0, '开局牌堆应为空')

  expectThrow(
    () => service.startLiarMatch(HOST, matchId, base + 4),
    '房间已经开始或已结束',
    '重复开始应 409',
  )
  expectThrow(
    () => service.leaveLiarMatch(HOST, matchId, base + 5),
    '对局已开始，无法离开房间',
    '开始后不能走 leave',
  )
  return { matchId }
}

// === 服务：出牌 / 质疑 / 托管 / 淘汰 ===

function verifyServiceActions(): void {
  service.resetLiarStateForTest()
  const base = tick()
  const { matchId } = service.createLiarRoomForTest(HOST, 'u8801', [P2], base)
  service.startLiarMatch(HOST, matchId, base + 1)

  const hostHand = service.getLiarMatch(HOST, matchId, base + 2).myHand

  // 非回合动作 409
  expectThrow(
    () => service.applyLiarAction(P2, matchId, { type: 'play', cards: hostHand.slice(0, 1) }, base + 3),
    '还没轮到你',
    '非回合出牌应 409',
  )
  expectThrow(
    () => service.applyLiarAction(P2, matchId, { type: 'challenge' }, base + 3),
    '还没轮到你',
    '非回合质疑应 409',
  )
  // 首手直接质疑 400（桌上没牌）
  expectThrow(
    () => service.applyLiarAction(HOST, matchId, { type: 'challenge' }, base + 3),
    '桌上还没有可以质疑的出牌',
    '首手质疑应 400',
  )
  // 非法牌组 400
  expectThrow(
    () => service.applyLiarAction(HOST, matchId, { type: 'play', cards: hostHand.slice(0, 4) }, base + 3),
    '要出的牌',
    '出 4 张应 400',
  )
  expectThrow(
    () => service.applyLiarAction(HOST, matchId, { type: 'play', cards: [98, 99] }, base + 3),
    '要出的牌',
    '出非手牌应 400',
  )

  // 房主出 1 张：P2 视角只能看到张数
  const afterPlay = service.applyLiarAction(HOST, matchId, { type: 'play', cards: hostHand.slice(0, 1) }, base + 4)
  assertEqual(afterPlay.match.pile.length, 1, '牌堆应有 1 手')
  assertEqual(afterPlay.match.pile[0]?.userId, HOST, '牌堆条目应记出牌人')
  assertEqual(afterPlay.match.pile[0]?.count, 1, '牌堆条目应记张数')
  assertEqual(turnHolder(afterPlay.match), P2, '出牌后应轮到 P2')
  assertEqual(afterPlay.match.myHand.length, 4, '房主出牌后手牌应剩 4 张')
  assertEqual(playerOf(afterPlay.match, HOST).handCount, 4, 'P2 视角看到的房主手牌应为 4 张')

  // P2 视角也看不到出的牌面
  const p2View = service.getLiarMatch(P2, matchId, base + 5)
  assert(!('cards' in (p2View.pile[0] ?? {})), '牌堆 DTO 不应包含牌面')

  // 质疑（Math.random 桩 0.99：绝不中弹）→ 开牌公开、进第 2 局
  const p2Hand = service.getLiarMatch(P2, matchId, base + 6).myHand
  const afterChallenge = withRandom(0.99, () =>
    service.applyLiarAction(P2, matchId, { type: 'challenge' }, base + 7),
  )
  assertEqual(afterChallenge.match.round, 2, '质疑结算后应进入第 2 局')
  assertEqual(afterChallenge.match.pile.length, 0, '新局牌堆应清空')
  assertEqual(afterChallenge.match.lastReveal?.userId, HOST, '开牌对象应为房主')
  assertEqual(afterChallenge.match.lastReveal?.cards.length, 1, '开牌应翻开 1 张')
  assertEqual(afterChallenge.match.gunBullets, 1, '0 死亡时枪膛应为 1 颗子弹')
  const trigger = lastLogOf<{ type: string; died: boolean }>(afterChallenge.match.log, 'trigger')
  assertEqual(trigger.died, false, 'rand=0.99 不应中弹')
  assertEqual(turnHolder(afterChallenge.match) === HOST || turnHolder(afterChallenge.match) === P2, true, '新局回合应为存活玩家')
  assertEqual(afterChallenge.match.myHand.length, 5, 'P2 新局应重新发满 5 张')

  // 质疑 + 必中弹（Math.random 桩 0）：2 人局直接终局
  const loserBefore = afterChallenge.match.lastReveal?.truthful
  assert(loserBefore !== undefined, '开牌结果应存在')
  const finished = withRandom(0, () => {
    // 轮到谁就让谁出 1 张，另一位质疑：直到某人中弹（rand=0 下第一次质疑即死）
    const view = service.getLiarMatch(turnHolder(afterChallenge.match), matchId, base + 8)
    const actor = turnHolder(afterChallenge.match)
    const hand = view.myHand
    service.applyLiarAction(actor, matchId, { type: 'play', cards: hand.slice(0, 1) }, base + 8)
    const other = actor === HOST ? P2 : HOST
    return service.applyLiarAction(other, matchId, { type: 'challenge' }, base + 9)
  })
  assertEqual(finished.match.status, 'finished', '2 人局中弹后应终局')
  assertEqual(finished.match.reason, 'last_standing', '结束原因应为 last_standing')
  assert(finished.match.winnerId !== null, '应有胜者')
  assertEqual(lastLogOf<{ type: string; died: boolean }>(finished.match.log, 'trigger').died, true, 'rand=0 应中弹')

  // 结束后动作 409
  expectThrow(
    () => service.applyLiarAction(HOST, matchId, { type: 'play', cards: [0] }, base + 10),
    '对局未开始或已结束',
    '终局后动作应 409',
  )
}

function verifyTurnTimeout(): void {
  service.resetLiarStateForTest()
  const base = tick()
  const { matchId } = service.createLiarRoomForTest(HOST, 'u8801', [P2], base)
  service.startLiarMatch(HOST, matchId, base + 1)

  // 未超时时 sweeper 不应动作
  service.runLiarSweeper(base + 30_000)
  assertEqual(service.getLiarMatch(HOST, matchId, base + 30_000).pile.length, 0, '未超时不应托管')

  // 回合 60 秒超时 → 自动托管（rand=0.99：托管永不质疑、永不中弹，必为出牌）
  withRandom(0.99, () => service.runLiarSweeper(base + 61_000))
  const autoPlayed = service.getLiarMatch(HOST, matchId, base + 61_500)
  assertEqual(autoPlayed.pile.length, 1, '超时后应由服务端托管出一手')
  const autoPlay = lastLogOf<{ type: string; userId: number }>(autoPlayed.log, 'play')
  assertEqual(autoPlay.userId, HOST, '托管应以回合持有者身份出牌')
  assertEqual(turnHolder(autoPlayed), P2, '托管后应轮到 P2')

  // 连续多回合超时：循环逐手托管（3 分钟足够两轮）
  withRandom(0.99, () => service.runLiarSweeper(base + 61_000 + 121_000))
  const playedTwice = service.getLiarMatch(HOST, matchId, base + 182_500)
  assert(playedTwice.pile.length >= 2, '连续超时应连续托管多手')
  assert(playedTwice.round === 1, '无人质疑时不进入新局')
}

function verifyResignAndForfeit(): void {
  service.resetLiarStateForTest()
  const base = tick()
  const { matchId } = service.createLiarRoomForTest(HOST, 'u8801', [P2, P3], base)
  service.startLiarMatch(HOST, matchId, base + 1)

  // 认输：立即出局，多人局继续，子弹 +1
  const resigned = service.resignLiarMatch(P2, matchId, base + 2)
  assertEqual(resigned.match.status, 'playing', '3 人局认输 1 人不应终局')
  assertEqual(playerOf(resigned.match, P2).status, 'lost', '认输者应出局')
  assertEqual(resigned.match.gunBullets, 2, '1 次死亡后枪膛应为 2 颗子弹')
  assertEqual(lastLogOf<{ type: string; cause: string }>(resigned.match.log, 'death').cause, 'resign', '事件流应记录认输死亡')
  expectThrow(() => service.resignLiarMatch(P2, matchId, base + 3), '你已出局', '重复认输应 409')

  // 再认输一人 → 只剩房主 → 终局
  const finished = service.resignLiarMatch(P3, matchId, base + 4)
  assertEqual(finished.match.status, 'finished', '只剩一人应终局')
  assertEqual(finished.match.reason, 'last_standing', '结束原因应为 last_standing')
  assertEqual(finished.match.winnerId, HOST, '房主应获胜')
  assertEqual(finished.match.gunBullets, 3, '2 次死亡后枪膛应为 3 颗子弹')

  // 掉线判负：3 人局，房主打心跳保持在线，P2 / P3 从不心跳 → 120 秒后双双出局
  service.resetLiarStateForTest()
  const base2 = tick()
  const { matchId: ffMatch } = service.createLiarRoomForTest(HOST, 'u8801', [P2, P3], base2)
  service.startLiarMatch(HOST, ffMatch, base2 + 1)
  presence.markGamePresence(HOST, base2 + 60_000)

  withRandom(0.99, () => service.runLiarSweeper(base2 + service.LIAR_DISCONNECT_FORFEIT_MS + 10_000))
  const ffView = service.getLiarMatch(HOST, ffMatch, base2 + service.LIAR_DISCONNECT_FORFEIT_MS + 10_500)
  assertEqual(ffView.status, 'finished', '两名对手都掉线后应终局')
  assertEqual(ffView.reason, 'last_standing', '结束原因应为 last_standing')
  assertEqual(ffView.winnerId, HOST, '在线的房主应获胜')
  assertEqual(playerOf(ffView, P2).status, 'lost', '掉线者应出局')
  assertEqual(lastLogOf<{ type: string; cause: string }>(ffView.log, 'death').cause, 'forfeit', '事件流应记录掉线判负')

  // 全员都掉线：不淘汰（对方也不在线），对局继续等待（桩 0.99 避免托管随机质疑/中弹干扰）
  service.resetLiarStateForTest()
  // 上一段把 HOST 的心跳打在了 base2+60s，若不清理会在本段仍处于 TTL 内，
  // 让「全员掉线」退化成「只有 P2 掉线」；这里显式清空所有 presence。
  presence.clearGamePresence(HOST)
  presence.clearGamePresence(P2)
  presence.clearGamePresence(P3)
  const base3 = tick()
  const { matchId: allOff } = service.createLiarRoomForTest(HOST, 'u8801', [P2], base3)
  service.startLiarMatch(HOST, allOff, base3 + 1)
  withRandom(0.99, () => service.runLiarSweeper(base3 + service.LIAR_DISCONNECT_FORFEIT_MS + 10_000))
  assertEqual(service.getLiarMatch(HOST, allOff, base3 + service.LIAR_DISCONNECT_FORFEIT_MS + 10_500).status, 'playing', '全员掉线时不应判负')
}

function verifyGlobalTimeoutAndRetention(): void {
  service.resetLiarStateForTest()
  const base = tick()
  const { matchId } = service.createLiarRoomForTest(HOST, 'u8801', [P2], base)
  service.startLiarMatch(HOST, matchId, base + 1)

  // 全局 30 分钟超时 → timeout 废弃（无胜者）
  const view = service.getLiarMatch(HOST, matchId, base + service.LIAR_DEFAULT_DURATION_MS + 1_000)
  assertEqual(view.status, 'finished', '全局超时后应终局')
  assertEqual(view.reason, 'timeout', '结束原因应为 timeout')
  assertEqual(view.winnerId, null, '全局超时无胜者')

  // 保留 5 分钟可查，之后回收
  service.getLiarMatch(HOST, matchId, base + service.LIAR_DEFAULT_DURATION_MS + 60_000)
  expectThrow(
    () => service.getLiarMatch(HOST, matchId, base + service.LIAR_DEFAULT_DURATION_MS + service.LIAR_FINISHED_RETENTION_MS + 1_000),
    '对局不存在',
    '结束超过 5 分钟应回收',
  )

  // 等待房间 30 分钟未开局 → cancelled 解散
  service.resetLiarStateForTest()
  const base2 = tick()
  const { matchId: idleRoom } = service.createLiarRoomForTest(HOST, 'u8801', [P2], base2)
  const view2 = service.getLiarMatch(HOST, idleRoom, base2 + service.LIAR_WAITING_ROOM_TTL_MS + 1_000)
  assertEqual(view2.status, 'finished', '等待超时应解散房间')
  assertEqual(view2.reason, 'cancelled', '结束原因应为 cancelled')
}

function verifySyncAndMutex(): void {
  service.resetLiarStateForTest()
  const base = tick()

  // active / sync
  const { matchId } = service.createLiarRoomForTest(HOST, 'u8801', [P2], base)
  service.startLiarMatch(HOST, matchId, base + 1)
  assert(service.getActiveLiarMatch(HOST, base + 2)?.id === matchId, 'active 应返回当前对局')
  const sync = service.getLiarSync(P2, undefined, base + 2)
  assertEqual(sync.match?.id, matchId, 'sync 应返回当前对局')
  assert(typeof sync.serverTime === 'string', 'sync 应带服务器时间')
  const syncById = service.getLiarSync(P2, matchId, base + 2)
  assertEqual(syncById.match?.id, matchId, 'sync 带 matchId 应返回指定对局')
  expectThrow(() => service.getLiarSync(P3, matchId, base + 2), '对局不存在', '非参与者 sync 应 404')

  // 跨游戏互斥：骗子酒馆玩家对其他游戏是「忙」；对自家检查应排除自己
  assert(game.isUserBusyInOtherGames(HOST), '骗子酒馆玩家应被其他游戏视为忙')
  assert(game.isUserBusyInOtherGames(HOST, 'liar') === false, '自家检查应排除自己')
  assert(game.isUserBusyInOtherGames(HOST, 'gomoku'), '其他游戏（gomoku）视角应看到骗子酒馆玩家在忙')

  // 主 sweeper 驱动骗子酒馆清理：过期的等待房间由 game.runGameSweeper 结算
  service.resetLiarStateForTest()
  const base2 = tick()
  const { matchId: staleRoom } = service.createLiarRoomForTest(HOST, 'u8801', [], base2)
  game.runGameSweeper(base2 + service.LIAR_WAITING_ROOM_TTL_MS + 1_000)
  const settled = service.getLiarMatch(HOST, staleRoom, base2 + service.LIAR_WAITING_ROOM_TTL_MS + 2_000)
  assertEqual(settled.reason, 'cancelled', '主 sweeper 应驱动骗子酒馆的清理钩子')
}

async function main(): Promise<void> {
  engine = await import('../src/services/gameLiar.js')
  service = await import('../src/services/gameLiarService.js')
  game = await import('../src/services/gameService.js')
  presence = await import('../src/services/gamePresence.js')

  verifyEngineConstants()
  verifyDeckAndKinds()
  validateValidLiarPlay()
  verifyGun()
  verifyTablePlayFlow()
  verifyTableChallengeBluff()
  verifyTableChallengeTruth()
  verifyTableChallengeDeath()
  verifyTableFlush()
  verifyTableEliminate()
  verifySuggestLiarMove()
  verifyAiSelfPlay()
  verifyInviteLifecycle()
  verifyStartAndDtoCropping()
  verifyServiceActions()
  verifyTurnTimeout()
  verifyResignAndForfeit()
  verifyGlobalTimeoutAndRetention()
  verifySyncAndMutex()

  // 收尾清空内存与兜底定时器（都是 unref，进程可正常退出）
  service.resetLiarStateForTest()
  console.log(`✓ verify-liar 全部通过（${passed} 条断言）`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
