import type { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'

/**
 * 聊天业务逻辑（好友、会话、消息）
 *
 * 约定：
 *   - 所有函数第一个参数都是当前登录用户 id（由路由从 req.user 取出）
 *   - 业务错误统一抛 AppError（状态码语义：400 参数/规则、403 无权限/非好友、
 *     404 不存在或非成员、409 状态冲突、429 频控）
 *   - 「非成员访问会话/消息」一律 404（不泄露会话是否存在）
 *   - 函数返回需要广播的数据（成员 id、事件 payload），由 routes/chat.ts 调 chatHub 推送
 *   - 返回对象只含普通值（Date 会被 res.json 序列化为 ISO 字符串，不含 BigInt）
 */

export interface ChatUserBrief {
  id: number
  username: string
}

export interface ChatMessageDto {
  id: number
  conversationId: number
  senderId: number
  sender: ChatUserBrief
  content: string
  createdAt: Date
}

export interface ChatConversationMemberDto {
  id: number
  username: string
  role: string
}

export interface ChatConversationDto {
  id: number
  type: string
  name: string | null
  ownerId: number | null
  members: ChatConversationMemberDto[]
  lastMessage: ChatMessageDto | null
  unreadCount: number
  lastMessageAt: Date
  /** direct 会话：双方仍是好友才为 true；group 恒为 true */
  canSend: boolean
}

export interface FriendRequestItem {
  id: number
  user: ChatUserBrief
  status: string
  createdAt: Date
}

/** 单条消息最多 2000 字（与 chatMessageSchema 对齐） */
const MESSAGE_MAX_LENGTH = 2000
/** 群聊人数上限（含群主） */
const GROUP_MEMBER_LIMIT = 50
/** 单用户最多同时待处理的「发出的好友申请」数 */
const PENDING_FRIEND_REQUEST_LIMIT = 20

type MessageRow = {
  id: number
  conversationId: number
  senderId: number
  content: string
  createdAt: Date
  sender: { id: number; username: string }
}

const messageInclude = {
  sender: { select: { id: true, username: true } },
} as const

function toMessageDto(message: MessageRow): ChatMessageDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    sender: { id: message.sender.id, username: message.sender.username },
    content: message.content,
    createdAt: message.createdAt,
  }
}

/** 唯一约束冲突（P2002）—— 并发创建 direct 会话时用于重查 */
function isUniqueConstraintError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: unknown }).code === 'P2002'
}

/** 取用户简要信息（username 用于广播 payload） */
export async function getUserBrief(userId: number): Promise<ChatUserBrief> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true },
  })
  if (!user) throw new AppError('用户不存在', 404)
  return { id: user.id, username: user.username }
}

/** 是否已是好友（Friendship 双向存储，这里只查单向即可） */
export async function areFriends(userId: number, otherUserId: number): Promise<boolean> {
  const row = await prisma.friendship.findUnique({
    where: { userId_friendId: { userId, friendId: otherUserId } },
    select: { id: true },
  })
  return !!row
}

/** 当前用户的好友 id 集合 */
async function getFriendIds(userId: number): Promise<Set<number>> {
  const rows = await prisma.friendship.findMany({
    where: { userId },
    select: { friendId: true },
  })
  return new Set(rows.map(row => row.friendId))
}

/** 校验当前用户是会话成员，返回会话与其成员 id；非成员按 404 处理 */
async function requireMembership(conversationId: number, userId: number) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      type: true,
      name: true,
      ownerId: true,
      members: { select: { userId: true } },
    },
  })
  if (!conversation) throw new AppError('会话不存在', 404)
  const memberIds = conversation.members.map(member => member.userId)
  if (!memberIds.includes(userId)) throw new AppError('会话不存在', 404)
  return { conversation, memberIds }
}

