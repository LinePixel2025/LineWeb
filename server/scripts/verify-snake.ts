/**
 * 贪吃蛇服务端引擎 + 联机状态机自检脚本（不依赖数据库 / 网络真实流量）
 *
 * 用法: cd server && npx tsx scripts/verify-snake.ts
 *      （或 npm run verify:snake）
 *
 * 覆盖：
 *   - 引擎：同 seed 确定性、出生点布局、吃果加分与增长、撞墙 / 撞自己（含尾巴豁免）
 *     / 撞别的蛇、蛇头同格双亡、180° 反向无效、果实即时补种不重叠、over 判定与重复推进不漂移；
 *   - 服务：建房 → 邀请 → 接受 → 房主开始 → turn → 显式步进 → 死亡 → last_standing 决出胜者
 *     （每步用同输入的镜像世界核对蛇位）；邀请拒绝 / 取消 / 过期 / 开局后失效、
 *     普通玩家离开与房主解散、认输淘汰、房间上限 8 人与出生点分配、
 *     同一步全灭 elimination、超时结算（同分平局 + 按分数判胜）、
 *     掉线 forfeit 与全员掉线不淘汰、等待房间 30 分钟解散、sweep 回收。
 *
 * 说明：步进一律用 advanceSnakeMatch 显式驱动（不真的等待 SNAKE_STEP_MS × N）；
 * 邀请用测试入口直接登记，避开数据库里的好友关系校验；
 * 所有对局场景在同步代码段内跑完，220ms 房间定时器不会打断，收尾再统一回收。
 */

// 依赖模块会读 DATABASE_URL / JWT_SECRET：先给默认值再动态 import，
// Prisma 为惰性连接，只要脚本不触发真实查询就不会碰到数据库。
process.env.DATABASE_URL ||= 'file:./.verify-snake.db'
process.env.JWT_SECRET ||= 'verify-snake-secret'
process.env.NODE_ENV ||= 'development'

type SnakeEngine = typeof import('../src/services/gameSnake.js')
type SnakeService = typeof import('../src/services/gameSnakeService.js')
type PresenceModule = typeof import('../src/services/gamePresence.js')

let engine: SnakeEngine
let service: SnakeService
let presence: PresenceModule

type SnakeWorld = ReturnType<SnakeEngine['createSnakeWorld']>
type WorldPlayer = SnakeWorld['players'][number]
type Direction = Parameters<SnakeEngine['setSnakeTurn']>[2]
type Seat = Parameters<SnakeEngine['createSnakeWorld']>[1][number]
type MatchDto = ReturnType<SnakeService['getSnakeMatch']>
type PlayerDto = MatchDto['players'][number]
type Cell = { x: number; y: number }

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

const STEP_VECTORS: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
}

const key = (x: number, y: number): string => `${x},${y}`
const seatOf = (id: number, colorIndex: number, x: number, y: number, direction: Direction): Seat => ({
  id,
  colorIndex,
  x,
  y,
  direction,
})
const headOf = (player: WorldPlayer | PlayerDto): Cell => player.body[0]
const stepCell = (cell: Cell, direction: Direction): Cell => ({
  x: cell.x + STEP_VECTORS[direction].dx,
  y: cell.y + STEP_VECTORS[direction].dy,
})

/** 世界签名（同 seed + 同座位 + 同输入时应完全一致） */
function worldSignature(world: SnakeWorld): string {
  return JSON.stringify({
    step: world.step,
    over: world.over,
    players: world.players.map((player) => ({
      id: player.id,
      body: player.body,
      direction: player.direction,
      score: player.score,
      alive: player.alive,
      deathStep: player.deathStep,
    })),
    foods: world.foods,
  })
}

/** 果实应互不重叠、在地图内、且不在任何存活蛇身上 */
function assertFoodsClean(world: SnakeWorld, label: string): void {
  const bodies = new Set<string>()
  for (const player of world.players) {
    if (!player.alive) continue
    for (const cell of player.body) bodies.add(key(cell.x, cell.y))
  }
  const seen = new Set<string>()
  for (const food of world.foods) {
    assert(!seen.has(key(food.x, food.y)), `${label}：果实不应重叠`)
    seen.add(key(food.x, food.y))
    assert(!bodies.has(key(food.x, food.y)), `${label}：果实不应落在蛇身上`)
    assert(
      food.x >= 0 && food.x < world.width && food.y >= 0 && food.y < world.height,
      `${label}：果实应在地图范围内`,
    )
    assert(typeof food.big === 'boolean', `${label}：果实应标明是否金果`)
  }
}

// === 镜像世界：与服务端同座位同输入的世界（果实清空，只核对蛇头轨迹与死亡步数） ===

function createMirror(ids: number[]): SnakeWorld {
  const world = engine.createSnakeWorld(
    1,
    ids.map((id, index) => {
      const spawn = engine.SNAKE_SPAWN_POINTS[index]
      return seatOf(id, index, spawn.x, spawn.y, spawn.direction)
    }),
  )
  // 果实只影响得分与长度、不影响蛇头轨迹，清空后镜像可作为位置参考
  world.foods = []
  return world
}

/** 在场蛇的头部快照（镜像与服务端都用这个口径，避免吃果增长带来的长度差异） */
function mirrorHeads(world: SnakeWorld): Array<{ id: number; head: Cell }> {
  return world.players
    .filter((player) => player.alive)
    .map((player) => ({ id: player.id, head: headOf(player) }))
}

function dtoHeads(dto: MatchDto): Array<{ id: number; head: Cell }> {
  return dto.players
    .filter((player) => player.body.length > 0)
    .map((player) => ({ id: player.userId, head: headOf(player) }))
}

interface DriveResult {
  /** 结束时的对局 DTO（未在步数上限内结束则为 null） */
  dto: MatchDto | null
  steps: number
  /** 结束前最后一次「仍在进行」的 DTO */
  lastPlaying: MatchDto
}

/**
 * 按计划驱动对局：onStep 在每次推进前提交方向（同时提交给镜像），
 * 每步核对服务端 DTO 与镜像世界的步数 / 在场蛇头一致，直到对局结束。
 */
