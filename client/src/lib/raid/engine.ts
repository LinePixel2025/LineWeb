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
  RAID_GROUND_LOOT_LIMIT,
  RAID_GROUND_REARM_DISTANCE,
  RAID_ITEM_MAP,
  RAID_MP_REGEN_PER_SEC,
  RAID_TILE_HAZARD,
  RAID_TILE_WALL,
  addItemToContainer,
  consumeItemFromContainer,
  getRaidGear,
  normalizeContainer,
  raidDefenseOf,
  raidTileIndex,
  removeItemFromContainer,
  resolveDropPosition,
  resolveRaidDamage,
  type RaidContainerKind,
  type RaidEnemyNode,
  type RaidEvent,
  type RaidGearInstance,
  type RaidGroundStack,
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
/** 全场敌方子弹数上限：超限一律不再发射，防止 boss + 精英同屏的弹幕把低端机帧率打崩 */
export const MAX_ENEMY_BULLETS = 240
/** 狂暴（精英 / 首领 HP < 50%）时的普射冷却除数：冷却 ×1/1.4 ≈ 射速 ×1.4 */
const ENRAGE_COOLDOWN_DIVISOR = 1 / 1.4
/** 精英冲锋（skills 含 charge）：预警时长 / 冲刺时长 / 冲刺速度倍率 / 冷却（毫秒） */
const CHARGE_TELEGRAPH_S = 0.6
const CHARGE_DASH_S = 0.35
const CHARGE_SPEED_MULT = 6
const CHARGE_COOLDOWN_MS = 4000

/** 拾取飘字与火花按品质上色，稀有货掉出来要一眼看见 */
export const RARITY_SPARK: Record<string, string> = {
  common: '#cbd5e1',
  uncommon: '#4ade80',
  rare: '#60a5fa',
  epic: '#c084fc',
  legendary: '#fb923c',
  mythic: '#f87171',
}

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
  /** 远程单位开火前的蓄力（秒），渲染器据此画预警线 */
  telegraph: number
  /** 近战突进的剩余时长（秒） */
  lunge: number
  /** 精英冲锋：预警进度（1 → 0 递减，归零起跳），渲染器据此画预警线与读条 */
  chargeTelegraph: number
  /** 精英冲锋冷却（毫秒） */
  chargeCd: number
  /** 精英冲锋冲刺剩余时长（秒），>0 表示正在冲锋 */
  chargeDash: number
  /** 冲刺方向（起跳瞬间锁定的单位向量） */
  chargeDirX: number
  chargeDirY: number
  /** 一次冲锋只对玩家结算一次近战同档伤害 */
  chargeHit: boolean
  /** 远程怪绕圈方向（1 / -1）与换向倒计时（秒）：每 2.5–4s 随机翻转一次 */
  orbitDir: number
  orbitTimer: number
  /** 环形弹幕计数：起始角按次数递增（每次 +37°），让连续弹幕带螺旋感 */
  burstCount: number
  /** 视线检测结果缓存（约 120ms 节流，平板上逐帧采样太贵） */
  losOk?: boolean
  losAt?: number
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
  /** 元素 key（渲染器据此选择弹头形状与拖尾），普攻为 'kinetic' */
  element?: string
  /** 技能弹：命中时飘字按暴击样式放大 */
  skill?: boolean
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

/* ---------- 表现层：技能特效 / 飘字 / 命中标记 / 队友幽灵 ---------- */

export type RaidEffectKind =
  | 'cast' | 'ring' | 'cone' | 'bolt' | 'mist' | 'slash' | 'aura'
  | 'shield' | 'heal' | 'impact' | 'spark' | 'death' | 'door' | 'pickup' | 'muzzle'
  | 'nova' | 'shards' | 'pillar' | 'beam'

export interface RaidEffect {
  id: number
  kind: RaidEffectKind
  x: number
  y: number
  age: number
  life: number
  color: string
  accent: string
  /** 朝向（cone / slash / bolt 用） */
  angle: number
  /** 半径（世界单位） */
  radius: number
  /** 目标点（bolt / beam 用） */
  tx: number
  ty: number
  /** 是否玩家技能弹造成的伤害（放大飘字） */
  big: boolean
}

export interface RaidFloatText {
  id: number
  x: number
  y: number
  age: number
  life: number
  text: string
  color: string
  size: number
  crit: boolean
}

export interface RaidHitMarker {
  x: number
  y: number
  age: number
  crit: boolean
}

export interface RaidTeammate {
  userId: number
  name: string
  species: string
  x: number
  y: number
  angle: number
  hp: number
  maxHp: number
  roomId: number
  kills: number
  status: string
}

/** 队友共享世界增量（服务端 raid:squad:world 事件） */
export interface RaidWorldDelta {
  killedEnemies?: readonly string[]
  openedContainers?: readonly string[]
  takenLoot?: readonly string[]
  /** 队友丢到地上的物品（2026-11 新增） */
  groundDropped?: readonly RaidGroundStack[]
  /** 队友从地上捡走的物品 id */
  groundTaken?: readonly string[]
}

export interface SkillArt {
  color: string
  accent: string
  shape: 'cone' | 'bolt' | 'ring' | 'aura' | 'mist' | 'slash'
  label: string
}

const SKILL_ART_RULES: ReadonlyArray<{ keys: string[]; art: SkillArt }> = [
  { keys: ['fire', 'flame', 'burn', 'meteor', 'lava', 'blaze'], art: { color: '#fb923c', accent: '#fde68a', shape: 'cone', label: '烈焰' } },
  { keys: ['ice', 'frost', 'freeze', 'snow', 'glacial'], art: { color: '#7dd3fc', accent: '#e0f2fe', shape: 'ring', label: '冰霜' } },
  { keys: ['thunder', 'lightning', 'bolt', 'storm', 'spark'], art: { color: '#a78bfa', accent: '#fef08a', shape: 'bolt', label: '雷击' } },
  { keys: ['poison', 'venom', 'toxic', 'acid', 'plague'], art: { color: '#4ade80', accent: '#bbf7d0', shape: 'mist', label: '剧毒' } },
  { keys: ['shadow', 'dark', 'night', 'void', 'curse'], art: { color: '#c084fc', accent: '#7c3aed', shape: 'slash', label: '暗影' } },
  { keys: ['holy', 'light', 'saint', 'purge', 'cleanse', 'judg'], art: { color: '#fcd34d', accent: '#fffbeb', shape: 'ring', label: '圣光' } },
  { keys: ['heal', 'renew', 'mend', 'life', 'siphon', 'drain'], art: { color: '#34d399', accent: '#a7f3d0', shape: 'aura', label: '生机' } },
  { keys: ['shield', 'wall', 'armor', 'iron', 'guard', 'thorn'], art: { color: '#60a5fa', accent: '#bfdbfe', shape: 'aura', label: '护甲' } },
  { keys: ['war', 'cry', 'rage', 'frenzy', 'buff', 'accel', 'time'], art: { color: '#f87171', accent: '#fecaca', shape: 'aura', label: '战意' } },
  { keys: ['star', 'comet', 'astral', 'cosmic', 'nova'], art: { color: '#818cf8', accent: '#e0e7ff', shape: 'bolt', label: '星辰' } },
]

const SKILL_ART_FALLBACK: Record<string, SkillArt> = {
  damage: { color: '#c084fc', accent: '#f0abfc', shape: 'cone', label: '强化弹' },
  shield: { color: '#60a5fa', accent: '#bfdbfe', shape: 'aura', label: '护盾' },
  heal: { color: '#34d399', accent: '#a7f3d0', shape: 'aura', label: '治疗' },
  cleanse: { color: '#fcd34d', accent: '#fffbeb', shape: 'ring', label: '净化' },
  buff: { color: '#f87171', accent: '#fecaca', shape: 'aura', label: '增幅' },
}

