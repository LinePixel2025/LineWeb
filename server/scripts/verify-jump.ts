/**
 * 跳一跳服务端引擎 + 联机状态机自检脚本（不依赖数据库 / 网络真实流量）
 *
 * 用法: cd server && npx tsx scripts/verify-jump.ts
 *
 * 覆盖：
 *   - 引擎：常量逐字核对；jumpDistance 单调线性 / 满蓄力 = 260 / 超上限钳制；
 *     resolveJump 五种落点边界（正好中心、中心容差内外、±size 边缘含等号、
 *     刚好差一点 short、刚好过一点 long）；jumpScore 连击 2/4/8/16/32 封顶、
 *     非中心归零；createJumpCourse 同 seed 确定性、gap/size 范围、kind/bonus；
 *     ensureJumpCourse 续生成不改前缀且幂等。
 *   - 服务：建房 → 邀请（接受/拒绝/取消/过期）→ 开始（座位 0 先跳、回合 20 秒、
 *     全局 6 分钟、初始 40 盒）→ 轮流一跳并轮转、中心连击计分（2/4/8…）、
 *     普通命中 +1 且连击归零、非回合 409、越界 400、已出局 409、落空淘汰、
 *     只剩 1 人 last_standing、回合超时自动 short 淘汰（forfeit，含连续多名结算）、
 *     全局 timeout 按分数（分差取胜 / 并列平局）、认输、leave 与房主解散、
 *     非参与者 404、房间上限 6 人、盒子续生成后 DTO 与前缀一致、
 *     掉线 forfeit、等待房间 30 分钟解散、sweep 回收、跨游戏互斥探针。
 *
 * 说明：时间一律用显式 now 参数驱动（不依赖真实定时器）；
 * 开局路线用测试入口固定 seed，脚本按同一 seed 镜像 createJumpCourse 反推
 * 「正好落在中心 / 普通命中 / 必然落空」的蓄力毫秒数来做精确断言；
 * 邀请用测试入口直接登记，避开数据库里的好友关系校验。
 *
 * 注：全员淘汰 → elimination 分支为防御性实现——只剩 1 名存活时对局即刻结束
 * （last_standing），正常流量不可达全员淘汰，与扫雷侧 boom 的同构分支口径一致。
 */

// 依赖模块会读 DATABASE_URL / JWT_SECRET：先给默认值再动态 import，
// Prisma 为惰性连接，只要脚本不触发真实查询就不会碰到数据库。
process.env.DATABASE_URL ||= 'file:./.verify-jump.db'
process.env.JWT_SECRET ||= 'verify-jump-secret'
process.env.NODE_ENV ||= 'development'

type JumpEngine = typeof import('../src/services/gameJump.js')
type JumpService = typeof import('../src/services/gameJumpService.js')
type SnakeService = typeof import('../src/services/gameSnakeService.js')
type DoudizhuService = typeof import('../src/services/gameDoudizhuService.js')
type GameService = typeof import('../src/services/gameService.js')
type PresenceModule = typeof import('../src/services/gamePresence.js')

let engine: JumpEngine
let service: JumpService
let snake: SnakeService
let ddz: DoudizhuService
let game: GameService
let presence: PresenceModule

type JumpBox = ReturnType<JumpEngine['createJumpCourse']>[number]
type MatchDto = ReturnType<JumpService['getJumpMatch']>

let passed = 0

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(`断言失败：${label}`)
  passed += 1
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const actualText = JSON.stringify(actual)
  const expectedText = JSON.stringify(expected)
  if (actualText !== expectedText) {
    throw new Error(`断言失败：${label}\n  实际: ${actualText}\n  期望: ${expectedText}`)
  }
}

function assertNear(actual: number, expected: number, tol: number, label: string): void {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error(`断言失败：${label}\n  实际: ${actual}\n  期望: ${expected} ±${tol}`)
  }
  passed += 1
}

/** 期待同步调用抛错（错误消息包含 keyword） */
function expectThrow(fn: () => unknown, keyword: string, label: string): void {
  try {
    fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes(keyword)) {
      throw new Error(`断言失败：${label} —— 错误消息「${message}」应包含「${keyword}」`)
    }
    passed += 1
    return
  }
  throw new Error(`断言失败：${label} —— 期望抛错（${keyword}）但成功返回`)
}

// === 镜像工具：按同一 seed 复现服务端的权威路线 ===

const TEST_SEED = 20261030

function mirrorCourse(seed: number, count: number): JumpBox[] {
  return engine.createJumpCourse(seed, count)
}

/** 正好落在目标盒中心（offset ≈ 0）的蓄力毫秒数 */
function centerCharge(box: JumpBox): number {
  return (box.gap / engine.JUMP_MAX_DISTANCE) * engine.JUMP_MAX_CHARGE_MS
}

/** 普通命中（offset = 0.6 * size，介于中心容差 0.3*size 与边缘 size 之间）的蓄力 */
function normalCharge(box: JumpBox): number {
  return ((box.gap + box.size * 0.6) / engine.JUMP_MAX_DISTANCE) * engine.JUMP_MAX_CHARGE_MS
}

/** 必然落空（距离 0.65 « gap ≥ 60 → short）的蓄力 */
const MISS_CHARGE = 5

/** 当前回合持有者（进行中对局必须存在） */
function turnHolder(dto: MatchDto): number {
  if (dto.turn === null) throw new Error('断言失败：进行中对局应有当前回合')
  return dto.turn.userId
}

function playerOf(dto: MatchDto, userId: number) {
  const player = dto.players.find((candidate) => candidate.userId === userId)
  if (!player) throw new Error(`断言失败：DTO 中找不到玩家 ${userId}`)
  return player
}

// === 引擎：常量 ===

function verifyEngineConstants(): void {
  assertEqual(
    {
      JUMP_MAX_CHARGE_MS: engine.JUMP_MAX_CHARGE_MS,
      JUMP_MAX_DISTANCE: engine.JUMP_MAX_DISTANCE,
      JUMP_GAP_MIN: engine.JUMP_GAP_MIN,
      JUMP_GAP_MAX: engine.JUMP_GAP_MAX,
      JUMP_SIZE_MIN: engine.JUMP_SIZE_MIN,
      JUMP_SIZE_MAX: engine.JUMP_SIZE_MAX,
      JUMP_CENTER_RATIO: engine.JUMP_CENTER_RATIO,
      JUMP_COMBO_CAP: engine.JUMP_COMBO_CAP,
      JUMP_MAX_SCORE_GAIN: engine.JUMP_MAX_SCORE_GAIN,
    },
    {
      JUMP_MAX_CHARGE_MS: 2000,
      JUMP_MAX_DISTANCE: 260,
      JUMP_GAP_MIN: 60,
      JUMP_GAP_MAX: 150,
      JUMP_SIZE_MIN: 26,
      JUMP_SIZE_MAX: 36,
      JUMP_CENTER_RATIO: 0.3,
      JUMP_COMBO_CAP: 5,
      JUMP_MAX_SCORE_GAIN: 32,
    },
    '物理常量应与前后端唯一真相源逐字一致',
  )
}

// === 引擎：蓄力 → 距离 ===

