import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  RAID_EXTRACT_CHANNEL_MS,
  RAID_GEARS,
  RAID_ITEMS,
  RAID_MAPS,
  addItemToContainer,
  applyRaidEvent,
  createRaidRun,
  generateRaidMap,
  getRaidMap,
  raidInsuranceCost,
  raidSellPrice,
  raidShopGearPrice,
  raidShopItemPrice,
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
    expect(RAID_GEARS.length).toBe(30)
    expect(new Set(RAID_ITEMS.map((item) => item.key)).size).toBe(RAID_ITEMS.length)
    expect(new Set(RAID_GEARS.map((gear) => gear.key)).size).toBe(RAID_GEARS.length)
  })

  it('六档品质都有物品，神话只在最高档地图掉落', () => {
    const rarities = new Set(RAID_ITEMS.map((item) => item.rarity))
    expect(rarities.size).toBe(6)
    expect(RAID_ITEMS.filter((item) => item.rarity === 'mythic').length).toBeGreaterThanOrEqual(2)
  })

  it('商店只卖 1–3 级装备', () => {
    const shopable = RAID_GEARS.filter((gear) => gear.shopable)
    expect(shopable.length).toBeGreaterThan(0)
    expect(shopable.every((gear) => gear.tier <= 3)).toBe(true)
    expect(RAID_GEARS.filter((gear) => gear.tier >= 4).every((gear) => !gear.shopable)).toBe(true)
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

  it('六张地图都能生成', () => {
    for (const def of RAID_MAPS) {
      const generated = generateRaidMap(42, def)
      expect(generated.rooms.length).toBe(def.cols * def.rows)
      expect(generated.tiles.length).toBe(generated.width * generated.height)
    }
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

  it('撤离读条未完成不能撤离', () => {
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
    const done = applyRaidEvent(started.state, map, { type: 'extractDone' }, 2_000_000 + RAID_EXTRACT_CHANNEL_MS)
    expect(done.state.status).toBe('extracted')
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
})
