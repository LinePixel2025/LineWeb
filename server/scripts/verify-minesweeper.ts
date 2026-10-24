/**
 * 扫雷服务端引擎 + 联机状态机自检脚本（不依赖数据库 / 网络真实流量）
 *
 * 用法: cd server && npx tsx scripts/verify-minesweeper.ts
 *
 * 覆盖：
 *   - 引擎：同 seed 确定性、雷数与不重复占格、adjacent 正确、越界安全、洪水展开
 *     （不重复、不越界、不自动揭雷）、已翻开格幂等、和弦条件与展开、
 *     remainingSafe / isCleared / minePositions、联机尺寸常量；
 *   - 服务：建房 → 邀请 → 接受 → 房主开始（先手座位 0、回合 30 秒、全局 10 分钟）
 *     → 第一次 open 立刻轮转、非回合玩家 409、重复点已翻开格 applied:false 不轮转、
 *     插旗算一次并轮转、拔旗、越界 400、踩雷淘汰且对局继续、只剩 1 人判负/胜、
 *     全清 cleared 按翻开数取胜、回合超时 skips 累计到 3 淘汰、全局 timeout、
 *     认输、离开与房主解散、非参与者 404、DTO 不含未翻开格与雷位、
 *     掉线 forfeit、等待房间 30 分钟解散、sweep 回收、跨游戏互斥探针。
 *
 * 说明：时间一律用显式 now 参数驱动（不依赖真实定时器）；
 * 开局盘面用测试入口固定 seed，脚本按同一 seed 复现雷位来做精确取格；
 * 邀请用测试入口直接登记，避开数据库里的好友关系校验。
 */

// 依赖模块会读 DATABASE_URL / JWT_SECRET：先给默认值再动态 import，
// Prisma 为惰性连接，只要脚本不触发真实查询就不会碰到数据库。
process.env.DATABASE_URL ||= 'file:./.verify-minesweeper.db'
process.env.JWT_SECRET ||= 'verify-minesweeper-secret'
process.env.NODE_ENV ||= 'development'

type MinesweeperEngine = typeof import('../src/services/gameMinesweeper.js')
type MinesweeperService = typeof import('../src/services/gameMinesweeperService.js')
type SnakeService = typeof import('../src/services/gameSnakeService.js')
type DoudizhuService = typeof import('../src/services/gameDoudizhuService.js')
type GameService = typeof import('../src/services/gameService.js')
type PresenceModule = typeof import('../src/services/gamePresence.js')

let engine: MinesweeperEngine
let service: MinesweeperService
let snake: SnakeService
let ddz: DoudizhuService
let game: GameService
let presence: PresenceModule

type MinesweeperBoard = ReturnType<MinesweeperEngine['createMinesweeperBoard']>
type MatchDto = ReturnType<MinesweeperService['getMinesweeperMatch']>
type PlayerDto = MatchDto['players'][number]

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

const TEST_SEED = 20261029

/** 按测试种子复现服务端的权威盘面（雷位与完全一致） */
function mirrorBoard(seed: number = TEST_SEED): MinesweeperBoard {
  return engine.createMinesweeperBoard(seed, engine.MS_ONLINE_WIDTH, engine.MS_ONLINE_HEIGHT, engine.MS_ONLINE_MINES)
}

function bombSetOf(board: MinesweeperBoard): Set<number> {
  return new Set(engine.minePositions(board))
}

/** 手工布置雷位的小盘面（引擎单测用） */
function boardWithBombs(width: number, height: number, bombs: number[]): MinesweeperBoard {
  const board = engine.createMinesweeperBoard(1, width, height, 0)
  board.bombs = new Array<boolean>(width * height).fill(false)
  for (const index of bombs) board.bombs[index] = true
  board.mines = bombs.length
  return board
}

function openedIndexes(dto: MatchDto): number[] {
  return dto.opened.map((cell) => cell.index)
}

/** 找一个尚未翻开、且「是否雷」符合要求的格子下标 */
function pickCell(board: MinesweeperBoard, dto: MatchDto, wantMine: boolean): number {
  const opened = new Set(openedIndexes(dto))
  const bombs = bombSetOf(board)
  for (let index = 0; index < board.width * board.height; index += 1) {
    if (opened.has(index)) continue
    if (bombs.has(index) === wantMine) return index
  }
  throw new Error(`断言失败：找不到${wantMine ? '雷' : '安全'}格`)
}

/** 当前回合持有者（对局进行中必须存在） */
function turnHolder(dto: MatchDto): number {
  if (dto.turn === null) throw new Error('断言失败：进行中对局应有当前回合')
  return dto.turn.userId
}

/** DTO 的已翻开格必须与服务端权威盘面逐一吻合（含 adjacent），并且绝不泄露未翻开的雷 */
function assertDtoMatchesBoard(dto: MatchDto, board: MinesweeperBoard, label: string): void {
  const bombs = bombSetOf(board)
  const seen = new Set<number>()
  const total = board.width * board.height
  for (const cell of dto.opened) {
    assert(cell.index >= 0 && cell.index < total, `${label}：已翻开格下标应在盘面内`)
    assert(!seen.has(cell.index), `${label}：已翻开格不应重复`)
    seen.add(cell.index)
    assertEqual(cell.mine, bombs.has(cell.index), `${label}：已翻开格的 mine 应与权威盘面一致`)
    assertEqual(cell.adjacent, engine.adjacentMines(board, cell.index), `${label}：adjacent 应与权威盘面一致`)
  }
  // 雷位不泄露：DTO 里出现的雷格只能是「被直接点爆」的那些（每个 booms 对应一格）
  const mineCells = dto.opened.filter((cell) => cell.mine).length
  const totalBooms = dto.players.reduce((sum, player) => sum + player.booms, 0)
  assertEqual(mineCells, totalBooms, `${label}：DTO 里的雷格数应等于累计踩雷数（未翻开的雷位绝不发布）`)
}

/** 按「仍在场玩家的翻开格数最高者」算出应有胜者（并列返回 null） */
function expectedWinnerByOpened(dto: MatchDto): number | null {
  const alive = dto.players.filter((player) => player.status === 'playing')
  const pool = alive.length > 0 ? alive : dto.players
  const top = Math.max(...pool.map((player) => player.opened))
  const leaders = pool.filter((player) => player.opened === top)
  return leaders.length === 1 ? leaders[0].userId : null
}

// === 引擎：尺寸常量、确定性与布雷 ===

