import prisma from '../lib/prisma.js'
import {
  CHAT_DOMAIN,
  CHAT_HISTORY_LIMIT,
  CHAT_MUC_DOMAIN,
  toNekoId,
  toNekoUsername,
} from '../lib/chatIdentity.js'
import { isUserChatOnline } from './chatSessions.js'
import { getTitleMapForLineWebIds } from './pointsService.js'

/**
 * 聊天页状态出口口径（原 nekoChatView 的 Prisma-only 版本）
 *
 * 聊天自建后只有 LineWeb 用户：
 *   - 联系人 = Prisma 好友 ∪ 有 direct 会话往来的用户（备注来自 ChatContactSetting）
 *   - 群 = group 会话成员行（isBigGroup 按「会话 id === 大群 id」派生）
 *   - 好友申请只有 lineweb 一种来源
 *   - 全员大厅（isLobby）已随 neko 移除，永不下发
 */

export interface ChatTitleView {
  id: number
  name: string
  color: string
  icon: string
}

export interface ChatContactView {
  key: string
  nekoId: number
  linewebId: number | null
  username: string
  displayName: string
  kind: 'lineweb'
  online: boolean
  lastMessageAt: number
  isFriend: boolean
  remark: string
  avatarVersion: number
  title: ChatTitleView | null
}

export interface ChatRoomMemberView {
  nekoId: number
  linewebId: number | null
  username: string
  displayName: string
  role: string
  online: boolean
  kind: 'lineweb'
  avatarVersion: number
  title: ChatTitleView | null
}

export interface ChatRoomView {
  key: string
  id: number
  name: string
  ownerId: number
  myRole: string
  allMuted: boolean
  announcement: string
  announcementUpdatedAt: number
  announcementAckRequired: boolean
  announcementConfirmedAt: number
  notifyMuted: boolean
  lastMessageAt: number
  isBigGroup: boolean
  members: ChatRoomMemberView[]
}

export interface ChatRequestView {
  id: number
  source: 'lineweb'
  linewebId: number | null
  nekoId: number
  username: string
  displayName: string
  createdAt: string
  avatarVersion: number
}

export interface ChatStickerView {
  id: number
  url: string
  mime: string
}

export interface ChatBootstrapView {
  domain: string
  mucDomain: string
  historyLimit: number
  self: {
    nekoId: number
    linewebId: number
    username: string
    displayName: string
    title: ChatTitleView | null
  }
  friends: ChatContactView[]
  contacts: ChatContactView[]
  requestsIn: ChatRequestView[]
  requestsOut: ChatRequestView[]
  stickers: ChatStickerView[]
  rooms: ChatRoomView[]
  pinnedChats: string[]
}

export interface DirectoryUserView {
  nekoId: number
  linewebId: number | null
  username: string
  displayName: string
  isLineWeb: boolean
  online: boolean
  lastMessageAt: number
  avatarVersion: number
  title: ChatTitleView | null
}

function isoStamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value || Date.now()).toISOString()
}

function msStamp(value: Date | null | undefined): number {
  return value ? value.getTime() : 0
}

