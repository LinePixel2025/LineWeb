import prisma from '../lib/prisma.js'
import { config } from '../config/index.js'
import {
  callBrowserApi,
  ensureAccount,
  fetchState,
  isNekoChatEnabled,
  linewebIdOf,
  toNekoId,
  type LineWebUserLike,
  type NekoStateRoom,
} from './nekoChat.js'
import { ensureNekoAccounts } from './nekoAccountSync.js'

/**
 * LineWeb 用户大群（neko 上的普通群聊，只含 `lw_*` 账号）
 *
 * neko 自带的「全员大厅」包含所有平台的账号；本项目再维护一个只有 LineWeb 用户的大群：
 *   - 房间由服务端首次启动时以「第一个 LineWeb 管理员」身份创建，名称可配置
 *   - 房间 id 写进 SiteSetting（neko 自增分配，无法预置）
 *   - 所有 active 用户自动入群；审核通过 / 拒绝时增量同步；启动与每 10 分钟对账一次
 *   - 群主是创建时的管理员账号（LineWeb 管理员代理请求带 x-proxy-admin=1，
 *     因此还能维护「全员大厅」的公告）
 *
 * 任何失败只告警：大群不可用不应阻塞站点启动或聊天主流程。
 */

const ROOM_SETTING_KEY = 'neko.linewebGroupRoomId'
const OWNER_SETTING_KEY = 'neko.linewebGroupOwnerId'
/** neko 加人接口没有硬上限，但一次塞几百个 id 的 DTO 太大，按批同步 */
const MEMBER_BATCH = 60

let cachedRoomId: number | null | undefined
let cachedAt = 0
let inflight: Promise<number | null> | null = null
let startupTimer: ReturnType<typeof setTimeout> | null = null
let syncTimer: ReturnType<typeof setInterval> | null = null

async function readSetting(key: string): Promise<string> {
  const row = await prisma.siteSetting.findUnique({ where: { key } })
  return row?.value ?? ''
}

async function writeSetting(key: string, value: string): Promise<void> {
  await prisma.siteSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  })
  if (key === ROOM_SETTING_KEY) {
    cachedRoomId = Number(value) > 0 ? Number(value) : null
    cachedAt = Date.now()
  }
}

/** 当前绑定的 LineWeb 大群房间 id（缓存 60 秒；0 / 缺失 = 尚未创建） */
export async function getLineWebBigGroupId(): Promise<number | null> {
  if (!config.nekoLinewebGroupEnabled || !isNekoChatEnabled()) return null
  if (cachedRoomId !== undefined && Date.now() - cachedAt < 60_000) return cachedRoomId
  const raw = await readSetting(ROOM_SETTING_KEY)
  const id = Number(raw)
  cachedRoomId = Number.isInteger(id) && id > 0 ? id : null
  cachedAt = Date.now()
  return cachedRoomId
}

async function pickOwner(): Promise<LineWebUserLike | null> {
  const savedId = Number(await readSetting(OWNER_SETTING_KEY))
  if (Number.isInteger(savedId) && savedId > 0) {
    const saved = await prisma.user.findUnique({
      where: { id: savedId },
      select: { id: true, username: true, role: true, status: true },
    })
    if (saved && saved.status === 'active') {
      return { id: saved.id, username: saved.username, isAdmin: saved.role === 'admin' }
    }
  }
  const owner = await prisma.user.findFirst({
    where: { status: 'active', role: 'admin' },
    orderBy: { id: 'asc' },
    select: { id: true, username: true, role: true },
  }) ?? await prisma.user.findFirst({
    where: { status: 'active' },
    orderBy: { id: 'asc' },
    select: { id: true, username: true, role: true },
  })
  if (!owner) return null
  await writeSetting(OWNER_SETTING_KEY, String(owner.id))
  return { id: owner.id, username: owner.username, isAdmin: owner.role === 'admin' }
}

async function activeUserIds(): Promise<number[]> {
  const users = await prisma.user.findMany({
    where: { status: 'active' },
    orderBy: { id: 'asc' },
    select: { id: true },
  })
  return users.map((user) => user.id)
}

