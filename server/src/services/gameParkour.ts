/**
 * 霓虹跑酷（parkour）共享引擎 —— 双端唯一真相源，必须逐字一致
 *
 * 本文件同时存在于：
 *   - server/src/services/gameParkour.ts
 *   - client/src/lib/games/parkour.ts
 * 客户端测试会读取两份源码断言完全一致，修改时必须同步拷贝。
 *
 * 设计：
 *   - 纯函数 / 不依赖 DOM、three.js、localStorage、Prisma，可直接在 Node 与浏览器运行；
 *   - 第三人称三车道（Subway Surfers / Temple Run 式）：自动前进，左右换道、跳跃、滑铲；
 *   - 一次撞击或掉坑即出局（护盾抵挡一次撞击，冲刺期间无敌）；
 *   - 关卡按 seed 分块确定性生成：列车 / 低路障 / 悬空牌 / 坑洞 + 金币 + 道具；
 *   - 联机不跑服务端逐帧物理：服务端只下发 seed，客户端本地 60fps 模拟并上报进度。
 *
 * 坐标约定（米）：
 *   - distanceM：沿赛道前进的距离（z 轴）；
 *   - laneX：横向位置，车道中心 -2.4 / 0 / +2.4；
 *   - y：脚底高度，0 为地面。
 */

export type ParkourMode = 'endless' | 'race'
export type ParkourLane = 0 | 1 | 2
export type ParkourPose = 'run' | 'jump' | 'slide'
export type ParkourObstacleKind = 'train' | 'barrier' | 'sign' | 'pit'
export type ParkourPickupKind = 'coin' | 'shield' | 'magnet' | 'dash'
export type ParkourDeathCause = 'hit' | 'pit'

// === 常量（与前端 HUD / 场景 / 联机协议共用） ===

/** 车道数（固定三车道） */
export const PARKOUR_LANES = 3
/** 单条车道宽度（米） */
export const PARKOUR_LANE_WIDTH = 2.4
/** 赛道总宽度（米） */
export const PARKOUR_TRACK_WIDTH = PARKOUR_LANES * PARKOUR_LANE_WIDTH
/** 联机竞速距离（米） */
export const PARKOUR_RACE_LENGTH_M = 800
/** 初始前进速度（米/秒） */
export const PARKOUR_BASE_SPEED = 10
/** 每前进 1 米增加的速度（米/秒） */
export const PARKOUR_SPEED_PER_M = 0.014
/** 联机模式速度上限（米/秒） */
export const PARKOUR_ONLINE_MAX_SPEED = 21
/** 单机无尽模式速度上限（米/秒） */
export const PARKOUR_ENDLESS_MAX_SPEED = 26
/** 冲刺速度倍率 */
export const PARKOUR_DASH_MULT = 1.4
/** 冲刺持续时间（毫秒） */
export const PARKOUR_DASH_MS = 4000
/** 磁铁持续时间（毫秒） */
export const PARKOUR_MAGNET_MS = 8000
/** 护盾抵挡撞击后的无敌时间（毫秒） */
export const PARKOUR_SHIELD_INVULN_MS = 1200
/** 刷新恢复 / 开局保护的无敌时间（毫秒） */
export const PARKOUR_START_INVINCIBLE_MS = 1500
/** 跳跃初速度（米/秒） */
export const PARKOUR_JUMP_VELOCITY = 9.8
/** 重力加速度（米/秒²） */
export const PARKOUR_GRAVITY = 26
/** 空中按住滑铲时的重力倍率（快速下坠） */
export const PARKOUR_FAST_FALL_MULT = 2.4
/** 换一条车道所需时间（毫秒） */
export const PARKOUR_LANE_CHANGE_MS = 160
/** 跳跃输入缓冲（毫秒） */
export const PARKOUR_JUMP_BUFFER_MS = 120
/** 土狼时间（毫秒） */
export const PARKOUR_COYOTE_MS = 90
/** 玩家碰撞盒宽度（米） */
export const PARKOUR_PLAYER_WIDTH = 0.9
/** 玩家站立高度（米） */
export const PARKOUR_PLAYER_HEIGHT = 1.7
/** 玩家滑铲高度（米） */
export const PARKOUR_SLIDE_HEIGHT = 0.9
/** 玩家碰撞盒前后深度（米） */
export const PARKOUR_PLAYER_DEPTH = 0.8
/** 磁铁吸附范围（米） */
export const PARKOUR_MAGNET_RANGE_M = 4.5
/** 第一个障碍图案出现距离（米） */
export const PARKOUR_FIRST_PATTERN_M = 40
/** 第一个列车出现距离（米） */
export const PARKOUR_FIRST_TRAIN_M = 120
/** 生成器向前预生成距离（米） */
export const PARKOUR_LOOKAHEAD_M = 160
/** 赛道清洗距离（米） */
export const PARKOUR_PRUNE_BEHIND_M = 24
/** 单个道具的拾取判定前后范围（米） */
export const PARKOUR_PICKUP_DEPTH_M = 0.8
/** 金币拾取横向容差（米） */
export const PARKOUR_COIN_LATERAL_M = 1.0
/** 道具拾取横向容差（米） */
export const PARKOUR_POWER_LATERAL_M = 1.1

