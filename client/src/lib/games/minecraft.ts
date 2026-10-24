/**
 * 我的世界（三维体素沙盒）纯函数引擎 —— 单机与联机共用
 *
 * 分层约定（与扫雷 / 贪吃蛇等游戏一致：页面只做渲染与事件分发，规则在引擎）：
 *   - 世界生成：seed → 确定性高度场 + 洞穴 + 矿石 + 树木 → Uint8Array 体素数据；
 *     同一 seed 在任何机器上生成完全相同的世界（联机时各端各自生成，服务端只存修改日志）；
 *   - 物理：逐轴 AABB 碰撞（0.6×1.8 玩家盒）、重力 / 跳跃 / 飞行 / 游泳，
 *     数值对齐原版体感（重力 32 格/s²、步行 4.317、疾跑 5.612、飞行 10.92）；
 *   - 射线：Amanatides & Woo 体素遍历，用于选块 / 破坏 / 放置（触及距离 4.5 格）；
 *   - 修改日志：联机世界的方块修改以 {x,y,z,b} 列表增量同步，本地应用函数与
 *     服务端 gameMinecraftWorld.ts 的校验口径一致（边界 / 基岩层不可改）。
 *
 * 本文件不依赖 DOM / three.js，可在 Node（vitest / 服务端自检脚本）中直接运行。
 * 世界生成部分与 server/src/services/gameMinecraftWorld.ts 为双端同拷贝，
 * 两侧测试用同一批 seed 的世界哈希常量兜底对齐，改动这里必须同步服务端拷贝。
 */

// === 世界常量 ===

/** 世界边长（X/Z 方向方块数，12×12 个区块） */
export const MC_WORLD_SIZE = 192
/** 世界高度（Y 方向方块数；y=0 为基岩层） */
export const MC_WORLD_HEIGHT = 64
/** 区块边长（渲染网格的最小重建单位） */
export const MC_CHUNK_SIZE = 16
/** 每个轴向上的区块数 */
export const MC_CHUNK_COUNT = MC_WORLD_SIZE / MC_CHUNK_SIZE
/** 海平面高度（低于它的露天柱会被水填充） */
export const MC_SEA_LEVEL = 24
/** 雪线高度（山顶覆盖积雪） */
export const MC_SNOW_HEIGHT = 45
/** 树木密度（每根草柱的生成概率） */
export const MC_TREE_DENSITY = 0.006
/** 昼夜循环周期：10 分钟（与原版一天 20 分钟相比加快一倍，个人站节奏更合适） */
export const MC_DAY_LENGTH_MS = 10 * 60_000
/** 单次联机编辑动作允许携带的方块修改数上限 */
export const MC_MAX_EDIT_BATCH = 64
/** 联机世界修改日志总量上限（超过后拒绝新修改，防止内存膨胀） */
export const MC_MAX_WORLD_EDITS = 30_000

// === 方块定义 ===

/** 方块 id（0 = 空气；与 server/src/services/gameMinecraftWorld.ts 逐字对齐） */
export const MC_BLOCK = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  COBBLESTONE: 4,
  PLANKS: 5,
  LOG: 6,
  LEAVES: 7,
  SAND: 8,
  GRAVEL: 9,
  WATER: 10,
  GLASS: 11,
  BRICK: 12,
  SNOW: 13,
  BEDROCK: 14,
  COAL_ORE: 15,
  IRON_ORE: 16,
  DIAMOND_ORE: 17,
} as const

/** 方块数量（含空气），编辑动作的 b 字段校验上界 */
export const MC_BLOCK_COUNT = 18

/** 每个方块的名字（中文，用于物品栏 / 提示） */
export const MC_BLOCK_NAMES: Record<number, string> = {
  0: '空气',
  1: '草方块',
  2: '泥土',
  3: '石头',
  4: '圆石',
  5: '木板',
  6: '橡木原木',
  7: '橡树树叶',
  8: '沙子',
  9: '沙砾',
  10: '水',
  11: '玻璃',
  12: '砖块',
  13: '雪块',
  14: '基岩',
  15: '煤矿石',
  16: '铁矿石',
  17: '钻石矿石',
}