function findGroupRoom(stateRooms: NekoStateRoom[], roomId?: number | null): NekoStateRoom | null {
  if (roomId && Number(roomId) > 0) {
    const byId = stateRooms.find((room) => room.id === Number(roomId) && !room.isLobby)
    if (byId) return byId
  }
  return stateRooms.find((room) => !room.isLobby && room.name === config.nekoLinewebGroupName) ?? null
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

async function addMembers(roomId: number, owner: LineWebUserLike, ids: number[]): Promise<void> {
  for (const batch of chunk(ids, MEMBER_BATCH)) {
    if (batch.length === 0) continue
    await callBrowserApi('POST', `/chat/rooms/${roomId}/members`, {
      user: owner,
      body: { addIds: batch },
      timeoutMs: 20000,
    })
  }
}

async function removeMembers(roomId: number, owner: LineWebUserLike, ids: number[]): Promise<void> {
  for (const batch of chunk(ids, MEMBER_BATCH)) {
    if (batch.length === 0) continue
    await callBrowserApi('POST', `/chat/rooms/${roomId}/members`, {
      user: owner,
      body: { removeIds: batch },
      timeoutMs: 20000,
    })
  }
}

/**
 * 创建（或复用）大群并对齐成员。返回房间 id；聊天未启用 / 没有可用账号时返回 null。
 */
async function syncBigGroup(): Promise<number | null> {
  if (!config.nekoLinewebGroupEnabled || !isNekoChatEnabled()) return null
  const owner = await pickOwner()
  if (!owner) {
    console.warn('[nekoBigGroup] 没有可用的 active 账号，跳过 LineWeb 大群')
    return null
  }
  await ensureAccount(owner)
  let state = await fetchState(owner)
  let room = findGroupRoom(state.rooms, await getLineWebBigGroupId())
  if (!room) {
    // 绑定丢失 / 房间被解散：重新创建（以第一个管理员身份）
    const created = await callBrowserApi<{ ok: boolean; roomId: number }>('POST', '/chat/rooms', {
      user: owner,
      body: { name: config.nekoLinewebGroupName },
      timeoutMs: 15000,
    })
    if (!created?.roomId) throw new Error('创建 LineWeb 大群失败')
    await writeSetting(ROOM_SETTING_KEY, String(created.roomId))
    state = await fetchState(owner)
    room = findGroupRoom(state.rooms, created.roomId)
    if (!room) throw new Error('LineWeb 大群创建后不可见')
    console.log(`[nekoBigGroup] 已创建 LineWeb 用户群 #${room.id}`)
  } else if ((await getLineWebBigGroupId()) !== room.id) {
    await writeSetting(ROOM_SETTING_KEY, String(room.id))
  }

  const roomId = room.id
  const wanted = new Set(await activeUserIds())
  const currentLineweb = new Map<number, number>() // nekoId → linewebId
  const foreignMembers: number[] = []
  for (const member of room.members) {
    const linewebId = linewebIdOf(member.id)
    if (linewebId !== null) currentLineweb.set(member.id, linewebId)
    // 「只有 LineWeb 用户」：原生 neko / 其他平台账号即使被拉进来也移出
    else foreignMembers.push(member.id)
  }
  const toAdd = [...wanted]
    .filter((id) => !currentLineweb.has(toNekoId(id)) && id !== owner.id)
    .map(toNekoId)
  const toRemove = [
    ...[...currentLineweb.values()].filter((id) => !wanted.has(id)).map(toNekoId),
    ...foreignMembers,
  ]

  if (toAdd.length > 0) {
    try {
      // 新账号可能还没在 neko 侧创建（例如首次启动的下一轮同步）：先补建再拉群
      await ensureNekoAccounts(
        toAdd.map((id) => linewebIdOf(id)).filter((id): id is number => id !== null),
      )
      await addMembers(roomId, owner, toAdd)
      console.log(`[nekoBigGroup] 已加入 ${toAdd.length} 位 LineWeb 用户`)
    } catch (err) {
      console.warn(`[nekoBigGroup] 批量加人失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (toRemove.length > 0) {
    try {
      await removeMembers(roomId, owner, toRemove)
      console.log(`[nekoBigGroup] 已移出 ${toRemove.length} 位停用用户`)
    } catch (err) {
      console.warn(`[nekoBigGroup] 批量移出失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return roomId
}

/** 幂等对账（并发调用合并为一次） */
export function ensureLineWebBigGroup(): Promise<number | null> {
  if (!config.nekoLinewebGroupEnabled || !isNekoChatEnabled()) return Promise.resolve(null)
  if (inflight) return inflight
  inflight = syncBigGroup()
    .catch((err) => {
      console.warn('[nekoBigGroup] 同步失败：', err instanceof Error ? err.message : err)
      return null
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/**
 * 单个用户增量同步：审核通过时加入，拒绝 / 删除时移出。
 * 失败只告警；下一次启动对账或 10 分钟周期会自愈。
 */
export async function syncLineWebBigGroupMember(
  userId: number,
  join: boolean,
): Promise<void> {
  if (!config.nekoLinewebGroupEnabled || !isNekoChatEnabled()) return
  if (!Number.isInteger(userId) || userId <= 0) return
  try {
    const owner = await pickOwner()
    if (!owner) return
    const roomId = await getLineWebBigGroupId()
    if (!roomId) {
      // 大群还没建：直接走全量对账（会创建并把当前所有 active 用户拉进去）
      await ensureLineWebBigGroup()
      return
    }
    await ensureAccount(owner)
    if (join) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, status: true },
      })
      if (!user || user.status !== 'active') return
      await ensureAccount(user)
      await addMembers(roomId, owner, [toNekoId(userId)])
    } else {
      await removeMembers(roomId, owner, [toNekoId(userId)])
    }
  } catch (err) {
    console.warn(
      `[nekoBigGroup] ${join ? '加入' : '移出'}用户 #${userId} 失败：`,
      err instanceof Error ? err.message : err,
    )
  }
}

/** 启动（延迟 20 秒，等账号全量同步先跑完）+ 周期对账（默认 10 分钟） */
export function startLineWebBigGroupSync(delayMs = 20000): void {
  if (!config.nekoLinewebGroupEnabled || !isNekoChatEnabled()) return
  if (startupTimer || syncTimer) return
  startupTimer = setTimeout(() => {
    startupTimer = null
    void ensureLineWebBigGroup()
  }, delayMs)
  startupTimer.unref?.()
  syncTimer = setInterval(() => {
    void ensureLineWebBigGroup()
  }, config.nekoLinewebGroupSyncIntervalMs)
  syncTimer.unref?.()
}

export function stopLineWebBigGroupSync(): void {
  if (startupTimer) {
    clearTimeout(startupTimer)
    startupTimer = null
  }
  if (syncTimer) {
    clearInterval(syncTimer)
    syncTimer = null
  }
}
