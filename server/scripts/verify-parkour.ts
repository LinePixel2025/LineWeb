/**
 * 霓虹跑酷引擎 + 联机状态机自检脚本（不依赖数据库 / 网络真实流量）
 *
 * 用法: cd server && npx tsx scripts/verify-parkour.ts
 *
 * 覆盖：
 *   - 引擎：三车道常量、同 seed 确定性、速度曲线、换道横移、跳跃 / 土狼时间 /
 *     输入缓冲、滑铲、护盾、一次撞击出局、掉坑、列车 / 低障 / 悬空牌 / 坑洞碰撞、
 *     金币 / 磁铁 / 冲刺、分数、800m 冲线、刷新恢复。
 *   - 关卡：首段净空、列车不同时占满三车道、行间距、道具不落入障碍、贪心机器人
 *     多 seed × 800m 零碰撞。
 *   - 联机服务：在服务端实现完成后追加（建房 / 邀请 / 进度钳制 / 排名 / 超时 / 掉线 / 互斥）。
 *
 * 说明：时间一律用显式 now 参数驱动；引擎按固定 1/60s 步进。
 */

process.env.DATABASE_URL ||= 'file:./.verify-parkour.db'
process.env.JWT_SECRET ||= 'verify-parkour-secret'
process.env.NODE_ENV ||= 'development'

type ParkourEngine = typeof import('../src/services/gameParkour.js')
type ParkourRun = ReturnType<ParkourEngine['createParkourRun']>
type ParkourService = typeof import('../src/services/gameParkourService.js')
type ParkourMatchDto = ReturnType<ParkourService['getParkourMatch']>
type GameService = typeof import('../src/services/gameService.js')
type PresenceModule = typeof import('../src/services/gamePresence.js')

let engine: ParkourEngine
let service: ParkourService
let game: GameService
let presence: PresenceModule

let passed = 0
let serviceNow = Date.now()

function advance(ms = 1_000): number {
  serviceNow += ms
  return serviceNow
}

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

function step(run: ParkourRun, ms = 1000 / 60): void {
  engine.stepParkour(run, ms)
}

function stepMany(run: ParkourRun, frames: number, ms = 1000 / 60): void {
  for (let i = 0; i < frames; i += 1) engine.stepParkour(run, ms)
}

function addObstacle(
  run: ParkourRun,
  kind: 'train' | 'barrier' | 'sign' | 'pit',
  lane: 0 | 1 | 2,
  zStart: number,
  zEnd: number,
  bottom: number,
  top: number,
): void {
  run.obstacles.push({
    id: run.nextObstacleId++,
    kind,
    lane,
    zStart,
    zEnd,
    bottom,
    top,
  })
}

function addCoin(
  run: ParkourRun,
  lane: 0 | 1 | 2,
  z: number,
  y = 0.9,
): void {
  run.pickups.push({
    id: run.nextPickupId++,
    kind: 'coin',
    lane,
    z,
    y,
    taken: false,
  })
}

// === 引擎：常量 ===

function verifyEngineConstants(): void {
  assertEqual(
    {
      PARKOUR_LANES: engine.PARKOUR_LANES,
      PARKOUR_LANE_WIDTH: engine.PARKOUR_LANE_WIDTH,
      PARKOUR_RACE_LENGTH_M: engine.PARKOUR_RACE_LENGTH_M,
      PARKOUR_ONLINE_MAX_SPEED: engine.PARKOUR_ONLINE_MAX_SPEED,
      PARKOUR_DASH_MULT: engine.PARKOUR_DASH_MULT,
      PARKOUR_SLIDE_HEIGHT: engine.PARKOUR_SLIDE_HEIGHT,
      PARKOUR_PLAYER_HEIGHT: engine.PARKOUR_PLAYER_HEIGHT,
    },
    {
      PARKOUR_LANES: 3,
      PARKOUR_LANE_WIDTH: 2.4,
      PARKOUR_RACE_LENGTH_M: 800,
      PARKOUR_ONLINE_MAX_SPEED: 21,
      PARKOUR_DASH_MULT: 1.4,
      PARKOUR_SLIDE_HEIGHT: 0.9,
      PARKOUR_PLAYER_HEIGHT: 1.7,
    },
    '跑酷常量应与前后端唯一真相源逐字一致',
  )
  assertEqual(
    [engine.parkourLaneCenter(0), engine.parkourLaneCenter(1), engine.parkourLaneCenter(2)],
    [-2.4, 0, 2.4],
    '三车道中心应为 -2.4 / 0 / 2.4',
  )
}

// === 引擎：生成确定性 ===

function verifyDeterminism(): void {
  const a = engine.createParkourRun({ seed: 123456, mode: 'race' })
  const b = engine.createParkourRun({ seed: 123456, mode: 'race' })
  const c = engine.createParkourRun({ seed: 654321, mode: 'race' })
  assertEqual(a.obstacles, b.obstacles, '同 seed 的障碍序列应完全一致')
  assertEqual(a.pickups, b.pickups, '同 seed 的道具序列应完全一致')
  assert(a.obstacles.length > 0, '开局应预生成障碍')
  assert(a.obstacles[0].zStart >= engine.PARKOUR_FIRST_PATTERN_M, '第一个障碍不应出现在起跑净空区')
  assert(
    JSON.stringify(a.obstacles) !== JSON.stringify(c.obstacles),
    '不同 seed 的障碍序列应不同',
  )
  const a2 = engine.createParkourRun({ seed: 123456, mode: 'race' })
  stepMany(a2, 600)
  const b2 = engine.createParkourRun({ seed: 123456, mode: 'race' })
  stepMany(b2, 600)
  assertEqual(a2.obstacles, b2.obstacles, '步进后同 seed 的障碍序列仍应一致')
  assertEqual(a2.pickups, b2.pickups, '步进后同 seed 的道具序列仍应一致')
}