function driveMatch(options: {
  matchId: number
  mirror: SnakeWorld
  base: number
  viewerId: number
  maxSteps: number
  onStep: (step: number, dto: MatchDto) => void
}): DriveResult {
  let lastPlaying = service.getSnakeMatch(options.viewerId, options.matchId, options.base)
  for (let step = 1; step <= options.maxSteps; step += 1) {
    options.onStep(step, lastPlaying)
    if (options.mirror.over) break
    const now = options.base + step * engine.SNAKE_STEP_MS
    engine.stepSnakeWorld(options.mirror)
    service.advanceSnakeMatch(options.matchId, now)
    const dto = service.getSnakeMatch(options.viewerId, options.matchId, now)
    assertEqual(dto.step, options.mirror.step, `第 ${step} 步的步数应与镜像世界一致`)
    assertEqual(dtoHeads(dto), mirrorHeads(options.mirror), `第 ${step} 步的在场蛇头应与镜像世界一致`)
    if (dto.status === 'finished') return { dto, steps: step, lastPlaying }
    lastPlaying = dto
  }
  return { dto: null, steps: 0, lastPlaying }
}

/** 按计划提交方向（同时写进镜像世界），断言服务端接受 */
function steer(mirror: SnakeWorld, matchId: number, userId: number, direction: Direction, base: number): void {
  assertEqual(
    service.applySnakeAction(userId, matchId, { type: 'turn', direction }, base).applied,
    true,
    `玩家 ${userId} 应能转向 ${direction}`,
  )
  assertEqual(engine.setSnakeTurn(mirror, userId, direction), true, `镜像世界应接受转向 ${direction}`)
}

// === 引擎 ===

function verifyEngineBasics(): void {
  const seats = [
    seatOf(11, 0, 5, 5, 'right'),
    seatOf(12, 1, 19, 3, 'down'),
    seatOf(13, 2, 34, 5, 'down'),
  ]
  const world = engine.createSnakeWorld(20261029, seats)
  const same = engine.createSnakeWorld(20261029, seats)
  const other = engine.createSnakeWorld(123456789, seats)

  assertEqual(worldSignature(world), worldSignature(same), '相同 seed + 相同座位应得到完全相同的世界')
  assert(worldSignature(world) !== worldSignature(other), '不同 seed 应生成不同果实布局')
  assertEqual(world.foods.length, engine.SNAKE_FOOD_COUNT, '开局果实数应为 6')
  assert(world.step === 0 && !world.over, '新世界步数应为 0 且未结束')
  assertFoodsClean(world, '开局')

  assertEqual(headOf(world.players[0]), { x: 5, y: 5 }, '蛇身应头部在前')
  assertEqual(world.players[0].body[3], { x: 2, y: 5 }, '初始蛇身应向出生方向的反方向铺开')
  assertEqual(
    world.players.map((player) => player.body.length),
    [engine.SNAKE_START_LENGTH, engine.SNAKE_START_LENGTH, engine.SNAKE_START_LENGTH],
    '初始蛇身长度应为 4',
  )
  assertEqual(world.players.map((player) => player.colorIndex), [0, 1, 2], '配色索引应按座位分配')
  assertEqual(world.players.map((player) => player.alive), [true, true, true], '开局所有蛇都应存活')
  assertEqual(world.players.map((player) => player.score), [0, 0, 0], '开局分数应为 0')
  assertEqual(world.players.map((player) => player.deathStep), [null, null, null], '开局不应有死亡步数')

  // 8 个出生点：蛇身不越界、互不重叠、初始朝向场地中央
  const spawnOccupied = new Set<string>()
  engine.SNAKE_SPAWN_POINTS.forEach((spawn, index) => {
    const body = engine.createSnakeBody(spawn.x, spawn.y, spawn.direction)
    assertEqual(body.length, engine.SNAKE_START_LENGTH, `出生点 ${index} 初始蛇身长度应为 4`)
    for (const cell of body) {
      assert(
        cell.x >= 0 && cell.x < engine.SNAKE_MAP_WIDTH && cell.y >= 0 && cell.y < engine.SNAKE_MAP_HEIGHT,
        `出生点 ${index} 的蛇身不应越界`,
      )
      assert(!spawnOccupied.has(key(cell.x, cell.y)), `出生点 ${index} 的蛇身不应与其他出生点重叠`)
      spawnOccupied.add(key(cell.x, cell.y))
    }
    const center = { x: (engine.SNAKE_MAP_WIDTH - 1) / 2, y: (engine.SNAKE_MAP_HEIGHT - 1) / 2 }
    const distance = (cell: Cell) => Math.abs(cell.x - center.x) + Math.abs(cell.y - center.y)
    assert(
      distance(stepCell(spawn, spawn.direction)) <= distance(spawn),
      `出生点 ${index} 的初始方向应朝向场地中央`,
    )
  })
  assertEqual(engine.SNAKE_SPAWN_POINTS.length, 8, '应有 8 个固定出生点')
  assert(engine.isOppositeSnakeDirection('up', 'down'), '上下应互为反向')
  assert(!engine.isOppositeSnakeDirection('up', 'left'), '上左不应互为反向')
  assertEqual(
    {
      width: engine.SNAKE_MAP_WIDTH,
      height: engine.SNAKE_MAP_HEIGHT,
      stepMs: engine.SNAKE_STEP_MS,
      foods: engine.SNAKE_FOOD_COUNT,
      bigChance: engine.SNAKE_BIG_CHANCE,
    },
    { width: 40, height: 40, stepMs: 220, foods: 6, bigChance: 0.18 },
    '地图与步进常量应符合规格',
  )
  assertEqual(
    {
      start: engine.SNAKE_START_LENGTH,
      grow: [engine.SNAKE_GROW_NORMAL, engine.SNAKE_GROW_BIG],
      score: [engine.SNAKE_SCORE_NORMAL, engine.SNAKE_SCORE_BIG],
    },
    { start: 4, grow: [1, 3], score: [10, 30] },
    '长度 / 增长 / 得分常量应符合规格',
  )
}

