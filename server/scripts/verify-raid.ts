/**
 * 搜打撤引擎 / 农场扩建与保护 / 股市限价规则纯函数自检。
 * 不依赖数据库、环境变量或网络。
 *
 * 用法: cd server && npx tsx scripts/verify-raid.ts（或 npm run verify:raid）
 */

import {
  RAID_LOOT_ENTRIES,
  RAID_SAFE_CAPACITY,
  RAID_MAPS,
  abandonRaid,
  buildRaidCellDtos,
  createRaidRng,
  createRaidState,
  expireRaid,
  extractRaid,
  getRaidMap,
  insuranceCost,
  insurableGearValue,
  lootValue,
  moveRaid,
  rollRaidLoot,
  searchRaid,
  storeSafeRaid,
  takeSafeRaid,
  totalLootValue,
  useMedkitRaid,
  resolveRaidCombat,
  type RaidEnemy,
  type RaidLootItem,
  type RaidState,
} from '../src/lib/petRaid.js'
import {
  FARM_PROTECTION_MAX_HOURS,
  FARM_PROTECTION_PACKAGES,
  MAX_PLOT_COUNT,
  findProtectionPackage,
  nextExpansion,
  protectionRemainingMs,
  protectionUntilAfter,
} from '../src/lib/farmCrops.js'
import {
  limitOrderDistancePct,
  limitOrderTriggered,
  quoteStockBuy,
  quoteStockSell,
} from '../src/lib/stockTrading.js'

let passed = 0

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`❌ ${message}`)
  passed += 1
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`❌ ${message}（实际 ${String(actual)}，期望 ${String(expected)}）`)
  }
  passed += 1
}

function makeState(seed = 12345): RaidState {
  const map = getRaidMap('wasteland')
  assert(!!map, '废弃农场地图存在')
  return createRaidState({
    map: map!,
    seed,
    now: 1_700_000_000_000,
    loadout: {
      petId: 1,
      userId: 7,
      name: '测试宠物',
      species: 'dog',
      level: 10,
      equipmentKeys: ['flame_sword', 'crystal_plate'],
      skillKeys: ['fire_claw', 'healing_light', 'meteor'],
    },
    stats: { maxHp: 400, maxMp: 200, atk: 100, def: 50, spd: 50, crit: 20 },
    insured: false,
  })
}

function medkit(id = 'med-1'): RaidLootItem {
  return {
    id,
    key: 'medkit',
    name: '急救包',
    emoji: '🩹',
    rarity: 'common',
    kind: 'medkit',
    value: 45,
    amount: 1,
    payload: null,
  }
}

/* ---------- 地图 / 生成 ---------- */
assertEqual(RAID_MAPS.length, 4, '共 4 张搜打撤地图')
assertEqual(new Set(RAID_MAPS.map((map) => map.key)).size, RAID_MAPS.length, '地图 key 唯一')
for (const map of RAID_MAPS) {
  assert(map.size >= 7 && map.size <= 9, `${map.name} 地图尺寸合理`)
  assert(map.enemyCount > 0, `${map.name} 有敌人`)
  assert(map.lootCount > 0, `${map.name} 有物资`)
  assert(map.extractCount >= 1, `${map.name} 至少一个撤离点`)
  assert(map.maxTurns >= 30, `${map.name} 行动点足够`)
}
assert(RAID_LOOT_ENTRIES.length >= 12, '战利品目录足够丰富')
assertEqual(new Set(RAID_LOOT_ENTRIES.map((item) => item.key)).size, RAID_LOOT_ENTRIES.length, '战利品 key 唯一')

const a = makeState(999)
const b = makeState(999)
const c = makeState(1000)
assertEqual(JSON.stringify(a.cells), JSON.stringify(b.cells), '同 seed 地图完全一致')
assert(JSON.stringify(a.cells) !== JSON.stringify(c.cells), '不同 seed 地图不同')
assertEqual(a.player.x, 0, '出生点 x = 0')
assertEqual(a.player.y, 0, '出生点 y = 0')
assert(a.cells.some((cell) => cell.kind === 'extract'), '地图存在撤离点')
assert(a.cells.filter((cell) => cell.kind === 'loot').length > 0, '地图存在物资箱')
assert(a.cells.filter((cell) => cell.kind === 'enemy').length > 0, '地图存在敌人')
assert(a.visited.length >= 3, '出生点及相邻格已探索')

