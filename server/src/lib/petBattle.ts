/**
 * 宠物战斗引擎（纯函数，服务端唯一真相源；客户端只渲染服务端返回的日志）。
 *
 * 规则：
 *   - 实时手动回合制：每轮双方各行动一次，SPD 决定先手；每个动作由服务端结算并写入日志
 *   - 最多 40 轮；任一方 HP 归零即结束；40 轮后按剩余 HP 百分比判定，完全相同为平局
 *   - 每回合 30 秒（service 层控制 deadline），超时自动普攻；连续 3 次超时判负
 *   - 技能有 MP 与冷却限制；增益/减益/护盾/持续伤害都按「自身回合」计时
 *   - 所有随机数由种子驱动，便于自检与回放一致
 */

import { PET_MAX_LEVEL } from './petCatalog.js'
import {
  PET_EQUIPMENT_MAP,
  PET_EQUIPMENT_SLOTS,
  type PetEquipmentDef,
} from './petEquipment.js'
import {
  PET_BASIC_SKILL_KEY,
  PET_SKILL_MAP,
  PET_SKILL_MAX_EQUIPPED,
  type PetSkillDef,
} from './petSkills.js'

export const PET_BATTLE_MAX_ROUNDS = 40
export const PET_BATTLE_TURN_MS = 30_000
export const PET_BATTLE_MAX_TIMEOUTS = 3
export const PET_BATTLE_LOG_LIMIT = 120
export const PET_BATTLE_STAKE_RATE = 0.08
export const PET_BATTLE_STAKE_MIN = 10
export const PET_BATTLE_STAKE_MAX = 300

/**
 * 对战赌注：败者积分的 8%，最少 10、最多 300。
 * 关键边界：永远不能超过败者当前余额——否则 spendPointsTx 的条件扣款会失败，
 * 结算事务回滚后对局会永久卡在 active（2026-11-02 审查发现的 P0）。
 */
export function battleStakeFor(points: number): number {
  const balance = Math.max(0, Math.trunc(points))
  if (balance <= 0) return 0
  return Math.min(
    balance,
    Math.max(PET_BATTLE_STAKE_MIN, Math.min(PET_BATTLE_STAKE_MAX, Math.round(balance * PET_BATTLE_STAKE_RATE))),
  )
}

export type PetBattleStatusType = 'burn' | 'poison' | 'stun'
export type PetBattleBuffType = 'atk_up' | 'def_up'

export interface PetBattleStatus {
  type: PetBattleStatusType
  value: number
  turns: number
}

export interface PetBattleBuff {
  type: PetBattleBuffType
  value: number
  turns: number
}

export interface PetCombatInput {
  petId: number
  userId: number
  name: string
  species: string
  level: number
  /** 已穿戴装备 key（weapon/armor/accessory） */
  equipmentKeys: string[]
  /** 已装备技能 key（最多 3 个，不含普攻） */
  skillKeys: string[]
}

export interface PetCombatStats {
  maxHp: number
  maxMp: number
  atk: number
  def: number
  spd: number
  crit: number
}

export interface PetBattleSide extends PetCombatStats {
  petId: number
  userId: number
  name: string
  species: string
  level: number
  hp: number
  mp: number
  skills: string[]
  /** 开战快照的装备 key（败者掉落从这里选，避免中途换装） */
  equipmentKeys: string[]
  cooldowns: Record<string, number>
  buffs: PetBattleBuff[]
  statuses: PetBattleStatus[]
  shield: number
  shieldTurns: number
  consecutiveTimeouts: number
}

export interface PetBattleEvent {
  seq: number
  round: number
  actorId: number
  targetId: number
  skillKey: string
  skillName: string
  animation: string
  kind: string
  damage: number
  absorbed: number
  heal: number
  crit: boolean
  hpAfter: number
  mpAfter: number
  text: string
}

