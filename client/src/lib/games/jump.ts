/**
 * 跳一跳纯物理 / 关卡引擎（单机冲分 + 联机共用的常量与几何 helper）
 *
 * 玩法规则来源（微信小游戏「跳一跳」同款手感，已逐条落实到本文件）：
 * - 玩法与中心连击规则：微信官方小游戏「跳一跳」——手指长按屏幕蓄力、松手起跳，
 *   落在盒面 +1 分，连续正中靶心按 +2、+4、+8、+16、+32 翻倍递增，落空即结束。
 *   参考：https://a.9game.cn/wenda/529749.html 、
 *         http://m.candou.com/news/803715.shtml 、
 *         https://m.diiyou.com/gl/142439.html
 * - 开源复刻的实现口径（蓄力时长映射跳跃距离、水平匀速 + 垂直抛物线两轴解耦、
 *   按落点与目标盒的偏差直接判定，不做真实碰撞）：
 *   https://github.com/potato47/jump （CocosCreator + TypeScript 复刻，README 详述落点五分法）
 *   https://blog.csdn.net/weixin_31179927/article/details/165504945 （蓄力→抛物线→落点判定源码解析）
 *   https://juejin.cn/post/6844903966573068302 （等距 2.5D 盒子 + 蓄力时缩放形变的渲染做法）
 *
 * 设计约束：
 * - 纯 TypeScript、无任何 DOM 依赖，可在 vitest 里直接断言；
 * - 常量与判定函数是**前后端唯一真相源**，数值必须与服务端 `gameJump` 引擎逐字一致；
 * - 联机对局的得分由服务端权威判定，本页侧只复用常量、几何与文案。
 */

// ==================== 物理 / 关卡常量（与服务端一致，勿改） ====================

/** 蓄力上限（毫秒）：超过按上限算，防止无脑长按 */
export const JUMP_MAX_CHARGE_MS = 2000
/** 满蓄力跳跃的逻辑距离 */
export const JUMP_MAX_DISTANCE = 260
/** 相邻盒子中心间距下限 */
export const JUMP_GAP_MIN = 60
/** 相邻盒子中心间距上限 */
export const JUMP_GAP_MAX = 150
/** 盒子上表面半宽下限 */
export const JUMP_SIZE_MIN = 26
/** 盒子上表面半宽上限 */
export const JUMP_SIZE_MAX = 36
/** 中心容差 = size * 0.30（落点与盒面中心的偏差在此以内算正中靶心） */
export const JUMP_CENTER_RATIO = 0.30
/** 连击指数封顶（第 5 次连续中心命中起得分不再翻番） */
export const JUMP_COMBO_CAP = 5
/** 单次跳跃得分封顶 */
export const JUMP_MAX_SCORE_GAIN = 32

/** 单机会话预生成的盒子数量（跳完会自动按同一种子续生成，前缀序列不变） */
export const JUMP_SOLO_COURSE_SIZE = 240

/** 联机房间人数上下限（2–6 人轮流各跳一次，同一条盒子路线） */
export const JUMP_MIN_PLAYERS = 2
export const JUMP_MAX_PLAYERS = 6

// ==================== 类型 ====================

/**
 * 一次跳跃的落点判定。
 * `off` 为契约预留值（掉到盒子侧面的极端情形），本引擎只用 `short` / `long` 表示落空。
 */
export type JumpLanding = 'center' | 'normal' | 'short' | 'long' | 'off'

/** 盒子形状：等距棱柱 / 圆柱 */
export type JumpBoxKind = 'box' | 'cylinder'

/** 单机会话状态 */
export type JumpSessionStatus = 'ready' | 'charging' | 'flying' | 'over'

/** 共享盒子序列里的一格（与 `types/game.ts` 的 JumpBoxDto 字段一致） */
export interface JumpBox {
  index: number
  /** 与上一格的中心间距（逻辑单位），第 0 盒为 0 */
  gap: number
  kind: JumpBoxKind
  /** 上表面半宽（逻辑单位），落点判定用 */
  size: number
  /** 特殊盒（音乐盒 / 便利店彩蛋），当前版本恒为 false */
  bonus: boolean
}

/** 落点判定结果 */
export interface JumpResolution {
  kind: JumpLanding
  /** 本次跳跃的实际距离（逻辑单位） */
  distance: number
  /** 落点相对目标盒中心的偏移（右为正） */
  offset: number
}

/** 计分结果 */
export interface JumpScoreResult {
  comboAfter: number
  gained: number
}

