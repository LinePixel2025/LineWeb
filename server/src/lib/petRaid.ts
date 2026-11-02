/**
 * 宠物搜打撤（Delta Force 烽火地带风格）纯函数引擎。
 *
 * 玩法闭环：
 *   进入地图 → 搜索容器（搜）→ 遭遇敌人自动战斗（打）→ 到达撤离点读条撤离（撤）
 *   - 撤离成功：带出的战利品全部入账（积分 / 种子 / 装备 / 技能）
 *   - 阵亡 / 超时：随身战利品丢失，保险箱内的物品保留；装备有概率掉落（买保险可免）
 *   - 行动点（turn）耗尽视为失联（MIA），与阵亡同样处理
 *
 * 本文件不碰数据库、不读时钟之外的外部状态；随机数全部由 seed 驱动，
 * 便于 verify:raid 自检与回放。数据库结算在 petRaidService.ts。
 */

import {
  deriveCombatStats,
  createBattleState,
  applyBattleAction,
  availableSkills,
  type PetCombatInput,
  type PetBattleSide,
  type PetBattleState,
} from './petBattle.js'
import { PET_EQUIPMENT_MAP, type PetEquipmentDef } from './petEquipment.js'
import { PET_BASIC_SKILL_KEY, PET_SKILL_MAP, type PetSkillDef } from './petSkills.js'
import { PET_MAX_LEVEL } from './petCatalog.js'
import { getCrop } from './farmCrops.js'

export type RaidMapKey = 'wasteland' | 'dam' | 'valley' | 'space' | 'fungal' | 'abyss'
export type RaidDifficulty = 'normal' | 'hard' | 'extreme'
export type RaidStatus = 'active' | 'extracted' | 'died' | 'mia' | 'abandoned'
export type RaidLootRarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic'
export type RaidLootKind = 'points' | 'material' | 'seed' | 'equipment' | 'skill' | 'medkit'
export type RaidCellKind = 'empty' | 'spawn' | 'loot' | 'enemy' | 'boss' | 'extract' | 'hazard'

export interface RaidMapDef {
  key: RaidMapKey
  name: string
  emoji: string
  description: string
  difficulty: RaidDifficulty
  /** 方格边长（width = height） */
  size: number
  enemyCount: number
  bossCount: number
  lootCount: number
  extractCount: number
  hazardCount: number
  /** 进入门票（积分） */
  entryCost: number
  /** 行动点上限（每一步 / 搜索 / 撤离读条各 1 点） */
  maxTurns: number
  /** 建议等级 */
  recommendLevel: number
  /** 战利品档次 1–5（tier 5 才可能掉神话级物品） */
  lootTier: number
  color: string
  /** 敌人基础等级 */
  enemyLevel: number
  /** 单局时间上限（毫秒，离线判 MIA） */
  durationMs: number
}

export const RAID_MAPS: readonly RaidMapDef[] = [
  {
    key: 'wasteland',
    name: '废弃农场',
    emoji: '🌾',
    description: '低风险的拾荒场，适合第一次带宠物出门。敌人稀疏，撤离点就在地图边缘。',
    difficulty: 'normal',
    size: 7,
    enemyCount: 3,
    bossCount: 0,
    lootCount: 7,
    extractCount: 1,
    hazardCount: 2,
    entryCost: 0,
    maxTurns: 36,
    recommendLevel: 1,
    lootTier: 1,
    color: '#6a994e',
    enemyLevel: 2,
    durationMs: 15 * 60_000,
  },
  {
    key: 'dam',
    name: '零号大坝',
    emoji: '🌉',
    description: '废弃水利枢纽，巡逻队与拾荒者混杂。物资更值钱，但撤离点不止一个。',
    difficulty: 'normal',
    size: 8,
    enemyCount: 6,
    bossCount: 1,
    lootCount: 10,
    extractCount: 2,
    hazardCount: 3,
    entryCost: 80,
    maxTurns: 44,
    recommendLevel: 3,
    lootTier: 2,
    color: '#3d7ea6',
    enemyLevel: 4,
    durationMs: 18 * 60_000,
  },
  {
    key: 'valley',
    name: '长弓溪谷',
    emoji: '🏞️',
    description: '狭长山谷里的军需仓库，精英守卫密度高。带好装备，别贪最后一个箱子。',
    difficulty: 'hard',
    size: 9,
    enemyCount: 9,
    bossCount: 1,
    lootCount: 13,
    extractCount: 2,
    hazardCount: 4,
    entryCost: 200,
    maxTurns: 50,
    recommendLevel: 5,
    lootTier: 3,
    color: '#8a5a44',
    enemyLevel: 6,
    durationMs: 20 * 60_000,
  },
  {
    key: 'space',
    name: '航天基地',
    emoji: '🚀',
    description: '高危禁区，重装守卫与首领坐镇。传说级战利品只在这里稳定出现。',
    difficulty: 'extreme',
    size: 9,
    enemyCount: 12,
    bossCount: 1,
    lootCount: 15,
    extractCount: 2,
    hazardCount: 5,
    entryCost: 500,
    maxTurns: 56,
    recommendLevel: 8,
    lootTier: 4,
    color: '#5b4b8a',
    enemyLevel: 9,
    durationMs: 22 * 60_000,
  },
  {
    key: 'fungal',
    name: '孢子雨林',
    emoji: '🍄',
    description: '被孢子云笼罩的原始雨林，双首领坐镇，物种样本与合金部件散落其间。',
    difficulty: 'hard',
    size: 9,
    enemyCount: 10,
    bossCount: 2,
    lootCount: 14,
    extractCount: 2,
    hazardCount: 4,
    entryCost: 320,
    maxTurns: 52,
    recommendLevel: 6,
    lootTier: 4,
    color: '#4a7c59',
    enemyLevel: 7,
    durationMs: 21 * 60_000,
  },
  {
    key: 'abyss',
    name: '深渊实验室',
    emoji: '🧪',
    description: '深埋地下的禁忌实验设施，重装守卫密布。全游戏最珍贵的「非洲之心」只在这里出现。',
    difficulty: 'extreme',
    size: 10,
    enemyCount: 14,
    bossCount: 2,
    lootCount: 18,
    extractCount: 3,
    hazardCount: 6,
    entryCost: 900,
    maxTurns: 62,
    recommendLevel: 10,
    lootTier: 5,
    color: '#2b3a67',
    enemyLevel: 12,
    durationMs: 26 * 60_000,
  },
]