// === 引擎：速度 / 换道 / 跳跃 / 滑铲 ===

function verifyMovement(): void {
  const run = engine.createParkourRun({ seed: 7, mode: 'endless' })
  assertEqual(engine.parkourScore(run), 0, '开局分数应为 0')
  assert(engine.parkourSpeed(run) === 10, '开局速度应为 10m/s')
  run.distanceM = 500
  assert(Math.abs(engine.parkourSpeed(run) - (10 + 500 * 0.014)) < 1e-9, '速度随距离线性提升')
  run.mode = 'race'
  run.distanceM = 2000
  assert(engine.parkourSpeed(run) === 21, '联机速度应封顶 21m/s')
  run.mode = 'endless'
  assert(engine.parkourSpeed(run) === 26, '单机速度应封顶 26m/s')

  const laneRun = engine.createParkourRun({ seed: 8, mode: 'race' })
  assertEqual(laneRun.laneX, 0, '默认应在中间车道')
  assert(engine.requestParkourLane(laneRun, 1) === true, '应能向右换道')
  assertEqual(laneRun.targetLane, 2, '目标车道应变为 2')
  stepMany(laneRun, 12)
  assertClose(laneRun.laneX, 2.4, '换道应在 160ms 内到达车道中心')
  assert(engine.requestParkourLane(laneRun, 1) === false, '最右车道不能再向右')
  assert(engine.requestParkourLane(laneRun, -1) === true, '应能向左换道')
  stepMany(laneRun, 12)
  assertClose(laneRun.laneX, 0, '向左换道应回到中间车道')

  const jumpRun = engine.createParkourRun({ seed: 9, mode: 'race' })
  assert(engine.parkourPose(jumpRun) === 'run', '地面应为 run 姿态')
  assert(engine.requestParkourJump(jumpRun) === true, '地面应能起跳')
  stepMany(jumpRun, 6)
  assert(jumpRun.y > 0, '起跳后应离地')
  assert(engine.parkourPose(jumpRun) === 'jump', '空中应为 jump 姿态')
  stepMany(jumpRun, 60)
  assert(jumpRun.grounded === true, '约 0.75s 后应落地')
  assertClose(jumpRun.y, 0, '落地高度应为 0')

  const slideRun = engine.createParkourRun({ seed: 10, mode: 'race' })
  engine.setParkourSlide(slideRun, true)
  step(slideRun)
  assert(engine.parkourPose(slideRun) === 'slide', '按住滑铲应为 slide 姿态')
  engine.setParkourSlide(slideRun, false)
  step(slideRun)
  assert(engine.parkourPose(slideRun) === 'run', '松开滑铲应恢复 run 姿态')

  const bufferRun = engine.createParkourRun({ seed: 11, mode: 'race' })
  engine.requestParkourJump(bufferRun)
  stepMany(bufferRun, 10)
  engine.requestParkourJump(bufferRun)
  assert(bufferRun.jumpBufferUntil > bufferRun.elapsedMs, '空中跳跃应进入输入缓冲')
}

function assertClose(actual: number, expected: number, label: string, tolerance = 1e-6): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`断言失败：${label}\n  实际: ${actual}\n  期望: ${expected} ± ${tolerance}`)
  }
  passed += 1
}

// === 引擎：碰撞 / 道具 ===