export interface PetBattleState {
  version: number
  round: number
  order: number[]
  orderIndex: number
  turnUserId: number | null
  finished: boolean
  winnerId: number | null
  loserId: number | null
  result: 'win' | 'draw' | null
  sides: Record<string, PetBattleSide>
  log: PetBattleEvent[]
  nextSeq: number
  maxRounds: number
  startedAt: number
}

/** 物种战斗修正（与 PetSprite 的六物种顺序一致） */
const SPECIES_COMBAT_MODS: Readonly<
  Record<string, { hp: number; atk: number; def: number; spd: number; crit: number }>
> = {
  cat: { hp: 0, atk: 3, def: 0, spd: 3, crit: 3 },
  dog: { hp: 20, atk: 4, def: 2, spd: -1, crit: 0 },
  bird: { hp: -10, atk: 1, def: -1, spd: 6, crit: 2 },
  rabbit: { hp: 30, atk: -1, def: 1, spd: 2, crit: 0 },
  fox: { hp: -5, atk: 2, def: 0, spd: 4, crit: 6 },
  panda: { hp: 40, atk: 0, def: 5, spd: -2, crit: 0 },
}

function speciesMods(species: string) {
  return SPECIES_COMBAT_MODS[species] ?? { hp: 0, atk: 0, def: 0, spd: 0, crit: 0 }
}

/** 装备按槽位去重（同槽只取第一件），只认目录里的装备 */
export function normalizeEquipmentKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const key of keys) {
    const item = PET_EQUIPMENT_MAP.get(key)
    if (!item || seen.has(item.slot)) continue
    seen.add(item.slot)
    result.push(item.key)
  }
  return result
}

/** 技能去重、过滤未知与普攻，最多 3 个 */
export function normalizeSkillKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const key of keys) {
    if (key === PET_BASIC_SKILL_KEY) continue
    const skill = PET_SKILL_MAP.get(key)
    if (!skill || seen.has(key)) continue
    seen.add(key)
    result.push(key)
    if (result.length >= PET_SKILL_MAX_EQUIPPED) break
  }
  return result
}

/** 属性派生：等级 + 物种 + 装备；不依赖 DB */
export function deriveCombatStats(input: {
  species: string
  level: number
  equipmentKeys: readonly string[]
}): PetCombatStats {
  const level = Math.max(1, Math.min(PET_MAX_LEVEL, Math.trunc(input.level) || 1))
  const mods = speciesMods(input.species)
  let atk = 0
  let def = 0
  let hp = 0
  let spd = 0
  let crit = 0
  for (const key of normalizeEquipmentKeys(input.equipmentKeys)) {
    const item = PET_EQUIPMENT_MAP.get(key)
    if (!item) continue
    atk += item.atk
    def += item.def
    hp += item.hp
    spd += item.spd
    crit += item.crit
  }
  return {
    maxHp: Math.max(1, Math.round(80 + level * 18 + mods.hp + hp)),
    maxMp: Math.round(60 + level * 2),
    atk: Math.max(1, Math.round(10 + level * 2 + mods.atk + atk)),
    def: Math.max(0, Math.round(4 + level * 1.5 + mods.def + def)),
    spd: Math.max(1, Math.round(8 + level + mods.spd + spd)),
    crit: Math.max(0, Math.min(60, Math.round(5 + mods.crit + crit))),
  }
}

function makeSide(input: PetCombatInput): PetBattleSide {
  const stats = deriveCombatStats(input)
  return {
    petId: input.petId,
    userId: input.userId,
    name: input.name,
    species: input.species,
    level: Math.max(1, Math.min(PET_MAX_LEVEL, Math.trunc(input.level) || 1)),
    ...stats,
    hp: stats.maxHp,
    mp: stats.maxMp,
    skills: normalizeSkillKeys(input.skillKeys),
    equipmentKeys: normalizeEquipmentKeys(input.equipmentKeys),
    cooldowns: {},
    buffs: [],
    statuses: [],
    shield: 0,
    shieldTurns: 0,
    consecutiveTimeouts: 0,
  }
}

function cloneState(state: PetBattleState): PetBattleState {
  return JSON.parse(JSON.stringify(state)) as PetBattleState
}