export const RAID_MAP_MAP: ReadonlyMap<string, RaidMapDef> = new Map(
  RAID_MAPS.map((map) => [map.key, map]),
)

export function getRaidMap(key: string | null | undefined): RaidMapDef | null {
  if (!key) return null
  return RAID_MAP_MAP.get(key) ?? null
}

/** 总行动点不足时允许用积分补给？不——保持「行动点就是硬约束」。 */
export const RAID_SAFE_CAPACITY = 2
export const RAID_INSURANCE_RATE = 0.15
export const RAID_INSURANCE_MIN = 20
export const RAID_GEAR_LOSS_CHANCE = 0.5
export const RAID_LOG_LIMIT = 80
export const RAID_EXTRACT_TURNS = 3
export const RAID_MEDKIT_HEAL_PCT = 35
export const RAID_HAZARD_DAMAGE_PCT = 10
export const RAID_MP_REGEN_PER_MOVE = 4

/* ============================================================
   战利品目录
   ============================================================ */

export interface RaidLootEntry {
  key: string
  name: string
  emoji: string
  rarity: RaidLootRarity
  kind: RaidLootKind
  /** 单件价值（积分；seed/equipment/skill 使用目录价） */
  value: number
  /** 出现权重 */
  weight: number
  /** 数据载荷：seed 作物 key / equipment key / skill key（运行时才定） */
  payload?: string
}

export const RAID_LOOT_ENTRIES: readonly RaidLootEntry[] = [
  { key: 'canned_food', name: '军用罐头', emoji: '🥫', rarity: 'common', kind: 'material', value: 60, weight: 20 },
  { key: 'old_watch', name: '旧怀表', emoji: '⌚', rarity: 'common', kind: 'material', value: 90, weight: 16 },
  { key: 'copper_wire', name: '铜线束', emoji: '🔌', rarity: 'common', kind: 'material', value: 50, weight: 20 },
  { key: 'medkit', name: '急救包', emoji: '🩹', rarity: 'common', kind: 'medkit', value: 45, weight: 14 },
  { key: 'circuit_board', name: '军用电路板', emoji: '🧩', rarity: 'rare', kind: 'material', value: 190, weight: 14 },
  { key: 'encrypted_drive', name: '加密硬盘', emoji: '💾', rarity: 'rare', kind: 'material', value: 260, weight: 11 },
  { key: 'seed_pack', name: '稀有种子包', emoji: '🌱', rarity: 'rare', kind: 'seed', value: 0, weight: 10 },
  { key: 'gold_compass', name: '黄金罗盘', emoji: '🧭', rarity: 'epic', kind: 'material', value: 650, weight: 6 },
  { key: 'experiment_data', name: '实验数据', emoji: '📊', rarity: 'epic', kind: 'material', value: 820, weight: 5 },
  { key: 'gear_cache', name: '装备箱', emoji: '🧰', rarity: 'epic', kind: 'equipment', value: 0, weight: 5 },
  { key: 'skill_scroll', name: '技能卷轴', emoji: '📜', rarity: 'epic', kind: 'skill', value: 0, weight: 4 },
  { key: 'black_box', name: '黑匣子', emoji: '📦', rarity: 'legendary', kind: 'material', value: 1800, weight: 2 },
  { key: 'dragon_shard', name: '龙鳞碎片', emoji: '🐲', rarity: 'legendary', kind: 'material', value: 2400, weight: 1 },
  { key: 'relic_cache', name: '遗物箱', emoji: '🗃️', rarity: 'legendary', kind: 'equipment', value: 0, weight: 2 },
  { key: 'ancient_scroll', name: '远古卷轴', emoji: '📖', rarity: 'legendary', kind: 'skill', value: 0, weight: 1 },
  // ↓ 深渊实验室（tier 5）新增材料；非洲之心（mythic）只有 tier 5 地图会掉
  { key: 'scrap_metal', name: '废金属块', emoji: '⚙️', rarity: 'common', kind: 'material', value: 35, weight: 18 },
  { key: 'duct_tape', name: '军用胶带', emoji: '🧵', rarity: 'common', kind: 'material', value: 55, weight: 16 },
  { key: 'titanium_alloy', name: '钛合金部件', emoji: '🔩', rarity: 'rare', kind: 'material', value: 240, weight: 12 },
  { key: 'laser_module', name: '激光模组', emoji: '🔦', rarity: 'rare', kind: 'material', value: 310, weight: 10 },
  { key: 'plasma_core', name: '等离子核心', emoji: '🔮', rarity: 'epic', kind: 'material', value: 760, weight: 5 },
  { key: 'ai_chip', name: '智能芯片', emoji: '🧠', rarity: 'epic', kind: 'material', value: 920, weight: 4 },
  { key: 'quantum_battery', name: '量子电池', emoji: '🔋', rarity: 'legendary', kind: 'material', value: 2000, weight: 2 },
  { key: 'gold_statue', name: '纯金神像', emoji: '🗿', rarity: 'legendary', kind: 'material', value: 2300, weight: 1 },
  { key: 'heart_of_africa', name: '非洲之心', emoji: '💎', rarity: 'mythic', kind: 'material', value: 9999, weight: 1 },
]

