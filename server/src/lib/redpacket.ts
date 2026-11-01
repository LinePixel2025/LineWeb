/**
 * 聊天积分红包规则（纯函数，禁止 import prisma / 网络依赖）。
 *
 * 红包分两类：
 *   - single（单聊专属）：恰好 1 份，对方领取时拿走全部；
 *   - lucky（群聊拼手气）：N 份按「二倍均值法」随机拆分——每份在
 *     [1, floor(剩余积分/剩余份数×2)] 内随机，并把上限收紧到
 *     剩余积分 - (剩余份数 - 1)，保证后面的每一份都至少还有 1 积分。
 *
 * 金额在发送时一次性扣完（spendPointsTx），24h 未领完由
 * settleRedPacket 惰性退回发送者（reading 时结算 + 定时扫描兜底）。
 */

/** 过期时长：24 小时未领完自动退回 */
export const RED_PACKET_EXPIRE_MS = 24 * 60 * 60 * 1000
/** 单个红包总积分上限 */
export const RED_PACKET_MAX_TOTAL = 50_000
/** 拼手气红包最大份数 */
export const RED_PACKET_MAX_COUNT = 100
/** 祝福语最大长度 */
export const RED_PACKET_MAX_GREETING = 50
/** 空祝福语时的默认文案 */
export const RED_PACKET_DEFAULT_GREETING = '恭喜发财，大吉大利'

export type RedPacketType = 'single' | 'lucky'

/**
 * 二倍均值法拆出一份拼手气红包金额。
 *
 * - `remainingCount <= 1`：最后一份直接拿走剩余全部（保证总额恰好发完）；
 * - 输入不合法（剩余 < 1 或份数 < 1）返回 0 兜底，不抛错；
 * - `rng` 可注入以便确定性测试，默认 Math.random。
 */
export function splitLuckyAmount(
  remainingPoints: number,
  remainingCount: number,
  rng: () => number = Math.random,
): number {
  if (!Number.isFinite(remainingPoints) || !Number.isFinite(remainingCount)) return 0
  const points = Math.floor(remainingPoints)
  const cnt = Math.floor(remainingCount)
  if (points < 1 || cnt < 1) return 0
  if (cnt <= 1) return points
  // 均值上限（二倍均值法）+ 预留下限（剩余份数每份至少 1）
  const meanBound = Math.floor((points / cnt) * 2)
  const reserveBound = points - (cnt - 1)
  const hi = Math.max(1, Math.min(meanBound, reserveBound, points))
  const sampled = 1 + Math.floor(rng() * hi)
  return Math.min(Math.max(sampled, 1), hi)
}

/** 清洗祝福语：trim、截断 ≤50、空回退默认文案 */
export function normalizeRedPacketGreeting(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return RED_PACKET_DEFAULT_GREETING
  return text.slice(0, RED_PACKET_MAX_GREETING)
}

/** 校验通过后的红包创建参数（greeting 已归一化） */
export interface RedPacketValidatedInput {
  type: RedPacketType
  totalPoints: number
  count: number
  greeting: string
}

export type RedPacketValidateResult =
  | { ok: true; value: RedPacketValidatedInput }
  | { ok: false; error: string }

/**
 * 校验红包创建入参（不含会话定向 peer/roomId，由路由层负责）。
 *
 * - single：totalPoints 1..50000，份数强制 1；
 * - lucky：totalPoints 1..50000、count 2..100 且 totalPoints ≥ count
 *   （每份至少 1 积分）。
 */
export function validateRedPacketCreateInput(input: unknown): RedPacketValidateResult {
  if (!input || typeof input !== 'object') return { ok: false, error: '输入数据无效' }
  const raw = input as Record<string, unknown>
  const type = raw.type
  if (type !== 'single' && type !== 'lucky') return { ok: false, error: '红包类型无效' }
  const totalPoints = raw.totalPoints
  if (
    typeof totalPoints !== 'number'
    || !Number.isInteger(totalPoints)
    || totalPoints < 1
    || totalPoints > RED_PACKET_MAX_TOTAL
  ) {
    return { ok: false, error: `红包金额需为 1-${RED_PACKET_MAX_TOTAL} 的整数` }
  }
  if (type === 'single') {
    return {
      ok: true,
      value: { type, totalPoints, count: 1, greeting: normalizeRedPacketGreeting(raw.greeting) },
    }
  }
  const count = raw.count
  if (
    typeof count !== 'number'
    || !Number.isInteger(count)
    || count < 2
    || count > RED_PACKET_MAX_COUNT
  ) {
    return { ok: false, error: `拼手气红包需为 2-${RED_PACKET_MAX_COUNT} 份` }
  }
  if (totalPoints < count) {
    return { ok: false, error: '红包总金额至少为份数（每份至少 1 积分）' }
  }
  return {
    ok: true,
    value: { type, totalPoints, count, greeting: normalizeRedPacketGreeting(raw.greeting) },
  }
}