function verifyJumpDistance(): void {
  assertEqual(engine.jumpDistance(0), 0, '0 蓄力距离应为 0')
  assertEqual(engine.jumpDistance(1000), 130, '半蓄力应跳半个最大距离')
  assertEqual(engine.jumpDistance(engine.JUMP_MAX_CHARGE_MS), engine.JUMP_MAX_DISTANCE, '满蓄力应等于 JUMP_MAX_DISTANCE')
  assertEqual(engine.jumpDistance(5000), engine.JUMP_MAX_DISTANCE, '超过蓄力上限应被钳制在满距离')
  assertEqual(engine.jumpDistance(-10), 0, '负蓄力应被钳制在 0')

  // 单调线性：等间隔取点，增量恒定（钳制区间内）
  let previous = engine.jumpDistance(0)
  let previousStep = -1
  for (let charge = 100; charge <= engine.JUMP_MAX_CHARGE_MS; charge += 100) {
    const current = engine.jumpDistance(charge)
    assert(current > previous, `jumpDistance 应严格单调（charge=${charge}）`)
    const step = current - previous
    if (previousStep >= 0) assertNear(step, previousStep, 1e-9, `等间隔蓄力的距离增量应恒定（线性，charge=${charge}）`)
    previousStep = step
    previous = current
  }
  assertNear(engine.jumpDistance(26), 26 * (260 / 2000), 1e-9, '任意点的距离应严格等于 charge/2000*260')
}

// === 引擎：落点判定 ===

function verifyResolveJump(): void {
  // 取可被二进制精确表示的组合：gap=65，size=32.5 → 中心容差 = 9.75
  const gap = 65
  const size = 32.5
  // charge=500 → distance=16.25 → offset=-48.75 → short；charge=250 → 32.5 → -32.5（正好边缘）
  const edgeLow = engine.resolveJump(250, gap, size)
  assertEqual(edgeLow.kind, 'normal', '|offset| 恰好等于 size 时应判 normal（含边界）')
  assertEqual(edgeLow.offset, -32.5, 'offset = distance - gap 应精确（-size）')
  const justShort = engine.resolveJump(240, gap, size)
  assertEqual(justShort.kind, 'short', '刚好差一点（offset < -size）应判 short 落空')
  assert(justShort.offset < -size, 'short 的 offset 应小于 -size')
  // charge=750 → 97.5 → +32.5（正好边缘）；charge=760 → 98.8 → +33.8 → long
  const edgeHigh = engine.resolveJump(750, gap, size)
  assertEqual(edgeHigh.kind, 'normal', 'offset 恰好等于 +size 时应判 normal（含边界）')
  assertEqual(edgeHigh.offset, 32.5, 'offset 应精确（+size）')
  const justLong = engine.resolveJump(760, gap, size)
  assertEqual(justLong.kind, 'long', '刚好过一点（offset > size）应判 long 落空')
  assert(justLong.offset > size, 'long 的 offset 应大于 +size')

  // 正好中心：charge=1000 → distance=130，gap=130 → offset=0
  const dead = engine.resolveJump(1000, 130, 30)
  assertEqual(dead.kind, 'center', 'offset=0 应判 center')
  assertEqual(dead.distance, 130, 'resolveJump 应回传距离')
  assertEqual(dead.offset, 0, 'resolveJump 应回传偏移')

  // 中心容差内 / 外的稳健样本（size=30 → 容差 9）
  const insideTol = engine.resolveJump(((130 + 30 * 0.29) / 260) * 2000, 130, 30)
  assertEqual(insideTol.kind, 'center', '中心容差 0.29*size 内应判 center')
  assert(insideTol.offset > 30 * 0.28, '中心样本的 offset 量级应与设定一致')
  const outsideTol = engine.resolveJump(((130 + 30 * 0.32) / 260) * 2000, 130, 30)
  assertEqual(outsideTol.kind, 'normal', '0.32*size（容差外、边缘内）应判 normal')
  const negNormal = engine.resolveJump(((130 - 30 * 0.9) / 260) * 2000, 130, 30)
  assertEqual(negNormal.kind, 'normal', '-0.9*size（边缘内）应判 normal')
  const negShort = engine.resolveJump(((130 - 30 * 1.1) / 260) * 2000, 130, 30)
  assertEqual(negShort.kind, 'short', '-1.1*size（边缘外前方）应判 short')
  const posLong = engine.resolveJump(((130 + 30 * 1.1) / 260) * 2000, 130, 30)
  assertEqual(posLong.kind, 'long', '+1.1*size（越过盒后）应判 long')

  // 蓄力超上限被钳制：即使 gap 很近也不会「跳过」
  const clampedLong = engine.resolveJump(9999, 10, 30)
  assertEqual(clampedLong.distance, engine.JUMP_MAX_DISTANCE, '超上限蓄力距离应钳制为满距离')
  assertEqual(clampedLong.kind, 'long', '满距离远超 gap 时应判 long')

  // 落空时 offset 符号约定：short 为负、long 为正
  assert(engine.resolveJump(MISS_CHARGE, 100, 30).offset < 0, 'short 的 offset 应为负（落点不足）')
}

// === 引擎：计分 ===

function verifyJumpScore(): void {
  assertEqual(engine.jumpScore(0, 'center'), { comboAfter: 1, gained: 2 }, '第一次中心命中应 +2')
  assertEqual(engine.jumpScore(1, 'center'), { comboAfter: 2, gained: 4 }, '连击 2 应 +4')
  assertEqual(engine.jumpScore(2, 'center'), { comboAfter: 3, gained: 8 }, '连击 3 应 +8')
  assertEqual(engine.jumpScore(3, 'center'), { comboAfter: 4, gained: 16 }, '连击 4 应 +16')
  assertEqual(engine.jumpScore(4, 'center'), { comboAfter: 5, gained: 32 }, '连击 5 应 +32（封顶值）')
  assertEqual(engine.jumpScore(5, 'center'), { comboAfter: 6, gained: 32 }, '连击超过 5 应封顶 32')
  assertEqual(engine.jumpScore(99, 'center'), { comboAfter: 100, gained: 32 }, '任意深连击都封顶 32')
  assertEqual(engine.jumpScore(4, 'normal'), { comboAfter: 0, gained: 1 }, '非中心命中应 +1 且连击归零')
  assertEqual(engine.jumpScore(3, 'short'), { comboAfter: 0, gained: 0 }, '落空 short 不得分且连击归零')
  assertEqual(engine.jumpScore(3, 'long'), { comboAfter: 0, gained: 0 }, '落空 long 不得分且连击归零')
  assertEqual(engine.jumpScore(3, 'off'), { comboAfter: 0, gained: 0 }, '预留 off 同按落空处理')
  // 连击链整体核对：2 + 4 + 8 + 16 + 32 + 32
  let combo = 0
  let total = 0
  for (let round = 0; round < 6; round += 1) {
    const step = engine.jumpScore(combo, 'center')
    combo = step.comboAfter
    total += step.gained
  }
  assertEqual(total, 2 + 4 + 8 + 16 + 32 + 32, '六连中心累计得分应为 94（2/4/8/16/32/32）')
}

