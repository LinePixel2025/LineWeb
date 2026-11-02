/**
 * 宠物 PvP 对战服务（实时手动回合制）。
 *
 * 流程：邀请（pending，10 分钟有效）→ 对方应战（快照双方属性 / 装备 / 技能）→
 * 轮流行动（30 秒回合超时自动普攻，连续 3 次超时判负）→ 一方 HP 归零结算。
 * 结算：胜者从败者积分里拿走 8%（10–300 上限），并随机获得败者 1 件已穿戴非绑定装备
 * （每人每天最多被掉 1 件；同一对用户每天最多 3 场）。
 *
 * 状态全部落 PetBattle.state（JSON）+ version 乐观锁；服务端权威结算，客户端只渲染日志。
 */

import prisma from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { getTodayDateKey, getTodayDayStart } from '../lib/pointsRules.js'
import { cleanLoadout, loadoutEquipmentKeys } from '../lib/petCatalog.js'
import { PET_EQUIPMENT_MAP } from '../lib/petEquipment.js'
import { PET_SKILL_MAP } from '../lib/petSkills.js'
import {
  applyBattleAction,
  applyBattleForfeit,
  applyBattleTimeout,
  availableSkills,
  battleStakeFor,
  createBattleRng,
  createBattleState,
  type PetBattleSide,
  type PetBattleState,
  type PetCombatInput,
} from '../lib/petBattle.js'
import { awardPointsTx, spendPointsTx } from './pointsService.js'
import { ensureStarterEquipment, getPetView } from './petService.js'

const INVITE_TTL_MS = 10 * 60_000
const TURN_MS = 30_000
const PRESENCE_TIMEOUT_MS = 90_000
const PAIR_DAILY_LIMIT = 3
const STAKE_RATE = 0.08
const STAKE_MIN = 10
const STAKE_MAX = 300
const HISTORY_LIMIT = 20
const SWEEPER_INTERVAL_MS = 5_000

export interface BattleParticipantDto {
  userId: number
  username: string
  avatarVersion: number | null
  petName: string
  species: string
  speciesName: string
  level: number
  hp: number
  maxHp: number
  mp: number
  maxMp: number
  atk: number
  def: number
  spd: number
  crit: number
  shield: number
}

export interface BattleDropDto {
  itemType: 'equipment'
  itemKey: string
  name: string
}

export interface PetBattleSummaryDto {
  id: number
  status: string
  challenger: BattleParticipantDto
  opponent: BattleParticipantDto
  turnUserId: number | null
  turnDeadline: string | null
  round: number
  version: number
  createdAt: string
  expiresAt: string | null
  finished: boolean
  winnerId: number | null
  loserId: number | null
  result: 'win' | 'draw' | null
  rewardPoints: number
  drop: BattleDropDto | null
}

export interface PetBattleViewDto extends PetBattleSummaryDto {
  me: BattleParticipantDto & {
    skills: Array<{
      key: string
      name: string
      emoji: string
      mpCost: number
      cooldown: number
      usable: boolean
      reason: string | null
    }>
    buffs: PetBattleSide['buffs']
    statuses: PetBattleSide['statuses']
    consecutiveTimeouts: number
  }
  log: PetBattleState['log']
  /** 对手已装备技能（只展示，不参与操作） */
  opponentSkills: Array<{ key: string; name: string; emoji: string; mpCost: number; cooldown: number }>
  result: 'win' | 'draw' | null
}

export interface PetBattleOverviewDto {
  active: PetBattleSummaryDto | null
  incoming: PetBattleSummaryDto[]
  outgoing: PetBattleSummaryDto[]
  history: PetBattleSummaryDto[]
  record: { wins: number; losses: number; draws: number; total: number }
  opponents: Array<{
    userId: number
    username: string
    avatarVersion: number | null
    species: string
    speciesName: string
    petName: string
    level: number
    /** 今日与该用户剩余可挑战次数 */
    remainingToday: number
  }>
  stakeRule: { rate: number; min: number; max: number }
}