function sideOf(state: PetBattleState, userId: number): PetBattleSide | null {
  return state.sides[String(userId)] ?? null
}

function opponentOf(state: PetBattleState, userId: number): PetBattleSide | null {
  for (const side of Object.values(state.sides)) {
    if (side.userId !== userId) return side
  }
  return null
}

function pushEvent(
  state: PetBattleState,
  event: Omit<PetBattleEvent, 'seq'>,
): void {
  state.log.push({ seq: state.nextSeq, ...event })
  state.nextSeq += 1
  if (state.log.length > PET_BATTLE_LOG_LIMIT) {
    state.log.splice(0, state.log.length - PET_BATTLE_LOG_LIMIT)
  }
}

/** 创建初始战斗状态；先手由 SPD 决定，相同则 challenger（第一个 input）先手 */
export function createBattleState(inputs: [PetCombatInput, PetCombatInput], now = Date.now()): PetBattleState {
  const first = makeSide(inputs[0])
  const second = makeSide(inputs[1])
  const order =
    second.spd > first.spd ? [second.userId, first.userId] : [first.userId, second.userId]
  return {
    version: 0,
    round: 1,
    order,
    orderIndex: 0,
    turnUserId: order[0],
    finished: false,
    winnerId: null,
    loserId: null,
    result: null,
    sides: { [String(first.userId)]: first, [String(second.userId)]: second },
    log: [],
    nextSeq: 1,
    maxRounds: PET_BATTLE_MAX_ROUNDS,
    startedAt: now,
  }
}

function atkBuff(side: PetBattleSide): number {
  return side.buffs
    .filter((buff) => buff.type === 'atk_up')
    .reduce((sum, buff) => sum + buff.value, 0)
}

function defBuff(side: PetBattleSide): number {
  return side.buffs
    .filter((buff) => buff.type === 'def_up')
    .reduce((sum, buff) => sum + buff.value, 0)
}

function hasStun(side: PetBattleSide): boolean {
  return side.statuses.some((status) => status.type === 'stun' && status.turns > 0)
}

function clampHp(side: PetBattleSide, value: number): number {
  return Math.max(0, Math.min(side.maxHp, Math.round(value)))
}

function healSide(side: PetBattleSide, amount: number): number {
  const before = side.hp
  side.hp = clampHp(side, side.hp + Math.max(0, Math.round(amount)))
  return side.hp - before
}

function applyDamage(side: PetBattleSide, damage: number): { hpDamage: number; absorbed: number } {
  const absorbed = Math.min(side.shield, damage)
  side.shield -= absorbed
  const hpDamage = Math.max(0, damage - absorbed)
  side.hp = clampHp(side, side.hp - hpDamage)
  return { hpDamage, absorbed }
}