// === 引擎：确定性路线 ===

function verifyCourse(): void {
  const a = mirrorCourse(TEST_SEED, 40)
  const b = mirrorCourse(TEST_SEED, 40)
  const c = mirrorCourse(TEST_SEED + 1, 40)
  assertEqual(a, b, '同 seed 同长度应生成完全相同的路线')
  assert(JSON.stringify(a) !== JSON.stringify(c), '不同 seed 应生成不同路线')
  assertEqual(a.length, 40, '路线长度应等于 count')
  assertEqual(engine.createJumpCourse(TEST_SEED, 0), [], 'count=0 应生成空路线')

  let cylinderCount = 0
  a.forEach((box, index) => {
    assertEqual(box.index, index, '第 index 盒的 index 字段应等于下标')
    if (index === 0) assertEqual(box.gap, 0, '第 0 盒 gap 应为 0')
    else assert(box.gap >= engine.JUMP_GAP_MIN && box.gap <= engine.JUMP_GAP_MAX, `第 ${index} 盒 gap 应在 [${engine.JUMP_GAP_MIN}, ${engine.JUMP_GAP_MAX}]`)
    assert(box.size >= engine.JUMP_SIZE_MIN && box.size <= engine.JUMP_SIZE_MAX, `第 ${index} 盒 size 应在 [${engine.JUMP_SIZE_MIN}, ${engine.JUMP_SIZE_MAX}]`)
    assert(box.kind === 'box' || box.kind === 'cylinder', `第 ${index} 盒 kind 应为 box 或 cylinder`)
    assertEqual(box.bonus, false, 'bonus 应恒为 false（特殊盒预留）')
    if (box.kind === 'cylinder') cylinderCount += 1
  })
  assert(cylinderCount > 0 && cylinderCount < 40, '两种 kind 都应在长路线中出现（rng 正常混排）')

  // 续生成：不改前缀、幂等、可再续
  const extended = engine.ensureJumpCourse(a, TEST_SEED, 80)
  assertEqual(extended.length, 80, 'ensureJumpCourse 应续生成到 needCount')
  assertEqual(extended.slice(0, 40), a, '续生成绝不应改变已有前缀')
  assertEqual(extended, mirrorCourse(TEST_SEED, 80), '续生成结果应与直接生成同长度一致（确定性）')
  const same = engine.ensureJumpCourse(a, TEST_SEED, 40)
  assertEqual(same, a, '长度已够时 ensureJumpCourse 应原样返回')
  const shrunk = engine.ensureJumpCourse(extended, TEST_SEED, 10)
  assertEqual(shrunk, extended, 'needCount 小于现有长度时不应截断')
  const twice = engine.ensureJumpCourse(extended, TEST_SEED, 100)
  assertEqual(twice.slice(0, 80), extended, '多次续生成仍应保持前缀稳定')
}

// === 服务：建房 → 邀请 → 接受 → 开始 → 轮流一跳 ===