const dtos = buildRaidCellDtos(a)
assertEqual(dtos.length, a.width * a.height, 'DTO 覆盖全部格子')
assert(dtos.some((cell) => cell.kind === 'unknown'), '未探索区域被隐藏')
assert(dtos.some((cell) => cell.current), '当前格标记正确')

/* ---------- 移动 / 搜索 / 撤离 ---------- */
const fresh = makeState(42)
const outOfBounds = moveRaid(fresh, 'up', createRaidRng(1))
assert(!!outOfBounds.error, '向上越界被拒绝')
assertEqual(outOfBounds.state.turn, 0, '越界不消耗行动点')

const right = moveRaid(fresh, 'right', createRaidRng(2))
assert(!right.error, '向右移动成功')
assertEqual(right.state.turn, 1, '移动消耗 1 行动点')
assertEqual(right.state.player.x, 1, '玩家移动到 x=1')
assert(right.state.mp >= fresh.mp, '移动回复 MP（不超过上限）')

const searchState = makeState(7)
const lootCell = searchState.cells.find((cell) => cell.kind === 'loot')!
searchState.player = { x: lootCell.x, y: lootCell.y }
const searched = searchRaid(searchState, createRaidRng(3))
assert(!searched.error, '在物资箱上搜索成功')
assertEqual(searched.state.turn, 1, '搜索消耗 1 行动点')
assert((searched.gained?.length ?? 0) > 0, '搜索至少获得一件战利品')
const searchedAgain = searchRaid(searched.state, createRaidRng(4))
assert(!!searchedAgain.error, '同一箱子不能重复搜索')

const extractState = makeState(8)
const extractCell = extractState.cells.find((cell) => cell.kind === 'extract')!
extractState.player = { x: extractCell.x, y: extractCell.y }
const e1 = extractRaid(extractState)
assert(!e1.error && e1.state.extracting > 0, '开始撤离读条')
const e2 = extractRaid(e1.state)
assert(!e2.error && e2.state.status === 'active', '撤离读条第二回合')
const e3 = extractRaid(e2.state)
assert(!e3.error && e3.state.status === 'extracted', '第三回合撤离成功')

const wrongExtract = extractRaid(fresh)
assert(!!wrongExtract.error, '不在撤离点不能撤离')

const abandonState = makeState(9)
const abandoned = abandonRaid(abandonState)
assertEqual(abandoned.state.status, 'abandoned', '放弃行动状态正确')
const expired = expireRaid(abandonState)
assertEqual(expired.state.status, 'mia', '超时判 MIA')

/* ---------- 战利品 / 保险箱 / 急救包 ---------- */
const lootState = makeState(11)
lootState.loot = rollRaidLoot(lootState, createRaidRng(5))
assert(lootState.loot.length > 0, '战利品抽取非空')
assert(totalLootValue(lootState.loot) > 0, '战利品总价值大于 0')
assert(lootValue(medkit()) === 45, '急救包价值 45')

const safeState = makeState(12)
const lootA = rollRaidLoot(safeState, createRaidRng(6))[0]
const lootB = rollRaidLoot(safeState, createRaidRng(7))[0]
const lootC = rollRaidLoot(safeState, createRaidRng(8))[0]
safeState.loot = [lootA, lootB, lootC]
const st1 = storeSafeRaid(safeState, lootA.id)
assert(!st1.error && st1.state.safe.length === 1, '第一件战利品放入保险箱')
const st2 = storeSafeRaid(st1.state, lootB.id)
assert(!st2.error && st2.state.safe.length === 2, '第二件战利品放入保险箱')
const st3 = storeSafeRaid(st2.state, lootC.id)
assert(!!st3.error, `保险箱最多 ${RAID_SAFE_CAPACITY} 件`)
const back = takeSafeRaid(st2.state, lootA.id)
assert(!back.error && back.state.safe.length === 1, '从保险箱取回战利品')