export const RAID_LOOT_MAP: ReadonlyMap<string, RaidLootEntry> = new Map(
  RAID_LOOT_ENTRIES.map((item) => [item.key, item]),
)

export interface RaidLootItem {
  id: string
  key: string
  name: string
  emoji: string
  rarity: RaidLootRarity
  kind: RaidLootKind
  value: number
  amount: number
  /** seed / equipment / skill 的具体 key */
  payload: string | null
}

export interface RaidEnemy {
  id: string
  name: string
  emoji: string
  kind: 'scout' | 'soldier' | 'elite' | 'boss'
  level: number
  hp: number
  maxHp: number
  atk: number
  def: number
  spd: number
  crit: number
  skills: string[]
}

export interface RaidCell {
  index: number
  x: number
  y: number
  kind: RaidCellKind
  searched: boolean
  enemy: RaidEnemy | null
}

export interface RaidLogEntry {
  id: number
  turn: number
  kind: 'move' | 'search' | 'combat' | 'loot' | 'extract' | 'info' | 'danger' | 'death' | 'success'
  text: string
  detail?: string[]
}

export interface RaidLoadoutSnapshot {
  petId: number
  userId: number
  name: string
  species: string
  level: number
  equipmentKeys: string[]
  skillKeys: string[]
}

export interface RaidCombatStats {
  maxHp: number
  maxMp: number
  atk: number
  def: number
  spd: number
  crit: number
}

export interface RaidState {
  version: number
  mapKey: RaidMapKey
  difficulty: RaidDifficulty
  seed: number
  startedAt: number
  expiresAt: number
  turn: number
  maxTurns: number
  status: RaidStatus
  hp: number
  mp: number
  player: { x: number; y: number }
  width: number
  height: number
  cells: RaidCell[]
  visited: number[]
  loot: RaidLootItem[]
  safe: RaidLootItem[]
  log: RaidLogEntry[]
  nextLogId: number
  kills: number
  extracting: number
  extractionCell: number | null
  insured: boolean
  loadout: RaidLoadoutSnapshot
  stats: RaidCombatStats
  /** 已结算标记（服务层写库后置 true，避免重复结算） */
  settled: boolean
}

export interface CreateRaidOptions {
  map: RaidMapDef
  seed: number
  now: number
  loadout: RaidLoadoutSnapshot
  stats: RaidCombatStats
  insured: boolean
  lootPointValue?: number
}

/* ============================================================
   RNG（mulberry32）
   ============================================================ */

export function createRaidRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

function pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number, rng: () => number): T | null {
  const weights = items.map((item) => Math.max(0, weightOf(item)))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (!(total > 0)) return null
  let roll = rng() * total
  for (let i = 0; i < items.length; i += 1) {
    roll -= weights[i]
    if (roll < 0) return items[i]
  }
  return items[items.length - 1] ?? null
}

/* ============================================================
   地图生成
   ============================================================ */

const RARITY_WEIGHTS: Record<RaidLootRarity, number> = {
  common: 1,
  rare: 1,
  epic: 1,
  legendary: 1,
  mythic: 1,
}

/**
 * 各档次稀有度权重（每行总权重 100）。
 * mythic 只在 tier 5 > 0：老地图（tier 1–4）永远掉不出神话级物品。
 * 导出供自检（verify:raid / verify:raidstorage）直接断言权重表。
 */
export function rarityWeight(rarity: RaidLootRarity, tier: number): number {
  const table: Record<number, Record<RaidLootRarity, number>> = {
    1: { common: 65, rare: 25, epic: 9, legendary: 1, mythic: 0 },
    2: { common: 50, rare: 31, epic: 15, legendary: 4, mythic: 0 },
    3: { common: 34, rare: 32, epic: 25, legendary: 9, mythic: 0 },
    4: { common: 20, rare: 29, epic: 34, legendary: 17, mythic: 0 },
    5: { common: 16, rare: 28, epic: 32, legendary: 21, mythic: 3 },
  }
  return (table[Math.max(1, Math.min(5, tier))] ?? table[1])[rarity] * RARITY_WEIGHTS[rarity]
}

function idx(width: number, x: number, y: number): number {
  return y * width + x
}

function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

function pushLog(state: RaidState, kind: RaidLogEntry['kind'], text: string, detail?: string[]): void {
  state.log.push({ id: state.nextLogId, turn: state.turn, kind, text, ...(detail ? { detail } : {}) })
  state.nextLogId += 1
  if (state.log.length > RAID_LOG_LIMIT) state.log.splice(0, state.log.length - RAID_LOG_LIMIT)
}

function revealAround(state: RaidState, index: number): void {
  const cell = state.cells[index]
  if (!cell) return
  const set = new Set(state.visited)
  set.add(index)
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  for (const [dx, dy] of dirs) {
    const x = cell.x + dx
    const y = cell.y + dy
    if (x >= 0 && y >= 0 && x < state.width && y < state.height) set.add(idx(state.width, x, y))
  }
  state.visited = [...set].sort((a, b) => a - b)
}

function pickFreeCell(
  state: RaidState,
  rng: () => number,
  minSpawnDistance: number,
  accept: (cell: RaidCell) => boolean,
): RaidCell | null {
  const candidates = state.cells.filter((cell) =>
    cell.kind === 'empty'
    && manhattan(cell, state.player) >= minSpawnDistance
    && accept(cell))
  if (candidates.length === 0) return null
  return candidates[Math.floor(rng() * candidates.length)] ?? candidates[candidates.length - 1]
}