interface BattleRow {
  id: number
  challengerId: number
  opponentId: number
  status: string
  state: string
  version: number
  turnUserId: number | null
  turnDeadline: Date | null
  challengerSeenAt: Date | null
  opponentSeenAt: Date | null
  winnerId: number | null
  loserId: number | null
  rewardPoints: number
  dropJson: string | null
  expiresAt: Date | null
  settledAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const SPECIES_NAMES: Record<string, string> = {
  cat: '小猫',
  dog: '小狗',
  bird: '小鸟',
  rabbit: '小兔',
  fox: '小狐狸',
  panda: '小熊猫',
}

function speciesName(key: string): string {
  return SPECIES_NAMES[key] ?? '宠物'
}

function parseState(row: BattleRow): PetBattleState | null {
  try {
    const parsed = JSON.parse(row.state) as PetBattleState
    if (!parsed || typeof parsed !== 'object' || !parsed.sides) return null
    return parsed
  } catch {
    return null
  }
}

function parseDrop(raw: string | null): BattleDropDto | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as BattleDropDto
    if (!parsed?.itemKey || parsed.itemType !== 'equipment') return null
    return parsed
  } catch {
    return null
  }
}

async function loadParticipantMap(
  rows: BattleRow[],
): Promise<Map<number, BattleParticipantDto>> {
  const ids = new Set<number>()
  for (const row of rows) {
    ids.add(row.challengerId)
    ids.add(row.opponentId)
  }
  if (ids.size === 0) return new Map()
  const [users, pets] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, username: true, avatarVersion: true },
    }),
    prisma.pet.findMany({
      where: { userId: { in: [...ids] } },
      select: { userId: true, name: true, species: true, level: true },
    }),
  ])
  const petMap = new Map(pets.map((pet) => [pet.userId, pet]))
  const map = new Map<number, BattleParticipantDto>()
  for (const user of users) {
    const pet = petMap.get(user.id)
    if (!pet) continue
    map.set(user.id, {
      userId: user.id,
      username: user.username,
      avatarVersion: user.avatarVersion,
      petName: pet.name,
      species: pet.species,
      speciesName: speciesName(pet.species),
      level: pet.level,
      hp: 0,
      maxHp: 0,
      mp: 0,
      maxMp: 0,
      atk: 0,
      def: 0,
      spd: 0,
      crit: 0,
      shield: 0,
    })
  }
  return map
}

function sideToParticipant(
  side: PetBattleSide | undefined,
  fallback: BattleParticipantDto | undefined,
): BattleParticipantDto {
  if (side) {
    return {
      userId: side.userId,
      username: fallback?.username ?? `用户${side.userId}`,
      avatarVersion: fallback?.avatarVersion ?? null,
      petName: side.name,
      species: side.species,
      speciesName: speciesName(side.species),
      level: side.level,
      hp: side.hp,
      maxHp: side.maxHp,
      mp: side.mp,
      maxMp: side.maxMp,
      atk: side.atk,
      def: side.def,
      spd: side.spd,
      crit: side.crit,
      shield: side.shield,
    }
  }
  if (fallback) return fallback
  throw new AppError('对战数据异常', 500)
}

function battleSummary(
  row: BattleRow,
  participants: Map<number, BattleParticipantDto>,
): PetBattleSummaryDto {
  const state = parseState(row)
  const challenger = sideToParticipant(
    state?.sides[String(row.challengerId)],
    participants.get(row.challengerId),
  )
  const opponent = sideToParticipant(
    state?.sides[String(row.opponentId)],
    participants.get(row.opponentId),
  )
  return {
    id: row.id,
    status: row.status,
    challenger,
    opponent,
    turnUserId: row.turnUserId,
    turnDeadline: row.turnDeadline ? row.turnDeadline.toISOString() : null,
    round: state?.round ?? 0,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    finished: row.status === 'finished',
    winnerId: row.winnerId,
    loserId: row.loserId,
    result: state?.result ?? null,
    rewardPoints: row.rewardPoints,
    drop: parseDrop(row.dropJson),
  }
}