/** 单机会话 */
export interface JumpSession {
  seed: number
  course: JumpBox[]
  /** 当前所站盒子序号 */
  boxIndex: number
  score: number
  combo: number
  /** 已跳次数（含终止的那一次） */
  jumps: number
  /** 历次落点偏移的最小绝对值（越小越准；未跳为 Infinity） */
  bestOffset: number
  status: JumpSessionStatus
}

/** 单机一次跳跃的结算 */
export interface JumpSoloResult {
  kind: JumpLanding
  gained: number
  score: number
  combo: number
  boxIndex: number
  offset: number
  distance: number
  /** 目标盒（跳跃指向的那一格） */
  targetIndex: number
  dead: boolean
  /** 结算后会话是否仍在继续（未死即 true） */
  alive: boolean
}

/** 屏幕坐标（逻辑单位，未含镜头平移与缩放） */
export interface JumpScreenPoint {
  x: number
  y: number
}

/** 盒子配色（等距三面：上表面 / 亮面 / 暗面 + 描边） */
export interface JumpBoxColors {
  top: string
  left: string
  right: string
  edge: string
}

// ==================== RNG ====================

/**
 * mulberry32 确定性伪随机数生成器（与 2048 / 贪吃蛇 / 扫雷引擎同算法）。
 * 同一种子产生的序列完全一致，服务端按同一算法生成共享盒子路线。
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 生成一个可用的随机种子 */
export function randomJumpSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
}

// ==================== 物理：蓄力 → 距离 → 落点 → 得分 ====================

/** 把蓄力毫秒数钳制到 0–JUMP_MAX_CHARGE_MS（脏数据一律当 0 处理） */
export function clampJumpCharge(chargeMs: number): number {
  if (!Number.isFinite(chargeMs) || chargeMs <= 0) return 0
  return Math.min(JUMP_MAX_CHARGE_MS, chargeMs)
}

/** 蓄力时长 → 跳跃距离（0–2000 毫秒线性映射到 0–260 逻辑单位） */
export function jumpDistance(chargeMs: number): number {
  return (clampJumpCharge(chargeMs) / JUMP_MAX_CHARGE_MS) * JUMP_MAX_DISTANCE
}

/**
 * 落点判定：`offset = distance - gap`。
 * |offset| <= size*0.30 → center；|offset| <= size → normal；
 * offset < -size → short（跳短了，掉在盒前）；offset > size → long（跳过了，掉在盒后）。
 */
export function resolveJump(chargeMs: number, gap: number, size: number): JumpResolution {
  const distance = jumpDistance(chargeMs)
  const offset = distance - gap
  const centerTolerance = size * JUMP_CENTER_RATIO
  let kind: JumpLanding
  if (Math.abs(offset) <= centerTolerance) kind = 'center'
  else if (Math.abs(offset) <= size) kind = 'normal'
  else if (offset < -size) kind = 'short'
  else kind = 'long'
  return { kind, distance, offset }
}

/** 是否落空（掉出盒子） */
export function jumpIsDead(kind: JumpLanding): boolean {
  return kind === 'short' || kind === 'long' || kind === 'off'
}

/**
 * 计分：正中靶心连击 +1，得分 2^连击（连击封顶 5、单次得分封顶 32，即 2/4/8/16/32）；
 * 普通落盒 +1 且连击归零；落空不得分且连击归零。
 */
export function jumpScore(comboBefore: number, kind: JumpLanding): JumpScoreResult {
  if (kind === 'center') {
    const comboAfter = Math.max(0, Math.floor(comboBefore)) + 1
    const exponent = Math.min(comboAfter, JUMP_COMBO_CAP)
    const gained = Math.min(2 ** exponent, JUMP_MAX_SCORE_GAIN)
    return { comboAfter, gained }
  }
  if (kind === 'normal') return { comboAfter: 0, gained: 1 }
  return { comboAfter: 0, gained: 0 }
}

// ==================== 关卡生成 ====================

/**
 * 按种子生成盒子序列。
 * 第 0 盒 gap = 0（起点盒，没有「与上一格的间距」），尺寸与形状仍按同一 RNG 流取，
 * 因此 `createJumpCourse(seed, n)` 的任意前缀与更长序列一致，续生成不会错位。
 */
export function createJumpCourse(seed: number, count: number): JumpBox[] {
  const total = Math.max(1, Math.floor(count))
  const rnd = mulberry32(seed)
  const boxes: JumpBox[] = []
  for (let index = 0; index < total; index += 1) {
    const gap = index === 0 ? 0 : JUMP_GAP_MIN + rnd() * (JUMP_GAP_MAX - JUMP_GAP_MIN)
    const size = JUMP_SIZE_MIN + rnd() * (JUMP_SIZE_MAX - JUMP_SIZE_MIN)
    const kind: JumpBoxKind = rnd() < 0.32 ? 'cylinder' : 'box'
    boxes.push({ index, gap, kind, size, bonus: false })
  }
  return boxes
}

