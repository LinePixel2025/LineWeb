/**
 * 贪吃蛇纯规则引擎（单机冲分 + 同屏双人）
 *
 * 设计约束：
 * - 纯 TypeScript，不依赖 React / DOM，可在 vitest 里直接断言；
 * - 状态为可 JSON 序列化的普通对象（RNG 只存数字状态），便于回放与测试；
 * - 大地图好友联机不使用本文件规则（服务端权威），这里只导出共用的常量与几何 helper。
 *
 * 方向类型 `SnakeDirection` 与 `client/src/types/game.ts` 的契约保持字面量一致。
 */

/** 蛇的移动方向（与联机契约 types/game.ts 的 SnakeDirection 一致） */
export type SnakeDirection = 'up' | 'down' | 'left' | 'right'

/** 网格坐标（列 x 向右、行 y 向下） */
export interface SnakePoint {
  x: number
  y: number
}

/** 格子上的果实（big = 金果，加分更多、更长） */
export interface SnakeFood extends SnakePoint {
  big: boolean
}

/** 单机 20×20 */
export const SNAKE_SOLO_SIZE = 20
/** 同屏双人 24×24 */
export const SNAKE_VERSUS_SIZE = 24
/** 大地图联机 40×40（渲染参考值，实际尺寸以服务端 DTO 为准） */
export const SNAKE_ONLINE_SIZE = 40

/** 座位配色（8 个高对比色，同屏双人与大地图联机共用同一份） */
export const SNAKE_COLORS: string[] = [
  '#2f9e44', // 绿（P1 / 1 号位）
  '#1971c2', // 蓝（P2 / 2 号位）
  '#c2255c', // 洋红
  '#e8590c', // 橙
  '#6741d9', // 紫
  '#0ca678', // 青绿
  '#f59f00', // 琥珀
  '#09bcd5', // 天青
]

/** 已出局蛇的灰色（与座位色共用一份色板语义） */
export const SNAKE_DEAD_COLOR = '#8c959f'

/** 速度档位：每步毫秒数 */
export const SNAKE_SPEED_LEVELS = {
  慢: 220,
  中: 150,
  快: 100,
} as const

/** 速度档位名 */
export type SnakeSpeedLevel = keyof typeof SNAKE_SPEED_LEVELS

/** 档位展示顺序 */
export const SNAKE_SPEED_ORDER: SnakeSpeedLevel[] = ['慢', '中', '快']

/** 普通果分值 */
export const SNAKE_NORMAL_SCORE = 10
/** 金果分值 */
export const SNAKE_BIG_SCORE = 30
/** 吃普通果变长 */
export const SNAKE_GROW_NORMAL = 1
/** 吃金果变长 */
export const SNAKE_GROW_BIG = 3
/** 每吃多少个果提速一次 */
export const SNAKE_SPEED_UP_EVERY = 5
/** 每次提速比例（5%） */
export const SNAKE_SPEED_UP_FACTOR = 0.95
/** 提速后的最小步长（毫秒），避免快到无法操作 */
export const SNAKE_MIN_STEP_MS = 60
/** 吃果后金果出现的概率 */
export const SNAKE_BIG_FOOD_CHANCE = 0.25
/** 金果存在步数（超时消失） */
export const SNAKE_BIG_FOOD_TTL_STEPS = 40
/** 初始蛇长 */
export const SNAKE_INITIAL_LENGTH = 3
/** 同屏双人场上同时存在的普通果数量 */
export const SNAKE_VERSUS_FOODS = 2
/** 配色数量 */
export const SNAKE_COLOR_COUNT = SNAKE_COLORS.length

/** 方向 → 单位位移 */
const DIRECTION_DELTA: Record<SnakeDirection, SnakePoint> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

/** 反向表（用于禁止 180° 掉头） */
const OPPOSITE_DIRECTION: Record<SnakeDirection, SnakeDirection> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
}

export const SNAKE_DIRECTIONS: SnakeDirection[] = ['up', 'down', 'left', 'right']

// ==================== 几何 / RNG helper ====================

/** 格子唯一键（放进 Set 做 occupancy 判断） */
export function snakeKey(p: SnakePoint): string {
  return `${p.x},${p.y}`
}