/**
 * 是否参与碰撞（空气与水可穿过；其余全部算实心）。
 * 注意：世界边界外由碰撞函数单独按墙处理，不走这里。
 */
export function mcIsSolid(block: number): boolean {
  return block !== MC_BLOCK.AIR && block !== MC_BLOCK.WATER
}

/** 是否透明（渲染时相邻面不剔除；水 / 玻璃进透明网格，其余进不透明网格） */
export function mcIsTransparent(block: number): boolean {
  return block === MC_BLOCK.AIR || block === MC_BLOCK.WATER || block === MC_BLOCK.GLASS
}

/** 是否可被放置（全部非空气方块都可以放，含基岩；水只能通过地形生成出现） */
export function mcIsPlaceable(block: number): boolean {
  return block !== MC_BLOCK.AIR
}

/** 是否可被破坏（基岩不可破坏，与原版一致） */
export function mcIsBreakable(block: number): boolean {
  return block !== MC_BLOCK.AIR && block !== MC_BLOCK.BEDROCK
}

/** 默认快捷栏（创造模式常用的建材） */
export const MC_DEFAULT_HOTBAR: number[] = [
  MC_BLOCK.GRASS,
  MC_BLOCK.DIRT,
  MC_BLOCK.STONE,
  MC_BLOCK.COBBLESTONE,
  MC_BLOCK.PLANKS,
  MC_BLOCK.LOG,
  MC_BLOCK.LEAVES,
  MC_BLOCK.GLASS,
  MC_BLOCK.BRICK,
]

/** 物品栏可选择的全部方块（水与空气不可选） */
export const MC_PALETTE_BLOCKS: number[] = [
  MC_BLOCK.GRASS,
  MC_BLOCK.DIRT,
  MC_BLOCK.STONE,
  MC_BLOCK.COBBLESTONE,
  MC_BLOCK.PLANKS,
  MC_BLOCK.LOG,
  MC_BLOCK.LEAVES,
  MC_BLOCK.SAND,
  MC_BLOCK.GRAVEL,
  MC_BLOCK.GLASS,
  MC_BLOCK.BRICK,
  MC_BLOCK.SNOW,
  MC_BLOCK.BEDROCK,
  MC_BLOCK.COAL_ORE,
  MC_BLOCK.IRON_ORE,
  MC_BLOCK.DIAMOND_ORE,
]

// === 世界数据 ===

export interface McWorld {
  seed: number
  size: number
  height: number
  /** 柱主序：index = (x * size + z) * height + y，同一柱子的 y 连续存放 */
  data: Uint8Array
}

/** 体素下标（越界行为未定义，调用方先做边界检查） */
export function mcBlockIndex(x: number, y: number, z: number): number {
  return (x * MC_WORLD_SIZE + z) * MC_WORLD_HEIGHT + y
}

/** 读方块；x/z 越界返回空气（渲染边缘可见），y<0 返回基岩（底面碰撞兜底） */
export function mcGetBlock(world: McWorld, x: number, y: number, z: number): number {
  if (y < 0) return MC_BLOCK.BEDROCK
  if (y >= MC_WORLD_HEIGHT || x < 0 || x >= MC_WORLD_SIZE || z < 0 || z >= MC_WORLD_SIZE) {
    return MC_BLOCK.AIR
  }
  return world.data[mcBlockIndex(x, y, z)]
}

/** 写方块；越界静默忽略（调用方一般先自己校验） */
export function mcSetBlock(world: McWorld, x: number, y: number, z: number, block: number): void {
  if (y < 0 || y >= MC_WORLD_HEIGHT) return
  if (x < 0 || x >= MC_WORLD_SIZE || z < 0 || z >= MC_WORLD_SIZE) return
  world.data[mcBlockIndex(x, y, z)] = block
}

// === 确定性噪声（双端同拷贝的核心，勿改动数值参数） ===

