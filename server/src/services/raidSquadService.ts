/**
 * 搜打撤好友组队（内存队伍房间，2026-11-03）。
 *
 * 口径：
 *   - 复用站内既有好友关系（chatService.areFriends / listFriends）与 /ws/chat 推送（chatHub），
 *     不新增 Prisma 表：队伍名册、邀请、实时位置都放内存，服务重启即失效（与各联机游戏一致）；
 *   - 组队共享的是**世界**：同一 seed 的同一张地图、击杀、开门、开箱、被拿走的战利品全局唯一；
 *     血量 / 背包 / 装备 / 撤离结算仍每人独立（各自的 PetRaid 行），门票与保险各自扣；
 *   - 队友位置走 `POST /raid/events` 的 `me` 字段（纯表现、不落库）与 `raid:squad:state` 推送，
 *     无 WebSocket 时由 `GET /raid/squad/state` 轮询兜底。
 */

import prisma from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { areFriends, getUserBrief, listFriends } from './chatService.js'
import { isUserOnline, sendToUser } from './chatHub.js'
import { isUserBusyInOtherGames, registerGameModule } from './gameService.js'
import { getRaidMap, type RaidGroundStack } from '../lib/raidRun.js'

export const RAID_SQUAD_MAX_MEMBERS = 4
const INVITE_TTL_MS = 5 * 60_000
const LOBBY_IDLE_MS = 10 * 60_000
/** 出击后额外保留 3 分钟，让队友能看到彼此的结算状态 */
const MATCH_TAIL_MS = 3 * 60_000
const STATE_PUSH_MIN_MS = 900

export interface RaidSquadLive {
  x: number
  y: number
  angle: number
  roomId: number
  hp: number
  maxHp: number
  kills: number
  lootValue: number
}

interface SquadMember {
  userId: number
  /** 加入时取的用户名，用于世界事件广播里显示「谁打开了箱子」 */
  name: string
  host: boolean
  joinedAt: number
  lastSeenAt: number
  live: RaidSquadLive
}

export interface SquadRoom {
  id: string
  hostUserId: number
  mapKey: string
  status: 'lobby' | 'match'
  seed: number | null
  createdAt: number
  updatedAt: number
  /** match 模式的到期时刻（开局时按地图时长写入） */
  matchExpiresAt: number | null
  members: SquadMember[]
}

export interface SquadInvite {
  id: number
  fromUserId: number
  fromName: string
  toUserId: number
  squadId: string
  createdAt: number
}

const squads = new Map<string, SquadRoom>()
const invites = new Map<number, SquadInvite>()
let inviteSeq = 1
let squadSeq = 1
/** squadId → 上次 `raid:squad:state` 推送时刻（节流） */
const lastStatePush = new Map<string, number>()

/* ============================================================
   内部工具
   ============================================================ */

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function emptyLive(): RaidSquadLive {
  return { x: 0, y: 0, angle: 0, roomId: 0, hp: 0, maxHp: 0, kills: 0, lootValue: 0 }
}

export function findSquadOfUser(userId: number): SquadRoom | null {
  for (const squad of squads.values()) {
    if (squad.members.some((member) => member.userId === userId)) return squad
  }
  return null
}

export function getSquadById(squadId: string | null | undefined): SquadRoom | null {
  if (!squadId) return null
  return squads.get(squadId) ?? null
}

function ensureLobby(userId: number, name: string): SquadRoom {
  const existing = findSquadOfUser(userId)
  if (existing) return existing
  const now = Date.now()
  const squad: SquadRoom = {
    id: `squad-${now.toString(36)}-${(squadSeq += 1)}`,
    hostUserId: userId,
    mapKey: '',
    status: 'lobby',
    seed: null,
    createdAt: now,
    updatedAt: now,
    matchExpiresAt: null,
    members: [{ userId, name, host: true, joinedAt: now, lastSeenAt: now, live: emptyLive() }],
  }
  squads.set(squad.id, squad)
  return squad
}

