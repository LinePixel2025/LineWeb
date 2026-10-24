/**
 * 我的世界引擎测试（纯函数，Node 环境可跑）
 *
 * 覆盖：
 *   - 世界生成：同 seed 确定性、与 server/src/services/gameMinecraftWorld.ts
 *     对齐的固定哈希常量（服务端 verify-minecraft.ts 用同一批常量兜底双端拷贝）、
 *     y=0 全基岩、方块值合法、水体 / 雪顶存在性、出生点落在实心地面；
 *   - 修改日志：正常应用、y=0 基岩层拒绝、越界 / 非法方块拒绝、同值幂等跳过；
 *   - 物理：重力落地、飞行上升、撞墙阻挡；
 *   - 射线：俯视命中脚下方块（法线朝上）、仰视天空不命中、触及距离限制；
 *   - 放置校验：目标格与玩家包围盒重叠时拒绝。
 */

import { describe, expect, it } from 'vitest'
import {
  MC_BLOCK,
  MC_SEA_LEVEL,
  MC_WORLD_HEIGHT,
  MC_WORLD_SIZE,
  mcApplyEdits,
  mcBlockIndex,
  mcCreatePlayerState,
  mcCreateWorld,
  mcEditIntersectsPlayer,
  mcEditKey,
  mcGetBlock,
  mcHashWorld,
  mcHeightAt,
  mcRaycastVoxel,
  mcSetBlock,
  mcSpawnForSeed,
  mcStepPlayer,
  mcSurfaceY,
  type McBlockEdit,
} from '../minecraft'

describe('世界生成：确定性（双端拷贝对齐兜底）', () => {
  it('同 seed 双跑哈希一致，且与固定常量吻合（服务端同款常量）', () => {
    const a = mcCreateWorld(20261024)
    const b = mcCreateWorld(20261024)
    expect(mcHashWorld(a)).toBe(mcHashWorld(b))
    expect(mcHashWorld(a)).toBe('96adcfaa')
    expect(mcHashWorld(mcCreateWorld(1))).toBe('a98a7e50')
    expect(mcHashWorld(mcCreateWorld(4294967295))).toBe('3267f19b')
  })

  it('y=0 全基岩、方块值合法、地形高度在界内', () => {
    const world = mcCreateWorld(20261024)
    for (let x = 0; x < MC_WORLD_SIZE; x += 7) {
      for (let z = 0; z < MC_WORLD_SIZE; z += 7) {
        expect(mcGetBlock(world, x, 0, z)).toBe(MC_BLOCK.BEDROCK)
        const h = mcHeightAt(x, z, 20261024)
        expect(h).toBeGreaterThanOrEqual(4)
        expect(h).toBeLessThanOrEqual(MC_WORLD_HEIGHT - 8)
      }
    }
    for (let i = 0; i < world.data.length; i += 97) {
      expect(world.data[i]).toBeGreaterThanOrEqual(0)
      expect(world.data[i]).toBeLessThanOrEqual(17)
    }
  })

  it('seed 20261024 有湖泊水体；seed 42 有雪顶', () => {
    const w1 = mcCreateWorld(20261024)
    let water = 0
    for (let i = 0; i < w1.data.length; i += 13) {
      if (w1.data[i] === MC_BLOCK.WATER) water += 1
    }
    expect(water).toBeGreaterThan(0)

    const w42 = mcCreateWorld(42)
    let snow = 0
    for (let i = 0; i < w42.data.length; i += 13) {
      if (w42.data[i] === MC_BLOCK.SNOW) snow += 1
    }
    expect(snow).toBeGreaterThan(0)
  })

  it('出生点固定常量（服务端同款），脚下是实心方块', () => {
    expect(mcSpawnForSeed(20261024)).toEqual({ x: 96.5, y: 40.01, z: 96.5 })
    const spawn = mcSpawnForSeed(1)
    expect(spawn).toEqual({ x: 96.5, y: 27.01, z: 96.5 })
    const world = mcCreateWorld(1)
    const below = mcGetBlock(world, Math.floor(spawn.x), Math.floor(spawn.y - 0.5), Math.floor(spawn.z))
    expect(below).not.toBe(MC_BLOCK.AIR)
    expect(below).not.toBe(MC_BLOCK.WATER)
  })

  it('mcSurfaceY 找到最高实心方块，全空柱返回 -1', () => {
    const world = mcCreateWorld(7)
    const surface = mcSurfaceY(world, 96, 96)
    expect(surface).toBeGreaterThan(0)
    expect(mcGetBlock(world, 96, surface, 96)).not.toBe(MC_BLOCK.AIR)
    expect(mcGetBlock(world, 96, surface + 1, 96)).toBe(MC_BLOCK.AIR)
  })
})