/** 两点是否同格 */
export function samePoint(a: SnakePoint, b: SnakePoint): boolean {
  return a.x === b.x && a.y === b.y
}

/** 方向单位位移 */
export function directionDelta(direction: SnakeDirection): SnakePoint {
  return DIRECTION_DELTA[direction]
}

/** 是否互为反向 */
export function isOppositeDirection(a: SnakeDirection, b: SnakeDirection): boolean {
  return OPPOSITE_DIRECTION[a] === b
}

/**
 * mulberry32 确定性伪随机数生成器（与后端 game2048 引擎同算法）。
 * 返回 [0, 1) 的浮点数；同一种子序列完全一致。
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 把数字状态推进一格并返回 [0,1) 随机数（状态可序列化，方便测试确定性） */
function nextRandom(state: { rngState: number }): number {
  state.rngState = (state.rngState + 0x6d2b79f5) >>> 0
  let t = state.rngState
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** 生成一个可用的随机种子 */
export function randomSnakeSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
}

/** 按座位取色（座位号越界自动取模） */
export function snakeColorForSeat(seat: number): string {
  const index = ((seat % SNAKE_COLOR_COUNT) + SNAKE_COLOR_COUNT) % SNAKE_COLOR_COUNT
  return SNAKE_COLORS[index]
}

// ==================== 单机 ====================

export interface SoloSnakeState {
  /** 边长（正方形网格） */
  size: number
  /** 基准步长（毫秒，速度档位决定） */
  baseStepMs: number
  /** 当前生效步长（毫秒，随吃果提速） */
  stepMs: number
  /** 蛇身，头部在前 */
  snake: SnakePoint[]
  /** 当前生效方向 */
  direction: SnakeDirection
  /** 本步待生效方向（防止一步内连按两次导致 180° 掉头） */
  pendingDirection: SnakeDirection | null
  /** 尚未兑现的生长格数 */
  pendingGrowth: number
  /** 场上果实（始终至少一颗普通果，金果偶尔出现） */
  foods: SnakeFood[]
  /** 金果剩余步数（0 = 不在场） */
  bigFoodTtl: number
  score: number
  /** 已吃果数（含金果） */
  eaten: number
  /** 已走步数 */
  step: number
  alive: boolean
  rngState: number
}

export interface SoloStepResult {
  /** 本步是否吃到果 */
  ate: boolean
  /** 吃到的是金果 */
  big: boolean
  /** 本步结束后蛇已死亡 */
  dead: boolean
}

/** 按已吃果数计算当前步长 */
export function soloStepMsFor(eaten: number, baseStepMs: number): number {
  const level = Math.floor(eaten / SNAKE_SPEED_UP_EVERY)
  return Math.max(SNAKE_MIN_STEP_MS, Math.round(baseStepMs * SNAKE_SPEED_UP_FACTOR ** level))
}

/** 创建单机局面 */
export function createSoloSnakeState(
  opts: { size?: number; speedMs?: number; seed?: number } = {}
): SoloSnakeState {
  const size = Math.max(8, Math.floor(opts.size ?? SNAKE_SOLO_SIZE));
  const baseStepMs = Math.max(SNAKE_MIN_STEP_MS, opts.speedMs ?? SNAKE_SPEED_LEVELS['中'])
  const row = Math.floor(size / 2)
  const headX = Math.min(size - 3, Math.max(2, Math.floor(size / 4)))
  const snake: SnakePoint[] = []
  for (let i = 0; i < SNAKE_INITIAL_LENGTH; i += 1) snake.push({ x: headX - i, y: row })

  const state: SoloSnakeState = {
    size,
    baseStepMs,
    stepMs: baseStepMs,
    snake,
    direction: 'right',
    pendingDirection: null,
    pendingGrowth: 0,
    foods: [],
    bigFoodTtl: 0,
    score: 0,
    eaten: 0,
    step: 0,
    alive: true,
    rngState: (opts.seed ?? randomSnakeSeed()) >>> 0,
  }
  const food = spawnSoloFood(state, false)
  if (food) state.foods.push(food)
  return state
}