// === 实体 ===

export interface ParkourObstacle {
  id: number
  kind: ParkourObstacleKind
  lane: ParkourLane
  /** 障碍起始距离（米） */
  zStart: number
  /** 障碍结束距离（米） */
  zEnd: number
  /** 碰撞盒底面高度（米）；坑洞为 0 */
  bottom: number
  /** 碰撞盒顶面高度（米）；坑洞为 0（不参与普通 AABB） */
  top: number
}

export interface ParkourPickup {
  id: number
  kind: ParkourPickupKind
  lane: ParkourLane
  /** 距离（米） */
  z: number
  /** 中心高度（米） */
  y: number
  taken: boolean
}

// === 跑酷状态（可序列化） ===

export interface ParkourRunState {
  seed: number
  mode: ParkourMode
  /** 生成器 RNG 状态（确定性） */
  rngState: number
  /** 已前进距离（米） */
  distanceM: number
  /** 当前速度（米/秒，含冲刺） */
  speed: number
  /** 当前目标车道（0–2） */
  lane: ParkourLane
  targetLane: ParkourLane
  /** 当前横向位置（米，连续值，用于碰撞与渲染） */
  laneX: number
  /** 脚底高度（米） */
  y: number
  /** 垂直速度（米/秒） */
  vy: number
  /** 是否在地面 */
  grounded: boolean
  /** 是否按住滑铲（决定碰撞高度 / 空中快坠） */
  slideHeld: boolean
  /** 跳跃输入缓冲截止时间（毫秒，run.elapsedMs 基准） */
  jumpBufferUntil: number
  /** 最近一次落地时间（毫秒） */
  lastGroundedAt: number
  alive: boolean
  finished: boolean
  cause: ParkourDeathCause | null
  shield: boolean
  magnetUntil: number
  dashUntil: number
  invincibleUntil: number
  coins: number
  combo: number
  maxCombo: number
  elapsedMs: number
  obstacles: ParkourObstacle[]
  pickups: ParkourPickup[]
  nextObstacleId: number
  nextPickupId: number
  /** 下一个障碍图案的起始距离（米） */
  nextPatternAtM: number
  /** 下一个道具的起始距离（米） */
  nextPowerUpAtM: number
  /** 渲染特效时间戳（毫秒） */
  lastLandAt: number
  lastCoinAt: number
  lastHitAt: number
  lastPickupAt: number
  lastPickupKind: ParkourPickupKind | null
  /** 最近一次清洗距离（米） */
  lastPruneAt: number
}

export interface CreateParkourRunOptions {
  seed: number
  mode?: ParkourMode
  /** 刷新恢复时的起始距离（米） */
  startDistanceM?: number
  /** 刷新恢复时的车道 */
  lane?: ParkourLane
  /** 刷新恢复时的金币数 */
  coins?: number
  /** 刷新恢复时的最高连击 */
  maxCombo?: number
  /** 开局 / 恢复保护的无敌时间（毫秒） */
  invincibleMs?: number
}

