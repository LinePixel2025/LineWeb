/**
 * 中国象棋服务端引擎 + 联机状态机自检脚本（不依赖数据库 / 网络真实流量）
 *
 * 用法: cd server && npx tsx scripts/verify-xiangqi.ts
 */

process.env.DATABASE_URL ||= 'file:./.verify-xiangqi.db'
process.env.JWT_SECRET ||= 'verify-xiangqi-secret'
process.env.NODE_ENV ||= 'development'

type XqEngine = typeof import('../src/services/gameXiangqi.js')
type XqService = typeof import('../src/services/gameXiangqiService.js')
type GameService = typeof import('../src/services/gameService.js')
type PresenceModule = typeof import('../src/services/gamePresence.js')

let engine: XqEngine
let service: XqService
let game: GameService
let presence: PresenceModule

type MatchDto = ReturnType<XqService['getXiangqiMatch']>

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

const HOST = 9601
const P2 = 9602
const P3 = 9603
let clock = Date.now()
function tick(ms = 1_000): number {
  clock += ms
  return clock
}

function idx(x: number, y: number): number {
  return y * 9 + x
}

function emptyBoard(): number[] {
  return new Array<number>(90).fill(0)
}

/** 双方将帅 + 中线挡子（避免将帅照面导致所有着法非法） */
function kingsOnly(): number[] {
  const board = emptyBoard()
  board[idx(4, 9)] = engine.XIANGQI_GENERAL
  board[idx(4, 0)] = -engine.XIANGQI_GENERAL
  board[idx(4, 5)] = engine.XIANGQI_SOLDIER
  return board
}

function pieceChar(piece: number): string {
  if (piece === 0) return '空'
  const type = Math.abs(piece)
  const names = engine.XIANGQI_PIECE_NAMES[type]
  return (piece > 0 ? names.red : names.black) ?? '?'
}

function playerOf(dto: MatchDto, userId: number) {
  const player = dto.players.find((candidate) => candidate.userId === userId)
  if (!player) throw new Error(`断言失败：DTO 中找不到玩家 ${userId}`)
  return player
}

function turnHolder(dto: MatchDto): number {
  if (!dto.turn) throw new Error('断言失败：进行中应有回合')
  return dto.turn.userId
}

// === 引擎：初始局面与走子规则 ===

function verifyInitialBoard(): void {
  assertEqual(engine.XIANGQI_COLS, 9, '9 列')
  assertEqual(engine.XIANGQI_ROWS, 10, '10 行')
  assertEqual(engine.XIANGQI_CELLS, 90, '90 格')
  const board = engine.createXiangqiBoard()
  assertEqual(board.length, 90, '棋盘 90 格')
  assertEqual(board.filter((piece) => piece !== 0).length, 32, '初始 32 枚棋子')
  assertEqual(engine.findXiangqiGeneral(board, engine.XIANGQI_RED), idx(4, 9), '红帅在 4,9')
  assertEqual(engine.findXiangqiGeneral(board, engine.XIANGQI_BLACK), idx(4, 0), '黑将在 4,0')
  assertEqual(pieceChar(board[idx(0, 9)]), '车', '红车在左下角')
  assertEqual(pieceChar(board[idx(1, 2)]), '炮', '黑炮在 1,2')

  const moves = engine.generateLegalXiangqiMoves(board, engine.XIANGQI_RED)
  assert(moves.length >= 40, `红方初始合法着法应 ≥40（实际 ${moves.length}）`)
  assertEqual(engine.isXiangqiInCheck(board, engine.XIANGQI_RED), false, '红方开局未被将军')
  assertEqual(engine.isXiangqiInCheck(board, engine.XIANGQI_BLACK), false, '黑方开局未被将军')
  const status = engine.evaluateXiangqiStatus(board, engine.XIANGQI_RED)
  assertEqual(status.finished, false, '开局未结束')
}

