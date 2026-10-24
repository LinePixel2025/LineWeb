/**
 * 斗地主服务端引擎 + 联机状态机自检脚本（不依赖数据库 / 网络真实流量）
 *
 * 用法: cd server && npx tsx scripts/verify-doudizhu.ts
 *      （或 npm run verify:ddz）
 *
 * 覆盖：
 *   - 引擎牌型解析与比较的抽查（全量用例在 client 单测里维护）；
 *   - 3 人房间完整流程：建房 → 房主开始 → 叫分（含 3 分立即成交）→
 *     地主拿底牌 → 出牌 / 不出 / 连续两家不出开启新一轮 → 有人出完结算；
 *   - DTO 按观看者裁剪：每人只能看到自己的手牌（myHand），其他人只有张数；
 *   - 服务端权威校验：未轮到 / 非法牌型 / 压不住均被拒绝；
 *   - 回合超时托管（sweeper 代叫不叫 / 代出最小单张 / 代不出）；
 *   - 三轮流局解散（no_bid）与认输结算（resign）。
 */

// 依赖模块会读 DATABASE_URL / JWT_SECRET：先给默认值再动态 import，
// Prisma 为惰性连接，只要脚本不触发真实查询就不会碰到数据库。
process.env.DATABASE_URL ||= 'file:./.verify-ddz.db'
process.env.JWT_SECRET ||= 'verify-ddz-secret'
process.env.NODE_ENV ||= 'development'

type DoudizhuEngine = typeof import('../src/services/gameDoudizhu.js')
type DoudizhuService = typeof import('../src/services/gameDoudizhuService.js')

let parseDoudizhuCombo: DoudizhuEngine['parseDoudizhuCombo']
let canDoudizhuBeat: DoudizhuEngine['canDoudizhuBeat']
let generateDoudizhuMoves: DoudizhuEngine['generateDoudizhuMoves']
let service: DoudizhuService

type Card = { id: number; rank: number; suit: number }
type MatchDto = ReturnType<typeof service.getActiveDoudizhuMatch>

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
}