function verifyMatchFlow(): void {
  service.resetJumpStateForTest()
  const base = Date.now()
  const HOST = 8101
  const GUEST = 8102
  const OUTSIDER = 8103
  const course = mirrorCourse(TEST_SEED, 40)

  const { matchId } = service.createJumpRoomForTest(HOST, `u${HOST}`, [], base, { seed: TEST_SEED })
  const waiting = service.getJumpMatch(HOST, matchId, base)
  assertEqual(waiting.game, 'jump', 'DTO 的 game 应为 jump（前端据此判别游戏）')
  assertEqual(waiting.status, 'waiting', '新建房间应为等待状态')
  assertEqual(waiting.turn, null, '等待房间不应有当前回合')
  assertEqual(waiting.boxes, [], '等待房间不应有盒子序列（开局才生成）')
  assertEqual(waiting.lastResult, null, '等待房间不应有跳跃结果')
  assertEqual(waiting.winnerId, null, '等待房间不应有胜者')
  assertEqual(waiting.reason, null, '等待房间不应有结束原因')
  assertEqual(waiting.endedAt, null, '等待房间不应有结束时间')
  assertEqual(waiting.players.length, 1, '等待房间应只有房主')
  assertEqual(waiting.players[0].status, 'waiting', '等待房间玩家状态应为 waiting')
  assertEqual(waiting.players[0].boxIndex, null, '等待房间玩家 boxIndex 应为 null')
  assertEqual(waiting.players[0].offset, null, '等待房间玩家 offset 应为 null')
  assertEqual({ score: waiting.players[0].score, combo: waiting.players[0].combo, jumps: waiting.players[0].jumps }, { score: 0, combo: 0, jumps: 0 }, '等待房间玩家计分应为 0')
  assertEqual(typeof waiting.players[0].online, 'boolean', 'DTO 应给出玩家在线状态')
  expectThrow(() => service.startJumpMatch(HOST, matchId, base), '至少需要 2', '1 人房间开局应被拒绝')
  expectThrow(() => service.applyJumpAction(HOST, matchId, { type: 'jump', chargeMs: 500 }, base), '未开始', '等待房间提交动作应 409')

  // === 邀请：列表 / 接受 / 拒绝 / 取消 / 过期 ===
  const invite = service.createJumpInviteForTest(HOST, GUEST, matchId, base + 1)
  const incoming = service.listJumpInvites(GUEST, base + 2)
  assertEqual(incoming.incoming.length, 1, '受邀方应看到 1 条待处理邀请')
  assertEqual(incoming.incoming[0].game, 'jump', '邀请 DTO 的 game 应为 jump')
  assertEqual(incoming.incoming[0].matchId, matchId, '邀请应指向房主的等待房间')
  assertEqual(
    incoming.incoming[0].expiresAt,
    new Date(base + 1 + service.JUMP_INVITE_TTL_MS).toISOString(),
    '邀请有效期应复用 GAME_INVITE_TTL_MS（60 秒）',
  )
  expectThrow(() => service.respondJumpInvite(OUTSIDER, invite.inviteId, 'accept', base + 3), '邀请不存在', '非受邀方响应邀请应 404')
  const accepted = service.respondJumpInvite(GUEST, invite.inviteId, 'accept', base + 4)
  assertEqual(accepted.ok, true, '接受邀请应返回 ok')
  assertEqual(accepted.match!.players.length, 2, '接受邀请后房间应有 2 人')
  assertEqual(service.listJumpInvites(GUEST, base + 5).incoming.length, 0, '接受后邀请应被清理')

  const declineInvite = service.createJumpInviteForTest(HOST, 8104, matchId, base + 5)
  const declined = service.respondJumpInvite(8104, declineInvite.inviteId, 'decline', base + 6)
  assertEqual(declined.ok, true, '拒绝邀请应返回 ok')
  assertEqual(declined.match, undefined, '拒绝邀请不应返回房间')
  const cancelInvite = service.createJumpInviteForTest(HOST, 8105, matchId, base + 7)
  expectThrow(() => service.cancelJumpInvite(8106, cancelInvite.inviteId, base + 8), '邀请不存在', '非发起方取消邀请应 404')
  assertEqual(service.cancelJumpInvite(HOST, cancelInvite.inviteId, base + 9), { ok: true }, '发起方应能取消邀请')
  const staleInvite = service.createJumpInviteForTest(HOST, 8107, matchId, base + 10)
  expectThrow(
    () => service.respondJumpInvite(8107, staleInvite.inviteId, 'accept', base + 10 + service.JUMP_INVITE_TTL_MS),
    '已过期',
    '过期邀请接受应 410',
  )

  // === 开局 ===
  expectThrow(() => service.startJumpMatch(GUEST, matchId, base + 11), '房主', '非房主开局应被拒绝')
  const started = service.startJumpMatch(HOST, matchId, base + 12)
  assertEqual(started.match.status, 'playing', '房主开始后应进入进行中对局')
  assertEqual(started.match.turn, {
    userId: HOST,
    deadline: new Date(base + 12 + service.JUMP_TURN_MS).toISOString(),
  }, '开局应由座位 0（房主）先跳，回合 20 秒')
  assertEqual(started.match.startedAt, new Date(base + 12).toISOString(), 'startedAt 应为开局时间')
  assertEqual(
    started.match.endsAt,
    new Date(base + 12 + service.JUMP_DEFAULT_DURATION_MS).toISOString(),
    'endsAt 应为开局时间 + 默认 6 分钟',
  )
  assertEqual(started.match.boxes.length, service.JUMP_INITIAL_BOXES, '开局应生成 40 个盒子')
  assertEqual(started.match.boxes, course, '开局路线应与同 seed 的 createJumpCourse 完全一致')
  assertEqual(started.match.players.map((player) => player.status), ['playing', 'playing'], '开局后玩家应为 playing')
  assertEqual(started.match.players.map((player) => player.userId), [HOST, GUEST], 'players 应按座位顺序排列')
  assertEqual(started.match.players.map((player) => player.boxIndex), [0, 0], '每位玩家应从事 0 号盒起步')
  expectThrow(() => service.startJumpMatch(HOST, matchId, base + 13), '已经开始', '重复开局应 409')

  // === 非回合 / 越界 / 非参与者 ===
  expectThrow(() => service.applyJumpAction(GUEST, matchId, { type: 'jump', chargeMs: centerCharge(course[1]) }, base + 14), '还没轮到你', '非回合玩家起跳应 409「还没轮到你」')
  expectThrow(() => service.applyJumpAction(OUTSIDER, matchId, { type: 'jump', chargeMs: 500 }, base + 14), '对局不存在', '非参与者操作应 404')
  expectThrow(() => service.getJumpMatch(OUTSIDER, matchId, base + 14), '对局不存在', '非参与者查询对局应 404')
  expectThrow(() => service.applyJumpAction(HOST, matchId, { type: 'jump', chargeMs: 0 }, base + 14), '蓄力时长', 'chargeMs < 1 应 400')
  expectThrow(() => service.applyJumpAction(HOST, matchId, { type: 'jump', chargeMs: 2001 }, base + 14), '蓄力时长', 'chargeMs > 2000 应 400')
  expectThrow(() => service.applyJumpAction(HOST, matchId, { type: 'jump', chargeMs: Number.NaN }, base + 14), '蓄力时长', '非有限数值应 400')

  // === 中心命中 +2，立即轮转 ===
  const first = service.applyJumpAction(HOST, matchId, { type: 'jump', chargeMs: centerCharge(course[1]) }, base + 20)
  assertEqual(first.match.turn!.userId, GUEST, '一跳之后应立即轮到下一名玩家')
  assertEqual(first.match.turn!.deadline, new Date(base + 20 + service.JUMP_TURN_MS).toISOString(), '新回合 deadline 应从本次动作时间起算')
  assertNear(first.match.lastResult!.offset, 0, 1e-6, '中心命中的 offset 应接近 0')
  assertEqual({ ...first.match.lastResult!, offset: 0 }, { userId: HOST, kind: 'center', gained: 2, offset: 0, scoreAfter: 2, comboAfter: 1 }, '第一次中心命中应 +2、连击 1')
  const hostDto = playerOf(first.match, HOST)
  assertEqual({ boxIndex: hostDto.boxIndex, jumps: hostDto.jumps, score: hostDto.score, combo: hostDto.combo }, { boxIndex: 1, jumps: 1, score: 2, combo: 1 }, '命中后应前进一格并累计跳数')
  assert(hostDto.offset !== null && Math.abs(hostDto.offset) < 1e-6, '玩家 DTO 的 offset 应记录落点偏移')
  assert(first.match.version > started.match.version, '有效跳跃应递增版本')

  // === 普通命中 +1 且连击归零（GUEST 先中心一次再普通一次） ===
  const guestCenter = service.applyJumpAction(GUEST, matchId, { type: 'jump', chargeMs: centerCharge(course[1]) }, base + 21)
  assertEqual(guestCenter.match.lastResult!.kind, 'center', '受邀方第一跳应为中心命中')
  const hostAgain = service.applyJumpAction(HOST, matchId, { type: 'jump', chargeMs: centerCharge(course[2]) }, base + 22)
  assertEqual({ ...hostAgain.match.lastResult!, offset: 0 }, { userId: HOST, kind: 'center', gained: 4, offset: 0, scoreAfter: 6, comboAfter: 2 }, '第二次连续中心应 +4（连击翻倍）')
  const guestNormal = service.applyJumpAction(GUEST, matchId, { type: 'jump', chargeMs: normalCharge(course[2]) }, base + 23)
  assert(guestNormal.match.lastResult!.kind === 'normal', '0.6*size 偏移应判 normal')
  assertEqual({ gained: guestNormal.match.lastResult!.gained, comboAfter: guestNormal.match.lastResult!.comboAfter, scoreAfter: guestNormal.match.lastResult!.scoreAfter }, { gained: 1, comboAfter: 0, scoreAfter: 3 }, '普通命中应 +1 且连击归零')
  const guestDto = playerOf(guestNormal.match, GUEST)
  assertEqual({ boxIndex: guestDto.boxIndex, combo: guestDto.combo, score: guestDto.score }, { boxIndex: 2, combo: 0, score: 3 }, '普通命中同样前进一格')
  assertEqual(guestNormal.match.turn!.userId, HOST, '普通命中后同样轮转')

  // === 连击继续翻倍：HOST 第三连中心 +8 ===
  const hostThird = service.applyJumpAction(HOST, matchId, { type: 'jump', chargeMs: centerCharge(course[3]) }, base + 24)
  assertEqual({ ...hostThird.match.lastResult!, offset: 0 }, { userId: HOST, kind: 'center', gained: 8, offset: 0, scoreAfter: 14, comboAfter: 3 }, '第三次连续中心应 +8')

  // === sync / active 查询口径 ===
  const sync = service.getJumpSync(HOST, matchId, base + 25)
  assertEqual(sync.serverTime, new Date(base + 25).toISOString(), 'sync 应返回服务端时间')
  assertEqual(sync.match?.id, matchId, 'sync 指定 matchId 时应返回该对局')
  assertEqual(sync.invites.incoming, [], 'sync 应携带邀请结构 incoming')
  assertEqual(sync.invites.outgoing, [], 'sync 应携带邀请结构 outgoing')
  assertEqual(service.getActiveJumpMatch(HOST, base + 26)?.id, matchId, '进行中对局应能被主动查询到')
  assertEqual(sync.match!.boxes, guestNormal.match.boxes, '同一时刻 DTO 的盒子序列应稳定一致')
}