function verifyEngineEatAndGrowth(): void {
  const world = engine.createSnakeWorld(424242, [
    seatOf(21, 0, 5, 5, 'right'),
    seatOf(22, 1, 34, 34, 'left'),
  ])
  // 手动布置果实，避开随机布局：正前方一格普通果、再前一格金果
  world.foods = [
    { x: 6, y: 5, big: false },
    { x: 7, y: 5, big: true },
    { x: 30, y: 30, big: false },
  ]

  const first = engine.stepSnakeWorld(world)
  assertEqual(first.events, [{ kind: 'eat', userId: 21 }], '第一步应产生普通果吃果事件')
  assertEqual(headOf(world.players[0]), { x: 6, y: 5 }, '蛇头应前进到果实格')
  assertEqual(world.players[0].score, engine.SNAKE_SCORE_NORMAL, '普通果应加 10 分')
  assertEqual(world.players[0].body.length, engine.SNAKE_START_LENGTH + 1, '普通果应增长 1 格（这一步不移除尾巴）')
  assertEqual(world.foods.length, 3, '吃掉果实后应立即补种同数量果实')
  assertFoodsClean(world, '普通果补种后')

  const second = engine.stepSnakeWorld(world)
  assert(
    second.events.some((event) => event.kind === 'eat' && event.userId === 21),
    '第二步应吃到金果',
  )
  assertEqual(world.players[0].score, engine.SNAKE_SCORE_NORMAL + engine.SNAKE_SCORE_BIG, '金果应加 30 分')
  assertEqual(
    world.players[0].body.length,
    engine.SNAKE_START_LENGTH + 1 + 3,
    '金果应一次增长 3 格（这一步不移除尾巴并复制尾格）',
  )
  assertFoodsClean(world, '金果补种后')

  // 清掉正前方路径上的补种果实，验证「不吃果时长度守恒」：每步新增一格头部并移除一格尾巴
  world.foods = world.foods.filter((food) => Math.abs(food.y - 5) > 1)
  const lengthAfterBig = world.players[0].body.length
  const tailCells = () => world.players[0].body.filter((cell) => cell.x === 2 && cell.y === 5).length
  engine.stepSnakeWorld(world)
  assertEqual(world.players[0].body.length, lengthAfterBig, '无果实时新增一格头部并移除一格尾巴，长度守恒')
  assertEqual(headOf(world.players[0]), { x: 8, y: 5 }, '蛇应继续沿当前方向前进一格')
  assertEqual(world.players[0].score, 40, '未吃到果实时分数不应变化')
  assertEqual(tailCells(), 2, '金果复制出来的尾格每步只消耗一格')
  assertFoodsClean(world, '第三步后')
  engine.stepSnakeWorld(world)
  assertEqual(tailCells(), 1, '第四步应再消耗一格复制尾巴')
  engine.stepSnakeWorld(world)
  assertEqual(tailCells(), 0, '复制的尾格应被完全消耗')
  assertEqual(world.players[0].body.length, lengthAfterBig, '尾巴消耗完后长度仍应守恒')

  // 同 seed 推进相同步数应完全一致（重复调用不产生漂移）
  const seats = [seatOf(31, 0, 5, 5, 'right'), seatOf(32, 1, 19, 3, 'down')]
  const a = engine.createSnakeWorld(777, seats)
  const b = engine.createSnakeWorld(777, seats)
  for (let index = 0; index < 5; index += 1) {
    engine.stepSnakeWorld(a)
    engine.stepSnakeWorld(b)
  }
  assertEqual(worldSignature(a), worldSignature(b), '同 seed 推进相同步数结果应完全一致')
  assertEqual(a.step, 5, '步数应等于已推进次数')
}

function verifyEngineTurnInput(): void {
  const world = engine.createSnakeWorld(31337, [
    seatOf(41, 0, 5, 5, 'right'),
    seatOf(42, 1, 34, 34, 'left'),
  ])
  assertEqual(engine.setSnakeTurn(world, 41, 'left'), false, '180° 反向提交应被拒绝')
  assertEqual(world.players[0].pendingDirection, null, '反向提交不应写入 pendingDirection')
  assertEqual(engine.setSnakeTurn(world, 41, 'up'), true, '垂直方向应被接受')
  assertEqual(world.players[0].pendingDirection, 'up', '方向应先落进 pendingDirection')
  assertEqual(engine.setSnakeTurn(world, 41, 'right'), true, '同向提交应被接受')
  assertEqual(engine.setSnakeTurn(world, 999, 'up'), false, '不存在的玩家不应被接受')

  world.players[1].alive = false
  assertEqual(engine.setSnakeTurn(world, 42, 'up'), false, '已出局的蛇不应接受方向')
  world.players[1].alive = true

  assertEqual(engine.setSnakeTurn(world, 41, 'down'), true, '再次转向应被接受')
  engine.stepSnakeWorld(world)
  assertEqual(world.players[0].direction, 'down', 'pendingDirection 应在下一步落成 direction')
  assertEqual(world.players[0].pendingDirection, null, '生效后应清空 pendingDirection')
  assertEqual(headOf(world.players[0]), { x: 5, y: 6 }, '蛇应按新方向前进一格')
}

function verifyEngineDeaths(): void {
  // === 撞墙 ===
  const wall = engine.createSnakeWorld(1, [seatOf(51, 0, 5, 5, 'right'), seatOf(52, 1, 34, 34, 'left')])
  wall.foods = []
  wall.players[0].body = [{ x: 39, y: 10 }, { x: 38, y: 10 }]
  wall.players[0].direction = 'right'
  const wallStep = engine.stepSnakeWorld(wall)
  assert(
    wallStep.events.some((event) => event.kind === 'dead' && event.userId === 51),
    '撞墙应产生 dead 事件',
  )
  assertEqual(wall.players[0].alive, false, '撞墙的蛇应死亡')
  assertEqual(wall.players[0].body, [], '死亡蛇的蛇身应清空')
  assertEqual(wall.players[0].deathStep, 0, '死亡步数应为发生死亡的那一步')
  assertEqual(wall.players[1].alive, true, '另一条蛇不应受影响')
  assertEqual(wall.over, true, '只剩一条蛇时世界应结束')
  const stepAfterWall = wall.step
  const replay = engine.stepSnakeWorld(wall)
  assertEqual(replay.events, [], '已结束的世界重复推进不应产生事件')
  assertEqual(wall.step, stepAfterWall, '已结束的世界重复推进不应产生漂移')

  // === 撞自己（非尾巴格）===
  const selfHit = engine.createSnakeWorld(1, [seatOf(61, 0, 5, 5, 'right'), seatOf(62, 1, 34, 34, 'left')])
  selfHit.foods = []
  selfHit.players[0].body = [
    { x: 10, y: 10 },
    { x: 11, y: 10 },
    { x: 11, y: 11 },
    { x: 10, y: 11 },
    { x: 9, y: 11 },
  ]
  selfHit.players[0].direction = 'down'
  const selfStep = engine.stepSnakeWorld(selfHit)
  assert(
    selfStep.events.some((event) => event.kind === 'dead' && event.userId === 61),
    '头撞到自身非尾巴格应死亡',
  )
  assertEqual(selfHit.players[0].deathStep, 0, '自撞死亡步数应为 0')

  // === 自身尾巴格豁免 ===
  const tailPass = engine.createSnakeWorld(1, [seatOf(71, 0, 5, 5, 'right'), seatOf(72, 1, 34, 34, 'left')])
  tailPass.foods = []
  tailPass.players[0].body = [
    { x: 10, y: 10 },
    { x: 9, y: 10 },
    { x: 9, y: 11 },
    { x: 10, y: 11 },
  ]
  tailPass.players[0].direction = 'down'
  const passStep = engine.stepSnakeWorld(tailPass)
  assertEqual(
    passStep.events.filter((event) => event.kind === 'dead').length,
    0,
    '蛇头进入自身将被移除的尾巴格不应判死',
  )
  assertEqual(tailPass.players[0].alive, true, '尾巴格豁免后应继续存活')
  assertEqual(headOf(tailPass.players[0]), { x: 10, y: 11 }, '尾巴格豁免：蛇头应落到尾巴原位置')

  // === 撞别的蛇 ===
  const otherHit = engine.createSnakeWorld(1, [seatOf(81, 0, 5, 5, 'right'), seatOf(82, 1, 34, 34, 'left')])
  otherHit.foods = []
  otherHit.players[0].body = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }]
  otherHit.players[0].direction = 'right'
  otherHit.players[1].body = [{ x: 11, y: 10 }, { x: 11, y: 11 }]
  otherHit.players[1].direction = 'up'
  const otherStep = engine.stepSnakeWorld(otherHit)
  assert(
    otherStep.events.some((event) => event.kind === 'dead' && event.userId === 81),
    '头撞到其他蛇身体应死亡',
  )
  assertEqual(otherHit.players[1].alive, true, '被撞的蛇不应因此死亡')
  assertEqual(headOf(otherHit.players[1]), { x: 11, y: 9 }, '被撞的蛇应正常前进一格')
  assertEqual(otherHit.over, true, '只剩一条蛇时世界应结束')

  // === 两只蛇头同一步进入同一格 → 双方都死亡 ===
  const clash = engine.createSnakeWorld(1, [seatOf(91, 0, 5, 5, 'right'), seatOf(92, 1, 34, 34, 'left')])
  clash.foods = []
  clash.players[0].body = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }]
  clash.players[0].direction = 'right'
  clash.players[1].body = [{ x: 11, y: 9 }, { x: 11, y: 8 }]
  clash.players[1].direction = 'down'
  const clashStep = engine.stepSnakeWorld(clash)
  assertEqual(
    clashStep.events.filter((event) => event.kind === 'dead').map((event) => event.userId).sort(),
    [91, 92],
    '蛇头同格进入应双方都死亡',
  )
  assertEqual(clash.players.map((player) => player.alive), [false, false], '双头相撞后两条蛇都应出局')
  assertEqual(clash.over, true, '全部死亡时世界应结束')
  assertEqual(clash.players.map((player) => player.deathStep), [0, 0], '同一步死亡应记录相同死亡步数')
}

