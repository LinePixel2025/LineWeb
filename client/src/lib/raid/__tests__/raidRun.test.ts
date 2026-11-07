import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  RAID_EXTRACT_CHANNEL_MS,
  RAID_GEAR_SHOP_PREMIUM,
  RAID_GEARS,
  RAID_ITEMS,
  RAID_MAPS,
  RAID_TILE_WALL,
  addItemToContainer,
  applyRaidEvent,
  createRaidRun,
  gearStorageGate,
  generateRaidMap,
  getRaidMap,
  raidInsuranceCost,
  raidSellPrice,
  raidShopGearPrice,
  raidShopItemPrice,
  rarityWeightAtTier,
  repairRaidGear,
  resolveRaidDamage,
  type RaidRunState,
} from '../raidRun'

const SERVER_ENGINE = resolve(process.cwd(), '../server/src/lib/raidRun.ts')
const CLIENT_ENGINE = resolve(process.cwd(), 'src/lib/raid/raidRun.ts')

function readNormalized(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
}

/**
 * 地图生成与事件校验必须双端完全一致：客户端逐字副本一旦漂移，
 * 服务端按 seed 重算的地图就会与客户端显示不同，开箱/拾取会全部被判非法。
 */
describe('raidRun 双端同拷贝', () => {
  it('客户端副本与服务端逐字一致', () => {
    expect(readNormalized(CLIENT_ENGINE)).toBe(readNormalized(SERVER_ENGINE))
  })
})

describe('raidRun 目录', () => {
  it('物品与装备目录规模正确', () => {
    expect(RAID_ITEMS.length).toBeGreaterThanOrEqual(48)
    expect(RAID_GEARS.length).toBe(32)
    expect(new Set(RAID_ITEMS.map((item) => item.key)).size).toBe(RAID_ITEMS.length)
    expect(new Set(RAID_GEARS.map((gear) => gear.key)).size).toBe(RAID_GEARS.length)
  })

  it('六档品质都有物品，神话只在最高档地图掉落', () => {
    const rarities = new Set(RAID_ITEMS.map((item) => item.rarity))
    expect(rarities.size).toBe(6)
    expect(RAID_ITEMS.filter((item) => item.rarity === 'mythic').length).toBeGreaterThanOrEqual(2)
    expect(rarityWeightAtTier('mythic', 4, 'normal')).toBe(0)
    expect(rarityWeightAtTier('mythic', 5, 'normal')).toBeGreaterThan(0)
    expect(rarityWeightAtTier('mythic', 5, 'pvp')).toBeGreaterThan(0)
  })

  it('非洲之心两种模式都能掉：权重 0.25、价值 30000、不进首领保底池', () => {
    const heart = RAID_ITEMS.find((item) => item.key === 'heart_of_africa')
    expect(heart).toBeTruthy()
    expect((heart as unknown as Record<string, unknown>).pvpOnly).toBeUndefined()
    expect(heart?.retired).toBeUndefined()
    expect(heart?.weight).toBe(0.25)
    expect(heart?.value).toBe(30000)
    expect(heart?.pityEligible).toBe(false)
  })

  it('旧撤离信号弹已停产：保留目录数据但不再掉落', () => {
    const flare = RAID_ITEMS.find((item) => item.key === 'extract_flare')
    expect(flare?.retired).toBe(true)
    expect((flare as unknown as Record<string, unknown>).guaranteeExtract).toBeUndefined()
  })

  it('商店全档上架：1–3 级平价、4 级及以上 ×2 且要仓库等级门槛', () => {
    const shopable = RAID_GEARS.filter((gear) => gear.shopable)
    // 2026-11-04：装备不再「只卖 1–3 级」，高档改为「贵 + 仓库等级门槛」
    expect(shopable.length).toBe(RAID_GEARS.length)
    expect(RAID_GEARS.filter((gear) => gear.tier <= 3).every((gear) => gearStorageGate(gear.tier) === 0)).toBe(true)
    expect(RAID_GEARS.filter((gear) => gear.tier >= 4).every((gear) => gearStorageGate(gear.tier) > 0)).toBe(true)
    expect(RAID_GEARS.filter((gear) => gear.tier <= 3).every((gear) => raidShopGearPrice(gear.key) === gear.price)).toBe(true)
    expect(
      RAID_GEARS.filter((gear) => gear.tier >= 4).every(
        (gear) => raidShopGearPrice(gear.key) === Math.ceil(gear.price * RAID_GEAR_SHOP_PREMIUM),
      ),
    ).toBe(true)
  })

  it('回收价与商店价符合规则', () => {
    expect(raidSellPrice('scrap_metal', 2)).toBe(70)
    expect(raidSellPrice('medkit', 1)).toBe(72)
    expect(raidSellPrice('gear_cache', 1)).toBe(182)
    expect(raidShopItemPrice('medkit')).toBe(168)
    expect(raidShopGearPrice('helmet_t1')).toBe(150)
  })
})

