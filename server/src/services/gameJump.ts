/**
 * 跳一跳纯物理 / 关卡引擎（无状态、无数据库、无网络依赖）
 *
 * 玩法对齐微信小游戏《跳一跳》：长按蓄力 → 松开起跳，蓄力时长决定跳跃距离；
 * 落在下一个盒子（含边缘）算命中，落在中心可连击翻倍，落空即淘汰。
 *
 * 调研结论（规则口径来源）：
 *   - 蓄力时长 → 跳跃距离为线性关系：按压时间 ≈ k × 目标距离（拟合后近似直线），
 *     开源复刻 potato47/jump（CocosCreator + TypeScript）同样是「跳跃距离根据蓄力时间得出」
 *     后直接判定落点、不做真实物理碰撞。见 https://github.com/potato47/jump 与
 *     https://github.com/CharlesLiuyx/CharlesLiuyx.github.io/blob/master/content.json
 *   - 跳过一个盒子 +1 分；连续跳到中心点得分翻倍递增（+2、+4、+8……），
 *     落空（掉出盒子）游戏立即结束。见微信跳一跳规则介绍：
 *     https://zhidao.baidu.com/question/628942922339725452.html 、
 *     https://baijiahao.baidu.com/s?id=1832451731247619672
 *   - 原作中黑胶唱片 / 便利店 / 魔方 / 井盖等特殊盒停留加分（+5～+30）——
 *     本实现不做彩蛋，JumpBoxDto.bonus 恒为 false，字段为后续特殊盒预留。
 *
 * ⚠️ 前后端唯一真相源：以下常量与纯函数签名与前端单机物理实现逐字一致，
 *    任何改动必须同步 client/src/lib/games/ 下的对应实现。
 *    若与网上流传的规则细节（如中心连击原作是 +2/+4/+6 累加口径）有出入，
 *    以本文件常量为准（前端同事按同一份常量并行实现，两边必须完全一致）。
 */

// === 物理与关卡常量（前后端逐字一致，勿改） ===

/** 蓄力上限（毫秒；config 里 zod 已限 1–2000） */
export const JUMP_MAX_CHARGE_MS = 2000
/** 满蓄力可跳的逻辑距离（单位与 gap 同） */
export const JUMP_MAX_DISTANCE = 260
/** 相邻盒子中心间距取值范围 */
export const JUMP_GAP_MIN = 60
export const JUMP_GAP_MAX = 150
/** 盒子上表面半宽取值范围 */
export const JUMP_SIZE_MIN = 26
export const JUMP_SIZE_MAX = 36
/** 中心容差 = size * JUMP_CENTER_RATIO */
export const JUMP_CENTER_RATIO = 0.3
/** 连击指数封顶（2^5 = 32） */
export const JUMP_COMBO_CAP = 5
/** 单次得分封顶 */
export const JUMP_MAX_SCORE_GAIN = 32

// === 类型（与 client/src/types/game.ts 契约一致） ===

/**
 * 一次跳跃的落点判定结果。
 * `off` 为契约预留值，本实现只用 `short`（落在前方可视缝隙）/ `long`（越过盒后）表示落空。
 */
export type JumpLanding = 'center' | 'normal' | 'short' | 'long' | 'off'

/** 共享盒子序列里的一格 */
export interface JumpBoxDto {
  index: number
  /** 与上一格的中心间距（逻辑单位）；第 0 盒恒为 0 */
  gap: number
  kind: 'box' | 'cylinder'
  /** 半宽（逻辑单位），落点判定用 */
  size: number
  /** 是否特殊盒（音乐盒 / 加分盒），预留；本实现恒为 false */
  bonus: boolean
}

// === 蓄力 → 距离 → 落点 ===

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

/**
 * 蓄力时长 → 跳跃距离（线性，满蓄力 = JUMP_MAX_DISTANCE）。
 * chargeMs 先钳制到 [0, JUMP_MAX_CHARGE_MS]，超上限的蓄力不会跳得更远。
 */
export function jumpDistance(chargeMs: number): number {
  return (clamp(chargeMs, 0, JUMP_MAX_CHARGE_MS) / JUMP_MAX_CHARGE_MS) * JUMP_MAX_DISTANCE
}