function verifyCollisionsAndPickups(): void {
  // 低路障：不跳必死
  const hitRun = engine.createParkourRun({ seed: 20, mode: 'race' })
  addObstacle(hitRun, 'barrier', 1, hitRun.distanceM + 2, hitRun.distanceM + 2.6, 0, 1.1)
  stepMany(hitRun, 20)
  assert(hitRun.alive === false, '撞低路障应出局')
  assertEqual(hitRun.cause, 'hit', '撞击死亡原因应为 hit')

  // 低路障：跳跃通过
  const jumpRun = engine.createParkourRun({ seed: 21, mode: 'race' })
  jumpRun.obstacles = []
  jumpRun.pickups = []
  addObstacle(jumpRun, 'barrier', 1, jumpRun.distanceM + 2.5, jumpRun.distanceM + 3.1, 0, 1.1)
  engine.requestParkourJump(jumpRun)
  stepMany(jumpRun, 20)
  assert(jumpRun.alive === true, '及时跳跃应能通过低路障')

  // 悬空牌：站立必撞，滑铲通过
  const signHit = engine.createParkourRun({ seed: 22, mode: 'race' })
  signHit.obstacles = []
  signHit.pickups = []
  addObstacle(signHit, 'sign', 1, signHit.distanceM + 2, signHit.distanceM + 2.7, 1.6, 2.8)
  stepMany(signHit, 20)
  assert(signHit.alive === false, '站立撞悬空牌应出局')

  const signSlide = engine.createParkourRun({ seed: 23, mode: 'race' })
  signSlide.obstacles = []
  signSlide.pickups = []
  addObstacle(signSlide, 'sign', 1, signSlide.distanceM + 3, signSlide.distanceM + 3.7, 1.6, 2.8)
  engine.setParkourSlide(signSlide, true)
  stepMany(signSlide, 30)
  assert(signSlide.alive === true, '滑铲应能通过悬空牌')

  // 列车：不换道必死，换道通过
  const trainHit = engine.createParkourRun({ seed: 24, mode: 'race' })
  trainHit.obstacles = []
  trainHit.pickups = []
  addObstacle(trainHit, 'train', 1, trainHit.distanceM + 3, trainHit.distanceM + 13, 0, 2.8)
  stepMany(trainHit, 40)
  assert(trainHit.alive === false, '撞列车应出局')

  const trainSwitch = engine.createParkourRun({ seed: 25, mode: 'race' })
  trainSwitch.obstacles = []
  trainSwitch.pickups = []
  addObstacle(trainSwitch, 'train', 1, trainSwitch.distanceM + 20, trainSwitch.distanceM + 30, 0, 2.8)
  engine.requestParkourLane(trainSwitch, 1)
  stepMany(trainSwitch, 150)
  assert(trainSwitch.alive === true, '提前换道应能避开列车')

  // 坑洞：不跳必死，护盾也救不了
  const pitRun = engine.createParkourRun({ seed: 26, mode: 'race' })
  pitRun.obstacles = []
  pitRun.pickups = []
  addObstacle(pitRun, 'pit', 1, pitRun.distanceM + 2, pitRun.distanceM + 5, 0, 0)
  pitRun.shield = true
  stepMany(pitRun, 30)
  assert(pitRun.alive === false, '掉坑应出局（护盾不救）')
  assertEqual(pitRun.cause, 'pit', '掉坑死亡原因应为 pit')

  // 护盾抵挡一次撞击
  const shieldRun = engine.createParkourRun({ seed: 27, mode: 'race' })
  shieldRun.obstacles = []
  shieldRun.pickups = []
  shieldRun.shield = true
  addObstacle(shieldRun, 'barrier', 1, shieldRun.distanceM + 2, shieldRun.distanceM + 2.6, 0, 1.1)
  stepMany(shieldRun, 20)
  assert(shieldRun.alive === true, '护盾应抵挡一次撞击')
  assert(shieldRun.shield === false, '护盾抵挡后应消耗')
  assert(shieldRun.invincibleUntil > shieldRun.elapsedMs, '护盾抵挡后应短暂无敌')

  // 金币 + 连击
  const coinRun = engine.createParkourRun({ seed: 28, mode: 'race' })
  coinRun.obstacles = []
  coinRun.pickups = []
  addCoin(coinRun, 1, coinRun.distanceM + 0.5)
  addCoin(coinRun, 1, coinRun.distanceM + 2)
  stepMany(coinRun, 30)
  assertEqual(coinRun.coins, 2, '应收集两枚金币')
  assertEqual(coinRun.maxCombo, 2, '连续金币应累计 maxCombo')

  // 磁铁吸附另一车道金币
  const magnetRun = engine.createParkourRun({ seed: 29, mode: 'race' })
  magnetRun.obstacles = []
  magnetRun.pickups = []
  magnetRun.magnetUntil = magnetRun.elapsedMs + engine.PARKOUR_MAGNET_MS
  addCoin(magnetRun, 0, magnetRun.distanceM + 0.5)
  stepMany(magnetRun, 20)
  assertEqual(magnetRun.coins, 1, '磁铁应吸附另一车道金币')

  // 冲刺：速度提升且可越过列车
  const dashRun = engine.createParkourRun({ seed: 30, mode: 'race' })
  dashRun.obstacles = []
  dashRun.pickups = []
  dashRun.distanceM = 300
  dashRun.dashUntil = dashRun.elapsedMs + engine.PARKOUR_DASH_MS
  const dashSpeed = engine.parkourSpeed(dashRun)
  assert(dashSpeed > 10 + 300 * 0.014, '冲刺速度应高于基础速度')
  addObstacle(dashRun, 'train', 1, dashRun.distanceM + 2, dashRun.distanceM + 12, 0, 2.8)
  stepMany(dashRun, 20)
  assert(dashRun.alive === true, '冲刺应无视列车')
}

// === 引擎：冲线 / 分数 / 恢复 ===

function verifyFinishAndResume(): void {
  const run = engine.createParkourRun({ seed: 40, mode: 'race', startDistanceM: 799.5 })
  run.obstacles = []
  run.pickups = []
  stepMany(run, 30)
  assertEqual(run.finished, true, '竞速模式到达 800m 应完成')
  assertEqual(run.distanceM, 800, '冲线后距离应定格 800m')
  assertEqual(run.speed, 0, '冲线后速度应归零')

  const endless = engine.createParkourRun({ seed: 41, mode: 'endless', startDistanceM: 900 })
  endless.obstacles = []
  endless.pickups = []
  stepMany(endless, 10)
  assert(endless.finished === false, '单机无尽模式不应有终点')

  const resume = engine.createParkourRun({
    seed: 42,
    mode: 'race',
    startDistanceM: 320,
    lane: 2,
    coins: 12,
    maxCombo: 8,
  })
  assertEqual(resume.distanceM >= 320, true, '恢复距离应至少为上报距离')
  assertEqual(resume.lane, 2, '恢复车道应保留')
  assertEqual(resume.laneX, 2.4, '恢复时应位于对应车道中心')
  assertEqual(resume.coins, 12, '恢复金币应保留')
  assertEqual(resume.maxCombo, 8, '恢复最高连击应保留')
  assertEqual(engine.parkourScore({ distanceM: 100, coins: 12, maxCombo: 8 }), 100 + 120 + 160, '分数公式应为 距离 + 金币×10 + maxCombo×20')

  const laneRun = engine.createParkourRun({ seed: 43, mode: 'race' })
  assert(engine.requestParkourLane(laneRun, -1) === true, '中间车道应能向左')
  stepMany(laneRun, 12)
  assertClose(laneRun.laneX, -2.4, '左车道中心应为 -2.4')
  assert(engine.requestParkourLane(laneRun, -1) === false, '最左车道不能再向左')
}