/** 整数格点哈希 → [0,1)，确定性；纯整数运算（Math.imul 保证 32 位语义） */
export function mcHash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2654435761)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** 三维格点哈希 → [0,1)（矿石 / 洞穴用） */
export function mcHash3(x: number, y: number, z: number, seed: number): number {
  let h =
    Math.imul(x | 0, 374761393)
    ^ Math.imul(y | 0, 1103515245)
    ^ Math.imul(z | 0, 668265263)
    ^ Math.imul(seed | 0, 2654435761)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** 五次平滑插值曲线（值噪声的淡入淡出） */
function mcFade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function mcLerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** 二维值噪声 [0,1) */
export function mcValueNoise2(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x)
  const z0 = Math.floor(z)
  const u = mcFade(x - x0)
  const v = mcFade(z - z0)
  const a = mcHash2(x0, z0, seed)
  const b = mcHash2(x0 + 1, z0, seed)
  const c = mcHash2(x0, z0 + 1, seed)
  const d = mcHash2(x0 + 1, z0 + 1, seed)
  return mcLerp(mcLerp(a, b, u), mcLerp(c, d, u), v)
}

/** 三维值噪声 [0,1)（洞穴用，单倍频） */
export function mcValueNoise3(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const z0 = Math.floor(z)
  const u = mcFade(x - x0)
  const v = mcFade(y - y0)
  const w = mcFade(z - z0)
  const n000 = mcHash3(x0, y0, z0, seed)
  const n100 = mcHash3(x0 + 1, y0, z0, seed)
  const n010 = mcHash3(x0, y0 + 1, z0, seed)
  const n110 = mcHash3(x0 + 1, y0 + 1, z0, seed)
  const n001 = mcHash3(x0, y0, z0 + 1, seed)
  const n101 = mcHash3(x0 + 1, y0, z0 + 1, seed)
  const n011 = mcHash3(x0, y0 + 1, z0 + 1, seed)
  const n111 = mcHash3(x0 + 1, y0 + 1, z0 + 1, seed)
  return mcLerp(
    mcLerp(mcLerp(n000, n100, u), mcLerp(n010, n110, u), v),
    mcLerp(mcLerp(n001, n101, u), mcLerp(n011, n111, u), v),
    w,
  )
}

