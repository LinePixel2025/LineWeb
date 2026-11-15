/**
 * 好友组队搜打撤的客户端 DTO（与服务端 raidSquadService.ts 对齐）。
 */

import type { RaidGroundStack } from '../lib/raid/raidRun'

export type RaidSquadMemberStatus =
  | 'lobby'
  | 'active'
  | 'extracted'
  | 'died'
  | 'mia'
  | 'abandoned'
  | 'offline'

export interface RaidSquadMember {
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
  status: RaidSquadMemberStatus
}

export interface RaidSquad {
  id: string
  hostUserId: number
  mapKey: string
  status: 'lobby' | 'match'
  seed: number | null
  maxMembers: number
  createdAt: string
  expiresAt: string
  members: RaidSquadMember[]
}

export interface RaidSquadInvite {
  id: number
  fromUserId: number
  fromName: string
  toUserId: number
  squadId: string
  createdAt: string
  /** 统一邀请桥的过期时间（旧服务端可能不返回） */
  expiresAt?: string
}

export interface RaidSquadFriend {
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

export interface RaidSquadView {
  serverTime: string
  squad: RaidSquad | null
  friends: RaidSquadFriend[]
  incoming: RaidSquadInvite[]
  outgoing: RaidSquadInvite[]
}

/** 服务端 raid:squad:world 推送的世界增量 */
export interface RaidSquadWorldDelta {
  squadId: string
  byUserId: number
  byName: string
  killedEnemies: string[]
  openedContainers: string[]
  takenLoot: string[]
  /** 队友丢到地上的物品（2026-11 新增，按 id 去重合并） */
  groundDropped?: RaidGroundStack[]
  /** 队友从地上捡走的物品 id */
  groundTaken?: string[]
}

export interface RaidSquadStartResult {
  squad: RaidSquad
  failed: { userId: number; name: string; reason: string }[]
}
