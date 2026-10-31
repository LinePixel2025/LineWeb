import prisma from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'

/**
 * 聊天好友业务逻辑（Prisma 唯一真相源）
 *
 * 聊天自建（2026-10 起）后会话 / 消息逻辑在 services/chatMessaging.ts（XMPP 协议层），
 * 本文件只保留好友关系：
 *   - 所有函数第一个参数都是当前登录用户 id（由路由从 req.user 取出）
 *   - 业务错误统一抛 AppError（状态码语义：400 参数/规则、403 无权限/非好友、
 *     404 不存在或非成员、409 状态冲突、429 频控）
 *   - 好友函数被 12 个游戏服务（组队 / 邀请）与聊天协议层依赖，属稳定 API
 */

export interface ChatUserBrief {
  id: number
  username: string
}

export interface FriendRequestItem {
  id: number
  user: ChatUserBrief
  status: string
  createdAt: Date
}

/** 单用户最多同时待处理的「发出的好友申请」数 */
const PENDING_FRIEND_REQUEST_LIMIT = 20

/** 是否已是好友（Friendship 双向存储，这里只查单向即可） */
export async function areFriends(userId: number, otherUserId: number): Promise<boolean> {
  const row = await prisma.friendship.findUnique({
    where: { userId_friendId: { userId, friendId: otherUserId } },
    select: { id: true },
  })
  return !!row
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

// === 摘要与用户搜索 ===

/** GET /chat/summary —— 待处理好友申请数（未读消息由客户端水位统计，恒为 0） */
export async function getSummary(userId: number): Promise<{ unreadTotal: number; pendingFriendRequests: number }> {
  const pendingFriendRequests = await prisma.friendRequest.count({
    where: { toUserId: userId, status: 'pending' },
  })
  return { unreadTotal: 0, pendingFriendRequests }
}

/** GET /chat/users/search —— 按用户名搜索（不含 email），附带与当前用户的关系 */
export async function searchUsers(
  userId: number,
  q: string,
): Promise<{ users: Array<ChatUserBrief & { relation: 'none' | 'friend' | 'outgoing' | 'incoming' }> }> {
  const users = await prisma.user.findMany({
    where: { id: { not: userId }, username: { contains: q }, status: 'active' },
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
    select: { id: true, username: true, status: true },
  })
  if (!target || target.status !== 'active') throw new AppError('用户不存在', 404)

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
 * 双向好友写入（幂等）——Prisma 接受流程与历史数据修复共用。
 *
 * 两个 upsert 必须一起提交，避免出现「只有单向好友」的半成品状态。
 */
function mutualFriendshipWrites(userId: number, friendId: number) {
  return [
    prisma.friendship.upsert({
      where: { userId_friendId: { userId, friendId } },
      create: { userId, friendId },
      update: {},
    }),
    prisma.friendship.upsert({
      where: { userId_friendId: { userId: friendId, friendId: userId } },
      create: { userId: friendId, friendId: userId },
      update: {},
    }),
  ]
}

/** 双向建立好友关系（幂等；管理脚本 / 数据修复用） */
export async function ensureMutualFriendship(userId: number, friendId: number): Promise<void> {
  if (userId === friendId) return
  await prisma.$transaction(mutualFriendshipWrites(userId, friendId))
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
      ...mutualFriendshipWrites(request.fromUserId, request.toUserId),
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