// === 服务：建房 → 邀请 → 接受 → 开始 → turn → 步进 → 死亡 → 决出胜者 ===

function verifyMatchFlow(): void {
  service.resetSnakeStateForTest()
  const base = Date.now()
  const duration = service.SNAKE_DEFAULT_DURATION_MS
  const HOST = 6101
  const GUEST = 6102
  const OUTSIDER = 6103

  const { matchId } = service.createSnakeRoomForTest(HOST, `u${HOST}`)
  const waiting = service.getSnakeMatch(HOST, matchId, base)
  assertEqual(waiting.game, 'snake', '对局 DTO 的 game 应为 snake（前端据此判别游戏）')
  assertEqual(waiting.status, 'waiting', '新建房间应为等待状态')
  assertEqual(waiting.players.length, 1, '等待房间应只有房主')
  assertEqual(waiting.step, 0, '等待房间步数应为 0')
  assertEqual(waiting.foods, [], '等待房间不生成果实')
  assertEqual(
    waiting.board,
    { width: engine.SNAKE_MAP_WIDTH, height: engine.SNAKE_MAP_HEIGHT },
    'DTO 应给出大地图尺寸',
  )
  assertEqual(waiting.stepMs, engine.SNAKE_STEP_MS, 'DTO 应给出服务端步进间隔')
  assertEqual(waiting.remainingMs, service.SNAKE_WAITING_ROOM_TTL_MS, '等待房间 remainingMs 应为房间剩余时间')
  assertEqual(waiting.players[0].colorIndex, 0, '房主座位配色索引应为 0')
  assertEqual(waiting.players[0].body, [], '开局前不应有蛇身')
  assertEqual(waiting.players[0].length, 0, '开局前长度应为 0')
  assertEqual(waiting.players[0].direction, engine.SNAKE_SPAWN_POINTS[0].direction, '开局前应给出出生朝向')
  assertEqual(waiting.players[0].pendingDirection, null, '开局前不应有 pending 方向')
  assertEqual(waiting.players[0].deathStep, null, '开局前不应有死亡步数')
  expectThrow(() => service.startSnakeMatch(HOST, matchId, base), '至少需要 2', '1 人房间开局应被拒绝')
  expectThrow(
    () => service.applySnakeAction(HOST, matchId, { type: 'turn', direction: 'up' }, base),
    '未开始',
    '等待房间提交方向应 409',
  )

  // === 邀请 → 接受 ===
  const invite = service.createSnakeInviteForTest(HOST, GUEST, matchId, base + 1)
  const incoming = service.listSnakeInvites(GUEST, base + 2)
  assertEqual(incoming.incoming.length, 1, '受邀方应看到 1 条待处理邀请')
  assertEqual(incoming.incoming[0].game, 'snake', '邀请 DTO 的 game 应为 snake')
  assertEqual(incoming.incoming[0].matchId, matchId, '邀请应指向房主的等待房间')
  assertEqual(incoming.incoming[0].expiresAt, new Date(base + 1 + service.SNAKE_INVITE_TTL_MS).toISOString(), '邀请有效期应为 60 秒')
  assertEqual(incoming.outgoing.length, 0, '受邀方不应有发出邀请')
  expectThrow(
    () => service.respondSnakeInvite(OUTSIDER, invite.inviteId, 'accept', base + 3),
    '邀请不存在',
    '非受邀方响应邀请应 404',
  )
  const accepted = service.respondSnakeInvite(GUEST, invite.inviteId, 'accept', base + 4)
  assertEqual(accepted.ok, true, '接受邀请应返回 ok')
  assert(accepted.match !== undefined, '接受邀请应返回加入的房间')
  assertEqual(accepted.match!.players.length, 2, '接受邀请后房间应有 2 人')
  assertEqual(accepted.match!.players[1].colorIndex, 1, '第二位玩家配色索引应为 1')
  assertEqual(service.listSnakeInvites(GUEST, base + 5).incoming.length, 0, '接受后邀请应被清理')
  expectThrow(
    () => service.respondSnakeInvite(GUEST, invite.inviteId, 'accept', base + 6),
    '邀请不存在',
    '重复接受同一邀请应 404',
  )
  const stale = service.createSnakeInviteForTest(HOST, OUTSIDER, matchId, base + 7)
  expectThrow(
    () => service.respondSnakeInvite(OUTSIDER, stale.inviteId, 'accept', base + 7 + duration),
    '已过期',
    '过期邀请接受应 410',
  )

  expectThrow(() => service.startSnakeMatch(GUEST, matchId, base + 8), '房主', '非房主开局应被拒绝')
  const started = service.startSnakeMatch(HOST, matchId, base + 9)
  assertEqual(started.match.status, 'playing', '房主开始后应进入进行中对局')
  assertEqual(started.match.players.length, 2, '对局应有 2 名玩家')
  assertEqual(started.match.foods.length, engine.SNAKE_FOOD_COUNT, '开局应布置 6 个果实')
  assertEqual(started.match.step, 0, '开局步数应为 0')
  assertEqual(started.match.lastEvent, null, '开局不应有事件')
  assertEqual(started.match.players[0].userId, HOST, 'players 应按座位顺序排列')
  assert(
    started.match.players.every((player) => player.body.length === engine.SNAKE_START_LENGTH),
    '开局每条蛇应有 4 格蛇身',
  )
  assert(
    started.match.players.every((player) => player.status === 'playing'),
    '开局后玩家状态应为 playing',
  )
  assertEqual(started.match.startedAt, new Date(base + 9).toISOString(), 'startedAt 应为开局时间')
  assertEqual(
    started.match.endsAt,
    new Date(base + 9 + duration).toISOString(),
    'endsAt 应为开局时间 + 默认 5 分钟',
  )
  assertEqual(started.match.remainingMs, duration, 'remainingMs 应由服务端算好')
  expectThrow(
    () => service.startSnakeMatch(HOST, matchId, base + 10),
    '已经开始',
    '重复开局应 409',
  )

  // === 反向输入宽容语义：不写 pending、不递增版本、不广播 ===
  const beforeTurn = service.getSnakeMatch(HOST, matchId, base + 11)
  const reversed = service.applySnakeAction(HOST, matchId, { type: 'turn', direction: 'left' }, base + 12)
  assertEqual(reversed.applied, false, '180° 反向应返回 applied=false')
  assertEqual(reversed.match.version, beforeTurn.version, '反向输入不应递增版本')
  assertEqual(reversed.match.players[0].pendingDirection, null, '反向输入不应写入 pendingDirection')
  const turned = service.applySnakeAction(HOST, matchId, { type: 'turn', direction: 'up' }, base + 13)
  assertEqual(turned.applied, true, '垂直方向应被接受')
  assertEqual(turned.match.players[0].pendingDirection, 'up', '合法方向应写入 pendingDirection')
  assert(turned.match.version > beforeTurn.version, '合法转向应递增版本并广播')
  expectThrow(
    () => service.applySnakeAction(OUTSIDER, matchId, { type: 'turn', direction: 'up' }, base + 14),
    '对局不存在',
    '非参与者提交方向应 404',
  )
  expectThrow(() => service.getSnakeMatch(OUTSIDER, matchId, base + 14), '对局不存在', '非参与者查询对局应 404')

  // === 显式推进：房主向上（第 6 步撞顶墙），受邀方左转（一路向左，第 6 步仍在场） ===
  const mirror = createMirror([HOST, GUEST])
  const driven = driveMatch({
    matchId,
    mirror,
    base: base + 9,
    viewerId: HOST,
    maxSteps: 30,
    onStep: (step) => {
      if (step === 1) {
        // 房主的方向在服务侧已提交（上面的合法转向断言），镜像只需补写同一次输入
        assertEqual(engine.setSnakeTurn(mirror, HOST, 'up'), true, '镜像世界应接受房主向上')
        steer(mirror, matchId, GUEST, 'left', base + 9)
      }
    },
  })
  assert(driven.dto !== null, '对局应在有限步数内因只剩一名存活玩家而结束')
  const finished = driven.dto!
  assertEqual(driven.steps, 6, '房主应向上 6 步后撞顶墙')
  assertEqual(finished.reason, 'last_standing', '只剩一名存活玩家应以 last_standing 结束')
  assertEqual(finished.winnerId, GUEST, '最后存活者应获胜')
  assertEqual(finished.step, driven.steps, '结束时的步数应与推进次数一致')
  const hostDto = finished.players.find((player) => player.userId === HOST)!
  const guestDto = finished.players.find((player) => player.userId === GUEST)!
  assertEqual(hostDto.status, 'lost', '撞墙玩家应为 lost')
  assertEqual(hostDto.body, [], '死亡玩家蛇身应清空')
  assertEqual(hostDto.length, 0, '死亡玩家长度应为 0')
  assertEqual(hostDto.deathStep, driven.steps - 1, '死亡步数应为发生死亡的那一步')
  assertEqual(guestDto.status, 'won', '存活玩家应为 won')
  assertEqual(
    finished.lastEvent,
    { kind: 'dead', userId: HOST, step: driven.steps - 1 },
    '最后事件应为死亡播报',
  )
  assert(
    finished.players.every((player) => typeof player.online === 'boolean'),
    'DTO 应给出玩家在线状态',
  )

  // === 结束后：补拉、409、主动查询为 null ===
  expectThrow(
    () => service.applySnakeAction(GUEST, matchId, { type: 'turn', direction: 'up' }, base + 9),
    '已结束',
    '已结束对局提交方向应 409',
  )
  expectThrow(() => service.resignSnakeMatch(GUEST, matchId, base + 9), '已结束', '已结束对局认输应 409')
  const sync = service.getSnakeSync(HOST, matchId, base + 9)
  assertEqual(sync.serverTime, new Date(base + 9).toISOString(), 'sync 应返回服务端时间')
  assertEqual(sync.match?.id, matchId, 'sync 指定 matchId 时应返回该对局（含结束后补拉）')
  assertEqual(sync.invites.incoming, [], 'sync 应携带邀请结构 incoming')
  assertEqual(sync.invites.outgoing, [], 'sync 应携带邀请结构 outgoing')
  assertEqual(service.getSnakeSync(HOST, undefined, base + 9).match, null, '不带 matchId 的 sync 不应返回已结束对局')
  assertEqual(service.getActiveSnakeMatch(HOST, base + 9), null, '主动查询不应返回已结束对局')
  // 新语义：对局已结束（本人 won/lost）后允许退出房间，仅清理残留座位
  const leftAfterFinish = service.leaveSnakeMatch(GUEST, matchId, base + 9)
  assertEqual(leftAfterFinish.ok, true, '对局结束后允许退出房间')
  assertEqual(leftAfterFinish.dissolved, false, '结束后退出不应解散已结束房间')
}

