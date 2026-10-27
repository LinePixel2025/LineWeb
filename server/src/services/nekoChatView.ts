import {
  isLineWebUsername,
  linewebIdOf,
  linewebIdOfUsername,
  toNekoId,
  toNekoUsername,
  type NekoState,
  type NekoStateFriendRequest,
  type NekoStateRoom,
  type NekoStateUser,
  type NekoSticker,
} from './nekoChat.js'

/**
 * 聊天页状态的「出口口径」——纯函数，便于自检脚本直接断言。
 *
 * 原则：
 *   - 会话键统一 `u<nekoId>` / `r<roomId>`，原生联系人与 LineWeb 好友在同一键空间；
 *   - LineWeb 好友关系（Prisma）是 `lw_*` 账号的唯一真相源；
 *   - neko 原生账号的好友关系以 neko 自身好友系统为准（`state.friends`），
 *     两者在出口处合并，联系人/申请用 `source` 区分来源；
 *   - 原生账号的可见性受 allowNative 开关控制（guard 同样拒绝向原生账号发私聊）；
 *   - 全员大厅、系统助理、文件传输助手、自己一律不出现在列表里。
 */

export interface ChatRequestView {
  /** LineWeb 好友申请为 Prisma id；neko 申请为 neko requestId */
  id: number
  /** 申请来源：lineweb = Prisma（LineWeb↔LineWeb），neko = neko 好友系统（原生账号） */
  source: 'lineweb' | 'neko'
  linewebId: number | null
  nekoId: number
  username: string
  displayName: string
  createdAt: string
}

export interface ChatContactView {
  key: string
  nekoId: number
  linewebId: number | null
  username: string
  displayName: string
  kind: 'lineweb' | 'native'
  online: boolean
  lastMessageAt: number
  isFriend: boolean
  remark: string
}

export interface ChatRoomMemberView {
  nekoId: number
  linewebId: number | null
  username: string
  displayName: string
  role: string
  online: boolean
  kind: 'lineweb' | 'native'
}

export interface ChatRoomView {
  key: string
  id: number
  name: string
  ownerId: number
  myRole: string
  allMuted: boolean
  announcement: string
  notifyMuted: boolean
  lastMessageAt: number
  members: ChatRoomMemberView[]
}

export interface ChatSelfView {
  nekoId: number
  linewebId: number
  username: string
  displayName: string
}

export interface ChatBootstrapView {
  domain: string
  mucDomain: string
  historyLimit: number
  self: ChatSelfView
  friends: ChatContactView[]
  contacts: ChatContactView[]
  requestsIn: ChatRequestView[]
  requestsOut: ChatRequestView[]
  stickers: NekoSticker[]
  rooms: ChatRoomView[]
  pinnedChats: string[]
}

export interface LineWebFriendBrief {
  id: number
  username: string
}

export interface LineWebFriendRequestItem {
  id: number
  user: { id: number; username: string }
  createdAt: Date | string
}

export interface BuildChatViewInput {
  me: { id: number; username: string }
  state: NekoState
  /** Prisma 好友（LineWeb id + 用户名） */
  friends: LineWebFriendBrief[]
  requestsIn: LineWebFriendRequestItem[]
  requestsOut: LineWebFriendRequestItem[]
  allowNative: boolean
}

function kindOfUsername(username: string): 'lineweb' | 'native' {
  return isLineWebUsername(username) ? 'lineweb' : 'native'
}

/** 系统助理 / 文件传输助手（文件助手会和每个启用账号自动互加好友） */
function isSystemUsername(state: NekoState, username: string): boolean {
  return username === state.systemUsername || username === state.fileHelperUsername
}

/** 原生账号过滤：系统助理 / 文件传输助手 / 无往来 / 开关关闭时都不出现 */
function nativeAllowed(user: NekoStateUser, state: NekoState, allowNative: boolean): boolean {
  if (!allowNative) return false
  if (isSystemUsername(state, user.username)) return false
  return user.lastMessageAt > 0
}

function toContact(
  user: Pick<NekoStateUser, 'id' | 'username' | 'displayName' | 'lastMessageAt' | 'online'>,
  isFriend: boolean,
  remark = '',
): ChatContactView {
  const linewebId = linewebIdOfUsername(user.username)
  return {
    key: `u${user.id}`,
    nekoId: user.id,
    linewebId,
    username: user.username,
    displayName: user.displayName || user.username,
    kind: kindOfUsername(user.username),
    online: !!user.online,
    lastMessageAt: Number(user.lastMessageAt) || 0,
    isFriend,
    remark,
  }
}