describe('raidRun 地图生成', () => {
  const map = generateRaidMap(123456, getRaidMap('wasteland')!)

  it('同一 seed 完全一致', () => {
    expect(JSON.stringify(generateRaidMap(123456, getRaidMap('wasteland')!))).toBe(JSON.stringify(map))
  })

  it('不同 seed 生成不同地图', () => {
    expect(JSON.stringify(generateRaidMap(654321, getRaidMap('wasteland')!))).not.toBe(JSON.stringify(map))
  })

  it('房间全部连通且起点无敌人', () => {
    const reachable = new Set<number>([0])
    const queue = [0]
    while (queue.length > 0) {
      const current = queue.shift() as number
      for (const next of map.rooms[current]?.neighbors ?? []) {
        if (reachable.has(next)) continue
        reachable.add(next)
        queue.push(next)
      }
    }
    expect(reachable.size).toBe(map.rooms.length)
    expect(map.rooms[0]?.kind).toBe('start')
    expect(map.rooms[0]?.enemies.length).toBe(0)
  })

  it('撤离房间数量与配置一致', () => {
    const def = getRaidMap('wasteland')!
    expect(map.rooms.filter((room) => room.kind === 'extract').length).toBe(def.extractRooms)
    expect(map.extracts.length).toBe(def.extractRooms)
  })

  it('容器掉落都在目录里', () => {
    const keys = new Set(RAID_ITEMS.map((item) => item.key))
    for (const room of map.rooms) {
      for (const container of room.containers) {
        for (const loot of container.loot) {
          expect(keys.has(loot.itemKey)).toBe(true)
        }
      }
    }
  })

  it('七张地图都能生成', () => {
    expect(RAID_MAPS).toHaveLength(7)
    for (const def of RAID_MAPS) {
      const generated = generateRaidMap(42, def)
      expect(generated.rooms.length).toBe(def.cols * def.rows)
      expect(generated.tiles.length).toBe(generated.width * generated.height)
    }
  })

  it('日蚀要塞：室内隔断存在，且全图地板（含隔断房）完全连通', () => {
    const citadel = getRaidMap('citadel')!
    expect(citadel.difficulty).toBe('nightmare')
    expect(citadel.interior).toBe('fortress')
    expect(citadel.gimmick?.kind).toBe('orbital')
    const generated = generateRaidMap(20261107, citadel)
    let interiorWalls = 0
    for (const room of generated.rooms) {
      for (let y = room.y + 2; y < room.y + room.h - 2; y += 1) {
        for (let x = room.x + 2; x < room.x + room.w - 2; x += 1) {
          if (generated.tiles[y * generated.width + x] === RAID_TILE_WALL) interiorWalls += 1
        }
      }
      for (const enemy of room.enemies) {
        expect(generated.tiles[enemy.y * generated.width + enemy.x]).not.toBe(RAID_TILE_WALL)
      }
      for (const container of room.containers) {
        expect(generated.tiles[container.y * generated.width + container.x]).not.toBe(RAID_TILE_WALL)
      }
    }
    expect(interiorWalls).toBeGreaterThan(40)
    // 整个地图的可走瓦片必须是一个连通分量：从起点房间中心 BFS
    const start = generated.rooms[generated.startRoom]!
    const startX = start.x + Math.floor(start.w / 2)
    const startY = start.y + Math.floor(start.h / 2)
    const seen = new Set<number>([startY * generated.width + startX])
    const queue: Array<[number, number]> = [[startX, startY]]
    while (queue.length > 0) {
      const [x, y] = queue.shift() as [number, number]
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= generated.width || ny >= generated.height) continue
        const index = ny * generated.width + nx
        if (seen.has(index)) continue
        if (generated.tiles[index] === RAID_TILE_WALL) continue
        seen.add(index)
        queue.push([nx, ny])
      }
    }
    const walkable = generated.tiles.filter((tile) => tile !== RAID_TILE_WALL).length
    expect(seen.size).toBe(walkable)
  })
})