function verifyPieces(): void {
  const board = engine.createXiangqiBoard()
  // 红车：向上两步可走，第三格被己方兵挡住
  const chariotMoves = engine.xiangqiLegalMovesFrom(board, idx(0, 9))
  assert(chariotMoves.includes(idx(0, 8)) && chariotMoves.includes(idx(0, 7)), '红车可上两步')
  assert(!chariotMoves.includes(idx(0, 6)), '红车不能吃己方兵')

  // 红马：马腿被己方相挡住两个方向
  const horseMoves = engine.xiangqiLegalMovesFrom(board, idx(1, 9))
  assertEqual(horseMoves.sort((a, b) => a - b), [idx(0, 7), idx(2, 7)].sort((a, b) => a - b), '红马初始仅两个日字点')

  // 红相：田字且不过河
  const elephantMoves = engine.xiangqiLegalMovesFrom(board, idx(2, 9))
  assert(elephantMoves.includes(idx(0, 7)) && elephantMoves.includes(idx(4, 7)), '红相可走田字')
  assert(!elephantMoves.some((target) => target < idx(0, 5)), '红相不能过河')

  // 红仕：九宫斜行一步
  const advisorMoves = engine.xiangqiLegalMovesFrom(board, idx(3, 9))
  assertEqual(advisorMoves, [idx(4, 8)], '红仕只能进九宫中心')

  // 红帅：九宫一步（两侧被仕挡住）
  const generalMoves = engine.xiangqiLegalMovesFrom(board, idx(4, 9))
  assertEqual(generalMoves, [idx(4, 8)], '红帅只能向上一步')

  // 兵：过河前后
  const soldierBoard = kingsOnly()
  soldierBoard[idx(0, 6)] = engine.XIANGQI_SOLDIER
  const beforeRiver = engine.xiangqiLegalMovesFrom(soldierBoard, idx(0, 6))
  assertEqual(beforeRiver, [idx(0, 5)], '红兵过河前只能向前')
  soldierBoard[idx(0, 4)] = engine.XIANGQI_SOLDIER
  const afterRiver = engine.xiangqiLegalMovesFrom(soldierBoard, idx(0, 4))
  assert(afterRiver.includes(idx(0, 3)) && afterRiver.includes(idx(1, 4)), '红兵过河后可向前和横走')
  assert(!afterRiver.includes(idx(0, 5)), '兵不能后退')

  // 炮：直线移动；吃子必须隔一个炮架
  const cannonBoard = kingsOnly()
  cannonBoard[idx(0, 4)] = engine.XIANGQI_CANNON
  cannonBoard[idx(0, 0)] = -engine.XIANGQI_CHARIOT
  const noScreen = engine.xiangqiLegalMovesFrom(cannonBoard, idx(0, 4))
  assert(noScreen.includes(idx(0, 3)), '炮可走空位')
  assert(!noScreen.includes(idx(0, 0)), '无炮架时炮不能吃子')
  cannonBoard[idx(0, 2)] = engine.XIANGQI_SOLDIER
  const withScreen = engine.xiangqiLegalMovesFrom(cannonBoard, idx(0, 4))
  assert(withScreen.includes(idx(0, 0)), '隔一个炮架可以吃子')
  assert(!withScreen.includes(idx(0, 1)), '炮不能落在炮架后的空位')
}