function touch(squad: SquadRoom): void {
  squad.updatedAt = Date.now()
}

function notify(userIds: Iterable<number>, type: string, payload: Record<string, unknown>): void {
  for (const userId of new Set(userIds)) {
    sendToUser(userId, { type, ...payload })
  }
}

function notifySquad(squad: SquadRoom, type: string, payload: Record<string, unknown>): void {
  notify(squad.members.map((member) => member.userId), type, payload)
}

function rosterIds(squad: SquadRoom): number[] {
  return squad.members.map((member) => member.userId)
}

/** 该用户的 incoming / outgoing 邀请 */
function invitesFor(userId: number): { incoming: SquadInvite[]; outgoing: SquadInvite[] } {
  const incoming: SquadInvite[] = []
  const outgoing: SquadInvite[] = []
  for (const invite of invites.values()) {
    if (invite.toUserId === userId) incoming.push(invite)
    else if (invite.fromUserId === userId) outgoing.push(invite)
  }
  return { incoming, outgoing }
}

export function removeInvite(inviteId: number, reason: 'cancelled' | 'accepted' | 'rejected' | 'expired' = 'cancelled'): void {
  const invite = invites.get(inviteId)
  if (!invite) return
  invites.delete(inviteId)
  void reason
  notify([invite.fromUserId, invite.toUserId], 'raid:squad:invite:removed', { inviteId })
}

/* ============================================================
   DTO
   ============================================================ */

export interface RaidSquadMemberDto {
  userId: number
  name: string
  displayName: string
  petName: string
  species: string
  level: number
  host: boolean
  online: boolean
  hp: number
  maxHp: number
  roomId: number
  x: number
  y: number
  angle: number
  kills: number
  lootValue: number
  status: 'lobby' | 'active' | 'extracted' | 'died' | 'mia' | 'abandoned' | 'offline'
}

export interface RaidSquadDto {
  id: string
  hostUserId: number
  mapKey: string
  status: 'lobby' | 'match'
  seed: number | null
  maxMembers: number
  createdAt: string
  expiresAt: string
  members: RaidSquadMemberDto[]
}

interface UserPresentation {
  username: string
  displayName: string
  petName: string
  species: string
  level: number
}

/** 批量取用户展示信息（用户名 / 备注 / 宠物）与对局状态 */
async function loadPresentation(
  userIds: readonly number[],
  viewerId: number,
): Promise<Map<number, UserPresentation & { raidStatus: string }>> {
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return new Map()
  const [users, pets, remarks, raids] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true } }),
    prisma.pet.findMany({ where: { userId: { in: ids } }, select: { userId: true, name: true, species: true, level: true, status: true } }),
    // 备注只对「查看者」生效，队友看到的是对方自己的用户名
    prisma.chatContactSetting.findMany({ where: { ownerId: viewerId, targetUserId: { in: ids } }, select: { targetUserId: true, remark: true } }),
    prisma.petRaid.findMany({ where: { userId: { in: ids } }, select: { userId: true, status: true } }),
  ])
  const petByUser = new Map(pets.filter((pet) => pet.status === 'alive').map((pet) => [pet.userId, pet]))
  const remarkByUser = new Map(remarks.map((item) => [item.targetUserId, item.remark]))
  const raidByUser = new Map(raids.map((raid) => [raid.userId, raid.status]))
  const out = new Map<number, UserPresentation & { raidStatus: string }>()
  for (const user of users) {
    const pet = petByUser.get(user.id)
    out.set(user.id, {
      username: user.username,
      displayName: remarkByUser.get(user.id) || user.username,
      petName: pet?.name ?? '',
      species: pet?.species ?? '',
      level: pet?.level ?? 0,
      raidStatus: raidByUser.get(user.id) ?? 'none',
    })
  }
  return out
}

function memberExpiry(squad: SquadRoom): number {
  if (squad.status === 'match') return squad.matchExpiresAt ?? squad.updatedAt + MATCH_TAIL_MS
  return squad.updatedAt + LOBBY_IDLE_MS
}