/** 把序列补到至少 minCount 格（同种子续写，已有前缀保持不变） */
export function ensureJumpCourse(session: JumpSession, minCount: number): JumpBox[] {
  const needed = Math.max(1, Math.floor(minCount))
  if (session.course.length >= needed) return session.course
  const grown = createJumpCourse(session.seed, Math.max(needed, session.course.length * 2))
  session.course = grown
  return grown
}

/** 沿跳跃轴的累计中心距离（第 index 盒相对第 0 盒的逻辑位移） */
export function jumpAxisOfBox(boxes: JumpBox[], index: number): number {
  let axis = 0
  const limit = Math.min(index, boxes.length - 1)
  for (let i = 1; i <= limit; i += 1) axis += boxes[i]?.gap ?? 0
  return axis
}

/** 目标盒上的落点轴坐标（中心 + 偏移） */
export function jumpLandingAxis(boxes: JumpBox[], targetIndex: number, offset: number): number {
  return jumpAxisOfBox(boxes, targetIndex) + offset
}

// ==================== 单机会话 ====================

/** 创建单机会话：站在第 0 盒，0 分、0 连击 */
export function createJumpSession(seed: number = randomJumpSeed()): JumpSession {
  return {
    seed: seed >>> 0,
    course: createJumpCourse(seed, JUMP_SOLO_COURSE_SIZE),
    boxIndex: 0,
    score: 0,
    combo: 0,
    jumps: 0,
    bestOffset: Number.POSITIVE_INFINITY,
    status: 'ready',
  }
}

/** 开始蓄力（仅 ready 状态可用） */
export function beginJumpCharge(session: JumpSession): boolean {
  if (session.status !== 'ready') return false
  session.status = 'charging'
  return true
}

/**
 * 松手结算（原地修改 session）。
 * 已在飞行 / 已结束或落空后调用一律返回「无变化」，避免连点导致分数错乱。
 */
export function finishJump(session: JumpSession, chargeMs: number): JumpSoloResult {
  const snapshot = (
    kind: JumpLanding,
    extra: Partial<JumpSoloResult> = {}
  ): JumpSoloResult => ({
    kind,
    gained: 0,
    score: session.score,
    combo: session.combo,
    boxIndex: session.boxIndex,
    offset: 0,
    distance: 0,
    targetIndex: session.boxIndex,
    dead: false,
    alive: session.status !== 'over',
    ...extra,
  })

  if (session.status === 'over' || session.status === 'flying') {
    return snapshot('off')
  }

  const targetIndex = session.boxIndex + 1
  ensureJumpCourse(session, targetIndex + 1)
  const target = session.course[targetIndex]
  if (!target) return snapshot('off')

  const resolved = resolveJump(chargeMs, target.gap, target.size)
  const { comboAfter, gained } = jumpScore(session.combo, resolved.kind)
  const dead = jumpIsDead(resolved.kind)

  session.jumps += 1
  if (!Number.isFinite(session.bestOffset) || Math.abs(resolved.offset) < session.bestOffset) {
    session.bestOffset = Math.abs(resolved.offset)
  }

  if (dead) {
    session.combo = 0
    session.status = 'over'
  } else {
    session.boxIndex = targetIndex
    session.score += gained
    session.combo = comboAfter
    session.status = 'ready'
  }

  return snapshot(resolved.kind, {
    gained,
    score: session.score,
    combo: session.combo,
    boxIndex: session.boxIndex,
    offset: resolved.offset,
    distance: resolved.distance,
    targetIndex,
    dead,
    alive: !dead,
  })
}

// ==================== 动画 / 渲染几何 helper（两个页面共用） ====================

/** 等距纵向压缩比：沿轴前进 1 单位，屏幕上移 0.5 单位（约 26.5° 的 2:1 等距） */
export const JUMP_ISO_RATIO = 0.5

/**
 * 等距投影：把「沿跳跃轴的逻辑距离 + 离地高度」换成屏幕逻辑坐标（y 轴向下为负）。
 * 页面再乘统一缩放 `scale` 并叠加镜头平移即可。
 */
export function jumpIso(axis: number, lift = 0): JumpScreenPoint {
  const y = -(axis * JUMP_ISO_RATIO + lift)
  return { x: axis, y: y === 0 ? 0 : y }
}