function verifyCheckAndMate(): void {
  // 将帅照面 = 双方被将军
  const facing = emptyBoard()
  facing[idx(4, 9)] = engine.XIANGQI_GENERAL
  facing[idx(4, 0)] = -engine.XIANGQI_GENERAL
  assertEqual(engine.isXiangqiInCheck(facing, engine.XIANGQI_RED), true, '将帅照面时红方被将军')
  assertEqual(engine.isXiangqiInCheck(facing, engine.XIANGQI_BLACK), true, '将帅照面时黑方被将军')

  // 红车照将
  const checkBoard = kingsOnly()
  checkBoard[idx(4, 5)] = engine.XIANGQI_CHARIOT
  assertEqual(engine.isXiangqiInCheck(checkBoard, engine.XIANGQI_BLACK), true, '红车同列照将黑方')
  assertEqual(engine.isXiangqiInCheck(checkBoard, engine.XIANGQI_RED), false, '红方未被将军')

  // 绝杀：黑将 (4,0)，红车 (3,1)(5,1)(4,2)，红帅 (4,9)
  const mateBoard = emptyBoard()
  mateBoard[idx(4, 9)] = engine.XIANGQI_GENERAL
  mateBoard[idx(4, 0)] = -engine.XIANGQI_GENERAL
  mateBoard[idx(3, 1)] = engine.XIANGQI_CHARIOT
  mateBoard[idx(5, 1)] = engine.XIANGQI_CHARIOT
  mateBoard[idx(4, 2)] = engine.XIANGQI_CHARIOT
  const mate = engine.evaluateXiangqiStatus(mateBoard, engine.XIANGQI_BLACK)
  assertEqual(mate.finished, true, '绝杀局面应结束')
  assertEqual(mate.reason, 'checkmate', '结束原因 checkmate')
  assertEqual(mate.winner, engine.XIANGQI_RED, '红方获胜')

  // 困毙：黑将 (4,0)，红车 (3,1)(5,1)，红马 (3,3) 控 (4,1)，红帅在 (3,9)
  const staleBoard = emptyBoard()
  staleBoard[idx(3, 9)] = engine.XIANGQI_GENERAL
  staleBoard[idx(4, 0)] = -engine.XIANGQI_GENERAL
  staleBoard[idx(3, 1)] = engine.XIANGQI_CHARIOT
  staleBoard[idx(5, 1)] = engine.XIANGQI_CHARIOT
  staleBoard[idx(3, 3)] = engine.XIANGQI_HORSE
  const stale = engine.evaluateXiangqiStatus(staleBoard, engine.XIANGQI_BLACK)
  assertEqual(stale.checked, false, '困毙时不应被将军')
  assertEqual(stale.finished, true, '无合法着法应结束')
  assertEqual(stale.reason, 'stalemate', '结束原因 stalemate')
  assertEqual(stale.winner, engine.XIANGQI_RED, '困毙判负，红方获胜')
}

function verifySearch(): void {
  const board = engine.createXiangqiBoard()
  const move = engine.suggestXiangqiMove(board, engine.XIANGQI_RED, { depth: 1 })
  assert(Boolean(move), 'AI 应能给出着法')
  if (move) {
    assert(engine.isXiangqiMoveLegal(board, move.from, move.to, engine.XIANGQI_RED), 'AI 着法应合法')
  }

  // 能吃车时优先吃车（红车在底线，黑车暴露）
  const captureBoard = kingsOnly()
  captureBoard[idx(0, 5)] = engine.XIANGQI_CHARIOT
  captureBoard[idx(0, 3)] = -engine.XIANGQI_CHARIOT
  const capture = engine.suggestXiangqiMove(captureBoard, engine.XIANGQI_RED, { depth: 2 })
  assertEqual(capture, { from: idx(0, 5), to: idx(0, 3) }, 'AI 应吃掉无保护的黑车')

  // 不吃受保护的子：黑车吃 (0,4) 的红马会被 (0,7) 的红车立刻反吃，净亏
  // （静态搜索未生效时，各难度都会贪吃这一步 —— 即玩家看到的「乱吃棋子」）
  const defendedBoard = kingsOnly()
  defendedBoard[idx(0, 2)] = -engine.XIANGQI_CHARIOT
  defendedBoard[idx(0, 4)] = engine.XIANGQI_HORSE
  defendedBoard[idx(0, 7)] = engine.XIANGQI_CHARIOT
  for (const depth of [1, 2, 3] as const) {
    const choice = engine.suggestXiangqiMove(defendedBoard, engine.XIANGQI_BLACK, { depth })
    assert(Boolean(choice), `深度 ${depth}：AI 应能给出着法`)
    if (choice) {
      assert(engine.isXiangqiMoveLegal(defendedBoard, choice.from, choice.to, engine.XIANGQI_BLACK), `深度 ${depth}：AI 着法合法`)
      assert(choice.to !== idx(0, 4), `深度 ${depth}：AI 不应白吃受保护的马（会被反吃车）`)
    }
  }

  // 自对弈 20 个半回合，每步合法（深度 2 才能稳定走满；深度 1 可能很快被绝杀）
  let state = engine.createXiangqiBoard()
  let side: 1 | -1 = engine.XIANGQI_RED
  let plies = 0
  for (; plies < 20; plies += 1) {
    const status = engine.evaluateXiangqiStatus(state, side)
    if (status.finished) break
    const next = engine.suggestXiangqiMove(state, side, { depth: 2 })
    if (!next) break
    assert(engine.isXiangqiMoveLegal(state, next.from, next.to, side), `自对弈第 ${plies + 1} 步合法`)
    engine.makeXiangqiMove(state, next.from, next.to)
    side = side === engine.XIANGQI_RED ? engine.XIANGQI_BLACK : engine.XIANGQI_RED
  }
  assert(plies >= 10, 'AI 自对弈应能走满 10 步以上')
}