export async function toSquadDto(squad: SquadRoom, viewerId: number): Promise<RaidSquadDto> {
  const info = await loadPresentation(rosterIds(squad), viewerId)
  const expiry = memberExpiry(squad)
  return {
    id: squad.id,
    hostUserId: squad.hostUserId,
    mapKey: squad.mapKey,
    status: squad.status,
    seed: squad.seed,
    maxMembers: RAID_SQUAD_MAX_MEMBERS,
    createdAt: iso(squad.createdAt),
    expiresAt: iso(expiry),
    members: squad.members.map((member) => {
      const profile = info.get(member.userId)
      const raidStatus = profile?.raidStatus ?? 'none'
      const status: RaidSquadMemberDto['status'] = squad.status === 'lobby'
        ? 'lobby'
        : raidStatus === 'active'
          ? 'active'
          : raidStatus === 'extracted' || raidStatus === 'died' || raidStatus === 'mia' || raidStatus === 'abandoned'
            ? raidStatus
            : 'lobby'
      return {
        userId: member.userId,
        name: profile?.username ?? `用户 ${member.userId}`,
        displayName: profile?.displayName ?? profile?.username ?? `用户 ${member.userId}`,
        petName: profile?.petName ?? '',
        species: profile?.species ?? '',
        level: profile?.level ?? 0,
        host: member.userId === squad.hostUserId,
        online: isUserOnline(member.userId),
        hp: member.live.hp,
        maxHp: member.live.maxHp,
        roomId: member.live.roomId,
        x: member.live.x,
        y: member.live.y,
        angle: member.live.angle,
        kills: member.live.kills,
        lootValue: member.live.lootValue,
        status,
      }
    }),
  }
}

/* ============================================================
   大厅视图
   ============================================================ */

export interface RaidSquadFriendDto {
  userId: number
  name: string
  displayName: string
  petName: string
  species: string
  level: number
  online: boolean
  inRaid: boolean
  inOtherGame: boolean
}

export interface RaidSquadViewDto {
  serverTime: string
  squad: RaidSquadDto | null
  friends: RaidSquadFriendDto[]
  incoming: { id: number; fromUserId: number; fromName: string; toUserId: number; squadId: string; createdAt: string }[]
  outgoing: { id: number; fromUserId: number; fromName: string; toUserId: number; squadId: string; createdAt: string }[]
}

export async function getSquadView(userId: number): Promise<RaidSquadViewDto> {
  const { incoming, outgoing } = invitesFor(userId)
  const squad = findSquadOfUser(userId)
  const { friends } = await listFriends(userId)
  const squadIds = new Set(squad ? rosterIds(squad) : [])
  const ids = [
    ...friends.map((friend) => friend.id),
    ...incoming.map((invite) => invite.fromUserId),
    ...squadIds,
  ]
  const info = await loadPresentation(ids, userId)
  const now = Date.now()
  const nameOf = (id: number): string => info.get(id)?.displayName ?? `用户 ${id}`
  return {
    serverTime: iso(now),
    squad: squad ? await toSquadDto(squad, userId) : null,
    friends: friends
      .map((friend) => {
        const profile = info.get(friend.id)
        return {
          userId: friend.id,
          name: profile?.username ?? `用户 ${friend.id}`,
          displayName: profile?.displayName ?? profile?.username ?? `用户 ${friend.id}`,
          petName: profile?.petName ?? '',
          species: profile?.species ?? '',
          level: profile?.level ?? 0,
          online: isUserOnline(friend.id),
          inRaid: profile?.raidStatus === 'active' || squadIds.has(friend.id),
          // 只查「其他游戏」：raid 自己的探针会把同队好友也算成忙，需在客户端按 inRaid 区分
          inOtherGame: isUserBusyInOtherGames(friend.id, 'raid'),
        }
      })
      .sort((a, b) => Number(b.online) - Number(a.online) || a.displayName.localeCompare(b.displayName)),
    incoming: incoming.map((invite) => ({
      id: invite.id,
      fromUserId: invite.fromUserId,
      fromName: nameOf(invite.fromUserId),
      toUserId: invite.toUserId,
      squadId: invite.squadId,
      createdAt: iso(invite.createdAt),
    })),
    outgoing: outgoing.map((invite) => ({
      id: invite.id,
      fromUserId: invite.fromUserId,
      fromName: invite.fromName,
      toUserId: invite.toUserId,
      squadId: invite.squadId,
      createdAt: iso(invite.createdAt),
    })),
  }
}