function verifyEngineBoard(): void {
  assertEqual(
    {
      width: engine.MS_ONLINE_WIDTH,
      height: engine.MS_ONLINE_HEIGHT,
      mines: engine.MS_ONLINE_MINES,
    },
    { width: 12, height: 12, mines: 22 },
    '联机盘面常量应为 12×12 / 22 雷',
  )

  const a = mirrorBoard()
  const same = mirrorBoard()
  const other = mirrorBoard(987654321)
  assertEqual(a.bombs, same.bombs, '相同 seed 应生成完全相同的盘面')
  assert(
    JSON.stringify(a.bombs) !== JSON.stringify(other.bombs),
    '不同 seed 应生成不同盘面',
  )

  assertEqual(a.width * a.height, 144, '12×12 盘面应有 144 格')
  assertEqual(a.bombs.length, a.width * a.height, 'bombs 应是扁平数组且长度 = width*height')
  assertEqual(a.mines, engine.MS_ONLINE_MINES, 'board.mines 应为 22')
  assertEqual(
    a.bombs.filter((bomb) => bomb).length,
    engine.MS_ONLINE_MINES,
    '实际雷数应为 22（布雷不重复占格）',
  )
  assert(Array.from(bombSetOf(a)).length === engine.MS_ONLINE_MINES, 'minePositions 应给出 22 个互异雷位')

  // 雷数超过格子总数时按盘面容量截断（退化但仍自洽）
  const crowded = engine.createMinesweeperBoard(7, 2, 2, 99)
  assertEqual(crowded.mines, 4, '雷数应被截断到格子总数')
  assertEqual(crowded.bombs.filter((bomb) => bomb).length, 4, '截断后实际布满雷')
  const empty = engine.createMinesweeperBoard(7, 3, 3, 0)
  assertEqual(empty.bombs.some((bomb) => bomb), false, '0 雷盘面不应有雷')
}

function verifyEngineAdjacency(): void {
  // 3×3，中心是雷：四角与四边的 adjacent 都应为 1，中心自身不计
  const board = boardWithBombs(3, 3, [4])
  assertEqual(engine.isMine(board, 4), true, '中心格应为雷')
  assertEqual(engine.isMine(board, 0), false, '角格不应是雷')
  for (const index of [0, 1, 2, 3, 5, 6, 7, 8]) {
    assertEqual(engine.adjacentMines(board, index), 1, `3×3 单雷盘面：格 ${index} 的相邻雷数应为 1`)
  }
  assertEqual(engine.adjacentMines(board, 4), 0, '雷格自身的 adjacent 只统计邻域（不含自身），单雷盘面应为 0')

  // 角上只应有 3 个邻格（越界丢弃）
  assertEqual(engine.adjacentIndexes(board, 0).sort((x, y) => x - y), [1, 3, 4], '角格邻域应为 3 格')
  assertEqual(engine.adjacentIndexes(board, 4).length, 8, '中心格邻域应为 8 格')
  assertEqual(engine.adjacentIndexes(board, -1), [], '越界下标邻域应为空')
  assertEqual(engine.adjacentIndexes(board, 99), [], '超出盘面长度下标邻域应为空')

  // 越界安全
  assertEqual(engine.isMine(board, -1), false, 'isMine 越界应返回 false')
  assertEqual(engine.isMine(board, 99), false, 'isMine 超界应返回 false')
  assertEqual(engine.adjacentMines(board, -1), 0, 'adjacentMines 越界应返回 0')
  assertEqual(engine.adjacentMines(board, 99), 0, 'adjacentMines 超界应返回 0')

  // 双雷相邻：验证累加
  const double = boardWithBombs(3, 3, [0, 8])
  assertEqual(engine.adjacentMines(double, 4), 2, '中心格应同时数到两个对角雷')
  assertEqual(engine.adjacentMines(double, 1), 1, '边格只数到其中一个雷')

  // 联机盘面：每颗雷的非雷邻格 adjacent 至少为 1，且总邻接关系自洽
  const online = mirrorBoard()
  let mineNeighbourPairs = 0
  for (const bomb of engine.minePositions(online)) {
    for (const neighbor of engine.adjacentIndexes(online, bomb)) {
      if (!engine.isMine(online, neighbor)) mineNeighbourPairs += 1
    }
  }
  let safeAdjacentSum = 0
  for (let index = 0; index < online.width * online.height; index += 1) {
    if (engine.isMine(online, index)) continue
    const count = engine.adjacentMines(online, index)
    safeAdjacentSum += count
    if (count > 0) assert(count >= 1, `安全格 ${index} 的相邻雷数应至少为 1`)
  }
  assertEqual(safeAdjacentSum, mineNeighbourPairs, '全部安全格的 adjacent 之和应等于雷位贡献的邻接对数')
}

function verifyEngineReveal(): void {
  // === 洪水展开：3×3，右下为雷 → 翻开左上应展开其余 8 格，不含雷、不重复 ===
  const board = boardWithBombs(3, 3, [8])
  const flood = engine.revealCells(board, new Set<number>(), 0)
  assertEqual(flood.mine, false, '翻开安全格不应报雷')
  assertEqual(flood.cells.slice().sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7], '洪水应展开全部 8 个安全格')
  assertEqual(new Set(flood.cells).size, flood.cells.length, '洪水展开的结果不应有重复格')
  assert(!flood.cells.includes(8), '洪水展开不应自动揭开雷')

  // 已翻开集合参与判定：不重复返回
  const opened = new Set<number>([0, 1, 2])
  const partial = engine.revealCells(board, opened, 3)
  for (const index of partial.cells) assert(!opened.has(index), '已翻开的格子不应再次返回')
  assertEqual(new Set(partial.cells).size, partial.cells.length, '部分已展开时结果也不应重复')

  // 幂等：对已翻开格再点 → 空
  const again = engine.revealCells(board, new Set<number>([0]), 0)
  assertEqual(again.cells, [], '已翻开格再点应返回空数组')
  assertEqual(again.mine, false, '已翻开格再点不应报雷')

  // 数字格只揭自己：5×5，(1,1) 有雷，翻开 (0,0) → adjacent=1 → 只返回自己
  const numbered = boardWithBombs(5, 5, [6])
  const single = engine.revealCells(numbered, new Set<number>(), 0)
  assertEqual(single.cells, [0], '数字格只应翻开自己，不再扩散')
  assertEqual(engine.adjacentMines(numbered, 0), 1, '该格 adjacent 应为 1')

  // 直接点到雷：只返回该雷格
  const boom = engine.revealCells(board, new Set<number>(), 8)
  assertEqual(boom.cells, [8], '直接点雷应只返回该雷格')
  assertEqual(boom.mine, true, '直接点雷应报雷')

  // 越界安全
  assertEqual(engine.revealCells(board, new Set<number>(), -1), { cells: [], mine: false }, '越界翻开应返回空')
  assertEqual(engine.revealCells(board, new Set<number>(), 99), { cells: [], mine: false }, '超界翻开应返回空')

  // 不修改传入集合（引擎侧无副作用）
  const untouched = new Set<number>([0])
  engine.revealCells(board, untouched, 3)
  assertEqual(Array.from(untouched), [0], 'revealCells 不应修改调用方传入的 opened 集合')
}