// === 引擎：关卡不变量 ===

function collectRows(run: ParkourRun): Array<{
  z: number
  zEnd: number
  obstacles: ParkourRun['obstacles']
}> {
  const map = new Map<number, ParkourRun['obstacles']>()
  for (const obstacle of run.obstacles) {
    const list = map.get(obstacle.zStart) ?? []
    list.push(obstacle)
    map.set(obstacle.zStart, list)
  }
  return Array.from(map.entries())
    .map(([z, obstacles]) => ({
      z,
      zEnd: Math.max(...obstacles.map((obstacle) => obstacle.zEnd)),
      obstacles,
    }))
    .sort((a, b) => a.z - b.z)
}

function verifyCourseInvariants(): void {
  for (let seed = 1; seed <= 40; seed += 1) {
    const full = engine.generateParkourCourseForTest(seed, 'race', 900)
    const rows = collectRows(full)
    assert(rows.length > 10, `seed ${seed}: 800m 赛道应有足够多的障碍排`)
    assert(rows[0].z >= engine.PARKOUR_FIRST_PATTERN_M, `seed ${seed}: 第一排应在净空区之后`)
    const trainRows = rows.filter((row) => row.obstacles.some((obstacle) => obstacle.kind === 'train'))
    for (const row of trainRows) {
      const trainCount = row.obstacles.filter((obstacle) => obstacle.kind === 'train').length
      assert(trainCount < 3, `seed ${seed}: 列车不能占满三条车道`)
    }
    for (let i = 1; i < rows.length; i += 1) {
      assert(rows[i].z - rows[i - 1].zEnd >= 14, `seed ${seed}: 行间距应 ≥14m`)
    }
    for (const row of rows) {
      const kinds = new Set(row.obstacles.map((obstacle) => obstacle.kind))
      assert(kinds.size === 1, `seed ${seed}: 同一排应只有一种障碍`)
      if (row.obstacles.some((obstacle) => obstacle.kind === 'pit')) {
        for (const obstacle of row.obstacles) {
          assert(obstacle.zEnd - obstacle.zStart <= 4.1, `seed ${seed}: 坑洞长度应 ≤4.1m`)
        }
      }
    }
    // 护盾 / 磁铁 / 冲刺不能落在已生成障碍的车道上（金币允许沿障碍排布）
    for (const pickup of full.pickups) {
      if (pickup.kind === 'coin') continue
      const blocked = full.obstacles.some(
        (obstacle) =>
          obstacle.lane === pickup.lane
          && pickup.z >= obstacle.zStart - 1.2
          && pickup.z <= obstacle.zEnd + 1.2,
      )
      assert(!blocked, `seed ${seed}: 道具不应生成在障碍内`)
    }
  }
}

// === 引擎：贪心机器人跑完整 800m ===

function inHazardLane(
  run: ParkourRun,
  row: { obstacles: ParkourRun['obstacles'] },
  kind: 'train' | 'barrier' | 'sign' | 'pit',
): boolean {
  return row.obstacles.some(
    (obstacle) =>
      obstacle.kind === kind
      && Math.abs(engine.parkourLaneCenter(obstacle.lane) - run.laneX) <= 1.25,
  )
}

/** 当前正在经过 / 马上要经过的障碍所在车道（换道时不能切进去） */
function laneBlockedNow(run: ParkourRun, lane: number): boolean {
  return run.obstacles.some(
    (obstacle) =>
      obstacle.lane === lane
      && obstacle.zEnd >= run.distanceM - 0.6
      && obstacle.zStart <= run.distanceM + 3,
  )
}

function runParkourBot(
  seed: number,
): { ok: boolean; distanceM: number; cause: string | null; steps: number } {
  const run = engine.createParkourRun({ seed, mode: 'race' })
  const dt = 1000 / 60
  let slideUntil = 0
  let steps = 0
  for (let frame = 0; frame < 20000 && run.alive && !run.finished; frame += 1) {
    const rows = collectRows(run).filter((row) => row.zEnd >= run.distanceM - 0.6)
    const row = rows[0] ?? null
    if (row) {
      const distanceToRow = row.z - run.distanceM
      const trainInLane = inHazardLane(run, row, 'train')
      if (trainInLane) {
        const trainLanes = new Set(row.obstacles.filter((obstacle) => obstacle.kind === 'train').map((obstacle) => obstacle.lane))
        const safeLanes = ([0, 1, 2] as const).filter(
          (lane) => !trainLanes.has(lane) && !laneBlockedNow(run, lane),
        )
        const safe = safeLanes.sort((a, b) => Math.abs(a - run.targetLane) - Math.abs(b - run.targetLane))[0]
        if (safe !== undefined && safe !== run.targetLane) {
          engine.requestParkourLane(run, safe < run.targetLane ? -1 : 1)
        }
        slideUntil = 0
      } else {
        const signInLane = inHazardLane(run, row, 'sign')
        const jumpInLane = inHazardLane(run, row, 'barrier') || inHazardLane(run, row, 'pit')
        if (signInLane && distanceToRow <= 6) {
          slideUntil = run.elapsedMs + ((Math.max(row.zEnd, run.distanceM) - run.distanceM) / Math.max(run.speed, 1) + 0.2) * 1000
        }
        if (jumpInLane && run.grounded && distanceToRow > 0.2 && distanceToRow <= run.speed * 0.28) {
          engine.requestParkourJump(run)
          slideUntil = 0
        }
      }
    }
    engine.setParkourSlide(run, slideUntil > run.elapsedMs)
    engine.stepParkour(run, dt)
    steps += 1
  }
  return { ok: run.finished && run.alive, distanceM: run.distanceM, cause: run.cause, steps }
}