/** 切换速度档位（立即生效，已吃果的提速层级保留） */
export function setSoloBaseSpeed(state: SoloSnakeState, speedMs: number): void {
  state.baseStepMs = Math.max(SNAKE_MIN_STEP_MS, speedMs)
  state.stepMs = soloStepMsFor(state.eaten, state.baseStepMs)
}

/**
 * 提交方向。
 * 拒绝：游戏已结束 / 与当前生效方向相同或互为反向（禁 180° 掉头）。
 */
export function setSoloDirection(state: SoloSnakeState, direction: SnakeDirection): boolean {
  if (!state.alive) return false
  const effective = state.pendingDirection ?? state.direction
  if (effective === direction) return false
  if (isOppositeDirection(effective, direction)) return false
  state.pendingDirection = direction
  return true
}

/** 占用位（蛇身 + 已有果实） */
function soloOccupied(state: SoloSnakeState): Set<string> {
  const used = new Set<string>()
  for (const cell of state.snake) used.add(snakeKey(cell))
  for (const food of state.foods) used.add(snakeKey(food))
  return used
}

/** 在空闲格随机生成一颗果；棋盘满时返回 null */
function spawnSoloFood(state: SoloSnakeState, big: boolean): SnakeFood | null {
  const used = soloOccupied(state)
  const free: SnakePoint[] = []
  for (let y = 0; y < state.size; y += 1) {
    for (let x = 0; x < state.size; x += 1) {
      if (!used.has(`${x},${y}`)) free.push({ x, y })
    }
  }
  if (free.length === 0) return null
  const pick = free[Math.min(free.length - 1, Math.floor(nextRandom(state) * free.length))]
  return { x: pick.x, y: pick.y, big }
}

/** 前进一步（原地修改 state） */
export function stepSoloSnake(state: SoloSnakeState): SoloStepResult {
  if (!state.alive) return { ate: false, big: false, dead: true }

  if (state.pendingDirection) {
    state.direction = state.pendingDirection
    state.pendingDirection = null
  }

  const delta = DIRECTION_DELTA[state.direction]
  const head = state.snake[0] ?? { x: 0, y: 0 }
  const next: SnakePoint = { x: head.x + delta.x, y: head.y + delta.y }

  // 撞墙
  if (next.x < 0 || next.y < 0 || next.x >= state.size || next.y >= state.size) {
    state.alive = false
    return { ate: false, big: false, dead: true }
  }

  const eatIndex = state.foods.findIndex((food) => samePoint(food, next))
  const willGrow = eatIndex >= 0 || state.pendingGrowth > 0

  // 撞自己：不吃果时尾巴格会腾出，可以走
  const body = willGrow ? state.snake : state.snake.slice(0, -1)
  if (body.some((cell) => samePoint(cell, next))) {
    state.alive = false
    return { ate: false, big: false, dead: true }
  }

  state.snake.unshift(next)
  state.step += 1

  let ate = false
  let big = false
  if (eatIndex >= 0) {
    const food = state.foods.splice(eatIndex, 1)[0]
    ate = true
    big = food.big
    state.score += food.big ? SNAKE_BIG_SCORE : SNAKE_NORMAL_SCORE
    // 变长在接下来的 grow 步里逐步兑现（每步跳过一次缩尾），避免蛇身出现重叠格
    state.pendingGrowth += food.big ? SNAKE_GROW_BIG : SNAKE_GROW_NORMAL
    state.eaten += 1
    if (food.big) state.bigFoodTtl = 0
  }

  if (state.pendingGrowth > 0) state.pendingGrowth -= 1
  else state.snake.pop()

  // 保证场上始终有一颗普通果
  if (!state.foods.some((food) => !food.big)) {
    const food = spawnSoloFood(state, false)
    if (food) state.foods.push(food)
  }

  // 金果：按概率出现、限时消失
  if (state.bigFoodTtl > 0) {
    state.bigFoodTtl -= 1
    if (state.bigFoodTtl === 0) {
      state.foods = state.foods.filter((food) => !food.big)
    }
  } else if (ate && !state.foods.some((food) => food.big)) {
    if (nextRandom(state) < SNAKE_BIG_FOOD_CHANCE) {
      const gold = spawnSoloFood(state, true)
      if (gold) {
        state.foods.push(gold)
        state.bigFoodTtl = SNAKE_BIG_FOOD_TTL_STEPS
      }
    }
  }

  state.stepMs = soloStepMsFor(state.eaten, state.baseStepMs)
  return { ate, big, dead: !state.alive }
}

