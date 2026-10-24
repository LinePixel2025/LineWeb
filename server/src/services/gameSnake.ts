/**
 * 贪吃蛇大地图纯规则引擎（服务端权威）
 *
 * 纯函数、无 IO、无隐式随机源：随机数由世界状态里显式携带的 `rngState`（mulberry32）
 * 逐步推进，因此「相同 seed + 相同座位」必然得到完全相同的世界，
 * 便于自检脚本复现，也便于联机各端补拉到同一份棋盘。
 *
 * 规则口径（40×40 大地图，2–8 条蛇同场）：
 * - 蛇身数组头部在前；每一步所有存活蛇同时把 pendingDirection 落成 direction，
 *   再各自向前伸出一格（同步推进，不存在先后手）；
 * - 撞墙（越界）即死亡；头撞「任何蛇」的身体（含自己，但不含自身将被这一步
 *   移除的尾巴格）即死亡；两条蛇头同一步进入同一格 → 双方都死亡；
 * - 果实分普通果（+10 分、长 1 格）与金果（+30 分、长 3 格，出现概率
 *   SNAKE_BIG_CHANCE）；增长方式就是「这一步不移除尾巴」（金果再多复制两格尾巴），
 *   吃掉后立即在空位补种同数量果实，全场始终保持 SNAKE_FOOD_COUNT 个；
 * - 存活蛇数 ≤ 1 时 world.over = true，服务层据此结算胜负；
 * - 已结束的世界再次调用 stepSnakeWorld 不做任何修改（幂等，不产生漂移）。
 */

// === 方向与坐标 ===

/** 蛇的移动方向 */
export type SnakeDirection = 'up' | 'down' | 'left' | 'right'

/** 网格坐标 */
export interface SnakeCell {
  x: number
  y: number
}

/** 出生点（头部坐标 + 初始朝向） */
export interface SnakeSpawnPoint extends SnakeCell {
  direction: SnakeDirection
}

// === 尺寸与规则常量 ===

/** 大地图宽度（格） */
export const SNAKE_MAP_WIDTH = 40
/** 大地图高度（格） */
export const SNAKE_MAP_HEIGHT = 40
/** 服务端推进一步的时间间隔（毫秒） */
export const SNAKE_STEP_MS = 220
/** 初始蛇身长度（含头部） */
export const SNAKE_START_LENGTH = 4
/** 同时在场果实数（吃掉即时补种） */
export const SNAKE_FOOD_COUNT = 6
/** 补种时生成为金果的概率 */
export const SNAKE_BIG_CHANCE = 0.18
/** 普通果增长格数 */
export const SNAKE_GROW_NORMAL = 1
/** 金果增长格数 */
export const SNAKE_GROW_BIG = 3
/** 普通果得分 */
export const SNAKE_SCORE_NORMAL = 10
/** 金果得分 */
export const SNAKE_SCORE_BIG = 30

/**
 * 8 个固定出生点（按座位号取用）：四角 + 四边中点，彼此隔开至少 4 格，
 * 初始朝向都指向场地中央，且初始蛇身（向反方向延伸 3 格）不会越界或互相重叠。
 */
export const SNAKE_SPAWN_POINTS: SnakeSpawnPoint[] = [
  { x: 5, y: 5, direction: 'right' },
  { x: 19, y: 3, direction: 'down' },
  { x: 34, y: 5, direction: 'down' },
  { x: 36, y: 19, direction: 'left' },
  { x: 34, y: 34, direction: 'left' },
  { x: 19, y: 36, direction: 'up' },
  { x: 5, y: 34, direction: 'up' },
  { x: 3, y: 19, direction: 'right' },
]

/** 方向 → 单位位移（y 轴向下为正，'up' 即 y 减小） */
const STEP_VECTORS: Record<SnakeDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
}

/** 方向 → 反向（用于禁止 180° 掉头） */
const OPPOSITE_DIRECTION: Record<SnakeDirection, SnakeDirection> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
}

// === 世界结构 ===

/** 世界中的一条蛇（body 头部在前；已出局时 body 为空） */
export interface SnakeWorldPlayer {
  /** 玩家（用户）id */
  id: number
  /** 配色索引（0–7，由座位决定） */
  colorIndex: number
  body: SnakeCell[]
  /** 服务端当前生效方向 */
  direction: SnakeDirection
  /** 已提交、下一步生效的方向（无则 null） */
  pendingDirection: SnakeDirection | null
  score: number
  alive: boolean
  /** 死亡发生在第几步（未死亡为 null） */
  deathStep: number | null
}

/** 地图上的果实（big = 金果） */
export interface SnakeWorldFood extends SnakeCell {
  big: boolean
}

/** 一步之内产生的事件（吃果 / 死亡），按座位顺序生成 */
export interface SnakeWorldEvent {
  kind: 'eat' | 'dead'
  /** 玩家（用户）id */
  userId: number
}