/** 回合开始：冷却 -1、护盾计时、持续伤害结算、眩晕检查 */
function beginTurn(state: PetBattleState, side: PetBattleSide): boolean {
  for (const key of Object.keys(side.cooldowns)) {
    side.cooldowns[key] = Math.max(0, side.cooldowns[key] - 1)
    if (side.cooldowns[key] === 0) delete side.cooldowns[key]
  }

  if (side.shieldTurns > 0) {
    side.shieldTurns -= 1
    if (side.shieldTurns <= 0) {
      side.shield = 0
      side.shieldTurns = 0
    }
  }

  // 持续伤害：在自身回合开始结算（护盾不吸收 DoT）
  const remaining: PetBattleStatus[] = []
  for (const status of side.statuses) {
    if (status.type === 'burn' || status.type === 'poison') {
      const damage = Math.max(1, Math.round((side.maxHp * status.value) / 100))
      side.hp = clampHp(side, side.hp - damage)
      pushEvent(state, {
        round: state.round,
        actorId: side.userId,
        targetId: side.userId,
        skillKey: status.type,
        skillName: status.type === 'burn' ? '燃烧' : '中毒',
        animation: status.type,
        kind: 'dot',
        damage,
        absorbed: 0,
        heal: 0,
        crit: false,
        hpAfter: side.hp,
        mpAfter: side.mp,
        text: `${side.name} 受到 ${damage} 点${status.type === 'burn' ? '燃烧' : '中毒'}伤害`,
      })
      status.turns -= 1
      if (status.turns > 0 && side.hp > 0) remaining.push(status)
      continue
    }
    remaining.push(status)
  }
  side.statuses = remaining

  if (side.hp <= 0) {
    finishBattle(state, opponentOf(state, side.userId)?.userId ?? null, side.userId)
    return false
  }

  if (hasStun(side)) {
    const stun = side.statuses.find((status) => status.type === 'stun')
    if (stun) {
      stun.turns -= 1
      if (stun.turns <= 0) side.statuses = side.statuses.filter((item) => item !== stun)
    }
    pushEvent(state, {
      round: state.round,
      actorId: side.userId,
      targetId: side.userId,
      skillKey: 'stun',
      skillName: '眩晕',
      animation: 'stun',
      kind: 'stun',
      damage: 0,
      absorbed: 0,
      heal: 0,
      crit: false,
      hpAfter: side.hp,
      mpAfter: side.mp,
      text: `${side.name} 被眩晕，跳过了这一回合`,
    })
    return false
  }

  return true
}

/** 结束战斗 */
function finishBattle(
  state: PetBattleState,
  winnerId: number | null,
  loserId: number | null,
  result: 'win' | 'draw' = 'win',
): void {
  state.finished = true
  state.winnerId = result === 'draw' ? null : winnerId
  state.loserId = result === 'draw' ? null : loserId
  state.result = result
  state.turnUserId = null
}

/** 判定 40 轮上限：按剩余 HP 百分比 */
function checkRoundLimit(state: PetBattleState): boolean {
  if (state.finished) return true
  if (state.round <= state.maxRounds) return false
  const sides = Object.values(state.sides)
  if (sides.length < 2) {
    finishBattle(state, null, null, 'draw')
    return true
  }
  const [a, b] = sides
  const ratioA = a.hp / a.maxHp
  const ratioB = b.hp / b.maxHp
  if (Math.abs(ratioA - ratioB) < 1e-6) {
    pushEvent(state, {
      round: state.round,
      actorId: a.userId,
      targetId: b.userId,
      skillKey: 'draw',
      skillName: '平局',
      animation: 'draw',
      kind: 'end',
      damage: 0,
      absorbed: 0,
      heal: 0,
      crit: false,
      hpAfter: a.hp,
      mpAfter: a.mp,
      text: '双方都耗尽了力气，本场以平局收场',
    })
    finishBattle(state, null, null, 'draw')
    return true
  }
  const winner = ratioA > ratioB ? a : b
  const loser = winner === a ? b : a
  pushEvent(state, {
    round: state.round,
    actorId: winner.userId,
    targetId: loser.userId,
    skillKey: 'timeout_win',
    skillName: '判定获胜',
    animation: 'cheer',
    kind: 'end',
    damage: 0,
    absorbed: 0,
    heal: 0,
    crit: false,
    hpAfter: winner.hp,
    mpAfter: winner.mp,
    text: `回合耗尽，${winner.name} 以更高的剩余生命值获胜`,
  })
  finishBattle(state, winner.userId, loser.userId)
  return true
}

/** 推进到下一位行动者（跨轮时回合数 +1） */
function advanceTurn(state: PetBattleState): void {
  if (state.finished) return
  state.orderIndex += 1
  if (state.orderIndex >= state.order.length) {
    state.orderIndex = 0
    state.round += 1
  }
  // 防御：跳过已阵亡的 action 者（正常流程不会出现）
  let guard = 0
  while (!state.finished && guard < state.order.length * 2) {
    const nextId = state.order[state.orderIndex]
    const next = sideOf(state, nextId)
    if (next && next.hp > 0) break
    state.orderIndex += 1
    if (state.orderIndex >= state.order.length) {
      state.orderIndex = 0
      state.round += 1
    }
    guard += 1
  }
  state.turnUserId = state.order[state.orderIndex] ?? null
  checkRoundLimit(state)
}

