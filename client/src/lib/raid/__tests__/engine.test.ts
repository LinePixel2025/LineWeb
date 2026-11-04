import { describe, expect, it } from 'vitest'
import { RaidEngine } from '../engine'
import {
  RAID_GROUND_REARM_DISTANCE,
  generateRaidMap,
  getRaidMap,
  resolveDropPosition,
} from '../raidRun'
import type { RaidRun } from '../../../types/petRaid'

function makeRun(map = generateRaidMap(123456, getRaidMap('wasteland')!)): RaidRun {
  const start = map.rooms[0]!
  return {
    id: 1,
    version: 0,
    mapKey: 'wasteland',
    mapName: '废弃农场',
    mapEmoji: '🌾',
    difficulty: 'normal',
    status: 'active',
    seed: 123456,
    squadId: null,
    insured: false,
    hp: 200,
    mp: 80,
    maxHp: 200,
    maxMp: 80,
    atk: 30,
    kills: 0,
    damageTaken: 0,
    currentRoom: start.id,
    clearedRooms: [],
    killedEnemies: [],
    openedContainers: [],
    takenLoot: [],
    groundLoot: [],
    groundSeq: 0,
    backpack: [],
    rig: [],
    safe: [],
    capacities: { backpack: 8, rig: 2, safe: 2 },
    gear: {
      helmet: { key: 'helmet_t1', durability: 40, maxDurability: 40 },
      armor: { key: 'armor_t1', durability: 60, maxDurability: 60 },
      boots: null,
      backpack: 'backpack_t1',
      rig: null,
    },
    skills: [
      { key: 'fire_claw', name: '烈焰爪', emoji: '🔥', kind: 'damage', mpCost: 25, cooldownMs: 2500, power: 1.45 },
    ],
    map,
    log: [],
    extractionStartedAt: null,
    startedAt: new Date(1_000_000).toISOString(),
    expiresAt: new Date(1_000_000 + 900_000).toISOString(),
    remainingMs: 900_000,
    entryCost: 0,
    insuranceCost: 0,
    insuranceRate: 0.15,
  }
}

describe('RaidEngine 换房', () => {
  it('从门洞侧格（非正中门格）也能进入相邻房间', () => {
    const map = generateRaidMap(123456, getRaidMap('wasteland')!)
    const engine = new RaidEngine(makeRun(map), 'cat')
    const start = map.rooms[0]!
    const neighbor = start.neighbors[0]!
    const target = map.rooms[neighbor]!
    const door = map.doors.find((entry) => {
      if (entry.roomA !== start.id && entry.roomB !== start.id) return false
      return entry.x >= start.x && entry.x < start.x + start.w && entry.y >= start.y && entry.y < start.y + start.h
    })!
    const horizontal = target.col !== start.col
    // 放到门洞三格中的侧格，模拟玩家没踩正中绿色箭头的情况
    engine.player.x = horizontal ? start.x + start.w - 0.55 : door.x + 0.5 - 1
    engine.player.y = horizontal ? door.y + 0.5 - 1 : start.y + start.h - 0.55
    engine.input.moveX = horizontal ? Math.sign(target.col - start.col) : 0
    engine.input.moveY = horizontal ? 0 : Math.sign(target.row - start.row)
    for (let i = 0; i < 60; i += 1) engine.update(16, 1_000_000 + i * 16)
    expect(engine.roomId).toBe(target.id)
    expect(engine.flushEvents().some((event) => event.type === 'enterRoom')).toBe(true)
  })

  it('服务端拒绝换房时把玩家夹回旧房间，不会永久卡死', () => {
    const map = generateRaidMap(123456, getRaidMap('wasteland')!)
    const engine = new RaidEngine(makeRun(map), 'cat')
    const start = map.rooms[0]!
    const target = map.rooms[start.neighbors[0]!]!
    engine.loadRoom(target.id)
    engine.player.x = target.x + target.w / 2
    engine.player.y = target.y + target.h / 2
    const serverRun = makeRun(map)
    engine.applyServerRun({ ...serverRun, currentRoom: start.id, killedEnemies: [] })
    expect(engine.roomId).toBe(start.id)
    expect(engine.player.x).toBeGreaterThanOrEqual(start.x + 2)
    expect(engine.player.x).toBeLessThanOrEqual(start.x + start.w - 2)
    expect(engine.player.y).toBeGreaterThanOrEqual(start.y + 2)
    expect(engine.player.y).toBeLessThanOrEqual(start.y + start.h - 2)
  })
})

function makeLootedRun(map: RaidRun['map']): RaidRun {
  return { ...makeRun(map), backpack: [{ slotIndex: 0, itemKey: 'scrap_metal', amount: 3 }] }
}

