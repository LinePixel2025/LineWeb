/**
 * 聊天积分红包服务（单聊专属红包 + 群聊拼手气红包）。
 *
 * 金额流转全部走统一积分（PointsLedger）：
 *   - 发送：spendPointsTx 一次性扣完（reason=redpacket_send）；
 *   - 领取：awardPointsTx 入账（reason=redpacket_receive）；
 *   - 过期：24h 未领完，剩余金额退回发送者（reason=redpacket_refund）。
 *
 * 退回是「惰性结算 + 定时扫描兜底」：读详情 / 领取时顺手结算，
 * index.ts 里的 60s 定时器扫尾。settle 均以条件翻转 status='active'→'expired'
 * 占位（updateMany 命中数为 0 说明别人已结算），幂等可重入。
 */

import prisma from '../lib/prisma.js'
import type { Prisma } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import { awardPointsTx, spendPointsTx } from './pointsService.js'
import { areFriends } from './chatService.js'
import { ensureDirectConversation } from './chatMessaging.js'
import { linewebIdOf } from '../lib/chatIdentity.js'
import {
  RED_PACKET_EXPIRE_MS,
  splitLuckyAmount,
  validateRedPacketCreateInput,
} from '../lib/redpacket.js'

export interface CreateRedPacketInput {
  /** single：对方的聊天联系人 id（nekoId = 1000000000000 + LineWeb 用户 id） */
  peer?: number
  /** lucky：群会话 id */
  roomId?: number
  totalPoints: number
  count?: number
  type: 'single' | 'lucky'
  greeting?: string
}

export interface RedPacketCreatedDto {
  id: number
  conversationId: number
  totalPoints: number
  count: number
  type: string
  greeting: string
  expireAt: string
}

export interface RedPacketClaimDto {
  userId: number
  username: string
  amount: number
  claimedAt: string
}

export interface RedPacketViewDto {
  id: number
  type: string
  status: string
  totalPoints: number
  count: number
  claimedCount: number
  claimedPoints: number
  greeting: string
  /** 发送者用户名（弹窗「来自 xxx」展示用） */
  senderName: string
  expireAt: string
  createdAt: string
  isMine: boolean
  myClaim: { amount: number; claimedAt: string } | null
  claims: RedPacketClaimDto[]
}

export interface RedPacketClaimResult {
  amount: number
  balance: number
}

/** 事务客户端类型（与 pointsService 的 Db 同一口径） */
type Tx = Prisma.TransactionClient

/* ============================================================
   创建
   ============================================================ */

export async function createRedPacket(userId: number, input: CreateRedPacketInput): Promise<RedPacketCreatedDto> {
  const validated = validateRedPacketCreateInput(input)
  if (!validated.ok) throw new AppError(validated.error, 400)
  const { type, totalPoints, count, greeting } = validated.value

  let conversationId: number
  if (type === 'single') {
    // 单聊专属红包：只能发给好友，落在两人 direct 会话
    if (input.peer === undefined || !Number.isInteger(input.peer)) {
      throw new AppError('请选择红包接收人', 400)
    }
    const targetUserId = linewebIdOf(input.peer)
    if (!targetUserId) throw new AppError('无效的联系人', 400)
    if (targetUserId === userId) throw new AppError('不能给自己发红包', 400)
    if (!(await areFriends(userId, targetUserId))) throw new AppError('只能给好友发红包', 403)
    const direct = await ensureDirectConversation(userId, targetUserId)
    if (!direct) throw new AppError('会话创建失败，请稍后重试', 500)
    conversationId = direct.conversationId
  } else {
    // 群聊拼手气红包：请求者必须是该群会话成员（非成员 404，不泄露存在性）
    if (input.roomId === undefined || !Number.isInteger(input.roomId) || input.roomId <= 0) {
      throw new AppError('请选择群聊', 400)
    }
    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: input.roomId, userId } },
      select: { conversation: { select: { id: true, type: true } } },
    })
    if (!membership || membership.conversation.type !== 'group') throw new AppError('会话不存在', 404)
    conversationId = membership.conversation.id
  }

  return prisma.$transaction(async (tx) => {
    // 余额不足由 spendPointsTx 抛 400（事务整体回滚）
    await spendPointsTx(tx, userId, totalPoints, {
      reason: 'redpacket_send',
      note: type === 'single' ? '发送专属红包' : '发送拼手气红包',
    })
    const packet = await tx.redPacket.create({
      data: {
        conversationId,
        senderId: userId,
        totalPoints,
        count,
        type,
        greeting,
        expireAt: new Date(Date.now() + RED_PACKET_EXPIRE_MS),
      },
      select: { id: true, conversationId: true, totalPoints: true, count: true, type: true, greeting: true, expireAt: true },
    })
    return {
      id: packet.id,
      conversationId: packet.conversationId,
      totalPoints: packet.totalPoints,
      count: packet.count,
      type: packet.type,
      greeting: packet.greeting,
      expireAt: packet.expireAt.toISOString(),
    }
  })
}