function verifyBotRuns(): void {
  let succeeded = 0
  const total = 200
  for (let seed = 1; seed <= total; seed += 1) {
    const result = runParkourBot(seed)
    if (result.ok) succeeded += 1
    else {
      throw new Error(
        `断言失败：seed ${seed} 机器人未能完赛（distance=${result.distanceM.toFixed(1)}m, cause=${result.cause ?? 'timeout'}, steps=${result.steps}）`,
      )
    }
  }
  assertEqual(succeeded, total, `贪心机器人应能跑完 ${total} 个 seed × 800m`)
}

// === 服务：房间 / 开始 / 退出 ===

function playerDto(dto: ParkourMatchDto, userId: number): ParkourMatchDto['players'][number] {
  const player = dto.players.find((candidate) => candidate.userId === userId)
  if (!player) throw new Error(`断言失败：DTO 中找不到玩家 ${userId}`)
  return player
}

function startTestMatch(
  hostId: number,
  memberIds: number[],
  now: number,
): { matchId: number; dto: ParkourMatchDto } {
  const room = service.createParkourRoomForTest(hostId, `u${hostId}`, memberIds, now)
  const started = service.startParkourMatch(hostId, room.matchId, now)
  return { matchId: room.matchId, dto: started.match }
}

function sendProgress(
  matchId: number,
  userId: number,
  now: number,
  data: {
    distanceM: number
    coins?: number
    maxCombo?: number
    lane?: 0 | 1 | 2
    pose?: 'run' | 'jump' | 'slide'
    alive?: boolean
    cause?: 'hit' | 'pit'
  },
): void {
  service.applyParkourAction(
    userId,
    matchId,
    {
      type: 'progress',
      distanceM: data.distanceM,
      coins: data.coins ?? 0,
      maxCombo: data.maxCombo ?? 0,
      lane: data.lane ?? 1,
      pose: data.pose ?? 'run',
      alive: data.alive ?? true,
      cause: data.cause,
    },
    now,
  )
}

function sendFinish(
  matchId: number,
  userId: number,
  now: number,
  data: { distanceM?: number; coins?: number; maxCombo?: number } = {},
): { match: ParkourMatchDto } {
  return service.applyParkourAction(
    userId,
    matchId,
    {
      type: 'finish',
      distanceM: data.distanceM ?? 800,
      coins: data.coins ?? 0,
      maxCombo: data.maxCombo ?? 0,
    },
    now,
  ) as { match: ParkourMatchDto }
}

function resetServiceGroup(): void {
  service.resetParkourStateForTest()
  presence.pruneGamePresence(Number.MAX_SAFE_INTEGER)
}

function verifyServiceRoomStart(): void {
  resetServiceGroup()
  const now = advance(1_000)

  const one = service.createParkourRoomForTest(705, 'host')
  expectThrow(() => service.startParkourMatch(705, one.matchId, now), '至少需要', '1 人不能开始跑酷')

  const room = service.createParkourRoomForTest(701, 'host', [702], now)
  expectThrow(() => service.startParkourMatch(702, room.matchId, now), '只有房主', '非房主不能开始')

  const started = service.startParkourMatch(701, room.matchId, now)
  assertEqual(started.match.status, 'playing', '房主开始后应进入 playing')
  assert(started.match.seed > 0, '开始后应下发非零 seed')
  assertEqual(started.match.trackLengthM, 800, '竞速距离应为 800m')
  assertEqual(started.match.countdownMs, 3000, '开始后应下发 3 秒倒计时')
  assertEqual(started.match.players.length, 2, '房间应有 2 名玩家')
  assertEqual(started.match.players.map((player) => player.status), ['playing', 'playing'], '开始后所有玩家应为 playing')

  const active = service.getActiveParkourMatch(701, now)
  assert(active?.id === room.matchId, '房主 active 查询应返回本局')
  const guestActive = service.getActiveParkourMatch(702, now)
  assert(guestActive?.id === room.matchId, '客人 active 查询应返回本局')
  expectThrow(() => service.getParkourMatch(703, room.matchId, now), '对局不存在', '非参与者不能看详情')
  expectThrow(() => service.startParkourMatch(701, room.matchId, now), '已经开始', '不能重复开始')
  expectThrow(() => service.leaveParkourMatch(701, room.matchId, now), '请使用认输', '比赛中不能用 leave')

  const resigned = service.resignParkourMatch(701, room.matchId, now)
  assertEqual(playerDto(resigned.match, 701).cause, 'resign', 'resign 应记录 cause')
  assertEqual(playerDto(resigned.match, 701).status, 'lost', 'resign 后应 lost')
  assertEqual(resigned.match.status, 'playing', '仍有其他玩家时对局继续')
  expectThrow(() => service.resignParkourMatch(701, room.matchId, now), '你已出局', '已出局不能重复 resign')

  service.resignParkourMatch(702, room.matchId, now)
  const ended = service.getParkourMatch(701, room.matchId, now)
  assertEqual(ended.status, 'finished', '全员出局后对局应结束')
  assertEqual(ended.reason, 'elimination', '全员出局 reason 应为 elimination')
  assert(ended.winnerId !== null, '全员出局也应按距离产生冠军')
}

// === 服务：进度钳制 ===