/** 组装当前用户的完整聊天状态（好友 + 会话 + 群 + 申请 + 表情 + 置顶） */
export async function buildChatView(me: {
  id: number
  username: string
}): Promise<ChatBootstrapView> {
  const [friendRows, membershipRows, remarkRows, requestRows, stickerRows] = await Promise.all([
    prisma.friendship.findMany({
      where: { userId: me.id },
      select: {
        friend: { select: { id: true, username: true, status: true, avatarVersion: true } },
      },
    }),
    prisma.conversationMember.findMany({
      where: { userId: me.id },
      select: {
        role: true,
        notifyMuted: true,
        pinned: true,
        announcementConfirmedAt: true,
        conversation: {
          select: {
            id: true,
            type: true,
            name: true,
            ownerId: true,
            allMuted: true,
            announcementText: true,
            announcementUpdatedAt: true,
            announcementAckRequired: true,
            lastMessageAt: true,
            members: {
              select: {
                userId: true,
                role: true,
                user: { select: { id: true, username: true, status: true, avatarVersion: true } },
              },
            },
          },
        },
      },
    }),
    prisma.chatContactSetting.findMany({
      where: { ownerId: me.id },
      select: { targetUserId: true, remark: true },
    }),
    prisma.friendRequest.findMany({
      where: {
        OR: [{ toUserId: me.id }, { fromUserId: me.id }],
        status: 'pending',
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        fromUserId: true,
        toUserId: true,
        createdAt: true,
        fromUser: { select: { id: true, username: true } },
        toUser: { select: { id: true, username: true } },
      },
    }),
    prisma.chatSticker.findMany({
      where: { userId: me.id },
      orderBy: { id: 'asc' },
      select: { id: true, uploadId: true, mime: true },
    }),
  ])

  const remarkByUserId = new Map(remarkRows.map((row) => [row.targetUserId, row.remark]))
  const onlineOf = (userId: number): boolean => isUserChatOnline(userId)

  // === 联系人：好友 ∪ 有 direct 会话往来的用户 ===
  const contactsByLinewebId = new Map<number, ChatContactView>()
  // ⚠️ 协议契约：contact.username 必须是聊天用户名 `lw_<id>`（前端拼 JID、匹配 mine、
  // 解析 headline 都靠它）；displayName 才是 LineWeb 用户名（展示用）。
  const makeContact = (
    linewebId: number,
    displayName: string,
    avatarVersion: number,
    isFriend: boolean,
    lastMessageAt: number,
  ): ChatContactView => ({
    key: `u${toNekoId(linewebId)}`,
    nekoId: toNekoId(linewebId),
    linewebId,
    username: toNekoUsername(linewebId),
    displayName,
    kind: 'lineweb',
    online: onlineOf(linewebId),
    lastMessageAt,
    isFriend,
    remark: remarkByUserId.get(linewebId) ?? '',
    avatarVersion,
    title: null,
  })

  for (const row of friendRows) {
    if (row.friend.id === me.id) continue
    if (row.friend.status !== 'active') continue
    contactsByLinewebId.set(
      row.friend.id,
      makeContact(row.friend.id, row.friend.username, row.friend.avatarVersion, true, 0),
    )
  }

  const directConversations = membershipRows.filter(
    (row) => row.conversation.type === 'direct',
  )
  for (const membership of directConversations) {
    const other = membership.conversation.members.find((member) => member.userId !== me.id)
    if (!other || other.user.id === me.id) continue
    const lastMessageAt = msStamp(membership.conversation.lastMessageAt)
    const existing = contactsByLinewebId.get(other.user.id)
    if (existing) {
      existing.lastMessageAt = Math.max(existing.lastMessageAt, lastMessageAt)
    } else if (other.user.status === 'active') {
      contactsByLinewebId.set(
        other.user.id,
        makeContact(other.user.id, other.user.username, other.user.avatarVersion, false, lastMessageAt),
      )
    }
  }

  const contacts = [...contactsByLinewebId.values()].sort((a, b) => {
    if (a.isFriend !== b.isFriend) return a.isFriend ? -1 : 1
    return b.lastMessageAt - a.lastMessageAt
  })
  const friends = contacts.filter((contact) => contact.isFriend)

  // === 群会话 ===
  const groupConversations = membershipRows.filter(
    (row) => row.conversation.type === 'group',
  )
  const groupIds = groupConversations.map((row) => row.conversation.id)
  const bigGroupId = groupIds.length > 0 ? await getBigGroupIdForUser() : null

  const rooms: ChatRoomView[] = groupConversations.map((membership) => {
    const conversation = membership.conversation
    const members = conversation.members
      .filter((member) => member.user.status === 'active' || member.userId === me.id)
      .map<ChatRoomMemberView>((member) => ({
        nekoId: toNekoId(member.userId),
        linewebId: member.userId,
        username: toNekoUsername(member.userId),
        displayName: member.user.username,
        role: member.role,
        online: onlineOf(member.userId),
        kind: 'lineweb',
        avatarVersion: member.user.avatarVersion,
        title: null,
      }))
    return {
      key: `r${conversation.id}`,
      id: conversation.id,
      name: conversation.name || '群聊',
      ownerId: toNekoId(conversation.ownerId ?? 0),
      myRole: membership.role,
      allMuted: conversation.allMuted,
      announcement: conversation.announcementText ?? '',
      announcementUpdatedAt: msStamp(conversation.announcementUpdatedAt),
      announcementAckRequired: conversation.announcementAckRequired,
      announcementConfirmedAt: msStamp(membership.announcementConfirmedAt),
      notifyMuted: membership.notifyMuted,
      lastMessageAt: msStamp(conversation.lastMessageAt),
      isBigGroup: bigGroupId !== null && conversation.id === bigGroupId,
      members,
    }
  })

  // === 好友申请（仅 lineweb 来源） ===
  const requestsIn: ChatRequestView[] = requestRows
    .filter((row) => row.toUserId === me.id)
    .map((row) => ({
      id: row.id,
      source: 'lineweb' as const,
      linewebId: row.fromUser.id,
      nekoId: toNekoId(row.fromUser.id),
      username: toNekoUsername(row.fromUser.id),
      displayName: row.fromUser.username,
      createdAt: isoStamp(row.createdAt),
      avatarVersion: 0,
    }))
  const requestsOut: ChatRequestView[] = requestRows
    .filter((row) => row.fromUserId === me.id)
    .map((row) => ({
      id: row.id,
      source: 'lineweb' as const,
      linewebId: row.toUser.id,
      nekoId: toNekoId(row.toUser.id),
      username: toNekoUsername(row.toUser.id),
      displayName: row.toUser.username,
      createdAt: isoStamp(row.createdAt),
      avatarVersion: 0,
    }))

  // === 置顶 ===
  const validKeys = new Set<string>([...contacts.map((contact) => contact.key), ...rooms.map((room) => room.key)])
  const pinnedChats: string[] = []
  for (const membership of membershipRows) {
    if (!membership.pinned) continue
    if (membership.conversation.type === 'direct') {
      const otherId = membership.conversation.members.find((member) => member.userId !== me.id)?.userId ?? 0
      if (otherId > 0) {
        const key = `u${toNekoId(otherId)}`
        if (validKeys.has(key)) pinnedChats.push(key)
      }
    } else {
      const key = `r${membership.conversation.id}`
      if (validKeys.has(key)) pinnedChats.push(key)
    }
  }

  // === 称号（纯站内展示，一次批量取） ===
  const titleIds = new Set<number>([me.id])
  for (const contact of contacts) if (contact.linewebId) titleIds.add(contact.linewebId)
  for (const room of rooms) {
    for (const member of room.members) if (member.linewebId) titleIds.add(member.linewebId)
  }
  for (const request of [...requestsIn, ...requestsOut]) {
    if (request.linewebId) titleIds.add(request.linewebId)
  }
  const titles = await getTitleMapForLineWebIds([...titleIds])
  const titleOf = (linewebId: number | null): ChatTitleView | null =>
    linewebId === null ? null : (titles.get(linewebId) as ChatTitleView | undefined) ?? null
  for (const contact of contacts) contact.title = titleOf(contact.linewebId)
  for (const room of rooms) {
    for (const member of room.members) member.title = titleOf(member.linewebId)
  }

  return {
    domain: CHAT_DOMAIN,
    mucDomain: CHAT_MUC_DOMAIN,
    historyLimit: CHAT_HISTORY_LIMIT,
    self: {
      nekoId: toNekoId(me.id),
      linewebId: me.id,
      username: toNekoUsername(me.id),
      displayName: me.username,
      title: titleOf(me.id),
    },
    friends,
    contacts,
    requestsIn,
    requestsOut,
    stickers: stickerRows.map((row) => ({
      id: row.id,
      url: `/chat/uploads/${row.uploadId}`,
      mime: row.mime || 'image/png',
    })),
    rooms,
    pinnedChats,
  }
}