/** 生成一局地图（确定性 seed） */
export function createRaidState(options: CreateRaidOptions): RaidState {
  const { map, seed, now, loadout, stats, insured } = options
  const width = map.size
  const height = map.size
  const rng = createRaidRng(seed)
  const player = { x: 0, y: 0 }
  const cells: RaidCell[] = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      cells.push({ index: idx(width, x, y), x, y, kind: 'empty', searched: false, enemy: null })
    }
  }
  const spawn = cells[0]
  spawn.kind = 'spawn'

  const state: RaidState = {
    version: 0,
    mapKey: map.key,
    difficulty: map.difficulty,
    seed,
    startedAt: now,
    expiresAt: now + map.durationMs,
    turn: 0,
    maxTurns: map.maxTurns,
    status: 'active',
    hp: stats.maxHp,
    mp: stats.maxMp,
    player,
    width,
    height,
    cells,
    visited: [],
    loot: [],
    safe: [],
    log: [],
    nextLogId: 1,
    kills: 0,
    extracting: 0,
    extractionCell: null,
    insured,
    loadout,
    stats,
    settled: false,
  }

  // 撤离点：优先放远角与边缘（按到出生点曼哈顿距离降序取），保证撤离点不全在出生点旁
  const cornerCandidates = [
    { x: width - 1, y: height - 1 },
    { x: width - 1, y: 0 },
    { x: 0, y: height - 1 },
    { x: width - 1, y: Math.floor(height / 2) },
    { x: 0, y: Math.floor(height / 2) },
    { x: Math.floor(width / 2), y: height - 1 },
    { x: Math.floor(width / 2), y: 0 },
    { x: 0, y: 0 },
  ]
    .filter((corner) => manhattan(corner, player) >= Math.floor((width + height) / 4))
    .sort((a, b) => manhattan(b, player) - manhattan(a, player))
  let extractPlaced = 0
  for (const corner of cornerCandidates) {
    if (extractPlaced >= map.extractCount) break
    const cell = state.cells[idx(width, corner.x, corner.y)]
    if (cell && cell.kind === 'empty') {
      cell.kind = 'extract'
      extractPlaced += 1
    }
  }
  if (extractPlaced === 0) {
    const fallback = state.cells.find((cell) => cell.kind === 'empty')
    if (fallback) fallback.kind = 'extract'
  }
  // 候选角不够时（extractCount 大于可用候选），从剩余空地里挑离出生点最远的补齐
  while (extractPlaced < map.extractCount) {
    const farthest = state.cells
      .filter((cell) => cell.kind === 'empty')
      .sort((a, b) => manhattan(b, player) - manhattan(a, player))[0]
    if (!farthest) break
    farthest.kind = 'extract'
    extractPlaced += 1
  }

  // 首领：逐个放在当前离出生点最远的空地（数量完全由 map.bossCount 驱动）
  for (let bossIndex = 0; bossIndex < map.bossCount; bossIndex += 1) {
    const farthest = state.cells
      .filter((cell) => cell.kind === 'empty')
      .sort((a, b) => manhattan(b, player) - manhattan(a, player))[0]
    if (!farthest) break
    farthest.kind = 'boss'
    farthest.enemy = createEnemy('boss', map, farthest.index + bossIndex, rng)
  }

  // 普通敌人
  for (let i = 0; i < map.enemyCount; i += 1) {
    const cell = pickFreeCell(state, rng, 3, () => true)
    if (!cell) break
    cell.kind = 'enemy'
    cell.enemy = createEnemy(i % 3 === 0 ? 'elite' : i % 2 === 0 ? 'soldier' : 'scout', map, i, rng)
  }

  // 物资箱
  for (let i = 0; i < map.lootCount; i += 1) {
    const cell = pickFreeCell(state, rng, 1, () => true)
    if (!cell) break
    cell.kind = 'loot'
  }

  // 危险区
  for (let i = 0; i < map.hazardCount; i += 1) {
    const cell = pickFreeCell(state, rng, 2, () => true)
    if (!cell) break
    cell.kind = 'hazard'
  }

  revealAround(state, spawn.index)
  pushLog(state, 'info', `进入「${map.name}」，行动点 ${map.maxTurns}，找到撤离点并活着离开。`)
  return state
}

const ENEMY_NAMES = {
  scout: ['拾荒者', '游荡者', '侦察兵'],
  soldier: ['巡逻兵', '守卫', '突击手'],
  elite: ['精英守卫', '重装兵', '狙击手'],
  boss: ['“铁壁”队长', '“夜枭”首领', '“磐石”指挥官'],
} as const

const ENEMY_EMOJI = { scout: '🥷', soldier: '🪖', elite: '🎯', boss: '👹' } as const

function createEnemy(
  kind: RaidEnemy['kind'],
  map: RaidMapDef,
  index: number,
  rng: () => number,
): RaidEnemy {
  const names = ENEMY_NAMES[kind]
  const name = names[index % names.length]
  const levelBase = map.enemyLevel + (kind === 'elite' ? 2 : kind === 'boss' ? 4 : kind === 'soldier' ? 1 : 0)
  const level = Math.max(1, Math.min(PET_MAX_LEVEL + 4, levelBase + Math.floor(rng() * 2)))
  const boss = kind === 'boss'
  const elite = kind === 'elite'
  const maxHp = Math.round((70 + level * 22) * (boss ? 2.6 : elite ? 1.5 : 1))
  return {
    id: `e-${index}-${Math.floor(rng() * 1e6)}`,
    name,
    emoji: ENEMY_EMOJI[kind],
    kind,
    level,
    hp: maxHp,
    maxHp,
    atk: Math.round((9 + level * 2.4) * (boss ? 1.5 : elite ? 1.2 : 1)),
    def: Math.round((4 + level * 1.6) * (boss ? 1.5 : elite ? 1.2 : 1)),
    spd: Math.round(7 + level + (kind === 'scout' ? 4 : 0)),
    crit: Math.min(50, 5 + (kind === 'scout' ? 8 : kind === 'elite' ? 6 : 2)),
    skills: enemySkills(kind, rng),
  }
}

