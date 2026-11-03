/**
 * 搜打撤 v2 实时战斗引擎（客户端本地模拟）。
 *
 * 口径：
 *   - 服务端按 seed 生成地图并校验事件，客户端负责实时移动 / 射击 / 敌人 AI / 拾取表现；
 *   - 服务端是 HP、背包、容器、撤离进度的最终权威，本地只做预测，收到 run 后以服务端为准；
 *   - 敌人会移动（巡逻 / 追击 / 远程射击 / Boss 范围弹幕），技能由玩家手动释放（1/2/3）。
 */

import {
  RAID_EXTRACT_CHANNEL_MS,
  RAID_ITEM_MAP,
  RAID_MP_REGEN_PER_SEC,
  RAID_TILE_DOOR,
  RAID_TILE_HAZARD,
  RAID_TILE_WALL,
  addItemToContainer,
  consumeItemFromContainer,
  getRaidGear,
  normalizeContainer,
  raidDefenseOf,
  raidTileIndex,
  resolveRaidDamage,
  type RaidContainerKind,
  type RaidEnemyNode,
  type RaidEvent,
  type RaidGearInstance,
  type RaidItemStack,
  type RaidMapNode,
  type RaidRoomNode,
  type RaidSkillRule,
} from './raidRun'
import type { RaidEquippedGearSnapshot, RaidRun } from '../../types/petRaid'

export const PLAYER_SPEED = 4.2
export const PLAYER_RADIUS = 0.34
export const BULLET_SPEED = 18
export const PLAYER_FIRE_INTERVAL_MS = 200
export const PLAYER_BULLET_DAMAGE_RATE = 1.2
export const ENEMY_AGGRO_RANGE = 10
export const HAZARD_DPS_PCT = 6
export const INTERACT_RANGE = 1.25

export interface RaidInputState {
  moveX: number
  moveY: number
  aimX: number
  aimY: number
  firing: boolean
}

export interface LocalEnemy {
  id: string
  source: RaidEnemyNode
  hp: number
  maxHp: number
  x: number
  y: number
  cooldown: number
  hitFlash: number
  dead: boolean
  burstCooldown: number
}

export interface LocalBullet {
  x: number
  y: number
  vx: number
  vy: number
  damage: number
  friendly: boolean
  life: number
  radius: number
  color: string
}

export interface LocalPickup {
  id: string
  containerId: string
  lootId: string
  itemKey: string
  amount: number
  x: number
  y: number
}

export interface LocalContainerState {
  id: string
  x: number
  y: number
  opened: boolean
}

export interface LocalParticle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  color: string
  size: number
}

export interface RaidToast {
  id: number
  text: string
  tone: 'info' | 'success' | 'danger'
  at: number
}

export interface RaidHudSkill {
  key: string
  name: string
  emoji: string
  mpCost: number
  cooldownMs: number
  cooldownLeftMs: number
  affordable: boolean
}

export interface RaidSnapshot {
  hp: number
  mp: number
  maxHp: number
  maxMp: number
  atk: number
  kills: number
  roomId: number
  roomKind: string
  roomCleared: boolean
  remainingMs: number
  extractionProgress: number
  gear: RaidEquippedGearSnapshot
  helmetDefense: number
  armorDefense: number
  backpack: RaidItemStack[]
  rig: RaidItemStack[]
  safe: RaidItemStack[]
  capacities: { backpack: number; rig: number; safe: number }
  skills: RaidHudSkill[]
  toast: RaidToast | null
  nearContainer: { id: string; opened: boolean } | null
  canExtract: boolean
  extracting: boolean
  dead: boolean
  shield: number
  atkBuffMs: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by)
}

function tileAt(map: RaidMapNode, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return RAID_TILE_WALL
  return map.tiles[raidTileIndex(map.width, x, y)] ?? RAID_TILE_WALL
}

export class RaidEngine {
  readonly map: RaidMapNode
  readonly skills: RaidSkillRule[]
  readonly species: string
  readonly startedAt: number
  readonly expiresAt: number

  roomId: number
  player = { x: 0, y: 0, hp: 1, mp: 0, angle: 0, shield: 0, atkBuffUntil: 0 }
  enemies: LocalEnemy[] = []
  bullets: LocalBullet[] = []
  pickups: LocalPickup[] = []
  containers: LocalContainerState[] = []
  particles: LocalParticle[] = []
  toasts: RaidToast[] = []

  clearedRooms: Set<number>
  killedEnemies: Set<string>
  openedContainers: Set<string>
  takenLoot: Set<string>
  gear: RaidEquippedGearSnapshot
  backpack: RaidItemStack[]
  rig: RaidItemStack[]
  safe: RaidItemStack[]
  capacities: { backpack: number; rig: number; safe: number }
  kills: number
  maxHp: number
  maxMp: number
  atk: number