/** 分形叠加（fBm）：octaves 个倍频，输出归一化到 [0,1) */
export function mcFbm2(x: number, z: number, seed: number, octaves: number): number {
  let sum = 0
  let amp = 1
  let norm = 0
  let freq = 1
  for (let i = 0; i < octaves; i += 1) {
    sum += mcValueNoise2(x * freq, z * freq, (seed + i * 1013) | 0) * amp
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}

/**
 * 地形高度：基础丘陵 + 细节噪声 + 大陆系数抬升出山脉。
 * 基准 18、海平面 24：fBm 集中在中值 0.5（≈31）附近，低洼柱落到海平面以下形成
 * 湖泊与海滩，45 以上出现雪顶。输出范围约 18–56。
 */
export function mcHeightAt(x: number, z: number, seed: number): number {
  const base = mcFbm2(x / 60, z / 60, seed, 4)
  const detail = mcFbm2(x / 14 + 100, z / 14 + 100, (seed ^ 0x9e3779b9) | 0, 3)
  const mountains = mcFbm2(x / 90 + 555, z / 90 + 555, (seed ^ 0x51ed270b) | 0, 2)
  const h = 18 + base * 20 + detail * 6 + Math.max(0, mountains - 0.55) * 40
  return Math.max(4, Math.min(MC_WORLD_HEIGHT - 8, Math.floor(h)))
}

/** 洞穴判定：三维值噪声超过阈值即挖空（仅作用于石头层内部） */
export function mcIsCave(x: number, y: number, z: number, seed: number): boolean {
  return mcValueNoise3(x / 12, y / 12, z / 12, (seed ^ 0x1234abcd) | 0) > 0.76
}

// === 世界生成（与 server/src/services/gameMinecraftWorld.ts 逐字对齐） ===

/**
 * 由 seed 生成完整世界：分层地形 → 洞穴 → 矿石 → 水体 → 树木。
 * 同一 seed 输出逐字节一致（哈希对齐测试兜底）。
 */
export function mcCreateWorld(seed: number): McWorld {
  const safeSeed = seed >>> 0
  const world: McWorld = {
    seed: safeSeed,
    size: MC_WORLD_SIZE,
    height: MC_WORLD_HEIGHT,
    data: new Uint8Array(MC_WORLD_SIZE * MC_WORLD_SIZE * MC_WORLD_HEIGHT),
  }
  const data = world.data

  // 1. 分层地形：基岩 → 石头（洞穴 / 矿石）→ 泥土 → 地表
  for (let x = 0; x < MC_WORLD_SIZE; x += 1) {
    for (let z = 0; z < MC_WORLD_SIZE; z += 1) {
      const h = mcHeightAt(x, z, safeSeed)
      const base = (x * MC_WORLD_SIZE + z) * MC_WORLD_HEIGHT
      for (let y = 0; y <= h; y += 1) {
        let block: number
        if (y === 0) {
          block = MC_BLOCK.BEDROCK
        } else if (y < h - 3) {
          // 石头层：洞穴优先，其次按深度分层放矿石
          if (y >= 6 && y < h - 4 && mcIsCave(x, y, z, safeSeed)) {
            block = MC_BLOCK.AIR
          } else if (y <= 44 && mcHash3(x, y, z, (safeSeed ^ 0xa1b2c3) | 0) < 0.012) {
            block = MC_BLOCK.COAL_ORE
          } else if (y <= 30 && mcHash3(x, y, z, (safeSeed ^ 0xd4e5f6) | 0) < 0.007) {
            block = MC_BLOCK.IRON_ORE
          } else if (y <= 14 && mcHash3(x, y, z, (safeSeed ^ 0xf7a8b9) | 0) < 0.0022) {
            block = MC_BLOCK.DIAMOND_ORE
          } else {
            block = MC_BLOCK.STONE
          }
        } else if (y < h) {
          block = MC_BLOCK.DIRT
        } else {
          // 地表：沙滩 / 水下沙底 / 雪顶 / 普通草地
          if (h < MC_SEA_LEVEL + 2) {
            block = MC_BLOCK.SAND
          } else if (h >= MC_SNOW_HEIGHT) {
            block = MC_BLOCK.SNOW
          } else {
            block = MC_BLOCK.GRASS
          }
        }
        data[base + y] = block
      }
      // 2. 水体：低于海平面的露天柱从地表之上填到海平面
      if (h < MC_SEA_LEVEL) {
        for (let y = h + 1; y <= MC_SEA_LEVEL; y += 1) {
          data[base + y] = MC_BLOCK.WATER
        }
      }
    }
  }

  // 3. 树木：草地上按确定性哈希撒点，树干 4–6 格 + 球形树冠
  for (let x = 3; x < MC_WORLD_SIZE - 3; x += 1) {
    for (let z = 3; z < MC_WORLD_SIZE - 3; z += 1) {
      if (mcHash2(x, z, (safeSeed ^ 0x77777777) | 0) >= MC_TREE_DENSITY) continue
      const h = mcHeightAt(x, z, safeSeed)
      if (h < MC_SEA_LEVEL + 2 || h >= MC_SNOW_HEIGHT - 1) continue
      const top = data[(x * MC_WORLD_SIZE + z) * MC_WORLD_HEIGHT + h]
      if (top !== MC_BLOCK.GRASS) continue
      const trunk = 4 + Math.floor(mcHash2(x, z, (safeSeed ^ 0x88888888) | 0) * 3)
      const topY = h + trunk
      if (topY + 2 >= MC_WORLD_HEIGHT) continue
      for (let y = h + 1; y <= topY; y += 1) {
        data[(x * MC_WORLD_SIZE + z) * MC_WORLD_HEIGHT + y] = MC_BLOCK.LOG
      }
      for (let dx = -2; dx <= 2; dx += 1) {
        for (let dz = -2; dz <= 2; dz += 1) {
          for (let dy = -1; dy <= 2; dy += 1) {
            const dist = Math.abs(dx) + Math.abs(dz) + Math.abs(dy)
            // 树冠呈球形削边：距树心曼哈顿距离越远越靠外层，外层只保留上部收口
            if (dist > 3 + (dy <= 0 ? 1 : 0)) continue
            const lx = x + dx
            const lz = z + dz
            const ly = topY + dy
            if (lx < 0 || lx >= MC_WORLD_SIZE || lz < 0 || lz >= MC_WORLD_SIZE) continue
            const idx = (lx * MC_WORLD_SIZE + lz) * MC_WORLD_HEIGHT + ly
            if (data[idx] === MC_BLOCK.AIR) data[idx] = MC_BLOCK.LEAVES
          }
        }
      }
    }
  }

  return world
}

/** 柱子的最高实心方块 y（空气 / 水不算）；全空柱返回 -1 */
export function mcSurfaceY(world: McWorld, x: number, z: number): number {
  for (let y = MC_WORLD_HEIGHT - 1; y >= 0; y -= 1) {
    const block = mcGetBlock(world, x, y, z)
    if (block !== MC_BLOCK.AIR && block !== MC_BLOCK.WATER) return y
  }
  return -1
}

/**
 * 出生点：从世界中心螺旋向外找第一根「地表在陆地高度带」的柱子。
 * 返回脚底坐标（方块上表面 +0.01 防止初始卡地）。
 */
export function mcSpawnForSeed(seed: number): { x: number; y: number; z: number } {
  const world = mcCreateWorld(seed)
  const center = Math.floor(MC_WORLD_SIZE / 2)
  for (let radius = 0; radius < center - 3; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        // 只看当前外环，跳过内层已检查过的位置
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue
        const x = center + dx
        const z = center + dz
        const surface = mcSurfaceY(world, x, z)
        if (surface < MC_SEA_LEVEL + 1 || surface >= MC_SNOW_HEIGHT) continue
        const below = mcGetBlock(world, x, surface, z)
        if (below === MC_BLOCK.WATER || below === MC_BLOCK.LEAVES) continue
        return { x: x + 0.5, y: surface + 1.01, z: z + 0.5 }
      }
    }
  }
  // 兜底：中心柱地表（可能在水里，但理论不可达）
  const surface = Math.max(1, mcSurfaceY(world, center, center))
  return { x: center + 0.5, y: surface + 1.01, z: center + 0.5 }
}