/** 大群会话 id（services/bigGroup 维护；此处循环读取会引入依赖，改为直接查 SiteSetting） */
async function getBigGroupIdForUser(): Promise<number | null> {
  const row = await prisma.siteSetting.findUnique({ where: { key: 'chat.bigGroupConversationId' } })
  const id = Number(row?.value)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** 搜索可发起会话的用户（active 用户按用户名匹配；排除自己） */
export async function searchDirectory(
  meId: number,
  query: string,
  limit = 30,
): Promise<DirectoryUserView[]> {
  const q = query.trim()
  if (!q) return []
  const users = await prisma.user.findMany({
    where: {
      id: { not: meId },
      status: 'active',
      username: { contains: q },
    },
    select: { id: true, username: true, avatarVersion: true },
    orderBy: { username: 'asc' },
    take: limit,
  })
  const titles = await getTitleMapForLineWebIds(users.map((user) => user.id))
  return users.map((user) => ({
    nekoId: toNekoId(user.id),
    linewebId: user.id,
    username: toNekoUsername(user.id),
    displayName: user.username,
    isLineWeb: true,
    online: isUserChatOnline(user.id),
    lastMessageAt: 0,
    avatarVersion: user.avatarVersion,
    title: (titles.get(user.id) as ChatTitleView | undefined) ?? null,
  }))
}

/** 反查陌生来信发送者（jids = `lw_<id>@…` 列表；只回真实存在的 active 用户） */
export async function resolveUsers(
  meId: number,
  usernames: string[],
): Promise<DirectoryUserView[]> {
  const ids = new Set<number>()
  for (const username of usernames) {
    const match = /^lw_([1-9]\d*)$/.exec(String(username || ''))
    if (!match) continue
    const id = Number.parseInt(match[1], 10)
    if (Number.isSafeInteger(id) && id > 0 && id !== meId) ids.add(id)
  }
  if (ids.size === 0) return []
  const users = await prisma.user.findMany({
    where: { id: { in: [...ids] }, status: 'active' },
    select: { id: true, username: true, avatarVersion: true },
  })
  const titles = await getTitleMapForLineWebIds(users.map((user) => user.id))
  return users.map((user) => ({
    nekoId: toNekoId(user.id),
    linewebId: user.id,
    username: toNekoUsername(user.id),
    displayName: user.username,
    isLineWeb: true,
    online: isUserChatOnline(user.id),
    lastMessageAt: 0,
    avatarVersion: user.avatarVersion,
    title: (titles.get(user.id) as ChatTitleView | undefined) ?? null,
  }))
}