const healState = makeState(13)
healState.hp = 10
healState.loot = [medkit()]
const healed = useMedkitRaid(healState, 'med-1')
assert(!healed.error, '使用急救包成功')
assert(healed.state.hp > 10, '急救包回复生命')
assertEqual(healed.state.loot.length, 0, '急救包被消耗')

/* ---------- 战斗 ---------- */
const combatState = makeState(14)
const enemy: RaidEnemy = {
  id: 'test-enemy',
  name: '测试兵',
  emoji: '🥷',
  kind: 'scout',
  level: 1,
  hp: 50,
  maxHp: 50,
  atk: 5,
  def: 1,
  spd: 1,
  crit: 0,
  skills: [],
}
const combat = resolveRaidCombat(combatState, enemy, createRaidRng(10))
assert(combat.won, '高属性宠物击败低级敌人')
assert(combat.playerHp > 0, '胜利后宠物存活')
assert(combat.rounds >= 1, '战斗回合数有效')
assert(combat.events.length > 0, '战斗日志非空')

/* ---------- 保险 ---------- */
assertEqual(insurableGearValue(['flame_sword', 'crystal_plate']), 1750, '非绑定装备价值合计')
assert(insuranceCost(['flame_sword', 'crystal_plate']) >= 20, '保险最低 20 积分')
assertEqual(insuranceCost(['starter_claw']), 0, '绑定新手装不需要保险')

/* ---------- 农场扩建 / 保护 ---------- */
assertEqual(MAX_PLOT_COUNT, 30, '农田上限 30 块')
assertEqual(nextExpansion(18)?.plotCount, 21, '18 块下一档是 21')
assertEqual(nextExpansion(27)?.plotCount, 30, '27 块下一档是 30')
assertEqual(nextExpansion(30), null, '30 块已满')
assertEqual(FARM_PROTECTION_PACKAGES.length, 5, '保护档位 5 档')
assertEqual(findProtectionPackage(6)?.cost, 120, '6 小时保护 120 积分')
assertEqual(findProtectionPackage(5), null, '不存在的档位返回 null')
const now = 1_700_000_000_000
const until = protectionUntilAfter(null, 3, now)
assertEqual(until.getTime(), now + 3 * 3_600_000, '保护到期时间 = 现在 + 时长')
const stacked = protectionUntilAfter(until, 6, now + 1000)
assertEqual(stacked.getTime(), until.getTime() + 6 * 3_600_000, '保护可叠加')
assertEqual(protectionRemainingMs(null, now), 0, '未保护剩余 0')
assertEqual(protectionRemainingMs(until, now + 3_600_000), 2 * 3_600_000, '剩余保护计算正确')
assert(FARM_PROTECTION_MAX_HOURS === 48, '保护总上限 48 小时')

/* ---------- 股市限价 ---------- */
assert(limitOrderTriggered('buy', 10, 12), '买入现价 10 ≤ 限价 12 触发')
assert(!limitOrderTriggered('buy', 13, 12), '买入现价 13 > 限价 12 不触发')
assert(limitOrderTriggered('sell', 13, 12), '卖出现价 13 ≥ 限价 12 触发')
assert(!limitOrderTriggered('sell', 10, 12), '卖出现价 10 < 限价 12 不触发')
assertEqual(limitOrderDistancePct('buy', 10, 9), 10, '买入距触发 10%')
assertEqual(limitOrderDistancePct('buy', 9, 10), 0, '已触发距离 0')
assertEqual(limitOrderDistancePct('sell', 10, 11), 10, '卖出距触发 10%')

const buyQuote = quoteStockBuy(10_000, 25)
assertEqual(buyQuote.fee, 30, '买入手续费 0.3%')
assertEqual(buyQuote.netPoints, 9_970, '扣费后买入金额')
assert(Math.abs(buyQuote.shares - 398.8) < 1e-9, '买入份额按价格折算')
const sellQuote = quoteStockSell(100, 25)
assertEqual(sellQuote.gross, 2_500, '卖出毛收入')
assertEqual(sellQuote.fee, 8, '卖出手续费 0.3%（向上取整）')
assertEqual(sellQuote.proceeds, 2_492, '卖出到账金额')

console.log(`✅ 搜打撤 / 农场 / 股市规则自检：${passed} 个断言`)