/** 战斗中的轻量轮询（无 WebSocket 时队友状态来源） */
export async function getSquadState(userId: number): Promise<{ serverTime: string; squad: RaidSquadDto | null }> {
  const squad = findSquadOfUser(userId)
  return {
    serverTime: iso(Date.now()),
    squad: squad ? await toSquadDto(squad, userId) : null,
  }
}

/* ============================================================
   邀请 / 名册
   ============================================================ */

export async function inviteToSquad(userId: number, targetUserId: number): Promise<RaidSquadDto> {
  if (userId === targetUserId) throw new AppError('不能邀请自己', 400)
  if (!(await areFriends(userId, targetUserId))) throw new AppError('只能邀请好友组队', 403)

  const targetSquad = findSquadOfUser(targetUserId)
  if (targetSquad) throw new AppError('对方已经在别的队伍里了', 409, 'SQUAD_TAKEN')
  const targetRaid = await prisma.petRaid.findUnique({ where: { userId: targetUserId }, select: { status: true } })
  if (targetRaid?.status === 'active') throw new AppError('对方正在行动中，等TA先撤离', 409, 'SQUAD_TARGET_BUSY')
  if (isUserBusyInOtherGames(targetUserId, 'raid')) throw new AppError('对方正在其他游戏对局中', 409, 'SQUAD_TARGET_BUSY')

  const squad = ensureLobby(userId, (await getUserBrief(userId)).username)
  touch(squad)
  if (squad.members.length >= RAID_SQUAD_MAX_MEMBERS) throw new AppError('队伍已满', 409, 'SQUAD_FULL')

  const invite: SquadInvite = {
    id: inviteSeq,
    fromUserId: userId,
    fromName: squad.members.find((member) => member.userId === userId)?.name ?? `用户 ${userId}`,
    toUserId: targetUserId,
    squadId: squad.id,
    createdAt: Date.now(),
  }
  inviteSeq += 1
  invites.set(invite.id, invite)
  sendToUser(targetUserId, { type: 'raid:squad:invite', invite })
  return toSquadDto(squad, userId)
}

export async function respondToInvite(userId: number, inviteId: number, accept: boolean): Promise<RaidSquadDto | null> {
  const invite = invites.get(inviteId)
  if (!invite || invite.toUserId !== userId) throw new AppError('邀请不存在', 404)
  removeInvite(inviteId, accept ? 'accepted' : 'rejected')
  if (!accept) {
    notify([invite.fromUserId], 'raid:squad:update', { squad: await squadSnapshotOrNull(invite.squadId, invite.fromUserId) })
    return null
  }
  if (findSquadOfUser(userId)) throw new AppError('你已经在一个队伍里了', 409, 'SQUAD_ALREADY')
  const squad = squads.get(invite.squadId)
  if (!squad || squad.status !== 'lobby') throw new AppError('队伍已解散或已出击', 410, 'SQUAD_GONE')
  if (squad.members.length >= RAID_SQUAD_MAX_MEMBERS) throw new AppError('队伍已满', 409, 'SQUAD_FULL')
  const raid = await prisma.petRaid.findUnique({ where: { userId }, select: { status: true } })
  if (raid?.status === 'active') throw new AppError('你正在行动中，先撤离或放弃再加入队伍', 409, 'RAID_ACTIVE')

  squad.members.push({
    userId,
    name: (await getUserBrief(userId)).username,
    host: false,
    joinedAt: Date.now(),
    lastSeenAt: Date.now(),
    live: emptyLive(),
  })
  touch(squad)
  notifySquad(squad, 'raid:squad:update', { squad: await toSquadDto(squad, userId) })
  return toSquadDto(squad, userId)
}