function enemySkills(kind: RaidEnemy['kind'], rng: () => number): string[] {
  const pool = kind === 'boss'
    ? ['thunder_bolt', 'meteor', 'iron_wall', 'healing_light', 'frost_breath', 'armor_break']
    : kind === 'elite'
      ? ['fire_claw', 'iron_wall', 'poison_fang', 'frost_breath', 'battle_cry']
      : kind === 'soldier'
        ? ['fire_claw', 'iron_wall', 'healing_light']
        : ['poison_fang', 'battle_cry']
  const count = kind === 'boss' ? 3 : kind === 'elite' ? 2 : 1
  const chosen: string[] = []
  const copy = [...pool]
  while (chosen.length < count && copy.length > 0) {
    const [pick] = copy.splice(Math.floor(rng() * copy.length), 1)
    chosen.push(pick)
  }
  return chosen
}

/* ============================================================
   战利品抽取
   ============================================================ */

function lootIdFactory(state: RaidState, rng: () => number): string {
  return `l-${state.turn}-${Math.floor(rng() * 1e9).toString(36)}`
}

function pickEquipment(rarity: 'epic' | 'legendary', rng: () => number): PetEquipmentDef | null {
  const pool = [...PET_EQUIPMENT_MAP.values()].filter((item) => !item.bound && item.rarity === rarity)
  if (pool.length === 0) return null
  return pool[Math.floor(rng() * pool.length)] ?? pool[0]
}

function pickSkill(rarity: 'epic' | 'legendary', rng: () => number): PetSkillDef | null {
  const pool = [...PET_SKILL_MAP.values()].filter((skill) =>
    skill.key !== PET_BASIC_SKILL_KEY
    && skill.minLevel >= (rarity === 'legendary' ? 6 : 4))
  if (pool.length === 0) return null
  return pool[Math.floor(rng() * pool.length)] ?? pool[0]
}

function pickSeed(rng: () => number): string {
  const crops = ['strawberry', 'rice', 'sunflower', 'potato', 'corn', 'tomato', 'kiwi', 'chili']
  return crops[Math.floor(rng() * crops.length)] ?? 'carrot'
}

function rollLootItem(
  state: RaidState,
  rng: () => number,
  tier: number,
  forcedRarity?: RaidLootRarity,
): RaidLootItem | null {
  const entry = forcedRarity
    ? pickWeighted(
      RAID_LOOT_ENTRIES.filter((item) => item.rarity === forcedRarity),
      (item) => item.weight,
      rng,
    )
    : pickWeighted(RAID_LOOT_ENTRIES, (item) => rarityWeight(item.rarity, tier) * item.weight, rng)
  if (!entry) return null

  let payload: string | null = null
  let amount = 1
  let value = entry.value
  if (entry.kind === 'seed') {
    payload = pickSeed(rng)
    amount = 1 + Math.floor(rng() * 3)
    value = 0
  } else if (entry.kind === 'equipment') {
    const rarity = entry.rarity === 'legendary' ? 'legendary' : 'epic'
    const equipment = pickEquipment(rarity, rng)
    if (!equipment) return null
    payload = equipment.key
    value = equipment.price
  } else if (entry.kind === 'skill') {
    const rarity = entry.rarity === 'legendary' ? 'legendary' : 'epic'
    const skill = pickSkill(rarity, rng)
    if (!skill) return null
    payload = skill.key
    value = skill.price
  } else if (entry.kind === 'material' || entry.kind === 'points') {
    amount = 1 + Math.floor(rng() * 2)
  }
  return {
    id: lootIdFactory(state, rng),
    key: entry.key,
    name: entry.name,
    emoji: entry.emoji,
    rarity: entry.rarity,
    kind: entry.kind,
    value,
    amount,
    payload,
  }
}

/** 搜箱子：普通箱子 1–2 件，首领必掉 2–3 件且至少一件史诗+ */
export function rollRaidLoot(
  state: RaidState,
  rng: () => number,
  options: { boss?: boolean } = {},
): RaidLootItem[] {
  const map = getRaidMap(state.mapKey)
  const tier = map?.lootTier ?? 1
  const count = options.boss ? 2 + Math.floor(rng() * 2) : 1 + Math.floor(rng() * 2)
  const items: RaidLootItem[] = []
  for (let i = 0; i < count; i += 1) {
    const forced = options.boss && i === 0 ? (rng() < 0.45 ? 'legendary' : 'epic') : undefined
    const item = rollLootItem(state, rng, tier, forced)
    if (item) items.push(item)
  }
  return items
}

/* ============================================================
   战斗（复用 petBattle 引擎，自动 AI 对打）
   ============================================================ */

function chooseAiSkill(side: PetBattleSide, rng: () => number): string {
  const available = availableSkills(side).filter((row) => row.usable)
  if (available.length === 0) return PET_BASIC_SKILL_KEY
  const heal = available.find((row) => {
    const skill = PET_SKILL_MAP.get(row.key)
    return !!skill && (skill.kind === 'heal' || skill.kind === 'cleanse')
  })
  if (side.hp / Math.max(1, side.maxHp) < 0.38 && heal && rng() < 0.85) return heal.key
  const buff = available.find((row) => {
    const skill = PET_SKILL_MAP.get(row.key)
    return !!skill && (skill.kind === 'buff' || skill.kind === 'shield')
  })
  if (side.buffs.length === 0 && buff && rng() < 0.5) return buff.key
  const damage = available
    .map((row) => ({ row, skill: PET_SKILL_MAP.get(row.key) }))
    .filter((entry) => entry.skill?.kind === 'damage')
    .sort((a, b) => (b.skill?.power ?? 0) - (a.skill?.power ?? 0))
  return damage[0]?.row.key ?? available[0].key
}