/* ============================================================
   查看详情
   ============================================================ */

/** 读红包并做会话可见性校验：群 → 成员；单聊 → 会话成员（sender 或对方）；否则 null（404 不暴露存在性） */
async function loadRedPacketForUser(redPacketId: number, userId: number) {
  const packet = await prisma.redPacket.findUnique({
    where: { id: redPacketId },
    include: {
      conversation: {
        select: { id: true, type: true, members: { select: { userId: true } } },
      },
      sender: { select: { username: true } },
    },
  })
  if (!packet) return null
  const isMember = packet.conversation.members.some((member) => member.userId === userId)
  return isMember ? packet : null
}

export async function getRedPacketView(userId: number, redPacketId: number): Promise<RedPacketViewDto> {
  let packet = await loadRedPacketForUser(redPacketId, userId)
  if (!packet) throw new AppError('红包不存在', 404)
  // 惰性结算：已过期但还没人触发退回，先结算再按新状态展示
  if (packet.status === 'active' && packet.expireAt.getTime() <= Date.now()) {
    await settleRedPacket(redPacketId)
    packet = await loadRedPacketForUser(redPacketId, userId)
    if (!packet) throw new AppError('红包不存在', 404)
  }

  const claims = await prisma.redPacketClaim.findMany({
    where: { redPacketId },
    orderBy: [{ claimedAt: 'asc' }, { id: 'asc' }],
    select: {
      userId: true,
      amount: true,
      claimedAt: true,
      user: { select: { username: true } },
    },
  })
  const mine = claims.find((claim) => claim.userId === userId) ?? null
  return {
    id: packet.id,
    type: packet.type,
    status: packet.status,
    totalPoints: packet.totalPoints,
    count: packet.count,
    claimedCount: packet.claimedCount,
    claimedPoints: packet.claimedPoints,
    greeting: packet.greeting,
    senderName: packet.sender.username,
    expireAt: packet.expireAt.toISOString(),
    createdAt: packet.createdAt.toISOString(),
    isMine: packet.senderId === userId,
    myClaim: mine
      ? { amount: mine.amount, claimedAt: mine.claimedAt.toISOString() }
      : null,
    claims: claims.map((claim) => ({
      userId: claim.userId,
      username: claim.user.username,
      amount: claim.amount,
      claimedAt: claim.claimedAt.toISOString(),
    })),
  }
}

/* ============================================================
   领取
   ============================================================ */

export async function claimRedPacket(userId: number, redPacketId: number): Promise<RedPacketClaimResult> {
  // 事务外先做权限 / 自领 / 过期预检（过期时先在独立事务完成退回，再报 400）
  const packet = await loadRedPacketForUser(redPacketId, userId)
  if (!packet) throw new AppError('红包不存在', 404)
  if (packet.senderId === userId) throw new AppError('不能领取自己的红包', 400)
  // 重复领取 409：单份红包领完立即 finished，若不在此处拦截会先被下方
  // status!=='active' 短路成 400「已被领完」；并发窗口仍由事务内 P2002 兜底
  const already = await prisma.redPacketClaim.findUnique({
    where: { redPacketId_userId: { redPacketId, userId } },
    select: { id: true },
  })
  if (already) throw new AppError('已经领取过这个红包', 409)
  if (packet.status !== 'active') throw new AppError(expiredMessageOf(packet.status), 400)
  if (packet.expireAt.getTime() <= Date.now()) {
    await settleRedPacket(redPacketId)
    throw new AppError('红包已过期，未领金额已退回', 400)
  }

  let expiredInTx = false
  try {
    return await prisma.$transaction(async (tx) => {
      const fresh = await tx.redPacket.findUnique({
        where: { id: redPacketId },
        select: {
          status: true,
          count: true,
          totalPoints: true,
          claimedPoints: true,
          claimedCount: true,
          expireAt: true,
        },
      })
      if (!fresh) throw new AppError('红包不存在', 404)
      if (fresh.status === 'expired') throw new AppError('红包已过期，未领金额已退回', 400)
      if (fresh.expireAt.getTime() <= Date.now()) {
        // 预检与事务之间恰好过期（竞态窗口）：本地标记，事务回滚后在独立事务补结算
        expiredInTx = true
        throw new AppError('红包已过期，未领金额已退回', 400)
      }

      // 重复领取直接 409：领完后的重复领取会在下方占位处短路成 400「领完」，
      // 故必须在占位之前先查复合唯一键（并发窗口仍由 P2002 兜底）
      const already = await tx.redPacketClaim.findUnique({
        where: { redPacketId_userId: { redPacketId, userId } },
        select: { id: true },
      })
      if (already) throw new AppError('已经领取过这个红包', 409)

      // 条件更新占位份额（防并发超领；与 spendPointsTx 同一防并发思路）
      const placed = await tx.redPacket.updateMany({
        where: { id: redPacketId, status: 'active', claimedCount: { lt: fresh.count } },
        data: { claimedCount: { increment: 1 } },
      })
      if (placed.count === 0) throw new AppError('红包已被领完', 400)

      const current = await tx.redPacket.findUniqueOrThrow({
        where: { id: redPacketId },
        select: { type: true, count: true, totalPoints: true, claimedPoints: true, claimedCount: true },
      })
      // 占位自增后重读：claimedCount 已含自己 → 剩余份数要 +1 才是拆分口径
      // （否则首抢者看到剩余 1 份而拿走全部；claimedPoints 未被占位自增，金额口径不变）
      const sharesLeftIncludingMine = current.count - current.claimedCount + 1
      // single：对方拿走全部；lucky：对剩余做二倍均值拆分
      const amount = current.type === 'single'
        ? current.totalPoints
        : splitLuckyAmount(current.totalPoints - current.claimedPoints, sharesLeftIncludingMine)

      try {
        await tx.redPacketClaim.create({ data: { redPacketId, userId, amount } })
      } catch (error) {
        // 唯一键兜底：并发 / 重复领取（同一红包一人一次）
        if ((error as { code?: string }).code === 'P2002') {
          throw new AppError('已经领取过这个红包', 409)
        }
        throw error
      }

      await tx.redPacket.update({
        where: { id: redPacketId },
        data: {
          claimedPoints: { increment: amount },
          // 占位后份数已满 → 结束（后续再无领取）
          ...(current.claimedCount >= current.count ? { status: 'finished' } : {}),
        },
      })

      const awarded = await awardPointsTx(tx, userId, {
        amount,
        reason: 'redpacket_receive',
        note: '领取红包',
      })
      return { amount, balance: awarded.balance }
    })
  } catch (error) {
    if (expiredInTx) {
      // 事务已回滚，退回在独立事务完成（settle 幂等，重复调用安全）
      await settleRedPacket(redPacketId).catch(() => {})
    }
    throw error
  }
}