async function squadSnapshotOrNull(squadId: string, viewerId: number): Promise<RaidSquadDto | null> {
  const squad = squads.get(squadId)
  return squad ? toSquadDto(squad, viewerId) : null
}

export function cancelInvite(userId: number, inviteId: number): void {
  const invite = invites.get(inviteId)
  if (!invite || invite.fromUserId !== userId) throw new AppError('邀请不存在', 404)
  removeInvite(inviteId, 'cancelled')
}

export async function leaveSquad(userId: number): Promise<RaidSquadDto | null> {
  const squad = findSquadOfUser(userId)
  if (!squad) return null
  const isHost = squad.hostUserId === userId
  if (isHost) {
    notifySquad(squad, 'raid:squad:update', { squad: null })
    squads.delete(squad.id)
    for (const invite of [...invites.values()]) {
      if (invite.squadId === squad.id) invites.delete(invite.id)
    }
    return null
  }
  squad.members = squad.members.filter((member) => member.userId !== userId)
  touch(squad)
  if (squad.members.length === 0) {
    squads.delete(squad.id)
    return null
  }
  // 战斗中退出不影响别人：只是自己那局继续走自己的结算
  notifySquad(squad, 'raid:squad:update', { squad: await toSquadDto(squad, squad.hostUserId) })
  return toSquadDto(squad, userId)
}

export async function kickMember(userId: number, targetUserId: number): Promise<RaidSquadDto> {
  const squad = findSquadOfUser(userId)
  if (!squad || squad.hostUserId !== userId) throw new AppError('只有房主可以移出成员', 403)
  if (squad.status !== 'lobby') throw new AppError('出击后不能再调整队伍', 409, 'SQUAD_STARTED')
  const member = squad.members.find((item) => item.userId === targetUserId)
  if (!member) throw new AppError('对方不在你的队伍里', 404)
  squad.members = squad.members.filter((item) => item.userId !== targetUserId)
  touch(squad)
  notifySquad(squad, 'raid:squad:update', { squad: await toSquadDto(squad, userId) })
  sendToUser(targetUserId, { type: 'raid:squad:update', squad: null })
  return toSquadDto(squad, userId)
}

/** 出击前的名册校验（房主 + 至少 2 人 + 未出击） */
export function assertCanStart(userId: number, mapKey: string): SquadRoom {
  const squad = findSquadOfUser(userId)
  if (!squad || squad.hostUserId !== userId) throw new AppError('只有房主可以发起出击', 403)
  if (squad.status !== 'lobby') throw new AppError('本队已经出击了', 409, 'SQUAD_STARTED')
  if (squad.members.length < 2) throw new AppError('至少 2 人才能组队出击', 400)
  if (!getRaidMap(mapKey)) throw new AppError('地图不存在', 404)
  return squad
}

export function markSquadStarted(squad: SquadRoom, mapKey: string, seed: number, durationMs: number): void {
  squad.mapKey = mapKey
  squad.seed = seed
  squad.status = 'match'
  squad.matchExpiresAt = Date.now() + durationMs + MATCH_TAIL_MS
  touch(squad)
  for (const member of squad.members) member.lastSeenAt = Date.now()
}

/** 出击时把没能开局的人（积分不足 / 没有宠物）移出队伍，避免他们卡在观战位 */
export function dropMembers(squad: SquadRoom, keepUserIds: readonly number[]): number[] {
  const keep = new Set(keepUserIds)
  const removed = squad.members.filter((member) => !keep.has(member.userId)).map((member) => member.userId)
  squad.members = squad.members.filter((member) => keep.has(member.userId))
  touch(squad)
  for (const userId of removed) sendToUser(userId, { type: 'raid:squad:update', squad: null })
  return removed
}