export interface RaidCombatResult {
  won: boolean
  draw: boolean
  playerHp: number
  playerMp: number
  enemyHp: number
  rounds: number
  events: string[]
}

export function resolveRaidCombat(
  state: RaidState,
  enemy: RaidEnemy,
  rng: () => number,
): RaidCombatResult {
  const playerInput: PetCombatInput = {
    petId: state.loadout.petId,
    userId: state.loadout.userId,
    name: state.loadout.name,
    species: state.loadout.species,
    level: state.loadout.level,
    equipmentKeys: state.loadout.equipmentKeys,
    skillKeys: state.loadout.skillKeys,
  }
  const enemyInput: PetCombatInput = {
    petId: -1,
    userId: -1,
    name: enemy.name,
    species: 'dog',
    level: enemy.level,
    equipmentKeys: [],
    skillKeys: enemy.skills,
  }
  let battle: PetBattleState = createBattleState([playerInput, enemyInput], Date.now())
  const playerSide = battle.sides[String(state.loadout.userId)]
  const enemySide = battle.sides['-1']
  if (!playerSide || !enemySide) {
    return { won: false, draw: false, playerHp: state.hp, playerMp: state.mp, enemyHp: enemy.hp, rounds: 0, events: [] }
  }
  // 覆盖为局内快照数值（玩家沿用当前 HP/MP；敌人使用地图生成数值）
  playerSide.maxHp = state.stats.maxHp
  playerSide.maxMp = state.stats.maxMp
  playerSide.hp = state.hp
  playerSide.mp = state.mp
  playerSide.atk = state.stats.atk
  playerSide.def = state.stats.def
  playerSide.spd = state.stats.spd
  playerSide.crit = state.stats.crit
  enemySide.maxHp = enemy.maxHp
  enemySide.hp = enemy.hp
  enemySide.maxMp = 100
  enemySide.mp = 100
  enemySide.atk = enemy.atk
  enemySide.def = enemy.def
  enemySide.spd = enemy.spd
  enemySide.crit = enemy.crit

  const events: string[] = []
  let guard = 0
  while (!battle.finished && guard < 120) {
    guard += 1
    const actorId = battle.turnUserId
    if (actorId === null) break
    const actor = battle.sides[String(actorId)]
    if (!actor) break
    const skillKey = chooseAiSkill(actor, rng)
    const result = applyBattleAction(battle, actorId, skillKey, rng, true)
    if (result.error) {
      const fallback = applyBattleAction(battle, actorId, PET_BASIC_SKILL_KEY, rng, true)
      if (fallback.error) break
      battle = fallback.state
    } else {
      battle = result.state
    }
  }
  const last = battle.log.slice(-8)
  for (const event of last) events.push(event.text)

  const finalPlayer = battle.sides[String(state.loadout.userId)]
  const finalEnemy = battle.sides['-1']
  const playerHp = Math.max(0, finalPlayer?.hp ?? 0)
  const playerMp = Math.max(0, finalPlayer?.mp ?? 0)
  const enemyHp = Math.max(0, finalEnemy?.hp ?? 0)
  let won = false
  let draw = false
  if (battle.finished) {
    if (battle.winnerId === state.loadout.userId) won = true
    else if (battle.winnerId === -1) won = false
    else {
      draw = true
      won = (playerHp / Math.max(1, state.stats.maxHp)) >= (enemyHp / Math.max(1, enemy.maxHp))
    }
  } else {
    draw = true
    won = (playerHp / Math.max(1, state.stats.maxHp)) >= (enemyHp / Math.max(1, enemy.maxHp))
  }
  return { won, draw, playerHp, playerMp, enemyHp, rounds: battle.round, events }
}

/* ============================================================
   动作
   ============================================================ */

function cloneState(state: RaidState): RaidState {
  return JSON.parse(JSON.stringify(state)) as RaidState
}

function checkDeath(state: RaidState): boolean {
  if (state.hp > 0) return false
  state.status = 'died'
  state.hp = 0
  state.extracting = 0
  pushLog(state, 'death', `${state.loadout.name} 倒下了，随身战利品全部遗失。`)
  return true
}

function checkTurnLimit(state: RaidState): boolean {
  if (state.status !== 'active') return true
  if (state.turn < state.maxTurns) return false
  state.status = 'mia'
  state.extracting = 0
  pushLog(state, 'death', '行动点耗尽，你在撤离前失联了……随身战利品丢失。')
  return true
}

function finishExtraction(state: RaidState): void {
  state.status = 'extracted'
  state.extracting = 0
  pushLog(state, 'success', '撤离成功！带出的战利品已全部入账。')
}

export type RaidDirection = 'up' | 'down' | 'left' | 'right'

export interface RaidActionResult {
  state: RaidState
  error: string | null
  /** 本次动作新增的战利品（客户端高亮用） */
  gained?: RaidLootItem[]
  combat?: { enemyName: string; won: boolean; events: string[] } | null
}

export function adjacentCell(state: RaidState, dir: RaidDirection): RaidCell | null {
  const delta = dir === 'up' ? [0, -1] : dir === 'down' ? [0, 1] : dir === 'left' ? [-1, 0] : [1, 0]
  const x = state.player.x + delta[0]
  const y = state.player.y + delta[1]
  if (x < 0 || y < 0 || x >= state.width || y >= state.height) return null
  return state.cells[idx(state.width, x, y)] ?? null
}