  extractStartedAt: number | null = null
  extractSentDone = false
  dead = false
  ended = false

  private events: RaidEvent[] = []
  private fireCooldown = 0
  private hazardAccum = 0
  private mpAccum = 0
  private transitionLock = 0
  private toastSeq = 0
  private lastFullToastAt = 0
  private skillReadyAt: Record<string, number> = {}

  constructor(run: RaidRun, species: string, now = Date.now()) {
    this.map = run.map
    this.skills = run.skills
    this.species = species
    this.startedAt = now
    this.expiresAt = new Date(run.expiresAt).getTime()
    this.roomId = run.currentRoom
    this.maxHp = run.maxHp
    this.maxMp = run.maxMp
    this.atk = run.atk
    this.hp = run.hp
    this.mp = run.mp
    this.gear = { ...run.gear }
    this.backpack = run.backpack.map((stack) => ({ ...stack }))
    this.rig = run.rig.map((stack) => ({ ...stack }))
    this.safe = run.safe.map((stack) => ({ ...stack }))
    this.capacities = { ...run.capacities }
    this.kills = run.kills
    this.clearedRooms = new Set(run.clearedRooms)
    this.killedEnemies = new Set(run.killedEnemies)
    this.openedContainers = new Set(run.openedContainers)
    this.takenLoot = new Set(run.takenLoot)
    this.extractStartedAt = run.extractionStartedAt
    this.loadRoom(run.currentRoom, true)
  }