/** 可确定性复现的大地图世界 */
export interface SnakeWorld {
  width: number
  height: number
  /** 已执行步数 */
  step: number
  players: SnakeWorldPlayer[]
  foods: SnakeWorldFood[]
  /** mulberry32 随机状态（显式携带，保证纯函数可复现） */
  rngState: number
  over: boolean
}

/** 开局座位（出生点由服务层按座位分配） */
export interface SnakeSeatSpec {
  id: number
  colorIndex: number
  x: number
  y: number
  direction: SnakeDirection
}

// === 工具 ===

/** 格子唯一键（用于占据集合去重） */
export function snakeCellKey(cell: SnakeCell): string {
  return `${cell.x},${cell.y}`
}

/** 是否互为反向（180° 掉头） */
export function isOppositeSnakeDirection(from: SnakeDirection, to: SnakeDirection): boolean {
  return OPPOSITE_DIRECTION[to] === from
}

/**
 * mulberry32 单步推进（纯函数）：返回下一状态与 [0,1) 随机值。
 * 世界只保存 `rngState`，因此同一 seed 下果实位置与金果判定完全可复现。
 */
export function nextSnakeRandom(state: number): { state: number; value: number } {
  const next = (state + 0x6D2B79F5) | 0
  let t = Math.imul(next ^ (next >>> 15), 1 | next)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return { state: next >>> 0, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/** 按出生方向向反方向铺开初始蛇身（头部在前，长度 SNAKE_START_LENGTH） */
export function createSnakeBody(x: number, y: number, direction: SnakeDirection): SnakeCell[] {
  const vector = STEP_VECTORS[direction]
  const body: SnakeCell[] = []
  for (let index = 0; index < SNAKE_START_LENGTH; index += 1) {
    body.push({ x: x - vector.dx * index, y: y - vector.dy * index })
  }
  return body
}

/** 当前存活的蛇数 */
export function countAliveSnakes(world: SnakeWorld): number {
  let count = 0
  for (const player of world.players) {
    if (player.alive) count += 1
  }
  return count
}

/** 在空位（不含任何蛇身与已有果实）随机补种一个果实；无空位返回 false */
function spawnSnakeFood(world: SnakeWorld): boolean {
  const taken = new Set<string>()
  for (const player of world.players) {
    if (!player.alive) continue
    for (const cell of player.body) taken.add(snakeCellKey(cell))
  }
  for (const food of world.foods) taken.add(snakeCellKey(food))

  const free: SnakeCell[] = []
  for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) {
      if (!taken.has(`${x},${y}`)) free.push({ x, y })
    }
  }
  if (free.length === 0) return false

  // 固定顺序：先抽空位下标，再抽是否金果
  const positionDraw = nextSnakeRandom(world.rngState)
  world.rngState = positionDraw.state
  const bigDraw = nextSnakeRandom(world.rngState)
  world.rngState = bigDraw.state
  const index = Math.min(free.length - 1, Math.floor(positionDraw.value * free.length))
  const cell = free[index]
  world.foods.push({ x: cell.x, y: cell.y, big: bigDraw.value < SNAKE_BIG_CHANCE })
  return true
}

// === 开局 ===

/**
 * 按 seed 与座位生成世界（相同 seed + 相同座位 → 完全相同的世界）。
 * 果实不会落在任何蛇身或已有果实上。
 */
export function createSnakeWorld(seed: number, seats: SnakeSeatSpec[]): SnakeWorld {
  const world: SnakeWorld = {
    width: SNAKE_MAP_WIDTH,
    height: SNAKE_MAP_HEIGHT,
    step: 0,
    players: seats.map((seat) => ({
      id: seat.id,
      colorIndex: seat.colorIndex,
      body: createSnakeBody(seat.x, seat.y, seat.direction),
      direction: seat.direction,
      pendingDirection: null,
      score: 0,
      alive: true,
      deathStep: null,
    })),
    foods: [],
    rngState: seed >>> 0,
    over: false,
  }
  for (let index = 0; index < SNAKE_FOOD_COUNT; index += 1) spawnSnakeFood(world)
  return world
}

// === 输入 ===

/**
 * 提交下一步方向：
 * - 玩家不存在 / 已出局 / 方向非法 → false；
 * - 与当前 direction 互为 180° 反向 → false，且不写入 pendingDirection；
 * - 其余情况写入 pendingDirection（下一步生效）→ true。
 */
export function setSnakeTurn(world: SnakeWorld, playerId: number, direction: SnakeDirection): boolean {
  if (!(direction in STEP_VECTORS)) return false
  const player = world.players.find((candidate) => candidate.id === playerId)
  if (!player || !player.alive) return false
  if (isOppositeSnakeDirection(player.direction, direction)) return false
  player.pendingDirection = direction
  return true
}

// === 推进一步 ===

