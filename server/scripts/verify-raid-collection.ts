/**
 * 搜打撤藏品室纯函数自检（不依赖数据库 / 网络）。
 *
 * 用法: cd server && npx tsx scripts/verify-raid-collection.ts
 */

import {
  COLLECTIBLE_CATALOG,
  RAID_COLLECTION_SLOTS,
  collectibleDuplicatePoints,
  collectionCompletionPct,
  firstFreeDisplaySlot,
  isCollectibleKey,
  normalizeDisplaySlots,
} from '../src/lib/raidCollection.js'
import { RAID_ITEMS } from '../src/lib/raidRun.js'

let passed = 0

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`断言失败：${message}`)
  passed += 1
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`断言失败：${message}\n  实际: ${JSON.stringify(actual)}\n  期望: ${JSON.stringify(expected)}`)
  }
  passed += 1
}

assertEqual(RAID_COLLECTION_SLOTS, 12, '藏品室 12 个展位')
assertEqual(COLLECTIBLE_CATALOG.length, 8, '藏品目录 8 件')
assertEqual(
  COLLECTIBLE_CATALOG.length,
  RAID_ITEMS.filter((item) => item.kind === 'collectible').length,
  '目录与主物品表一致',
)
assert(
  COLLECTIBLE_CATALOG.every((item) => isCollectibleKey(item.key)),
  '目录内 key 都能被 isCollectibleKey 识别',
)
assert(!isCollectibleKey('scrap_metal'), '普通物品不是藏品')

assertEqual(firstFreeDisplaySlot([]), 0, '空房间从 0 号展位开始')
assertEqual(firstFreeDisplaySlot([0, 1, 2]), 3, '按顺序找空位')
assertEqual(firstFreeDisplaySlot([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), null, '满展位返回 null')
assertEqual(firstFreeDisplaySlot([99, -1]), 0, '越界展位被忽略')

const owned = new Set(COLLECTIBLE_CATALOG.slice(0, 3).map((item) => item.key))
const firstKey = COLLECTIBLE_CATALOG[0].key
const secondKey = COLLECTIBLE_CATALOG[1].key
assertEqual(
  normalizeDisplaySlots([{ slot: 2, itemKey: firstKey, note: '  镇馆之宝  ' }], owned),
  [{ slot: 2, itemKey: firstKey, note: '镇馆之宝' }],
  '布展输入规范化（去空格 / 排序）',
)
assertEqual(
  normalizeDisplaySlots(
    [{ slot: 5, itemKey: secondKey }, { slot: 1, itemKey: firstKey }],
    owned,
  ).map((entry) => entry.slot),
  [1, 5],
  '布展结果按展位排序',
)

let threw = false
try {
  normalizeDisplaySlots([{ slot: 0, itemKey: COLLECTIBLE_CATALOG[5].key }], owned)
} catch {
  threw = true
}
assert(threw, '不能展出未拥有的藏品')

threw = false
try {
  normalizeDisplaySlots([
    { slot: 0, itemKey: firstKey },
    { slot: 0, itemKey: secondKey },
  ], owned)
} catch {
  threw = true
}
assert(threw, '同一展位不能放两件')

threw = false
try {
  normalizeDisplaySlots([{ slot: 12, itemKey: firstKey }], owned)
} catch {
  threw = true
}
assert(threw, '展位越界会被拒绝')

threw = false
try {
  normalizeDisplaySlots([
    { slot: 0, itemKey: firstKey },
    { slot: 1, itemKey: firstKey },
  ], owned)
} catch {
  threw = true
}
assert(threw, '同一件藏品不能占两个展位')

assertEqual(collectionCompletionPct(0, 8), 0, '0 件进度 0%')
assertEqual(collectionCompletionPct(4, 8), 50, '4/8 进度 50%')
assertEqual(collectionCompletionPct(8, 8), 100, '集齐 100%')
assertEqual(collectionCompletionPct(99, 8), 100, '进度夹到 100')

for (const item of COLLECTIBLE_CATALOG) {
  assert(collectibleDuplicatePoints(item) > 0, `${item.name} 重复折算积分为正`)
  assert(
    collectibleDuplicatePoints(item) === (item.duplicatePoints ?? collectibleDuplicatePoints(item)),
    `${item.name} 使用目录配置的重复折算`,
  )
}
assert(collectibleDuplicatePoints(null) === 0, '未知藏品重复折算 0')

console.log(`✅ 搜打撤藏品室自检：${passed} 个断言`)