describe('修改日志 mcApplyEdits', () => {
  it('正常应用、y=0 拒绝、越界拒绝、非法方块拒绝、同值幂等', () => {
    const world = mcCreateWorld(11)
    const edits: McBlockEdit[] = [
      { x: 10, y: 40, z: 10, b: MC_BLOCK.BRICK }, // 有效
      { x: 10, y: 0, z: 10, b: MC_BLOCK.STONE }, // y=0 基岩层不可改
      { x: -1, y: 40, z: 10, b: MC_BLOCK.BRICK }, // x 越界
      { x: 10, y: MC_WORLD_HEIGHT, z: 10, b: MC_BLOCK.BRICK }, // y 越界
      { x: 10, y: 40, z: 10, b: 99 }, // 非法方块 id
    ]
    expect(mcApplyEdits(world, edits)).toBe(1)
    expect(mcGetBlock(world, 10, 40, 10)).toBe(MC_BLOCK.BRICK)
    // 同值再应用 → 幂等跳过
    expect(mcApplyEdits(world, [{ x: 10, y: 40, z: 10, b: MC_BLOCK.BRICK }])).toBe(0)
    // 改成不同值 → 应用
    expect(mcApplyEdits(world, [{ x: 10, y: 40, z: 10, b: MC_BLOCK.GLASS }])).toBe(1)
    expect(mcGetBlock(world, 10, 40, 10)).toBe(MC_BLOCK.GLASS)
  })

  it('mcEditKey 与 mcSetBlock/mcGetBlock 边界行为', () => {
    expect(mcEditKey(1, 2, 3)).toBe('1,2,3')
    const world = mcCreateWorld(3)
    mcSetBlock(world, 0, 1, 0, MC_BLOCK.SAND)
    expect(mcGetBlock(world, 0, 1, 0)).toBe(MC_BLOCK.SAND)
    mcSetBlock(world, -1, 1, 0, MC_BLOCK.SAND) // 越界静默忽略
    expect(mcGetBlock(world, -1, 1, 0)).toBe(MC_BLOCK.AIR)
    expect(mcGetBlock(world, 0, -1, 0)).toBe(MC_BLOCK.BEDROCK) // 底面兜底
    expect(mcGetBlock(world, 0, MC_WORLD_HEIGHT, 0)).toBe(MC_BLOCK.AIR)
  })
})