// ==================== 同屏双人 ====================

export interface VersusSnakeState {
  size: number
  baseStepMs: number
  stepMs: number
  /** [P1, P2] 蛇身，头部在前 */
  snakes: [SnakePoint[], SnakePoint[]]
  directions: [SnakeDirection, SnakeDirection]
  pendingDirections: [SnakeDirection | null, SnakeDirection | null]
  pendingGrowth: [number, number]
  scores: [number, number]
  eaten: [number, number]
  alive: [boolean, boolean]
  foods: SnakeFood[]
  step: number
  /** 本局已分胜负 */
  finished: boolean
  /** 胜者座位；平局或仍在打为 null */
  winner: 0 | 1 | null
  /** 已结束局数用的回合号 */
  round: number
  rngState: number
}

export interface VersusStepResult {
  /** [P1 死亡, P2 死亡] */
  dead: [boolean, boolean]
  /** 胜者座位；null = 平局或双方仍在对局 */
  winner: 0 | 1 | null
}

/** 创建同屏双人局面：P1 绿、左侧出生朝右（WASD）；P2 蓝、右侧出生朝左（方向键） */
export function createVersusSnakeState(opts: { size?: number; seed?: number } = {}): VersusSnakeState {
  const size = Math.max(12, Math.floor(opts.size ?? SNAKE_VERSUS_SIZE))
  const baseStepMs = SNAKE_SPEED_LEVELS['中']
  const midRow = Math.floor(size / 2)
  const p1Row = Math.max(1, midRow - 2)
  const p2Row = Math.min(size - 2, midRow + 2)

  const p1: SnakePoint[] = []
  for (let i = 0; i < SNAKE_INITIAL_LENGTH; i += 1) p1.push({ x: 3 + SNAKE_INITIAL_LENGTH - 1 - i, y: p1Row })
  const p2: SnakePoint[] = []
  for (let i = 0; i < SNAKE_INITIAL_LENGTH; i += 1) p2.push({ x: size - 4 - i, y: p2Row })

  const state: VersusSnakeState = {
    size,
    baseStepMs,
    stepMs: baseStepMs,
    snakes: [p1, p2],
    directions: ['right', 'left'],
    pendingDirections: [null, null],
    pendingGrowth: [0, 0],
    scores: [0, 0],
    eaten: [0, 0],
    alive: [true, true],
    foods: [],
    step: 0,
    finished: false,
    winner: null,
    round: 1,
    rngState: (opts.seed ?? randomSnakeSeed()) >>> 0,
  }

  for (let i = 0; i < SNAKE_VERSUS_FOODS; i += 1) {
    const food = spawnVersusFood(state, false)
    if (food) state.foods.push(food)
  }
  return state
}

/** 切换同屏速度档位 */
export function setVersusBaseSpeed(state: VersusSnakeState, speedMs: number): void {
  state.baseStepMs = Math.max(SNAKE_MIN_STEP_MS, speedMs)
  state.stepMs = state.baseStepMs
}

/** 提交某位玩家的方向；禁 180° 掉头，已结束/已死亡一律拒绝 */
export function setVersusDirection(
  state: VersusSnakeState,
  player: 0 | 1,
  direction: SnakeDirection
): boolean {
  if (state.finished || !state.alive[player]) return false
  const effective = state.pendingDirections[player] ?? state.directions[player]
  if (effective === direction) return false
  if (isOppositeDirection(effective, direction)) return false
  state.pendingDirections[player] = direction
  return true
}

function versusOccupied(state: VersusSnakeState): Set<string> {
  const used = new Set<string>()
  for (const snake of state.snakes) for (const cell of snake) used.add(snakeKey(cell))
  for (const food of state.foods) used.add(snakeKey(food))
  return used
}