describe('raidRun 状态机', () => {
  const map = generateRaidMap(777, getRaidMap('wasteland')!)

  function makeRun(overrides: Partial<RaidRunState> = {}): RaidRunState {
    return Object.assign(createRaidRun({
      seed: 777,
      mapKey: 'wasteland',
      difficulty: 'normal',
      hp: 200,
      maxHp: 200,
      mp: 80,
      maxMp: 80,
      atk: 30,
      insured: false,
      capacities: { backpack: 8, rig: 2, safe: 2 },
      gear: {
        helmet: { key: 'helmet_t3', durability: 70, maxDurability: 70 },
        armor: { key: 'armor_t3', durability: 100, maxDurability: 100 },
        boots: 'boots_t2',
        backpack: 'backpack_t1',
        rig: 'rig_t1',
      },
      backpack: [],
      rig: [],
      safe: [],
      skills: [],
      startedAt: 1_000_000,
    }), overrides)
  }

  it('受伤按护甲减伤并扣耐久', () => {
    const result = resolveRaidDamage({
      raw: 100,
      zone: 'body',
      helmet: null,
      armor: { key: 'armor_t3', durability: 100, maxDurability: 100 },
    })
    expect(result.hpDamage).toBe(74)
    expect(result.armorLoss).toBe(25)
  })

  it('耐久归零后不再减伤', () => {
    const result = resolveRaidDamage({
      raw: 100,
      zone: 'body',
      helmet: null,
      armor: { key: 'armor_t6', durability: 0, maxDurability: 180 },
    })
    expect(result.hpDamage).toBe(100)
  })

  it('维修恢复耐久并降低上限', () => {
    const repaired = repairRaidGear({ key: 'armor_t3', durability: 20, maxDurability: 100 }, 'armor_repair')
    expect(repaired.ok).toBe(true)
    expect(repaired.gear?.durability).toBe(95)
    expect(repaired.gear?.maxDurability).toBe(95)
  })

  it('背包容量为 0 时不能拾取', () => {
    const room = map.rooms.find((entry) => entry.enemies.length > 0 && entry.containers.length > 0)
    if (!room) return
    const container = room.containers[0]
    if (!container) return
    const state = makeRun({
      currentRoom: room.id,
      capacities: { backpack: 0, rig: 0, safe: 0 },
      killedEnemies: room.enemies.map((enemy) => enemy.id),
      clearedRooms: [room.id],
      openedContainers: [container.id],
    })
    const loot = container.loot[0]
    if (!loot) return
    const result = applyRaidEvent(state, map, {
      type: 'takeLoot',
      containerId: container.id,
      lootId: loot.id,
      target: 'backpack',
    }, 1_000_010)
    expect(result.error).toBeTruthy()
  })

  it('撤离读条未完成不能撤离，走完 6 秒必定成功', () => {
    const extractRoom = map.rooms.find((room) => room.kind === 'extract')
    if (!extractRoom) return
    const state = makeRun({
      currentRoom: extractRoom.id,
      clearedRooms: [extractRoom.id],
      killedEnemies: extractRoom.enemies.map((enemy) => enemy.id),
    })
    const started = applyRaidEvent(state, map, { type: 'extractStart' }, 2_000_000)
    expect(started.error).toBeUndefined()
    const tooEarly = applyRaidEvent(started.state, map, { type: 'extractDone' }, 2_000_100)
    expect(tooEarly.error).toBeTruthy()
    // 2026-11-07：不再有随机运输故障，读条满 6 秒必定撤离
    const done = applyRaidEvent(
      started.state,
      map,
      { type: 'extractDone' },
      2_000_000 + RAID_EXTRACT_CHANNEL_MS,
    )
    expect(done.error).toBeUndefined()
    expect(done.state.status).toBe('extracted')
    expect(done.state.log.some((entry) => entry.kind === 'success')).toBe(true)
  })

  it('保险按装备价值 15% 取整', () => {
    const cost = raidInsuranceCost({
      helmet: { key: 'helmet_t3', durability: 70, maxDurability: 70 },
      armor: { key: 'armor_t3', durability: 100, maxDurability: 100 },
      boots: 'boots_t2',
      backpack: 'backpack_t2',
      rig: 'rig_t1',
    })
    expect(cost).toBe(Math.ceil((900 + 1100 + 320 + 700 + 200) * 0.15))
  })

  it('容器堆叠与上限', () => {
    const stack = addItemToContainer([], 2, 'scrap_metal', 3)
    expect(stack).toHaveLength(1)
    const full = addItemToContainer(stack!, 2, 'copper_wire', 3)
    expect(full).not.toBeNull()
    const overflow = addItemToContainer(full!, 2, 'old_watch', 1)
    expect(overflow).toBeNull()
  })

  it('对局内可把背包物资挪进安全箱', () => {
    const state = makeRun({
      backpack: [{ slotIndex: 0, itemKey: 'gold_compass', amount: 1 }],
      safe: [],
    })
    const moved = applyRaidEvent(state, map, {
      type: 'moveItem',
      from: 'backpack',
      to: 'safe',
      slotIndex: 0,
    }, 1_000_100)
    expect(moved.error).toBeUndefined()
    expect(moved.state.backpack).toHaveLength(0)
    expect(moved.state.safe).toHaveLength(1)
    expect(moved.state.safe[0]?.itemKey).toBe('gold_compass')
  })

  it('胸挂不再限制消耗品，安全箱也受容量限制', () => {
    const state = makeRun({
      backpack: [
        { slotIndex: 0, itemKey: 'gold_compass', amount: 1 },
        { slotIndex: 1, itemKey: 'medkit', amount: 2 },
      ],
      rig: [],
      safe: [],
      capacities: { backpack: 8, rig: 2, safe: 0 },
    })
    const anyKind = applyRaidEvent(state, map, {
      type: 'moveItem', from: 'backpack', to: 'rig', slotIndex: 0,
    }, 1_000_101)
    expect(anyKind.error).toBeUndefined()
    expect(anyKind.state.rig[0]?.itemKey).toBe('gold_compass')

    const noSafe = applyRaidEvent(state, map, {
      type: 'moveItem', from: 'backpack', to: 'safe', slotIndex: 1,
    }, 1_000_102)
    expect(noSafe.error).toBeTruthy()
    expect(noSafe.state.backpack).toHaveLength(2)

    const toRig = applyRaidEvent(state, map, {
      type: 'moveItem', from: 'backpack', to: 'rig', slotIndex: 1,
    }, 1_000_103)
    expect(toRig.error).toBeUndefined()
    expect(toRig.state.rig[0]?.itemKey).toBe('medkit')
    expect(toRig.state.backpack).toHaveLength(1)
  })

  it('可丢弃背包物品到地面并捡回', () => {
    const state = makeRun({
      backpack: [{ slotIndex: 0, itemKey: 'scrap_metal', amount: 3 }],
      rig: [],
      safe: [],
    })
    const dropped = applyRaidEvent(state, map, {
      type: 'dropItem', from: 'backpack', slotIndex: 0, x: 10, y: 10,
    }, 1_000_104)
    expect(dropped.error).toBeUndefined()
    expect(dropped.state.backpack).toHaveLength(0)
    expect(dropped.state.groundLoot).toHaveLength(1)
    expect(dropped.state.groundLoot[0]?.itemKey).toBe('scrap_metal')
    expect(dropped.state.groundLoot[0]?.roomId).toBe(dropped.state.currentRoom)

    const groundId = dropped.state.groundLoot[0]?.id as string
    const picked = applyRaidEvent(dropped.state, map, {
      type: 'takeGround', groundId, target: 'backpack',
    }, 1_000_105)
    expect(picked.error).toBeUndefined()
    expect(picked.state.backpack[0]?.itemKey).toBe('scrap_metal')
    expect(picked.state.groundLoot).toHaveLength(0)

    const again = applyRaidEvent(picked.state, map, {
      type: 'takeGround', groundId, target: 'backpack',
    }, 1_000_106)
    expect(again.error).toBeTruthy()
  })

  it('目标容器满时移动失败且来源不变', () => {
    const state = makeRun({
      backpack: [
        { slotIndex: 0, itemKey: 'scrap_metal', amount: 3 },
        { slotIndex: 1, itemKey: 'copper_wire', amount: 3 },
      ],
      safe: [{ slotIndex: 0, itemKey: 'old_watch', amount: 1 }],
      capacities: { backpack: 8, rig: 2, safe: 1 },
    })
    const full = applyRaidEvent(state, map, {
      type: 'moveItem', from: 'backpack', to: 'safe', slotIndex: 0,
    }, 1_000_104)
    expect(full.error).toBeTruthy()
    expect(full.state.backpack).toHaveLength(2)
    expect(full.state.safe).toHaveLength(1)
  })
})
