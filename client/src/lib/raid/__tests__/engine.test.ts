import { describe, expect, it } from 'vitest'
import { RaidEngine } from '../engine'
import { generateRaidMap, getRaidMap } from '../raidRun'
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