function verifyEngineChord(): void {
  const board = boardWithBombs(3, 3, [4])
  // 对未翻开格使用 → 空
  assertEqual(engine.chordCells(board, new Set<number>(), 0), [], '和弦必须作用在已判定格上')
  // 雷格 → 空
  assertEqual(engine.chordCells(board, new Set<number>([4]), 4), [], '和弦不应作用于雷格')
  // 旗数不足 → 空
  assertEqual(engine.chordCells(board, new Set<number>([0]), 0), [], '邻域判定数不等于数字时不应展开')
  // 旗数等于数字 → 展开其余邻格（1 与 3 为邻格；4 已判定）
  const closed = new Set<number>([0, 4])
  const chorded = engine.chordCells(board, closed, 0)
  assertEqual(chorded.slice().sort((a, b) => a - b), [1, 3], '和弦应一次性展开其余两个邻格')
  assertEqual(new Set(chorded).size, chorded.length, '和弦结果不应重复')
  // 数字为 0 的格不应触发和弦
  const calm = boardWithBombs(5, 5, [])
  assertEqual(engine.chordCells(calm, new Set<number>([12]), 12), [], '空白格（数字 0）不应触发和弦')
  // 插错旗：和弦会揭开邻里的雷
  const trap = boardWithBombs(3, 3, [8])
  const wrongFlag = engine.chordCells(trap, new Set<number>([4, 5]), 4)
  assertEqual(wrongFlag.includes(8), true, '插错旗时和弦应把邻里的雷揭开')
}

function verifyEngineCleared(): void {
  const board = boardWithBombs(3, 3, [8])
  assertEqual(engine.remainingSafe(board, new Set<number>()), 8, '9 格 1 雷：安全格应为 8')
  assertEqual(engine.isCleared(board, new Set<number>()), false, '未翻开时不应判为全清')
  assertEqual(
    engine.isCleared(board, new Set<number>([0, 1, 2, 3, 4, 5, 6])),
    false,
    '还剩 1 个安全格时不应判为全清',
  )
  assertEqual(
    engine.isCleared(board, new Set<number>([0, 1, 2, 3, 4, 5, 6, 7])),
    true,
    '全部安全格翻开时应判为全清',
  )
  // 雷格计入 opened 不影响安全格计数：8 个安全格里只揭开了 7 号 → 仍剩 7
  assertEqual(engine.remainingSafe(board, new Set<number>([7, 8])), 7, 'remainingSafe 不应把雷格算作安全格')
  assertEqual(
    engine.isCleared(board, new Set<number>([0, 1, 2, 3, 4, 5, 6, 7, 8])),
    true,
    '含雷格的完整 opened 仍应判为全清',
  )
  // 全雷退化盘面永不可能全清
  const allMines = boardWithBombs(2, 2, [0, 1, 2, 3])
  assertEqual(engine.isCleared(allMines, new Set<number>()), false, '无安全格的盘面不应判为全清')
  assertEqual(engine.minePositions(allMines), [0, 1, 2, 3], 'minePositions 应按下标升序返回全部雷位')
}

// === 服务：建房 → 邀请 → 接受 → 开始 → 轮流一次 ===