/** 组装单个会话的完整视图（含最后一条消息、未读数、是否可发送） */
async function buildConversationDto(conversationId: number, userId: number): Promise<ChatConversationDto> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      members: {
        include: { user: { select: { id: true, username: true } } },
        orderBy: { id: 'asc' },
      },
    },
  })
  if (!conversation) throw new AppError('会话不存在', 404)

  const me = conversation.members.find(member => member.userId === userId)
  if (!me) throw new AppError('会话不存在', 404)

  const [lastMessage, unreadCount] = await Promise.all([
    prisma.message.findFirst({
      where: { conversationId },
      orderBy: { id: 'desc' },
      include: messageInclude,
    }),
    prisma.message.count({
      where: { conversationId, senderId: { not: userId }, id: { gt: me.lastReadMessageId } },
    }),
  ])

  const other = conversation.members.find(member => member.userId !== userId)
  const canSend = conversation.type === 'group'
    || (other ? await areFriends(userId, other.userId) : false)

  return {
    id: conversation.id,
    type: conversation.type,
    name: conversation.name,
    ownerId: conversation.ownerId,
    members: conversation.members.map(member => ({
      id: member.user.id,
      username: member.user.username,
      role: member.role,
    })),
    lastMessage: lastMessage ? toMessageDto(lastMessage) : null,
    unreadCount,
    lastMessageAt: conversation.lastMessageAt,
    canSend,
  }
}

// === 摘要与用户搜索 ===

/** GET /chat/summary —— 全部会话未读总数 + 待处理好友申请数 */
export async function getSummary(userId: number): Promise<{ unreadTotal: number; pendingFriendRequests: number }> {
  const membershipRows = await prisma.conversationMember.findMany({
    where: { userId },
    select: { conversationId: true, lastReadMessageId: true },
  })

  const unreadTotal = membershipRows.length === 0
    ? 0
    : await prisma.message.count({
        where: {
          senderId: { not: userId },
          OR: membershipRows.map(row => ({
            conversationId: row.conversationId,
            id: { gt: row.lastReadMessageId },
          })),
        },
      })

  const pendingFriendRequests = await prisma.friendRequest.count({
    where: { toUserId: userId, status: 'pending' },
  })

  return { unreadTotal, pendingFriendRequests }
}

/** GET /chat/users/search —— 按用户名搜索（不含 email），附带与当前用户的关系 */
export async function searchUsers(
  userId: number,
  q: string,
): Promise<{ users: Array<ChatUserBrief & { relation: 'none' | 'friend' | 'outgoing' | 'incoming' }> }> {
  const users = await prisma.user.findMany({
    where: { id: { not: userId }, username: { contains: q } },
    select: { id: true, username: true },
    orderBy: { username: 'asc' },
    take: 20,
  })
  if (users.length === 0) return { users: [] }

  const targetIds = users.map(user => user.id)
  const [friendships, outgoing, incoming] = await Promise.all([
    prisma.friendship.findMany({
      where: { userId, friendId: { in: targetIds } },
      select: { friendId: true },
    }),
    prisma.friendRequest.findMany({
      where: { fromUserId: userId, toUserId: { in: targetIds }, status: 'pending' },
      select: { toUserId: true },
    }),
    prisma.friendRequest.findMany({
      where: { fromUserId: { in: targetIds }, toUserId: userId, status: 'pending' },
      select: { fromUserId: true },
    }),
  ])

  const friendIds = new Set(friendships.map(row => row.friendId))
  const outgoingIds = new Set(outgoing.map(row => row.toUserId))
  const incomingIds = new Set(incoming.map(row => row.fromUserId))

  return {
    users: users.map(user => {
      let relation: 'none' | 'friend' | 'outgoing' | 'incoming' = 'none'
      if (friendIds.has(user.id)) relation = 'friend'
      else if (outgoingIds.has(user.id)) relation = 'outgoing'
      else if (incomingIds.has(user.id)) relation = 'incoming'
      return { id: user.id, username: user.username, relation }
    }),
  }
}

// === 好友 ===