/** 世界哈希（FNV-1a 32 位，十六进制字符串）——确定性测试与双端对齐兜底 */
export function mcHashWorld(world: McWorld): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < world.data.length; i += 1) {
    hash ^= world.data[i]
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// === 修改日志（联机增量同步的最小单元） ===

export interface McBlockEdit {
  x: number
  y: number
  z: number
  /** 目标方块 id */
  b: number
}

/** 修改日志的存储键（联机 DTO 与 localStorage 存档共用） */
export function mcEditKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
}

/**
 * 把一批修改应用到本地世界（单机读档 / 联机初始同步共用）。
 * 校验口径与服务端 applyMinecraftEdit 一致：边界内、y=0 基岩层不可改、
 * 与当前值相同则跳过。返回实际应用的条数。
 */
export function mcApplyEdits(world: McWorld, edits: McBlockEdit[]): number {
  let applied = 0
  for (const edit of edits) {
    if (!Number.isInteger(edit.x) || !Number.isInteger(edit.y) || !Number.isInteger(edit.z)) continue
    if (
      edit.x < 0
      || edit.x >= MC_WORLD_SIZE
      || edit.y < 0
      || edit.y >= MC_WORLD_HEIGHT
      || edit.z < 0
      || edit.z >= MC_WORLD_SIZE
    ) {
      continue
    }
    if (!Number.isInteger(edit.b) || edit.b < 0 || edit.b >= MC_BLOCK_COUNT) continue
    if (edit.y === 0) continue
    const index = mcBlockIndex(edit.x, edit.y, edit.z)
    if (world.data[index] === edit.b) continue
    world.data[index] = edit.b
    applied += 1
  }
  return applied
}