// === 服务：邀请边缘流程 / 离开 / 认输 ===

function verifyInvitesAndLeaveAndResign(): void {
  service.resetSnakeStateForTest()
  const base = Date.now()

  // === 拒绝 / 取消邀请 ===
  const room = service.createSnakeRoomForTest(6201, 'u6201', [], base)
  const declinedInvite = service.createSnakeInviteForTest(6201, 6202, room.matchId, base + 1)
  assertEqual(service.listSnakeInvites(6201, base + 2).outgoing.length, 1, '发起方应看到 1 条发出邀请')
  const declined = service.respondSnakeInvite(6202, declinedInvite.inviteId, 'decline', base + 3)
  assertEqual(declined.ok, true, '拒绝邀请应返回 ok')
  assertEqual(declined.match, undefined, '拒绝邀请不应返回房间')
  assertEqual(service.getSnakeMatch(6201, room.matchId, base + 4).players.length, 1, '拒绝后房间仍只有房主')
  assertEqual(service.listSnakeInvites(6201, base + 5).outgoing.length, 0, '拒绝后邀请应被清理')
  const toCancel = service.createSnakeInviteForTest(6201, 6203, room.matchId, base + 6)
  expectThrow(
    () => service.cancelSnakeInvite(6204, toCancel.inviteId, base + 7),
    '邀请不存在',
    '非发起方取消邀请应 404',
  )
  assertEqual(service.cancelSnakeInvite(6201, toCancel.inviteId, base + 8), { ok: true }, '发起方应能取消邀请')
  assertEqual(service.listSnakeInvites(6201, base + 9).outgoing.length, 0, '取消后不应再有发出邀请')
  assertEqual(service.listSnakeInvites(6203, base + 10).incoming.length, 0, '取消后被邀请方也不应有邀请')

  // === 普通玩家离开不移除房间；房主离开解散 ===
  const full = service.createSnakeRoomForTest(6211, 'u6211', [6212, 6213, 6214], base + 11)
  assertEqual(
    service.getSnakeMatch(6211, full.matchId, base + 12).players.length,
    4,
    '建房入口应直接拉入 4 名玩家',
  )
  const leftMember = service.leaveSnakeMatch(6214, full.matchId, base + 13)
  assertEqual(leftMember.dissolved, false, '普通玩家离开不应解散房间')
  assertEqual(
    service.getSnakeMatch(6212, full.matchId, base + 14).players.length,
    3,
    '离开后房间应剩 3 人',
  )
  expectThrow(
    () => service.leaveSnakeMatch(6299, full.matchId, base + 15),
    '房间不存在',
    '非参与者离开应 404',
  )
  const started = service.startSnakeMatch(6211, full.matchId, base + 16)
  assertEqual(started.match.status, 'playing', '3 人房间应能开局')
  expectThrow(
    () => service.leaveSnakeMatch(6211, full.matchId, base + 17),
    '对局进行中',
    '开局后房主不能直接离开房间（须先认输）',
  )

  // === 认输淘汰：仍有 2 人存活时继续，只剩 1 人时按 resign 结束 ===
  const resigned = service.resignSnakeMatch(6213, full.matchId, base + 18)
  assertEqual(resigned.match.status, 'playing', '三人局中一人认输后对局应继续')
  const loser = resigned.match.players.find((player) => player.userId === 6213)!
  assertEqual(loser.status, 'lost', '认输玩家应为 lost')
  assertEqual(loser.body, [], '认输玩家蛇身应清空')
  assertEqual(loser.deathStep, 0, '未推进任何一步时认输死亡步数应为 0')
  assertEqual(resigned.match.lastEvent, { kind: 'dead', userId: 6213, step: 0 }, '认输应记录死亡事件')
  expectThrow(
    () => service.resignSnakeMatch(6213, full.matchId, base + 19),
    '你已出局',
    '重复认输应 409',
  )
  expectThrow(
    () => service.applySnakeAction(6213, full.matchId, { type: 'turn', direction: 'up' }, base + 20),
    '你已出局或对局未开始',
    '已出局玩家提交方向应 409',
  )
  const hostWins = service.resignSnakeMatch(6212, full.matchId, base + 21)
  assertEqual(hostWins.match.status, 'finished', '只剩房主存活时对局应结束')
  assertEqual(hostWins.match.reason, 'resign', '因认输决出胜者时结束原因应为 resign')
  assertEqual(hostWins.match.winnerId, 6211, '最后存活者应获胜')
  assertEqual(
    hostWins.match.players.find((player) => player.userId === 6212)!.status,
    'lost',
    '认输玩家应为 lost',
  )

  // === 开局后旧邀请失效（房间已开始） ===
  const startedRoom = service.createSnakeRoomForTest(6221, 'u6221', [6222], base + 22)
  service.startSnakeMatch(6221, startedRoom.matchId, base + 23)
  const lateInvite = service.createSnakeInviteForTest(6221, 6223, startedRoom.matchId, base + 24)
  expectThrow(
    () => service.respondSnakeInvite(6223, lateInvite.inviteId, 'accept', base + 25),
    '房间已开始',
    '开局后接受旧邀请应 409',
  )

  // === 已在其他房间的玩家不能被拉入另一房间 ===
  const busyRoom = service.createSnakeRoomForTest(6231, 'u6231', [], base + 26)
  const busyInvite = service.createSnakeInviteForTest(6241, 6231, busyRoom.matchId, base + 27)
  expectThrow(
    () => service.respondSnakeInvite(6231, busyInvite.inviteId, 'accept', base + 28),
    '另一场',
    '已有房间的玩家接受邀请应 409',
  )
}