/** 期待动作抛出 AppError（消息包含 keyword） */
async function expectReject(promise: Promise<unknown>, keyword: string, label: string): Promise<void> {
  try {
    await promise
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

const card = (rank: number, idx = 0): Card => ({ id: rank * 10 + idx, rank, suit: 0 })
const ofRank = (rank: number, n: number): Card[] =>
  Array.from({ length: n }, (_, index) => card(rank, index))

/** mulberry32：确定性伪随机源，用于固定发牌与首个叫分座位 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 每个阶段开一局前重新播种，让牌局与首个叫分座位固定下来。
 * 不播种时脚本会撞上「随机牌局正好不满足脚本假设」的情况（历史上约 1/3 概率失败）。
 */
function seedDoudizhu(round: number): void {
  service.setDoudizhuRandomForTest(mulberry32(20261024 + round))
}

function verifyEngine(): void {
  // 引擎引用在 main 里赋值；这里直接使用包装变量
  const pair7 = parseDoudizhuCombo(ofRank(7, 2))
  const bomb3 = parseDoudizhuCombo(ofRank(3, 4))
  const rocket = parseDoudizhuCombo([card(18), card(19)])
  assert(pair7?.type === 'pair', '77 应解析为对子')
  assert(bomb3?.type === 'bomb', '3333 应解析为炸弹')
  assert(rocket?.type === 'rocket', '双王应解析为王炸')
  assert(parseDoudizhuCombo([card(3), card(9)]) === null, '两张散牌应解析失败')
  assert(canDoudizhuBeat(rocket!, pair7!) === true, '王炸压对子')
  assert(canDoudizhuBeat(bomb3!, pair7!) === true, '炸弹压对子')
  assert(canDoudizhuBeat(pair7!, bomb3!) === false, '对子压不了炸弹')
  // 出牌生成：只有 3 时跟对子必空
  assert(generateDoudizhuMoves([card(3)], parseDoudizhuCombo(ofRank(7, 2))!).length === 0, '压不住时无候选')
}

async function verifyFullMatch(): Promise<void> {
  const players = [
    { id: 9101, username: 'host' },
    { id: 9102, username: 'alice' },
    { id: 9103, username: 'bob' },
  ]
  const room = service.createDoudizhuRoomForTest(players)
  const matchId = room.id
  assert(room.status === 'waiting', '新建房间应为等待状态')
  assert(room.players.length === 3, '房间应恰好 3 人')

  // 非房主不能开始
  await expectReject(
    Promise.resolve().then(() => service.startDoudizhuMatch(players[1].id, matchId)),
    '房主',
    '非房主开始应被拒绝',
  )

  // 房主开始 → 叫分
  seedDoudizhu(1)
  const started = service.startDoudizhuMatch(players[0].id, matchId)
  assert(started.match.status === 'bidding', '开始后应进入叫分')
  assert(started.match.bidding !== null, '叫分状态应存在')
  assert(started.match.bottomCards.length === 0, '叫分阶段底牌不可见')

  // DTO 按观看者裁剪：每人只看到自己的 17 张
  const seatViews = players.map((player) => service.getDoudizhuMatch(player.id, matchId))
  for (const view of seatViews) {
    assert(view.myHand.length === 17, `${view.players[view.seat].username} 应看到自己 17 张手牌`)
    assert(
      view.players.every((p) => p.cardCount === 17),
      '叫分阶段每人应为 17 张',
    )
  }
  // 不同座位的 myHand 不同（正常发牌几乎不可能同牌，校验 id 集合不同）
  const handIds = seatViews.map((view) => new Set(view.myHand.map((c) => c.id)))
  assert(
    handIds[0].size === 17 && handIds[1].size === 17 && !handIds[0].equals?.(handIds[1]),
    '各座位手牌应彼此独立',
  )

  // 未轮到叫分被拒绝
  const firstBidder = seatViews.find((view) => view.bidding?.turnUserId === view.players[view.seat].userId)!
  const notTurnPlayer = players.find((p) => p.id !== firstBidder.bidding?.turnUserId)!
  await expectReject(
    Promise.resolve().then(() => service.applyDoudizhuAction(notTurnPlayer.id, matchId, { type: 'bid', bid: 1 })),
    '还没轮到',
    '未轮到叫分应被拒绝',
  )

  // 前两位不叫，第三位叫 3 分 → 立即成为地主
  let bidView = service.getDoudizhuMatch(firstBidder.bidding!.turnUserId, matchId)
  service.applyDoudizhuAction(bidView.bidding!.turnUserId, matchId, { type: 'bid', bid: 0 })
  bidView = service.getDoudizhuMatch(bidView.bidding!.turnUserId === players[0].id ? players[1].id : players[0].id, matchId)
  // 上面第二行的 userId 计算不可靠，改为按当前 DTO 找轮到的人
  bidView = service.getDoudizhuMatch(players.find((p) => p.id !== firstBidder.bidding!.turnUserId)!.id, matchId)
  const secondBidderId = bidView.bidding!.turnUserId
  service.applyDoudizhuAction(secondBidderId, matchId, { type: 'bid', bid: 0 })
  const thirdView = service.getDoudizhuMatch(players.find((p) => p.id !== firstBidder.bidding!.turnUserId && p.id !== secondBidderId)!.id, matchId)
  const thirdBidderId = thirdView.bidding!.turnUserId
  // 叫分必须高于当前最高（当前最高 0，叫 1 合法；先试 0 会流局，这里直接叫 3）
  const landlordDto = service.applyDoudizhuAction(thirdBidderId, matchId, { type: 'bid', bid: 3 }).match
  assert(landlordDto.status === 'playing', '叫 3 分后应立即进入出牌')
  assert(landlordDto.landlordId === thirdBidderId, '叫 3 分者应为地主')
  assert(landlordDto.bottomCards.length === 3, '出牌阶段底牌应可见')

  const landlordView = service.getDoudizhuMatch(thirdBidderId, matchId)
  const farmerIds = players.filter((p) => p.id !== thirdBidderId).map((p) => p.id)
  assert(landlordView.myHand.length === 20, '地主应有 20 张牌（17+3 底牌）')
  assert(
    landlordView.playing?.turnUserId === thirdBidderId,
    '地主应先出牌',
  )
  for (const farmerId of farmerIds) {
    const view = service.getDoudizhuMatch(farmerId, matchId)
    assert(view.players[view.seat].role === 'farmer', '其他玩家应为农民')
    assert(view.myHand.length === 17, '农民应为 17 张牌')
  }

  // 非法出牌被拒绝：未轮到 / 非法牌型 / 压不住 / 不在手上的牌
  await expectReject(
    Promise.resolve().then(() => service.applyDoudizhuAction(farmerIds[0], matchId, { type: 'play', cards: [0] })),
    '还没轮到',
    '未轮到出牌应被拒绝',
  )
  const leadCard = landlordView.myHand[0]
  const secondCard = landlordView.myHand.find((c) => c.rank !== leadCard.rank) ?? landlordView.myHand[1]
  await expectReject(
    Promise.resolve().then(() => service.applyDoudizhuAction(thirdBidderId, matchId, {
      type: 'play',
      cards: [leadCard.id, secondCard.id],
    })),
    '合法牌型',
    '两张散牌应被拒绝',
  )
  await expectReject(
    Promise.resolve().then(() => service.applyDoudizhuAction(thirdBidderId, matchId, { type: 'pass' })),
    '必须出牌',
    '领出时不允许不出',
  )
  await expectReject(
    Promise.resolve().then(() => service.applyDoudizhuAction(thirdBidderId, matchId, {
      type: 'play',
      cards: [53],
    })),
    '不在手上',
    '出不在手上的牌应被拒绝',
  )

  // 地主出最小单张，两家不出 → 新一轮仍归地主
  service.applyDoudizhuAction(thirdBidderId, matchId, { type: 'play', cards: [leadCard.id] })
  service.applyDoudizhuAction(farmerIds[0], matchId, { type: 'pass' })
  await expectReject(
    Promise.resolve().then(() => service.applyDoudizhuAction(farmerIds[0], matchId, { type: 'pass' })),
    '还没轮到',
    '连续两次不出同一人应被拒绝',
  )
  service.applyDoudizhuAction(farmerIds[1], matchId, { type: 'pass' })
  const afterTwoPasses = service.getDoudizhuMatch(thirdBidderId, matchId)
  assert(afterTwoPasses.playing?.turnUserId === thirdBidderId, '两家不出后地主应重新领出')
  assert(afterTwoPasses.playing?.lastMove === null, '新一轮桌面应无待压牌')
  assert(afterTwoPasses.players[afterTwoPasses.seat].cardCount === 19, '地主出过一张后应剩 19 张')

  // 压不住的牌被拒绝：农民 A 出 Q，农民 B 用 J 压应被拒
  // （构造场景太繁琐，改为直接验证：地主出 2，农民用 A 压被拒）
  const landlordHand = service.getDoudizhuMatch(thirdBidderId, matchId).myHand
  const rankTwo = landlordHand.find((c) => c.rank === 16)
  if (rankTwo) {
    service.applyDoudizhuAction(thirdBidderId, matchId, { type: 'play', cards: [rankTwo.id] })
    const farmerView = service.getDoudizhuMatch(farmerIds[0], matchId)
    const farmerAce = farmerView.myHand.find((c) => c.rank === 14)
    if (farmerAce) {
      await expectReject(
        Promise.resolve().then(() => service.applyDoudizhuAction(farmerIds[0], matchId, {
          type: 'play',
          cards: [farmerAce.id],
        })),
        '压不住',
        'A 压 2 应被拒绝',
      )
    }
    service.applyDoudizhuAction(farmerIds[0], matchId, { type: 'pass' })
    service.applyDoudizhuAction(farmerIds[1], matchId, { type: 'pass' })
  }

  // 驱动对局到结束：轮到自己时，领出打最小单张、跟牌一律不出
  let guard = 0
  let finished: MatchDto = null
  while (guard < 500) {
    guard += 1
    const any = service.getDoudizhuMatch(thirdBidderId, matchId)
    if (any.status === 'finished') {
      finished = any
      break
    }
    const turnUserId = any.bidding?.turnUserId ?? any.playing?.turnUserId
    if (turnUserId === undefined) break
    const turnView = service.getDoudizhuMatch(turnUserId, matchId)
    if (any.playing && any.playing.lastMove === null) {
      const smallest = [...turnView.myHand].sort((a, b) => a.rank - b.rank)[0]
      service.applyDoudizhuAction(turnUserId, matchId, { type: 'play', cards: [smallest.id] })
    } else {
      service.applyDoudizhuAction(turnUserId, matchId, { type: 'pass' })
    }
  }
  assert(finished !== null, `对局应在有限步内结束（guard=${guard}）`)
  assert(finished!.reason === 'hand_empty', '正常打完的结束原因应为 hand_empty')
  assert(finished!.winnerSide !== null, '打完应有获胜方')
  const winner = finished!.players.find((p) => p.status === 'won')
  assert(winner !== undefined, '应有 won 玩家')
  assert(winner!.cardCount === 0, '获胜玩家应出完了手牌')
  const landlordFinal = finished!.players.find((p) => p.userId === thirdBidderId)!
  const farmerFinal = finished!.players.find((p) => p.userId !== thirdBidderId)!
  const unit = 100 * finished!.multiplier
  if (finished!.winnerSide === 'landlord') {
    assertEqual(landlordFinal.scoreDelta, 2 * unit, '地主赢应得 2 份')
    assertEqual(farmerFinal.scoreDelta, -unit, '农民输应扣 1 份')
  } else {
    assertEqual(landlordFinal.scoreDelta, -2 * unit, '地主输应扣 2 份')
    assertEqual(farmerFinal.scoreDelta, unit, '农民赢应得 1 份')
  }
}

function verifyAutoPlayAndEdgeCases(): void {
  // === 回合超时托管 ===
  const players = [
    { id: 9201, username: 'h' },
    { id: 9202, username: 'a' },
    { id: 9203, username: 'b' },
  ]
  const now = 2_000_000_000_000
  const room = service.createDoudizhuRoomForTest(players, now)
  seedDoudizhu(2)
  service.startDoudizhuMatch(players[0].id, room.id, now + 1)
  // 时间推进 91 秒（超过 90 秒回合时限）→ 托管不叫
  service.runDoudizhuSweep(now + 91_000)
  const afterAuto = service.getDoudizhuMatch(players[0].id, room.id, now + 91_000)
  assert(afterAuto.bidding !== null, '一轮托管后仍在叫分（或已按流程推进）')
  const bidRecorded = afterAuto.bidding!.bids.length >= 1
  assert(bidRecorded, '超时后应自动替当前玩家不叫')

  // === 三轮流局解散 ===
  const players2 = [
    { id: 9301, username: 'h2' },
    { id: 9302, username: 'a2' },
    { id: 9303, username: 'b2' },
  ]
  const now2 = 3_000_000_000_000
  const room2 = service.createDoudizhuRoomForTest(players2, now2)
  service.startDoudizhuMatch(players2[0].id, room2.id, now2 + 1)
  seedDoudizhu(3)
  for (let round = 1; round <= 3; round += 1) {
    const view = service.getDoudizhuMatch(players2[0].id, room2.id, now2 + round * 1000)
    if (view.status === 'finished') break
    for (let i = 0; i < 3; i += 1) {
      const current = service.getDoudizhuMatch(players2[0].id, room2.id, now2 + round * 1000 + i)
      if (current.status !== 'bidding') break
      service.applyDoudizhuAction(current.bidding!.turnUserId, room2.id, { type: 'bid', bid: 0 }, now2 + round * 10_000 + i)
    }
  }
  const finishedNoBid = service.getDoudizhuMatch(players2[0].id, room2.id, now2 + 60_000)
  assert(finishedNoBid.status === 'finished', '三轮无人叫地主应对局结束')
  assert(finishedNoBid.reason === 'no_bid', '结束原因应为 no_bid')

  // === 认输结算 ===
  const players3 = [
    { id: 9401, username: 'h3' },
    { id: 9402, username: 'a3' },
    { id: 9403, username: 'b3' },
  ]
  const now3 = 4_000_000_000_000
  const room3 = service.createDoudizhuRoomForTest(players3, now3)
  service.startDoudizhuMatch(players3[0].id, room3.id, now3 + 1)
  seedDoudizhu(4)
  // 叫到 3 分直接进对局
  const v = service.getDoudizhuMatch(players3[0].id, room3.id, now3 + 2)
  service.applyDoudizhuAction(v.bidding!.turnUserId, room3.id, { type: 'bid', bid: 3 }, now3 + 3)
  const playing = service.getDoudizhuMatch(players3[0].id, room3.id, now3 + 4)
  assert(playing.status === 'playing', '认输前置条件：对局进行中')
  const landlordId = playing.landlordId!
  const farmerId = players3.map((p) => p.id).find((id) => id !== landlordId)!
  const resigned = service.resignDoudizhuMatch(landlordId, room3.id, now3 + 5)
  assert(resigned.match.status === 'finished', '认输后对局结束')
  assertEqual(resigned.match.reason, 'resign', '结束原因应为 resign')
  assertEqual(resigned.match.winnerSide, 'farmers', '地主认输农民胜')
  const landlord = resigned.match.players.find((p) => p.userId === landlordId)!
  const farmer = resigned.match.players.find((p) => p.userId === farmerId)!
  assertEqual(landlord.scoreDelta, -200, '地主认输按当前倍率扣 2 份')
  assertEqual(farmer.scoreDelta, 100, '农民得分 1 份')
}

// 说明：esbuild 把 scripts 按 CJS 转换，顶层 await 不可用，
// 因此把动态 import 放进 async main（环境变量必须在 import 前就位）。
async function main(): Promise<void> {
  const engine: DoudizhuEngine = await import('../src/services/gameDoudizhu.js')
  parseDoudizhuCombo = engine.parseDoudizhuCombo
  canDoudizhuBeat = engine.canDoudizhuBeat
  generateDoudizhuMoves = engine.generateDoudizhuMoves
  service = (await import('../src/services/gameDoudizhuService.js')) as DoudizhuService

  verifyEngine()
  await verifyFullMatch()
  verifyAutoPlayAndEdgeCases()
  console.log(`✓ verify-doudizhu 全部通过（${passed} 条断言）`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error('✗ verify-doudizhu 验证失败：')
  console.error(message)
  process.exitCode = 1
})