/** 读取用户可出战的宠物（含绑定新手装补发）；不可出战抛 400 */
async function loadCombatInput(userId: number): Promise<PetCombatInput> {
  await ensureStarterEquipment(userId)
  const pet = await prisma.pet.findUnique({
    where: { userId },
    include: {
      equipments: { select: { itemKey: true } },
      skills: { select: { skillKey: true } },
    },
  })
  if (!pet) throw new AppError('对方还没有宠物', 400)
  if (pet.status !== 'alive') throw new AppError('对方的宠物已经离家出走了', 400)
  const loadout = cleanLoadout(
    pet.equipped,
    pet.equipments.map((row) => row.itemKey),
    pet.skills.map((row) => row.skillKey),
  )
  return {
    petId: pet.id,
    userId,
    name: pet.name,
    species: pet.species,
    level: pet.level,
    equipmentKeys: loadoutEquipmentKeys(loadout),
    skillKeys: loadout.skills,
  }
}

/** 邀请对战 */
export async function inviteBattle(
  challengerId: number,
  opponentId: number,
): Promise<PetBattleSummaryDto> {
  if (challengerId === opponentId) throw new AppError('不能挑战自己', 400)
  const now = Date.now()
  await loadCombatInput(challengerId)
  await loadCombatInput(opponentId)

  const busy = await prisma.petBattle.count({
    where: {
      status: { in: ['pending', 'active'] },
      OR: [{ challengerId }, { opponentId }, { challengerId: opponentId }, { opponentId: challengerId }],
    },
  })
  if (busy > 0) throw new AppError('你们之间有未结束的对战或邀请', 409)

  const dayStart = getTodayDayStart(now)
  const pairCount = await prisma.petBattle.count({
    where: {
      createdAt: { gte: dayStart },
      OR: [
        { challengerId, opponentId },
        { challengerId: opponentId, opponentId: challengerId },
      ],
    },
  })
  if (pairCount >= PAIR_DAILY_LIMIT) {
    throw new AppError(`同一对手每天最多挑战 ${PAIR_DAILY_LIMIT} 场`, 429)
  }

  const row = await prisma.petBattle.create({
    data: {
      challengerId,
      opponentId,
      status: 'pending',
      expiresAt: new Date(now + INVITE_TTL_MS),
    },
  })
  const participants = await loadParticipantMap([row])
  return battleSummary(row, participants)
}

/** 应战 / 拒绝（只有被邀请方可以操作） */
export async function respondBattle(
  userId: number,
  battleId: number,
  accept: boolean,
): Promise<PetBattleSummaryDto> {
  const row = await prisma.petBattle.findUnique({ where: { id: battleId } })
  if (!row) throw new AppError('对战不存在', 404)
  if (row.opponentId !== userId) throw new AppError('这场对战不是发给你的', 403)
  if (row.status !== 'pending') throw new AppError('邀请已经失效', 409)
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    await prisma.petBattle.updateMany({
      where: { id: battleId, status: 'pending' },
      data: { status: 'expired' },
    })
    throw new AppError('邀请已经过期', 409)
  }

  if (!accept) {
    await prisma.petBattle.update({ where: { id: battleId }, data: { status: 'declined' } })
    const participants = await loadParticipantMap([row])
    return battleSummary({ ...row, status: 'declined' }, participants)
  }

  // 应战前复查：任一参与者都不能再有其它进行中的对战（降低并发双开）
  const otherActive = await prisma.petBattle.count({
    where: {
      id: { not: battleId },
      status: 'active',
      OR: [
        { challengerId: row.challengerId },
        { opponentId: row.challengerId },
        { challengerId: userId },
        { opponentId: userId },
      ],
    },
  })
  if (otherActive > 0) throw new AppError('你或对方还有未结束的对战', 409)

  const [challengerInput, opponentInput] = await Promise.all([
    loadCombatInput(row.challengerId),
    loadCombatInput(userId),
  ])
  const state = createBattleState([challengerInput, opponentInput])
  const now = new Date()
  const deadline = new Date(now.getTime() + TURN_MS)
  const updated = await prisma.petBattle.updateMany({
    where: {
      id: battleId,
      status: 'pending',
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    data: {
      status: 'active',
      state: JSON.stringify(state),
      version: 1,
      turnUserId: state.turnUserId,
      turnDeadline: deadline,
      challengerSeenAt: now,
      opponentSeenAt: now,
      expiresAt: null,
    },
  })
  if (updated.count === 0) throw new AppError('邀请已经失效', 409)
  const fresh = await prisma.petBattle.findUnique({ where: { id: battleId } })
  const participants = await loadParticipantMap([fresh ?? row])
  return battleSummary(fresh ?? { ...row, status: 'active' }, participants)
}