// === 对外工具 ===

/** 车道中心（米） */
export function parkourLaneCenter(lane: number): number {
  return (lane - 1) * PARKOUR_LANE_WIDTH
}

/** 分数：距离 + 金币 + 最高连击（服务端与客户端必须一致） */
export function parkourScore(run: Pick<ParkourRunState, 'distanceM' | 'coins' | 'maxCombo'>): number {
  return Math.floor(run.distanceM) + run.coins * 10 + run.maxCombo * 20
}

/** 当前姿态（联机进度上报 / 幽灵渲染） */
export function parkourPose(run: Pick<ParkourRunState, 'slideHeld' | 'grounded' | 'y'>): ParkourPose {
  if (run.slideHeld && run.grounded) return 'slide'
  if (!run.grounded || run.y > 0.05) return 'jump'
  return 'run'
}

/** 当前速度（不含本帧推进，按距离与冲刺计算） */
export function parkourSpeed(run: Pick<ParkourRunState, 'mode' | 'distanceM' | 'elapsedMs' | 'dashUntil'>): number {
  const cap = run.mode === 'race' ? PARKOUR_ONLINE_MAX_SPEED : PARKOUR_ENDLESS_MAX_SPEED
  const base = Math.min(cap, PARKOUR_BASE_SPEED + run.distanceM * PARKOUR_SPEED_PER_M)
  return run.elapsedMs < run.dashUntil ? base * PARKOUR_DASH_MULT : base
}

/**
 * 仅供 verify / 单测使用：生成从 0 到 distanceM 的完整赛道，且不在身后裁剪实体。
 * 生产流量请使用 createParkourRun + stepParkour。
 */
export function generateParkourCourseForTest(
  seed: number,
  mode: ParkourMode,
  distanceM: number,
): ParkourRunState {
  const run = createParkourRun({ seed, mode })
  run.lastPruneAt = Number.POSITIVE_INFINITY
  run.distanceM = 0
  ensureParkourAhead(run, Math.max(distanceM, PARKOUR_LOOKAHEAD_M))
  return run
}

/** 创建一局跑酷（同 seed / 同起始点 = 同一条赛道） */
export function createParkourRun(options: CreateParkourRunOptions): ParkourRunState {
  const seed = (options.seed >>> 0) || 1
  const mode: ParkourMode = options.mode ?? 'endless'
  const lane = normalizeLane(options.lane ?? 1)
  const startDistance = Math.max(0, options.startDistanceM ?? 0)
  const run: ParkourRunState = {
    seed,
    mode,
    rngState: seed,
    distanceM: startDistance,
    speed: 0,
    lane,
    targetLane: lane,
    laneX: parkourLaneCenter(lane),
    y: 0,
    vy: 0,
    grounded: true,
    slideHeld: false,
    jumpBufferUntil: 0,
    lastGroundedAt: 0,
    alive: true,
    finished: mode === 'race' && startDistance >= PARKOUR_RACE_LENGTH_M,
    cause: null,
    shield: false,
    magnetUntil: 0,
    dashUntil: 0,
    invincibleUntil: options.invincibleMs ?? 0,
    coins: Math.max(0, Math.floor(options.coins ?? 0)),
    combo: 0,
    maxCombo: Math.max(0, Math.floor(options.maxCombo ?? 0)),
    elapsedMs: 0,
    obstacles: [],
    pickups: [],
    nextObstacleId: 1,
    nextPickupId: 1,
    nextPatternAtM: PARKOUR_FIRST_PATTERN_M,
    nextPowerUpAtM: 120,
    lastLandAt: 0,
    lastCoinAt: 0,
    lastHitAt: 0,
    lastPickupAt: 0,
    lastPickupKind: null,
    lastPruneAt: 0,
  }
  if (run.finished) {
    run.distanceM = PARKOUR_RACE_LENGTH_M
    run.speed = 0
  }
  ensureParkourAhead(run, run.distanceM + PARKOUR_LOOKAHEAD_M)
  return run
}