/** 全队进入对局：广播 started，让各端按同一 seed 进入战斗 */
export async function announceStarted(squad: SquadRoom): Promise<RaidSquadDto> {
  const dto = await toSquadDto(squad, squad.hostUserId)
  notifySquad(squad, 'raid:squad:started', { squad: dto })
  return dto
}

/* ============================================================
   实时状态（对局中）
   ============================================================ */

export function updateMemberLive(squadId: string, userId: number, live: Partial<RaidSquadLive>): void {
  const squad = squads.get(squadId)
  if (!squad) return
  const member = squad.members.find((item) => item.userId === userId)
  if (!member) return
  member.lastSeenAt = Date.now()
  member.live = { ...member.live, ...live }
}

export function getSquadMateIds(squadId: string, excludeUserId: number): number[] {
  const squad = squads.get(squadId)
  if (!squad) return []
  return squad.members.map((member) => member.userId).filter((id) => id !== excludeUserId)
}

/** 世界增量：击杀 / 开门 / 被拿走的战利品（同一 seed 的地图，id 全局唯一） */
export interface RaidWorldDelta {
  killedEnemies: string[]
  openedContainers: string[]
  takenLoot: string[]
  clearedRooms: number[]
  /** 队友丢到地上的物品（合并端按 id 去重） */
  groundDropped: RaidGroundStack[]
  /** 队友从地上捡走的物品 id */
  groundTaken: string[]
}

/** 队友造成的世界变化立刻推给全队（客户端据此免等下一次批处理） */
export function broadcastWorld(squadId: string, byUserId: number, delta: RaidWorldDelta): void {
  const squad = squads.get(squadId)
  if (!squad) return
  touch(squad)
  const byName = squad.members.find((member) => member.userId === byUserId)?.name ?? `用户 ${byUserId}`
  notify(
    squad.members.filter((member) => member.userId !== byUserId).map((member) => member.userId),
    'raid:squad:world',
    { squadId, byUserId, byName, ...delta },
  )
}

/** 位置与血量推送（节流，避免 1.5s 批处理叠加成刷屏） */
export async function pushSquadState(squadId: string): Promise<void> {
  const squad = squads.get(squadId)
  if (!squad) return
  const now = Date.now()
  const last = lastStatePush.get(squadId) ?? 0
  if (now - last < STATE_PUSH_MIN_MS) return
  lastStatePush.set(squadId, now)
  for (const member of squad.members) {
    sendToUser(member.userId, { type: 'raid:squad:state', squad: await toSquadDto(squad, member.userId) })
  }
}

/** 成员行动结束（撤离 / 阵亡 / 失联 / 放弃）：最后一个活口没了就安排回收 */
export function notifyMemberSettled(squadId: string): void {
  const squad = squads.get(squadId)
  if (!squad || squad.status !== 'match') return
  lastStatePush.delete(squadId)
  squad.matchExpiresAt = Math.min(squad.matchExpiresAt ?? Date.now() + MATCH_TAIL_MS, Date.now() + 90_000)
}

/* ============================================================
   清扫（注册进游戏 sweeper，每 15 秒一轮）
   ============================================================ */

export function raidSquadInUse(userId: number): boolean {
  return findSquadOfUser(userId) !== null
}

export function sweepRaidSquads(now: number): void {
  for (const invite of [...invites.values()]) {
    if (now - invite.createdAt > INVITE_TTL_MS) removeInvite(invite.id, 'expired')
  }
  for (const squad of [...squads.values()]) {
    if (squad.members.length === 0) {
      squads.delete(squad.id)
      continue
    }
    if (now <= memberExpiry(squad)) continue
    notifySquad(squad, 'raid:squad:update', { squad: null })
    squads.delete(squad.id)
    lastStatePush.delete(squad.id)
  }
}

registerGameModule({
  name: 'raid',
  isUserInMatch: raidSquadInUse,
  sweep: sweepRaidSquads,
})