// === 服务：落空淘汰 / last_standing ===

function verifyMissAndElimination(): void {
  service.resetJumpStateForTest()
  const base = Date.now()
  const seed = TEST_SEED + 100
  const course = mirrorCourse(seed, 60)
  const room = service.createJumpRoomForTest(8201, 'u8201', [8202, 8203], base, { seed })
  service.startJumpMatch(8201, room.matchId, base)

  // 座位 0 落空 → 淘汰但对局继续（还剩 2 人），并轮到座位 1
  const miss = service.applyJumpAction(8201, room.matchId, { type: 'jump', chargeMs: MISS_CHARGE }, base + 1)
  assertEqual(miss.match.status, 'playing', '三人局中一人落空后对局应继续')
  assertEqual(miss.match.reason, null, '对局继续时不应有结束原因')
  assertEqual(miss.match.lastResult!.userId, 8201, 'lastResult 应记录落空玩家')
  assertEqual(miss.match.lastResult!.kind, 'short', '近乎 0 蓄力应判 short 落空')
  assertEqual(miss.match.lastResult!.gained, 0, '落空不得分')
  assertEqual(miss.match.lastResult!.comboAfter, 0, '落空连击归零')
  assertEqual(miss.match.lastResult!.scoreAfter, 0, '落空分数不变（scoreAfter=0）')
  assert(miss.match.lastResult!.offset < -engine.JUMP_SIZE_MAX, '近乎 0 蓄力的 offset 应远小于 -size（落前方缝隙）')
  const missDto = playerOf(miss.match, 8201)
  assertEqual({ status: missDto.status, boxIndex: missDto.boxIndex, combo: missDto.combo, jumps: missDto.jumps }, { status: 'lost', boxIndex: null, combo: 0, jumps: 1 }, '落空玩家应淘汰：lost、boxIndex=null、连击归零、跳数仍累计')
  assert(missDto.offset !== null, '淘汰后仍保留最后一次 offset（供客户端播放坠落动画）')
  assertEqual(miss.match.turn!.userId, 8202, '回合应跳过被淘汰者交给下一名在场玩家')

  // 座位 1 也落空 → 只剩 1 人 → last_standing
  const finished = service.applyJumpAction(8202, room.matchId, { type: 'jump', chargeMs: MISS_CHARGE }, base + 2)
  assertEqual(finished.match.status, 'finished', '只剩一名存活玩家时对局应结束')
  assertEqual(finished.match.reason, 'last_standing', '因他人落空淘汰而决出胜者时结束原因应为 last_standing')
  assertEqual(finished.match.winnerId, 8203, '最后存活者应获胜')
  assertEqual(finished.match.turn, null, '已结束对局的 turn 应为 null')
  assertEqual(playerOf(finished.match, 8203).status, 'won', '胜者状态应为 won')
  assertEqual(finished.match.players.filter((player) => player.status === 'lost').length, 2, '两名落空者都应为 lost')
  expectThrow(() => service.applyJumpAction(8203, room.matchId, { type: 'jump', chargeMs: 500 }, base + 3), '已结束', '已结束对局提交动作应 409')
  assertEqual(service.getActiveJumpMatch(8203, base + 3), null, '主动查询不应返回已结束对局')
  assertEqual(service.getJumpSync(8203, room.matchId, base + 3).match?.reason, 'last_standing', 'sync 指定 matchId 时应能补拉已结束对局')

  // 落空的另一支：long（越过盒子）——直接构造超过满距离能覆盖的 gap 场景用引擎验证，
  // 服务侧验证「命中后继续前进、最后 long 淘汰」用大蓄力打近距离盒
  const longRoom = service.createJumpRoomForTest(8211, 'u8211', [8212], base, { seed: TEST_SEED + 101 })
  const longCourse = mirrorCourse(TEST_SEED + 101, 60)
  service.startJumpMatch(8211, longRoom.matchId, base)
  const smallGapBox = longCourse[1]
  // 目标 gap 最小 60：满蓄力 260 远超 gap + size → long
  const longed = service.applyJumpAction(8211, longRoom.matchId, { type: 'jump', chargeMs: engine.JUMP_MAX_CHARGE_MS }, base + 1)
  assertEqual(longed.match.lastResult!.kind, 'long', '满蓄力打近距离盒应判 long 落空')
  assert(longed.match.lastResult!.offset > smallGapBox.size, 'long 的 offset 应大于目标盒 size')
  assertEqual(playerOf(longed.match, 8211).status, 'lost', 'long 同样淘汰')
  assertEqual(longed.match.reason, 'last_standing', '二人局 long 淘汰后应由另一人获胜')
  assertEqual(longed.match.winnerId, 8212, 'long 淘汰的胜者应为另一玩家')
}

// === 服务：认输 / 离开 / 房间上限 ===