function spawnVersusFood(state: VersusSnakeState, big: boolean): SnakeFood | null {
  const used = versusOccupied(state)
  const free: SnakePoint[] = []
  for (let y = 0; y < state.size; y += 1) {
    for (let x = 0; x < state.size; x += 1) {
      if (!used.has(`${x},${y}`)) free.push({ x, y })
    }
  }
  if (free.length === 0) return null
  const pick = free[Math.min(free.length - 1, Math.floor(nextRandom(state) * free.length))]
  return { x: pick.x, y: pick.y, big }
}

/** 同屏双人的生长层级：金果 +3、普通果 +1 */
function versusGrowAmount(big: boolean): number {
  return big ? SNAKE_GROW_BIG : SNAKE_GROW_NORMAL
}

/**
 * 同屏双人前进一步（两条蛇同时结算）。
 * 判定顺序：撞墙 / 双头对撞（含换位）→ 撞对方蛇身 → 撞自己。
 * 双头同格 = 双方同死判平局；只有先死一方判负。
 */
export function stepVersusSnake(state: VersusSnakeState): VersusStepResult {
  if (state.finished) {
    return {
      dead: [!state.alive[0], !state.alive[1]],
      winner: state.winner,
    }
  }

  for (const seat of [0, 1] as const) {
    const pending = state.pendingDirections[seat]
    if (pending) {
      state.directions[seat] = pending
      state.pendingDirections[seat] = null
    }
  }

  const heads: SnakePoint[] = state.snakes.map((snake) => snake[0] ?? { x: -1, y: -1 })
  const nextHeads: SnakePoint[] = heads.map((head, seat) => {
    const delta = DIRECTION_DELTA[state.directions[seat]]
    return { x: head.x + delta.x, y: head.y + delta.y }
  })

  // 本步是否吃到果（决定尾巴会不会腾出）
  const eatIndex: Array<number> = [0, 1].map((seat) =>
    state.alive[seat] ? state.foods.findIndex((food) => samePoint(food, nextHeads[seat])) : -1
  )
  const willGrow: Array<boolean> = [0, 1].map(
    (seat) => eatIndex[seat] >= 0 || state.pendingGrowth[seat] > 0
  )

  const dead: [boolean, boolean] = [!state.alive[0], !state.alive[1]]
  const headOn = state.alive[0] && state.alive[1] && samePoint(nextHeads[0], nextHeads[1])
  // 对穿换位：A 进 B 的头、B 进 A 的头 → 同样判双头对撞
  const crossed =
    state.alive[0]
    && state.alive[1]
    && samePoint(nextHeads[0], heads[1])
    && samePoint(nextHeads[1], heads[0])

  for (const seat of [0, 1] as const) {
    if (!state.alive[seat]) continue
    const other = (seat === 0 ? 1 : 0) as 0 | 1
    const next = nextHeads[seat]

    const outOfBounds = next.x < 0 || next.y < 0 || next.x >= state.size || next.y >= state.size
    if (outOfBounds) {
      dead[seat] = true
      continue
    }
    if (headOn || crossed) {
      dead[seat] = true
      continue
    }

    // 撞对方蛇身：对方蛇头会让开，故跳过对方头部格；对方尾巴不生长时会让开
    const otherBody = willGrow[other] ? state.snakes[other] : state.snakes[other].slice(0, -1)
    const hitOther = otherBody.slice(1).some((cell) => samePoint(cell, next))
    if (hitOther) {
      dead[seat] = true
      continue
    }

    // 撞自己
    const ownBody = willGrow[seat] ? state.snakes[seat] : state.snakes[seat].slice(0, -1)
    if (ownBody.some((cell) => samePoint(cell, next))) {
      dead[seat] = true
      continue
    }
  }

  state.step += 1

  const claimed = new Set<number>()
  for (const seat of [0, 1] as const) {
    if (dead[seat]) {
      state.alive[seat] = false
      continue
    }
    state.snakes[seat].unshift(nextHeads[seat])
    const index = eatIndex[seat]
    if (index >= 0 && !claimed.has(index)) {
      claimed.add(index)
      const food = state.foods[index]
      state.pendingGrowth[seat] += versusGrowAmount(food.big)
      state.scores[seat] += food.big ? SNAKE_BIG_SCORE : SNAKE_NORMAL_SCORE
      state.eaten[seat] += 1
    }
    if (state.pendingGrowth[seat] > 0) state.pendingGrowth[seat] -= 1
    else state.snakes[seat].pop()
  }

  if (claimed.size > 0) {
    state.foods = state.foods.filter((_, index) => !claimed.has(index))
  }
  while (state.foods.length < SNAKE_VERSUS_FOODS) {
    const food = spawnVersusFood(state, false)
    if (!food) break
    state.foods.push(food)
  }

  if (dead[0] && dead[1]) {
    state.finished = true
    state.winner = null
  } else if (dead[0]) {
    state.finished = true
    state.winner = 1
  } else if (dead[1]) {
    state.finished = true
    state.winner = 0
  } else {
    state.winner = null
  }

  return { dead: [!state.alive[0], !state.alive[1]], winner: state.winner }
}