/** GET /chat/friends */
export async function listFriends(userId: number): Promise<{ friends: ChatUserBrief[] }> {
  const rows = await prisma.friendship.findMany({
    where: { userId },
    select: {
      createdAt: true,
      friend: { select: { id: true, username: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  return {
    friends: rows.map(row => ({ id: row.friend.id, username: row.friend.username })),
  }
}

/** DELETE /chat/friends/:userId —— 删除双向好友关系（不动已有会话） */
export async function removeFriend(userId: number, friendId: number): Promise<{ friendId: number }> {
  const existing = await prisma.friendship.findUnique({
    where: { userId_friendId: { userId, friendId } },
    select: { id: true },
  })
  if (!existing) throw new AppError('你们还不是好友', 404)

  await prisma.$transaction([
    prisma.friendship.deleteMany({ where: { userId, friendId } }),
    prisma.friendship.deleteMany({ where: { userId: friendId, friendId: userId } }),
  ])

  return { friendId }
}

/**
 * GET /chat/friend-requests —— 收到 / 发出的「待处理」好友申请
 *
 * 只返回 status='pending'：前端把每一项都渲染成可操作项（接受/拒绝、等待对方确认），
 * 已 accepted / rejected 的历史记录不应出现在列表里；重新发起申请时 rejected 记录会被复用。
 */
export async function listFriendRequests(
  userId: number,
): Promise<{ incoming: FriendRequestItem[]; outgoing: FriendRequestItem[] }> {
  const [incomingRows, outgoingRows] = await Promise.all([
    prisma.friendRequest.findMany({
      where: { toUserId: userId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        status: true,
        createdAt: true,
        fromUser: { select: { id: true, username: true } },
      },
    }),
    prisma.friendRequest.findMany({
      where: { fromUserId: userId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        status: true,
        createdAt: true,
        toUser: { select: { id: true, username: true } },
      },
    }),
  ])

  return {
    incoming: incomingRows.map(row => ({
      id: row.id,
      user: { id: row.fromUser.id, username: row.fromUser.username },
      status: row.status,
      createdAt: row.createdAt,
    })),
    outgoing: outgoingRows.map(row => ({
      id: row.id,
      user: { id: row.toUser.id, username: row.toUser.username },
      status: row.status,
      createdAt: row.createdAt,
    })),
  }
}

/**
 * POST /chat/friend-requests —— 发送好友申请
 *
 * 规则：不能加自己（400）、用户不存在（404）、已是好友（409）、
 * 已有同向 pending（409）、对方已有 pending 反向申请（409，提示先处理）、
 * 发出的 pending 达到 20 条（429）。历史 rejected 记录复用为 pending。
 */
export async function sendFriendRequest(
  userId: number,
  targetUserId: number,
): Promise<{ request: FriendRequestItem; from: ChatUserBrief }> {
  if (targetUserId === userId) throw new AppError('不能添加自己为好友', 400)

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, username: true },
  })
  if (!target) throw new AppError('用户不存在', 404)

  if (await areFriends(userId, targetUserId)) {
    throw new AppError('你们已经是好友', 409)
  }

  const existing = await prisma.friendRequest.findUnique({
    where: { fromUserId_toUserId: { fromUserId: userId, toUserId: targetUserId } },
  })
  if (existing && existing.status === 'pending') {
    throw new AppError('好友请求已发送，请等待对方处理', 409)
  }

  const reverse = await prisma.friendRequest.findUnique({
    where: { fromUserId_toUserId: { fromUserId: targetUserId, toUserId: userId } },
  })
  if (reverse && reverse.status === 'pending') {
    throw new AppError('对方已向你发送好友请求，请先在好友申请中处理', 409)
  }

  const pendingCount = await prisma.friendRequest.count({
    where: { fromUserId: userId, status: 'pending' },
  })
  if (pendingCount >= PENDING_FRIEND_REQUEST_LIMIT) {
    throw new AppError('待处理的好友请求过多，请稍后再试', 429)
  }

  const request = existing
    ? await prisma.friendRequest.update({
        where: { id: existing.id },
        data: { status: 'pending', respondedAt: null },
      })
    : await prisma.friendRequest.create({
        data: { fromUserId: userId, toUserId: targetUserId, status: 'pending' },
      })

  return {
    request: {
      id: request.id,
      user: { id: target.id, username: target.username },
      status: request.status,
      createdAt: request.createdAt,
    },
    from: await getUserBrief(userId),
  }
}

/**
 * POST /chat/friend-requests/:id/accept|reject —— 处理好友申请
 *
 * 仅收件人且状态为 pending 可操作（不存在 404、非收件人 403、已处理 409）；
 * 接受时在同一事务内建立双向 Friendship。
 */
export async function respondFriendRequest(
  userId: number,
  requestId: number,
  action: 'accept' | 'reject',
): Promise<{ request: { id: number; fromUserId: number; toUserId: number; status: string }; userId: number }> {
  const request = await prisma.friendRequest.findUnique({ where: { id: requestId } })
  if (!request) throw new AppError('好友请求不存在', 404)
  if (request.toUserId !== userId) throw new AppError('无权处理该好友请求', 403)
  if (request.status !== 'pending') throw new AppError('该好友请求已被处理', 409)

  const now = new Date()

  if (action === 'accept') {
    await prisma.$transaction([
      prisma.friendRequest.update({
        where: { id: request.id },
        data: { status: 'accepted', respondedAt: now },
      }),
      // 双向好友关系：upsert 保证幂等（SQLite 不支持 createMany + skipDuplicates）
      prisma.friendship.upsert({
        where: { userId_friendId: { userId: request.fromUserId, friendId: request.toUserId } },
        create: { userId: request.fromUserId, friendId: request.toUserId },
        update: {},
      }),
      prisma.friendship.upsert({
        where: { userId_friendId: { userId: request.toUserId, friendId: request.fromUserId } },
        create: { userId: request.toUserId, friendId: request.fromUserId },
        update: {},
      }),
    ])
  } else {
    await prisma.friendRequest.update({
      where: { id: request.id },
      data: { status: 'rejected', respondedAt: now },
    })
  }

  return {
    request: {
      id: request.id,
      fromUserId: request.fromUserId,
      toUserId: request.toUserId,
      status: action === 'accept' ? 'accepted' : 'rejected',
    },
    userId,
  }
}

// === 会话 ===

/** GET /chat/conversations —— 我参与的会话（按 lastMessageAt 倒序，最多 50 条） */
export async function listConversations(userId: number): Promise<{ conversations: ChatConversationDto[] }> {
  const conversations = await prisma.conversation.findMany({
    where: { members: { some: { userId } } },
    include: {
      members: {
        include: { user: { select: { id: true, username: true } } },
        orderBy: { id: 'asc' },
      },
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 50,
  })
  if (conversations.length === 0) return { conversations: [] }

  const conversationIds = conversations.map(conversation => conversation.id)
  const lastReadByConversation = new Map<number, number>()
  for (const conversation of conversations) {
    const membership = conversation.members.find(member => member.userId === userId)
    lastReadByConversation.set(conversation.id, membership?.lastReadMessageId ?? 0)
  }

  // 每个会话的最后一条消息 id（一次 groupBy）
  const maxRows = await prisma.message.groupBy({
    by: ['conversationId'],
    where: { conversationId: { in: conversationIds } },
    _max: { id: true },
  })
  const lastMessageIdByConversation = new Map<number, number>()
  for (const row of maxRows) {
    if (row._max.id !== null) lastMessageIdByConversation.set(row.conversationId, row._max.id)
  }

  // 各会话最后一条消息内容（一次 findMany）
  const lastMessageIds = Array.from(lastMessageIdByConversation.values())
  const lastMessages = lastMessageIds.length === 0
    ? []
    : await prisma.message.findMany({
        where: { id: { in: lastMessageIds } },
        include: messageInclude,
      })
  const lastMessageByConversation = new Map<number, ChatMessageDto>()
  for (const message of lastMessages) {
    lastMessageByConversation.set(message.conversationId, toMessageDto(message))
  }

  // 未读数（一次 groupBy：只统计「未读且不是自己发的」）
  const unreadFilters: Prisma.MessageWhereInput[] = []
  for (const conversation of conversations) {
    const lastRead = lastReadByConversation.get(conversation.id) ?? 0
    const lastMessageId = lastMessageIdByConversation.get(conversation.id)
    if (lastMessageId !== undefined && lastMessageId > lastRead) {
      unreadFilters.push({ conversationId: conversation.id, id: { gt: lastRead } })
    }
  }
  const unreadCountByConversation = new Map<number, number>()
  if (unreadFilters.length > 0) {
    const unreadRows = await prisma.message.groupBy({
      by: ['conversationId'],
      where: { senderId: { not: userId }, OR: unreadFilters },
      _count: { _all: true },
    })
    for (const row of unreadRows) {
      unreadCountByConversation.set(row.conversationId, row._count._all)
    }
  }

  const friendIds = await getFriendIds(userId)

  return {
    conversations: conversations.map(conversation => {
      const other = conversation.members.find(member => member.userId !== userId)
      return {
        id: conversation.id,
        type: conversation.type,
        name: conversation.name,
        ownerId: conversation.ownerId,
        members: conversation.members.map(member => ({
          id: member.user.id,
          username: member.user.username,
          role: member.role,
        })),
        lastMessage: lastMessageByConversation.get(conversation.id) ?? null,
        unreadCount: unreadCountByConversation.get(conversation.id) ?? 0,
        lastMessageAt: conversation.lastMessageAt,
        canSend: conversation.type === 'group'
          || (other ? friendIds.has(other.userId) : false),
      }
    }),
  }
}

/**
 * POST /chat/conversations/direct —— 创建或获取与好友的私聊会话
 *
 * directKey = `${minUserId}:${maxUserId}` 保证唯一；并发创建撞唯一键时重查。
 */
export async function createDirectConversation(
  userId: number,
  targetUserId: number,
): Promise<ChatConversationDto> {
  if (targetUserId === userId) throw new AppError('不能和自己创建会话', 400)

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true },
  })
  if (!target) throw new AppError('用户不存在', 404)

  if (!(await areFriends(userId, targetUserId))) {
    throw new AppError('你们还不是好友，无法发起私聊', 403)
  }

  const directKey = `${Math.min(userId, targetUserId)}:${Math.max(userId, targetUserId)}`

  const existing = await prisma.conversation.findUnique({ where: { directKey } })
  if (existing) return buildConversationDto(existing.id, userId)

  try {
    const created = await prisma.conversation.create({
      data: {
        type: 'direct',
        directKey,
        members: {
          create: [
            { userId, role: 'member' },
            { userId: targetUserId, role: 'member' },
          ],
        },
      },
    })
    return buildConversationDto(created.id, userId)
  } catch (err) {
    // 并发创建：另一请求已建好同一 directKey → 重查
    if (isUniqueConstraintError(err)) {
      const found = await prisma.conversation.findUnique({ where: { directKey } })
      if (found) return buildConversationDto(found.id, userId)
    }
    throw err
  }
}