// === 服务：房间上限与出生点分配 ===

function verifyRoomCapacity(): void {
  service.resetSnakeStateForTest()
  const base = Date.now()
  const host = 6301
  const members = [6302, 6303, 6304, 6305, 6306, 6307, 6308]
  const room = service.createSnakeRoomForTest(host, `u${host}`, members, base)
  const roster = service.getSnakeMatch(host, room.matchId, base)
  assertEqual(roster.players.length, service.SNAKE_MAX_PLAYERS, '房间上限应为 8 人')
  assertEqual(
    roster.players.map((player) => player.colorIndex),
    [0, 1, 2, 3, 4, 5, 6, 7],
    '配色索引应按座位 0–7 分配',
  )
  const overflow = service.createSnakeInviteForTest(host, 6309, room.matchId, base + 1)
  expectThrow(
    () => service.respondSnakeInvite(6309, overflow.inviteId, 'accept', base + 2),
    '房间已满',
    '第 9 人接受邀请应被拒绝',
  )

  const started = service.startSnakeMatch(host, room.matchId, base + 3)
  assertEqual(started.match.players.length, 8, '开始后 8 人都应进入对局')
  assertEqual(
    started.match.players.map((player) => player.body[0]),
    engine.SNAKE_SPAWN_POINTS.map((spawn) => ({ x: spawn.x, y: spawn.y })),
    '8 个固定出生点应按座位顺序分配',
  )
  assertEqual(
    started.match.players.map((player) => player.direction),
    engine.SNAKE_SPAWN_POINTS.map((spawn) => spawn.direction),
    '初始方向应取自出生点朝向',
  )
  const uniqueHeads = new Set(started.match.players.map((player) => key(player.body[0].x, player.body[0].y)))
  assertEqual(uniqueHeads.size, 8, '各蛇头部位置应互不重叠')
  assertEqual(started.match.players.map((player) => player.colorIndex), [0, 1, 2, 3, 4, 5, 6, 7], '开局后配色索引不变')
}