// === 玩家物理 ===

/** 玩家碰撞盒宽度（米/格） */
export const MC_PLAYER_WIDTH = 0.6
/** 玩家碰撞盒高度 */
export const MC_PLAYER_HEIGHT = 1.8
/** 视线高度（脚底到眼睛） */
export const MC_EYE_HEIGHT = 1.62
/** 触及距离（选块 / 操作的最大距离） */
export const MC_REACH = 4.5

export const MC_GRAVITY = 32
export const MC_JUMP_VELOCITY = 9.0
export const MC_WALK_SPEED = 4.317
export const MC_SPRINT_SPEED = 5.612
export const MC_SNEAK_SPEED = 1.31
export const MC_FLY_SPEED = 10.92
export const MC_FLY_VERTICAL_SPEED = 7.5
export const MC_TERMINAL_VELOCITY = 50
export const MC_WATER_GRAVITY = 8
export const MC_WATER_MAX_SINK = 3
export const MC_WATER_SWIM_UP = 3.6

export interface McPlayerState {
  /** 脚底中心坐标 */
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** 水平朝向（弧度，0 = -Z 北向，顺时针为正，与 three.js Y 轴旋转一致） */
  yaw: number
  /** 俯仰角（弧度，向上为正） */
  pitch: number
  /** 创造飞行（双击空格切换） */
  flying: boolean
  onGround: boolean
  /** 身体处于水中（游泳物理） */
  inWater: boolean
  /** 眼睛处于水中（渲染水下滤镜） */
  eyeInWater: boolean
}

export interface McPlayerInput {
  /** 前进输入：-1 后退 ~ 1 前进 */
  forward: number
  /** 平移输入：-1 左 ~ 1 右 */
  strafe: number
  jump: boolean
  sneak: boolean
  sprint: boolean
}

export function mcCreatePlayerState(spawn: { x: number; y: number; z: number }): McPlayerState {
  return {
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    flying: false,
    onGround: false,
    inWater: false,
    eyeInWater: false,
  }
}

/** 玩家包围盒是否与某个实心方块重叠（x/z 越界视作边界墙） */
function mcBoxIntersectsSolid(
  world: McWorld,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): boolean {
  const x0 = Math.floor(minX)
  const x1 = Math.floor(maxX)
  const y0 = Math.floor(minY)
  const y1 = Math.floor(maxY)
  const z0 = Math.floor(minZ)
  const z1 = Math.floor(maxZ)
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      for (let z = z0; z <= z1; z += 1) {
        if (x < 0 || x >= MC_WORLD_SIZE || z < 0 || z >= MC_WORLD_SIZE) return true
        if (y < 0) return true
        if (y >= MC_WORLD_HEIGHT) continue
        if (mcIsSolid(world.data[mcBlockIndex(x, y, z)])) return true
      }
    }
  }
  return false
}

/**
 * 推进玩家物理一个子步（dt ≤ 1/60）：
 * 先按朝向合成水平速度，再逐轴（X → Z → Y）积分并做碰撞回退。
 */