function verifyServiceProgress(): void {
  resetServiceGroup()
  const now = advance(1_000)
  const { matchId } = startTestMatch(711, [712], now)

  sendProgress(matchId, 711, now + 1_000, { distanceM: 100 })
  let dto = service.getParkourMatch(711, matchId, now + 1_000)
  assertEqual(playerDto(dto, 711).distanceM, 2, '倒计时内进度应钳到 2m')

  sendProgress(matchId, 711, now + 4_000, {
    distanceM: 40,
    coins: 4,
    maxCombo: 2,
    lane: 0,
    pose: 'slide',
  })
  dto = service.getParkourMatch(711, matchId, now + 4_000)
  const afterOneSecond = playerDto(dto, 711)
  assertEqual(
    afterOneSecond.distanceM,
    service.PARKOUR_SERVER_MAX_SPEED + 2,
    '开始 1 秒最多前进到服务端速度上限 + 2m',
  )
  assertEqual(afterOneSecond.coins, 4, '金币应正常记录')
  assertEqual(afterOneSecond.maxCombo, 2, 'maxCombo 应正常记录')
  assertEqual(afterOneSecond.lane, 0, '车道应记录')
  assertEqual(afterOneSecond.pose, 'slide', '姿态应记录')

  sendProgress(matchId, 711, now + 13_000, {
    distanceM: 100,
    coins: 8,
    maxCombo: 10,
    lane: 2,
    pose: 'jump',
  })
  dto = service.getParkourMatch(711, matchId, now + 13_000)
  const afterTenSeconds = playerDto(dto, 711)
  assertEqual(afterTenSeconds.distanceM, 100, '10 秒后可前进到 100m')
  assertEqual(afterTenSeconds.maxCombo, 8, 'maxCombo 不应超过金币数')
  assertEqual(afterTenSeconds.lane, 2, '车道应更新到 2')
  assertEqual(afterTenSeconds.pose, 'jump', '姿态应更新')

  sendProgress(matchId, 711, now + 14_000, {
    distanceM: 50,
    coins: 9_999,
    maxCombo: 9_999,
  })
  dto = service.getParkourMatch(711, matchId, now + 14_000)
  const afterCheat = playerDto(dto, 711)
  assertEqual(afterCheat.distanceM, 100, '距离应单调，不允许回退')
  assertEqual(afterCheat.coins, 310, '金币应按距离上限 310 截断')
  assertEqual(afterCheat.maxCombo, 310, 'maxCombo 不应超过金币上限')

  expectThrow(
    () => sendProgress(matchId, 713, now + 14_000, { distanceM: 10 }),
    '对局不存在',
    '非参与者不能上报进度',
  )
  assert(service.getActiveParkourMatch(711, now + 14_000)?.id === matchId, '进度上报后房主仍在 active')
  assert(service.getActiveParkourMatch(712, now + 14_000)?.id === matchId, '进度上报后客人仍活跃')

  const sync = service.getParkourSync(711, matchId, now + 14_000)
  assertEqual(sync.match?.id, matchId, 'sync 应返回指定对局')
  assert(typeof sync.serverTime === 'string', 'sync 应返回 serverTime')
  expectThrow(
    () => service.getParkourSync(713, matchId, now + 14_000),
    '对局不存在',
    '非参与者不能 sync 指定对局',
  )
}

// === 服务：名次 / 终点 ===

function verifyServiceFinishOrder(): void {
  resetServiceGroup()
  const now = advance(1_000)
  const { matchId } = startTestMatch(721, [722, 723], now)

  sendProgress(matchId, 721, now + 30_000, { distanceM: 100, alive: false, cause: 'hit' })
  let dto = service.getParkourMatch(721, matchId, now + 30_000)
  assertEqual(playerDto(dto, 721).status, 'lost', '撞击者应 lost')
  assertEqual(playerDto(dto, 721).cause, 'hit', '撞击原因应记录')
  assertEqual(dto.status, 'playing', '仍有人比赛时对局继续')

  sendFinish(matchId, 722, now + 40_000, { coins: 20, maxCombo: 10 })
  dto = service.getParkourMatch(721, matchId, now + 40_000)
  assertEqual(playerDto(dto, 722).status, 'finished', '冲线者应 finished')
  assertEqual(playerDto(dto, 722).rank, 1, '第一个冲线者应为第 1 名')
  assertEqual(playerDto(dto, 722).finishMs, 37_000, '完赛用时应从 startsAt 计算')
  assertEqual(dto.status, 'playing', '还有一人未完成时对局继续')
  assertEqual(service.getActiveParkourMatch(722, now + 40_000), null, '已冲线者 active 应为 null')
  assertEqual(playerDto(service.getParkourMatch(722, matchId, now + 40_000), 722).rank, 1, '已冲线者仍可补拉结果')

  const repeat = sendFinish(matchId, 722, now + 40_000)
  assertEqual(playerDto(repeat.match, 722).rank, 1, '重复 finish 应幂等')
  sendProgress(matchId, 722, now + 41_000, { distanceM: 100 })
  assertEqual(playerDto(service.getParkourMatch(722, matchId, now + 41_000), 722).distanceM, 800, '已冲线者进度应冻结')

  sendFinish(matchId, 723, now + 41_000, { distanceM: 800 })
  dto = service.getParkourMatch(722, matchId, now + 41_000)
  assertEqual(dto.status, 'finished', '全员结束应 finished')
  assertEqual(dto.reason, 'finish', '有人冲线时 reason 应为 finish')
  assertEqual(dto.winnerId, 722, '第一个冲线者应获胜')
  assertEqual(playerDto(dto, 722).rank, 1, '冠军 rank 1')
  assertEqual(playerDto(dto, 723).rank, 2, '第二个冲线者 rank 2')
  assertEqual(playerDto(dto, 721).rank, 3, '出局者按距离补排名')
  assertEqual(service.getActiveParkourMatch(722, now + 41_000), null, '结束后 active 为 null')
  assertEqual(game.isUserBusyInOtherGames(722, 'gomoku'), false, '已完赛玩家不应阻塞其它游戏')

  // 过早冲线 / 距离不足
  resetServiceGroup()
  const now2 = advance(1_000)
  const early = startTestMatch(724, [725], now2)
  expectThrow(
    () => sendFinish(early.matchId, 724, now2 + 5_000),
    '进度异常',
    '过早冲线应被速度上限拒绝',
  )
  expectThrow(
    () => sendFinish(early.matchId, 724, now2 + 30_000, { distanceM: 700 }),
    '尚未到达终点',
    '距离不足 795m 不能冲线',
  )
}