function verifyMatchFlow(): void {
  service.resetMinesweeperStateForTest()
  const base = Date.now()
  const HOST = 7101
  const GUEST = 7102
  const OUTSIDER = 7103
  const board = mirrorBoard()
  const bombs = bombSetOf(board)

  const { matchId } = service.createMinesweeperRoomForTest(HOST, `u${HOST}`, [], base, { seed: TEST_SEED })
  const waiting = service.getMinesweeperMatch(HOST, matchId, base)
  assertEqual(waiting.game, 'minesweeper', 'DTO 的 game 应为 minesweeper（前端据此判别游戏）')
  assertEqual(waiting.status, 'waiting', '新建房间应为等待状态')
  assertEqual(waiting.turn, null, '等待房间不应有当前回合')
  assertEqual(waiting.opened, [], '等待房间不应有任何已翻开格')
  assertEqual(waiting.flags, [], '等待房间不应有旗子')
  assertEqual(waiting.lastAction, null, '等待房间不应有动作记录')
  assertEqual(waiting.winnerId, null, '等待房间不应有胜者')
  assertEqual(waiting.reason, null, '等待房间不应有结束原因')
  assertEqual(waiting.endedAt, null, '等待房间不应有结束时间')
  assertEqual(waiting.board, { width: 12, height: 12, mines: 22 }, 'DTO 应给出 12×12 / 22 雷盘面')
  assertEqual(waiting.players.length, 1, '等待房间应只有房主')
  assertEqual(waiting.players[0].status, 'waiting', '等待房间玩家状态应为 waiting')
  assertEqual(waiting.players[0].opened, 0, '等待房间玩家翻开数应为 0')
  assertEqual(waiting.players[0].score, 0, '等待房间玩家分数应为 0')
  assertEqual(waiting.players[0].booms, 0, '等待房间玩家踩雷数应为 0')
  assertEqual(typeof waiting.players[0].online, 'boolean', 'DTO 应给出玩家在线状态')
  expectThrow(() => service.startMinesweeperMatch(HOST, matchId, base), '至少需要 2', '1 人房间开局应被拒绝')
  expectThrow(
    () => service.applyMinesweeperAction(HOST, matchId, { type: 'open', index: 0 }, base),
    '未开始',
    '等待房间提交动作应 409',
  )

  // === 邀请 → 接受 ===
  const invite = service.createMinesweeperInviteForTest(HOST, GUEST, matchId, base + 1)
  const incoming = service.listMinesweeperInvites(GUEST, base + 2)
  assertEqual(incoming.incoming.length, 1, '受邀方应看到 1 条待处理邀请')
  assertEqual(incoming.incoming[0].game, 'minesweeper', '邀请 DTO 的 game 应为 minesweeper')
  assertEqual(incoming.incoming[0].matchId, matchId, '邀请应指向房主的等待房间')
  assertEqual(
    incoming.incoming[0].expiresAt,
    new Date(base + 1 + service.MINESWEEPER_INVITE_TTL_MS).toISOString(),
    '邀请有效期应复用 GAME_INVITE_TTL_MS（60 秒）',
  )
  expectThrow(
    () => service.respondMinesweeperInvite(OUTSIDER, invite.inviteId, 'accept', base + 3),
    '邀请不存在',
    '非受邀方响应邀请应 404',
  )
  const accepted = service.respondMinesweeperInvite(GUEST, invite.inviteId, 'accept', base + 4)
  assertEqual(accepted.ok, true, '接受邀请应返回 ok')
  assertEqual(accepted.match!.players.length, 2, '接受邀请后房间应有 2 人')
  assertEqual(service.listMinesweeperInvites(GUEST, base + 5).incoming.length, 0, '接受后邀请应被清理')

  expectThrow(() => service.startMinesweeperMatch(GUEST, matchId, base + 6), '房主', '非房主开局应被拒绝')
  const started = service.startMinesweeperMatch(HOST, matchId, base + 7)
  assertEqual(started.match.status, 'playing', '房主开始后应进入进行中对局')
  assertEqual(started.match.turn, {
    userId: HOST,
    deadline: new Date(base + 7 + service.MINESWEEPER_TURN_MS).toISOString(),
    skips: 0,
  }, '开局应由座位 0（房主）先手，回合 30 秒、skips 为 0')
  assertEqual(started.match.opened, [], '开局不应有已翻开格')
  assertEqual(started.match.players.map((player) => player.status), ['playing', 'playing'], '开局后玩家应为 playing')
  assertEqual(started.match.players.map((player) => player.userId), [HOST, GUEST], 'players 应按座位顺序排列')
  assertEqual(started.match.startedAt, new Date(base + 7).toISOString(), 'startedAt 应为开局时间')
  assertEqual(
    started.match.endsAt,
    new Date(base + 7 + service.MINESWEEPER_DEFAULT_DURATION_MS).toISOString(),
    'endsAt 应为开局时间 + 默认 10 分钟',
  )
  expectThrow(() => service.startMinesweeperMatch(HOST, matchId, base + 8), '已经开始', '重复开局应 409')

  // === 轮流一次：非回合玩家 409 ===
  expectThrow(
    () => service.applyMinesweeperAction(GUEST, matchId, { type: 'open', index: 0 }, base + 9),
    '还没轮到你',
    '非回合玩家操作应 409「还没轮到你」',
  )
  expectThrow(
    () => service.applyMinesweeperAction(OUTSIDER, matchId, { type: 'open', index: 0 }, base + 9),
    '对局不存在',
    '非参与者操作应 404',
  )
  expectThrow(() => service.getMinesweeperMatch(OUTSIDER, matchId, base + 9), '对局不存在', '非参与者查询对局应 404')
  expectThrow(
    () => service.applyMinesweeperAction(HOST, matchId, { type: 'open', index: board.width * board.height }, base + 9),
    '棋盘范围',
    '越界下标应 400',
  )
  expectThrow(
    () => service.applyMinesweeperAction(HOST, matchId, { type: 'open', index: -1 }, base + 9),
    '棋盘范围',
    '负下标应 400',
  )

  // === 第一次 open 后立刻轮转 ===
  const safeIndex = pickCell(board, started.match, false)
  const first = service.applyMinesweeperAction(HOST, matchId, { type: 'open', index: safeIndex }, base + 10)
  assertEqual(first.applied, true, '当前回合玩家翻开应被接受')
  assertEqual(first.match.turn!.userId, GUEST, '一次 open 后应立即轮到下一名玩家')
  assertEqual(
    first.match.turn!.deadline,
    new Date(base + 10 + service.MINESWEEPER_TURN_MS).toISOString(),
    '新回合 deadline 应从本次动作时间起算',
  )
  assertEqual(first.match.turn!.skips, 0, '有效动作后 skips 应归零')
  assertEqual(first.match.lastAction, { userId: HOST, kind: 'open', index: safeIndex }, '应记录最近一次动作')
  const expectedCells = engine.revealCells(board, new Set<number>(), safeIndex)
  assertEqual(
    openedIndexes(first.match).slice().sort((a, b) => a - b),
    expectedCells.cells.slice().sort((a, b) => a - b),
    '服务端展开结果应与引擎（同 seed 镜像盘面）完全一致',
  )
  const hostDto = first.match.players.find((player) => player.userId === HOST)!
  assertEqual(hostDto.opened, expectedCells.cells.length, '翻开数应计入当前玩家名下')
  assertEqual(hostDto.score, hostDto.opened, 'score 应等于 opened')
  assertDtoMatchesBoard(first.match, board, '第一次翻开后')

  // === 重复点已翻开格：applied:false，不轮转、不递增版本 ===
  const beforeRepeat = service.getMinesweeperMatch(GUEST, matchId, base + 11)
  const repeated = service.applyMinesweeperAction(GUEST, matchId, { type: 'open', index: safeIndex }, base + 12)
  assertEqual(repeated.applied, false, '已翻开格再点应返回 applied=false')
  assertEqual(repeated.match.version, beforeRepeat.version, '无效点击不应递增版本')
  assertEqual(repeated.match.turn!.userId, GUEST, '无效点击不应轮转回合')

  // === 插旗也算一次并轮转；拔旗同理 ===
  const flagIndex = pickCell(board, repeated.match, true)
  const flagged = service.applyMinesweeperAction(GUEST, matchId, { type: 'flag', index: flagIndex }, base + 13)
  assertEqual(flagged.applied, true, '插旗应被接受')
  assertEqual(flagged.match.flags, [{ index: flagIndex, by: GUEST }], '旗子应记录插旗者')
  assertEqual(flagged.match.lastAction, { userId: GUEST, kind: 'flag', index: flagIndex }, '插旗应记录 flag 动作')
  assertEqual(flagged.match.turn!.userId, HOST, '插旗同样用掉「这一次」，应轮到下一名玩家')
  const unflagged = service.applyMinesweeperAction(HOST, matchId, { type: 'flag', index: flagIndex }, base + 14)
  assertEqual(unflagged.match.flags, [], '拔旗应把旗子从数组移除')
  assertEqual(unflagged.match.lastAction!.kind, 'unflag', '拔旗的动作种类应为 unflag')
  assertEqual(unflagged.match.turn!.userId, GUEST, '拔旗同样算一次操作并轮转')
  // 已翻开格插旗同样视为无效（不轮转）
  const openedDto = service.getMinesweeperMatch(GUEST, matchId, base + 15)
  const flagOnOpened = service.applyMinesweeperAction(GUEST, matchId, { type: 'flag', index: safeIndex }, base + 16)
  assertEqual(flagOnOpened.applied, false, '已翻开格插旗应返回 applied=false')
  assertEqual(flagOnOpened.match.turn!.userId, turnHolder(openedDto), '无效插旗不应轮转回合')
  assert(bombs.has(flagIndex), '本段测试应选中一个真实雷位来插旗')
  assertDtoMatchesBoard(flagOnOpened.match, board, '插拔旗后')

  // === 结束后查询口径（本对局尚未结束，这里只校验 sync 结构） ===
  const sync = service.getMinesweeperSync(HOST, matchId, base + 17)
  assertEqual(sync.serverTime, new Date(base + 17).toISOString(), 'sync 应返回服务端时间')
  assertEqual(sync.match?.id, matchId, 'sync 指定 matchId 时应返回该对局')
  assertEqual(sync.invites.incoming, [], 'sync 应携带邀请结构 incoming')
  assertEqual(sync.invites.outgoing, [], 'sync 应携带邀请结构 outgoing')
  assertEqual(service.getActiveMinesweeperMatch(HOST, base + 18)?.id, matchId, '进行中对局应能被主动查询到')
}

// === 服务：踩雷淘汰 / 只剩 1 人 / 全清 ===

