import prisma from '../lib/prisma.js'
import { config } from '../config/index.js'
import { emitRoomUpdate } from './chatMessaging.js'

/**
 * LineWeb 用户大群（自建聊天版，取代原 nekoBigGroup）
 *
 *   - 服务端首次启动时以「第一个 active 管理员」为群主创建 group 会话，名称可配置
 *   - 会话 id 写进 SiteSetting（chat.bigGroupConversationId）
 *   - 所有 active 用户自动入群；审核通过 / 拒绝 / 删除时增量同步
 *   - 启动 20 秒后对账一次，此后按周期（默认 10 分钟）对账
 *   - 群管理接口对本会话加锁：成员只能由本服务维护（isBigGroup 标记由此派生）
 *
 * 任何失败只告警：大群不可用不应阻塞站点启动或聊天主流程。
 */

export const BIG_GROUP_ROOM_KEY = 'chat.bigGroupConversationId'
export const BIG_GROUP_OWNER_KEY = 'chat.bigGroupOwnerId'

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
}

/** 当前绑定的大群会话 id（缓存 60 秒；0 / 缺失 = 尚未创建） */
export async function getBigGroupConversationId(): Promise<number | null> {
  if (!config.chatBigGroupEnabled) return null
  if (cachedRoomId !== undefined && Date.now() - cachedAt < 60_000) return cachedRoomId
  const id = Number(await readSetting(BIG_GROUP_ROOM_KEY))
  cachedRoomId = Number.isInteger(id) && id > 0 ? id : null
  cachedAt = Date.now()
  return cachedRoomId
}

/** 刷新缓存（创建 / 换绑后调用） */
function invalidateCache(): void {
  cachedRoomId = undefined
  cachedAt = 0
}

async function pickOwner(): Promise<{ id: number; username: string } | null> {
  const savedId = Number(await readSetting(BIG_GROUP_OWNER_KEY))
  if (Number.isInteger(savedId) && savedId > 0) {
    const saved = await prisma.user.findUnique({
      where: { id: savedId },
      select: { id: true, username: true, status: true },
    })
    if (saved && saved.status === 'active') return { id: saved.id, username: saved.username }
  }
  const owner = (await prisma.user.findFirst({
    where: { status: 'active', role: 'admin' },
    orderBy: { id: 'asc' },
    select: { id: true, username: true },
  })) ?? (await prisma.user.findFirst({
    where: { status: 'active' },
    orderBy: { id: 'asc' },
    select: { id: true, username: true },
  }))
  if (!owner) return null
  await writeSetting(BIG_GROUP_OWNER_KEY, String(owner.id))
  return owner
}

async function activeUserIds(): Promise<number[]> {
  const users = await prisma.user.findMany({
    where: { status: 'active' },
    orderBy: { id: 'asc' },
    select: { id: true },
  })
  return users.map((user) => user.id)
}