/**
 * 判定一次跳跃的落点。
 *
 * 口径：distance = jumpDistance(chargeMs)；offset = distance - gap（右为正）。
 * - |offset| <= size * JUMP_CENTER_RATIO → 'center'（含边界）
 * - |offset| <= size → 'normal'（含边缘 ±size，落在盒面上但不是中心）
 * - offset < -size → 'short'（落空，掉在前方缝隙）
 * - offset > size → 'long'（越过，掉在盒后）
 *
 * size 的取值口径统一为「落点所在盒（目标盒）的半宽」——联机服务层
 * 传入的也是目标盒 size，两边必须一致。
 */
export function resolveJump(
  chargeMs: number,
  gap: number,
  size: number,
): { kind: JumpLanding; distance: number; offset: number } {
  const distance = jumpDistance(chargeMs)
  const offset = distance - gap
  let kind: JumpLanding
  if (Math.abs(offset) <= size * JUMP_CENTER_RATIO) kind = 'center'
  else if (Math.abs(offset) <= size) kind = 'normal'
  else if (offset < -size) kind = 'short'
  else kind = 'long'
  return { kind, distance, offset }
}

/**
 * 由「跳跃前的连击数 + 落点」得出跳跃后的连击数与本次得分。
 * - center：comboAfter = comboBefore + 1，gained = min(2^min(comboAfter, 5), 32)
 *   → 第一次中心 +2，连击依次 4 / 8 / 16 / 32，此后封顶 32；
 * - normal：连击归零，+1 分；
 * - short / long / off（落空）：连击归零，不得分。
 */
export function jumpScore(
  comboBefore: number,
  kind: JumpLanding,
): { comboAfter: number; gained: number } {
  if (kind === 'center') {
    const comboAfter = comboBefore + 1
    const gained = Math.min(2 ** Math.min(comboAfter, JUMP_COMBO_CAP), JUMP_MAX_SCORE_GAIN)
    return { comboAfter, gained }
  }
  if (kind === 'normal') return { comboAfter: 0, gained: 1 }
  return { comboAfter: 0, gained: 0 }
}

// === 确定性关卡生成 ===

const RNG_INCREMENT = 0x6d2b79f5

/**
 * mulberry32 随机数发生器（32 位种子），返回 [0, 1)。
 * 与 game2048 的 createSeededRandom 同一算法：0 种子映射为 1，避免退化序列。
 */
export function mulberry32(seed: number): () => number {
  let state = (Math.trunc(seed) >>> 0) || 1
  return () => {
    state = (state + RNG_INCREMENT) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 按 seed 确定性生成盒子序列（同 seed 同 count → 内容恒定）。
 *
 * ⚠️ rng 调用顺序即协议：gap（第 0 盒不消耗随机数）→ size → kind，
 * 前端单机模式必须按同一顺序取数，否则同一 seed 会生成不同路线。
 */
export function createJumpCourse(seed: number, count: number): JumpBoxDto[] {
  const rnd = mulberry32(seed)
  const boxes: JumpBoxDto[] = []
  for (let index = 0; index < count; index += 1) {
    // 顺序固定：gap → size → kind（第 0 盒 gap = 0，不取随机数）
    const gap = index === 0 ? 0 : JUMP_GAP_MIN + rnd() * (JUMP_GAP_MAX - JUMP_GAP_MIN)
    const size = JUMP_SIZE_MIN + rnd() * (JUMP_SIZE_MAX - JUMP_SIZE_MIN)
    const kind = rnd() < 0.32 ? 'cylinder' : 'box'
    boxes.push({ index, gap, kind, size, bonus: false })
  }
  return boxes
}

/**
 * 序列不够长时续生成到 needCount。
 *
 * 幂等实现：从同一 seed 直接按新长度整体重算——mulberry32 序列确定性保证
 * 「同 seed 同长度内容恒定」，且重算结果的任意前缀与原序列逐字段一致，
 * 因此续生成绝不改变已有盒子（服务层按 boxIndex 推进的历史判定不受影响）。
 */
export function ensureJumpCourse(course: JumpBoxDto[], seed: number, needCount: number): JumpBoxDto[] {
  if (course.length >= needCount) return course
  return createJumpCourse(seed, Math.max(needCount, course.length))
}