/** 取消邀请（仅发起方、仅 pending） */
export async function cancelBattle(userId: number, battleId: number): Promise<void> {
  const row = await prisma.petBattle.findUnique({ where: { id: battleId } })
  if (!row) throw new AppError('对战不存在', 404)
  if (row.challengerId !== userId) throw new AppError('只有发起方可以取消邀请', 403)
  if (row.status !== 'pending') throw new AppError('邀请已经失效', 409)
  await prisma.petBattle.update({ where: { id: battleId }, data: { status: 'cancelled' } })
}

/** 读取对战详情（参与者） */
export async function getBattle(userId: number, battleId: number): Promise<PetBattleViewDto> {
  const row = await prisma.petBattle.findUnique({ where: { id: battleId } })
  if (!row) throw new AppError('对战不存在', 404)
  if (row.challengerId !== userId && row.opponentId !== userId) {
    throw new AppError('这不是你的对战', 403)
  }
  const state = parseState(row)
  const participants = await loadParticipantMap([row])
  const summary = battleSummary(row, participants)
  if (!state) return { ...summary, me: meFromFallback(userId, participants, summary), log: [], opponentSkills: [], result: null }
  const meSide = state.sides[String(userId)]
  const opponentSide = state.sides[String(userId === row.challengerId ? row.opponentId : row.challengerId)]
  const meParticipant = sideToParticipant(meSide, participants.get(userId))
  const opponentParticipant = sideToParticipant(
    opponentSide,
    participants.get(userId === row.challengerId ? row.opponentId : row.challengerId),
  )
  return {
    ...summary,
    challenger: sideToParticipant(state.sides[String(row.challengerId)], participants.get(row.challengerId)),
    opponent: opponentParticipant,
    me: {
      ...meParticipant,
      skills: meSide ? availableSkills(meSide) : [],
      buffs: meSide?.buffs ?? [],
      statuses: meSide?.statuses ?? [],
      consecutiveTimeouts: meSide?.consecutiveTimeouts ?? 0,
    },
    log: state.log,
    opponentSkills: (opponentSide?.skills ?? []).map((key) => {
      const skill = PET_SKILL_MAP.get(key)
      return {
        key,
        name: skill?.name ?? key,
        emoji: skill?.emoji ?? '✨',
        mpCost: skill?.mpCost ?? 0,
        cooldown: opponentSide?.cooldowns[key] ?? 0,
      }
    }),
    result: state.result,
  }
}

function meFromFallback(
  userId: number,
  participants: Map<number, BattleParticipantDto>,
  summary: PetBattleSummaryDto,
): PetBattleViewDto['me'] {
  const base = participants.get(userId) ?? summary.challenger
  return {
    ...base,
    skills: [],
    buffs: [],
    statuses: [],
    consecutiveTimeouts: 0,
  }
}

