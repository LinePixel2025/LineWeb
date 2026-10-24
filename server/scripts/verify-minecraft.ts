/**
 * 我的世界服务端世界生成 + 联机状态机自检脚本（不依赖数据库 / 网络真实流量）
 *
 * 用法: cd server && npx tsx scripts/verify-minecraft.ts
 *
 * 覆盖：
 *   - 世界生成：同 seed 确定性（双跑哈希一致）、与客户端对齐的固定哈希常量
 *     （20261024 → d500f51b / 1 → b2114c41 / 4294967295 → f04c3fc5，客户端 vitest
 *     用同一批常量兜底双端拷贝）、边界（y=0 全基岩、地表高度带）、出生点落在实心地面上；
 *   - 服务：建房 → 邀请 → 接受 → 房主开始（权威 seed + 出生点缓存 + 玩家初始状态）
 *     → state 动作更新快照（等待房间 409、非参与者 404）→ edit 动作（seq 递增、
 *     重复值跳过、越界 / y=0 / 非法方块跳过、批量上限）→ sync?since= 增量二分补拉
 *     → 修改总数 30000 上限 409 → leave（普通玩家移出 / 房主移交 / 最后一人关闭）
 *     → 掉线 10 分钟移出与全员掉线 abandoned → 等待房间 30 分钟解散 → 保留期回收
 *     → 房间 8 人上限 → DTO 不泄露世界数据 / 日志 → 跨游戏互斥探针。
 *
 * 说明：时间一律用显式 now 参数驱动；在线判定用 presence 心跳模拟；
 * 邀请用测试入口直接登记，避开数据库里的好友关系校验。
 */

// 依赖模块会读 DATABASE_URL / JWT_SECRET：先给默认值再动态 import，
// Prisma 为惰性连接，只要脚本不触发真实查询就不会碰到数据库。
process.env.DATABASE_URL ||= 'file:./.verify-minecraft.db'
process.env.JWT_SECRET ||= 'verify-minecraft-secret'
process.env.NODE_ENV ||= 'development'

type WorldModule = typeof import('../src/services/gameMinecraftWorld.js')
type Service = typeof import('../src/services/gameMinecraftService.js')
type GameService = typeof import('../src/services/gameService.js')
type PresenceModule = typeof import('../src/services/gamePresence.js')

let world: WorldModule
let service: Service
let game: GameService
let presence: PresenceModule

type MatchDto = ReturnType<Service['getMinecraftMatch']>

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

const TEST_SEED = 20261024