function verifyBoomAndCleared(): void {
  const base = Date.now()

  // === 3 人局：第一颗雷淘汰点击者，对局继续并轮转 ===
  service.resetMinesweeperStateForTest()
  const board = mirrorBoard(TEST_SEED + 1)
  const room = service.createMinesweeperRoomForTest(7201, 'u7201', [7202, 7203], base, { seed: TEST_SEED + 1 })
  service.startMinesweeperMatch(7201, room.matchId, base)
  const mineIndex = pickCell(board, service.getMinesweeperMatch(7201, room.matchId, base), true)
  const boom = service.applyMinesweeperAction(7201, room.matchId, { type: 'open', index: mineIndex }, base + 1)
  assertEqual(boom.applied, true, '翻开雷格本身应被接受（后果是淘汰）')
  assertEqual(boom.match.status, 'playing', '3 人局中一人踩雷后对局应继续')
  assertEqual(boom.match.reason, null, '对局继续时不应有结束原因')
  const boomPlayer = boom.match.players.find((player) => player.userId === 7201)!
  assertEqual(boomPlayer.status, 'lost', '踩雷玩家应为 lost')
  assertEqual(boomPlayer.booms, 1, '踩雷次数应累计')
  assertEqual(boomPlayer.opened, 0, '踩雷那一格不计入安全翻开数')
  assertEqual(boom.match.turn!.userId, 7202, '回合应跳过被淘汰者交给下一名在场玩家')
  assertEqual(boom.match.turn!.skips, 0, '踩雷轮转不应记为超时')
  assertEqual(
    boom.match.opened.filter((cell) => cell.mine).map((cell) => cell.index),
    [mineIndex],
    '被点爆的雷格应出现在已翻开格里（这是唯一允许发布雷位的情形）',
  )
  assertDtoMatchesBoard(boom.match, board, '踩雷后')

  // === 再踩一颗雷：只剩 1 人 → boom 决出胜者 ===
  const secondMine = pickCell(board, service.getMinesweeperMatch(7202, room.matchId, base + 2), true)
  const finished = service.applyMinesweeperAction(7202, room.matchId, { type: 'open', index: secondMine }, base + 3)
  assertEqual(finished.match.status, 'finished', '只剩一名在场玩家时对局应结束')
  assertEqual(finished.match.reason, 'boom', '因踩雷决出胜者时结束原因应为 boom')
  assertEqual(finished.match.winnerId, 7203, '最后在场者应获胜')
  assertEqual(finished.match.turn, null, '已结束对局的 turn 应为 null')
  assertEqual(
    finished.match.players.find((player) => player.userId === 7203)!.status,
    'won',
    '胜者状态应为 won',
  )
  assertEqual(
    finished.match.players.filter((player) => player.status === 'lost').length,
    2,
    '两名踩雷者都应为 lost',
  )
  expectThrow(
    () => service.applyMinesweeperAction(7203, room.matchId, { type: 'open', index: 0 }, base + 4),
    '已结束',
    '已结束对局提交动作应 409',
  )
  expectThrow(() => service.resignMinesweeperMatch(7203, room.matchId, base + 4), '已结束', '已结束对局认输应 409')
  assertEqual(service.getActiveMinesweeperMatch(7203, base + 4), null, '主动查询不应返回已结束对局')
  const replayed = service.getMinesweeperSync(7203, room.matchId, base + 4)
  assertEqual(replayed.match?.reason, 'boom', 'sync 指定 matchId 时应能补拉已结束对局')

  // === 全清：把所有安全格翻开 → cleared，按翻开数取胜 ===
  service.resetMinesweeperStateForTest()
  const clearBoard = mirrorBoard(TEST_SEED + 2)
  const clearRoom = service.createMinesweeperRoomForTest(7211, 'u7211', [7212], base, { seed: TEST_SEED + 2 })
  let dto = service.startMinesweeperMatch(7211, clearRoom.matchId, base).match
  let actions = 0
  let lastPlaying = dto
  while (dto.status === 'playing' && actions < 200) {
    actions += 1
    const index = pickCell(clearBoard, dto, false)
    const result = service.applyMinesweeperAction(turnHolder(dto), clearRoom.matchId, { type: 'open', index }, base + actions)
    assertEqual(result.applied, true, `全清第 ${actions} 次翻开应被接受`)
    if (result.match.status === 'playing') lastPlaying = result.match
    dto = result.match
  }
  assertEqual(dto.status, 'finished', `${actions} 次翻开后盘面应被清完`)
  assertEqual(dto.reason, 'cleared', '全清的结束原因应为 cleared')
  assertEqual(dto.winnerId, expectedWinnerByOpened(lastPlaying), '全清应按在场玩家翻开数最高者取胜（并列平局）')
  assertEqual(
    dto.opened.filter((cell) => cell.mine).length,
    0,
    '全清路径不应有任何雷位被发布',
  )
  assertEqual(dto.opened.length + engine.MS_ONLINE_MINES, 144, '全清时 122 个安全格都应被翻开')
  assertDtoMatchesBoard(dto, clearBoard, '全清后')
}

// === 服务：邀请边缘流程 / 离开 / 认输 / 房间上限 ===