/** 行动（只允许当前回合用户在 version 匹配时提交） */
export async function performBattleAction(
  userId: number,
  battleId: number,
  skillKey: string,
  version: number,
): Promise<PetBattleViewDto> {
  const row = await prisma.petBattle.findUnique({ where: { id: battleId } })
  if (!row) throw new AppError('对战不存在', 404)
  if (row.challengerId !== userId && row.opponentId !== userId) {
    throw new AppError('这不是你的对战', 403)
  }
  if (row.status !== 'active') throw new AppError('对战还没有开始或已经结束', 409)
  if (row.version !== version) throw new AppError('对战状态已更新，请刷新后重试', 409)
  if (row.turnUserId !== userId) throw new AppError('还没轮到你行动', 409)
  if (row.turnDeadline && row.turnDeadline.getTime() < Date.now()) {
    await applyTimeoutRow(row)
    throw new AppError('回合已超时，已自动普攻', 409)
  }

  const state = parseState(row)
  if (!state) throw new AppError('对战数据异常', 500)
  const rng = createBattleRng(row.id * 1000 + row.version)
  const result = applyBattleAction(state, userId, skillKey, rng)
  if (result.error) throw new AppError(result.error, 400)

  const next = result.state
  const nextDeadline = next.finished ? null : new Date(Date.now() + TURN_MS)
  const updated = await prisma.petBattle.updateMany({
    where: { id: battleId, status: 'active', version },
    data: {
      state: JSON.stringify(next),
      version: next.version,
      turnUserId: next.turnUserId,
      turnDeadline: nextDeadline,
      ...(userId === row.challengerId
        ? { challengerSeenAt: new Date() }
        : { opponentSeenAt: new Date() }),
    },
  })
  if (updated.count === 0) throw new AppError('对战状态已更新，请刷新后重试', 409)
  if (next.finished) await settleBattle(battleId)
  return getBattle(userId, battleId)
}

/** 心跳（客户端每 10 秒一次；90 秒无心跳判负） */
export async function heartbeatBattle(userId: number, battleId: number): Promise<void> {
  const row = await prisma.petBattle.findUnique({ where: { id: battleId } })
  if (!row) return
  if (row.challengerId !== userId && row.opponentId !== userId) return
  const now = new Date()
  await prisma.petBattle.update({
    where: { id: battleId },
    data: userId === row.challengerId ? { challengerSeenAt: now } : { opponentSeenAt: now },
  })
  if (row.status !== 'active') return
  const otherSeen = userId === row.challengerId ? row.opponentSeenAt : row.challengerSeenAt
  if (otherSeen && now.getTime() - otherSeen.getTime() > PRESENCE_TIMEOUT_MS) {
    await forfeitBattle(battleId, userId === row.challengerId ? row.opponentId : row.challengerId, '掉线')
  }
}

/** 主动认输 */
export async function forfeitBattleByUser(userId: number, battleId: number): Promise<PetBattleViewDto> {
  const row = await prisma.petBattle.findUnique({ where: { id: battleId } })
  if (!row) throw new AppError('对战不存在', 404)
  if (row.challengerId !== userId && row.opponentId !== userId) {
    throw new AppError('这不是你的对战', 403)
  }
  if (row.status !== 'active') throw new AppError('对战已经结束', 409)
  await forfeitBattle(battleId, userId, '认输')
  return getBattle(userId, battleId)
}

async function forfeitBattle(battleId: number, userId: number, reason: string): Promise<void> {
  const row = await prisma.petBattle.findUnique({ where: { id: battleId } })
  if (!row || row.status !== 'active') return
  const state = parseState(row)
  if (!state) return
  const next = applyBattleForfeit(state, userId, reason)
  const updated = await prisma.petBattle.updateMany({
    where: { id: battleId, status: 'active', version: row.version },
    data: {
      state: JSON.stringify(next),
      version: next.version,
      turnUserId: null,
      turnDeadline: null,
    },
  })
  if (updated.count > 0) await settleBattle(battleId)
}

async function applyTimeoutRow(row: BattleRow): Promise<void> {
  const state = parseState(row)
  if (!state || row.status !== 'active') return
  const rng = createBattleRng(row.id * 1000 + row.version)
  const next = applyBattleTimeout(state, rng)
  const updated = await prisma.petBattle.updateMany({
    where: { id: row.id, status: 'active', version: row.version },
    data: {
      state: JSON.stringify(next),
      version: next.version,
      turnUserId: next.turnUserId,
      turnDeadline: next.finished ? null : new Date(Date.now() + TURN_MS),
    },
  })
  if (updated.count > 0 && next.finished) await settleBattle(row.id)
}