// === 服务：结束判定（超时 / 全灭） ===

/** 按存活玩家分数算出应有胜者（并列返回 null），与结算口径一致 */
function expectedWinnerByScore(dto: MatchDto): number | null {
  const alive = dto.players.filter((player) => player.status === 'playing')
  const pool = alive.length > 0 ? alive : dto.players
  const top = Math.max(...pool.map((player) => player.score))
  const leaders = pool.filter((player) => player.score === top)
  return leaders.length === 1 ? leaders[0].userId : null
}

function verifyTimeoutAndElimination(): void {
  const base = Date.now()
  const duration = service.SNAKE_DEFAULT_DURATION_MS

  // === 超时（不推进任何步）：同分 → 平局 ===
  service.resetSnakeStateForTest()
  const tieRoom = service.createSnakeRoomForTest(6401, 'u6401', [6402], base)
  service.startSnakeMatch(6401, tieRoom.matchId, base)
  const tie = service.getSnakeMatch(6401, tieRoom.matchId, base + duration + 1)
  assertEqual(tie.status, 'finished', '超过 endsAt 应由 sweeper 结算为已结束')
  assertEqual(tie.reason, 'timeout', '超时结束原因应为 timeout')
  assertEqual(tie.winnerId, null, '超时同分应为平局')
  assert(tie.players.every((player) => player.status === 'lost'), '平局时所有玩家状态应为 lost')
  assertEqual(tie.remainingMs, 0, '超时后 remainingMs 应为 0')

  // === 两条蛇同一步撞墙 → elimination（按分数，同分则平局） ===
  service.resetSnakeStateForTest()
  const host = 6411
  const guest = 6412
  const elimRoom = service.createSnakeRoomForTest(host, `u${host}`, [guest], base)
  assertEqual(service.startSnakeMatch(host, elimRoom.matchId, base).match.status, 'playing', '两人局应能开局')
  // 布局：房主先向下 14 步（沿 x=5），再向左 6 步撞左墙（第 20 步）；
  // 受邀方第 1 步即向左，沿 y=3 走 19 步撞左墙（第 20 步）——两条走廊不相交，
  // 撞墙时点与吃果增长无关，因此必然同一步全灭。
  const mirror = createMirror([host, guest])
  const driven = driveMatch({
    matchId: elimRoom.matchId,
    mirror,
    base,
    viewerId: host,
    maxSteps: 24,
    onStep: (step) => {
      if (step === 1) {
        steer(mirror, elimRoom.matchId, host, 'down', base)
        steer(mirror, elimRoom.matchId, guest, 'left', base)
      }
      if (step === 15) steer(mirror, elimRoom.matchId, host, 'left', base)
    },
  })
  assert(driven.dto !== null, '两条蛇应在第 20 步同时撞左墙而结束对局')
  assertEqual(driven.steps, 20, '结束应发生在第 20 步')
  assertEqual(driven.dto!.reason, 'elimination', '全部同一步死亡应以 elimination 结束')
  assertEqual(
    driven.dto!.winnerId,
    expectedWinnerByScore(driven.lastPlaying),
    '全灭时应按分数最高者判胜（同分平局）',
  )
  assert(
    driven.lastPlaying.players.every((player) => player.status === 'playing'),
    '结束前两条蛇都应仍存活（同一步死亡）',
  )
  assertEqual(
    driven.dto!.players.map((player) => player.deathStep),
    [19, 19],
    '同一步死亡的蛇应记录相同死亡步数',
  )

  // === 超时按分数判定（贪心追果制造分差；seed 随机，最多重试若干次） ===
  assert(verifyTimeoutByScore(base), '超时结算应覆盖“存活玩家按分数判定胜者”')
}

function verifyTimeoutByScore(base: number): boolean {
  const host = 6501
  const guest = 6502
  for (let attempt = 0; attempt < 8; attempt += 1) {
    service.resetSnakeStateForTest()
    const room = service.createSnakeRoomForTest(host, `u${host}`, [guest], base)
    let dto = service.startSnakeMatch(host, room.matchId, base).match
    for (let step = 1; step <= 150; step += 1) {
      const alive = dto.players.filter((player) => player.status === 'playing')
      if (alive.length === dto.players.length && dto.players.some((player) => player.score > 0)) {
        // 两条蛇都在场且已有人得分 → 触发超时结算
        const settled = service.getSnakeMatch(host, room.matchId, base + service.SNAKE_DEFAULT_DURATION_MS + 1)
        if (settled.reason !== 'timeout') return false
        assertEqual(settled.status, 'finished', '超时后对局应结束')
        assert(
          dto.players.some((player) => player.score > 0),
          '参与超时判定的玩家应已产生非零分数',
        )
        assertEqual(
          settled.winnerId,
          expectedWinnerByScore(dto),
          '超时应按存活玩家最高分判定胜者（同分平局）',
        )
        return true
      }
      for (const player of alive) {
        const turn = player.userId === host ? turnTowardFood(dto, player) : turnKeepAlive(dto, player)
        if (turn !== null) service.applySnakeAction(player.userId, room.matchId, { type: 'turn', direction: turn }, base)
      }
      const now = base + step * engine.SNAKE_STEP_MS
      if (!service.advanceSnakeMatch(room.matchId, now)) break
      dto = service.getSnakeMatch(host, room.matchId, now)
    }
  }
  return false
}

// === 服务：掉线与清理 ===