function expiredMessageOf(status: string): string {
  return status === 'expired' ? '红包已过期，未领金额已退回' : '红包已被领完'
}

/* ============================================================
   过期结算
   ============================================================ */

/**
 * 过期退回（必须在事务内调用）。
 *
 * 条件翻转 status='active'→'expired' 占位：命中 0 行说明已被结算或不存在，
 * 直接返回 false，避免重复退款。
 *
 * 条件里同时带 expireAt 已过期，作为防御：调用方都会先判过期，
 * 但即使将来漏判也不会把仍在有效期内的红包提前置为过期。
 */
async function settleRedPacketTx(tx: Tx, redPacketId: number): Promise<boolean> {
  const flipped = await tx.redPacket.updateMany({
    where: { id: redPacketId, status: 'active', expireAt: { lte: new Date() } },
    data: { status: 'expired' },
  })
  if (flipped.count === 0) return false
  const packet = await tx.redPacket.findUnique({
    where: { id: redPacketId },
    select: { senderId: true, totalPoints: true, claimedPoints: true },
  })
  if (!packet) return false
  const refund = packet.totalPoints - packet.claimedPoints
  if (refund > 0) {
    await awardPointsTx(tx, packet.senderId, {
      amount: refund,
      reason: 'redpacket_refund',
      note: '红包过期退回',
    })
  }
  return true
}

/** 过期退回（独立事务；幂等，重复调用安全） */
async function settleRedPacket(redPacketId: number): Promise<boolean> {
  return prisma.$transaction((tx) => settleRedPacketTx(tx, redPacketId))
}

/**
 * 定时扫描兜底：逐个结算已过期的 active 红包，返回本次成功结算的数量。
 *
 * 整函数吞错只打日志（定时器不能崩进程）；单次最多 20 轮、每轮 50 条防呆。
 */
export async function settleExpiredRedPackets(): Promise<number> {
  let settled = 0
  try {
    for (let round = 0; round < 20; round += 1) {
      const rows = await prisma.redPacket.findMany({
        where: { status: 'active', expireAt: { lt: new Date() } },
        orderBy: { id: 'asc' },
        take: 50,
        select: { id: true },
      })
      if (rows.length === 0) break // 本轮已无待结算红包
      for (const row of rows) {
        try {
          if (await settleRedPacket(row.id)) settled += 1
        } catch (err) {
          console.error('[redPacket] 结算过期红包失败:', err instanceof Error ? err.message : err)
        }
      }
    }
  } catch (err) {
    console.error('[redPacket] 过期红包扫描失败:', err instanceof Error ? err.message : err)
  }
  return settled
}
