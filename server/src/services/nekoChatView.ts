import {
  isLineWebUsername,
  linewebIdOf,
  linewebIdOfUsername,
  toNekoId,
  toNekoUsername,
  type NekoState,
  type NekoStateRoom,
  type NekoStateUser,
} from './nekoChat.js'

/**
 * 聊天页状态的「出口口径」——纯函数，便于自检脚本直接断言。
 *
 * 原则：
 *   - 会话键统一 `u<nekoId>` / `r<roomId>`，原生联系人与 LineWeb 好友在同一键空间；
 *   - LineWeb 好友关系（Prisma）是唯一真相源：`lw_*` 联系人只保留好友；
 *   - 原生账号只在「有往来（lastMessageAt > 0）」时出现，且受 allowNative 开关控制；
 *   - 全员大厅、系统助理、文件传输助手、自己一律不出现在列表里。
 */

export interface ChatRequestView {
  id: number
  linewebId: number
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

/** 原生账号过滤：系统助理 / 文件传输助手 / 无往来 / 开关关闭时都不出现 */
function nativeAllowed(user: NekoStateUser, state: NekoState, allowNative: boolean): boolean {
  if (!allowNative) return false
  if (user.username === state.systemUsername || user.username === state.fileHelperUsername) return false
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

function toRequest(item: LineWebFriendRequestItem): ChatRequestView {
  return {
    id: item.id,
    linewebId: item.user.id,
    nekoId: toNekoId(item.user.id),
    username: toNekoUsername(item.user.id),
    displayName: item.user.username,
    createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : String(item.createdAt),
  }
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

  const friendIds = new Set(input.friends.map((friend) => friend.id))
  const friends: ChatContactView[] = input.friends.map((friend) => {
    const nekoId = toNekoId(friend.id)
    const known = usersById.get(nekoId)
    return toContact(
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
  })

  const contacts: ChatContactView[] = []
  for (const friend of friends) contacts.push(friend)
  for (const user of state.users) {
    if (user.id === selfNekoId) continue
    // LineWeb 账号只在好友列表里出现（好友已在上面加入）
    if (linewebIdOfUsername(user.username) !== null) continue
    if (!nativeAllowed(user, state, allowNative)) continue
    contacts.push(toContact(user, false))
  }
  contacts.sort((a, b) => {
    if (a.isFriend !== b.isFriend) return a.isFriend ? -1 : 1
    return b.lastMessageAt - a.lastMessageAt
  })

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
    requestsIn: input.requestsIn.map(toRequest),
    requestsOut: input.requestsOut.map(toRequest),
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