function toRoomMember(
  member: NekoStateRoom['members'][number],
): ChatRoomMemberView {
  return {
    nekoId: member.id,
    linewebId: linewebIdOf(member.id),
    username: member.username,
    displayName: member.displayName || member.username,
    role: member.role,
    online: !!member.online,
    kind: kindOfUsername(member.username),
  }
}

/** 兼容 neko 侧毫秒时间戳与 ISO 字符串 */
function isoStamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value).toISOString()
  }
  const text = typeof value === 'string' ? value : ''
  if (text) {
    const numeric = Number(text)
    if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric).toISOString()
    const parsed = Date.parse(text)
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString()
  }
  return new Date(0).toISOString()
}

function prismaRequest(item: LineWebFriendRequestItem): ChatRequestView {
  return {
    id: item.id,
    source: 'lineweb',
    linewebId: item.user.id,
    nekoId: toNekoId(item.user.id),
    username: toNekoUsername(item.user.id),
    displayName: item.user.username,
    createdAt: isoStamp(item.createdAt),
  }
}

function nekoRequest(item: NekoStateFriendRequest): ChatRequestView {
  return {
    id: item.requestId,
    source: 'neko',
    linewebId: linewebIdOf(item.userId),
    nekoId: item.userId,
    username: item.username,
    displayName: item.displayName || item.username,
    createdAt: isoStamp(item.createdAt),
  }
}

const STICKER_URL_RE = /^\/chat\/uploads\/[0-9a-f]{24}$/

/** 会话键统一且只接受 `/chat/uploads/<24hex>` 的表情地址 */
function toStickers(state: NekoState): NekoSticker[] {
  const rows = Array.isArray(state.stickers) ? state.stickers : []
  const result: NekoSticker[] = []
  const seen = new Set<number>()
  for (const row of rows) {
    const id = Number(row?.id)
    const url = String(row?.url || '')
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue
    if (!STICKER_URL_RE.test(url)) continue
    seen.add(id)
    result.push({ id, url, mime: String(row?.mime || 'image/png') })
  }
  return result
}

/** 按「好友 → 联系人 → 群 → 置顶」顺序组装聊天页状态 */
export function buildChatView(input: BuildChatViewInput): ChatBootstrapView {
  const { me, state, allowNative } = input
  const selfNekoId = toNekoId(me.id)
  const usersById = new Map<number, NekoStateUser>()
  const usersByName = new Map<string, NekoStateUser>()
  for (const user of state.users) {
    usersById.set(user.id, user)
    usersByName.set(user.username, user)
  }

  // 同一 neko 账号只出现一次：先 LineWeb 好友，再 neko 原生好友，最后有往来的原生账号
  const contactByNekoId = new Map<number, ChatContactView>()

  for (const friend of input.friends) {
    const nekoId = toNekoId(friend.id)
    const known = usersById.get(nekoId)
    const contact = toContact(
      known ?? {
        id: nekoId,
        username: toNekoUsername(friend.id),
        displayName: friend.username,
        lastMessageAt: 0,
        online: false,
      },
      true,
      state.friends.find((row) => row.id === nekoId)?.remark || '',
    )
    contactByNekoId.set(contact.nekoId, contact)
  }

  if (allowNative) {
    for (const friend of state.friends) {
      if (friend.id === selfNekoId) continue
      if (linewebIdOfUsername(friend.username) !== null) continue
      if (isSystemUsername(state, friend.username)) continue
      if (friend.enabled === false) continue
      if (contactByNekoId.has(friend.id)) continue
      const known = usersById.get(friend.id)
      contactByNekoId.set(
        friend.id,
        toContact(
          known ?? {
            id: friend.id,
            username: friend.username,
            displayName: friend.displayName,
            lastMessageAt: friend.lastMessageAt,
            online: friend.online,
          },
          true,
          friend.remark || '',
        ),
      )
    }
  }

  for (const user of state.users) {
    if (user.id === selfNekoId) continue
    // LineWeb 账号只在好友列表里出现
    if (linewebIdOfUsername(user.username) !== null) continue
    if (!nativeAllowed(user, state, allowNative)) continue
    if (contactByNekoId.has(user.id)) continue
    contactByNekoId.set(user.id, toContact(user, false))
  }

  const contacts = [...contactByNekoId.values()].sort((a, b) => {
    if (a.isFriend !== b.isFriend) return a.isFriend ? -1 : 1
    return b.lastMessageAt - a.lastMessageAt
  })
  const friends = contacts.filter((contact) => contact.isFriend)

  // 好友申请：Prisma（LineWeb↔LineWeb）与 neko（原生账号，含原生客户端操作的 lw_* 账号）合并
  const prismaInIds = new Set(input.requestsIn.map((item) => item.user.id))
  const prismaOutIds = new Set(input.requestsOut.map((item) => item.user.id))
  const nekoVisible = (item: NekoStateFriendRequest): boolean => {
    if (!allowNative) return false
    if (item.userId === selfNekoId) return false
    if (isSystemUsername(state, item.username)) return false
    // 原生账号必须真实存在；lw_* 允许（state.users 未必列全所有 LineWeb 账号）
    if (linewebIdOf(item.userId) === null && !usersById.has(item.userId)) return false
    return true
  }
  const mergeRequests = (
    prismaItems: LineWebFriendRequestItem[],
    nekoItems: NekoStateFriendRequest[],
    prismaIds: Set<number>,
  ): ChatRequestView[] => [
    ...prismaItems.map(prismaRequest),
    ...nekoItems
      .filter(nekoVisible)
      .filter((item) => {
        const linewebId = linewebIdOf(item.userId)
        return linewebId === null || !prismaIds.has(linewebId)
      })
      .map(nekoRequest),
  ]
  const requestsIn = mergeRequests(input.requestsIn, state.friendRequestsIn || [], prismaInIds)
  const requestsOut = mergeRequests(input.requestsOut, state.friendRequestsOut || [], prismaOutIds)

  const rooms: ChatRoomView[] = state.rooms
    .filter((room) => !room.isLobby && !!room.myRole)
    .map((room) => ({
      key: `r${room.id}`,
      id: room.id,
      name: room.name,
      ownerId: room.ownerId,
      myRole: String(room.myRole),
      allMuted: !!room.allMuted,
      announcement: room.announcement || '',
      notifyMuted: !!room.notifyMuted,
      lastMessageAt: Number(room.lastMessageAt) || 0,
      members: room.members.map(toRoomMember),
    }))

  const validKeys = new Set<string>([
    ...contacts.map((contact) => contact.key),
    ...rooms.map((room) => room.key),
  ])
  const pinnedChats = (Array.isArray(state.pinnedChats) ? state.pinnedChats : []).filter((key) =>
    validKeys.has(key),
  )

  return {
    domain: state.domain,
    mucDomain: state.mucDomain,
    historyLimit: Number(state.historyLimit) || 30,
    self: {
      nekoId: selfNekoId,
      linewebId: me.id,
      username: toNekoUsername(me.id),
      displayName: me.username,
    },
    friends,
    contacts,
    requestsIn,
    requestsOut,
    stickers: toStickers(state),
    rooms,
    pinnedChats,
  }
}