/** 校验技能是否可用（返回错误文案或 null） */
export function validateSkillUse(
  side: PetBattleSide,
  skillKey: string,
): { skill: PetSkillDef | null; error: string | null } {
  const skill = PET_SKILL_MAP.get(skillKey)
  if (!skill) return { skill: null, error: '技能不存在' }
  if (skill.key !== PET_BASIC_SKILL_KEY && !side.skills.includes(skill.key)) {
    return { skill, error: '没有装备这个技能' }
  }
  if ((side.cooldowns[skill.key] ?? 0) > 0) {
    return { skill, error: '技能还在冷却中' }
  }
  if (side.mp < skill.mpCost) {
    return { skill, error: 'MP 不足' }
  }
  return { skill, error: null }
}

/**
 * 执行一次行动（返回新的 state，不修改入参）。
 * 调用方需先校验 turnUserId 与 version。
 */
export function applyBattleAction(
  state: PetBattleState,
  userId: number,
  skillKey: string,
  rng: () => number,
  manual = true,
): { state: PetBattleState; error: string | null } {
  if (state.finished) return { state, error: '战斗已经结束' }
  if (state.turnUserId !== userId) return { state, error: '还没轮到你行动' }
  const next = cloneState(state)
  const actor = sideOf(next, userId)
  const target = opponentOf(next, userId)
  if (!actor || !target) return { state, error: '战斗数据异常' }

  // 回合开始结算（冷却 / 护盾 / DoT / 眩晕）——可能直接结束战斗
  const canAct = beginTurn(next, actor)
  if (next.finished) return { state: next, error: null }
  if (!canAct) {
    advanceTurn(next)
    return { state: next, error: null }
  }

  // 冷却在回合开始已递减，这里再校验本回合可用性
  const { skill, error } = validateSkillUse(actor, skillKey)
  if (!skill || error) return { state, error: error ?? '技能不可用' }

  if (manual) actor.consecutiveTimeouts = 0
  actor.mp = Math.max(0, actor.mp - skill.mpCost)
  if (skill.cooldown > 0) actor.cooldowns[skill.key] = skill.cooldown + 1

  let damage = 0
  let absorbed = 0
  let heal = 0
  let crit = false
  const extras: string[] = []

  if (skill.kind === 'damage') {
    const attack = actor.atk * (1 + atkBuff(actor) / 100)
    const defense = target.def * (1 + defBuff(target) / 100) * (1 - (skill.ignoreDef ?? 0))
    const raw = Math.max(1, attack * skill.power - defense * 0.45)
    const variance = 0.9 + rng() * 0.2
    const critChance = Math.min(0.75, Math.max(0, (actor.crit + (skill.critBonus ?? 0)) / 100))
    crit = rng() < critChance
    damage = Math.max(1, Math.round(raw * variance * (crit ? 1.6 : 1)))
    const applied = applyDamage(target, damage)
    absorbed = applied.absorbed
    damage = applied.hpDamage
    if (skill.lifesteal && damage > 0) {
      heal = healSide(actor, damage * skill.lifesteal)
      if (heal > 0) extras.push(`吸取 ${heal} HP`)
    }
  } else if (skill.kind === 'heal') {
    heal = healSide(actor, (actor.maxHp * (skill.healPct ?? 0)) / 100)
  } else if (skill.kind === 'cleanse') {
    const removed = actor.statuses.length
    actor.statuses = []
    heal = healSide(actor, (actor.maxHp * (skill.healPct ?? 0)) / 100)
    if (removed > 0) extras.push(`清除了 ${removed} 个负面状态`)
  }

  // 附加效果（伤害技能对目标；增益/护盾对自身）
  for (const effect of skill.effects ?? []) {
    if (effect.chance !== undefined && rng() > effect.chance) {
      extras.push(`${effectLabel(effect.type)}未触发`)
      continue
    }
    if (effect.type === 'atk_up' || effect.type === 'def_up') {
      actor.buffs = actor.buffs.filter((buff) => buff.type !== effect.type)
      actor.buffs.push({ type: effect.type, value: effect.value, turns: effect.turns })
      extras.push(`${effect.type === 'atk_up' ? '攻击' : '防御'} +${effect.value}%（${effect.turns} 回合）`)
    } else if (effect.type === 'shield') {
      actor.shield = Math.min(
        actor.maxHp,
        actor.shield + Math.round((actor.maxHp * effect.value) / 100),
      )
      actor.shieldTurns = Math.max(actor.shieldTurns, effect.turns)
      extras.push(`获得 ${Math.round((actor.maxHp * effect.value) / 100)} 点护盾`)
    } else if (effect.type === 'stun' || effect.type === 'burn' || effect.type === 'poison') {
      target.statuses = target.statuses.filter((status) => status.type !== effect.type)
      target.statuses.push({ type: effect.type, value: effect.value, turns: effect.turns })
      extras.push(
        effect.type === 'stun'
          ? `使目标眩晕 ${effect.turns} 回合`
          : `附加${effectLabel(effect.type)}（${effect.turns} 回合）`,
      )
    }
  }

  // 自身增益回合数在行动结束后递减
  actor.buffs = actor.buffs
    .map((buff) => ({ ...buff, turns: buff.turns - 1 }))
    .filter((buff) => buff.turns > 0)

  const textParts: string[] = []
  textParts.push(`${actor.name} 使用「${skill.name}」`)
  if (damage > 0) textParts.push(`造成 ${damage} 点伤害${crit ? '（暴击）' : ''}`)
  if (absorbed > 0) textParts.push(`护盾吸收 ${absorbed} 点`)
  if (heal > 0 && skill.kind !== 'damage') textParts.push(`回复 ${heal} HP`)
  if (extras.length > 0) textParts.push(extras.join('，'))

  pushEvent(next, {
    round: next.round,
    actorId: actor.userId,
    targetId: target.userId,
    skillKey: skill.key,
    skillName: skill.name,
    animation: skill.animation,
    kind: skill.kind,
    damage,
    absorbed,
    heal,
    crit,
    hpAfter: target.hp,
    mpAfter: actor.mp,
    text: textParts.join('，'),
  })

  if (target.hp <= 0) {
    pushEvent(next, {
      round: next.round,
      actorId: actor.userId,
      targetId: target.userId,
      skillKey: 'victory',
      skillName: '胜利',
      animation: 'cheer',
      kind: 'end',
      damage: 0,
      absorbed: 0,
      heal: 0,
      crit: false,
      hpAfter: target.hp,
      mpAfter: actor.mp,
      text: `${target.name} 倒下了，${actor.name} 赢得了本场对战`,
    })
    finishBattle(next, actor.userId, target.userId)
    next.version = state.version + 1
    return { state: next, error: null }
  }

  advanceTurn(next)
  next.version = state.version + 1
  return { state: next, error: null }
}