// === 服务 ===

function verifyServiceLifecycle(): void {
  service.resetXiangqiStateForTest()
  const base = tick()
  const { matchId } = service.createXiangqiRoomForTest(HOST, 'u9601', [P2], base)
  service.startXiangqiMatch(HOST, matchId, base + 1)
  const view = service.getXiangqiMatch(HOST, matchId, base + 2)
  assertEqual(view.status, 'playing', '开局状态 playing')
  assertEqual(view.board.length, 90, 'DTO 棋盘 90 格')
  assertEqual(view.players[0].side, 'red', '房主执红')
  assertEqual(view.players[1].side, 'black', '对手执黑')
  assertEqual(turnHolder(view), HOST, '房主先行')
  assertEqual(view.checked, false, '开局未被将军')

  // 非法走子：红车斜走
  expectThrow(
    () => service.applyXiangqiAction(HOST, matchId, { type: 'move', from: idx(0, 9), to: idx(1, 8) }, base + 3),
    '不合法',
    '车斜走应 400',
  )

  // 合法走子：红炮 1,7 → 1,4
  const after = service.applyXiangqiAction(
    HOST,
    matchId,
    { type: 'move', from: idx(1, 7), to: idx(1, 4) },
    base + 4,
  )
  assertEqual(after.match.board[idx(1, 4)], engine.XIANGQI_CANNON, '红炮已移动')
  assertEqual(after.match.board[idx(1, 7)], 0, '红炮原位清空')
  assertEqual(after.match.lastMove?.userId, HOST, '记录最后一步玩家')
  assertEqual(turnHolder(after.match), P2, '轮到黑方')
  assertEqual(after.match.version, view.version + 1, '版本推进')

  // 非回合走子 409
  expectThrow(
    () => service.applyXiangqiAction(HOST, matchId, { type: 'move', from: idx(1, 9), to: idx(2, 7) }, base + 5),
    '还没轮到你',
    '非当前回合应 409',
  )

  // 黑方合法走子：黑马 1,0 → 2,2
  const afterBlack = service.applyXiangqiAction(
    P2,
    matchId,
    { type: 'move', from: idx(1, 0), to: idx(2, 2) },
    base + 6,
  )
  assertEqual(afterBlack.match.board[idx(2, 2)], -engine.XIANGQI_HORSE, '黑马移动')
  assertEqual(turnHolder(afterBlack.match), HOST, '回合回到红方')

  // 认输
  const resigned = service.resignXiangqiMatch(P2, matchId, base + 7)
  assertEqual(resigned.match.status, 'finished', '认输后终局')
  assertEqual(resigned.match.reason, 'resign', '结束原因 resign')
  assertEqual(resigned.match.winnerId, HOST, '对手认输，房主获胜')
}