function verifyInvitesLeaveAndResign(): void {
  service.resetMinesweeperStateForTest()
  const base = Date.now()

  // === 拒绝 / 取消邀请 ===
  const room = service.createMinesweeperRoomForTest(7301, 'u7301', [], base)
  const declinedInvite = service.createMinesweeperInviteForTest(7301, 7302, room.matchId, base + 1)
  assertEqual(service.listMinesweeperInvites(7301, base + 2).outgoing.length, 1, '发起方应看到 1 条发出邀请')
  const declined = service.respondMinesweeperInvite(7302, declinedInvite.inviteId, 'decline', base + 3)
  assertEqual(declined.ok, true, '拒绝邀请应返回 ok')
  assertEqual(declined.match, undefined, '拒绝邀请不应返回房间')
  assertEqual(service.getMinesweeperMatch(7301, room.matchId, base + 4).players.length, 1, '拒绝后房间仍只有房主')
  const toCancel = service.createMinesweeperInviteForTest(7301, 7303, room.matchId, base + 5)
  expectThrow(
    () => service.cancelMinesweeperInvite(7304, toCancel.inviteId, base + 6),
    '邀请不存在',
    '非发起方取消邀请应 404',
  )
  assertEqual(service.cancelMinesweeperInvite(7301, toCancel.inviteId, base + 7), { ok: true }, '发起方应能取消邀请')
  assertEqual(service.listMinesweeperInvites(7301, base + 8).outgoing.length, 0, '取消后不应再有发出邀请')
  const stale = service.createMinesweeperInviteForTest(7301, 7305, room.matchId, base + 9)
  expectThrow(
    () => service.respondMinesweeperInvite(7305, stale.inviteId, 'accept', base + 9 + service.MINESWEEPER_INVITE_TTL_MS),
    '已过期',
    '过期邀请接受应 410',
  )

  // === 房间上限 4 人 ===
  const full = service.createMinesweeperRoomForTest(7311, 'u7311', [7312, 7313, 7314], base + 10)
  assertEqual(service.getMinesweeperMatch(7311, full.matchId, base + 11).players.length, 4, '建房入口应直接拉满 4 人')
  const overflow = service.createMinesweeperInviteForTest(7311, 7315, full.matchId, base + 12)
  expectThrow(
    () => service.respondMinesweeperInvite(7315, overflow.inviteId, 'accept', base + 13),
    '房间已满',
    '第 5 人接受邀请应被拒绝',
  )
  // 4 人正好是上限，应能正常开局（人数上限校验是防御性的，测试入口不会超出）
  const fullStarted = service.startMinesweeperMatch(7311, full.matchId, base + 14)
  assertEqual(fullStarted.match.status, 'playing', '4 人房间应能开局')
  assertEqual(fullStarted.match.players.length, service.MINESWEEPER_MAX_PLAYERS, '开局人数应为房间上限 4 人')
  assertEqual(
    fullStarted.match.players.map((player) => player.userId),
    [7311, 7312, 7313, 7314],
    'players 应严格按座位顺序排列',
  )

  // === 普通玩家离开不移除房间；房主离开解散 ===
  const three = service.createMinesweeperRoomForTest(7321, 'u7321', [7322, 7323], base + 15)
  const leftMember = service.leaveMinesweeperMatch(7323, three.matchId, base + 16)
  assertEqual(leftMember.dissolved, false, '普通玩家离开不应解散房间')
  assertEqual(service.getMinesweeperMatch(7321, three.matchId, base + 17).players.length, 2, '离开后房间应剩 2 人')
  expectThrow(
    () => service.leaveMinesweeperMatch(7399, three.matchId, base + 18),
    '房间不存在',
    '非参与者离开应 404',
  )
  const leftHost = service.leaveMinesweeperMatch(7321, three.matchId, base + 19)
  assertEqual(leftHost.dissolved, true, '房主离开应解散房间')
  const dissolved = service.getMinesweeperMatch(7322, three.matchId, base + 20)
  assertEqual(dissolved.status, 'finished', '解散后房间应为已结束')
  assertEqual(dissolved.reason, 'cancelled', '解散原因应为 cancelled')
  assertEqual(dissolved.winnerId, null, '解散不应有胜者')
  expectThrow(
    () => service.startMinesweeperMatch(7322, three.matchId, base + 21),
    '已经开始',
    '解散后不应能开局',
  )

  // === 认输：3 人局一人认输继续，只剩 1 人按 resign 决出胜者 ===
  const resignRoom = service.createMinesweeperRoomForTest(7331, 'u7331', [7332, 7333], base + 22, { seed: TEST_SEED + 3 })
  service.startMinesweeperMatch(7331, resignRoom.matchId, base + 23)
  const resigned = service.resignMinesweeperMatch(7332, resignRoom.matchId, base + 24)
  assertEqual(resigned.match.status, 'playing', '三人局中一人认输后对局应继续')
  assertEqual(resigned.match.players.find((player) => player.userId === 7332)!.status, 'lost', '认输玩家应为 lost')
  expectThrow(
    () => service.resignMinesweeperMatch(7332, resignRoom.matchId, base + 25),
    '你已出局',
    '重复认输应 409',
  )
  expectThrow(
    () => service.applyMinesweeperAction(7332, resignRoom.matchId, { type: 'flag', index: 0 }, base + 26),
    '你已出局或对局未开始',
    '已出局玩家操作应 409',
  )
  const lastStanding = service.resignMinesweeperMatch(7333, resignRoom.matchId, base + 27)
  assertEqual(lastStanding.match.status, 'finished', '只剩房主在场时对局应结束')
  assertEqual(lastStanding.match.reason, 'resign', '因认输决出胜者时结束原因应为 resign')
  assertEqual(lastStanding.match.winnerId, 7331, '最后在场者应获胜')

  // === 回合归属与座位循环：4 人局按座位依次轮转 ===
  service.resetMinesweeperStateForTest()
  const seatBoard = mirrorBoard(TEST_SEED + 4)
  const seatRoom = service.createMinesweeperRoomForTest(7341, 'u7341', [7342, 7343, 7344], base + 30, { seed: TEST_SEED + 4 })
  assertEqual(
    service.startMinesweeperMatch(7341, seatRoom.matchId, base + 31).match.turn!.userId,
    7341,
    '开局先手应为座位 0',
  )
  let seatDto = service.getMinesweeperMatch(7341, seatRoom.matchId, base + 32)
  const seats: number[] = [seatDto.turn!.userId]
  for (let step = 0; step < 5; step += 1) {
    const index = pickCell(seatBoard, seatDto, false)
    seatDto = service.applyMinesweeperAction(
      turnHolder(seatDto),
      seatRoom.matchId,
      { type: 'flag', index },
      base + 33 + step,
    ).match
    seats.push(seatDto.turn!.userId)
  }
  assertEqual(seats, [7341, 7342, 7343, 7344, 7341, 7342], '回合应按座位循环（2–4 人同口径）')
}

// === 服务：回合超时 / 全局超时 ===