/**
 * POST /chat/conversations/group —— 创建群聊
 *
 * 只能邀请创建者的好友（否则 400 并列出非好友 id）；总人数（含创建者）≤ 50。
 * 返回会话视图与全部成员 id（路由据此广播 conversation:updated）。
 */
export async function createGroupConversation(
  userId: number,
  name: string,
  memberIds: number[],
): Promise<{ conversation: ChatConversationDto; memberIds: number[] }> {
  const uniqueMemberIds = Array.from(new Set(memberIds)).filter(id => id !== userId)
  if (uniqueMemberIds.length === 0) throw new AppError('至少邀请一位好友', 400)
  if (uniqueMemberIds.length + 1 > GROUP_MEMBER_LIMIT) {
    throw new AppError(`群成员不能超过 ${GROUP_MEMBER_LIMIT} 人`, 400)
  }

  const friendIds = await getFriendIds(userId)
  const invalidIds = uniqueMemberIds.filter(id => !friendIds.has(id))
  if (invalidIds.length > 0) {
    throw new AppError(`只能邀请好友加入群聊（非好友：${invalidIds.join(', ')}）`, 400)
  }

  const conversation = await prisma.conversation.create({
    data: {
      type: 'group',
      name,
      ownerId: userId,
      members: {
        create: [
          { userId, role: 'owner' },
          ...uniqueMemberIds.map(id => ({ userId: id, role: 'member' })),
        ],
      },
    },
  })

  const allMemberIds = [userId, ...uniqueMemberIds]
  return {
    conversation: await buildConversationDto(conversation.id, userId),
    memberIds: allMemberIds,
  }
}