export function moveRaid(
  state: RaidState,
  dir: RaidDirection,
  rng: () => number,
): RaidActionResult {
  if (state.status !== 'active') return { state, error: '对局已经结束' }
  const next = cloneState(state)
  const target = adjacentCell(next, dir)
  if (!target) return { state, error: '那边是地图边界' }

  if (next.extracting > 0) {
    next.extracting = 0
    next.extractionCell = null
    pushLog(next, 'info', '你离开了撤离点，撤离读条中断。')
  }

  next.turn += 1
  next.player = { x: target.x, y: target.y }
  revealAround(next, target.index)
  next.mp = Math.min(next.stats.maxMp, next.mp + RAID_MP_REGEN_PER_MOVE)

  let combat: RaidActionResult['combat'] = null
  const gained: RaidLootItem[] = []

  if (target.kind === 'hazard' && !target.searched) {
    target.searched = true
    const damage = Math.max(1, Math.round((next.stats.maxHp * RAID_HAZARD_DAMAGE_PCT) / 100))
    next.hp = Math.max(0, next.hp - damage)
    pushLog(next, 'danger', `踏入危险区，损失 ${damage} 点生命。`)
    if (checkDeath(next)) return { state: next, error: null, gained }
  }

  if ((target.kind === 'enemy' || target.kind === 'boss') && target.enemy) {
    const enemy = target.enemy
    const result = resolveRaidCombat(next, enemy, rng)
    next.hp = result.playerHp
    next.mp = result.playerMp
    combat = { enemyName: enemy.name, won: result.won, events: result.events }
    if (result.won && next.hp > 0) {
      next.kills += 1
      target.enemy = null
      target.kind = 'empty'
      const drops = rollRaidLoot(next, rng, { boss: enemy.kind === 'boss' })
      next.loot.push(...drops)
      gained.push(...drops)
      pushLog(
        next,
        'combat',
        `击败 ${enemy.name}（${result.rounds} 回合）${drops.length > 0 ? `，掉落 ${drops.length} 件战利品` : ''}`,
        result.events,
      )
    } else {
      next.hp = 0
      pushLog(
        next,
        'death',
        result.won ? `与 ${enemy.name} 同归于尽。` : `被 ${enemy.name} 击败了。`,
        result.events,
      )
      checkDeath(next)
      return { state: next, error: null, gained, combat }
    }
  }

  if (target.kind === 'extract') {
    pushLog(next, 'info', '你到达了撤离点，执行「撤离」开始读条（3 回合）。')
  }

  checkTurnLimit(next)
  return { state: next, error: null, gained, combat }
}

export function searchRaid(state: RaidState, rng: () => number): RaidActionResult {
  if (state.status !== 'active') return { state, error: '对局已经结束' }
  const next = cloneState(state)
  const cell = next.cells[idx(next.width, next.player.x, next.player.y)]
  if (!cell) return { state, error: '当前位置异常' }
  if (cell.kind !== 'loot') return { state, error: '这里没有可搜索的容器' }
  if (cell.searched) return { state, error: '这个箱子已经被搜空了' }

  cell.searched = true
  next.turn += 1
  next.mp = Math.min(next.stats.maxMp, next.mp + RAID_MP_REGEN_PER_MOVE)
  const items = rollRaidLoot(next, rng)
  next.loot.push(...items)
  if (items.length === 0) {
    pushLog(next, 'search', '箱子是空的，只有几只受惊的虫子。')
  } else {
    pushLog(
      next,
      'loot',
      `搜到 ${items.map((item) => `${item.emoji}${item.name}${item.amount > 1 ? `×${item.amount}` : ''}`).join('、')}`,
    )
  }
  checkTurnLimit(next)
  return { state: next, error: null, gained: items }
}

export function extractRaid(state: RaidState): RaidActionResult {
  if (state.status !== 'active') return { state, error: '对局已经结束' }
  const next = cloneState(state)
  const cell = next.cells[idx(next.width, next.player.x, next.player.y)]
  if (!cell || cell.kind !== 'extract') return { state, error: '必须站在撤离点才能撤离' }

  next.turn += 1
  if (next.extracting <= 0) {
    next.extracting = Math.max(0, RAID_EXTRACT_TURNS - 1)
    next.extractionCell = cell.index
    if (next.extracting <= 0) {
      finishExtraction(next)
      return { state: next, error: null }
    }
    pushLog(next, 'extract', `开始撤离读条（共 ${RAID_EXTRACT_TURNS} 回合），别乱动。`)
  } else {
    next.extracting -= 1
    if (next.extracting <= 0) {
      finishExtraction(next)
      return { state: next, error: null }
    }
    pushLog(next, 'extract', `撤离读条中……还剩 ${next.extracting} 回合。`)
  }
  checkTurnLimit(next)
  return { state: next, error: null }
}

export function useMedkitRaid(state: RaidState, lootId: string): RaidActionResult {
  if (state.status !== 'active') return { state, error: '对局已经结束' }
  const next = cloneState(state)
  const item = next.loot.find((row) => row.id === lootId && row.kind === 'medkit')
  if (!item) return { state, error: '没有这个急救包' }
  if (next.hp >= next.stats.maxHp) return { state, error: '生命值已经满了' }
  next.loot = next.loot.filter((row) => row.id !== lootId)
  const heal = Math.max(1, Math.round((next.stats.maxHp * RAID_MEDKIT_HEAL_PCT) / 100))
  const before = next.hp
  next.hp = Math.min(next.stats.maxHp, next.hp + heal)
  pushLog(next, 'info', `使用急救包，回复 ${next.hp - before} 点生命。`)
  return { state: next, error: null }
}

/**
 * 把随身战利品放进保险箱（阵亡也保留）。
 * 容量由调用方传入（用户仓库等级派生），缺省回退全局默认值。
 */