function verifyTimeouts(): void {
  service.resetMinesweeperStateForTest()
  const base = Date.now()
  const room = service.createMinesweeperRoomForTest(7401, 'u7401', [7402], base, { seed: TEST_SEED + 5 })
  service.startMinesweeperMatch(7401, room.matchId, base)

  // === 回合超时逐个累计 skips（读取时也要按时结算） ===
  const first = service.getMinesweeperMatch(7401, room.matchId, base + service.MINESWEEPER_TURN_MS + 1_000)
  assertEqual(first.turn!.skips, 1, '一次回合超时应记 1 次 skip')
  assertEqual(first.turn!.userId, 7402, '回合应轮到下一名在场玩家')
  assertEqual(
    first.turn!.deadline,
    new Date(base + service.MINESWEEPER_TURN_MS * 2).toISOString(),
    '新回合 deadline 应由已过期的 deadline 顺延一个回合时长',
  )
  const second = service.getMinesweeperMatch(7401, room.matchId, base + service.MINESWEEPER_TURN_MS * 2 + 1_000)
  assertEqual(second.turn!.skips, 2, '第二次回合超时应累计到 2')
  assertEqual(second.turn!.userId, 7401, '回合应再轮转回座位 0')

  // 一次跨过多个回合：单次读取要连续结算多步（长时间无人操作不应只跳一格）
  const versionBefore = first.version
  const skipped = service.getMinesweeperMatch(7401, room.matchId, base + 450_000)
  assertEqual(skipped.status, 'finished', '长时间无人操作应被连续结算到淘汰')
  assertEqual(skipped.reason, 'forfeit', '未达全局时长前应先由回合超时淘汰（forfeit）')
  assertEqual(skipped.winnerId, 7402, '座位 0 第三次超时应被淘汰，由座位 1 获胜')
  assert(skipped.version > versionBefore + 2, '一次读取应连续推进多次回合超时结算')

  // === 第三次回合超时 → 淘汰当前回合玩家，只剩 1 人时 forfeit 决出胜者 ===
  service.resetMinesweeperStateForTest()
  const forfeitRoom = service.createMinesweeperRoomForTest(7411, 'u7411', [7412], base, { seed: TEST_SEED + 6 })
  service.startMinesweeperMatch(7411, forfeitRoom.matchId, base)
  const once = service.getMinesweeperMatch(7411, forfeitRoom.matchId, base + 31_000)
  assertEqual(once.turn!.skips, 1, '第一次回合超时应累计 skips')
  const twice = service.getMinesweeperMatch(7411, forfeitRoom.matchId, base + 61_000)
  assertEqual(twice.turn!.skips, 2, '第二次回合超时应累计 skips')
  const thrice = service.getMinesweeperMatch(7411, forfeitRoom.matchId, base + 91_000)
  assertEqual(thrice.status, 'finished', '第三次回合超时应淘汰当前回合玩家')
  assertEqual(thrice.reason, 'forfeit', '回合超时淘汰导致的结束原因应为 forfeit')
  assertEqual(thrice.winnerId, 7412, '30 秒处轮到座位 0（7411），故应由 7412 获胜')
  assertEqual(thrice.players.find((player) => player.userId === 7411)!.status, 'lost', '被超时淘汰的玩家应为 lost')
  assertEqual(thrice.turn, null, '结束后 turn 应为 null')

  // === 3 人局：第三次超时淘汰「当时持有回合的玩家」，仍有 2 人在场 → 对局继续 ===
  service.resetMinesweeperStateForTest()
  const threeRoom = service.createMinesweeperRoomForTest(7421, 'u7421', [7422, 7423], base, { seed: TEST_SEED + 7 })
  service.startMinesweeperMatch(7421, threeRoom.matchId, base)
  // 三次超时分别记在 7421 / 7422 / 7423 头上（skips 是当前回合的计数）
  service.getMinesweeperMatch(7421, threeRoom.matchId, base + 31_000)
  service.getMinesweeperMatch(7421, threeRoom.matchId, base + 61_000)
  const thirdAlive = service.getMinesweeperMatch(7421, threeRoom.matchId, base + 91_000)
  assertEqual(thirdAlive.status, 'playing', '三人局第三次超时淘汰一人后对局应继续')
  assertEqual(thirdAlive.players.filter((player) => player.status === 'playing').length, 2, '应只剩 2 名在场玩家')
  assertEqual(thirdAlive.players.find((player) => player.userId === 7423)!.status, 'lost', '第三次超时的持有者 7423 应被淘汰')
  assertEqual(thirdAlive.turn!.skips, 0, '淘汰后 skips 应重新计数')
  assertEqual(thirdAlive.turn!.userId, 7421, '回合应跳过被淘汰的 7423 回到座位 0')

  // === 全局超时：按翻开数判胜（制造分差），并列则平局 ===
  service.resetMinesweeperStateForTest()
  const tieBoard = mirrorBoard(TEST_SEED + 8)
  const tieRoom = service.createMinesweeperRoomForTest(7431, 'u7431', [7432], base, { seed: TEST_SEED + 8 })
  service.startMinesweeperMatch(7431, tieRoom.matchId, base)
  // 房主翻一个安全格，受邀方只插旗 → 全局超时时房主翻开数更高
  const safeIndex = pickCell(tieBoard, service.getMinesweeperMatch(7431, tieRoom.matchId, base), false)
  service.applyMinesweeperAction(7431, tieRoom.matchId, { type: 'open', index: safeIndex }, base + 1)
  const guestTurn = service.getMinesweeperMatch(7431, tieRoom.matchId, base + 2)
  const flagIndex = pickCell(tieBoard, guestTurn, true)
  service.applyMinesweeperAction(7432, tieRoom.matchId, { type: 'flag', index: flagIndex }, base + 3)
  const timedOut = service.getMinesweeperMatch(
    7431,
    tieRoom.matchId,
    base + service.MINESWEEPER_DEFAULT_DURATION_MS + 1,
  )
  assertEqual(timedOut.status, 'finished', '超过 endsAt 应由全局超时结算')
  assertEqual(timedOut.reason, 'timeout', '结束原因应为 timeout')
  assertEqual(timedOut.winnerId, 7431, '全局超时应按翻开数最高者判胜')
  assertEqual(timedOut.turn, null, '结束后不应再有回合')

  service.resetMinesweeperStateForTest()
  const zeroRoom = service.createMinesweeperRoomForTest(7441, 'u7441', [7442], base, { seed: TEST_SEED + 9 })
  service.startMinesweeperMatch(7441, zeroRoom.matchId, base)
  const tieOut = service.getMinesweeperMatch(7441, zeroRoom.matchId, base + service.MINESWEEPER_DEFAULT_DURATION_MS + 1)
  assertEqual(tieOut.reason, 'timeout', '无人操作也应由超时结算')
  assertEqual(tieOut.winnerId, null, '翻开数并列时应为平局（winnerId=null）')
  assert(tieOut.players.every((player) => player.status === 'lost'), '平局时所有玩家状态应为 lost')
}

// === 服务：掉线 / 清理回收 ===

function verifyDisconnectAndSweep(): void {
  const base = Date.now()
  service.resetMinesweeperStateForTest()

  // === 掉线超过 120 秒且对手在线 → forfeit 淘汰并决出胜者 ===
  // 房主持续操作（每次有效动作把回合超时的 skips 压回 0），
  // 这样「回合超时」不会先抢先把掉线者淘汰，验证的确实是掉线口径。
  const host = 7501
  const guest = 7502
  const activeBoard = mirrorBoard(TEST_SEED + 10)
  const room = service.createMinesweeperRoomForTest(host, `u${host}`, [guest], base, { seed: TEST_SEED + 10 })
  service.startMinesweeperMatch(host, room.matchId, base)
  let maxSkipsSeen = 0
  for (let step = 0; step <= 12; step += 1) {
    const tick = base + step * 10_000
    presence.markGamePresence(host, tick)
    const dto = service.getMinesweeperMatch(host, room.matchId, tick)
    if (dto.status !== 'playing' || dto.turn === null) break
    maxSkipsSeen = Math.max(maxSkipsSeen, dto.turn.skips)
    if (dto.turn.userId === host) {
      const index = pickCell(activeBoard, dto, false)
      service.applyMinesweeperAction(host, room.matchId, { type: 'open', index }, tick)
    }
  }
  assert(maxSkipsSeen < service.MINESWEEPER_MAX_SKIPS, '房主持续操作时回合超时不应累计到淘汰上限')
  const forfeitNow = base + service.MINESWEEPER_DISCONNECT_FORFEIT_MS + 4_000
  presence.markGamePresence(host, forfeitNow)
  const forfeited = service.getMinesweeperSync(host, room.matchId, forfeitNow)
  assertEqual(forfeited.match?.reason, 'forfeit', '掉线超过 120 秒且对手在线应记 forfeit')
  assertEqual(forfeited.match?.winnerId, host, '掉线决出胜者时应由在线者获胜')
  assertEqual(forfeited.match?.status, 'finished', '掉线决出胜者后对局应结束')
  assertEqual(
    forfeited.match!.players.find((player) => player.userId === guest)!.status,
    'lost',
    '掉线玩家应为 lost',
  )
  assert(forfeited.match!.players.find((player) => player.userId === host)!.opened > 0, '在线房主应有翻开记录')

  // === 全员不可用：掉线规则不触发（要求另一名玩家在线），由回合超时结算 ===
  service.resetMinesweeperStateForTest()
  const quietRoom = service.createMinesweeperRoomForTest(7511, 'u7511', [7512], base, { seed: TEST_SEED + 11 })
  service.startMinesweeperMatch(7511, quietRoom.matchId, base)
  const quiet = service.getMinesweeperMatch(7511, quietRoom.matchId, base + 45_000)
  assertEqual(quiet.status, 'playing', '全员掉线时不应由掉线规则提前淘汰（需另一名玩家在线）')
  assertEqual(quiet.turn!.skips, 1, '45 秒时只应累计 1 次回合超时')
  assertEqual(quiet.opened, [], '未操作时不应有已翻开格')
  const quietFinished = service.getMinesweeperMatch(7511, quietRoom.matchId, base + 95_000)
  assertEqual(quietFinished.status, 'finished', '无人操作最终应由回合超时淘汰结算')
  assertEqual(quietFinished.reason, 'forfeit', '全员掉线的结束原因应为回合超时 forfeit')
  assertEqual(quietFinished.winnerId, 7512, '座位 0 第三次超时应由座位 1 获胜')

  // === 等待房间 30 分钟未开局 → cancelled；超过保留期由 sweeper 回收 ===
  service.resetMinesweeperStateForTest()
  const waitingRoom = service.createMinesweeperRoomForTest(7521, 'u7521', [7522], base)
  const invite = service.createMinesweeperInviteForTest(7521, 7523, waitingRoom.matchId, base + 1)
  const cancelled = service.getMinesweeperMatch(
    7521,
    waitingRoom.matchId,
    base + service.MINESWEEPER_WAITING_ROOM_TTL_MS + 1,
  )
  assertEqual(cancelled.status, 'finished', '等待房间超时应结束')
  assertEqual(cancelled.reason, 'cancelled', '等待房间超时原因应为 cancelled')
  assertEqual(service.getActiveMinesweeperMatch(7521, base + 31 * 60_000), null, '解散后不应再有活跃房间')
  assertEqual(service.listMinesweeperInvites(7521, base + 2).outgoing.length, 0, '解散后相关邀请应被清理')
  expectThrow(
    () => service.respondMinesweeperInvite(7523, invite.inviteId, 'accept', base + 3),
    '邀请不存在',
    '解散后旧邀请应已清理',
  )
  const reclaimedAt = base + service.MINESWEEPER_WAITING_ROOM_TTL_MS + service.MINESWEEPER_FINISHED_RETENTION_MS + 1
  expectThrow(
    () => service.getMinesweeperMatch(7521, waitingRoom.matchId, reclaimedAt),
    '对局不存在',
    '超过保留期应由 sweeper 回收',
  )

  // === sweeper 可重复执行（幂等）+ 兜底定时器可重复启动 ===
  service.runMinesweeperSweeper(base)
  service.runMinesweeperSweeper(base)
  service.startMinesweeperTicker()
  service.startMinesweeperTicker()
  expectThrow(
    () => service.getMinesweeperMatch(7521, waitingRoom.matchId, base),
    '对局不存在',
    '已回收的房间再次查询应 404',
  )
}