function verifyResignLeaveAndCapacity(): void {
  service.resetJumpStateForTest()
  const base = Date.now()

  // === 认输：3 人局一人认输继续（分数保留），只剩 1 人按 resign 决出胜者 ===
  const room = service.createJumpRoomForTest(8301, 'u8301', [8302, 8303], base, { seed: TEST_SEED + 200 })
  const course = mirrorCourse(TEST_SEED + 200, 40)
  service.startJumpMatch(8301, room.matchId, base)
  service.applyJumpAction(8301, room.matchId, { type: 'jump', chargeMs: centerCharge(course[1]) }, base + 1)
  const resigned = service.resignJumpMatch(8302, room.matchId, base + 2)
  assertEqual(resigned.match.status, 'playing', '三人局中一人认输后对局应继续')
  const resignedDto = playerOf(resigned.match, 8302)
  assertEqual(resignedDto.status, 'lost', '认输玩家应为 lost')
  assertEqual(resignedDto.score, 0, '认输不应改动分数（保留）')
  assertEqual(resignedDto.boxIndex, null, '认输淘汰后 boxIndex 应为 null')
  expectThrow(() => service.resignJumpMatch(8302, room.matchId, base + 3), '你已出局', '重复认输应 409')
  expectThrow(() => service.applyJumpAction(8302, room.matchId, { type: 'jump', chargeMs: 500 }, base + 4), '你已出局', '已出局玩家操作应 409')
  service.applyJumpAction(8303, room.matchId, { type: 'jump', chargeMs: centerCharge(course[1]) }, base + 5)
  const hostResign = service.resignJumpMatch(8301, room.matchId, base + 6)
  assertEqual(hostResign.match.status, 'finished', '只剩 8303 在场时对局应结束')
  assertEqual(hostResign.match.reason, 'resign', '因认输决出胜者时结束原因应为 resign')
  assertEqual(hostResign.match.winnerId, 8303, '最后在场者应获胜')

  // === 等待房间：普通玩家离开不移除房间；房主离开解散 ===
  const waitingRoom = service.createJumpRoomForTest(8311, 'u8311', [8312, 8313], base + 10)
  const leftMember = service.leaveJumpMatch(8313, waitingRoom.matchId, base + 11)
  assertEqual(leftMember.dissolved, false, '普通玩家离开不应解散房间')
  assertEqual(service.getJumpMatch(8311, waitingRoom.matchId, base + 12).players.length, 2, '离开后房间应剩 2 人')
  expectThrow(() => service.leaveJumpMatch(8399, waitingRoom.matchId, base + 13), '房间不存在', '非参与者离开应 404')
  const started2 = service.startJumpMatch(8311, waitingRoom.matchId, base + 14)
  expectThrow(
    () => service.leaveJumpMatch(8312, waitingRoom.matchId, base + 15),
    '对局进行中',
    '进行中且本人仍在场时不能走 leave（须先认输）',
  )
  assertEqual(started2.match.status, 'playing', '开局后应正常进行')

  const hostRoom = service.createJumpRoomForTest(8321, 'u8321', [8322], base + 16)
  const leftHost = service.leaveJumpMatch(8321, hostRoom.matchId, base + 17)
  assertEqual(leftHost.dissolved, true, '房主离开应解散房间')
  const dissolved = service.getJumpMatch(8322, hostRoom.matchId, base + 18)
  assertEqual(dissolved.status, 'finished', '解散后房间应为已结束')
  assertEqual(dissolved.reason, 'cancelled', '解散原因应为 cancelled')
  assertEqual(dissolved.winnerId, null, '解散不应有胜者')
  expectThrow(() => service.startJumpMatch(8322, hostRoom.matchId, base + 19), '已经开始', '解散后不应能开局')

  // === 房间上限 6 人 ===
  const full = service.createJumpRoomForTest(8331, 'u8331', [8332, 8333, 8334, 8335, 8336], base + 20)
  assertEqual(service.getJumpMatch(8331, full.matchId, base + 21).players.length, 6, '建房入口应能拉满 6 人')
  const overflow = service.createJumpInviteForTest(8331, 8337, full.matchId, base + 22)
  expectThrow(() => service.respondJumpInvite(8337, overflow.inviteId, 'accept', base + 23), '房间已满', '第 7 人接受邀请应被拒绝')
  const fullStarted = service.startJumpMatch(8331, full.matchId, base + 24)
  assertEqual(fullStarted.match.players.length, service.JUMP_MAX_PLAYERS, '开局人数应为房间上限 6 人')
  assertEqual(
    fullStarted.match.players.map((player) => player.userId),
    [8331, 8332, 8333, 8334, 8335, 8336],
    'players 应严格按座位顺序排列',
  )
  assertEqual(
    fullStarted.match.turn,
    { userId: 8331, deadline: new Date(base + 24 + service.JUMP_TURN_MS).toISOString() },
    '开局先手应为座位 0',
  )
  // 回合应按座位循环（跳过空位概念：全部在场时逐座位推进）
  let seatDto = fullStarted.match
  const seats: number[] = [seatDto.turn!.userId]
  for (let step = 0; step < 5; step += 1) {
    const holder = seatDto.turn!.userId
    const boxIndex = playerOf(seatDto, holder).boxIndex!
    const boxes = seatDto.boxes
    seatDto = service.applyJumpAction(holder, full.matchId, { type: 'jump', chargeMs: centerCharge(boxes[boxIndex + 1]) }, base + 25 + step).match
    seats.push(seatDto.turn!.userId)
  }
  assertEqual(seats, [8331, 8332, 8333, 8334, 8335, 8336], '回合应按座位循环推进')
}

// === 服务：回合超时 / 全局超时 ===

function verifyTimeouts(): void {
  service.resetJumpStateForTest()
  const base = Date.now()

  // === 二人局：回合超时 → 自动近乎 0 蓄力起跳 → short 落空淘汰 → forfeit 决出胜者 ===
  const room = service.createJumpRoomForTest(8401, 'u8401', [8402], base, { seed: TEST_SEED + 300 })
  service.startJumpMatch(8401, room.matchId, base)
  const timedOut = service.getJumpMatch(8401, room.matchId, base + service.JUMP_TURN_MS + 1_000)
  assertEqual(timedOut.status, 'finished', '二人局当前回合玩家超时后应因只剩 1 人而结束')
  assertEqual(timedOut.reason, 'forfeit', '回合超时淘汰导致的结束原因应为 forfeit')
  assertEqual(timedOut.winnerId, 8402, '应由未超时的另一名玩家获胜')
  assertEqual(timedOut.turn, null, '结束后 turn 应为 null')
  const loserDto = playerOf(timedOut, 8401)
  assertEqual({ status: loserDto.status, boxIndex: loserDto.boxIndex, combo: loserDto.combo, jumps: loserDto.jumps }, { status: 'lost', boxIndex: null, combo: 0, jumps: 1 }, '超时玩家应被自动起跳淘汰（跳数仍累计）')
  assertEqual(timedOut.lastResult!.kind, 'short', '自动起跳应判 short 落空')
  assertEqual(timedOut.lastResult!.userId, 8401, 'lastResult 应记录被结算的玩家')
  assert(timedOut.lastResult!.offset < 0, 'short 的 offset 应为负')

  // === 三人局：一次读取连续结算多名超时（deadline 顺延链） ===
  service.resetJumpStateForTest()
  const threeRoom = service.createJumpRoomForTest(8411, 'u8411', [8412, 8413], base, { seed: TEST_SEED + 301 })
  service.startJumpMatch(8411, threeRoom.matchId, base)
  const chain = service.getJumpMatch(8411, threeRoom.matchId, base + service.JUMP_TURN_MS * 3 + 1_000)
  assertEqual(chain.status, 'finished', '三次连续超时后应淘汰前两名并结束')
  assertEqual(chain.reason, 'forfeit', '回合超时连续结算的结束原因应为 forfeit')
  assertEqual(chain.winnerId, 8413, '座位 2 是第三次超时的下一个在场者，应由其获胜')
  assertEqual(playerOf(chain, 8411).jumps, 1, '座位 0 应被自动起跳一次')
  assertEqual(playerOf(chain, 8412).jumps, 1, '座位 1 应被自动起跳一次')
  assertEqual(playerOf(chain, 8413).jumps, 0, '座位 2 不应被结算')

  // === 全局超时：按分数判胜（制造分差） ===
  service.resetJumpStateForTest()
  const diffRoom = service.createJumpRoomForTest(8421, 'u8421', [8422], base, { seed: TEST_SEED + 302 })
  const diffCourse = mirrorCourse(TEST_SEED + 302, 60)
  let dto = service.startJumpMatch(8421, diffRoom.matchId, base).match
  // 房主两跳全中心（2+4=6），受邀方一中心一普通（2+1=3）
  service.applyJumpAction(8421, diffRoom.matchId, { type: 'jump', chargeMs: centerCharge(diffCourse[1]) }, base + 1)
  dto = service.applyJumpAction(8422, diffRoom.matchId, { type: 'jump', chargeMs: centerCharge(diffCourse[1]) }, base + 2).match
  service.applyJumpAction(8421, diffRoom.matchId, { type: 'jump', chargeMs: centerCharge(diffCourse[2]) }, base + 3)
  dto = service.applyJumpAction(8422, diffRoom.matchId, { type: 'jump', chargeMs: normalCharge(diffCourse[2]) }, base + 4).match
  assertEqual(dto.status, 'playing', '正常操作中不应提前结束')
  const globalOut = service.getJumpMatch(8421, diffRoom.matchId, base + service.JUMP_DEFAULT_DURATION_MS + 1)
  assertEqual(globalOut.status, 'finished', '超过 endsAt 应由全局超时结算')
  assertEqual(globalOut.reason, 'timeout', '结束原因应为 timeout（优先于回合超时结算）')
  assertEqual(globalOut.winnerId, 8421, '全局超时应按分数最高者判胜')
  assertEqual(globalOut.turn, null, '结束后不应再有回合')

  // === 全局超时并列 → 平局 ===
  service.resetJumpStateForTest()
  const tieRoom = service.createJumpRoomForTest(8431, 'u8431', [8432], base, { seed: TEST_SEED + 303 })
  const tieCourse = mirrorCourse(TEST_SEED + 303, 60)
  service.startJumpMatch(8431, tieRoom.matchId, base)
  service.applyJumpAction(8431, tieRoom.matchId, { type: 'jump', chargeMs: centerCharge(tieCourse[1]) }, base + 1)
  service.applyJumpAction(8432, tieRoom.matchId, { type: 'jump', chargeMs: centerCharge(tieCourse[1]) }, base + 2)
  const tieOut = service.getJumpMatch(8431, tieRoom.matchId, base + service.JUMP_DEFAULT_DURATION_MS + 1)
  assertEqual(tieOut.reason, 'timeout', '同分应由 timeout 结算')
  assertEqual(tieOut.winnerId, null, '分数并列时应为平局（winnerId=null）')
  assert(tieOut.players.every((player) => player.status === 'lost'), '平局时所有玩家状态应为 lost')
}

