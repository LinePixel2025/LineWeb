/**
 * 聊天积分红包类型（与服务端 `/api/chat/xmpp/redpackets` 契约保持一致，服务端由并行代理实现）。
 * 金额与拼手气拆分全部由服务端结算，前端只做发起、展示与领取。
 */

/** 红包类型：single 单聊专属（对方领全部）/ lucky 群聊拼手气（随机拆分） */
export type RedPacketType = 'single' | 'lucky'

/** 红包状态：active 可领取 / finished 已领完 / expired 已过期（未领金额退回） */
export type RedPacketStatus = 'active' | 'finished' | 'expired'

/** 一条领取记录 */
export interface RedPacketClaimDto {
  userId: number
  username: string
  amount: number
  /** 领取时间（ISO 字符串） */
  claimedAt: string
}

/** GET /api/chat/xmpp/redpackets/:id 的响应 */
export interface RedPacketView {
  id: number
  type: RedPacketType
  status: RedPacketStatus
  totalPoints: number
  /** 份数（single 恒为 1） */
  count: number
  claimedCount: number
  claimedPoints: number
  greeting: string
  /** 发送者用户名（弹窗「来自 xxx」展示用） */
  senderName: string
  /** 过期时间（ISO 字符串） */
  expireAt: string
  /** 创建时间（ISO 字符串） */
  createdAt: string
  /** 是否自己发的 */
  isMine: boolean
  /** 自己的领取记录；未领取为 null */
  myClaim: { amount: number; claimedAt: string } | null
  /** 领取明细（claimedAt 升序） */
  claims: RedPacketClaimDto[]
}

/** POST /api/chat/xmpp/redpackets 的响应 */
export interface RedPacketCreateResult {
  id: number
  totalPoints: number
  count: number
  type: RedPacketType
}

/** POST /api/chat/xmpp/redpackets/:id/claim 的响应 */
export interface RedPacketClaimResult {
  /** 本次领到的积分 */
  amount: number
  /** 领取后的最新余额 */
  balance: number
}