function mcStepPlayerSub(world: McWorld, p: McPlayerState, input: McPlayerInput, dt: number): void {
  // 1. 水平速度：朝向合成（yaw = 0 面向 -Z，前进向量 (sin? ) 用标准 three.js 约定）
  const sin = Math.sin(p.yaw)
  const cos = Math.cos(p.yaw)
  // forward 输入沿视线水平投影：(−sin(yaw), −cos(yaw))；strafe 右向 (cos(yaw), −sin(yaw))
  let wishX = -sin * input.forward + cos * input.strafe
  let wishZ = -cos * input.forward - sin * input.strafe
  const wishLen = Math.hypot(wishX, wishZ)
  if (wishLen > 1e-6) {
    wishX /= wishLen
    wishZ /= wishLen
  }

  let speed: number
  if (p.flying) {
    speed = MC_FLY_SPEED
  } else if (input.sneak) {
    speed = MC_SNEAK_SPEED
  } else if (input.sprint && input.forward > 0) {
    speed = MC_SPRINT_SPEED
  } else {
    speed = MC_WALK_SPEED
  }
  if (p.inWater && !p.flying) speed *= 0.5

  p.vx = wishX * speed
  p.vz = wishZ * speed

  // 2. 垂直速度：飞行 / 游泳 / 常规重力
  if (p.flying) {
    const up = (input.jump ? 1 : 0) - (input.sneak ? 1 : 0)
    p.vy = up * MC_FLY_VERTICAL_SPEED
  } else if (p.inWater) {
    p.vy -= MC_WATER_GRAVITY * dt
    if (input.jump) p.vy = Math.min(p.vy + MC_WATER_GRAVITY * 2 * dt + MC_WATER_SWIM_UP * dt * 8, MC_WATER_SWIM_UP)
    p.vy = Math.max(p.vy, -MC_WATER_MAX_SINK)
  } else {
    if (input.jump && p.onGround) {
      p.vy = MC_JUMP_VELOCITY
      p.onGround = false
    }
    p.vy -= MC_GRAVITY * dt
    p.vy = Math.max(p.vy, -MC_TERMINAL_VELOCITY)
  }

  // 3. 逐轴积分 + 碰撞回退（half = 半宽；eps 防浮点粘连）
  const half = MC_PLAYER_WIDTH / 2
  const eps = 1e-3

  p.x += p.vx * dt
  if (mcBoxIntersectsSolid(world, p.x - half, p.y + eps, p.z - half, p.x + half, p.y + MC_PLAYER_HEIGHT - eps, p.z + half)) {
    if (p.vx > 0) p.x = Math.ceil(p.x + half) - half - eps
    else if (p.vx < 0) p.x = Math.floor(p.x - half) + 1 + half + eps
    p.vx = 0
  }

  p.z += p.vz * dt
  if (mcBoxIntersectsSolid(world, p.x - half, p.y + eps, p.z - half, p.x + half, p.y + MC_PLAYER_HEIGHT - eps, p.z + half)) {
    if (p.vz > 0) p.z = Math.ceil(p.z + half) - half - eps
    else if (p.vz < 0) p.z = Math.floor(p.z - half) + 1 + half + eps
    p.vz = 0
  }

  p.y += p.vy * dt
  p.onGround = false
  if (mcBoxIntersectsSolid(world, p.x - half, p.y, p.z - half, p.x + half, p.y + MC_PLAYER_HEIGHT, p.z + half)) {
    if (p.vy <= 0) {
      p.y = Math.ceil(p.y) + eps
      p.onGround = true
    } else {
      p.y = Math.floor(p.y + MC_PLAYER_HEIGHT) - MC_PLAYER_HEIGHT - eps
    }
    p.vy = 0
  }

  // 4. 水检测：脚 +0.4 处为水 → 游泳；眼睛高度为水 → 水下滤镜
  const feetBlock = mcGetBlock(world, Math.floor(p.x), Math.floor(p.y + 0.4), Math.floor(p.z))
  const eyeBlock = mcGetBlock(world, Math.floor(p.x), Math.floor(p.y + MC_EYE_HEIGHT), Math.floor(p.z))
  p.inWater = feetBlock === MC_BLOCK.WATER
  p.eyeInWater = eyeBlock === MC_BLOCK.WATER

  // 5. 掉出世界底部的兜底（理论上 y=0 基岩接住）
  if (p.y < -8) {
    const spawn = mcSpawnForSeed(world.seed)
    p.x = spawn.x
    p.y = spawn.y
    p.z = spawn.z
    p.vy = 0
  }
}