// === 服务：盒子序列续生成 ===

function verifyCourseExtension(): void {
  service.resetJumpStateForTest()
  const base = Date.now()
  const seed = TEST_SEED + 400
  const HOST = 8501
  const GUEST = 8502
  const mirror = mirrorCourse(seed, 200)
  const room = service.createJumpRoomForTest(HOST, `u${HOST}`, [GUEST], base, { seed })
  let dto = service.startJumpMatch(HOST, room.matchId, base).match
  const prefix40 = dto.boxes.slice()
  assertEqual(prefix40.length, 40, '开局应有 40 盒')

  let extendedAt = -1
  let steps = 0
  while (playerOf(dto, HOST).boxIndex! < 41 && steps < 200) {
    steps += 1
    const holder = dto.turn!.userId
    const boxIndex = playerOf(dto, holder).boxIndex!
    const before = dto.boxes.length
    dto = service.applyJumpAction(holder, room.matchId, { type: 'jump', chargeMs: centerCharge(mirror[boxIndex + 1]) }, base + steps * 500).match
    if (extendedAt < 0 && dto.boxes.length > before) extendedAt = steps
    // 每一步都核对：DTO 路线必须与同 seed 直接生成同长度的路线完全一致
    assertEqual(dto.boxes, mirror.slice(0, dto.boxes.length), `第 ${steps} 步 DTO 路线应与镜像一致`)
    assertEqual(dto.boxes.slice(0, 40), prefix40, `第 ${steps} 步续生成不应改变前 40 盒`)
    assertEqual(dto.boxes.map((box) => box.index), dto.boxes.map((_, i) => i), `第 ${steps} 步 index 字段应与下标一致`)
  }
  assert(playerOf(dto, HOST).boxIndex! >= 41, `房主应推进到 41 号盒之后（实际 ${playerOf(dto, HOST).boxIndex}）`)
  assert(extendedAt > 0, '推进到接近末尾时盒子序列应被续生成')
  assert(dto.boxes.length > 40, '续生成后长度应超过 40')
  assertEqual(dto.status, 'playing', '全程命中时对局不应结束')
  assert(playerOf(dto, HOST).score > 0 && playerOf(dto, GUEST).score > 0, '双方都应累计分数')
  // 续生成必须始终覆盖领先玩家 boxIndex + 观察窗口（步长口径）
  const leadIndex = Math.max(playerOf(dto, HOST).boxIndex!, playerOf(dto, GUEST).boxIndex!)
  assert(dto.boxes.length >= leadIndex + service.JUMP_BOX_LOOKAHEAD, '序列长度应始终覆盖领先玩家的 boxIndex + 观察窗口')
}

// === 服务：掉线 / 清理回收 ===

function verifyDisconnectAndSweep(): void {
  const base = Date.now()
  service.resetJumpStateForTest()

  // === 掉线超过 120 秒且对手在线 → forfeit 淘汰并决出胜者 ===
  // 受邀方每次都在回合 deadline 前正常起跳（回合超时不会抢先结算），
  // 但从不 mark presence → 在线口径满 120 秒后由掉线规则淘汰。
  const host = 8601
  const guest = 8602
  const seed = TEST_SEED + 500
  const mirror = mirrorCourse(seed, 120)
  const room = service.createJumpRoomForTest(host, `u${host}`, [guest], base, { seed })
  let dto = service.startJumpMatch(host, room.matchId, base).match
  let step = 0
  let forfeited: MatchDto | null = null
  while (step < 14 && dto.status === 'playing') {
    step += 1
    const tick = base + step * 10_000
    presence.markGamePresence(host, tick)
    const holder = dto.turn!.userId
    const boxIndex = playerOf(dto, holder).boxIndex!
    try {
      dto = service.applyJumpAction(holder, room.matchId, { type: 'jump', chargeMs: centerCharge(mirror[boxIndex + 1]) }, tick).match
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // 受邀方在 tick=120s 起跳前已被掉线规则结算（视结算次序抛「你已出局」或「对局已结束」）
      if (!message.includes('你已出局') && !message.includes('已结束')) throw error
      forfeited = service.getJumpMatch(host, room.matchId, tick)
      break
    }
  }
  assert(forfeited !== null, '受邀方持续不可用 120 秒应被掉线规则结算')
  assertEqual(forfeited!.status, 'finished', '二人局掉线淘汰后应结束')
  assertEqual(forfeited!.reason, 'forfeit', '掉线口径应为 forfeit')
  assertEqual(forfeited!.winnerId, host, '掉线决出胜者时应由在线者获胜')
  assertEqual(playerOf(forfeited!, guest).status, 'lost', '掉线玩家应为 lost')
  assertEqual(playerOf(forfeited!, guest).boxIndex, null, '掉线淘汰后 boxIndex 应为 null')
  assert(playerOf(forfeited!, host).score > 0, '在线房主应有分数记录')

  // === 全员不可用：掉线规则不触发（要求另一名玩家在线），由回合超时结算 ===
  service.resetJumpStateForTest()
  const quietRoom = service.createJumpRoomForTest(8611, 'u8611', [8612], base, { seed: TEST_SEED + 501 })
  service.startJumpMatch(8611, quietRoom.matchId, base)
  const quiet = service.getJumpMatch(8611, quietRoom.matchId, base + service.JUMP_TURN_MS + 500)
  assertEqual(quiet.reason, 'forfeit', '无人在线时由回合超时自动 short 结算')
  assertEqual(quiet.winnerId, 8612, '座位 0 超时淘汰后应由座位 1 获胜')
  assertEqual(quiet.lastResult!.kind, 'short', '超时自动起跳应判 short')

  // === 等待房间 30 分钟未开局 → cancelled；超过保留期由 sweeper 回收 ===
  service.resetJumpStateForTest()
  const waitingRoom = service.createJumpRoomForTest(8621, 'u8621', [8622], base)
  const invite = service.createJumpInviteForTest(8621, 8623, waitingRoom.matchId, base + 1)
  const cancelled = service.getJumpMatch(8621, waitingRoom.matchId, base + service.JUMP_WAITING_ROOM_TTL_MS + 1)
  assertEqual(cancelled.status, 'finished', '等待房间超时应结束')
  assertEqual(cancelled.reason, 'cancelled', '等待房间超时原因应为 cancelled')
  assertEqual(service.getActiveJumpMatch(8621, base + service.JUMP_WAITING_ROOM_TTL_MS + 2), null, '解散后不应再有活跃房间')
  assertEqual(service.listJumpInvites(8621, base + 2).outgoing.length, 0, '解散后相关邀请应被清理')
  expectThrow(() => service.respondJumpInvite(8623, invite.inviteId, 'accept', base + 3), '邀请不存在', '解散后旧邀请应已清理')
  const reclaimedAt = base + service.JUMP_WAITING_ROOM_TTL_MS + service.JUMP_FINISHED_RETENTION_MS + 1
  expectThrow(() => service.getJumpMatch(8621, waitingRoom.matchId, reclaimedAt), '对局不存在', '超过保留期应由 sweeper 回收')

  // === sweeper 可重复执行（幂等）+ 兜底定时器可重复启动 ===
  service.runJumpSweeper(base)
  service.runJumpSweeper(base)
  service.startJumpTicker()
  service.startJumpTicker()
  expectThrow(() => service.getJumpMatch(8621, waitingRoom.matchId, base), '对局不存在', '已回收的房间再次查询应 404')
}

