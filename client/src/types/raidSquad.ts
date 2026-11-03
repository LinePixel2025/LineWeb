/**
 * 好友组队搜打撤的客户端 DTO（与服务端 raidSquadService.ts 对齐）。
 */

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
}

export interface RaidSquadStartResult {
  squad: RaidSquad
  failed: { userId: number; name: string; reason: string }[]
}