function stakeFor(points: number): number {
  return battleStakeFor(points)
}

/** 结算：积分转移 + 装备掉落（幂等：status active → settling 抢占） */
async function settleBattle(battleId: number): Promise<void> {
  const claimed = await prisma.petBattle.updateMany({
    where: { id: battleId, status: 'active' },
    data: { status: 'settling' },
  })
  if (claimed.count === 0) return
  try {
    await prisma.$transaction(async (tx) => {
      const row = await tx.petBattle.findUnique({ where: { id: battleId } })
      if (!row) throw new AppError('对战不存在', 404)
      const state = parseState(row)
      if (!state || !state.finished) {
        await tx.petBattle.update({ where: { id: battleId }, data: { status: 'active' } })
        return
      }
      if (state.result === 'draw' || !state.winnerId || !state.loserId) {
        await tx.petBattle.update({
          where: { id: battleId },
          data: {
            status: 'finished',
            winnerId: null,
            loserId: null,
            rewardPoints: 0,
            dropJson: null,
            settledAt: new Date(),
            turnUserId: null,
            turnDeadline: null,
          },
        })
        return
      }

      const winnerId = state.winnerId
      const loserId = state.loserId
      const loserUser = await tx.user.findUnique({ where: { id: loserId }, select: { points: true } })
      const stake = stakeFor(loserUser?.points ?? 0)
      let awarded = 0
      if (stake > 0) {
        const spent = await spendPointsTx(tx, loserId, stake, {
          reason: 'pet_battle_lose',
          note: '宠物对战失败',
          game: null,
        })
        awarded = Math.abs(spent.delta)
        if (awarded > 0) {
          await awardPointsTx(tx, winnerId, {
            amount: awarded,
            reason: 'pet_battle_win',
            note: '宠物对战获胜',
            game: null,
          })
        }
      }

      let dropJson: string | null = null
      // 每日掉落保护用 Pet.lastDropDate 做原子抢占：并发结算同一天只会掉 1 件
      const today = getTodayDateKey()
      const dropClaim = await tx.pet.updateMany({
        where: {
          userId: loserId,
          OR: [{ lastDropDate: null }, { lastDropDate: { not: today } }],
        },
        data: { lastDropDate: today },
      })
      if (dropClaim.count > 0) {
        const loserSide = state.sides[String(loserId)]
        const winnerSide = state.sides[String(winnerId)]
        if (loserSide && winnerSide) {
          const [loserPet, winnerPet, loserEquipments, winnerEquipments] = await Promise.all([
            tx.pet.findUnique({ where: { userId: loserId } }),
            tx.pet.findUnique({ where: { userId: winnerId } }),
            tx.petEquipment.findMany({ where: { petId: loserSide.petId } }),
            tx.petEquipment.findMany({ where: { petId: winnerSide.petId }, select: { itemKey: true } }),
          ])
          if (loserPet && winnerPet) {
            const winnerOwns = new Set(winnerEquipments.map((item) => item.itemKey))
            const candidates = loserEquipments.filter(
              (item) =>
                !item.bound &&
                loserSide.equipmentKeys.includes(item.itemKey) &&
                !winnerOwns.has(item.itemKey),
            )
            const rng = createBattleRng(row.id * 7919 + row.version)
            const picked = candidates[Math.floor(rng() * candidates.length) % Math.max(1, candidates.length)]
            if (picked) {
              const definition = PET_EQUIPMENT_MAP.get(picked.itemKey)
              if (definition) {
                // 先从败者装配里摘下，再转移所有权
                const ownedAfter = loserEquipments
                  .filter((item) => item.id !== picked.id)
                  .map((item) => item.itemKey)
                const loserSkills = await tx.petSkill.findMany({
                  where: { petId: loserSide.petId },
                  select: { skillKey: true },
                })
                const loadout = cleanLoadout(
                  loserPet.equipped,
                  ownedAfter,
                  loserSkills.map((item) => item.skillKey),
                )
                loadout[definition.slot] = null
                await tx.pet.update({
                  where: { id: loserPet.id },
                  data: { equipped: JSON.stringify(loadout) },
                })
                await tx.petEquipment.update({
                  where: { id: picked.id },
                  data: { petId: winnerPet.id, acquiredVia: 'drop', bound: false, listed: false },
                })
                // 防御：万一该装备还有旧挂单，一并下架，避免胜者刚拿到就被卖掉
                await tx.petMarketListing.updateMany({
                  where: { equipmentId: picked.id, status: 'active' },
                  data: { status: 'cancelled' },
                })
                dropJson = JSON.stringify({
                  itemType: 'equipment',
                  itemKey: picked.itemKey,
                  name: definition.name,
                } satisfies BattleDropDto)
              }
            }
          }
        }
      }

      await tx.petBattle.update({
        where: { id: battleId },
        data: {
          status: 'finished',
          winnerId,
          loserId,
          rewardPoints: awarded,
          dropJson,
          settledAt: new Date(),
          turnUserId: null,
          turnDeadline: null,
          state: JSON.stringify({ ...state, finished: true }),
        },
      })
    })
  } catch (error) {
    await prisma.petBattle.updateMany({
      where: { id: battleId, status: 'settling' },
      data: { status: 'active' },
    })
    throw error
  }
}