/** 创建（或复用）大群并对齐成员。返回会话 id；未启用 / 没有可用账号时返回 null。 */
async function syncBigGroup(): Promise<number | null> {
  if (!config.chatBigGroupEnabled) return null
  const owner = await pickOwner()
  if (!owner) {
    console.warn('[bigGroup] 没有可用的 active 账号，跳过 LineWeb 大群')
    return null
  }

  const savedId = Number(await readSetting(BIG_GROUP_ROOM_KEY))
  let conversation = Number.isInteger(savedId) && savedId > 0
    ? await prisma.conversation.findUnique({
        where: { id: savedId },
        select: { id: true, type: true, name: true, ownerId: true },
      })
    : null
  if (conversation && conversation.type !== 'group') conversation = null

  if (!conversation) {
    // 绑定丢失 / 会话被删：重新创建（群主 = 第一个 active 管理员）
    const created = await prisma.conversation.create({
      data: {
        type: 'group',
        name: config.chatBigGroupName,
        ownerId: owner.id,
        members: { create: [{ userId: owner.id, role: 'owner' }] },
      },
      select: { id: true },
    })
    await writeSetting(BIG_GROUP_ROOM_KEY, String(created.id))
    invalidateCache()
    conversation = { id: created.id, type: 'group', name: config.chatBigGroupName, ownerId: owner.id }
    console.log(`[bigGroup] 已创建 LineWeb 用户群 #${created.id}`)
  } else if (conversation.ownerId !== owner.id) {
    // 群主换绑（原群主被删等）：移交后补 owner 成员行
    await prisma.conversation.update({ where: { id: conversation.id }, data: { ownerId: owner.id } })
    await prisma.conversationMember.upsert({
      where: { conversationId_userId: { conversationId: conversation.id, userId: owner.id } },
      create: { conversationId: conversation.id, userId: owner.id, role: 'owner' },
      update: { role: 'owner' },
    })
  }

  const roomId = conversation.id
  const wanted = new Set(await activeUserIds())
  const current = await prisma.conversationMember.findMany({
    where: { conversationId: roomId },
    select: { userId: true, role: true },
  })

  const toAdd = [...wanted].filter((id) => !current.some((member) => member.userId === id))
  const toRemove = current
    .filter((member) => !wanted.has(member.userId) && member.role !== 'owner')
    .map((member) => member.userId)

  if (toAdd.length > 0) {
    try {
      await prisma.conversationMember.createMany({
        data: toAdd.map((id) => ({ conversationId: roomId, userId: id, role: 'member' })),
      })
      console.log(`[bigGroup] 已加入 ${toAdd.length} 位 LineWeb 用户`)
      await emitRoomUpdate(roomId).catch(() => {})
    } catch (err) {
      console.warn(`[bigGroup] 批量加人失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (toRemove.length > 0) {
    try {
      await prisma.conversationMember.deleteMany({
        where: { conversationId: roomId, userId: { in: toRemove } },
      })
      console.log(`[bigGroup] 已移出 ${toRemove.length} 位停用用户`)
    } catch (err) {
      console.warn(`[bigGroup] 批量移出失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return roomId
}

/** 幂等对账（并发调用合并为一次） */
export function ensureBigGroup(): Promise<number | null> {
  if (!config.chatBigGroupEnabled) return Promise.resolve(null)
  if (inflight) return inflight
  inflight = syncBigGroup()
    .catch((err) => {
      console.warn('[bigGroup] 同步失败：', err instanceof Error ? err.message : err)
      return null
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/**
 * 单个用户增量同步：审核通过时加入，拒绝 / 删除时移出。
 * 失败只告警；下一次启动对账或周期对账会自愈。
 */
export async function syncBigGroupMember(userId: number, join: boolean): Promise<void> {
  if (!config.chatBigGroupEnabled) return
  if (!Number.isInteger(userId) || userId <= 0) return
  try {
    let roomId = await getBigGroupConversationId()
    if (!roomId) {
      await ensureBigGroup()
      roomId = await getBigGroupConversationId()
      if (!roomId) return
    }
    if (join) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, status: true },
      })
      if (!user || user.status !== 'active') return
      await prisma.conversationMember.upsert({
        where: { conversationId_userId: { conversationId: roomId, userId } },
        create: { conversationId: roomId, userId, role: 'member' },
        update: {},
      })
      await emitRoomUpdate(roomId).catch(() => {})
    } else {
      const row = await prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId: roomId, userId } },
        select: { role: true },
      })
      if (row?.role === 'owner') return // 群主由对账维护
      await prisma.conversationMember.deleteMany({
        where: { conversationId: roomId, userId },
      })
      await emitRoomUpdate(roomId).catch(() => {})
    }
  } catch (err) {
    console.warn(
      `[bigGroup] ${join ? '加入' : '移出'}用户 #${userId} 失败：`,
      err instanceof Error ? err.message : err,
    )
  }
}

/** 启动（延迟 20 秒）+ 周期对账（默认 10 分钟） */
export function startBigGroupSync(delayMs = 20000): void {
  if (!config.chatBigGroupEnabled) return
  if (startupTimer || syncTimer) return
  startupTimer = setTimeout(() => {
    startupTimer = null
    void ensureBigGroup()
  }, delayMs)
  startupTimer.unref?.()
  syncTimer = setInterval(() => {
    void ensureBigGroup()
  }, config.chatBigGroupSyncIntervalMs)
  syncTimer.unref?.()
}

export function stopBigGroupSync(): void {
  if (startupTimer) {
    clearTimeout(startupTimer)
    startupTimer = null
  }
  if (syncTimer) {
    clearInterval(syncTimer)
    syncTimer = null
  }
}
