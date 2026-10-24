/**
 * 五子棋服务端引擎 + 联机状态机自检脚本（不依赖数据库 / 网络真实流量）
 *
 * 用法: cd server && npx tsx scripts/verify-gomoku.ts
 *
 * 覆盖：
 *   - 引擎：常量逐字核对；棋盘构造 / 坐标换算 / 空点判定；findGomokuWin 四方向
 *     五连、6 连长连、不足五连、空点；满盘判定；evaluateGomokuPoint 活四 > 冲四 >
 *     活三 量级；suggestGomokuMove 空盘天元 / 成五点直落 / 必堵对方四连 /
 *     固定 rand 可复现 / 候选点贴近已有棋子；AI 自对弈完整性（必然终止且每步合法）。
 *   - 服务：建房 → 邀请（接受 / 拒绝 / 取消 / 过期 / 房间已满）→ 开始（恰好 2 人、
 *     座位 0 执黑先行）→ 轮流落子与轮转、非回合 409、占用 400、连五结算
 *     （winningLine 升序、玩家 status）、认输、回合超时自动托管（auto 标记、连续多手）、
 *     掉线 forfeit、全局 timeout 平局、下满 draw 平局、leave 与房主解散、
 *     结束对局保留 5 分钟后回收、主 sweeper 驱动、跨游戏互斥探针。
 *
 * 说明：时间一律用显式 now 参数驱动（不依赖真实定时器）；
 * 邀请用测试入口直接登记，避开数据库里的好友关系校验。
 */

// 依赖模块会读 DATABASE_URL / JWT_SECRET：先给默认值再动态 import，
// Prisma 为惰性连接，只要脚本不触发真实查询就不会碰到数据库。
process.env.DATABASE_URL ||= 'file:./.verify-gomoku.db'
process.env.JWT_SECRET ||= 'verify-gomoku-secret'
process.env.NODE_ENV ||= 'development'

type GomokuEngine = typeof import('../src/services/gameGomoku.js')
type GomokuService = typeof import('../src/services/gameGomokuService.js')
type GameService = typeof import('../src/services/gameService.js')
type PresenceModule = typeof import('../src/services/gamePresence.js')

let engine: GomokuEngine
let service: GomokuService
let game: GameService
let presence: PresenceModule

type MatchDto = ReturnType<GomokuService['getGomokuMatch']>

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

/** 空棋盘（全部为 0） */
function emptyBoard(): number[] {
  return new Array<number>(225).fill(0)
}