/** 请求跳跃（地面 / 土狼时间立即起跳；空中按下进入输入缓冲） */
export function requestParkourJump(run: ParkourRunState): boolean {
  if (!run.alive || run.finished) return false
  const canJump = run.grounded || run.elapsedMs - run.lastGroundedAt <= PARKOUR_COYOTE_MS
  if (!canJump) {
    run.jumpBufferUntil = run.elapsedMs + PARKOUR_JUMP_BUFFER_MS
    return false
  }
  performJump(run)
  return true
}

/** 请求换道（-1 左 / +1 右；边界与非法方向忽略） */
export function requestParkourLane(run: ParkourRunState, direction: -1 | 1): boolean {
  if (!run.alive || run.finished) return false
  const next = run.targetLane + direction
  if (next < 0 || next >= PARKOUR_LANES) return false
  run.targetLane = next as ParkourLane
  return true
}

/** 设置滑铲按住状态（空中按住会快速下坠） */
export function setParkourSlide(run: ParkourRunState, held: boolean): void {
  if (!run.alive || run.finished) {
    run.slideHeld = false
    return
  }
  run.slideHeld = held
}

/** 推进一帧（dtMs 会被钳制到 0–60ms，避免后台切回时瞬移） */
export function stepParkour(run: ParkourRunState, dtMs: number): void {
  if (!run.alive || run.finished) return
  const safeDt = Math.max(0, Math.min(60, Number.isFinite(dtMs) ? dtMs : 0))
  if (safeDt <= 0) return
  const dt = safeDt / 1000
  run.elapsedMs += safeDt

  // 水平推进
  run.speed = parkourSpeed(run)
  run.distanceM += run.speed * dt

  // 换道横移（固定 160ms 一条车道）
  const targetX = parkourLaneCenter(run.targetLane)
  const maxStep = (PARKOUR_LANE_WIDTH / (PARKOUR_LANE_CHANGE_MS / 1000)) * dt
  const diff = targetX - run.laneX
  if (Math.abs(diff) <= maxStep) run.laneX = targetX
  else run.laneX += Math.sign(diff) * maxStep
  run.lane = run.targetLane

  // 地面 / 空中与跳跃缓冲
  if (run.grounded && run.jumpBufferUntil >= run.elapsedMs) {
    run.jumpBufferUntil = 0
    performJump(run)
  }
  if (!run.grounded) {
    const gravity = PARKOUR_GRAVITY * (run.slideHeld ? PARKOUR_FAST_FALL_MULT : 1)
    run.vy -= gravity * dt
    run.y += run.vy * dt
    if (run.y <= 0) {
      run.y = 0
      run.vy = 0
      run.grounded = true
      run.lastGroundedAt = run.elapsedMs
      run.lastLandAt = run.elapsedMs
      if (run.jumpBufferUntil >= run.elapsedMs) {
        run.jumpBufferUntil = 0
        performJump(run)
      }
    }
  }

  // 生成 / 清洗
  ensureParkourAhead(run, run.distanceM + PARKOUR_LOOKAHEAD_M)

  // 障碍碰撞
  if (run.alive) collideParkourObstacles(run)
  // 金币与道具
  if (run.alive) collectParkourPickups(run)

  // 竞速终点
  if (run.mode === 'race' && run.distanceM >= PARKOUR_RACE_LENGTH_M) {
    run.distanceM = PARKOUR_RACE_LENGTH_M
    run.speed = 0
    run.finished = true
  }

  pruneParkour(run)
}

// === 内部：跳跃 / 死亡 ===

function normalizeLane(lane: number): ParkourLane {
  const value = Math.floor(lane)
  if (value <= 0) return 0
  if (value >= PARKOUR_LANES - 1) return 2
  return value as ParkourLane
}

function performJump(run: ParkourRunState): void {
  run.grounded = false
  run.y = Math.max(run.y, 0.01)
  run.vy = PARKOUR_JUMP_VELOCITY
  run.slideHeld = false
  run.jumpBufferUntil = 0
}