/** 单步内的移动候选（含座位下标与新头部） */
interface SnakeMover {
  player: SnakeWorldPlayer
  /** 座位下标（用于占据掩码与死亡判定） */
  seat: number
  head: SnakeCell
  tailKey: string
  dead: boolean
}

/**
 * 推进一步：所有存活蛇同时前进一格，按「撞墙 / 撞身 / 蛇头相撞 → 死亡」
 * 「吃到果实 → 加分并按增长格数延长并补种」的顺序结算。
 *
 * 返回本步事件（按座位顺序，每步只产生一次），供服务层广播播报；
 * world.over 之后重复调用不会修改世界。
 */
export function stepSnakeWorld(world: SnakeWorld): { events: SnakeWorldEvent[] } {
  const events: SnakeWorldEvent[] = []
  // 已结束（或只剩一条蛇）的世界不再推进：重复调用不产生漂移
  if (world.over || countAliveSnakes(world) <= 1) {
    world.over = true
    return { events }
  }

  // 1. 同时把 pendingDirection 落成 direction，并计算各自的新头部
  const movers: SnakeMover[] = []
  for (let seat = 0; seat < world.players.length; seat += 1) {
    const player = world.players[seat]
    if (!player.alive) continue
    if (player.pendingDirection !== null) {
      player.direction = player.pendingDirection
      player.pendingDirection = null
    }
    const vector = STEP_VECTORS[player.direction]
    const head = { x: player.body[0].x + vector.dx, y: player.body[0].y + vector.dy }
    const tail = player.body[player.body.length - 1]
    movers.push({ player, seat, head, tailKey: snakeCellKey(tail), dead: false })
  }

  // 2. 本步开始前的占据掩码：key → 哪些座位占了这格（座位 ≤ 8，用位掩码即可）
  const occupancy = new Map<string, number>()
  for (const mover of movers) {
    const mask = 1 << mover.seat
    for (const cell of mover.player.body) {
      const key = snakeCellKey(cell)
      occupancy.set(key, (occupancy.get(key) ?? 0) | mask)
    }
  }
  // 蛇头相撞统计（两条蛇头同一步进入同一格 → 双方都死亡）
  const headCount = new Map<string, number>()
  for (const mover of movers) {
    const key = snakeCellKey(mover.head)
    headCount.set(key, (headCount.get(key) ?? 0) + 1)
  }

  for (const mover of movers) {
    const headKey = snakeCellKey(mover.head)
    const mask = occupancy.get(headKey) ?? 0
    const ownMask = 1 << mover.seat
    const outOfBounds =
      mover.head.x < 0 || mover.head.x >= world.width || mover.head.y < 0 || mover.head.y >= world.height
    const hitOther = (mask & ~ownMask) !== 0
    // 自身尾巴格会被这一步移除，故不算碰撞
    const hitSelf = (mask & ownMask) !== 0 && headKey !== mover.tailKey
    const headClash = (headCount.get(headKey) ?? 0) > 1
    mover.dead = outOfBounds || hitOther || hitSelf || headClash
  }

  // 3. 落子：先处理死亡，再让存活蛇前进并结算吃果
  const foodAt = new Map<string, SnakeWorldFood>()
  for (const food of world.foods) foodAt.set(snakeCellKey(food), food)
  const eaten: SnakeWorldFood[] = []

  for (const mover of movers) {
    if (mover.dead) {
      mover.player.alive = false
      mover.player.deathStep = world.step
      mover.player.body = []
      mover.player.pendingDirection = null
      events.push({ kind: 'dead', userId: mover.player.id })
      continue
    }
    const tail = mover.player.body[mover.player.body.length - 1]
    mover.player.body.unshift({ x: mover.head.x, y: mover.head.y })
    const food = foodAt.get(snakeCellKey(mover.head))
    if (!food) {
      mover.player.body.pop()
      continue
    }
    // 增长方式 = 这一步不移除尾巴（金果再多复制两格尾巴，之后每步恢复「进一格、出一格」）
    const grow = food.big ? SNAKE_GROW_BIG : SNAKE_GROW_NORMAL
    for (let extra = 1; extra < grow; extra += 1) {
      mover.player.body.push({ x: tail.x, y: tail.y })
    }
    mover.player.score += food.big ? SNAKE_SCORE_BIG : SNAKE_SCORE_NORMAL
    events.push({ kind: 'eat', userId: mover.player.id })
    eaten.push(food)
  }

  // 4. 吃掉的果实移除，并立即在空位补种同数量果实
  if (eaten.length > 0) {
    const removed = new Set<SnakeWorldFood>(eaten)
    world.foods = world.foods.filter((food) => !removed.has(food))
    for (let index = 0; index < eaten.length; index += 1) spawnSnakeFood(world)
  }

  // 5. 存活蛇数 ≤ 1 → 世界结束；否则步数前进一步
  if (countAliveSnakes(world) <= 1) world.over = true
  world.step += 1
  return { events }
}