describe('RaidEngine 丢弃与自动捡起', () => {
  const map = generateRaidMap(123456, getRaidMap('wasteland')!)

  it('丢弃落点在朝向前方，而不是玩家脚下', () => {
    const engine = new RaidEngine(makeLootedRun(map), 'cat')
    const room = map.rooms[engine.roomId]!
    engine.player.x = room.x + room.w / 2
    engine.player.y = room.y + room.h / 2
    engine.player.angle = 0
    expect(engine.dropItem('backpack', 0)).toBe(true)
    const ground = engine.groundLoot[0]!
    const expected = resolveDropPosition(engine.player.x, engine.player.y, 0, room)
    expect(ground.x).toBeCloseTo(expected.x, 9)
    expect(ground.y).toBeCloseTo(expected.y, 9)
    expect(Math.hypot(ground.x - engine.player.x, ground.y - engine.player.y)).toBeGreaterThan(0.7)
    const sent = engine.flushEvents().find((event) => event.type === 'dropItem')
    expect(sent && 'angle' in sent && sent.angle).toBe(0)
  })

  it('自己刚丢的：直接走过去踩上也不会被自动捡回', () => {
    const engine = new RaidEngine(makeLootedRun(map), 'cat')
    const room = map.rooms[engine.roomId]!
    engine.player.x = room.x + room.w / 2
    engine.player.y = room.y + room.h / 2
    engine.player.angle = 0
    engine.dropItem('backpack', 0)
    const ground = engine.groundLoot[0]!
    // 朝物品走，全程不超过重新武装距离，因此「走过即捡」不该生效
    let guard = 0
    while (Math.hypot(ground.x - engine.player.x, ground.y - engine.player.y) > 0.2 && guard < 400) {
      engine.input.moveX = 1
      engine.update(16, 1_000_000 + guard * 16)
      guard += 1
    }
    expect(engine.roomId).toBe(room.id)
    expect(Math.hypot(ground.x - engine.player.x, ground.y - engine.player.y)).toBeLessThanOrEqual(0.7)
    expect(engine.groundLoot).toHaveLength(1)
    expect(engine.backpack).toHaveLength(0)
    expect(engine.flushEvents().some((event) => event.type === 'takeGround')).toBe(false)
  })

  it('自己刚丢的：走远再回来就能自动捡回', () => {
    const engine = new RaidEngine(makeLootedRun(map), 'cat')
    const room = map.rooms[engine.roomId]!
    engine.player.x = room.x + room.w / 2
    engine.player.y = room.y + room.h / 2
    engine.player.angle = 0
    engine.dropItem('backpack', 0)
    const ground = engine.groundLoot[0]!
    // 走远到重新武装距离之外（同一房间内，别触发换房）
    engine.player.x = Math.max(room.x + 2, ground.x - RAID_GROUND_REARM_DISTANCE - 0.5)
    engine.player.y = ground.y
    engine.input.moveX = 0
    engine.update(16, 2_000_000)
    expect(Math.hypot(ground.x - engine.player.x, ground.y - engine.player.y)).toBeGreaterThan(
      RAID_GROUND_REARM_DISTANCE,
    )
    // 回到物品上站着，应自动捡起并上报 takeGround
    engine.player.x = ground.x
    engine.player.y = ground.y
    engine.update(16, 2_000_016)
    expect(engine.groundLoot).toHaveLength(0)
    expect(engine.backpack[0]?.itemKey).toBe('scrap_metal')
    expect(engine.flushEvents().some((event) => event.type === 'takeGround')).toBe(true)
    expect(engine.ownDroppedGround.size).toBe(0)
  })

  it('队友丢在地面的物品不在自己的丢弃记录里，走过即捡', () => {
    const engine = new RaidEngine(makeRun(map), 'cat')
    const room = map.rooms[engine.roomId]!
    engine.player.x = room.x + room.w / 2
    engine.player.y = room.y + room.h / 2
    const teammateDrop = {
      id: 'g900',
      roomId: room.id,
      itemKey: 'copper_wire' as const,
      amount: 2,
      x: engine.player.x,
      y: engine.player.y,
    }
    engine.applyServerRun({ ...makeRun(map), groundLoot: [teammateDrop] })
    engine.player.x = teammateDrop.x
    engine.player.y = teammateDrop.y
    engine.update(16, 3_000_000)
    expect(engine.groundLoot).toHaveLength(0)
    expect(engine.backpack.some((stack) => stack.itemKey === 'copper_wire')).toBe(true)
  })

  it('换房 / 服务端回包后，自己丢弃记录里已消失的条目被清掉', () => {
    const engine = new RaidEngine(makeLootedRun(map), 'cat')
    const room = map.rooms[engine.roomId]!
    engine.player.x = room.x + room.w / 2
    engine.player.y = room.y + room.h / 2
    engine.dropItem('backpack', 0)
    expect(engine.ownDroppedGround.size).toBe(1)
    // 服务端权威回包里地面已空（被队友捡走）→ 本地标记必须一并清理
    engine.applyServerRun({ ...makeRun(map), groundLoot: [] })
    expect(engine.ownDroppedGround.size).toBe(0)
  })
})