function effectLabel(type: string): string {
  switch (type) {
    case 'burn':
      return '燃烧'
    case 'poison':
      return '中毒'
    case 'stun':
      return '眩晕'
    case 'shield':
      return '护盾'
    case 'atk_up':
      return '攻击提升'
    case 'def_up':
      return '防御提升'
    default:
      return type
  }
}

/** 超时自动普攻：连续 3 次超时判负 */
export function applyBattleTimeout(
  state: PetBattleState,
  rng: () => number,
): PetBattleState {
  if (state.finished || !state.turnUserId) return state
  const turnUserId = state.turnUserId
  const next = cloneState(state)
  const actor = sideOf(next, turnUserId)
  if (!actor) return state
  actor.consecutiveTimeouts += 1
  if (actor.consecutiveTimeouts >= PET_BATTLE_MAX_TIMEOUTS) {
    const winner = opponentOf(next, actor.userId)
    if (winner) {
      pushEvent(next, {
        round: next.round,
        actorId: winner.userId,
        targetId: actor.userId,
        skillKey: 'timeout_forfeit',
        skillName: '超时判负',
        animation: 'faint',
        kind: 'end',
        damage: 0,
        absorbed: 0,
        heal: 0,
        crit: false,
        hpAfter: actor.hp,
        mpAfter: actor.mp,
        text: `${actor.name} 连续 ${PET_BATTLE_MAX_TIMEOUTS} 次超时，判负`,
      })
      finishBattle(next, winner.userId, actor.userId)
    }
    next.version = state.version + 1
    return next
  }
  const result = applyBattleAction(next, turnUserId, PET_BASIC_SKILL_KEY, rng, false)
  if (result.error) {
    // 极端情况下（例如 MP/冷却异常）直接按普攻继续，不阻塞对局
    const fallback = cloneState(next)
    const fallbackActor = sideOf(fallback, turnUserId)
    if (fallbackActor) fallbackActor.consecutiveTimeouts = 0
    return fallback
  }
  return result.state
}