function verifyTimeoutAndForfeit(): void {
  service.resetXiangqiStateForTest()
  const base = tick()
  const { matchId } = service.createXiangqiRoomForTest(HOST, 'u9601', [P2], base)
  service.startXiangqiMatch(HOST, matchId, base + 1)
  presence.markGamePresence(HOST, base + 2)
  presence.markGamePresence(P2, base + 2)
  const before = service.getXiangqiMatch(HOST, matchId, base + 2)
  service.runXiangqiSweeper(base + service.XIANGQI_TURN_MS + 2_000)
  const after = service.getXiangqiMatch(HOST, matchId, base + service.XIANGQI_TURN_MS + 2_500)
  assert(after.version > before.version, '回合超时应自动托管走子')
  assertEqual(after.lastMove?.auto, true, '托管走的棋应带 auto 标记')

  service.resetXiangqiStateForTest()
  const base2 = tick()
  const { matchId: ffMatch } = service.createXiangqiRoomForTest(HOST, 'u9601', [P2], base2)
  service.startXiangqiMatch(HOST, ffMatch, base2 + 1)
  presence.clearGamePresence(HOST)
  presence.clearGamePresence(P2)
  presence.markGamePresence(HOST, base2 + service.XIANGQI_DISCONNECT_FORFEIT_MS + 9_000)
  service.runXiangqiSweeper(base2 + service.XIANGQI_DISCONNECT_FORFEIT_MS + 10_000)
  const ff = service.getXiangqiMatch(HOST, ffMatch, base2 + service.XIANGQI_DISCONNECT_FORFEIT_MS + 10_500)
  assertEqual(ff.status, 'finished', '对手掉线应终局')
  assertEqual(ff.reason, 'forfeit', '结束原因 forfeit')
  assertEqual(ff.winnerId, HOST, '在线方获胜')
}

function verifySyncAndMutex(): void {
  service.resetXiangqiStateForTest()
  const base = tick()
  const { matchId } = service.createXiangqiRoomForTest(HOST, 'u9601', [P2], base)
  service.startXiangqiMatch(HOST, matchId, base + 1)
  assertEqual(service.getActiveXiangqiMatch(HOST, base + 2)?.id, matchId, 'active 返回当前对局')
  assertEqual(service.getXiangqiSync(P2, matchId, base + 2).match?.id, matchId, 'sync 指定 matchId 返回对局')
  expectThrow(() => service.getXiangqiSync(P3, matchId, base + 2), '对局不存在', '非参与者 sync 应 404')
  assert(game.isUserBusyInOtherGames(HOST), '象棋玩家应被其他游戏视为忙')
  assertEqual(game.isUserBusyInOtherGames(HOST, 'xiangqi'), false, '自家检查应排除自己')

  service.resetXiangqiStateForTest()
  const base2 = tick()
  const { matchId: idle } = service.createXiangqiRoomForTest(HOST, 'u9601', [], base2)
  const cancelled = service.getXiangqiMatch(HOST, idle, base2 + service.XIANGQI_WAITING_ROOM_TTL_MS + 1_000)
  assertEqual(cancelled.reason, 'cancelled', '等待房间超时应解散')
}

async function main(): Promise<void> {
  engine = await import('../src/services/gameXiangqi.js')
  service = await import('../src/services/gameXiangqiService.js')
  game = await import('../src/services/gameService.js')
  presence = await import('../src/services/gamePresence.js')

  verifyInitialBoard()
  verifyPieces()
  verifyCheckAndMate()
  verifySearch()
  verifyServiceLifecycle()
  verifyTimeoutAndForfeit()
  verifySyncAndMutex()

  service.resetXiangqiStateForTest()
  console.log(`✓ verify-xiangqi 全部通过（${passed} 条断言）`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