/** 抛物线峰值高度（逻辑单位）：跳得越远拱得越高，但不至于飘出画面 */
export function jumpArcPeak(distance: number): number {
  return 34 + Math.max(0, distance) * 0.30
}

/** 抛物线插值：progress ∈ [0,1] 时的离地高度 */
export function jumpArcLift(distance: number, progress: number): number {
  const p = Math.max(0, Math.min(1, progress))
  return 4 * jumpArcPeak(distance) * p * (1 - p)
}

/**
 * 滞空时长：`min(220 + chargeMs * 0.25, 700)` 毫秒。
 * 满蓄力约 700 毫秒，短按也有 220 毫秒，保证「蓄得越久跳得越远、也在空中久一点」的手感。
 */
export function jumpFlightMs(chargeMs: number): number {
  return Math.min(220 + clampJumpCharge(chargeMs) * 0.25, 700)
}

/** 蓄力压缩形变量（0–0.42）：角色高度按 1 - squash 缩放，宽度反向放大 */
export function jumpSquash(chargeMs: number): number {
  return (clampJumpCharge(chargeMs) / JUMP_MAX_CHARGE_MS) * 0.42
}

/** 力度条比例（0–1） */
export function jumpPowerRatio(chargeMs: number): number {
  return clampJumpCharge(chargeMs) / JUMP_MAX_CHARGE_MS
}

/** 盒子配色：按序号转色相，亮 / 暗主题各一套明度（全部程序化绘制，不用素材） */
export function jumpBoxColors(index: number, dark: boolean): JumpBoxColors {
  const hue = ((Math.floor(index) * 47) % 360 + 360) % 360
  if (dark) {
    return {
      top: `hsl(${hue} 38% 52%)`,
      left: `hsl(${hue} 34% 40%)`,
      right: `hsl(${hue} 36% 30%)`,
      edge: `hsl(${hue} 45% 66%)`,
    }
  }
  return {
    top: `hsl(${hue} 46% 82%)`,
    left: `hsl(${hue} 40% 68%)`,
    right: `hsl(${hue} 42% 57%)`,
    edge: `hsl(${hue} 34% 42%)`,
  }
}

/** 联机玩家小人配色（2–6 人，按 players 数组下标取色） */
export const JUMP_PLAYER_COLORS: string[] = [
  '#0969da', // 蓝
  '#e8590c', // 橙
  '#8250df', // 紫
  '#1a7f37', // 绿
  '#c2255c', // 洋红
  '#0ca678', // 青绿
]

/** 出局 / 掉线玩家的灰色 */
export const JUMP_DEAD_COLOR = '#8c959f'

/** 单机角色色（微信同款深墨色） */
export const JUMP_SOLO_CHARACTER_COLOR = '#2b3138'

/** 按座位取色（越界取模，负数也回到合法色） */
export function jumpColorForSeat(seat: number): string {
  const count = JUMP_PLAYER_COLORS.length
  const index = ((Math.floor(seat) % count) + count) % count
  return JUMP_PLAYER_COLORS[index]
}

/** 落点判定中文文案（联机播报与单机结果都用它） */
export const JUMP_LANDING_TEXT: Record<JumpLanding, string> = {
  center: '正中靶心',
  normal: '稳稳落盒',
  short: '跳短了，掉出盒子',
  long: '跳过了，掉出盒子',
  off: '落空',
}

/** 「某某 + 落点 + 得分」的完整播报 */
export function formatJumpBroadcast(username: string, result: JumpLastLike): string {
  const base = `${username} ${JUMP_LANDING_TEXT[result.kind]}`
  if (result.gained > 0) return `${base} +${result.gained}`
  if (jumpIsDead(result.kind)) return `${base} —— 出局`
  return base
}

/** 播报入参的最小形状（既适配引擎结果，也适配服务端 JumpLastResultDto） */
export interface JumpLastLike {
  kind: JumpLanding
  gained: number
}