function verifyDisconnectAndSweep(): void {
  const base = Date.now()
  service.resetSnakeStateForTest()

  // === 掉线超过 120 秒且对手可用 → forfeit 淘汰 ===
  const host = 6601
  const guest = 6602
  const forfeitNow = base + service.SNAKE_DISCONNECT_FORFEIT_MS + 1_000
  const room = service.createSnakeRoomForTest(host, `u${host}`, [guest], base)
  service.startSnakeMatch(host, room.matchId, base)
  // 只有房主上报心跳（presence 用与 sweeper 相同的时刻登记，便于验证 TTL）
  presence.markGamePresence(host, forfeitNow)
  const forfeited = service.getSnakeSync(host, room.matchId, forfeitNow)
  assertEqual(forfeited.match?.reason, 'forfeit', '掉线超过 120 秒且对手可用应记 forfeit')
  assertEqual(forfeited.match?.winnerId, host, '掉线决出胜者时应由在线者获胜')
  assertEqual(forfeited.match?.status, 'finished', '掉线决出胜者后对局应结束')
  const dropout = forfeited.match!.players.find((player) => player.userId === guest)!
  assertEqual(dropout.status, 'lost', '掉线玩家应为 lost')
  assertEqual(dropout.body, [], '掉线玩家蛇身应清空')
  assertEqual(service.getActiveSnakeMatch(host, forfeitNow + 1), null, '结束后主动查询应为 null')

  // === 全员不可用：不提前淘汰，留给超时结算 ===
  service.resetSnakeStateForTest()
  const quietHost = 6611
  const quietGuest = 6612
  const quietRoom = service.createSnakeRoomForTest(quietHost, `u${quietHost}`, [quietGuest], base)
  service.startSnakeMatch(quietHost, quietRoom.matchId, base)
  const stillPlaying = service.getSnakeMatch(quietHost, quietRoom.matchId, base + 130_000)
  assertEqual(stillPlaying.status, 'playing', '全员掉线不应提前淘汰玩家')
  assertEqual(stillPlaying.step, 0, '未推进时步数应为 0')
  const allOffline = service.getSnakeMatch(
    quietHost,
    quietRoom.matchId,
    base + service.SNAKE_DEFAULT_DURATION_MS + 1,
  )
  assertEqual(allOffline.reason, 'timeout', '全员掉线应由超时结算')
  assertEqual(allOffline.winnerId, null, '全员掉线同分应为平局')

  // === 等待房间 30 分钟未开局 → cancelled；超过保留期由 sweeper 回收 ===
  service.resetSnakeStateForTest()
  const waitingRoom = service.createSnakeRoomForTest(6621, 'u6621', [6622], base)
  const invite = service.createSnakeInviteForTest(6621, 6623, waitingRoom.matchId, base + 1)
  const cancelled = service.getSnakeMatch(
    6621,
    waitingRoom.matchId,
    base + service.SNAKE_WAITING_ROOM_TTL_MS + 1,
  )
  assertEqual(cancelled.status, 'finished', '等待房间超时应结束')
  assertEqual(cancelled.reason, 'cancelled', '等待房间超时原因应为 cancelled')
  assertEqual(cancelled.winnerId, null, '解散不应有胜者')
  assertEqual(service.getActiveSnakeMatch(6621, base + 31 * 60_000), null, '解散后不应再有活跃房间')
  assertEqual(service.listSnakeInvites(6621, base + 2).outgoing.length, 0, '解散后相关邀请应被清理')
  expectThrow(
    () => service.respondSnakeInvite(6623, invite.inviteId, 'accept', base + 3),
    '邀请不存在',
    '解散后旧邀请应已清理',
  )
  const reclaimedAt =
    base + service.SNAKE_WAITING_ROOM_TTL_MS + service.SNAKE_FINISHED_RETENTION_MS + 1
  expectThrow(
    () => service.getSnakeMatch(6621, waitingRoom.matchId, reclaimedAt),
    '对局不存在',
    '超过保留期应由 sweeper 回收',
  )

  // === sweeper 可重复执行（幂等）+ 兜底定时器可重复启动 ===
  service.runSnakeSweeper(base)
  service.runSnakeSweeper(base)
  service.startSnakeTicker()
  service.startSnakeTicker()
  expectThrow(
    () => service.getSnakeMatch(6621, waitingRoom.matchId, base),
    '对局不存在',
    '已回收的房间再次查询应 404',
  )
}

// === 简单转向启发式（只读 DTO，供超时制造分差的场景使用） ===

function chooseTurn(dto: MatchDto, player: PlayerDto, target: Cell | null): Direction | null {
  const head = headOf(player)
  const blocked = new Set<string>()
  for (const other of dto.players) {
    if (other.userId === player.userId) continue
    for (const cell of other.body) blocked.add(key(cell.x, cell.y))
  }
  const goal = target ?? { x: Math.floor(dto.board.width / 2), y: Math.floor(dto.board.height / 2) }
  // 固定候选顺序保证确定性：优先直行，其次 right → down → left → up
  const candidates: Direction[] = [player.direction, 'right', 'down', 'left', 'up']
  let best: Direction | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const direction of candidates) {
    if (engine.isOppositeSnakeDirection(player.direction, direction)) continue
    const next = stepCell(head, direction)
    if (next.x < 0 || next.y < 0 || next.x >= dto.board.width || next.y >= dto.board.height) continue
    if (blocked.has(key(next.x, next.y))) continue
    const distance = Math.abs(next.x - goal.x) + Math.abs(next.y - goal.y)
    const score = target === null
      ? direction === player.direction
        ? 0
        : 1_000 + distance
      : distance + (direction === player.direction ? 0 : 0.1)
    if (score < bestScore) {
      bestScore = score
      best = direction
    }
  }
  return best
}

function turnTowardFood(dto: MatchDto, player: PlayerDto): Direction | null {
  const head = headOf(player)
  let nearest: Cell | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const food of dto.foods) {
    const distance = Math.abs(food.x - head.x) + Math.abs(food.y - head.y)
    if (distance < bestDistance) {
      bestDistance = distance
      nearest = { x: food.x, y: food.y }
    }
  }
  return chooseTurn(dto, player, nearest)
}

function turnKeepAlive(dto: MatchDto, player: PlayerDto): Direction | null {
  return chooseTurn(dto, player, null)
}

async function main(): Promise<void> {
  engine = await import('../src/services/gameSnake.js')
  service = await import('../src/services/gameSnakeService.js')
  presence = await import('../src/services/gamePresence.js')

  verifyEngineBasics()
  verifyEngineEatAndGrowth()
  verifyEngineTurnInput()
  verifyEngineDeaths()
  verifyMatchFlow()
  verifyInvitesAndLeaveAndResign()
  verifyRoomCapacity()
  verifyTimeoutAndElimination()
  verifyDisconnectAndSweep()

  // 收尾清空内存与定时器：房间步进定时器都是 unref，进程可正常退出
  service.resetSnakeStateForTest()
  console.log(`✓ verify-snake 全部通过（${passed} 条断言）`)
}

main().catch((error: unknown) => {
  console.error('✗ verify-snake 验证失败：')
  console.error(error)
  process.exitCode = 1
})