/** 在一维棋盘上落子（y 行 x 列） */
function put(board: number[], x: number, y: number, color: number): void {
  board[y * 15 + x] = color
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

/** 走到「轮到 userId」需要的时间步进（避免回合超时干扰，每步 +1s） */
let clock = Date.now()

function tick(ms = 1_000): number {
  clock += ms
  return clock
}

// === 引擎：常量 ===

function verifyEngineConstants(): void {
  assertEqual(
    {
      GOMOKU_BOARD_SIZE: engine.GOMOKU_BOARD_SIZE,
      GOMOKU_CELL_COUNT: engine.GOMOKU_CELL_COUNT,
      GOMOKU_BLACK: engine.GOMOKU_BLACK,
      GOMOKU_WHITE: engine.GOMOKU_WHITE,
    },
    {
      GOMOKU_BOARD_SIZE: 15,
      GOMOKU_CELL_COUNT: 225,
      GOMOKU_BLACK: 1,
      GOMOKU_WHITE: 2,
    },
    '五子棋常量应与前后端唯一真相源逐字一致',
  )
}

// === 引擎：棋盘基础 ===

function verifyBoardBasics(): void {
  const board = engine.createGomokuBoard()
  assertEqual(board.length, 225, '空棋盘应为 225 格')
  assert(board.every((cell) => cell === 0), '空棋盘所有交叉点应为 0')

  assertEqual(engine.gomokuIndex(0, 0), 0, 'gomokuIndex(0,0) 应为 0')
  assertEqual(engine.gomokuIndex(7, 7), 7 * 15 + 7, 'gomokuIndex(7,7) 应为 y*15+x')

  assert(engine.isInGomokuBoard(0, 0), '(0,0) 应在棋盘内')
  assert(engine.isInGomokuBoard(14, 14), '(14,14) 应在棋盘内')
  assert(!engine.isInGomokuBoard(15, 0), '(15,0) 应越界')
  assert(!engine.isInGomokuBoard(0, -1), '(0,-1) 应越界')

  assert(engine.isGomokuCellEmpty(board, 7, 7), '空盘 (7,7) 应为空')
  assert(!engine.isGomokuCellEmpty(board, 15, 0), '越界点应视为非空')
  engine.placeGomokuStone(board, 7, 7, engine.GOMOKU_BLACK)
  assert(!engine.isGomokuCellEmpty(board, 7, 7), '落子后 (7,7) 不应为空')

  const board2 = engine.createGomokuBoard()
  const index = engine.placeGomokuStone(board2, 3, 5, engine.GOMOKU_WHITE)
  assertEqual(index, 5 * 15 + 3, 'placeGomokuStone 应返回落点下标')
  assertEqual(board2[5 * 15 + 3], 2, 'placeGomokuStone 应写入颜色值')
}

// === 引擎：胜负判定 ===

function verifyFindGomokuWin(): void {
  // 横向五连（y=3 行）
  {
    const board = emptyBoard()
    for (let x = 4; x <= 8; x += 1) put(board, x, 3, 1)
    const line = engine.findGomokuWin(board, 6, 3)
    assert(line !== null, '横向五连应判胜')
    assertEqual(line?.map((point) => [point.x, point.y]), [[4, 3], [5, 3], [6, 3], [7, 3], [8, 3]], '横向获胜连线应按 y、x 升序')
  }
  // 纵向五连（x=10 列）
  {
    const board = emptyBoard()
    for (let y = 2; y <= 6; y += 1) put(board, 10, y, 2)
    assert(engine.findGomokuWin(board, 10, 4) !== null, '纵向五连应判胜')
  }
  // 主对角线（dx=1, dy=1）
  {
    const board = emptyBoard()
    for (let i = 0; i < 5; i += 1) put(board, 3 + i, 5 + i, 1)
    assert(engine.findGomokuWin(board, 5, 7) !== null, '主对角线五连应判胜')
  }
  // 反对角线（dx=1, dy=-1）
  {
    const board = emptyBoard()
    for (let i = 0; i < 5; i += 1) put(board, 3 + i, 9 - i, 2)
    assert(engine.findGomokuWin(board, 5, 7) !== null, '反对角线五连应判胜')
  }
  // 6 连长连（无禁手：长连同样获胜）
  {
    const board = emptyBoard()
    for (let x = 2; x <= 7; x += 1) put(board, x, 0, 1)
    const line = engine.findGomokuWin(board, 4, 0)
    assert(line !== null, '6 连长连应判胜（无禁手）')
    assertEqual(line?.length, 6, '长连接线应包含全部 6 子')
  }
  // 4 连不足五
  {
    const board = emptyBoard()
    for (let x = 0; x <= 3; x += 1) put(board, x, 1, 1)
    assert(engine.findGomokuWin(board, 1, 1) === null, '4 连不应判胜')
  }
  // 中间隔一子的假五连
  {
    const board = emptyBoard()
    for (const x of [0, 1, 2, 4, 5]) put(board, x, 2, 1)
    assert(engine.findGomokuWin(board, 2, 2) === null, '中间断开的连线不应判胜')
  }
  // 空点 / 非法颜色
  {
    const board = emptyBoard()
    assert(engine.findGomokuWin(board, 7, 7) === null, '空点不应判胜')
  }
  // 满盘判定
  {
    const board = emptyBoard()
    assert(!engine.isGomokuBoardFull(board), '空盘不应判满')
    const full = emptyBoard().map((_, index) => (index % 2 === 0 ? 1 : 2))
    assert(engine.isGomokuBoardFull(full), '全占用棋盘应判满')
  }
}

// === 引擎：启发式评估与选点 ===

function verifyEvaluationAndSuggest(): void {
  // 评估分 = 4 个方向求和（横竖两斜，孤子方向各贡献 5），
  // 这里按量级断言：活四 > 冲四 > 活三，成五点应达到 FIVE 档
  const openFour = emptyBoard()
  for (const x of [2, 3, 4]) put(openFour, x, 7, 1)
  const openFourScore = engine.evaluateGomokuPoint(openFour, 1, 7, 1)

  const closedFour = emptyBoard()
  for (const x of [2, 3, 4]) put(closedFour, x, 7, 1)
  put(closedFour, 6, 7, 2) // 右侧被白堵住：落 (5,7) 成 2–5 四连，只有左端 (1,7) 开放
  const closedFourScore = engine.evaluateGomokuPoint(closedFour, 5, 7, 1)

  const openThree = emptyBoard()
  for (const x of [2, 3]) put(openThree, x, 7, 1)
  const openThreeScore = engine.evaluateGomokuPoint(openThree, 1, 7, 1)

  const fivePoint = emptyBoard()
  for (const x of [1, 2, 3, 4]) put(fivePoint, x, 7, 1)
  const fiveScore = engine.evaluateGomokuPoint(fivePoint, 0, 7, 1)

  assert(openFourScore >= 100_000, `活四点应达 OPEN_FOUR 档（实际 ${openFourScore}）`)
  assert(closedFourScore >= 10_000 && closedFourScore < 100_000, `冲四点应达 FOUR 档且低于活四（实际 ${closedFourScore}）`)
  assert(openThreeScore >= 5_000 && openThreeScore < 10_000, `活三点应达 OPEN_THREE 档且低于冲四（实际 ${openThreeScore}）`)
  assert(fiveScore >= 1_000_000, `成五点应达 FIVE 档（实际 ${fiveScore}）`)
  assert(openFourScore > closedFourScore, '活四应高于冲四')
  assert(closedFourScore > openThreeScore, '冲四应高于活三')

  // 空盘 → 天元 (7,7)
  {
    const move = engine.suggestGomokuMove(emptyBoard(), 1)
    assertEqual(move, { x: 7, y: 7 }, '空盘首着应落天元')
  }

  // 己方成五点 → 直接落
  {
    const board = emptyBoard()
    for (const x of [3, 4, 5, 6]) put(board, x, 7, 1)
    const move = engine.suggestGomokuMove(board, 1)
    assert(
      move !== null && ((move.x === 2 && move.y === 7) || (move.x === 7 && move.y === 7)),
      '己方成五点应直接获胜（任选一端）',
    )
  }

  // 对方成五点 → 必堵
  {
    const board = emptyBoard()
    for (const x of [3, 4, 5, 6]) put(board, x, 7, 2)
    const move = engine.suggestGomokuMove(board, 1)
    assert(
      move !== null && ((move.x === 2 && move.y === 7) || (move.x === 7 && move.y === 7)),
      '对方四连应优先封堵',
    )
  }

  // 固定 rand 序列下选点可复现
  {
    const board = emptyBoard()
    put(board, 7, 7, 1)
    put(board, 8, 8, 2)
    const fixed = () => 0.42
    const first = engine.suggestGomokuMove(board, 1, fixed)
    const second = engine.suggestGomokuMove(board, 1, fixed)
    assertEqual(first, second, '同一 rand 序列下选点应可复现')
    assert(first !== null, '有棋子时应能给出选点')
  }

  // 候选点应贴近已有棋子（切比雪夫距离 ≤ 2）
  {
    const board = emptyBoard()
    put(board, 0, 0, 1)
    const move = engine.suggestGomokuMove(board, 2, () => 0.5)
    assert(
      move !== null && Math.max(Math.abs(move.x), Math.abs(move.y)) <= 2,
      '候选点应限制在已有棋子 2 格邻域内',
    )
  }
}

// === 引擎：AI 自对弈完整性 ===

function verifyAiSelfPlay(): void {
  const board = engine.createGomokuBoard()
  let color: 1 | 2 = 1
  let moves = 0
  let winner: 1 | 2 | 'draw' | null = null
  while (moves < 225) {
    const move = engine.suggestGomokuMove(board, color)
    if (move === null) break
    assert(engine.isGomokuCellEmpty(board, move.x, move.y), `第 ${moves + 1} 手应落在空点`)
    engine.placeGomokuStone(board, move.x, move.y, color)
    moves += 1
    if (engine.findGomokuWin(board, move.x, move.y) !== null) {
      winner = color
      break
    }
    if (engine.isGomokuBoardFull(board)) {
      winner = 'draw'
      break
    }
    color = color === 1 ? 2 : 1
  }
  assert(winner !== null, 'AI 自对弈应分出胜负或下满平局')
  assert(moves <= 225, '自对弈总手数不应超过 225')
  assert(moves >= 10, `自对弈手数应合理（实际 ${moves} 手）`)
}

// === 服务：邀请生命周期 ===

function verifyInviteLifecycle(): void {
  const base = tick()
  service.resetGomokuStateForTest()

  const { matchId } = service.createGomokuRoomForTest(8701, 'u8701', [], base)
  const { inviteId } = service.createGomokuInviteForTest(8701, 8702, matchId, base)

  // 拒绝：邀请移除
  service.respondGomokuInvite(8702, inviteId, 'decline', base + 1)
  const invitesAfterDecline = service.listGomokuInvites(8702, base + 2)
  assertEqual(invitesAfterDecline.incoming.length, 0, '拒绝后 incoming 应为空')

  // 取消：发出方撤回
  const second = service.createGomokuInviteForTest(8701, 8702, matchId, base + 3)
  service.cancelGomokuInvite(8701, second.inviteId, base + 4)
  assertEqual(service.listGomokuInvites(8701, base + 5).outgoing.length, 0, '取消后 outgoing 应为空')

  // 过期：410
  const third = service.createGomokuInviteForTest(8701, 8702, matchId, base + 6)
  expectThrow(
    () => service.respondGomokuInvite(8702, third.inviteId, 'accept', base + 6 + 61_000),
    '邀请已过期',
    '过期邀请接受应抛 410',
  )

  // 接受：进入等待房间
  const fourth = service.createGomokuInviteForTest(8701, 8702, matchId, base + 10)
  const accepted = service.respondGomokuInvite(8702, fourth.inviteId, 'accept', base + 11)
  assert(accepted.ok, '接受邀请应成功')
  assert(accepted.match !== undefined, '接受邀请应返回房间')
  assertEqual(accepted.match?.players.length, 2, '接受后房间应有 2 人')

  // 第 3 人：房间已满 409
  const fifth = service.createGomokuInviteForTest(8701, 8703, matchId, base + 12)
  expectThrow(
    () => service.respondGomokuInvite(8703, fifth.inviteId, 'accept', base + 13),
    '房间已满',
    '第 3 人接受应被拒绝（房间已满）',
  )

  // 房主离开 = 解散
  const left = service.leaveGomokuMatch(8701, matchId, base + 14)
  assertEqual(left.dissolved, true, '房主离开应解散房间')
  const dissolved = service.getGomokuMatch(8701, matchId, base + 15)
  assertEqual(dissolved.status, 'finished', '解散后房间应已结束')
  assertEqual(dissolved.reason, 'cancelled', '解散原因应为 cancelled')

  service.resetGomokuStateForTest()
}

// === 服务：开始与轮流落子 ===

function verifyMatchFlow(): void {
  const base = tick()
  service.resetGomokuStateForTest()

  const { matchId } = service.createGomokuRoomForTest(8711, 'u8711', [], base)

  // 只有 1 人不能开始
  expectThrow(
    () => service.startGomokuMatch(8711, matchId, base + 1),
    '至少需要 2 名玩家',
    '1 人开局应被拒绝',
  )

  const { inviteId } = service.createGomokuInviteForTest(8711, 8712, matchId, base + 2)
  service.respondGomokuInvite(8712, inviteId, 'accept', base + 3)

  const { match } = service.startGomokuMatch(8711, matchId, base + 4)
  assertEqual(match.status, 'playing', '开局后状态应为 playing')
  assertEqual(match.board.length, 225, '开局棋盘应为 225 格')
  assert(match.board.every((cell) => cell === 0), '开局棋盘应为空盘')
  assertEqual(playerOf(match, 8711).color, 1, '房主（座位 0）应执黑')
  assertEqual(playerOf(match, 8712).color, 2, '座位 1 应执白')
  assertEqual(turnHolder(match), 8711, '黑先行：回合应归房主')

  // 非当前回合落子 409
  expectThrow(
    () => service.applyGomokuAction(8712, matchId, { type: 'place', x: 7, y: 7 }, base + 5),
    '还没轮到你',
    '白方在黑方落子前落子应 409',
  )

  // 黑方落子
  const afterBlack = service.applyGomokuAction(8711, matchId, { type: 'place', x: 7, y: 7 }, base + 6).match
  assertEqual(afterBlack.board[7 * 15 + 7], 1, '黑方落子应写入棋盘')
  assertEqual(playerOf(afterBlack, 8711).moves, 1, '黑方手数应为 1')
  assertEqual(turnHolder(afterBlack), 8712, '落子后应轮到白方')
  assertEqual(afterBlack.lastMove, { userId: 8711, x: 7, y: 7, color: 1, auto: false }, 'lastMove 应记录落子')

  // 已有棋子的点 400
  expectThrow(
    () => service.applyGomokuAction(8712, matchId, { type: 'place', x: 7, y: 7 }, base + 7),
    '该位置已有棋子',
    '在已占用点落子应 400',
  )

  // 白方落子 → 轮回黑方
  const afterWhite = service.applyGomokuAction(8712, matchId, { type: 'place', x: 8, y: 8 }, base + 8).match
  assertEqual(afterWhite.board[8 * 15 + 8], 2, '白方落子应写入棋盘')
  assertEqual(turnHolder(afterWhite), 8711, '白方落子后应轮回黑方')

  // 非参与者 404
  expectThrow(
    () => service.getGomokuMatch(8799, matchId, base + 9),
    '对局不存在',
    '非参与者查询对局应 404',
  )

  service.resetGomokuStateForTest()
}

// === 服务：连五结算 ===

function verifyFiveWin(): void {
  const base = tick()
  service.resetGomokuStateForTest()

  const { matchId } = service.createGomokuRoomForTest(8721, 'u8721', [8722], base)
  service.startGomokuMatch(8721, matchId, base + 1)

  // 黑方横向五连（白方在别处落子）
  let now = base + 2
  for (let x = 0; x < 5; x += 1) {
    service.applyGomokuAction(8721, matchId, { type: 'place', x, y: 3 }, now)
    now += 1_000
    if (x < 4) {
      service.applyGomokuAction(8722, matchId, { type: 'place', x, y: 10 }, now)
      now += 1_000
    }
  }

  const final = service.getGomokuMatch(8721, matchId, now)
  assertEqual(final.status, 'finished', '五连后对局应结束')
  assertEqual(final.reason, 'five', '结束原因应为 five')
  assertEqual(final.winnerId, 8721, '黑方应获胜')
  assertEqual(final.winningLine?.length, 5, '获胜连线应有 5 子')
  assertEqual(
    final.winningLine?.map((point) => [point.x, point.y]),
    [[0, 3], [1, 3], [2, 3], [3, 3], [4, 3]],
    '获胜连线应按 y、x 升序',
  )
  assertEqual(playerOf(final, 8721).status, 'won', '胜者 status 应为 won')
  assertEqual(playerOf(final, 8722).status, 'lost', '败者 status 应为 lost')
  assertEqual(final.turn, null, '终局回合应为 null')

  // 已结束的对局不能再落子
  expectThrow(
    () => service.applyGomokuAction(8721, matchId, { type: 'place', x: 14, y: 14 }, now + 1),
    '对局未开始或已结束',
    '结束后落子应 409',
  )

  service.resetGomokuStateForTest()
}

// === 服务：认输 ===

function verifyResign(): void {
  const base = tick()
  service.resetGomokuStateForTest()

  const { matchId } = service.createGomokuRoomForTest(8731, 'u8731', [8732], base)
  service.startGomokuMatch(8731, matchId, base + 1)

  const { match } = service.resignGomokuMatch(8732, matchId, base + 2)
  assertEqual(match.status, 'finished', '认输后对局应结束')
  assertEqual(match.reason, 'resign', '结束原因应为 resign')
  assertEqual(match.winnerId, 8731, '对方应获胜')

  service.resetGomokuStateForTest()
}

// === 服务：回合超时托管 ===

function verifyTurnTimeoutAutoPlace(): void {
  const base = tick()
  service.resetGomokuStateForTest()

  const { matchId } = service.createGomokuRoomForTest(8741, 'u8741', [8742], base)
  service.startGomokuMatch(8741, matchId, base + 1)

  // 黑方回合超时 60 秒 → sweeper 自动托管落子（空盘 → 天元）
  const afterFirst = (tick(service.GOMOKU_TURN_MS + 2_000), service.runGomokuSweeper(clock), service.getGomokuMatch(8741, matchId, clock))
  assertEqual(afterFirst.board[7 * 15 + 7], 1, '托管首着应落天元（黑）')
  assertEqual(afterFirst.lastMove?.auto, true, '托管落子应带 auto 标记')
  assertEqual(turnHolder(afterFirst), 8742, '托管后应轮到白方')

  // 白方也超时 → 连续托管第二手（落点贴近天元）
  tick(service.GOMOKU_TURN_MS + 2_000)
  service.runGomokuSweeper(clock)
  const afterSecond = service.getGomokuMatch(8741, matchId, clock)
  assertEqual(afterSecond.lastMove?.userId, 8742, '第二手托管应归白方')
  assertEqual(afterSecond.lastMove?.auto, true, '第二手托管也应带 auto 标记')
  assertEqual(playerOf(afterSecond, 8742).moves, 1, '白方托管手数应为 1')
  assertEqual(turnHolder(afterSecond), 8741, '第二手托管后应轮回黑方')

  // 托管后黑方仍可正常手动落子（新回合 60 秒内）
  const manual = service.applyGomokuAction(8741, matchId, { type: 'place', x: 0, y: 0 }, clock + 1_000).match
  assertEqual(manual.board[0], 1, '托管后手动落子应正常写入')
  assertEqual(manual.lastMove?.auto, false, '手动落子 auto 应为 false')

  service.resetGomokuStateForTest()
}

// === 服务：掉线判负 ===

function verifyDisconnectForfeit(): void {
  const base = tick()
  service.resetGomokuStateForTest()

  const { matchId } = service.createGomokuRoomForTest(8751, 'u8751', [8752], base)
  service.startGomokuMatch(8751, matchId, base + 1)

  // 房主打 presence 心跳保持在线；白方从不心跳 → 120 秒后判负
  presence.markGamePresence(8751, base + 60_000)
  tick(service.GOMOKU_DISCONNECT_FORFEIT_MS + 10_000)
  service.runGomokuSweeper(clock)

  const final = service.getGomokuMatch(8751, matchId, clock)
  assertEqual(final.status, 'finished', '掉线判负后对局应结束')
  assertEqual(final.reason, 'forfeit', '结束原因应为 forfeit')
  assertEqual(final.winnerId, 8751, '在线一方应获胜')

  service.resetGomokuStateForTest()
}

// === 服务：全局超时平局 / 满盘平局 ===

function verifyDrawPaths(): void {
  // 全局 30 分钟超时 → timeout 平局
  {
    const base = tick()
    service.resetGomokuStateForTest()
    const { matchId } = service.createGomokuRoomForTest(8761, 'u8761', [8762], base)
    service.startGomokuMatch(8761, matchId, base + 1)

    // 先下一手避免空盘观感，再推进到全局结束
    service.applyGomokuAction(8761, matchId, { type: 'place', x: 7, y: 7 }, base + 2)
    tick(service.GOMOKU_DEFAULT_DURATION_MS + 5_000)
    service.runGomokuSweeper(clock)

    const final = service.getGomokuMatch(8761, matchId, clock)
    assertEqual(final.status, 'finished', '全局超时后对局应结束')
    assertEqual(final.reason, 'timeout', '全局超时结束原因应为 timeout')
    assertEqual(final.winnerId, null, '全局超时应为平局（无胜者）')
    service.resetGomokuStateForTest()
  }

  // 下满 225 手且无五连 → draw 平局（确定性构造）
  // 着色 (x + 2y) mod 4 < 2 → 黑：横/竖/两斜四个方向的连续同色段都 ≤ 2（永不成五），
  // 且全盘恰好 113 黑 / 112 白，与「黑先白后下满 225 手」的手数完全一致。
  {
    const base = tick()
    service.resetGomokuStateForTest()
    const { matchId } = service.createGomokuRoomForTest(8763, 'u8763', [8764], base)
    service.startGomokuMatch(8763, matchId, base + 1)

    const blackCells: Array<{ x: number; y: number }> = []
    const whiteCells: Array<{ x: number; y: number }> = []
    for (let y = 0; y < 15; y += 1) {
      for (let x = 0; x < 15; x += 1) {
        const cell = (x + 2 * y) % 4 < 2 ? blackCells : whiteCells
        cell.push({ x, y })
      }
    }
    assertEqual(blackCells.length, 113, '确定性着色应恰好产生 113 个黑点')
    assertEqual(whiteCells.length, 112, '确定性着色应恰好产生 112 个白点')

    let now = base + 2
    for (let i = 0; i < blackCells.length; i += 1) {
      const black = blackCells[i]
      service.applyGomokuAction(8763, matchId, { type: 'place', x: black.x, y: black.y }, now)
      now += 1_000
      if (i < whiteCells.length) {
        const white = whiteCells[i]
        service.applyGomokuAction(8764, matchId, { type: 'place', x: white.x, y: white.y }, now)
        now += 1_000
      }
    }

    const final = service.getGomokuMatch(8763, matchId, now)
    assertEqual(final.status, 'finished', '下满 225 手后对局应结束')
    assertEqual(final.reason, 'draw', '下满且无五连应为 draw 平局')
    assertEqual(final.winnerId, null, 'draw 平局应无胜者')
    service.resetGomokuStateForTest()
  }
}

// === 服务：结束对局回收 + 主 sweeper 驱动 ===

function verifySweepRetention(): void {
  const base = tick()
  service.resetGomokuStateForTest()

  // 结束对局保留 5 分钟后回收
  const { matchId } = service.createGomokuRoomForTest(8771, 'u8771', [8772], base)
  service.startGomokuMatch(8771, matchId, base + 1)
  service.resignGomokuMatch(8772, matchId, base + 2)
  // 保留期内仍可查
  const kept = service.getGomokuMatch(8771, matchId, base + 3)
  assertEqual(kept.status, 'finished', '保留期内结束对局仍应可查')
  tick(service.GOMOKU_FINISHED_RETENTION_MS + 1_000)
  service.runGomokuSweeper(clock)
  expectThrow(
    () => service.getGomokuMatch(8771, matchId, clock),
    '对局不存在',
    '超过保留期后结束对局应被回收',
  )

  // 主 sweeper 应驱动五子棋的等待房间解散
  const quiet = service.createGomokuRoomForTest(8773, 'u8773', [8774], clock)
  game.runGameSweeper(clock + service.GOMOKU_WAITING_ROOM_TTL_MS + 1_000)
  const swept = service.getGomokuMatch(8773, quiet.matchId, clock + service.GOMOKU_WAITING_ROOM_TTL_MS + 2_000)
  assertEqual(swept.status, 'finished', '主 sweeper 应驱动五子棋的等待房间解散')
  assertEqual(swept.reason, 'cancelled', '主 sweeper 驱动的解散原因应为 cancelled')

  service.resetGomokuStateForTest()
}

// === 服务：跨游戏互斥 ===

function verifyCrossGameMutex(): void {
  const base = tick()
  service.resetGomokuStateForTest()

  const { matchId } = service.createGomokuRoomForTest(8781, 'u8781', [8782], base)
  // 五子棋房间里的玩家对其它游戏应表现为「忙碌」
  assert(game.isUserBusyInOtherGames(8781, 'jump'), '五子棋房间成员应被其它游戏互斥探针识别')
  assert(game.isUserBusyInOtherGames(8782, '2048'), '五子棋房间成员应被 2048 互斥探针识别')
  // 自查应排除自己（gomoku 自身探针不算「其它游戏」）
  assert(!game.isUserBusyInOtherGames(8781, 'gomoku'), 'gomoku 自查不应把自己算成其它游戏')

  service.resetGomokuStateForTest()
}

async function main(): Promise<void> {
  engine = await import('../src/services/gameGomoku.js')
  service = await import('../src/services/gameGomokuService.js')
  game = await import('../src/services/gameService.js')
  presence = await import('../src/services/gamePresence.js')

  verifyEngineConstants()
  verifyBoardBasics()
  verifyFindGomokuWin()
  verifyEvaluationAndSuggest()
  verifyAiSelfPlay()
  verifyInviteLifecycle()
  verifyMatchFlow()
  verifyFiveWin()
  verifyResign()
  verifyTurnTimeoutAutoPlace()
  verifyDisconnectForfeit()
  verifyDrawPaths()
  verifySweepRetention()
  verifyCrossGameMutex()

  // 收尾清空内存与兜底定时器（都是 unref，进程可正常退出）
  service.resetGomokuStateForTest()
  console.log(`✓ verify-gomoku 全部通过（${passed} 条断言）`)
}

main().catch((error: unknown) => {
  console.error('✗ verify-gomoku 验证失败：')
  console.error(error)
  process.exitCode = 1
})