// === 服务：跨游戏互斥（registerGameModule 探针 + 反向忙碌检查） ===

function verifyCrossGameMutex(): void {
  service.resetJumpStateForTest()
  snake.resetSnakeStateForTest()
  const base = Date.now()
  const shared = 8701

  // === 贪吃蛇侧先占住：跳一跳侧接受邀请应被拦下 ===
  const snakeRoom = snake.createSnakeRoomForTest(8711, 'u8711', [shared], base)
  assertEqual(snake.getActiveSnakeMatch(shared, base + 1)?.status, 'waiting', '贪吃蛇侧应把 shared 拉进等待房间')
  const jumpRoom = service.createJumpRoomForTest(8721, 'u8721', [], base)
  const blockedBySnake = service.createJumpInviteForTest(8721, shared, jumpRoom.matchId, base + 2)
  expectThrow(
    () => service.respondJumpInvite(shared, blockedBySnake.inviteId, 'accept', base + 3),
    '另一场',
    '已在贪吃蛇房间中的玩家不应能加入跳一跳房间',
  )
  assertEqual(service.listJumpInvites(shared, base + 4).incoming.length, 0, '拦下时应同时清理该邀请')

  // === 斗地主侧先占住：跳一跳侧接受邀请同样被拦下 ===
  snake.resetSnakeStateForTest()
  service.resetJumpStateForTest()
  ddz.createDoudizhuRoomForTest(
    [{ id: shared, username: `u${shared}` }, { id: 8732, username: 'u8732' }, { id: 8733, username: 'u8733' }],
    base,
  )
  assertEqual(ddz.getActiveDoudizhuMatch(shared, base + 1)?.status, 'waiting', '斗地主侧应把 shared 拉进等待房间')
  const otherRoom = service.createJumpRoomForTest(8741, 'u8741', [], base)
  const blockedByDdz = service.createJumpInviteForTest(8741, shared, otherRoom.matchId, base + 2)
  expectThrow(
    () => service.respondJumpInvite(shared, blockedByDdz.inviteId, 'accept', base + 3),
    '另一场',
    '已在斗地主房间中的玩家不应能加入跳一跳房间',
  )

  // === 反向：已被跳一跳占用时，同一个账号不应能再加入另一个跳一跳房间 ===
  service.resetJumpStateForTest()
  const selfHost = 8791
  const ownRoom = service.createJumpRoomForTest(selfHost, `u${selfHost}`, [8752], base)
  service.startJumpMatch(selfHost, ownRoom.matchId, base)
  const secondRoom = service.createJumpRoomForTest(8761, 'u8761', [], base)
  const secondInvite = service.createJumpInviteForTest(8761, selfHost, secondRoom.matchId, base + 1)
  expectThrow(
    () => service.respondJumpInvite(selfHost, secondInvite.inviteId, 'accept', base + 2),
    '另一场',
    '已在跳一跳对局中的玩家不应能加入另一个跳一跳房间',
  )
  // isUserInMatch 探针：对局中 / 等待房间中均为「忙」；结束后释放
  assertEqual(service.getActiveJumpMatch(selfHost, base + 3)?.status, 'playing', 'selfHost 应仍在跳一跳对局中（探针语义）')

  // === sweep 钩子已挂到主 sweeper：gameService.runGameSweeper 会驱动跳一跳结算 ===
  service.resetJumpStateForTest()
  const quietRoom = service.createJumpRoomForTest(8771, 'u8771', [8772], base)
  game.runGameSweeper(base + service.JUMP_WAITING_ROOM_TTL_MS + 1)
  const swept = service.getJumpMatch(8771, quietRoom.matchId, base + service.JUMP_WAITING_ROOM_TTL_MS + 2)
  assertEqual(swept.status, 'finished', '主 sweeper 应驱动跳一跳的等待房间解散')
  assertEqual(swept.reason, 'cancelled', '主 sweeper 驱动的解散原因应为 cancelled')
  service.resetJumpStateForTest()
  snake.resetSnakeStateForTest()
}

async function main(): Promise<void> {
  engine = await import('../src/services/gameJump.js')
  service = await import('../src/services/gameJumpService.js')
  snake = await import('../src/services/gameSnakeService.js')
  ddz = await import('../src/services/gameDoudizhuService.js')
  game = await import('../src/services/gameService.js')
  presence = await import('../src/services/gamePresence.js')

  verifyEngineConstants()
  verifyJumpDistance()
  verifyResolveJump()
  verifyJumpScore()
  verifyCourse()
  verifyMatchFlow()
  verifyMissAndElimination()
  verifyResignLeaveAndCapacity()
  verifyTimeouts()
  verifyCourseExtension()
  verifyDisconnectAndSweep()
  verifyCrossGameMutex()

  // 收尾清空内存与兜底定时器（都是 unref，进程可正常退出）
  service.resetJumpStateForTest()
  console.log(`✓ verify-jump 全部通过（${passed} 条断言）`)
}

main().catch((error: unknown) => {
  console.error('✗ verify-jump 验证失败：')
  console.error(error)
  process.exitCode = 1
})