export interface DirectoryUserView {
  nekoId: number
  linewebId: number | null
  username: string
  displayName: string
  isLineWeb: boolean
  online: boolean
  lastMessageAt: number
}

/** 搜索可发起会话的联系人（原生用户为主，`lw_*` 只回好友） */
export function searchDirectory(
  state: NekoState,
  selfNekoId: number,
  friendIds: Set<number>,
  query: string,
  allowNative: boolean,
  limit = 30,
): DirectoryUserView[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const result: DirectoryUserView[] = []
  for (const user of state.users) {
    if (user.id === selfNekoId) continue
    if (user.username === state.systemUsername || user.username === state.fileHelperUsername) continue
    const linewebId = linewebIdOfUsername(user.username)
    if (linewebId !== null) {
      if (!friendIds.has(linewebId)) continue
    } else if (!allowNative) {
      continue
    }
    const displayName = user.displayName || user.username
    if (!displayName.toLowerCase().includes(q) && !user.username.toLowerCase().includes(q)) continue
    result.push({
      nekoId: user.id,
      linewebId,
      username: user.username,
      displayName,
      isLineWeb: linewebId !== null,
      online: !!user.online,
      lastMessageAt: Number(user.lastMessageAt) || 0,
    })
    if (result.length >= limit) break
  }
  return result
}

/** 反查陌生来消息的发送者（只回允许出现在列表里的人） */
export function resolveUsers(
  state: NekoState,
  selfNekoId: number,
  friendIds: Set<number>,
  usernames: string[],
  allowNative: boolean,
): DirectoryUserView[] {
  const wanted = new Set(usernames.filter(Boolean))
  const result: DirectoryUserView[] = []
  for (const user of state.users) {
    if (user.id === selfNekoId || !wanted.has(user.username)) continue
    if (user.username === state.systemUsername || user.username === state.fileHelperUsername) continue
    const linewebId = linewebIdOfUsername(user.username)
    if (linewebId !== null) {
      if (!friendIds.has(linewebId)) continue
    } else if (!allowNative) {
      continue
    }
    result.push({
      nekoId: user.id,
      linewebId,
      username: user.username,
      displayName: user.displayName || user.username,
      isLineWeb: linewebId !== null,
      online: !!user.online,
      lastMessageAt: Number(user.lastMessageAt) || 0,
    })
  }
  return result
}