/**
 * 推进玩家物理：内部按 1/60 子步拆分（最多 8 步），帧率波动下碰撞依然稳定。
 * 返回同一个状态对象（就地修改，方便调用方持有引用）。
 */
export function mcStepPlayer(world: McWorld, p: McPlayerState, input: McPlayerInput, dt: number): McPlayerState {
  const clamped = Math.min(Math.max(dt, 0), 0.5)
  const steps = Math.min(8, Math.max(1, Math.ceil(clamped / (1 / 60))))
  const sub = clamped / steps
  for (let i = 0; i < steps; i += 1) {
    mcStepPlayerSub(world, p, input, sub)
  }
  return p
}

/** 眼睛坐标（渲染相机 / 射线起点用） */
export function mcEyePosition(p: McPlayerState): { x: number; y: number; z: number } {
  return { x: p.x, y: p.y + MC_EYE_HEIGHT, z: p.z }
}

// === 体素射线（Amanatides & Woo DDA） ===

export interface McRayHit {
  /** 命中的方块坐标 */
  x: number
  y: number
  z: number
  /** 放置面法线（命中方块朝向玩家的相邻格偏移） */
  nx: number
  ny: number
  nz: number
  /** 命中方块 id */
  block: number
  /** 起点到命中点的距离 */
  distance: number
}

/**
 * 从 origin 沿 dir（须为单位向量）做体素遍历，返回第一个非空气（可选跳过水）命中。
 * 用跨轴步进（tMaxX/Y/Z），每步进入相邻格并记录进入面。
 */
export function mcRaycastVoxel(
  world: McWorld,
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  maxDistance: number = MC_REACH,
  hitWater: boolean = false,
): McRayHit | null {
  let x = Math.floor(origin.x)
  let y = Math.floor(origin.y)
  let z = Math.floor(origin.z)

  const stepX = dir.x > 0 ? 1 : -1
  const stepY = dir.y > 0 ? 1 : -1
  const stepZ = dir.z > 0 ? 1 : -1

  const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity
  const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity
  const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity

  // 到第一个 X/Y/Z 格边界的距离
  let tMaxX = dir.x !== 0 ? ((dir.x > 0 ? x + 1 - origin.x : origin.x - x) * tDeltaX) : Infinity
  let tMaxY = dir.y !== 0 ? ((dir.y > 0 ? y + 1 - origin.y : origin.y - y) * tDeltaY) : Infinity
  let tMaxZ = dir.z !== 0 ? ((dir.z > 0 ? z + 1 - origin.z : origin.z - z) * tDeltaZ) : Infinity

  let nx = 0
  let ny = 0
  let nz = 0
  let t = 0

  for (let i = 0; i < 256; i += 1) {
    const block = mcGetBlock(world, x, y, z)
    if (block !== MC_BLOCK.AIR && (hitWater || block !== MC_BLOCK.WATER)) {
      return { x, y, z, nx, ny, nz, block, distance: t }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX
      t = tMaxX
      tMaxX += tDeltaX
      nx = -stepX
      ny = 0
      nz = 0
    } else if (tMaxY < tMaxZ) {
      y += stepY
      t = tMaxY
      tMaxY += tDeltaY
      nx = 0
      ny = -stepY
      nz = 0
    } else {
      z += stepZ
      t = tMaxZ
      tMaxZ += tDeltaZ
      nx = 0
      ny = 0
      nz = -stepZ
    }
    if (t > maxDistance) return null
    if (y < -1 || y > MC_WORLD_HEIGHT + 1) return null
  }
  return null
}

/** 目标放置格是否与玩家包围盒重叠（放置前校验，防止把自己封进方块里） */
export function mcEditIntersectsPlayer(edit: McBlockEdit, p: McPlayerState): boolean {
  const half = MC_PLAYER_WIDTH / 2
  return (
    edit.x + 1 > p.x - half
    && edit.x < p.x + half
    && edit.y + 1 > p.y
    && edit.y < p.y + MC_PLAYER_HEIGHT
    && edit.z + 1 > p.z - half
    && edit.z < p.z + half
  )
}