// === 消息 ===

/**
 * GET /chat/conversations/:id/messages —— 历史消息（游标分页）
 *
 * 按 id 倒序取 limit+1 条判断 hasMore，返回时反转为 id 正序。
 */
export async function listMessages(
  userId: number,
  conversationId: number,
  options: { limit: number; before?: number } = { limit: 30 },
): Promise<{ messages: ChatMessageDto[]; hasMore: boolean }> {
  await requireMembership(conversationId, userId)

  const limit = Math.min(Math.max(options.limit || 30, 1), 100)
  const rows = await prisma.message.findMany({
    where: {
      conversationId,
      ...(options.before !== undefined ? { id: { lt: options.before } } : {}),
    },
    orderBy: { id: 'desc' },
    take: limit + 1,
    include: messageInclude,
  })

  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  return {
    messages: pageRows.map(toMessageDto).reverse(),
    hasMore,
  }
}

/**
 * POST /chat/conversations/:id/messages —— 发送消息
 *
 * 只有成员可发；direct 会话要求双方仍是好友（否则 403）；
 * 事务内写消息 + 更新会话 lastMessageAt；返回消息视图与全部成员 id。
 */
export async function sendMessage(
  userId: number,
  conversationId: number,
  rawContent: string,
): Promise<{ message: ChatMessageDto; memberIds: number[] }> {
  const content = rawContent.trim()
  if (!content) throw new AppError('消息不能为空', 400)
  if (content.length > MESSAGE_MAX_LENGTH) throw new AppError('消息过长', 400)

  const { conversation, memberIds } = await requireMembership(conversationId, userId)

  if (conversation.type === 'direct') {
    const otherId = memberIds.find(id => id !== userId)
    if (!otherId || !(await areFriends(userId, otherId))) {
      throw new AppError('你们已不是好友，无法发送消息', 403)
    }
  }

  const now = new Date()
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: { conversationId, senderId: userId, content },
      include: messageInclude,
    })
    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: now },
    })
    return created
  })

  return { message: toMessageDto(message), memberIds }
}