function markDeath(run: ParkourRunState, cause: ParkourDeathCause): void {
  run.alive = false
  run.cause = cause
  run.combo = 0
  run.lastHitAt = run.elapsedMs
  run.speed = 0
}

/** 当前是否处于冲刺（无敌 + 可飞越坑洞） */
function isDashing(run: ParkourRunState): boolean {
  return run.elapsedMs < run.dashUntil
}

function playerHeight(run: ParkourRunState): number {
  return run.slideHeld ? PARKOUR_SLIDE_HEIGHT : PARKOUR_PLAYER_HEIGHT
}

// === 内部：确定性 RNG（mulberry32，状态保存在 run 上） ===

function nextRandom(run: ParkourRunState): number {
  let t = (run.rngState = (run.rngState + 0x6d2b79f5) >>> 0)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function randomBetween(run: ParkourRunState, min: number, max: number): number {
  return min + nextRandom(run) * (max - min)
}

/** 随机挑选 count 条互不重复的车道（Fisher–Yates，确定性） */
function pickLanes(run: ParkourRunState, count: number): ParkourLane[] {
  const lanes: ParkourLane[] = [0, 1, 2]
  for (let i = lanes.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextRandom(run) * (i + 1))
    const tmp = lanes[i]
    lanes[i] = lanes[j]
    lanes[j] = tmp
  }
  return lanes.slice(0, Math.max(1, Math.min(PARKOUR_LANES, count)))
}