// === 服务：跨游戏互斥（registerGameModule 探针 + 反向忙碌检查） ===

function verifyCrossGameMutex(): void {
  service.resetMinesweeperStateForTest()
  snake.resetSnakeStateForTest()
  const base = Date.now()
  const shared = 7601

  // === 贪吃蛇侧先占住：扫雷侧接受邀请应被拦下（isBusyInOtherGames 覆盖三个游戏） ===
  const snakeRoom = snake.createSnakeRoomForTest(7611, 'u7611', [shared], base)
  assertEqual(snake.getActiveSnakeMatch(shared, base + 1)?.status, 'waiting', '贪吃蛇侧应把 shared 拉进等待房间')
  const minesweeperRoom = service.createMinesweeperRoomForTest(7621, 'u7621', [], base)
  const blockedBySnake = service.createMinesweeperInviteForTest(7621, shared, minesweeperRoom.matchId, base + 2)
  expectThrow(
    () => service.respondMinesweeperInvite(shared, blockedBySnake.inviteId, 'accept', base + 3),
    '另一场',
    '已在贪吃蛇房间中的玩家不应能加入扫雷房间',
  )
  // 拦下的同时该邀请应被清理（与 2048 / 贪吃蛇一致：接受失败即移除，避免反复弹窗）
  assertEqual(service.listMinesweeperInvites(shared, base + 4).incoming.length, 0, '拦下时应同时清理该邀请')

  // === 斗地主侧先占住：扫雷侧接受邀请同样被拦下 ===
  snake.resetSnakeStateForTest()
  service.resetMinesweeperStateForTest()
  ddz.createDoudizhuRoomForTest(
    [{ id: shared, username: `u${shared}` }, { id: 7632, username: 'u7632' }, { id: 7633, username: 'u7633' }],
    base,
  )
  assertEqual(ddz.getActiveDoudizhuMatch(shared, base + 1)?.status, 'waiting', '斗地主侧应把 shared 拉进等待房间')
  const otherRoom = service.createMinesweeperRoomForTest(7641, 'u7641', [], base)
  const blockedByDdz = service.createMinesweeperInviteForTest(7641, shared, otherRoom.matchId, base + 2)
  expectThrow(
    () => service.respondMinesweeperInvite(shared, blockedByDdz.inviteId, 'accept', base + 3),
    '另一场',
    '已在斗地主房间中的玩家不应能加入扫雷房间',
  )

  // === 反向：已被扫雷占用时，同一个账号不应能再加入另一个扫雷房间 ===
  // （斗地主侧没有测试用的状态清空入口，这里换一批 id，避免与上面残留的房间混淆）
  service.resetMinesweeperStateForTest()
  const selfHost = 7691
  const ownRoom = service.createMinesweeperRoomForTest(selfHost, `u${selfHost}`, [7652], base, { seed: TEST_SEED + 12 })
  service.startMinesweeperMatch(selfHost, ownRoom.matchId, base)
  const secondRoom = service.createMinesweeperRoomForTest(7661, 'u7661', [], base)
  const secondInvite = service.createMinesweeperInviteForTest(7661, selfHost, secondRoom.matchId, base + 1)
  expectThrow(
    () => service.respondMinesweeperInvite(selfHost, secondInvite.inviteId, 'accept', base + 2),
    '另一场',
    '已在扫雷对局中的玩家不应能加入另一个扫雷房间',
  )

  // === sweep 钩子已挂到主 sweeper：gameService.runGameSweeper 会驱动扫雷结算 ===
  service.resetMinesweeperStateForTest()
  const quietRoom = service.createMinesweeperRoomForTest(7671, 'u7671', [7672], base)
  game.runGameSweeper(base + service.MINESWEEPER_WAITING_ROOM_TTL_MS + 1)
  const swept = service.getMinesweeperMatch(7671, quietRoom.matchId, base + service.MINESWEEPER_WAITING_ROOM_TTL_MS + 2)
  assertEqual(swept.status, 'finished', '主 sweeper 应驱动扫雷的等待房间解散')
  assertEqual(swept.reason, 'cancelled', '主 sweeper 驱动的解散原因应为 cancelled')

  snake.resetSnakeStateForTest()
  service.resetMinesweeperStateForTest()
}

async function main(): Promise<void> {
  engine = await import('../src/services/gameMinesweeper.js')
  service = await import('../src/services/gameMinesweeperService.js')
  snake = await import('../src/services/gameSnakeService.js')
  ddz = await import('../src/services/gameDoudizhuService.js')
  game = await import('../src/services/gameService.js')
  presence = await import('../src/services/gamePresence.js')

  verifyEngineBoard()
  verifyEngineAdjacency()
  verifyEngineReveal()
  verifyEngineChord()
  verifyEngineCleared()
  verifyMatchFlow()
  verifyBoomAndCleared()
  verifyInvitesLeaveAndResign()
  verifyTimeouts()
  verifyDisconnectAndSweep()
  verifyCrossGameMutex()

  // 收尾清空内存与兜底定时器（都是 unref，进程可正常退出）
  service.resetMinesweeperStateForTest()
  console.log(`✓ verify-minesweeper 全部通过（${passed} 条断言）`)
}

main().catch((error: unknown) => {
  console.error('✗ verify-minesweeper 验证失败：')
  console.error(error)
  process.exitCode = 1
})