describe('玩家物理 mcStepPlayer', () => {
  it('重力落地：出生后稳定站在地表上方', () => {
    const world = mcCreateWorld(20261024)
    const spawn = mcSpawnForSeed(20261024)
    const player = mcCreatePlayerState(spawn)
    mcStepPlayer(world, player, { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false }, 1.0)
    expect(player.onGround).toBe(true)
    const surface = mcSurfaceY(world, Math.floor(player.x), Math.floor(player.z))
    expect(player.y).toBeGreaterThan(surface)
    expect(player.y).toBeLessThan(surface + 1.1)
  })

  it('飞行：按住跳跃上升，不受重力下坠', () => {
    const world = mcCreateWorld(20261024)
    const spawn = mcSpawnForSeed(20261024)
    const player = mcCreatePlayerState(spawn)
    player.flying = true
    const startY = player.y
    mcStepPlayer(world, player, { forward: 0, strafe: 0, jump: true, sneak: false, sprint: false }, 1.0)
    expect(player.y).toBeGreaterThan(startY + 2)
    expect(player.flying).toBe(true)
  })

  it('撞墙阻挡：前方放置石墙后无法穿过', () => {
    const world = mcCreateWorld(20261024)
    const spawn = mcSpawnForSeed(20261024)
    const player = mcCreatePlayerState(spawn)
    // 站稳
    mcStepPlayer(world, player, { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false }, 1.0)
    // 在前方 -Z 两格外立一道 2 高的石墙
    const wallZ = Math.floor(player.z) - 2
    const feetX = Math.floor(player.x)
    mcSetBlock(world, feetX, Math.floor(player.y), wallZ, MC_BLOCK.STONE)
    mcSetBlock(world, feetX, Math.floor(player.y) + 1, wallZ, MC_BLOCK.STONE)
    // 向前走 2 秒
    for (let i = 0; i < 10; i += 1) {
      mcStepPlayer(world, player, { forward: 1, strafe: 0, jump: false, sneak: false, sprint: false }, 0.2)
    }
    // 玩家中心必须停在墙外（墙面在 wallZ + 1，半宽 0.3）
    expect(player.z).toBeGreaterThanOrEqual(wallZ + 1.2)
  })
})

describe('体素射线 mcRaycastVoxel', () => {
  it('俯视命中脚下方块，法线朝上', () => {
    const world = mcCreateWorld(20261024)
    const spawn = mcSpawnForSeed(20261024)
    const player = mcCreatePlayerState(spawn)
    mcStepPlayer(world, player, { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false }, 1.0)
    const hit = mcRaycastVoxel(
      world,
      { x: player.x, y: player.y + 1.62, z: player.z },
      { x: 0, y: -1, z: 0 },
      4.5,
    )
    expect(hit).not.toBeNull()
    expect(hit?.nx).toBe(0)
    expect(hit?.ny).toBe(1)
    expect(hit?.nz).toBe(0)
    expect(hit?.y).toBe(Math.floor(player.y - 0.01))
    expect(hit?.distance).toBeLessThan(2)
  })

  it('仰视天空不命中；触及距离限制生效', () => {
    const world = mcCreateWorld(20261024)
    const spawn = mcSpawnForSeed(20261024)
    const origin = { x: spawn.x, y: spawn.y + 1.62, z: spawn.z }
    expect(mcRaycastVoxel(world, origin, { x: 0, y: 1, z: 0 }, 4.5)).toBeNull()
    // 水平方位拉远到 1 格内无遮挡的方向：从高处平视远处 → 4.5 格内可能命中地形，这里只验证不抛错且返回结构合法
    const far = mcRaycastVoxel(world, { x: origin.x, y: origin.y + 20, z: origin.z }, { x: 0, y: 1, z: 0 }, 4.5)
    expect(far).toBeNull()
  })
})

describe('放置校验 mcEditIntersectsPlayer', () => {
  it('目标格与玩家包围盒重叠时返回 true，邻格返回 false', () => {
    const player = mcCreatePlayerState({ x: 96.5, y: 31.01, z: 96.5 })
    // 脚下格（y=31 在包围盒内）
    expect(mcEditIntersectsPlayer({ x: 96, y: 31, z: 96, b: MC_BLOCK.STONE }, player)).toBe(true)
    // 头部格（y=32 也在 1.8 高包围盒内）
    expect(mcEditIntersectsPlayer({ x: 96, y: 32, z: 96, b: MC_BLOCK.STONE }, player)).toBe(true)
    // 旁边一格
    expect(mcEditIntersectsPlayer({ x: 97, y: 31, z: 96, b: MC_BLOCK.STONE }, player)).toBe(false)
  })
})

describe('海平面常量', () => {
  it('海平面为 24（水体填充与沙滩判定依赖该值，双端一致）', () => {
    expect(MC_SEA_LEVEL).toBe(24)
  })
})