// ==================== 本机记录（localStorage，全部容错） ====================

/** 单机最高分存储键 */
export const SNAKE_BEST_STORAGE_KEY = 'lineweb.snake.best'
/** 同屏双人战绩存储键 */
export const SNAKE_VERSUS_STORAGE_KEY = 'lineweb.snake.versus'

/** 同屏双人战绩 */
export interface VersusRecord {
  /** P1 胜场 */
  p1: number
  /** P2 胜场 */
  p2: number
  /** 平局场 */
  draws: number
}

/** 最小可用的存储接口（jsdom / 隐私模式 / SSR 都可能是 null 或抛异常） */
interface KvStore {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

function getStore(): KvStore | null {
  try {
    const storage = (globalThis as { localStorage?: KvStore }).localStorage
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      return null
    }
    return storage
  } catch {
    return null
  }
}

function safeGet(key: string): string | null {
  const store = getStore()
  if (!store) return null
  try {
    return store.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  const store = getStore()
  if (!store) return
  try {
    store.setItem(key, value)
  } catch {
    // 配额超限 / 隐私模式：仅影响本机记录持久化
  }
}

/** 读取单机最高分（异常或脏数据返回 0） */
export function loadSnakeBest(): number {
  const raw = safeGet(SNAKE_BEST_STORAGE_KEY)
  if (!raw) return 0
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * 写入单机分数，只升不降。
 * 返回落库后的最高分（存储不可用时返回传入分数，保证 UI 逻辑一致）。
 */
export function saveSnakeBest(score: number): number {
  const current = loadSnakeBest()
  const safeScore = Number.isFinite(score) && score > 0 ? Math.floor(score) : 0
  const next = Math.max(current, safeScore)
  if (!Number.isFinite(score) || score <= 0) return current
  safeSet(SNAKE_BEST_STORAGE_KEY, String(next))
  return next
}

/** 读取同屏双人战绩 */
export function loadVersusRecord(): VersusRecord {
  const raw = safeGet(SNAKE_VERSUS_STORAGE_KEY)
  if (!raw) return { p1: 0, p2: 0, draws: 0 }
  try {
    const parsed = JSON.parse(raw) as Partial<VersusRecord>
    const toCount = (value: unknown): number => {
      const num = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
      return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0
    }
    return { p1: toCount(parsed.p1), p2: toCount(parsed.p2), draws: toCount(parsed.draws) }
  } catch {
    return { p1: 0, p2: 0, draws: 0 }
  }
}

/**
 * 累计一局同屏双人的结果（winner：0 = P1 胜、1 = P2 胜、null = 平局）。
 * 返回落库后的战绩（存储不可用时仍返回内存中的累加值）。
 */
export function saveVersusResult(winner: 0 | 1 | null): VersusRecord {
  const current = loadVersusRecord()
  const next: VersusRecord = { ...current }
  if (winner === 0) next.p1 += 1
  else if (winner === 1) next.p2 += 1
  else next.draws += 1
  safeSet(SNAKE_VERSUS_STORAGE_KEY, JSON.stringify(next))
  return next
}
