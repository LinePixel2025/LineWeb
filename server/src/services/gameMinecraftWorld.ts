/**
 * 我的世界（体素沙盒）服务端世界生成 —— 客户端引擎的双端同拷贝（子集）
 *
 * 与 client/src/lib/games/minecraft.ts 的世界生成部分逐字对齐（同一批函数体）：
 * 联机时服务端**不保存完整世界**，只保存 seed + 方块修改日志；玩家位置、出生点、
 * 编辑合法性（边界 / 基岩层）都用这份拷贝推导，各客户端按同一 seed 本地生成世界。
 *
 * ⚠️ 修改这里必须同步客户端拷贝：两侧测试用同一批 seed 的世界哈希常量兜底，
 * 任一侧改动导致哈希不一致都会让 verify / vitest 失败。
 *
 * 本文件刻意不包含物理 / 射线 / 纹理元数据（服务端不模拟运动、不做渲染）。
 */

// === 世界常量（与客户端逐字对齐） ===

/** 世界边长（X/Z 方向方块数，12×12 个区块） */
export const MC_WORLD_SIZE = 192
/** 世界高度（Y 方向方块数；y=0 为基岩层） */
export const MC_WORLD_HEIGHT = 64
/** 区块边长（仅用于与客户端常量对齐，服务端不网格化） */
export const MC_CHUNK_SIZE = 16
/** 每个轴向上的区块数 */
export const MC_CHUNK_COUNT = MC_WORLD_SIZE / MC_CHUNK_SIZE
/** 海平面高度（低于它的露天柱会被水填充） */
export const MC_SEA_LEVEL = 24
/** 雪线高度（山顶覆盖积雪） */
export const MC_SNOW_HEIGHT = 45
/** 树木密度（每根草柱的生成概率） */
export const MC_TREE_DENSITY = 0.006
/** 联机世界修改日志总量上限（超过后拒绝新修改，防止内存膨胀） */
export const MC_MAX_WORLD_EDITS = 30_000

// === 方块定义（与客户端逐字对齐） ===

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

export interface McWorld {
  seed: number
  size: number
  height: number
  /** 柱主序：index = (x * size + z) * height + y，同一柱子的 y 连续存放 */
  data: Uint8Array
}

export function mcBlockIndex(x: number, y: number, z: number): number {
  return (x * MC_WORLD_SIZE + z) * MC_WORLD_HEIGHT + y
}

export function mcGetBlock(world: McWorld, x: number, y: number, z: number): number {
  if (y < 0) return MC_BLOCK.BEDROCK
  if (y >= MC_WORLD_HEIGHT || x < 0 || x >= MC_WORLD_SIZE || z < 0 || z >= MC_WORLD_SIZE) {
    return MC_BLOCK.AIR
  }
  return world.data[mcBlockIndex(x, y, z)]
}

export function mcSetBlock(world: McWorld, x: number, y: number, z: number, block: number): void {
  if (y < 0 || y >= MC_WORLD_HEIGHT) return
  if (x < 0 || x >= MC_WORLD_SIZE || z < 0 || z >= MC_WORLD_SIZE) return
  world.data[mcBlockIndex(x, y, z)] = block
}

// === 确定性噪声（与客户端逐字对齐，勿改动数值参数） ===

export function mcHash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2654435761)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

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

function mcFade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function mcLerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

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

export function mcHeightAt(x: number, z: number, seed: number): number {
  const base = mcFbm2(x / 60, z / 60, seed, 4)
  const detail = mcFbm2(x / 14 + 100, z / 14 + 100, (seed ^ 0x9e3779b9) | 0, 3)
  const mountains = mcFbm2(x / 90 + 555, z / 90 + 555, (seed ^ 0x51ed270b) | 0, 2)
  const h = 18 + base * 20 + detail * 6 + Math.max(0, mountains - 0.55) * 40
  return Math.max(4, Math.min(MC_WORLD_HEIGHT - 8, Math.floor(h)))
}

export function mcIsCave(x: number, y: number, z: number, seed: number): boolean {
  return mcValueNoise3(x / 12, y / 12, z / 12, (seed ^ 0x1234abcd) | 0) > 0.76
}

// === 世界生成（与 client/src/lib/games/minecraft.ts 逐字对齐） ===

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

export function mcSurfaceY(world: McWorld, x: number, z: number): number {
  for (let y = MC_WORLD_HEIGHT - 1; y >= 0; y -= 1) {
    const block = mcGetBlock(world, x, y, z)
    if (block !== MC_BLOCK.AIR && block !== MC_BLOCK.WATER) return y
  }
  return -1
}

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

export function mcHashWorld(world: McWorld): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < world.data.length; i += 1) {
    hash ^= world.data[i]
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// === 修改日志 ===

export interface McBlockEdit {
  x: number
  y: number
  z: number
  /** 目标方块 id */
  b: number
}

export function mcEditKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
}