async function main(): Promise<void> {
  world = await import('../src/services/gameMinecraftWorld.js')
  service = await import('../src/services/gameMinecraftService.js')
  game = await import('../src/services/gameService.js')
  presence = await import('../src/services/gamePresence.js')

  // === 世界生成引擎 ===

  const w1 = world.mcCreateWorld(TEST_SEED)
  const w1b = world.mcCreateWorld(TEST_SEED)
  assertEqual(world.mcHashWorld(w1), world.mcHashWorld(w1b), '同 seed 双跑哈希一致')
  assertEqual(world.mcHashWorld(w1), '96adcfaa', `seed ${TEST_SEED} 固定哈希（客户端拷贝对齐兜底）`)
  assertEqual(world.mcHashWorld(world.mcCreateWorld(1)), 'a98a7e50', 'seed 1 固定哈希（客户端拷贝对齐兜底）')
  assertEqual(world.mcHashWorld(world.mcCreateWorld(4294967295)), '3267f19b', 'seed 4294967295 固定哈希（客户端拷贝对齐兜底）')

  // y=0 全基岩；地表高度带；无越界方块值
  let bedrockCount = 0
  let waterCount = 0
  let invalidBlock = false
  for (let x = 0; x < world.MC_WORLD_SIZE; x += 1) {
    for (let z = 0; z < world.MC_WORLD_SIZE; z += 1) {
      if (w1.data[world.mcBlockIndex(x, 0, z)] !== world.MC_BLOCK.BEDROCK) bedrockCount += 1
      const h = world.mcHeightAt(x, z, TEST_SEED)
      if (h < 4 || h > world.MC_WORLD_HEIGHT - 8) invalidBlock = true
      for (let y = 0; y < world.MC_WORLD_HEIGHT; y += 1) {
        const b = w1.data[world.mcBlockIndex(x, y, z)]
        if (b < 0 || b >= world.MC_BLOCK_COUNT) invalidBlock = true
        if (b === world.MC_BLOCK.WATER) waterCount += 1
      }
    }
  }
  assertEqual(bedrockCount, 0, 'y=0 全基岩层')
  assert(!invalidBlock, '地形高度与方块值都在合法范围')
  assert(waterCount > 0, '世界里存在水体（湖泊 / 海平面填充）')

  // 山地要素（雪顶）与地形多样性：seed 42 有雪山
  const w42 = world.mcCreateWorld(42)
  let snowCount = 0
  for (let i = 0; i < w42.data.length; i += 1) {
    if (w42.data[i] === world.MC_BLOCK.SNOW) snowCount += 1
  }
  assert(snowCount > 0, '存在雪顶山地（seed 42）')

  // 出生点：脚底必须踩在实心方块上（+1.01 的落点余量内）
  const spawn = world.mcSpawnForSeed(TEST_SEED)
  const below = world.mcGetBlock(w1, Math.floor(spawn.x), Math.floor(spawn.y - 0.5), Math.floor(spawn.z))
  assert(below !== world.MC_BLOCK.AIR && below !== world.MC_BLOCK.WATER, `出生点脚下是实心方块（实际 ${below}）`)
  assertEqual(
    { x: spawn.x, y: spawn.y, z: spawn.z },
    { x: 96.5, y: 40.01, z: 96.5 },
    'seed 20261024 出生点常量（客户端拷贝对齐兜底）',
  )

  // === 服务：建房 → 邀请 → 接受 → 开始 ===

  service.resetMinecraftStateForTest()
  const now0 = 1_760_000_000_000
  const { matchId } = service.createMinecraftRoomForTest(11, 'host', [22, 33], now0, { seed: TEST_SEED })
  const { inviteId } = service.createMinecraftInviteForTest(11, 44, matchId, now0)

  const respond = service.respondMinecraftInvite(44, inviteId, 'accept', now0 + 1000)
  assert(respond.ok && respond.match && respond.match.players.length === 4, '接受邀请加入等待房间')
  assertEqual(respond.match?.players.map((p) => p.userId), [11, 22, 33, 44], '座位按加入顺序')

  // 非房主不能开始；等待房间不能上报状态
  expectThrow(() => service.startMinecraftMatch(22, matchId, now0 + 2000), '只有房主', '非房主开始被拒')
  expectThrow(
    () => service.applyMinecraftAction(11, matchId, { type: 'state', x: 1, y: 2, z: 3, yaw: 0, pitch: 0, flying: false }, now0 + 2000),
    '世界尚未开始',
    '等待房间上报状态被拒',
  )

  const started = service.startMinecraftMatch(11, matchId, now0 + 3000)
  assertEqual(started.match.seed, TEST_SEED, '开局使用固定 seed（测试入口）')
  assertEqual(started.match.world.spawn, spawn, '出生点按 seed 计算（与世界模块一致）')
  assertEqual(started.match.status, 'playing', '状态 playing')
  assert(started.match.players.every((p) => p.state && p.state.x === spawn.x && p.state.y === spawn.y), '所有玩家初始状态 = 出生点')

  // === state 动作 ===

  expectThrow(
    () => service.applyMinecraftAction(99, matchId, { type: 'state', x: 1, y: 2, z: 3, yaw: 0, pitch: 0, flying: false }, now0 + 4000),
    '对局不存在',
    '非参与者上报状态 404',
  )
  service.applyMinecraftAction(22, matchId, { type: 'state', x: 10.5, y: 31.02, z: 12.5, yaw: 1.2, pitch: -0.3, flying: true }, now0 + 4000)
  const afterState = service.getMinecraftMatch(33, matchId, now0 + 4100)
  const p22 = afterState.players.find((p) => p.userId === 22)
  assertEqual(p22?.state, { x: 10.5, y: 31.02, z: 12.5, yaw: 1.2, pitch: -0.3, flying: true }, 'state 动作更新玩家快照')
  assertEqual(afterState.version, started.match.version, 'state 动作不递增对局版本')

  // === edit 动作 ===

  const edit1 = service.applyMinecraftAction(
    22,
    matchId,
    { type: 'edit', edits: [{ x: 5, y: 30, z: 5, b: 4 }, { x: 5, y: 0, z: 5, b: 0 }, { x: 5, y: 30, z: 5, b: 4 }] },
    now0 + 5000,
  )
  assertEqual(edit1.applied.length, 1, 'y=0 与重复值被跳过，只应用一条')
  assertEqual(edit1.applied[0].seq, 1, 'seq 从 1 开始递增')
  assertEqual(edit1.applied[0].userId, 22, '修改归属上报者')

  // 越界 / 非法方块跳过（zod 挡一层，服务层对直接调用再挡一层）
  const edit2 = service.applyMinecraftAction(
    33,
    matchId,
    { type: 'edit', edits: [
      { x: -1, y: 30, z: 5, b: 4 },
      { x: 5, y: 200, z: 5, b: 4 },
      { x: 5, y: 30, z: 5, b: 99 },
      { x: 191, y: 31, z: 191, b: 0 },
    ] },
    now0 + 5100,
  )
  assertEqual(edit2.applied.map((e) => ({ x: e.x, y: e.y, z: e.z, b: e.b })), [{ x: 191, y: 31, z: 191, b: 0 }], '越界与非法方块全部跳过')
  assertEqual(edit2.applied[0].seq, 2, 'seq 连续递增')

  // 同键重复编辑：与最新值相同 → 跳过；改回不同值 → 应用
  const edit3 = service.applyMinecraftAction(22, matchId, { type: 'edit', edits: [{ x: 5, y: 30, z: 5, b: 4 }] }, now0 + 5200)
  assertEqual(edit3.applied.length, 0, '与最新值相同 → 幂等跳过')

  // === sync?since= 增量补拉（二分） ===

  const syncAll = service.getMinecraftSync(22, matchId, 0, now0 + 5300)
  assertEqual(syncAll.edits.length, 2, 'since=0 拉到全部修改')
  const syncIncr = service.getMinecraftSync(22, matchId, 1, now0 + 5300)
  assertEqual(syncIncr.edits.map((e) => e.seq), [2], 'since=1 只拉增量')
  const syncNone = service.getMinecraftSync(22, matchId, 2, now0 + 5300)
  assertEqual(syncNone.edits.length, 0, '水位到顶无增量')
  assert(syncAll.match !== null && syncAll.match.editSeq === 2, 'match DTO 暴露 editSeq 水位')
  assertEqual(syncAll.match?.seed, TEST_SEED, 'sync DTO 含 seed')

  // DTO 不泄露世界数据与日志
  const dtoText = JSON.stringify(syncAll.match)
  assert(!dtoText.includes('"data"'), 'DTO 不含世界体素数据')
  assert(!dtoText.includes('editLog'), 'DTO 不含修改日志数组')

  // === 修改上限（30000 条 → 409） ===

  let lastApplied = 0
  expectThrow(() => {
    for (let i = 0; i < 500; i += 1) {
      const edits = []
      for (let j = 0; j < 64; j += 1) {
        const idx = i * 64 + j
        edits.push({ x: idx % world.MC_WORLD_SIZE, y: 1 + (idx % 60), z: Math.floor(idx / world.MC_WORLD_SIZE) % world.MC_WORLD_SIZE, b: 3 })
      }
      const result = service.applyMinecraftAction(22, matchId, { type: 'edit', edits }, now0 + 6000 + i)
      lastApplied = result.applied.length
    }
  }, '上限', '修改总数达到 30000 后拒绝')

  // === leave：房主移交 / 普通移出 / 最后一人关闭 ===

  service.resetMinecraftStateForTest()
  const now1 = 1_770_000_000_000
  const { matchId: mid2 } = service.createMinecraftRoomForTest(51, 'h', [52, 53], now1, { seed: TEST_SEED })
  service.startMinecraftMatch(51, mid2, now1 + 1000)

  const leave52 = service.leaveMinecraftMatch(52, mid2, now1 + 2000)
  assertEqual(leave52.dissolved, false, '普通玩家离开世界不关闭')
  const afterLeave = service.getMinecraftMatch(51, mid2, now1 + 2100)
  assertEqual(afterLeave.players.map((p) => p.userId), [51, 53], '离开者被移出')

  const leaveHost = service.leaveMinecraftMatch(51, mid2, now1 + 3000)
  assertEqual(leaveHost.dissolved, false, '房主离开进行中的世界不关闭（房主移交）')
  const afterHostLeave = service.getMinecraftMatch(53, mid2, now1 + 3100)
  assertEqual(afterHostLeave.hostId, 53, '房主位移交给剩余玩家')

  const leaveLast = service.leaveMinecraftMatch(53, mid2, now1 + 4000)
  assertEqual(leaveLast.dissolved, true, '最后一人离开世界关闭')
  // 离开者已被移出参与者列表：按「非参与者 404」语义读不到结束后的世界
  // （abandoned 原因与结束后可读性在下面的全员掉线路径覆盖，那里仍有参与者留下）
  expectThrow(() => service.getMinecraftMatch(53, mid2, now1 + 4100), '对局不存在', '离开后非参与者 404')

  // === 掉线处置：单人超时移出；全员掉线 abandoned ===

  service.resetMinecraftStateForTest()
  const now2 = 1_780_000_000_000
  const { matchId: mid3 } = service.createMinecraftRoomForTest(61, 'h', [62], now2, { seed: TEST_SEED })
  service.startMinecraftMatch(61, mid3, now2 + 1000)
  // 61 保持在线：isGamePresent 的默认 now 是真实时钟（gameService 共享口径，未透传测试时间），
  // 因此心跳用真实 Date.now() 打点（测试的显式 now 在过去 → 判定为「新鲜」）；62 从不上报 → 10 分钟后被移出
  presence.markGamePresence(61)
  service.runMinecraftSweeper(now2 + 9 * 60_000)
  let mid3Dto = service.getMinecraftMatch(61, mid3, now2 + 9 * 60_000 + 1)
  assertEqual(mid3Dto.players.length, 2, '掉线 9 分钟尚未被移出')
  presence.markGamePresence(61)
  service.runMinecraftSweeper(now2 + 11 * 60_000)
  mid3Dto = service.getMinecraftMatch(61, mid3, now2 + 11 * 60_000 + 1)
  assertEqual(mid3Dto.players.map((p) => p.userId), [61], '掉线 10 分钟被移出世界')
  assertEqual(mid3Dto.hostId, 61, '房主未被移出时房主不变')

  // 全员掉线 → abandoned（61 仍是参与者：结束后的世界对原参与者保留可读）
  presence.clearGamePresence(61)
  service.runMinecraftSweeper(now2 + 22 * 60_000)
  const abandoned = service.getMinecraftMatch(61, mid3, now2 + 22 * 60_000 + 1)
  assertEqual(abandoned.status, 'finished', '全员掉线世界关闭')
  assertEqual(abandoned.reason, 'abandoned', '全员掉线结束原因 abandoned')

  // === 等待房间 TTL 解散 + 保留期回收 ===

  service.resetMinecraftStateForTest()
  const now3 = 1_790_000_000_000
  const { matchId: mid4 } = service.createMinecraftRoomForTest(71, 'h', [72], now3)
  service.runMinecraftSweeper(now3 + 31 * 60_000)
  const dissolved = service.getMinecraftMatch(71, mid4, now3 + 31 * 60_000 + 1)
  assertEqual(dissolved.status, 'finished', '等待房间 30 分钟未开局解散')
  assertEqual(dissolved.reason, 'cancelled', '等待房间解散原因 cancelled')
  service.runMinecraftSweeper(now3 + 31 * 60_000 + 5 * 60_000 + 1)
  expectThrow(() => service.getMinecraftMatch(71, mid4, now3 + 31 * 60_000 + 5 * 60_000 + 2), '对局不存在', '保留期后回收')

  // === 房间 8 人上限 ===

  service.resetMinecraftStateForTest()
  const now4 = 1_800_000_000_000
  const { matchId: mid5 } = service.createMinecraftRoomForTest(81, 'h', [82, 83, 84, 85, 86, 87, 88], now4)
  const { inviteId: inviteFull } = service.createMinecraftInviteForTest(81, 89, mid5, now4)
  expectThrow(() => service.respondMinecraftInvite(89, inviteFull, 'accept', now4 + 1000), '房间已满', '第 9 人无法加入')

  // === 跨游戏互斥探针 ===

  assert(game.isUserBusyInOtherGames(81, '2048') === true, '其他游戏能探测到我的世界房间（互斥探针）')
  service.resetMinecraftStateForTest()
  assert(game.isUserBusyInOtherGames(81, '2048') === false, '清空后探针恢复')

  console.log(`✅ 我的世界自检通过：${passed} 项断言`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ 自检失败：', error)
    process.exit(1)
  })