/** 技能 key → 视觉元素：先按 key 命中关键词，再退回 kind */
export function resolveSkillArt(key: string, kind: string): SkillArt {
  const lower = key.toLowerCase()
  for (const rule of SKILL_ART_RULES) {
    if (rule.keys.some((token) => lower.includes(token))) return rule.art
  }
  return SKILL_ART_FALLBACK[kind] ?? SKILL_ART_FALLBACK.damage!
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
  readonly seed: number
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
  effects: RaidEffect[] = []
  floats: RaidFloatText[] = []
  hitMarkers: RaidHitMarker[] = []
  /** 队友幽灵（组队模式由页面喂入，本地做位置插值） */
  teammates: RaidTeammate[] = []
  /** 屏幕震动剩余时长 / 强度 */
  shakeMs = 0
  shakeAmp = 0
  /** 受击红闪剩余比例（1 → 0） */
  hurtFlash = 0
  /** 受击方向指示（弧度 + 剩余寿命秒） */
  hurtDirs: { angle: number; age: number }[] = []
  /** 技能释放瞬间的屏幕染色（让低画质模式也有明确的技能反馈） */
  skillFlash: { color: string; ms: number; life: number } | null = null
  /** 技能名横幅（技能释放时在角色上方浮出） */
  skillBanner: { text: string; color: string; age: number; life: number } | null = null
  /** 表现层质量：低端设备降低粒子数量，但保留技能特效 */
  cosmeticLevel: 'high' | 'balanced' | 'low' = 'high'

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
  extractLastSentAt = 0
  dead = false
  ended = false

  /** 丢弃在地面的物品（对局内临时，含队友丢的） */
  groundLoot: RaidGroundStack[] = []
  /** 地面物品发号器（与服务端 groundSeq 同基址同步推进） */
  groundSeq = 0
  /**
   * 自己丢下的地面物品 id → 是否已「走远重新武装」。
   * 未武装的条目不参与自动捡起，否则丢在脚边的东西会被下一帧立刻捡回，丢弃等于无效操作。
   * 队友丢的不在这里（他们的 id 由世界增量推过来），照常「走过即捡」。
   */
  ownDroppedGround = new Map<string, boolean>()
  /** 触屏自动锁敌：开火/瞄准时吸附最近可视敌人（桌面鼠标瞄准不受影响） */
  aimAssist = false

  private events: RaidEvent[] = []
  private fireCooldown = 0
  private hazardAccum = 0
  private mpAccum = 0
  private transitionLock = 0
  private toastSeq = 0
  private lastFullToastAt = 0
  private effectSeq = 0
  private floatSeq = 0
  private skillReadyAt: Record<string, number> = {}
  /**
   * 首领「瞄准 3 连发」的延时队列（间隔约 120ms）：由 update 循环逐帧消化，
   * 不用 setTimeout——页面切后台 rAF 暂停时定时器不会乱序堆积，恢复后一起打出。
   */
  private pendingEnemyShots: { at: number; enemyId: string }[] = []

  constructor(run: RaidRun, species: string, now = Date.now()) {
    this.map = run.map
    this.skills = run.skills
    this.species = species
    this.seed = run.seed
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
    this.groundLoot = (run.groundLoot ?? []).map((item) => ({ ...item }))
    this.groundSeq = run.groundSeq ?? 0
    this.ownDroppedGround.clear()
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
        telegraph: 0,
        lunge: 0,
        chargeTelegraph: 0,
        chargeCd: 2200 + Math.random() * 1800,
        chargeDash: 0,
        chargeDirX: 0,
        chargeDirY: 0,
        chargeHit: false,
        orbitDir: Math.random() < 0.5 ? 1 : -1,
        orbitTimer: 2.5 + Math.random() * 1.5,
        burstCount: 0,
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
    // 换房清场：连发队列与房间绑定，旧房间的后续连发作废
    this.pendingEnemyShots = []
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
    const dt = Math.min(0.05, Math.max(0, dtMs / 1000))
    // 表现层即使玩家阵亡 / 结算后也要继续衰减（否则特效会定格在画面上）
    this.updateCosmetics(dt)
    if (this.dead || this.ended || dt <= 0) return
    this.transitionLock = Math.max(0, this.transitionLock - dtMs)
    this.updatePlayer(dt, now)
    this.updateEnemies(dt, now)
    this.processPendingEnemyShots(now)
    this.updateBullets(dt)
    this.updatePickups()
    this.updateGroundPickups()
    this.updateHazard(dt, now)
    this.updateMp(dt)
    this.updateExtraction(now)
    this.updateToasts(now)
  }

  /** 撤离读条走完自动完成：手机上不需要再按一次「交互」 */
  private updateExtraction(now: number): void {
    if (this.extractStartedAt === null) return
    if (now - this.extractStartedAt < RAID_EXTRACT_CHANNEL_MS) return
    if (this.extractSentDone) {
      // 服务端拒绝（时钟偏差 / 慢网）时每 2 秒重试一次，避免本局卡死
      if (now - this.extractLastSentAt > 2000 && !this.ended) this.extractSentDone = false
      else return
    }
    this.extractSentDone = true
    this.extractLastSentAt = now
    const point = this.extractPoint
    if (point) {
      this.spawnEffect('aura', point.x + 0.5, point.y + 0.5, {
        color: '#34d399',
        accent: '#d1fae5',
        radius: 2.6,
        life: 1.2,
      })
    }
    this.events.push({ type: 'extractDone' })
    this.pushToast('撤离读条完成', 'success', now)
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
      // 触屏自动锁敌：开火时在朝向 ±75° 锥内吸附最近可视敌人，避免摇杆瞄不准
      if (this.aimAssist && input.firing) {
        const snapped = this.aimAssistAngle(this.player.angle)
        if (snapped !== null) this.player.angle = snapped
      }
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
      const tileY = Math.floor(this.player.y)
      // 房间边界上的走廊有 3 格宽（门在正中，上下各一格也是可走的），
      // 只认「门格」会导致从侧格走出去后既没换房、又走出渲染裁剪区。
      // 这里统一按「目标瓦片属于哪个房间」判定换房，任何一格都能正常进出。
      const crossed = this.roomAtTile(tileX, tileY)
      if (crossed && crossed.id !== this.roomId && room.neighbors.includes(crossed.id)) {
        this.transitionToRoom(crossed.id, this.player.x, this.player.y, now)
        return
      }
      this.player.x = nextX
    }
    const nextY = this.player.y + dy
    if (this.canStand(this.player.x, nextY)) {
      const tileX = Math.floor(this.player.x)
      const tileY = Math.floor(nextY)
      const crossed = this.roomAtTile(tileX, tileY)
      if (crossed && crossed.id !== this.roomId && room.neighbors.includes(crossed.id)) {
        this.transitionToRoom(crossed.id, this.player.x, this.player.y, now)
        return
      }
      this.player.y = nextY
    }
  }

  /** 玩家所在瓦片归属的房间（房间矩形互不重叠，走廊格归属相邻房间） */
  private roomAtTile(x: number, y: number): RaidRoomNode | null {
    for (const room of this.map.rooms) {
      if (x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h) return room
    }
    return null
  }

  private canStand(x: number, y: number): boolean {
    const r = PLAYER_RADIUS
    for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r]] as const) {
      const tile = tileAt(this.map, Math.floor(x + ox), Math.floor(y + oy))
      if (tile === RAID_TILE_WALL) return false
    }
    return true
  }

  /** 进入相邻房间：落在目标房间靠门一侧，避免直接叠在房中央的敌人堆里 */
  private transitionToRoom(target: number, fromX: number, fromY: number, now: number): void {
    if (this.transitionLock > 0) return
    const targetRoom = this.map.rooms[target]
    const prevRoom = this.room
    if (!targetRoom || !prevRoom) return
    if (!prevRoom.neighbors.includes(target)) return
    if (!this.roomCleared) {
      this.pushToast('房间还有敌人，门锁死了', 'danger', now)
      this.transitionLock = 600
      return
    }
    this.loadRoom(target)
    const margin = 2
    if (targetRoom.col > prevRoom.col) {
      this.player.x = targetRoom.x + margin
      this.player.y = clamp(fromY, targetRoom.y + margin, targetRoom.y + targetRoom.h - margin)
    } else if (targetRoom.col < prevRoom.col) {
      this.player.x = targetRoom.x + targetRoom.w - margin
      this.player.y = clamp(fromY, targetRoom.y + margin, targetRoom.y + targetRoom.h - margin)
    } else if (targetRoom.row > prevRoom.row) {
      this.player.y = targetRoom.y + margin
      this.player.x = clamp(fromX, targetRoom.x + margin, targetRoom.x + targetRoom.w - margin)
    } else {
      this.player.y = targetRoom.y + targetRoom.h - margin
      this.player.x = clamp(fromX, targetRoom.x + margin, targetRoom.x + targetRoom.w - margin)
    }
    this.events.push({ type: 'enterRoom', roomId: target })
    this.transitionLock = 700
    this.spawnEffect('door', this.player.x, this.player.y, {
      color: targetRoom.kind === 'extract' ? '#38bdf8' : '#facc15',
      accent: '#f8fafc',
      radius: 1.4,
      life: 0.5,
    })
    this.pushToast(targetRoom.kind === 'extract' ? '到达撤离区' : '进入新房间', 'info', now)
  }

  /* ---------- 射击 ---------- */

  private fireBullet(): void {
    const angle = this.player.angle
    const buff = this.player.atkBuffUntil > Date.now() ? 1.4 : 1
    const damage = Math.max(1, Math.round(this.atk * PLAYER_BULLET_DAMAGE_RATE * buff))
    const tipX = this.player.x + Math.cos(angle) * 0.62
    const tipY = this.player.y + Math.sin(angle) * 0.62
    this.bullets.push({
      x: tipX,
      y: tipY,
      vx: Math.cos(angle) * BULLET_SPEED,
      vy: Math.sin(angle) * BULLET_SPEED,
      damage,
      friendly: true,
      life: 1.4,
      radius: 0.11,
      color: buff > 1 ? '#fcd34d' : '#7dd3fc',
      element: 'kinetic',
    })
    // 枪口焰 + 极轻震动：普攻也要有「打出去了」的反馈
    this.spawnEffect('muzzle', tipX, tipY, {
      color: buff > 1 ? '#fde68a' : '#bae6fd',
      accent: '#f8fafc',
      angle,
      radius: 0.5,
      life: 0.14,
    })
    this.spawnParticles(tipX, tipY, 3, buff > 1 ? '#fcd34d' : '#7dd3fc')
    this.addShake(50, 0.018)
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
      // —— 精英冲锋（skills 含 charge）：预警中 / 冲刺中时整帧由冲锋状态机接管 ——
      if (enemy.source.skills.includes('charge') && this.updateEnemyCharge(enemy, dt, now, dx, dy, dist)) {
        this.clampEnemyToRoom(enemy, room)
        continue
      }
      if (enemy.source.ranged) {
        const preferred = enemy.source.kind === 'boss' ? 5.5 : 4.5
        // 绕圈方向每 2.5–4s 随机翻转一次：固定转向会被玩家摸清节奏站桩输出
        enemy.orbitTimer -= dt
        if (enemy.orbitTimer <= 0) {
          enemy.orbitTimer = 2.5 + Math.random() * 1.5
          enemy.orbitDir = Math.random() < 0.5 ? 1 : -1
        }
        // 远程怪与玩家 dist < 2.5 时后撤拉开距离，其余时间维持理想射程
        let move = 0
        if (dist < 2.5) move = -1
        else if (dist > preferred + 0.6) move = 1
        else if (dist < preferred - 1.2) move = -1
        if (move !== 0) {
          enemy.x += nx * move * speed * dt
          enemy.y += ny * move * speed * dt
        } else {
          enemy.x += -ny * speed * dt * 0.5 * enemy.orbitDir
          enemy.y += nx * speed * dt * 0.5 * enemy.orbitDir
        }
        const locked = dist < 9 && this.sightCheck(enemy, now)
        // 开火预警：冷却临近时 telegraph 爬到 1，渲染器画准星与预警线
        enemy.telegraph = locked ? clamp(1 - enemy.cooldown / 480, 0, 1) : Math.max(0, enemy.telegraph - dt * 3)
        if (enemy.cooldown <= 0 && locked) {
          enemy.cooldown = this.enemyFireCooldown(enemy)
          enemy.telegraph = 0
          this.enemyShoot(enemy, nx, ny)
        }
        if (enemy.source.kind === 'boss' && enemy.burstCooldown <= 0 && dist < 10) {
          enemy.burstCooldown = 4200
          this.enemyBurst(enemy)
        }
      } else {
        enemy.telegraph = Math.max(0, enemy.telegraph - dt * 3)
        enemy.lunge = Math.max(0, enemy.lunge - dt)
        if (dist > 0.75) {
          enemy.x += nx * speed * dt
          enemy.y += ny * speed * dt
        }
        if (dist < 0.95 && enemy.cooldown <= 0) {
          enemy.cooldown = 950
          enemy.lunge = 0.26
          this.hurtPlayer(enemy.source.damage, 'body', now, Math.atan2(enemy.y - this.player.y, enemy.x - this.player.x))
          this.spawnParticles(
            (enemy.x + this.player.x) / 2,
            (enemy.y + this.player.y) / 2,
            6,
            '#fca5a5',
          )
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

  /**
   * 敌人普射冷却（毫秒），按类型差异化：首领 1100 / 精英 1350 / 普通 1500。
   * 狂暴判定（精英 / 首领 HP < 50%）即时算、不落持久状态：冷却 ×1/1.4 ≈ 射速 ×1.4。
   */
  private enemyFireCooldown(enemy: LocalEnemy): number {
    const base = enemy.source.kind === 'boss' ? 1100 : enemy.source.kind === 'elite' ? 1350 : 1500
    const enraged = (enemy.source.kind === 'boss' || enemy.source.kind === 'elite') && enemy.hp < enemy.maxHp * 0.5
    return base * (enraged ? ENRAGE_COOLDOWN_DIVISOR : 1)
  }

  /** 全场敌方子弹数（MAX_ENEMY_BULLETS 上限检查用） */
  private hostileBulletCount(): number {
    let count = 0
    for (const bullet of this.bullets) {
      if (!bullet.friendly) count += 1
    }
    return count
  }

  /**
   * 敌方子弹统一出口：上限检查 + 枪口焰都在这里做，
   * 直射 / 扇形 / 连发 / 环形弹幕共用，避免任何实现绕过 MAX_ENEMY_BULLETS。
   */
  private spawnEnemyBullet(enemy: LocalEnemy, angle: number, speed: number): void {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    this.bullets.push({
      x: enemy.x + cos * 0.5,
      y: enemy.y + sin * 0.5,
      vx: cos * speed,
      vy: sin * speed,
      damage: enemy.source.damage,
      friendly: false,
      life: 2.4,
      radius: 0.13,
      color: '#f87171',
      element: 'hostile',
    })
    this.spawnEffect('muzzle', enemy.x + cos * 0.55, enemy.y + sin * 0.55, {
      color: '#fca5a5',
      accent: '#fee2e2',
      angle,
      radius: 0.45,
      life: 0.16,
    })
  }

  /**
   * 精英冲锋状态机（只对 skills 含 charge 的敌人挂载）。
   * 返回 true 表示本帧被冲锋状态（预警 / 冲刺）接管，跳过常规移动与开火。
   * - 4s 冷却，与玩家 dist 在 4–9 之间时触发（太近太远都不读轨迹）；
   * - 0.6s 预警：chargeTelegraph 从 1 → 0，渲染器画预警线与读条；
   * - 起跳瞬间锁定当时玩家方向，0.35s 高速冲刺（速度 = 普通移动 ×6），
   *   冲锋路径碰触玩家造成一次近战同档伤害（复用接触伤害数值），一次冲刺只结算一次。
   */
  private updateEnemyCharge(
    enemy: LocalEnemy,
    dt: number,
    now: number,
    dx: number,
    dy: number,
    dist: number,
  ): boolean {
    if (enemy.chargeDash > 0) {
      enemy.chargeDash = Math.max(0, enemy.chargeDash - dt)
      enemy.x += enemy.chargeDirX * enemy.source.speed * CHARGE_SPEED_MULT * dt
      enemy.y += enemy.chargeDirY * enemy.source.speed * CHARGE_SPEED_MULT * dt
      if (
        !enemy.chargeHit
        && distance(enemy.x, enemy.y, this.player.x, this.player.y) <= enemy.source.radius + PLAYER_RADIUS + 0.15
      ) {
        enemy.chargeHit = true
        this.hurtPlayer(enemy.source.damage, 'body', now, Math.atan2(enemy.y - this.player.y, enemy.x - this.player.x))
        this.spawnParticles(
          (enemy.x + this.player.x) / 2,
          (enemy.y + this.player.y) / 2,
          6,
          '#fca5a5',
        )
      }
      if (enemy.chargeDash <= 0) enemy.chargeCd = CHARGE_COOLDOWN_MS
      return true
    }
    if (enemy.chargeTelegraph > 0) {
      enemy.chargeTelegraph = Math.max(0, enemy.chargeTelegraph - dt / CHARGE_TELEGRAPH_S)
      if (enemy.chargeTelegraph <= 0) {
        // 起跳瞬间锁定方向：冲向预警结束时玩家所在的位置，走位可以躲
        const len = dist > 0.001 ? dist : 1
        enemy.chargeDirX = dx / len
        enemy.chargeDirY = dy / len
        enemy.chargeDash = CHARGE_DASH_S
        enemy.chargeHit = false
      }
      return true
    }
    enemy.chargeCd = Math.max(0, enemy.chargeCd - dt * 1000)
    if (enemy.chargeCd <= 0 && dist >= 4 && dist <= 9) {
      enemy.chargeTelegraph = 1
    }
    return false
  }

  /** 消化首领连发队列：到点后重新瞄准玩家当前位置补一发（不进狂暴扇形，保持「瞄准 3 连发」读感） */
  private processPendingEnemyShots(now: number): void {
    if (this.pendingEnemyShots.length === 0) return
    const remain: { at: number; enemyId: string }[] = []
    for (const shot of this.pendingEnemyShots) {
      if (now < shot.at) {
        remain.push(shot)
        continue
      }
      const enemy = this.enemies.find((entry) => entry.id === shot.enemyId && !entry.dead)
      if (!enemy) continue
      const dx = this.player.x - enemy.x
      const dy = this.player.y - enemy.y
      const dist = Math.hypot(dx, dy) || 1
      if (this.hostileBulletCount() < MAX_ENEMY_BULLETS) {
        this.spawnEnemyBullet(enemy, Math.atan2(dy, dx), 7.8)
        this.spawnParticles(enemy.x, enemy.y, 3, '#f87171')
      }
    }
    this.pendingEnemyShots = remain
  }

  private enemyShoot(enemy: LocalEnemy, nx: number, ny: number): void {
    const baseAngle = Math.atan2(ny, nx)
    const spread = enemy.source.kind === 'elite' ? 0.12 : 0
    // 精英改 3-way 扇形（中心瞄准 + ±0.22rad，保留原有随机抖动），狂暴扩为 5-way（±0.44rad）；
    // 普通怪保持单发直线；弹速按类型差异化（首领略快，压迫感更强）
    const enraged = enemy.source.kind === 'elite' && enemy.hp < enemy.maxHp * 0.5
    const fan = enemy.source.kind === 'elite'
      ? (enraged ? [-0.44, -0.22, 0, 0.22, 0.44] : [-0.22, 0, 0.22])
      : [0]
    const speed = enemy.source.kind === 'boss' ? 7.8 : enemy.source.kind === 'elite' ? 7.4 : 7
    let budget = MAX_ENEMY_BULLETS - this.hostileBulletCount()
    for (const offset of fan) {
      if (budget <= 0) break
      budget -= 1
      const angle = baseAngle + offset + (Math.random() - 0.5) * spread
      this.spawnEnemyBullet(enemy, angle, speed)
    }
    if (enemy.source.kind === 'boss') {
      // 首领改瞄准 3 连发：后两发进延时队列（约 120ms 一发），由 update 循环消化
      this.pendingEnemyShots.push({ at: Date.now() + 120, enemyId: enemy.id })
      this.pendingEnemyShots.push({ at: Date.now() + 240, enemyId: enemy.id })
    }
    this.spawnParticles(enemy.x, enemy.y, 3, '#f87171')
  }

  private enemyBurst(enemy: LocalEnemy): void {
    const count = 12
    // 环形 10 → 12 发，起始角按该 boss 的弹幕次数每次 +37° 递增：连续弹幕带螺旋感，
    // 不再是每一圈都一样的正多边形
    const start = enemy.burstCount * ((37 * Math.PI) / 180)
    enemy.burstCount += 1
    let budget = MAX_ENEMY_BULLETS - this.hostileBulletCount()
    for (let i = 0; i < count; i += 1) {
      if (budget <= 0) break
      budget -= 1
      const angle = start + (i / count) * Math.PI * 2
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      this.bullets.push({
        x: enemy.x + cos * 0.6,
        y: enemy.y + sin * 0.6,
        vx: cos * 5.2,
        vy: sin * 5.2,
        damage: Math.max(4, Math.round(enemy.source.damage * 0.7)),
        friendly: false,
        life: 2.6,
        radius: 0.15,
        color: '#fbbf24',
        element: 'hostile',
      })
    }
    // 首领弹幕：一圈 expanding ring + 屏震，给玩家「大范围技能要开始了」的读感
    this.spawnEffect('ring', enemy.x, enemy.y, {
      color: '#fbbf24',
      accent: '#fef3c7',
      radius: 3.2,
      life: 0.7,
    })
    this.spawnParticles(enemy.x, enemy.y, 14, '#fbbf24')
    this.addShake(160, 0.05)
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
        this.spawnEffect('impact', nx, ny, {
          color: bullet.friendly ? '#bae6fd' : '#fecaca',
          accent: '#f8fafc',
          radius: 0.35,
          life: 0.22,
        })
        continue
      }
      bullet.x = nx
      bullet.y = ny
      if (bullet.friendly) {
        let hit = false
        for (const enemy of this.enemies) {
          if (enemy.dead) continue
          if (distance(bullet.x, bullet.y, enemy.x, enemy.y) <= enemy.source.radius + 0.35) {
            this.hurtEnemy(enemy, bullet.damage, Boolean(bullet.skill), bullet.color)
            hit = true
            break
          }
        }
        if (hit) {
          this.spawnParticles(bullet.x, bullet.y, 4, '#fef08a')
          continue
        }
      } else if (distance(bullet.x, bullet.y, this.player.x, this.player.y) <= PLAYER_RADIUS + bullet.radius) {
        this.hurtPlayer(
          bullet.damage,
          Math.random() < 0.2 ? 'head' : 'body',
          Date.now(),
          Math.atan2(bullet.vy, bullet.vx),
        )
        this.spawnParticles(bullet.x, bullet.y, 4, '#f87171')
        continue
      }
      if (!room || bullet.x < room.x - 1 || bullet.x > room.x + room.w + 1) continue
      survivors.push(bullet)
    }
    this.bullets = survivors
  }

  private hurtEnemy(enemy: LocalEnemy, damage: number, big = false, color = '#7dd3fc'): void {
    enemy.hp = Math.max(0, enemy.hp - damage)
    enemy.hitFlash = 0.12
    // 命中反馈：X 形命中标记 + 飘字 + 元素火花，技能弹放大字号并加震动
    this.markHit(enemy.x, enemy.y, big)
    this.pushFloat(String(Math.round(damage)), enemy.x, enemy.y - enemy.source.radius, big ? '#fde68a' : '#e2e8f0', big)
    this.spawnParticles(enemy.x, enemy.y, big ? 6 : 3, color)
    if (big) this.addShake(70, 0.03)
    if (enemy.hp > 0) return
    enemy.dead = true
    this.killedEnemies.add(enemy.id)
    this.kills += 1
    this.events.push({ type: 'kill', enemyId: enemy.id })
    const killColor = enemy.source.kind === 'boss' ? '#fbbf24' : enemy.source.kind === 'elite' ? '#f97316' : '#fca5a5'
    this.spawnEffect('death', enemy.x, enemy.y, {
      color: killColor,
      accent: '#fff7ed',
      radius: enemy.source.radius * (enemy.source.kind === 'boss' ? 4 : 2.4),
      life: enemy.source.kind === 'boss' ? 0.95 : 0.6,
    })
    this.spawnParticles(enemy.x, enemy.y, enemy.source.kind === 'boss' ? 26 : 12, killColor)
    this.addShake(enemy.source.kind === 'boss' ? 260 : 120, enemy.source.kind === 'boss' ? 0.1 : 0.045)
    if (enemy.source.kind === 'boss') this.pushFloat('首领击倒', enemy.x, enemy.y - 1, '#fbbf24', true)
    this.pushToast(`击倒 ${enemy.source.name}`, 'success', Date.now())
    if (this.roomCleared) {
      this.events.push({ type: 'clearRoom', roomId: this.roomId })
      this.unlockDoors()
      this.pushToast('房间已清空，房门解锁', 'success', Date.now())
    }
  }

  /** 清场瞬间：给所有门挂上开门特效（配合渲染器的门锁状态变化） */
  private unlockDoors(): void {
    const room = this.room
    if (!room) return
    for (const door of this.map.doors) {
      if (door.roomA !== room.id && door.roomB !== room.id) continue
      this.spawnEffect('door', door.x + 0.5, door.y + 0.5, {
        color: '#facc15',
        accent: '#fef9c3',
        radius: 1.1,
        life: 0.7,
      })
    }
  }

  /* ---------- 受伤 ---------- */

  hurtPlayer(raw: number, zone: 'head' | 'body', now: number, fromAngle?: number): void {
    if (this.dead) return
    if (this.player.shield > 0) {
      const absorbed = Math.min(this.player.shield, raw)
      this.player.shield -= absorbed
      raw -= absorbed
      if (raw <= 0) {
        this.pushFloat(`吸收 ${Math.round(absorbed)}`, this.player.x, this.player.y - 0.6, '#93c5fd', false)
        this.spawnEffect('shield', this.player.x, this.player.y, {
          color: '#60a5fa', accent: '#bfdbfe', radius: 0.9, life: 0.3,
        })
        this.rememberHurt(fromAngle)
        return
      }
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
    // 受击反馈：红闪 + 震屏 + 方向指示 + 掉血飘字（护甲挡掉的部分单独提示）
    const blocked = Math.max(0, Math.round(raw - result.hpDamage))
    this.hurtFlash = Math.min(1, 0.5 + result.hpDamage / Math.max(1, this.maxHp) * 4)
    this.addShake(zone === 'head' ? 200 : 140, zone === 'head' ? 0.075 : 0.05)
    this.pushFloat(`-${Math.round(result.hpDamage)}`, this.player.x, this.player.y - 0.7, '#fda4af', zone === 'head')
    if (blocked > 0) this.pushFloat(`甲挡 ${blocked}`, this.player.x, this.player.y - 1.15, '#94a3b8', false)
    this.spawnParticles(this.player.x, this.player.y, 6, '#fda4af')
    this.rememberHurt(fromAngle)
    if (this.hp <= 0) {
      this.dead = true
      this.spawnEffect('death', this.player.x, this.player.y, {
        color: '#f87171', accent: '#fee2e2', radius: 1.6, life: 1.1,
      })
      this.addShake(420, 0.12)
      this.pushToast('你倒下了……', 'danger', now)
    }
  }

  /** 记录伤害来源方位：显式角度优先，否则取最近活敌方向（供 HUD 弧形指示） */
  private rememberHurt(fromAngle?: number): void {
    let angle: number | null = fromAngle ?? null
    if (angle === null) {
      let best: LocalEnemy | null = null
      let bestDist = Number.POSITIVE_INFINITY
      for (const enemy of this.enemies) {
        if (enemy.dead) continue
        const dist = distance(enemy.x, enemy.y, this.player.x, this.player.y)
        if (dist < bestDist) {
          bestDist = dist
          best = enemy
        }
      }
      angle = best ? Math.atan2(best.y - this.player.y, best.x - this.player.x) : null
    }
    if (angle === null) return
    this.hurtDirs.push({ angle, age: 1.6 })
    if (this.hurtDirs.length > 6) this.hurtDirs.splice(0, this.hurtDirs.length - 6)
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
      this.spawnParticles(pickup.x, pickup.y, 5, RARITY_SPARK[def.rarity] ?? '#e2e8f0')
      this.pushFloat(
        `${def.name} ×${pickup.amount}`,
        pickup.x,
        pickup.y - 0.4,
        RARITY_SPARK[def.rarity] ?? '#e2e8f0',
        def.rarity === 'legendary' || def.rarity === 'mythic',
      )
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

  /** 清掉已经不在这份地面清单里的「自己丢的」标记，避免 Map 随对局时长无界增长 */
  private pruneOwnDropped(): void {
    if (this.ownDroppedGround.size === 0) return
    const alive = new Set(this.groundLoot.map((item) => item.id))
    for (const id of this.ownDroppedGround.keys()) {
      if (!alive.has(id)) this.ownDroppedGround.delete(id)
    }
  }

  /** 走过地面掉落物自动捡起（安全箱不自动收；自己刚丢的要先走远才重新算「路过可捡」） */
  private updateGroundPickups(): void {
    if (this.groundLoot.length === 0) return
    const remain: RaidGroundStack[] = []
    for (const item of this.groundLoot) {
      if (item.roomId !== this.roomId) {
        remain.push(item)
        continue
      }
      const dist = distance(item.x, item.y, this.player.x, this.player.y)
      // 自己丢下的：未走远到重新武装距离之前，一律原地留着（且不弹「背包已满」）
      if (this.ownDroppedGround.get(item.id) === false) {
        if (dist > RAID_GROUND_REARM_DISTANCE) this.ownDroppedGround.set(item.id, true)
        else {
          remain.push(item)
          continue
        }
      }
      if (dist > 0.7) {
        remain.push(item)
        continue
      }
      const def = RAID_ITEM_MAP.get(item.itemKey)
      if (!def) continue
      const target: RaidContainerKind | null = this.canFitItem('backpack', item.itemKey)
        ? 'backpack'
        : this.canFitItem('rig', item.itemKey) ? 'rig' : null
      if (target === null) {
        const now = Date.now()
        if (now - this.lastFullToastAt > 1500) {
          this.lastFullToastAt = now
          this.pushToast('背包与胸挂都满了，捡不起来', 'danger', now)
        }
        remain.push(item)
        continue
      }
      const stacks = target === 'rig' ? this.rig : this.backpack
      const capacity = target === 'rig' ? this.capacities.rig : this.capacities.backpack
      const next = addItemToContainer(stacks, capacity, item.itemKey, item.amount)
      if (!next) {
        remain.push(item)
        continue
      }
      if (target === 'rig') this.rig = next
      else this.backpack = next
      this.groundLoot = this.groundLoot.filter((entry) => entry.id !== item.id)
      this.ownDroppedGround.delete(item.id)
      this.events.push({ type: 'takeGround', groundId: item.id, target })
      this.spawnParticles(item.x, item.y, 5, RARITY_SPARK[def.rarity] ?? '#e2e8f0')
      this.pushFloat(
        `${def.name} ×${item.amount}`,
        item.x,
        item.y - 0.4,
        RARITY_SPARK[def.rarity] ?? '#e2e8f0',
        def.rarity === 'legendary' || def.rarity === 'mythic',
      )
      this.pushToast(`捡起 ${def.name} ×${item.amount}`, 'info', Date.now())
    }
    this.groundLoot = remain
  }

  /* ---------- 交互 ---------- */

  interact(now = Date.now()): void {
    if (this.dead || this.ended) return
    const point = this.extractPoint
    if (point && distance(point.x + 0.5, point.y + 0.5, this.player.x, this.player.y) < 2.2) {
      if (this.extractStartedAt === null) {
        this.extractStartedAt = now
        this.events.push({ type: 'extractStart' })
        this.spawnEffect('ring', point.x + 0.5, point.y + 0.5, {
          color: '#38bdf8',
          accent: '#bae6fd',
          radius: 2.2,
          life: 1.2,
        })
        this.pushToast('开始撤离读条，站稳别动……', 'info', now)
      } else if (now - this.extractStartedAt >= RAID_EXTRACT_CHANNEL_MS && !this.extractSentDone) {
        this.extractSentDone = true
        this.extractLastSentAt = now
        this.spawnEffect('aura', point.x + 0.5, point.y + 0.5, {
          color: '#34d399',
          accent: '#d1fae5',
          radius: 2.6,
          life: 1.2,
        })
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
    this.spawnEffect('pickup', container.x, container.y, {
      color: '#fbbf24',
      accent: '#fef9c3',
      radius: 1.3,
      life: 0.6,
    })
    this.spawnParticles(container.x, container.y, 10, '#fbbf24')
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
    if (!skill || this.dead || this.ended) return false
    const art = resolveSkillArt(skill.key, skill.kind)
    const readyAt = this.skillReadyAt[skill.key] ?? 0
    if (now < readyAt) {
      // 失败也要有反馈：冷却 / 能量不足都在角色脚下给出可读提示
      this.pushToast(`${skill.name} 冷却中（${Math.ceil((readyAt - now) / 1000)}s）`, 'info', now)
      this.pushFloat('冷却中', this.player.x, this.player.y - 0.8, '#94a3b8', false)
      this.spawnEffect('ring', this.player.x, this.player.y, {
        color: '#94a3b8', accent: '#cbd5e1', radius: 0.8, life: 0.3,
      })
      return false
    }
    if (this.mp < skill.mpCost) {
      this.pushToast(`能量不足（需要 ${skill.mpCost} MP）`, 'danger', now)
      this.pushFloat(`MP ${Math.ceil(this.mp)}/${skill.mpCost}`, this.player.x, this.player.y - 0.8, '#60a5fa', false)
      this.spawnEffect('ring', this.player.x, this.player.y, {
        color: '#60a5fa', accent: '#bfdbfe', radius: 0.9, life: 0.35,
      })
      return false
    }
    this.mp -= skill.mpCost
    this.skillReadyAt[skill.key] = now + skill.cooldownMs
    this.events.push({ type: 'castSkill', skillKey: skill.key })

    // 技能自动锁敌（全平台）：伤害技能朝最近可视敌人，无目标保持当前朝向
    let angle = this.player.angle
    if (skill.kind === 'damage') {
      const auto = this.skillAutoTarget()
      if (auto !== null) angle = auto
    }
    const px = this.player.x
    const py = this.player.y
    // 技能释放的全局反馈：屏幕元素染色 + 角色上方技能名横幅
    this.skillFlash = { color: art.color, ms: 320, life: 320 }
    this.skillBanner = { text: skill.name, color: art.accent, age: 0, life: 1.4 }

    // 通用起手：脚下元素法阵 + 外扩能量环 + 轻微后坐震动
    this.spawnEffect('cast', px, py, {
      color: art.color,
      accent: art.accent,
      angle,
      radius: 1.15,
      life: 0.55,
    })
    this.spawnEffect('nova', px, py, {
      color: art.color,
      accent: art.accent,
      radius: 1.5,
      life: 0.42,
    })
    this.addShake(120, art.shape === 'cone' ? 0.055 : 0.035)

    if (skill.kind === 'damage') {
      const count = skill.power >= 2 ? 8 : 6
      const spreadStep = art.shape === 'cone' ? 0.13 : 0.09
      for (let i = 0; i < count; i += 1) {
        const spread = (i - (count - 1) / 2) * spreadStep
        const bulletAngle = angle + spread
        this.bullets.push({
          x: px + Math.cos(bulletAngle) * 0.5,
          y: py + Math.sin(bulletAngle) * 0.5,
          vx: Math.cos(bulletAngle) * (BULLET_SPEED + 3),
          vy: Math.sin(bulletAngle) * (BULLET_SPEED + 3),
          damage: Math.max(2, Math.round(this.atk * Math.max(0.6, skill.power) * 0.4)),
          friendly: true,
          life: 1.2,
          radius: art.shape === 'bolt' ? 0.17 : 0.14,
          color: art.color,
          element: art.label,
          skill: true,
        })
      }
      this.spawnEffect('muzzle', px + Math.cos(angle) * 0.55, py + Math.sin(angle) * 0.55, {
        color: art.accent,
        accent: art.color,
        angle,
        radius: 1.1,
        life: 0.24,
      })
      if (art.shape === 'cone') {
        this.spawnEffect('cone', px, py, { color: art.color, accent: art.accent, angle, radius: 3.8, life: 0.45 })
        this.spawnEffect('ring', px + Math.cos(angle) * 1.5, py + Math.sin(angle) * 1.5, {
          color: art.color, accent: art.accent, radius: 1.9, life: 0.4,
        })
      } else if (art.shape === 'slash') {
        this.spawnEffect('slash', px + Math.cos(angle) * 1.1, py + Math.sin(angle) * 1.1, {
          color: art.color, accent: art.accent, angle, radius: 1.9, life: 0.36,
        })
        this.spawnEffect('shards', px + Math.cos(angle) * 1.1, py + Math.sin(angle) * 1.1, {
          color: art.color, accent: art.accent, angle, radius: 1.8, life: 0.5,
        })
      } else if (art.shape === 'mist') {
        this.spawnEffect('mist', px + Math.cos(angle) * 1.6, py + Math.sin(angle) * 1.6, {
          color: art.color, accent: art.accent, angle, radius: 2.5, life: 0.95,
        })
      } else if (art.shape === 'ring') {
        this.spawnEffect('shards', px, py, {
          color: art.color, accent: art.accent, radius: 2.6, life: 0.6,
        })
      } else if (art.shape === 'bolt') {
        const target = this.nearestEnemy()
        const tx = target ? target.x : px + Math.cos(angle) * 4
        const ty = target ? target.y : py + Math.sin(angle) * 4
        this.spawnEffect('beam', px, py, {
          color: art.color, accent: art.accent, tx, ty, radius: 0.9, life: 0.32,
        })
      } else {
        this.spawnEffect('pillar', px, py, {
          color: art.color, accent: art.accent, radius: 1.4, life: 0.6,
        })
      }
      this.spawnParticles(px, py, 18, art.color)
    } else if (skill.kind === 'heal' || skill.kind === 'cleanse') {
      const heal = Math.ceil(this.maxHp * (skill.healPct ?? 15) / 100)
      this.hp = Math.min(this.maxHp, this.hp + heal)
      this.pushFloat(`+${heal}`, px, py - 0.5, '#34d399', true)
      this.spawnEffect(art.shape === 'ring' ? 'ring' : 'heal', px, py, {
        color: art.color, accent: art.accent, radius: 1.9, life: 0.9,
      })
      this.spawnEffect('pillar', px, py, {
        color: art.color, accent: art.accent, radius: 1.3, life: 0.8,
      })
      this.spawnEffect('shards', px, py, {
        color: art.accent, accent: '#ffffff', radius: 1.7, life: 0.7,
      })
      this.spawnParticles(px, py, 24, art.accent)
    } else if (skill.kind === 'shield') {
      const shield = Math.ceil(this.maxHp * 0.3)
      this.player.shield = Math.max(this.player.shield, shield)
      this.pushFloat(`护盾 +${shield}`, px, py - 0.5, art.color, false)
      this.spawnEffect('shield', px, py, { color: art.color, accent: art.accent, radius: 1.35, life: 1.1 })
      this.spawnEffect('pillar', px, py, { color: art.color, accent: art.accent, radius: 1.2, life: 0.7 })
      this.spawnParticles(px, py, 20, art.color)
    } else {
      this.player.atkBuffUntil = now + 8000
      this.pushFloat('攻击强化！', px, py - 0.5, art.color, false)
      this.spawnEffect('aura', px, py, { color: art.color, accent: art.accent, radius: 1.6, life: 0.95 })
      this.spawnEffect('pillar', px, py, { color: art.color, accent: art.accent, radius: 1.5, life: 0.85 })
      this.spawnParticles(px, py, 20, art.accent)
      this.addShake(150, 0.045)
    }
    this.pushToast(`释放 ${skill.name}`, 'success', now)
    return true
  }

  private nearestEnemy(): LocalEnemy | null {
    let best: LocalEnemy | null = null
    let bestDist = Number.POSITIVE_INFINITY
    for (const enemy of this.enemies) {
      if (enemy.dead) continue
      const dist = distance(enemy.x, enemy.y, this.player.x, this.player.y)
      if (dist < bestDist) {
        bestDist = dist
        best = enemy
      }
    }
    return best
  }

  /** 归一化到 (-π, π] 的角度差 */
  private angleDiff(a: number, b: number): number {
    let diff = (a - b) % (Math.PI * 2)
    if (diff > Math.PI) diff -= Math.PI * 2
    if (diff <= -Math.PI) diff += Math.PI * 2
    return diff
  }

  /** 自动锁敌：±75° 锥内最近且视线可达的敌人；没有则返回 null（保持原朝向） */
  private aimAssistAngle(base: number): number | null {
    let best: number | null = null
    let bestScore = Number.POSITIVE_INFINITY
    const now = Date.now()
    for (const enemy of this.enemies) {
      if (enemy.dead) continue
      const dist = distance(enemy.x, enemy.y, this.player.x, this.player.y)
      if (dist > 12) continue
      const angle = Math.atan2(enemy.y - this.player.y, enemy.x - this.player.x)
      const diff = Math.abs(this.angleDiff(angle, base))
      if (diff > 1.31) continue
      if (!this.sightCheck(enemy, now)) continue
      const score = diff * 2 + dist * 0.2
      if (score < bestScore) {
        bestScore = score
        best = angle
      }
    }
    return best
  }

  /** 技能全向锁敌：取最近的可视敌人（不限方向），解决「放技能容易空」 */
  private skillAutoTarget(): number | null {
    let best: number | null = null
    let bestDist = Number.POSITIVE_INFINITY
    const now = Date.now()
    for (const enemy of this.enemies) {
      if (enemy.dead) continue
      const dist = distance(enemy.x, enemy.y, this.player.x, this.player.y)
      if (dist > 11 || dist >= bestDist) continue
      if (!this.sightCheck(enemy, now)) continue
      bestDist = dist
      best = Math.atan2(enemy.y - this.player.y, enemy.x - this.player.x)
    }
    return best
  }

  /** 视线检测（每敌 ~120ms 节流缓存，敌人数量少但逐帧射线采样在平板上很贵） */
  private sightCheck(enemy: LocalEnemy, now: number): boolean {
    if (enemy.losOk !== undefined && enemy.losAt !== undefined && now - enemy.losAt < 120) {
      return enemy.losOk
    }
    const ok = this.hasLineOfSight(this.player.x, this.player.y, enemy.x, enemy.y)
    enemy.losOk = ok
    enemy.losAt = now
    return ok
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
        if (from === 'rig') this.rig = normalizeContainer(next, this.capacities.rig)
        else this.backpack = normalizeContainer(next, this.capacities.backpack)
        this.events.push({ type: 'useItem', itemKey: key, from })
        if (def.healPct) {
          const heal = Math.ceil(this.maxHp * def.healPct / 100)
          this.hp = Math.min(this.maxHp, this.hp + heal)
          this.pushFloat(`+${heal}`, this.player.x, this.player.y - 0.6, '#34d399', false)
          this.spawnEffect('heal', this.player.x, this.player.y, {
            color: '#34d399', accent: '#a7f3d0', radius: 1.1, life: 0.7,
          })
        }
        if (def.mpGain) {
          this.mp = Math.min(this.maxMp, this.mp + def.mpGain)
          this.pushFloat(`能量 +${def.mpGain}`, this.player.x, this.player.y - 1, '#60a5fa', false)
          this.spawnEffect('aura', this.player.x, this.player.y, {
            color: '#60a5fa', accent: '#bfdbfe', radius: 1, life: 0.6,
          })
        }
        if (def.repairSlot) {
          this.pushFloat('耐久修复', this.player.x, this.player.y - 1, '#fbbf24', false)
          this.spawnEffect('shield', this.player.x, this.player.y, {
            color: '#fbbf24', accent: '#fef3c7', radius: 1.1, life: 0.6,
          })
        }
        this.spawnParticles(this.player.x, this.player.y, 8, '#86efac')
        this.pushToast(`使用 ${def.name}`, 'success', now)
        return true
      }
    }
    this.pushToast(kind === 'heal' ? '没有可用的治疗道具' : '没有可用的维修包', 'danger', now)
    return false
  }

  /** 对局内挪动物品（背包 / 胸挂 / 安全箱），本地立即生效并上报服务端校验 */
  moveItem(
    from: RaidContainerKind,
    to: RaidContainerKind,
    slotIndex: number,
    amount?: number,
    now = Date.now(),
  ): boolean {
    if (this.dead || this.ended || from === to) return false
    const source = from === 'rig' ? this.rig : from === 'safe' ? this.safe : this.backpack
    const stack = source.find((entry) => entry.slotIndex === slotIndex)
    if (!stack) return false
    const def = RAID_ITEM_MAP.get(stack.itemKey)
    if (!def) return false
    const capacity = to === 'rig' ? this.capacities.rig : to === 'safe' ? this.capacities.safe : this.capacities.backpack
    const moved = Math.max(1, Math.min(stack.amount, Math.trunc(amount ?? stack.amount)))
    const targetStacks = to === 'rig' ? this.rig : to === 'safe' ? this.safe : this.backpack
    const added = addItemToContainer(targetStacks, capacity, stack.itemKey, moved)
    if (!added) {
      this.pushToast(`${to === 'rig' ? '胸挂' : to === 'safe' ? '安全箱' : '背包'}已满，放不下`, 'danger', now)
      return false
    }
    const removed = removeItemFromContainer(source, slotIndex, moved)
    if (!removed) return false
    if (from === 'rig') this.rig = removed
    else if (from === 'safe') this.safe = removed
    else this.backpack = removed
    if (to === 'rig') this.rig = added
    else if (to === 'safe') this.safe = added
    else this.backpack = added
    this.events.push({ type: 'moveItem', from, to, slotIndex, amount: moved })
    this.pushToast(`已挪到${to === 'rig' ? '胸挂' : to === 'safe' ? '安全箱' : '背包'}`, 'success', now)
    return true
  }

  /** 把容器里的物品丢到当前房间地面（本地立即生效，服务端按同一状态机校验） */
  dropItem(
    from: RaidContainerKind,
    slotIndex: number,
    amount?: number,
    now = Date.now(),
  ): boolean {
    if (this.dead || this.ended) return false
    const room = this.room
    if (!room) return false
    const source = from === 'rig' ? this.rig : from === 'safe' ? this.safe : this.backpack
    const stack = source.find((entry) => entry.slotIndex === slotIndex)
    if (!stack) return false
    const def = RAID_ITEM_MAP.get(stack.itemKey)
    if (!def) return false
    const moved = Math.max(1, Math.min(stack.amount, Math.trunc(amount ?? stack.amount)))
    const roomGroundCount = this.groundLoot.filter((item) => item.roomId === this.roomId).length
    if (roomGroundCount >= RAID_GROUND_LOOT_LIMIT) {
      this.pushToast('地上掉落物太多了，先捡一捡再丢', 'danger', now)
      return false
    }
    const removed = removeItemFromContainer(source, slotIndex, moved)
    if (!removed) return false
    if (from === 'rig') this.rig = removed
    else if (from === 'safe') this.safe = removed
    else this.backpack = removed
    this.groundSeq += 1
    const id = `g${this.groundSeq}`
    // 与服务端同一个纯函数：沿当前朝向往前抛出后再夹回房间内，双方算出的落点完全一致
    const pos = resolveDropPosition(this.player.x, this.player.y, this.player.angle, room)
    this.groundLoot.push({
      id,
      roomId: this.roomId,
      itemKey: stack.itemKey,
      amount: moved,
      x: pos.x,
      y: pos.y,
    })
    this.ownDroppedGround.set(id, false)
    this.events.push({
      type: 'dropItem',
      from,
      slotIndex,
      amount: moved,
      x: this.player.x,
      y: this.player.y,
      angle: this.player.angle,
    })
    this.spawnParticles(pos.x, pos.y, 6, RARITY_SPARK[def.rarity] ?? '#e2e8f0')
    this.pushToast(`丢弃 ${def.name} ×${moved}`, 'info', now)
    return true
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
    this.groundLoot = (run.groundLoot ?? []).map((item) => ({ ...item }))
    this.groundSeq = run.groundSeq ?? this.groundSeq
    this.pruneOwnDropped()
    const serverExtractStart = run.extractionStartedAt
    if (serverExtractStart !== this.extractStartedAt) {
      // 服务端时间戳才是撤离读条的权威：本地早发被拒后必须允许重试
      this.extractStartedAt = serverExtractStart
      this.extractSentDone = false
    }
    if (run.currentRoom !== this.roomId) {
      this.loadRoom(run.currentRoom)
      // 服务端拒绝 enterRoom 时会把房间改回来，但本地坐标可能还停在相邻房间；
      // 不夹回本房间会导致每帧都判定「跨房」而无法移动（软锁）。
      const room = this.room
      if (room) {
        const minX = room.x + 2
        const maxX = room.x + room.w - 2
        const minY = room.y + 2
        const maxY = room.y + room.h - 2
        if (this.player.x < minX || this.player.x > maxX || this.player.y < minY || this.player.y > maxY) {
          this.player.x = room.x + room.w / 2
          this.player.y = room.y + room.h / 2
        }
      }
    }
    // 服务端已判定死亡的敌人不要继续留在本地攻击（世界增量丢包时自愈）
    this.enemies = this.enemies.filter((enemy) => !enemy.dead && !this.killedEnemies.has(enemy.id))
    for (const container of this.containers) {
      if (this.openedContainers.has(container.id)) container.opened = true
    }
    if (run.status !== 'active') {
      this.ended = true
    }
    if (run.hp <= 0) this.dead = true
  }

  /* ---------- 特效 / 提示 ---------- */

  spawnParticles(x: number, y: number, count: number, color: string): void {
    const scale = this.cosmeticLevel === 'low' ? 0.28 : this.cosmeticLevel === 'balanced' ? 0.6 : 1
    const total = Math.max(1, Math.round(count * scale))
    for (let i = 0; i < total; i += 1) {
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
    const cap = this.cosmeticLevel === 'low' ? 90 : this.cosmeticLevel === 'balanced' ? 160 : 220
    if (this.particles.length > cap) {
      this.particles.splice(0, this.particles.length - cap)
    }
  }

  /** 低端设备降级表现层：只减少粒子 / 环境浮尘，技能特效仍然保留 */
  setCosmeticLevel(level: 'high' | 'balanced' | 'low'): void {
    this.cosmeticLevel = level
  }

  pushToast(text: string, tone: RaidToast['tone'], now: number): void {
    this.toastSeq += 1
    this.toasts.push({ id: this.toastSeq, text, tone, at: now })
    if (this.toasts.length > 4) this.toasts.splice(0, this.toasts.length - 4)
  }

  private updateToasts(now: number): void {
    this.toasts = this.toasts.filter((toast) => now - toast.at < 2600)
  }

  /* ---------- 表现层推进 ---------- */

  private updateCosmetics(dt: number): void {
    if (dt > 0) {
      const nextParticles: LocalParticle[] = []
      for (const particle of this.particles) {
        particle.life -= dt
        if (particle.life <= 0) continue
        particle.x += particle.vx * dt
        particle.y += particle.vy * dt
        particle.vx *= 0.94
        particle.vy *= 0.94
        nextParticles.push(particle)
      }
      this.particles = nextParticles

      const nextEffects: RaidEffect[] = []
      for (const effect of this.effects) {
        effect.age += dt
        if (effect.age >= effect.life) continue
        nextEffects.push(effect)
      }
      this.effects = nextEffects

      const nextFloats: RaidFloatText[] = []
      for (const float of this.floats) {
        float.age += dt
        float.y -= dt * (float.crit ? 1.1 : 0.8)
        if (float.age >= float.life) continue
        nextFloats.push(float)
      }
      this.floats = nextFloats

      this.hitMarkers = this.hitMarkers.filter((marker) => (marker.age += dt) < 0.32)
      this.hurtDirs = this.hurtDirs.filter((dir) => (dir.age -= dt) > 0)
      this.shakeMs = Math.max(0, this.shakeMs - dt * 1000)
      this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.4)
      if (this.skillFlash) {
        this.skillFlash.ms = Math.max(0, this.skillFlash.ms - dt * 1000)
        if (this.skillFlash.ms <= 0) this.skillFlash = null
      }
      if (this.skillBanner) {
        this.skillBanner.age += dt
        if (this.skillBanner.age >= this.skillBanner.life) this.skillBanner = null
      }
    }
  }

  spawnEffect(
    kind: RaidEffectKind,
    x: number,
    y: number,
    options: {
      color?: string
      accent?: string
      angle?: number
      radius?: number
      life?: number
      tx?: number
      ty?: number
      big?: boolean
    } = {},
  ): void {
    this.effectSeq += 1
    this.effects.push({
      id: this.effectSeq,
      kind,
      x,
      y,
      age: 0,
      life: options.life ?? 0.5,
      color: options.color ?? '#7dd3fc',
      accent: options.accent ?? '#e0f2fe',
      angle: options.angle ?? 0,
      radius: options.radius ?? 1,
      tx: options.tx ?? x,
      ty: options.ty ?? y,
      big: options.big ?? false,
    })
    // 同屏特效数量兜底（低端机 / 弹幕房间）
    const cap = this.cosmeticLevel === 'low' ? 42 : this.cosmeticLevel === 'balanced' ? 66 : 90
    if (this.effects.length > cap) this.effects.splice(0, this.effects.length - cap)
  }

  pushFloat(text: string, x: number, y: number, color: string, crit = false): void {
    this.floatSeq += 1
    this.floats.push({
      id: this.floatSeq,
      x,
      y,
      age: 0,
      life: crit ? 1 : 0.78,
      text,
      color,
      size: crit ? 1.35 : 1,
      crit,
    })
    if (this.floats.length > 40) this.floats.splice(0, this.floats.length - 40)
  }

  addShake(ms: number, amp: number): void {
    // 只取更强的一次，避免叠加成晕屏
    if (ms > this.shakeMs) {
      this.shakeMs = ms
      this.shakeAmp = amp
    } else {
      this.shakeAmp = Math.max(this.shakeAmp, amp * 0.6)
    }
  }

  markHit(x: number, y: number, crit: boolean): void {
    this.hitMarkers.push({ x, y, age: 0, crit })
    if (this.hitMarkers.length > 12) this.hitMarkers.splice(0, this.hitMarkers.length - 12)
  }

  /* ---------- 组队：队友幽灵 + 共享世界增量 ---------- */

  setTeammates(teammates: readonly RaidTeammate[]): void {
    this.teammates = teammates.map((mate) => ({ ...mate }))
  }

  /**
   * 把队友造成世界变化并进来（击杀 / 开门 / 开箱 / 已被拿走的战利品）。
   * 击杀会解锁房门，所以同步后要重算容器掉落（队友开过的箱子要掉出已被拿走的排除项）。
   */
  applyWorldDelta(delta: RaidWorldDelta): void {
    let changed = false
    for (const enemyId of delta.killedEnemies ?? []) {
      if (this.killedEnemies.has(enemyId)) continue
      this.killedEnemies.add(enemyId)
      changed = true
    }
    for (const containerId of delta.openedContainers ?? []) {
      if (this.openedContainers.has(containerId)) continue
      this.openedContainers.add(containerId)
      const local = this.containers.find((entry) => entry.id === containerId)
      if (local) local.opened = true
      this.spawnContainerPickups(containerId)
      changed = true
    }
    for (const takeId of delta.takenLoot ?? []) {
      if (this.takenLoot.has(takeId)) continue
      this.takenLoot.add(takeId)
      this.pickups = this.pickups.filter((pickup) => pickup.id !== takeId)
      changed = true
    }
    // 队友丢弃 / 捡走地面物品（按 id 去重合并，捡走的从本地移除）
    for (const item of delta.groundDropped ?? []) {
      if (this.groundLoot.some((entry) => entry.id === item.id)) continue
      this.groundLoot.push({ ...item })
      changed = true
    }
    if (delta.groundTaken?.length) {
      const taken = new Set(delta.groundTaken)
      const before = this.groundLoot.length
      this.groundLoot = this.groundLoot.filter((entry) => !taken.has(entry.id))
      this.pruneOwnDropped()
      if (this.groundLoot.length !== before) changed = true
    }
    if (changed) {
      this.enemies = this.enemies.filter((enemy) => !enemy.dead && !this.killedEnemies.has(enemy.id))
      if (this.roomCleared) this.unlockDoors()
    }
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