function addObstacle(
  run: ParkourRunState,
  kind: ParkourObstacleKind,
  lane: ParkourLane,
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

function addPickup(
  run: ParkourRunState,
  kind: ParkourPickupKind,
  lane: ParkourLane,
  z: number,
  y: number,
): void {
  run.pickups.push({
    id: run.nextPickupId++,
    kind,
    lane,
    z,
    y,
    taken: false,
  })
}

// === 内部：关卡生成 ===

/**
 * 按 seed 生成障碍图案。每一排只使用一种障碍，排与排之间留出足够的反应 / 落地距离：
 * - train 只占 1 条车道（同排绝不占满 3 条）；
 * - barrier / sign / pit 可占 1–3 条车道；占满 3 条时必须可跳 / 可滑 / 可跨；
 * - 前 40m 净空，前 120m 不出列车；
 * - 金币铺在安全车道或跨越障碍的弧线上，道具避开障碍。
 */
function ensureParkourAhead(run: ParkourRunState, aheadM: number): void {
  let guard = 0
  while (run.nextPatternAtM <= aheadM && guard < 200) {
    guard += 1
    const next = generateParkourPattern(run, run.nextPatternAtM)
    run.nextPatternAtM = Math.max(next, run.nextPatternAtM + 12)
  }

  guard = 0
  while (run.nextPowerUpAtM <= aheadM && guard < 60) {
    guard += 1
    generateParkourPowerUp(run, run.nextPowerUpAtM)
    run.nextPowerUpAtM += 160 + Math.floor(nextRandom(run) * 60)
  }

  if (run.distanceM - run.lastPruneAt >= PARKOUR_PRUNE_BEHIND_M) {
    pruneParkour(run)
  }
}

function generateParkourPattern(run: ParkourRunState, z: number): number {
  const roll = nextRandom(run)
  const canTrain = z >= PARKOUR_FIRST_TRAIN_M
  let kind: ParkourObstacleKind
  if (canTrain && roll < 0.26) kind = 'train'
  else if (roll < 0.54) kind = 'barrier'
  else if (roll < 0.8) kind = 'sign'
  else kind = 'pit'

  if (kind === 'train') return generateTrainRow(run, z)
  if (kind === 'barrier') return generateBarrierRow(run, z)
  if (kind === 'sign') return generateSignRow(run, z)
  return generatePitRow(run, z)
}

function generateTrainRow(run: ParkourRunState, z: number): number {
  const lane = pickLanes(run, 1)[0]
  const length = 10 + nextRandom(run) * 6
  addObstacle(run, 'train', lane, z, z + length, 0, 2.8)
  const safeLanes = [0, 1, 2].filter((laneIndex) => laneIndex !== lane) as ParkourLane[]
  const coinLane = safeLanes[Math.floor(nextRandom(run) * safeLanes.length)]
  addParkourCoinLine(run, coinLane, z + 1, z + length - 1, 1.7, 0.9)
  return z + length + 20 + nextRandom(run) * 6
}

function generateBarrierRow(run: ParkourRunState, z: number): number {
  const count = z < 90 ? 1 : 1 + Math.floor(nextRandom(run) * 3)
  const lanes = pickLanes(run, count)
  for (const lane of lanes) {
    addObstacle(run, 'barrier', lane, z, z + 0.6, 0, 1.1)
  }
  if (count < PARKOUR_LANES) {
    const free = ([0, 1, 2] as ParkourLane[]).filter((lane) => !lanes.includes(lane))
    addParkourCoinLine(run, free[0], z - 4, z + 4, 1.4, 0.9)
  } else {
    addParkourCoinArc(run, lanes[0], z, 1.5)
  }
  return z + 0.6 + 24 + nextRandom(run) * 6
}

function generateSignRow(run: ParkourRunState, z: number): number {
  const count = 1 + Math.floor(nextRandom(run) * 3)
  const lanes = pickLanes(run, count)
  for (const lane of lanes) {
    addObstacle(run, 'sign', lane, z, z + 0.7, 1.6, 2.8)
  }
  if (count < PARKOUR_LANES) {
    const free = ([0, 1, 2] as ParkourLane[]).filter((lane) => !lanes.includes(lane))
    addParkourCoinLine(run, free[0], z - 4, z + 4, 1.4, 0.9)
  } else {
    addParkourCoinLine(run, lanes[0], z - 3, z + 3, 1.2, 0.4)
  }
  return z + 0.7 + 18 + nextRandom(run) * 6
}

function generatePitRow(run: ParkourRunState, z: number): number {
  const count = 1 + Math.floor(nextRandom(run) * 3)
  const lanes = pickLanes(run, count)
  const length = 2.4 + nextRandom(run) * 1.6
  for (const lane of lanes) {
    addObstacle(run, 'pit', lane, z, z + length, 0, 0)
  }
  if (count < PARKOUR_LANES) {
    const free = ([0, 1, 2] as ParkourLane[]).filter((lane) => !lanes.includes(lane))
    addParkourCoinLine(run, free[0], z - 4, z + length + 4, 1.5, 0.9)
  } else {
    addParkourCoinArc(run, lanes[0], z + length / 2, 1.4)
  }
  return z + length + 26 + nextRandom(run) * 6
}

function addParkourCoinLine(
  run: ParkourRunState,
  lane: ParkourLane,
  zStart: number,
  zEnd: number,
  step: number,
  y: number,
): void {
  if (zEnd < zStart) return
  for (let z = zStart; z <= zEnd; z += step) {
    addPickup(run, 'coin', lane, z, y)
  }
}

function addParkourCoinArc(run: ParkourRunState, lane: ParkourLane, zCenter: number, peak: number): void {
  const half = 4
  for (let i = -4; i <= 4; i += 1) {
    const ratio = i / half
    const y = 0.9 + peak * (1 - ratio * ratio)
    addPickup(run, 'coin', lane, zCenter + i * 1.1, y)
  }
}

function generateParkourPowerUp(run: ParkourRunState, z: number): void {
  const kinds: ParkourPickupKind[] = ['shield', 'magnet', 'dash']
  let chosenZ = z
  let chosenLane: ParkourLane | null = null
  for (let attempt = 0; attempt < 8 && chosenLane === null; attempt += 1) {
    const lane = pickLanes(run, 1)[0]
    if (!parkourLaneBlockedAt(run, lane, chosenZ)) {
      chosenLane = lane
      break
    }
    chosenZ += 9
  }
  if (chosenLane === null) return
  const kind = kinds[Math.floor(nextRandom(run) * kinds.length)]
  addPickup(run, kind, chosenLane, chosenZ, 0.9)
}

function parkourLaneBlockedAt(run: ParkourRunState, lane: ParkourLane, z: number): boolean {
  return run.obstacles.some(
    (obstacle) =>
      obstacle.lane === lane
      && z >= obstacle.zStart - 1.2
      && z <= obstacle.zEnd + 1.2,
  )
}

/** 清洗身后的实体与已拾取的道具（每 24m 一次，避免每帧分配数组） */
function pruneParkour(run: ParkourRunState): void {
  if (run.distanceM - run.lastPruneAt < PARKOUR_PRUNE_BEHIND_M) return
  run.lastPruneAt = run.distanceM
  const behind = run.distanceM - PARKOUR_PRUNE_BEHIND_M
  run.obstacles = run.obstacles.filter((obstacle) => obstacle.zEnd >= behind)
  run.pickups = run.pickups.filter((pickup) => !pickup.taken && pickup.z >= behind)
}

// === 内部：碰撞与拾取 ===

function collideParkourObstacles(run: ParkourRunState): void {
  const xMin = run.laneX - PARKOUR_PLAYER_WIDTH / 2
  const xMax = run.laneX + PARKOUR_PLAYER_WIDTH / 2
  const zMin = run.distanceM - PARKOUR_PLAYER_DEPTH / 2
  const zMax = run.distanceM + PARKOUR_PLAYER_DEPTH / 2
  const bottom = run.y
  const top = run.y + playerHeight(run)
  const dashing = isDashing(run)

  for (const obstacle of run.obstacles) {
    if (obstacle.zEnd < zMin || obstacle.zStart > zMax) continue
    const laneCenter = parkourLaneCenter(obstacle.lane)
    const halfLane = PARKOUR_LANE_WIDTH / 2 - 0.15
    if (xMax < laneCenter - halfLane || xMin > laneCenter + halfLane) continue

    if (obstacle.kind === 'pit') {
      if (dashing) continue
      if (run.y <= 0.06) {
        markDeath(run, 'pit')
        return
      }
      continue
    }

    if (top <= obstacle.bottom || bottom >= obstacle.top) continue
    if (dashing || run.elapsedMs < run.invincibleUntil) continue

    run.lastHitAt = run.elapsedMs
    run.combo = 0
    if (run.shield) {
      run.shield = false
      run.invincibleUntil = run.elapsedMs + PARKOUR_SHIELD_INVULN_MS
      return
    }
    markDeath(run, 'hit')
    return
  }
}

function collectParkourPickups(run: ParkourRunState): void {
  const magnet = run.elapsedMs < run.magnetUntil
  for (const pickup of run.pickups) {
    if (pickup.taken) continue
    const zRange = pickup.kind === 'coin' && magnet ? PARKOUR_MAGNET_RANGE_M : PARKOUR_PICKUP_DEPTH_M
    if (Math.abs(pickup.z - run.distanceM) > zRange) continue
    const laneCenter = parkourLaneCenter(pickup.lane)
    const lateral = pickup.kind === 'coin' && magnet ? PARKOUR_TRACK_WIDTH / 2 : (pickup.kind === 'coin' ? PARKOUR_COIN_LATERAL_M : PARKOUR_POWER_LATERAL_M)
    if (Math.abs(laneCenter - run.laneX) > lateral) continue

    pickup.taken = true
    run.lastPickupAt = run.elapsedMs
    run.lastPickupKind = pickup.kind
    if (pickup.kind === 'coin') {
      run.coins += 1
      run.combo += 1
      if (run.combo > run.maxCombo) run.maxCombo = run.combo
      run.lastCoinAt = run.elapsedMs
      continue
    }
    if (pickup.kind === 'shield') {
      run.shield = true
      continue
    }
    if (pickup.kind === 'magnet') {
      run.magnetUntil = Math.max(run.magnetUntil, run.elapsedMs + PARKOUR_MAGNET_MS)
      continue
    }
    run.dashUntil = Math.max(run.dashUntil, run.elapsedMs + PARKOUR_DASH_MS)
  }
}