/**
 * PUT /chat/conversations/:id/read —— 更新已读位置
 *
 * lastReadMessageId = max(原值, min(请求值, 最新消息 id))，只前进不后退。
 */
export async function markConversationRead(
  userId: number,
  conversationId: number,
  lastMessageId: number,
): Promise<{ lastReadMessageId: number }> {
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { id: true, lastReadMessageId: true },
  })
  if (!membership) throw new AppError('会话不存在', 404)

  const latest = await prisma.message.findFirst({
    where: { conversationId },
    orderBy: { id: 'desc' },
    select: { id: true },
  })
  const latestMessageId = latest?.id ?? 0
  const requested = Number.isFinite(lastMessageId) ? Math.max(0, Math.trunc(lastMessageId)) : 0
  const target = Math.max(membership.lastReadMessageId, Math.min(requested, latestMessageId))

  if (target !== membership.lastReadMessageId) {
    await prisma.conversationMember.update({
      where: { id: membership.id },
      data: { lastReadMessageId: target },
    })
  }

  return { lastReadMessageId: target }
}

// === 群管理 ===

/** PUT /chat/conversations/:id —— 群主修改群名 */
export async function renameGroupConversation(
  userId: number,
  conversationId: number,
  name: string,
): Promise<{ conversation: ChatConversationDto; memberIds: number[] }> {
  const { conversation, memberIds } = await requireMembership(conversationId, userId)
  if (conversation.type !== 'group') throw new AppError('仅群聊支持修改群名', 403)
  if (conversation.ownerId !== userId) throw new AppError('只有群主可以修改群名', 403)

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { name },
  })

  return {
    conversation: await buildConversationDto(conversationId, userId),
    memberIds,
  }
}