/** 落点偏移展示（`+12.3` / `-4.0`，无数据为「—」） */
export function formatJumpOffset(offset: number | null): string {
  if (offset === null || !Number.isFinite(offset)) return '—'
  const value = Math.round(offset * 10) / 10
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`
}

// ==================== 本机记录（localStorage，全部容错） ====================

/** 单机最高分存储键 */
export const JUMP_BEST_STORAGE_KEY = 'lineweb.jump.best'
/** 单机累计战绩存储键 */
export const JUMP_STATS_STORAGE_KEY = 'lineweb.jump.stats'

/** 最小可用的存储接口（jsdom / 隐私模式 / SSR 都可能是 null 或抛异常） */
interface KvStore {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

function getStore(): KvStore | null {
  try {
    const storage = (globalThis as { localStorage?: KvStore }).localStorage
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      return null
    }
    return storage
  } catch {
    return null
  }
}

function safeGet(key: string): string | null {
  const store = getStore()
  if (!store) return null
  try {
    return store.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  const store = getStore()
  if (!store) return
  try {
    store.setItem(key, value)
  } catch {
    // 配额超限 / 隐私模式：仅影响本机记录持久化
  }
}

/** 读取单机最高分（异常或脏数据返回 0） */
export function loadJumpBest(): number {
  const raw = safeGet(JUMP_BEST_STORAGE_KEY)
  if (!raw) return 0
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * 写入单机分数，**只存更高的那一个**。
 * 返回落库后的最高分（存储不可用时返回本次分数，保证 UI 逻辑一致）。
 */
export function saveJumpBest(score: number): number {
  const current = loadJumpBest()
  const safeScore = Number.isFinite(score) && score > 0 ? Math.floor(score) : 0
  if (safeScore === 0) return current
  const next = Math.max(current, safeScore)
  safeSet(JUMP_BEST_STORAGE_KEY, String(next))
  return next
}

/** 单机累计战绩 */
export interface JumpRunStats {
  /** 已玩局数 */
  runs: number
  /** 累计总分（算平均分用） */
  totalScore: number
  /** 累计跳跃次数（算最远/平均距离用） */
  totalJumps: number
  /** 历史最高连击 */
  bestCombo: number
  /** 历局「最准一次落点」的绝对值之和（算平均落点偏差） */
  offsetSum: number
  /** 参与平均的样本数 */
  offsetCount: number
}

function toCount(value: unknown): number {
  const num = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0
}

function toAmount(value: unknown): number {
  const num = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(num) && num > 0 ? num : 0
}

/** 全 0 战绩 */
export function emptyJumpStats(): JumpRunStats {
  return { runs: 0, totalScore: 0, totalJumps: 0, bestCombo: 0, offsetSum: 0, offsetCount: 0 }
}

/** 读取累计战绩（脏数据回退为全 0） */
export function loadJumpStats(): JumpRunStats {
  const raw = safeGet(JUMP_STATS_STORAGE_KEY)
  if (!raw) return emptyJumpStats()
  try {
    const parsed = JSON.parse(raw) as Partial<JumpRunStats>
    return {
      runs: toCount(parsed.runs),
      totalScore: toCount(parsed.totalScore),
      totalJumps: toCount(parsed.totalJumps),
      bestCombo: toCount(parsed.bestCombo),
      offsetSum: toAmount(parsed.offsetSum),
      offsetCount: toCount(parsed.offsetCount),
    }
  } catch {
    return emptyJumpStats()
  }
}

/** 本局元信息（可选，缺省只累计分数） */
export interface JumpRunMeta {
  jumps?: number
  bestCombo?: number
  /** 本局最准一次的落点绝对值（逻辑单位） */
  bestOffset?: number
}

/**
 * 记一局并返回落库后的累计战绩。
 * 局数、总分、跳跃数、最高连击、平均落点偏差都在这里滚动累加。
 */
export function saveJumpRun(score: number, meta: JumpRunMeta = {}): JumpRunStats {
  const current = loadJumpStats()
  const safeScore = Number.isFinite(score) && score > 0 ? Math.floor(score) : 0
  const jumps = toCount(meta.jumps)
  const bestCombo = toCount(meta.bestCombo)
  const bestOffset = toAmount(meta.bestOffset)
  const next: JumpRunStats = {
    runs: current.runs + 1,
    totalScore: current.totalScore + safeScore,
    totalJumps: current.totalJumps + jumps,
    bestCombo: Math.max(current.bestCombo, bestCombo),
    offsetSum: current.offsetSum,
    offsetCount: current.offsetCount,
  }
  if (bestOffset > 0) {
    next.offsetSum = current.offsetSum + bestOffset
    next.offsetCount = current.offsetCount + 1
  }
  safeSet(JUMP_STATS_STORAGE_KEY, JSON.stringify(next))
  return next
}

/** 平均每局得分（无记录为 0） */
export function jumpAverageScore(stats: JumpRunStats): number {
  if (stats.runs <= 0) return 0
  return Math.round((stats.totalScore / stats.runs) * 10) / 10
}

/** 平均落点偏差（逻辑单位，越小越准；无样本为 null） */
export function jumpAverageOffset(stats: JumpRunStats): number | null {
  if (stats.offsetCount <= 0) return null
  return Math.round((stats.offsetSum / stats.offsetCount) * 10) / 10
}