/** 认输 / 掉线判负 */
export function applyBattleForfeit(
  state: PetBattleState,
  userId: number,
  reason = '认输',
): PetBattleState {
  if (state.finished) return state
  const loser = sideOf(state, userId)
  const winner = opponentOf(state, userId)
  if (!loser || !winner) return state
  const next = cloneState(state)
  const nextLoser = sideOf(next, userId)!
  const nextWinner = opponentOf(next, userId)!
  pushEvent(next, {
    round: next.round,
    actorId: nextWinner.userId,
    targetId: nextLoser.userId,
    skillKey: 'forfeit',
    skillName: reason,
    animation: 'faint',
    kind: 'end',
    damage: 0,
    absorbed: 0,
    heal: 0,
    crit: false,
    hpAfter: nextLoser.hp,
    mpAfter: nextLoser.mp,
    text: `${nextLoser.name} ${reason}，${nextWinner.name} 获胜`,
  })
  finishBattle(next, nextWinner.userId, nextLoser.userId)
  next.version = state.version + 1
  return next
}

/** 平局判定（供 service 在 40 轮后调用） */
export function settleRoundLimit(state: PetBattleState): PetBattleState {
  const next = cloneState(state)
  checkRoundLimit(next)
  return next
}

/** UI 用：当前可点击的技能（含普攻） */
export function availableSkills(side: PetBattleSide): Array<{
  key: string
  name: string
  emoji: string
  mpCost: number
  cooldown: number
  usable: boolean
  reason: string | null
}> {
  const keys = [PET_BASIC_SKILL_KEY, ...side.skills]
  return keys.map((key) => {
    const skill = PET_SKILL_MAP.get(key)!
    const { error } = validateSkillUse(side, key)
    return {
      key,
      name: skill.name,
      emoji: skill.emoji,
      mpCost: skill.mpCost,
      cooldown: side.cooldowns[key] ?? 0,
      usable: error === null,
      reason: error,
    }
  })
}

/** 简单的种子随机数（mulberry32），与 stockMarket 同算法但独立实现避免耦合 */
export function createBattleRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** 统计装备总加成（交易行/背包展示用） */
export function equipmentTotals(items: readonly PetEquipmentDef[]): {
  atk: number
  def: number
  hp: number
  spd: number
  crit: number
} {
  const totals = { atk: 0, def: 0, hp: 0, spd: 0, crit: 0 }
  for (const item of items) {
    totals.atk += item.atk
    totals.def += item.def
    totals.hp += item.hp
    totals.spd += item.spd
    totals.crit += item.crit
  }
  return totals
}

/** 校验装备槽位是否合法（service 层购买/穿戴时使用） */
export function isEquipmentSlot(value: string): value is (typeof PET_EQUIPMENT_SLOTS)[number] {
  return (PET_EQUIPMENT_SLOTS as readonly string[]).includes(value)
}