export function storeSafeRaid(state: RaidState, lootId: string, safeCapacity: number = RAID_SAFE_CAPACITY): RaidActionResult {
  if (state.status !== 'active') return { state, error: '对局已经结束' }
  const next = cloneState(state)
  const capacity = Math.max(0, Math.floor(safeCapacity))
  if (next.safe.length >= capacity) return { state, error: '保险箱已经满了' }
  const item = next.loot.find((row) => row.id === lootId)
  if (!item) return { state, error: '没有这件战利品' }
  next.loot = next.loot.filter((row) => row.id !== lootId)
  next.safe.push(item)
  pushLog(next, 'info', `把 ${item.emoji}${item.name} 放进了保险箱（阵亡也能带出）。`)
  return { state: next, error: null }
}

export function takeSafeRaid(state: RaidState, lootId: string): RaidActionResult {
  if (state.status !== 'active') return { state, error: '对局已经结束' }
  const next = cloneState(state)
  const item = next.safe.find((row) => row.id === lootId)
  if (!item) return { state, error: '保险箱里没有这件物品' }
  next.safe = next.safe.filter((row) => row.id !== lootId)
  next.loot.push(item)
  pushLog(next, 'info', `把 ${item.emoji}${item.name} 从保险箱取回随身携带。`)
  return { state: next, error: null }
}

export function abandonRaid(state: RaidState): RaidActionResult {
  if (state.status !== 'active') return { state, error: '对局已经结束' }
  const next = cloneState(state)
  next.status = 'abandoned'
  next.extracting = 0
  pushLog(next, 'death', '你放弃了本次行动，随身战利品丢弃，保险箱物品保留。')
  return { state: next, error: null }
}

/** 真实时间超时（离线过久）：按 MIA 结算 */
export function expireRaid(state: RaidState): RaidActionResult {
  if (state.status !== 'active') return { state, error: '对局已经结束' }
  const next = cloneState(state)
  next.status = 'mia'
  next.extracting = 0
  pushLog(next, 'death', '行动超时，你失联了……随身战利品丢失，保险箱物品保留。')
  return { state: next, error: null }
}

/* ============================================================
   结算辅助
   ============================================================ */

export function lootValue(item: RaidLootItem): number {
  if (item.kind === 'seed') {
    const crop = getCrop(item.payload)
    return (crop?.seedCost ?? 20) * Math.max(1, item.amount)
  }
  if (item.kind === 'equipment' || item.kind === 'skill') return item.value
  if (item.kind === 'medkit') return item.value
  return item.value * Math.max(1, item.amount)
}

export function totalLootValue(items: readonly RaidLootItem[]): number {
  return items.reduce((sum, item) => sum + lootValue(item), 0)
}

/** 成功撤离时所有随身 + 保险箱物品；阵亡/失联/放弃时只保留保险箱 */
export function keptLoot(state: RaidState): RaidLootItem[] {
  if (state.status === 'extracted') return [...state.safe, ...state.loot]
  return [...state.safe]
}

export function lostLoot(state: RaidState): RaidLootItem[] {
  if (state.status === 'extracted') return []
  return [...state.loot]
}

/* ============================================================
   契约
   ============================================================ */

export interface RaidContractDef {
  key: string
  name: string
  description: string
  metric: 'extracts' | 'kills' | 'lootValue'
  target: number
  rewardPoints: number
}

export const RAID_CONTRACTS: readonly RaidContractDef[] = [
  { key: 'extract_1', name: '活着回来', description: '成功撤离 1 次', metric: 'extracts', target: 1, rewardPoints: 60 },
  { key: 'kill_3', name: '清道夫', description: '击杀 3 名敌人', metric: 'kills', target: 3, rewardPoints: 90 },
  { key: 'loot_2500', name: '满载而归', description: '单日带出价值 2500 积分的战利品', metric: 'lootValue', target: 2500, rewardPoints: 140 },
]

export const RAID_CONTRACT_MAP: ReadonlyMap<string, RaidContractDef> = new Map(
  RAID_CONTRACTS.map((contract) => [contract.key, contract]),
)

/* ============================================================
   视图中转（隐藏未探索区域）
   ============================================================ */

export interface RaidCellDto {
  index: number
  x: number
  y: number
  kind: RaidCellKind | 'unknown'
  revealed: boolean
  visited: boolean
  searched: boolean
  enemy: null | {
    name: string
    emoji: string
    level: number
    kind: RaidEnemy['kind']
    hp: number
    maxHp: number
  }
  /** 当前是否站在这里 */
  current: boolean
}

export function buildRaidCellDtos(state: RaidState): RaidCellDto[] {
  const visited = new Set(state.visited)
  const currentIndex = idx(state.width, state.player.x, state.player.y)
  return state.cells.map((cell) => {
    const revealed = visited.has(cell.index)
    const isCurrent = cell.index === currentIndex
    const visible = revealed || isCurrent
    return {
      index: cell.index,
      x: cell.x,
      y: cell.y,
      kind: visible ? cell.kind : 'unknown',
      revealed: visible,
      visited: isCurrent || visited.has(cell.index),
      searched: visible ? cell.searched : false,
      enemy: visible && cell.enemy
        ? {
          name: cell.enemy.name,
          emoji: cell.enemy.emoji,
          level: cell.enemy.level,
          kind: cell.enemy.kind,
          hp: cell.enemy.hp,
          maxHp: cell.enemy.maxHp,
        }
        : null,
      current: isCurrent,
    }
  })
}

/** 装备耐久/保险：可掉落装备（非绑定）的参考总价 */
export function insurableGearValue(equipmentKeys: readonly string[]): number {
  let total = 0
  for (const key of equipmentKeys) {
    const item = PET_EQUIPMENT_MAP.get(key)
    if (item && !item.bound) total += item.price
  }
  return total
}

export function insuranceCost(equipmentKeys: readonly string[]): number {
  const value = insurableGearValue(equipmentKeys)
  if (value <= 0) return 0
  return Math.max(RAID_INSURANCE_MIN, Math.round(value * RAID_INSURANCE_RATE))
}