/** POST /chat/conversations/:id/members —— 群主添加成员（仅自己的好友，≤50 人） */
export async function addGroupMembers(
  userId: number,
  conversationId: number,
  userIds: number[],
): Promise<{ conversation: ChatConversationDto; memberIds: number[]; addedIds: number[] }> {
  const { conversation, memberIds } = await requireMembership(conversationId, userId)
  if (conversation.type !== 'group') throw new AppError('仅群聊支持添加成员', 403)
  if (conversation.ownerId !== userId) throw new AppError('只有群主可以添加成员', 403)

  const existingIds = new Set(memberIds)
  const toAdd = Array.from(new Set(userIds)).filter(id => id !== userId && !existingIds.has(id))

  if (toAdd.length > 0) {
    if (existingIds.size + toAdd.length > GROUP_MEMBER_LIMIT) {
      throw new AppError(`群成员不能超过 ${GROUP_MEMBER_LIMIT} 人`, 400)
    }
    const friendIds = await getFriendIds(userId)
    const invalidIds = toAdd.filter(id => !friendIds.has(id))
    if (invalidIds.length > 0) {
      throw new AppError(`只能邀请好友加入群聊（非好友：${invalidIds.join(', ')}）`, 400)
    }
    await prisma.conversationMember.createMany({
      data: toAdd.map(id => ({ conversationId, userId: id, role: 'member' })),
    })
  }

  const updatedMemberIds = [...memberIds, ...toAdd]
  return {
    conversation: await buildConversationDto(conversationId, userId),
    memberIds: updatedMemberIds,
    addedIds: toAdd,
  }
}

/**
 * DELETE /chat/conversations/:id/members/:userId —— 退出群聊 / 群主移除成员
 *
 * 非群主只能移除自己；群主移除自己 400（应先解散群聊）。
 */
export async function removeGroupMember(
  userId: number,
  conversationId: number,
  targetUserId: number,
): Promise<{ removedUserId: number; remainingIds: number[]; memberIds: number[] }> {
  const { conversation, memberIds } = await requireMembership(conversationId, userId)
  if (conversation.type !== 'group') throw new AppError('仅群聊支持退出 / 移除成员', 403)

  if (!memberIds.includes(targetUserId)) throw new AppError('该用户不在群聊中', 404)

  if (targetUserId === userId) {
    if (conversation.ownerId === userId) {
      throw new AppError('群主不能退出群聊，请先解散群聊', 400)
    }
  } else if (conversation.ownerId !== userId) {
    throw new AppError('只有群主可以移除成员', 403)
  }

  await prisma.conversationMember.deleteMany({
    where: { conversationId, userId: targetUserId },
  })

  const remainingIds = memberIds.filter(id => id !== targetUserId)
  return { removedUserId: targetUserId, remainingIds, memberIds }
}

/** DELETE /chat/conversations/:id —— 群主解散群聊（级联删除成员与消息） */
export async function deleteGroupConversation(
  userId: number,
  conversationId: number,
): Promise<{ memberIds: number[] }> {
  const { conversation, memberIds } = await requireMembership(conversationId, userId)
  if (conversation.type !== 'group') throw new AppError('仅群聊支持解散', 403)
  if (conversation.ownerId !== userId) throw new AppError('只有群主可以解散群聊', 403)

  await prisma.conversation.delete({ where: { id: conversationId } })
  return { memberIds }
}