// === 服务：超时 / 掉线 ===

function verifyServiceTimeoutAndForfeit(): void {
  resetServiceGroup()
  const now = advance(1_000)
  const timeoutRoom = startTestMatch(731, [732], now)
  sendProgress(timeoutRoom.matchId, 731, now + 10_000, { distanceM: 100 })
  sendProgress(timeoutRoom.matchId, 732, now + 10_000, { distanceM: 50 })
  const timeoutDto = service.getParkourMatch(
    731,
    timeoutRoom.matchId,
    now + 3_000 + service.PARKOUR_RACE_DURATION_MS + 1,
  )
  assertEqual(timeoutDto.status, 'finished', '超时应结束对局')
  assertEqual(timeoutDto.reason, 'timeout', '超时 reason 应为 timeout')
  assertEqual(timeoutDto.winnerId, 731, '超时应按距离选冠军')
  assertEqual(playerDto(timeoutDto, 731).rank, 1, '超时第一名')
  assertEqual(playerDto(timeoutDto, 732).rank, 2, '超时第二名')

  resetServiceGroup()
  const now2 = advance(1_000)
  const forfeitRoom = startTestMatch(741, [742], now2)
  sendProgress(forfeitRoom.matchId, 741, now2 + 10_000, { distanceM: 100 })
  const at = now2 + 41_000
  presence.markGamePresence(742, at)
  presence.clearGamePresence(741)
  service.runParkourSweeper(at)
  let dto = service.getParkourMatch(741, forfeitRoom.matchId, at)
  assertEqual(playerDto(dto, 741).status, 'lost', '掉线者应 lost')
  assertEqual(playerDto(dto, 741).cause, 'forfeit', '掉线原因应为 forfeit')
  assertEqual(playerDto(dto, 742).status, 'playing', '在线玩家应继续')
  assertEqual(dto.status, 'playing', '仅一人掉线时对局继续')
  assertEqual(service.getActiveParkourMatch(741, at), null, '掉线者 active 应为 null')
  assert(service.getActiveParkourMatch(742, at)?.id === forfeitRoom.matchId, '在线玩家仍在 active')
  presence.clearGamePresence(742)

  const finishDto = sendFinish(forfeitRoom.matchId, 742, now2 + 70_000)
  assertEqual(finishDto.match.status, 'finished', '最后一名冲线后结束')
  assertEqual(finishDto.match.winnerId, 742, '唯一完赛者获胜')
  assertEqual(playerDto(finishDto.match, 741).rank, 2, '掉线者按距离补第 2 名')

  // 全员不可用不逐个 DNF，留给超时
  resetServiceGroup()
  const now3 = advance(1_000)
  const bothOffline = startTestMatch(751, [752], now3)
  presence.clearGamePresence(751)
  presence.clearGamePresence(752)
  service.runParkourSweeper(now3 + 34_000)
  const stillPlaying = service.getParkourMatch(751, bothOffline.matchId, now3 + 34_000)
  assertEqual(playerDto(stillPlaying, 751).status, 'playing', '全员不可用时不逐个判负')
  assertEqual(playerDto(stillPlaying, 752).status, 'playing', '全员不可用时不逐个判负（2）')
  const ended = service.getParkourMatch(
    751,
    bothOffline.matchId,
    now3 + 3_000 + service.PARKOUR_RACE_DURATION_MS + 1,
  )
  assertEqual(ended.status, 'finished', '全员不可用最终按超时结束')
  assertEqual(ended.reason, 'timeout', '全员不可用最终 reason 为 timeout')
}

// === 服务：邀请 / 离开 / 人数 ===