  /* ---------- 便捷字段 ---------- */
  hp = 1
  mp = 0
  input: RaidInputState = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, firing: false }

  get room(): RaidRoomNode | null {
    return this.map.rooms[this.roomId] ?? null
  }

  get roomCleared(): boolean {
    if (!this.room) return true
    return this.room.enemies.every((enemy) => this.killedEnemies.has(enemy.id))
  }

  get extractPoint(): { x: number; y: number } | null {
    const point = this.map.extracts.find((entry) => entry.roomId === this.roomId)
    return point ? { x: point.x, y: point.y } : null
  }

  /* ---------- 初始化 / 换房 ---------- */

  loadRoom(roomId: number, initial = false): void {
    const room = this.map.rooms[roomId]
    if (!room) return
    this.roomId = roomId
    this.enemies = room.enemies
      .filter((enemy) => !this.killedEnemies.has(enemy.id))
      .map((enemy) => ({
        id: enemy.id,
        source: enemy,
        hp: enemy.maxHp,
        maxHp: enemy.maxHp,
        x: enemy.x + 0.5,
        y: enemy.y + 0.5,
        cooldown: 600 + Math.random() * 700,
        hitFlash: 0,
        dead: false,
        burstCooldown: 2500,
      }))
    this.containers = room.containers.map((container) => ({
      id: container.id,
      x: container.x + 0.5,
      y: container.y + 0.5,
      opened: this.openedContainers.has(container.id),
    }))
    this.pickups = []
    for (const container of room.containers) {
      if (!this.openedContainers.has(container.id)) continue
      this.spawnContainerPickups(container.id)
    }
    this.bullets = []
    this.extractStartedAt = null
    this.extractSentDone = false
    if (initial) {
      const center = {
        x: room.x + room.w / 2,
        y: room.y + room.h / 2,
      }
      this.player.x = center.x
      this.player.y = center.y
    }
  }

  private spawnContainerPickups(containerId: string): void {
    const room = this.room
    if (!room) return
    const container = room.containers.find((entry) => entry.id === containerId)
    if (!container) return
    container.loot.forEach((loot, index) => {
      const id = `${container.id}#${loot.id}`
      if (this.takenLoot.has(id)) return
      if (this.pickups.some((pickup) => pickup.id === id)) return
      const angle = (index / Math.max(1, container.loot.length)) * Math.PI * 2 + 0.4
      this.pickups.push({
        id,
        containerId: container.id,
        lootId: loot.id,
        itemKey: loot.itemKey,
        amount: loot.amount,
        x: container.x + 0.5 + Math.cos(angle) * 0.65,
        y: container.y + 0.5 + Math.sin(angle) * 0.65,
      })
    })
  }

  /* ---------- 主循环 ---------- */

  update(dtMs: number, now = Date.now()): void {
    if (this.dead || this.ended) return
    const dt = Math.min(0.05, Math.max(0, dtMs / 1000))
    if (dt <= 0) return
    this.transitionLock = Math.max(0, this.transitionLock - dtMs)
    this.updatePlayer(dt, now)
    this.updateEnemies(dt, now)
    this.updateBullets(dt)
    this.updatePickups()
    this.updateHazard(dt, now)
    this.updateMp(dt)
    this.updateToasts(now)
  }

  private updatePlayer(dt: number, now: number): void {
    const input = this.input
    const gearBoots = this.gear.boots ? getRaidGear(this.gear.boots) : null
    const speedBonus = gearBoots?.speedBonus ?? 0
    const speed = PLAYER_SPEED * (1 + speedBonus / 100)
    const len = Math.hypot(input.moveX, input.moveY)
    if (len > 0.001) {
      const vx = (input.moveX / len) * speed * dt
      const vy = (input.moveY / len) * speed * dt
      this.tryMove(vx, vy, now)
    }
    if (input.aimX !== 0 || input.aimY !== 0) {
      this.player.angle = Math.atan2(input.aimY - this.player.y, input.aimX - this.player.x)
    }
    this.fireCooldown = Math.max(0, this.fireCooldown - dt * 1000)
    if (input.firing && this.fireCooldown <= 0) {
      this.fireCooldown = PLAYER_FIRE_INTERVAL_MS
      this.fireBullet()
    }
    if (this.player.shield > 0) {
      this.player.shield = Math.max(0, this.player.shield - dt * 2)
    }
  }

  private tryMove(dx: number, dy: number, now: number): void {
    const room = this.room
    if (!room) return
    // 分轴移动，避免贴墙卡死
    const nextX = this.player.x + dx
    if (this.canStand(nextX, this.player.y)) {
      const tileX = Math.floor(nextX)
      if (this.isDoorTile(tileX, Math.floor(this.player.y))) {
        this.tryTransition(tileX, Math.floor(this.player.y), now)
        return
      }
      this.player.x = nextX
    }
    const nextY = this.player.y + dy
    if (this.canStand(this.player.x, nextY)) {
      const tileY = Math.floor(nextY)
      if (this.isDoorTile(Math.floor(this.player.x), tileY)) {
        this.tryTransition(Math.floor(this.player.x), tileY, now)
        return
      }
      this.player.y = nextY
    }
  }

  private canStand(x: number, y: number): boolean {
    const r = PLAYER_RADIUS
    for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r]] as const) {
      const tile = tileAt(this.map, Math.floor(x + ox), Math.floor(y + oy))
      if (tile === RAID_TILE_WALL) return false
    }
    return true
  }

  private isDoorTile(x: number, y: number): boolean {
    return tileAt(this.map, x, y) === RAID_TILE_DOOR
  }

  private doorTarget(x: number, y: number): number | null {
    const door = this.map.doors.find((entry) => entry.x === x && entry.y === y)
    if (!door) return null
    if (door.roomA === this.roomId) return door.roomB
    if (door.roomB === this.roomId) return door.roomA
    return null
  }

  private tryTransition(x: number, y: number, now: number): void {
    if (this.transitionLock > 0) return
    const target = this.doorTarget(x, y)
    if (target === null) return
    if (!this.roomCleared) {
      this.pushToast('房间还有敌人，门锁死了', 'danger', now)
      this.transitionLock = 600
      return
    }
    const targetRoom = this.map.rooms[target]
    if (!targetRoom) return
    const prevRoom = this.room
    this.loadRoom(target)
    // 落在目标房间靠门的位置：以房间中心为基准偏移
    const here = { x: this.player.x, y: this.player.y }
    if (prevRoom) {
      if (targetRoom.col > prevRoom.col) {
        this.player.x = targetRoom.x + 2
        this.player.y = y + 0.5
      } else if (targetRoom.col < prevRoom.col) {
        this.player.x = targetRoom.x + targetRoom.w - 2
        this.player.y = y + 0.5
      } else if (targetRoom.row > prevRoom.row) {
        this.player.y = targetRoom.y + 2
        this.player.x = x + 0.5
      } else {
        this.player.y = targetRoom.y + targetRoom.h - 2
        this.player.x = x + 0.5
      }
    } else {
      this.player.x = here.x
      this.player.y = here.y
    }
    this.events.push({ type: 'enterRoom', roomId: target })
    this.transitionLock = 700
    this.pushToast(targetRoom.kind === 'extract' ? '到达撤离区' : '进入新房间', 'info', now)
  }

  /* ---------- 射击 ---------- */

  private fireBullet(): void {
    const angle = this.player.angle
    const buff = this.player.atkBuffUntil > Date.now() ? 1.4 : 1
    const damage = Math.max(1, Math.round(this.atk * PLAYER_BULLET_DAMAGE_RATE * buff))
    this.bullets.push({
      x: this.player.x + Math.cos(angle) * 0.5,
      y: this.player.y + Math.sin(angle) * 0.5,
      vx: Math.cos(angle) * BULLET_SPEED,
      vy: Math.sin(angle) * BULLET_SPEED,
      damage,
      friendly: true,
      life: 1.4,
      radius: 0.11,
      color: '#7dd3fc',
    })
    this.spawnParticles(
      this.player.x + Math.cos(angle) * 0.5,
      this.player.y + Math.sin(angle) * 0.5,
      3,
      '#7dd3fc',
    )
  }

  /* ---------- 敌人 AI ---------- */

  private updateEnemies(dt: number, now: number): void {
    const room = this.room
    if (!room) return
    for (const enemy of this.enemies) {
      if (enemy.dead) continue
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt)
      enemy.cooldown = Math.max(0, enemy.cooldown - dt * 1000)
      enemy.burstCooldown = Math.max(0, enemy.burstCooldown - dt * 1000)
      const dx = this.player.x - enemy.x
      const dy = this.player.y - enemy.y
      const dist = Math.hypot(dx, dy)
      if (dist > ENEMY_AGGRO_RANGE) {
        // 轻微巡逻，避免完全静止
        enemy.x += Math.sin((now / 900) + enemy.source.level) * dt * 0.4
        enemy.y += Math.cos((now / 1100) + enemy.source.level) * dt * 0.4
        this.clampEnemyToRoom(enemy, room)
        continue
      }
      const nx = dist > 0 ? dx / dist : 0
      const ny = dist > 0 ? dy / dist : 0
      const speed = enemy.source.speed
      if (enemy.source.ranged) {
        const preferred = enemy.source.kind === 'boss' ? 5.5 : 4.5
        let move = 0
        if (dist > preferred + 0.6) move = 1
        else if (dist < preferred - 1.2) move = -1
        if (move !== 0) {
          enemy.x += nx * move * speed * dt
          enemy.y += ny * move * speed * dt
        } else {
          enemy.x += -ny * speed * dt * 0.5
          enemy.y += nx * speed * dt * 0.5
        }
        if (enemy.cooldown <= 0 && dist < 9 && this.hasLineOfSight(enemy.x, enemy.y, this.player.x, this.player.y)) {
          enemy.cooldown = enemy.source.kind === 'boss' ? 1200 : 1700
          this.enemyShoot(enemy, nx, ny)
        }
        if (enemy.source.kind === 'boss' && enemy.burstCooldown <= 0 && dist < 10) {
          enemy.burstCooldown = 4200
          this.enemyBurst(enemy)
        }
      } else {
        if (dist > 0.75) {
          enemy.x += nx * speed * dt
          enemy.y += ny * speed * dt
        }
        if (dist < 0.95 && enemy.cooldown <= 0) {
          enemy.cooldown = 1000
          this.hurtPlayer(enemy.source.damage, 'body', now)
        }
      }
      this.clampEnemyToRoom(enemy, room)
    }
    // 简单分离力：避免多个敌人完全重叠成一坨
    for (let i = 0; i < this.enemies.length; i += 1) {
      const a = this.enemies[i]
      if (!a || a.dead) continue
      for (let j = i + 1; j < this.enemies.length; j += 1) {
        const b = this.enemies[j]
        if (!b || b.dead) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.hypot(dx, dy)
        const min = a.source.radius + b.source.radius + 0.15
        if (dist > 0.0001 && dist < min) {
          const push = (min - dist) / 2
          const nx = dx / dist
          const ny = dy / dist
          a.x -= nx * push
          a.y -= ny * push
          b.x += nx * push
          b.y += ny * push
        }
      }
      this.clampEnemyToRoom(a, room)
    }
  }

  private clampEnemyToRoom(enemy: LocalEnemy, room: RaidRoomNode): void {
    enemy.x = clamp(enemy.x, room.x + 1.6, room.x + room.w - 1.6)
    enemy.y = clamp(enemy.y, room.y + 1.6, room.y + room.h - 1.6)
  }

  private hasLineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
    const steps = Math.ceil(distance(ax, ay, bx, by) / 0.4)
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps
      const x = ax + (bx - ax) * t
      const y = ay + (by - ay) * t
      if (tileAt(this.map, Math.floor(x), Math.floor(y)) === RAID_TILE_WALL) return false
    }
    return true
  }

  private enemyShoot(enemy: LocalEnemy, nx: number, ny: number): void {
    const spread = enemy.source.kind === 'elite' ? 0.12 : 0
    const angle = Math.atan2(ny, nx) + (Math.random() - 0.5) * spread
    this.bullets.push({
      x: enemy.x + Math.cos(angle) * 0.5,
      y: enemy.y + Math.sin(angle) * 0.5,
      vx: Math.cos(angle) * 7,
      vy: Math.sin(angle) * 7,
      damage: enemy.source.damage,
      friendly: false,
      life: 2.4,
      radius: 0.13,
      color: '#f87171',
    })
    this.spawnParticles(enemy.x, enemy.y, 3, '#f87171')
  }

  private enemyBurst(enemy: LocalEnemy): void {
    const count = 10
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2
      this.bullets.push({
        x: enemy.x + Math.cos(angle) * 0.6,
        y: enemy.y + Math.sin(angle) * 0.6,
        vx: Math.cos(angle) * 5.2,
        vy: Math.sin(angle) * 5.2,
        damage: Math.max(4, Math.round(enemy.source.damage * 0.7)),
        friendly: false,
        life: 2.6,
        radius: 0.15,
        color: '#fbbf24',
      })
    }
    this.spawnParticles(enemy.x, enemy.y, 14, '#fbbf24')
  }

  /* ---------- 子弹 ---------- */

  private updateBullets(dt: number): void {
    const room = this.room
    const survivors: LocalBullet[] = []
    for (const bullet of this.bullets) {
      bullet.life -= dt
      if (bullet.life <= 0) continue
      const nx = bullet.x + bullet.vx * dt
      const ny = bullet.y + bullet.vy * dt
      if (tileAt(this.map, Math.floor(nx), Math.floor(ny)) === RAID_TILE_WALL) {
        this.spawnParticles(nx, ny, 2, bullet.color)
        continue
      }
      bullet.x = nx
      bullet.y = ny
      if (bullet.friendly) {
        let hit = false
        for (const enemy of this.enemies) {
          if (enemy.dead) continue
          if (distance(bullet.x, bullet.y, enemy.x, enemy.y) <= enemy.source.radius + 0.35) {
            this.hurtEnemy(enemy, bullet.damage)
            hit = true
            break
          }
        }
        if (hit) {
          this.spawnParticles(bullet.x, bullet.y, 4, '#fef08a')
          continue
        }
      } else if (distance(bullet.x, bullet.y, this.player.x, this.player.y) <= PLAYER_RADIUS + bullet.radius) {
        this.hurtPlayer(bullet.damage, Math.random() < 0.2 ? 'head' : 'body', Date.now())
        this.spawnParticles(bullet.x, bullet.y, 4, '#f87171')
        continue
      }
      if (!room || bullet.x < room.x - 1 || bullet.x > room.x + room.w + 1) continue
      survivors.push(bullet)
    }
    this.bullets = survivors
  }

  private hurtEnemy(enemy: LocalEnemy, damage: number): void {
    enemy.hp = Math.max(0, enemy.hp - damage)
    enemy.hitFlash = 0.12
    if (enemy.hp > 0) return
    enemy.dead = true
    this.killedEnemies.add(enemy.id)
    this.kills += 1
    this.events.push({ type: 'kill', enemyId: enemy.id })
    this.spawnParticles(enemy.x, enemy.y, 12, '#fca5a5')
    this.pushToast(`击倒 ${enemy.source.name}`, 'success', Date.now())
    if (this.roomCleared) {
      this.events.push({ type: 'clearRoom', roomId: this.roomId })
      this.pushToast('房间已清空，房门解锁', 'success', Date.now())
    }
  }

  /* ---------- 受伤 ---------- */

  hurtPlayer(raw: number, zone: 'head' | 'body', now: number): void {
    if (this.dead) return
    if (this.player.shield > 0) {
      const absorbed = Math.min(this.player.shield, raw)
      this.player.shield -= absorbed
      raw -= absorbed
      if (raw <= 0) return
    }
    const result = resolveRaidDamage({
      raw,
      zone,
      helmet: this.gear.helmet,
      armor: this.gear.armor,
    })
    this.hp = Math.max(0, this.hp - result.hpDamage)
    if (this.gear.helmet && result.helmetLoss > 0) {
      this.gear = {
        ...this.gear,
        helmet: { ...this.gear.helmet, durability: Math.max(0, this.gear.helmet.durability - result.helmetLoss) },
      }
    }
    if (this.gear.armor && result.armorLoss > 0) {
      this.gear = {
        ...this.gear,
        armor: { ...this.gear.armor, durability: Math.max(0, this.gear.armor.durability - result.armorLoss) },
      }
    }
    this.events.push({ type: 'damage', amount: Math.round(raw), zone })
    this.spawnParticles(this.player.x, this.player.y, 5, '#fda4af')
    if (this.hp <= 0) {
      this.dead = true
      this.pushToast('你倒下了……', 'danger', now)
    }
  }

  private updateHazard(dt: number, now: number): void {
    if (tileAt(this.map, Math.floor(this.player.x), Math.floor(this.player.y)) !== RAID_TILE_HAZARD) {
      this.hazardAccum = 0
      return
    }
    this.hazardAccum += dt
    if (this.hazardAccum >= 0.5) {
      this.hazardAccum = 0
      const damage = Math.max(1, Math.round(this.maxHp * HAZARD_DPS_PCT / 100 / 2))
      this.hurtPlayer(damage, 'body', now)
    }
  }

  private updateMp(dt: number): void {
    this.mpAccum += dt * RAID_MP_REGEN_PER_SEC
    if (this.mpAccum >= 1) {
      const gain = Math.floor(this.mpAccum)
      this.mpAccum -= gain
      this.mp = Math.min(this.maxMp, this.mp + gain)
    }
  }

  /* ---------- 拾取 ---------- */

  private updatePickups(): void {
    const remain: LocalPickup[] = []
    for (const pickup of this.pickups) {
      if (distance(pickup.x, pickup.y, this.player.x, this.player.y) > 0.7) {
        remain.push(pickup)
        continue
      }
      const def = RAID_ITEM_MAP.get(pickup.itemKey)
      if (!def) continue
      const target: RaidContainerKind | null = def.kind === 'consumable'
        ? (this.canFitItem('rig', pickup.itemKey) ? 'rig' : this.canFitItem('backpack', pickup.itemKey) ? 'backpack' : null)
        : (this.canFitItem('backpack', pickup.itemKey) ? 'backpack' : this.canFitItem('rig', pickup.itemKey) ? 'rig' : null)
      if (target === null) {
        const now = Date.now()
        if (now - this.lastFullToastAt > 1500) {
          this.lastFullToastAt = now
          this.pushToast(def.kind === 'consumable' ? '背包与胸挂都满了' : '背包已满，装不下了', 'danger', now)
        }
        remain.push(pickup)
        continue
      }
      const stacks = target === 'rig' ? this.rig : this.backpack
      const capacity = target === 'rig' ? this.capacities.rig : this.capacities.backpack
      const next = addItemToContainer(stacks, capacity, pickup.itemKey, pickup.amount)
      if (!next) {
        remain.push(pickup)
        continue
      }
      if (target === 'rig') this.rig = next
      else this.backpack = next
      this.takenLoot.add(pickup.id)
      this.events.push({
        type: 'takeLoot',
        containerId: pickup.containerId,
        lootId: pickup.lootId,
        target,
      })
      this.pushToast(`拾取 ${def.name} ×${pickup.amount}`, 'info', Date.now())
    }
    this.pickups = remain
  }

  private canFitItem(kind: RaidContainerKind, itemKey: string): boolean {
    const stacks = kind === 'rig' ? this.rig : kind === 'safe' ? this.safe : this.backpack
    const capacity = kind === 'rig' ? this.capacities.rig : kind === 'safe' ? this.capacities.safe : this.capacities.backpack
    const def = RAID_ITEM_MAP.get(itemKey)
    const stackMax = def?.stackMax ?? 1
    if (stacks.some((stack) => stack.itemKey === itemKey && stack.amount < stackMax)) return true
    return stacks.length < capacity
  }

  /* ---------- 交互 ---------- */

  interact(now = Date.now()): void {
    if (this.dead || this.ended) return
    const point = this.extractPoint
    if (point && distance(point.x + 0.5, point.y + 0.5, this.player.x, this.player.y) < 2.2) {
      if (this.extractStartedAt === null) {
        this.extractStartedAt = now
        this.events.push({ type: 'extractStart' })
        this.pushToast('开始撤离读条，站稳别动……', 'info', now)
      } else if (now - this.extractStartedAt >= RAID_EXTRACT_CHANNEL_MS && !this.extractSentDone) {
        this.extractSentDone = true
        this.events.push({ type: 'extractDone' })
      }
      return
    }
    const container = this.nearestContainer()
    if (!container) {
      this.pushToast('附近没有可交互的对象', 'info', now)
      return
    }
    if (container.opened) {
      this.pushToast('这个容器已经搜过了', 'info', now)
      return
    }
    if (!this.roomCleared) {
      this.pushToast('房间还有敌人，先清场再搜', 'danger', now)
      return
    }
    container.opened = true
    this.openedContainers.add(container.id)
    this.events.push({ type: 'openContainer', containerId: container.id })
    this.spawnContainerPickups(container.id)
    this.spawnParticles(container.x, container.y, 8, '#fbbf24')
    this.pushToast('打开容器，战利品掉了一地', 'success', now)
  }

  nearestContainer(): LocalContainerState | null {
    let best: LocalContainerState | null = null
    let bestDist = INTERACT_RANGE
    for (const container of this.containers) {
      const dist = distance(container.x, container.y, this.player.x, this.player.y)
      if (dist < bestDist) {
        bestDist = dist
        best = container
      }
    }
    return best
  }

  /* ---------- 技能 / 道具 ---------- */

  castSkill(index: number, now = Date.now()): boolean {
    const skill = this.skills[index]
    if (!skill || this.dead) return false
    const readyAt = this.skillReadyAt[skill.key] ?? 0
    if (now < readyAt) {
      this.pushToast(`${skill.name} 冷却中`, 'info', now)
      return false
    }
    if (this.mp < skill.mpCost) {
      this.pushToast('能量不足', 'danger', now)
      return false
    }
    this.mp -= skill.mpCost
    this.skillReadyAt[skill.key] = now + skill.cooldownMs
    this.events.push({ type: 'castSkill', skillKey: skill.key })
    const angle = this.player.angle
    if (skill.kind === 'damage') {
      const count = skill.power >= 2 ? 7 : 5
      for (let i = 0; i < count; i += 1) {
        const spread = (i - (count - 1) / 2) * 0.12
        const bulletAngle = angle + spread
        this.bullets.push({
          x: this.player.x + Math.cos(bulletAngle) * 0.5,
          y: this.player.y + Math.sin(bulletAngle) * 0.5,
          vx: Math.cos(bulletAngle) * (BULLET_SPEED + 3),
          vy: Math.sin(bulletAngle) * (BULLET_SPEED + 3),
          damage: Math.max(2, Math.round(this.atk * Math.max(0.6, skill.power) * 0.4)),
          friendly: true,
          life: 1.2,
          radius: 0.13,
          color: '#c084fc',
        })
      }
      this.spawnParticles(this.player.x, this.player.y, 10, '#c084fc')
    } else if (skill.kind === 'heal' || skill.kind === 'cleanse') {
      const heal = Math.ceil(this.maxHp * (skill.healPct ?? 15) / 100)
      this.hp = Math.min(this.maxHp, this.hp + heal)
      this.spawnParticles(this.player.x, this.player.y, 12, '#86efac')
    } else if (skill.kind === 'shield') {
      this.player.shield = Math.max(this.player.shield, Math.ceil(this.maxHp * 0.3))
      this.spawnParticles(this.player.x, this.player.y, 12, '#93c5fd')
    } else {
      this.player.atkBuffUntil = now + 8000
      this.spawnParticles(this.player.x, this.player.y, 12, '#fde68a')
    }
    this.pushToast(`释放 ${skill.name}`, 'success', now)
    return true
  }

  useConsumable(kind: 'heal' | 'repair', now = Date.now()): boolean {
    if (this.dead) return false
    const catalog = ['medkit_plus', 'medkit', 'adrenaline', 'bandage']
    const repairKeys = ['helmet_repair', 'armor_repair']
    const keys = kind === 'heal' ? catalog : repairKeys
    for (const key of keys) {
      for (const from of ['rig', 'backpack'] as const) {
        const stacks = from === 'rig' ? this.rig : this.backpack
        if (!stacks.some((stack) => stack.itemKey === key)) continue
        const def = RAID_ITEM_MAP.get(key)
        if (!def) continue
        if (kind === 'heal' && this.hp >= this.maxHp && !def.mpGain) continue
        if (kind === 'repair') {
          const slot = def.repairSlot
          const gear: RaidGearInstance | null = slot === 'helmet' ? this.gear.helmet : slot === 'armor' ? this.gear.armor : null
          if (!gear || gear.durability >= gear.maxDurability) continue
        }
        const next = consumeItemFromContainer(stacks, key, 1)
        if (!next) continue
        if (from === 'rig') this.rig = normalizeContainer(next, this.capacities.rig, true)
        else this.backpack = normalizeContainer(next, this.capacities.backpack)
        this.events.push({ type: 'useItem', itemKey: key, from })
        if (def.healPct) this.hp = Math.min(this.maxHp, this.hp + Math.ceil(this.maxHp * def.healPct / 100))
        if (def.mpGain) this.mp = Math.min(this.maxMp, this.mp + def.mpGain)
        this.spawnParticles(this.player.x, this.player.y, 8, '#86efac')
        this.pushToast(`使用 ${def.name}`, 'success', now)
        return true
      }
    }
    this.pushToast(kind === 'heal' ? '没有可用的治疗道具' : '没有可用的维修包', 'danger', now)
    return false
  }

  abandon(): void {
    if (this.ended) return
    this.ended = true
    this.events.push({ type: 'abandon' })
  }

  /* ---------- 事件 / 服务端同步 ---------- */

  flushEvents(): RaidEvent[] {
    const events = this.events
    this.events = []
    return events
  }

  hasPendingEvents(): boolean {
    return this.events.length > 0
  }

  applyServerRun(run: RaidRun): void {
    this.hp = run.hp
    this.mp = run.mp
    this.maxHp = run.maxHp
    this.maxMp = run.maxMp
    this.atk = run.atk
    this.kills = run.kills
    this.gear = { ...run.gear }
    this.backpack = run.backpack.map((stack) => ({ ...stack }))
    this.rig = run.rig.map((stack) => ({ ...stack }))
    this.safe = run.safe.map((stack) => ({ ...stack }))
    this.capacities = { ...run.capacities }
    this.clearedRooms = new Set(run.clearedRooms)
    this.killedEnemies = new Set(run.killedEnemies)
    this.openedContainers = new Set(run.openedContainers)
    this.takenLoot = new Set(run.takenLoot)
    this.extractStartedAt = run.extractionStartedAt
    if (run.currentRoom !== this.roomId) {
      this.loadRoom(run.currentRoom)
    }
    if (run.status !== 'active') {
      this.ended = true
    }
    if (run.hp <= 0) this.dead = true
  }

  /* ---------- 特效 / 提示 ---------- */

  spawnParticles(x: number, y: number, count: number, color: string): void {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2
      const speed = 0.6 + Math.random() * 2.4
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.35 + Math.random() * 0.4,
        maxLife: 0.75,
        color,
        size: 0.05 + Math.random() * 0.08,
      })
    }
    if (this.particles.length > 220) {
      this.particles.splice(0, this.particles.length - 220)
    }
  }

  pushToast(text: string, tone: RaidToast['tone'], now: number): void {
    this.toastSeq += 1
    this.toasts.push({ id: this.toastSeq, text, tone, at: now })
    if (this.toasts.length > 4) this.toasts.splice(0, this.toasts.length - 4)
  }

  private updateToasts(now: number): void {
    this.toasts = this.toasts.filter((toast) => now - toast.at < 2600)
    // 粒子推进
    const next: LocalParticle[] = []
    for (const particle of this.particles) {
      particle.life -= 0.016
      if (particle.life <= 0) continue
      particle.x += particle.vx * 0.016
      particle.y += particle.vy * 0.016
      particle.vx *= 0.94
      particle.vy *= 0.94
      next.push(particle)
    }
    this.particles = next
  }

  /* ---------- HUD ---------- */

  snapshot(now = Date.now()): RaidSnapshot {
    const room = this.room
    const point = this.extractPoint
    const progress = this.extractStartedAt === null
      ? 0
      : clamp((now - this.extractStartedAt) / RAID_EXTRACT_CHANNEL_MS, 0, 1)
    const container = this.nearestContainer()
    return {
      hp: this.hp,
      mp: this.mp,
      maxHp: this.maxHp,
      maxMp: this.maxMp,
      atk: this.atk,
      kills: this.kills,
      roomId: this.roomId,
      roomKind: room?.kind ?? 'combat',
      roomCleared: this.roomCleared,
      remainingMs: Math.max(0, this.expiresAt - now),
      extractionProgress: progress,
      gear: this.gear,
      helmetDefense: raidDefenseOf(this.gear.helmet),
      armorDefense: raidDefenseOf(this.gear.armor),
      backpack: this.backpack,
      rig: this.rig,
      safe: this.safe,
      capacities: this.capacities,
      skills: this.skills.map((skill) => ({
        key: skill.key,
        name: skill.name,
        emoji: skill.emoji,
        mpCost: skill.mpCost,
        cooldownMs: skill.cooldownMs,
        cooldownLeftMs: Math.max(0, (this.skillReadyAt[skill.key] ?? 0) - now),
        affordable: this.mp >= skill.mpCost,
      })),
      toast: this.toasts[this.toasts.length - 1] ?? null,
      nearContainer: container ? { id: container.id, opened: container.opened } : null,
      canExtract: Boolean(point) && this.roomCleared,
      extracting: this.extractStartedAt !== null,
      dead: this.dead,
      shield: this.player.shield,
      atkBuffMs: Math.max(0, this.player.atkBuffUntil - now),
    }
  }
}