/** 概览：进行中 / 收到邀请 / 发出邀请 / 历史 / 战绩 / 可挑战对手 */
export async function getBattleOverview(userId: number): Promise<PetBattleOverviewDto> {
  const now = Date.now()
  const [activeRow, incomingRows, outgoingRows, historyRows, finishedRows, opponents] = await Promise.all([
    prisma.petBattle.findFirst({
      where: { status: 'active', OR: [{ challengerId: userId }, { opponentId: userId }] },
      orderBy: { id: 'desc' },
    }),
    prisma.petBattle.findMany({
      where: { status: 'pending', opponentId: userId, expiresAt: { gt: new Date(now) } },
      orderBy: { id: 'desc' },
      take: 20,
    }),
    prisma.petBattle.findMany({
      where: { status: 'pending', challengerId: userId, expiresAt: { gt: new Date(now) } },
      orderBy: { id: 'desc' },
      take: 20,
    }),
    prisma.petBattle.findMany({
      where: { status: 'finished', OR: [{ challengerId: userId }, { opponentId: userId }] },
      orderBy: { id: 'desc' },
      take: HISTORY_LIMIT,
    }),
    prisma.petBattle.findMany({
      where: { status: 'finished', OR: [{ challengerId: userId }, { opponentId: userId }] },
      select: { winnerId: true, loserId: true },
      take: 500,
    }),
    prisma.pet.findMany({
      where: {
        status: 'alive',
        userId: { not: userId },
        user: { status: 'active' },
      },
      orderBy: [{ level: 'desc' }, { id: 'asc' }],
      take: 30,
      include: { user: { select: { id: true, username: true, avatarVersion: true } } },
    }),
  ])

  const allRows = [
    ...(activeRow ? [activeRow] : []),
    ...incomingRows,
    ...outgoingRows,
    ...historyRows,
  ]
  const participants = await loadParticipantMap(allRows)
  const dayStart = getTodayDayStart(now)
  const pairCounts = await prisma.petBattle.groupBy({
    by: ['challengerId', 'opponentId'],
    where: {
      createdAt: { gte: dayStart },
      OR: [
        { challengerId: userId },
        { opponentId: userId },
      ],
    },
    _count: { _all: true },
  })
  const countFor = (otherId: number): number => {
    let total = 0
    for (const row of pairCounts) {
      if (
        (row.challengerId === userId && row.opponentId === otherId) ||
        (row.challengerId === otherId && row.opponentId === userId)
      ) {
        total += row._count._all
      }
    }
    return total
  }

  let wins = 0
  let losses = 0
  let draws = 0
  for (const row of finishedRows) {
    if (!row.winnerId) {
      draws += 1
    } else if (row.winnerId === userId) {
      wins += 1
    } else {
      losses += 1
    }
  }

  const view = await getPetView(userId)
  if (!view.pet) throw new AppError('还没有宠物', 400)
  return {
    active: activeRow ? battleSummary(activeRow, participants) : null,
    incoming: incomingRows.map((row) => battleSummary(row, participants)),
    outgoing: outgoingRows.map((row) => battleSummary(row, participants)),
    history: historyRows.map((row) => battleSummary(row, participants)),
    record: { wins, losses, draws, total: wins + losses + draws },
    opponents: opponents
      .filter((pet) => pet.user.id !== userId)
      .map((pet) => ({
        userId: pet.user.id,
        username: pet.user.username,
        avatarVersion: pet.user.avatarVersion,
        species: pet.species,
        speciesName: speciesName(pet.species),
        petName: pet.name,
        level: pet.level,
        remainingToday: Math.max(0, PAIR_DAILY_LIMIT - countFor(pet.user.id)),
      })),
    stakeRule: { rate: STAKE_RATE, min: STAKE_MIN, max: STAKE_MAX },
  }
}