function verifyServiceInvitesAndLeave(): void {
  resetServiceGroup()
  const now = advance(1_000)
  const room = service.createParkourRoomForTest(761, 'host', [], now)
  const invite = service.createParkourInviteForTest(761, 762, room.matchId, now)
  const incoming = service.listParkourInvites(762, now)
  assertEqual(incoming.incoming.length, 1, '被邀请者应收到邀请')
  assertEqual(incoming.incoming[0].game, 'parkour', '邀请应带 game:parkour')
  const accepted = service.respondParkourInvite(762, invite.inviteId, 'accept', now + 1_000)
  assertEqual(accepted.ok, true, '接受邀请应成功')
  assertEqual(accepted.match?.players.length, 2, '接受后房间应有 2 人')
  assertEqual(service.listParkourInvites(762, now + 1_000).incoming.length, 0, '接受后邀请应消失')
  assert(service.getActiveParkourMatch(762, now + 1_000)?.id === room.matchId, '接受者应进入 active')

  const expired = service.createParkourInviteForTest(761, 763, room.matchId, now)
  expectThrow(
    () => service.respondParkourInvite(763, expired.inviteId, 'accept', now + service.PARKOUR_INVITE_TTL_MS + 1),
    '邀请已过期',
    '过期邀请应 410',
  )

  const cancelled = service.createParkourInviteForTest(761, 764, room.matchId, now)
  service.cancelParkourInvite(761, cancelled.inviteId, now)
  assertEqual(service.listParkourInvites(764, now).incoming.length, 0, '取消邀请后应消失')

  const declined = service.createParkourInviteForTest(761, 765, room.matchId, now)
  service.respondParkourInvite(765, declined.inviteId, 'decline', now)
  assertEqual(service.listParkourInvites(765, now).incoming.length, 0, '拒绝邀请后应消失')

  // 满员 6 人后不能再接受
  resetServiceGroup()
  const nowFull = advance(1_000)
  const full = service.createParkourRoomForTest(771, 'host', [772, 773, 774, 775, 776], nowFull)
  const fullInvite = service.createParkourInviteForTest(771, 777, full.matchId, nowFull)
  expectThrow(
    () => service.respondParkourInvite(777, fullInvite.inviteId, 'accept', nowFull),
    '房间已满',
    '第 7 人不能加入',
  )
  const fullStarted = service.startParkourMatch(771, full.matchId, nowFull)
  assertEqual(fullStarted.match.players.length, 6, '6 人房可以开始')
  assertEqual(
    fullStarted.match.players.map((player) => player.colorIndex),
    [0, 1, 2, 3, 4, 5],
    '开局后座位配色应为 0–5',
  )

  // 房主离开等待房 = 解散
  resetServiceGroup()
  const nowLeave = advance(1_000)
  const hostRoom = service.createParkourRoomForTest(781, 'host', [782], nowLeave)
  const dissolved = service.leaveParkourMatch(781, hostRoom.matchId, nowLeave)
  assertEqual(dissolved.dissolved, true, '房主离开应解散')
  const cancelledRoom = service.getParkourMatch(782, hostRoom.matchId, nowLeave)
  assertEqual(cancelledRoom.status, 'finished', '解散后房间 finished')
  assertEqual(cancelledRoom.reason, 'cancelled', '解散 reason 应为 cancelled')
  assertEqual(cancelledRoom.winnerId, null, '解散没有冠军')
  assertEqual(playerDto(cancelledRoom, 782).rank, null, '解散不排名')

  // 普通玩家离开等待房 = 移除
  resetServiceGroup()
  const nowGuestLeave = advance(1_000)
  const guestRoom = service.createParkourRoomForTest(783, 'host', [784], nowGuestLeave)
  const guestLeft = service.leaveParkourMatch(784, guestRoom.matchId, nowGuestLeave)
  assertEqual(guestLeft.dissolved, false, '普通玩家离开不解散')
  assertEqual(service.getParkourMatch(783, guestRoom.matchId, nowGuestLeave).players.length, 1, '离开后房间剩 1 人')
  assertEqual(service.getActiveParkourMatch(784, nowGuestLeave), null, '离开者 active 为 null')
}

// === 服务：active / 跨游戏互斥 ===

function verifyServiceActiveAndMutex(): void {
  resetServiceGroup()
  const now = advance(1_000)
  const room = service.createParkourRoomForTest(801, 'host', [802], now)
  assert(service.getActiveParkourMatch(801, now)?.id === room.matchId, '等待房应可被 active 查到')
  assertEqual(game.isUserBusyInOtherGames(801, 'gomoku'), true, '等待中的跑酷玩家应阻塞其它游戏')
  assertEqual(game.isUserBusyInOtherGames(801, 'parkour'), false, '自家检查应排除自己')

  const started = service.startParkourMatch(801, room.matchId, now)
  assertEqual(started.match.status, 'playing', '开始后进入 playing')
  sendProgress(room.matchId, 801, now + 10_000, { distanceM: 100 })
  sendFinish(room.matchId, 801, now + 40_000)
  assertEqual(service.getActiveParkourMatch(801, now + 40_000), null, '冲线者 active 为 null')
  assertEqual(game.isUserBusyInOtherGames(801, 'gomoku'), false, '冲线者不阻塞其它游戏')
  assertEqual(game.isUserBusyInOtherGames(802, 'gomoku'), true, '仍在比赛的玩家应阻塞其它游戏')
  sendFinish(room.matchId, 802, now + 41_000)
  assertEqual(game.isUserBusyInOtherGames(802, 'gomoku'), false, '全员结束后不阻塞其它游戏')
}

// === 主流程 ===

async function main(): Promise<void> {
  engine = await import('../src/services/gameParkour.js')
  service = await import('../src/services/gameParkourService.js')
  game = await import('../src/services/gameService.js')
  presence = await import('../src/services/gamePresence.js')
  serviceNow = Date.now()

  verifyEngineConstants()
  verifyDeterminism()
  verifyMovement()
  verifyCollisionsAndPickups()
  verifyFinishAndResume()
  verifyCourseInvariants()
  verifyBotRuns()

  verifyServiceRoomStart()
  verifyServiceProgress()
  verifyServiceFinishOrder()
  verifyServiceTimeoutAndForfeit()
  verifyServiceInvitesAndLeave()
  verifyServiceActiveAndMutex()

  resetServiceGroup()
  service.resetParkourStateForTest()
  presence.pruneGamePresence(Number.MAX_SAFE_INTEGER)
  console.log(`\n✓ 跑酷引擎 + 联机自检通过（${passed} 条断言）`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