/** 后台清理：过期邀请、回合超时、掉线判负、卡住的结算 */
export async function processPetBattleTimeouts(now = Date.now()): Promise<number> {
  const nowDate = new Date(now)
  const expired = await prisma.petBattle.updateMany({
    where: { status: 'pending', expiresAt: { lt: nowDate } },
    data: { status: 'expired' },
  })
  // 进程在 claim 之后、事务提交之前退出会把对局留在 settling；超过 5 分钟回收重试
  const recovered = await prisma.petBattle.updateMany({
    where: { status: 'settling', updatedAt: { lt: new Date(now - 5 * 60_000) } },
    data: { status: 'active' },
  })
  const activeRows = await prisma.petBattle.findMany({
    where: { status: 'active' },
    orderBy: { id: 'asc' },
    take: 50,
  })
  let handled = expired.count + recovered.count
  for (const row of activeRows) {
    try {
      const state = parseState(row)
      if (!state) continue
      // 结算失败被回滚成 active 的终局：优先重试结算，避免卡死
      if (state.finished) {
        await settleBattle(row.id)
        handled += 1
        continue
      }
      if (row.turnDeadline && row.turnDeadline.getTime() < now) {
        await applyTimeoutRow(row)
        handled += 1
        continue
      }
      const challengerStale = row.challengerSeenAt
        && now - row.challengerSeenAt.getTime() > PRESENCE_TIMEOUT_MS
      const opponentStale = row.opponentSeenAt
        && now - row.opponentSeenAt.getTime() > PRESENCE_TIMEOUT_MS
      if (challengerStale && opponentStale) {
        await forfeitBattle(row.id, row.challengerId, '双方掉线')
        handled += 1
      } else if (challengerStale) {
        await forfeitBattle(row.id, row.challengerId, '掉线')
        handled += 1
      } else if (opponentStale) {
        await forfeitBattle(row.id, row.opponentId, '掉线')
        handled += 1
      }
    } catch (error) {
      // 单场失败不能拖垮整批：记录后继续处理下一条（下轮会重试）
      console.error(`[petBattle] 结算/超时处理失败 battle=${row.id}：`, error)
    }
  }
  return handled
}

let sweeperTimer: NodeJS.Timeout | null = null

/** 启动对战 sweeper（每 5 秒；unref，不阻止进程退出） */
export function startPetBattleSweeper(): void {
  if (sweeperTimer) return
  sweeperTimer = setInterval(() => {
    void processPetBattleTimeouts().catch((error) => {
      console.warn('[petBattle] sweeper 失败：', error)
    })
  }, SWEEPER_INTERVAL_MS)
  sweeperTimer.unref()
}

/** 停止 sweeper（shutdown 时调用） */
export function stopPetBattleSweeper(): void {
  if (sweeperTimer) {
    clearInterval(sweeperTimer)
    sweeperTimer = null
  }
}
