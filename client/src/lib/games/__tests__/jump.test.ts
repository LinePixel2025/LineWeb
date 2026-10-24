/**
 * 跳一跳纯函数引擎测试
 *
 * 覆盖：常量口径、jumpDistance 线性与钳制、resolveJump 五种边界（±size、±size*0.30）、
 * jumpScore 连击 2/4/8/16/32 封顶与非中心归零、createJumpCourse 同 seed 确定性 + 范围、
 * finishJump 命中前进 boxIndex / 落空 dead、等距几何 helper、
 * 本机最高分与累计战绩（localStorage 读写、只存更高、脏数据容错）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  JUMP_CENTER_RATIO,
  JUMP_COMBO_CAP,
  JUMP_GAP_MAX,
  JUMP_GAP_MIN,
  JUMP_MAX_CHARGE_MS,
  JUMP_MAX_DISTANCE,
  JUMP_MAX_SCORE_GAIN,
  JUMP_SIZE_MAX,
  JUMP_SIZE_MIN,
  JUMP_BEST_STORAGE_KEY,
  JUMP_STATS_STORAGE_KEY,
  beginJumpCharge,
  clampJumpCharge,
  createJumpCourse,
  createJumpSession,
  emptyJumpStats,
  ensureJumpCourse,
  finishJump,
  formatJumpBroadcast,
  formatJumpOffset,
  jumpArcLift,
  jumpAverageOffset,
  jumpAverageScore,
  jumpAxisOfBox,
  jumpBoxColors,
  jumpColorForSeat,
  jumpDistance,
  jumpFlightMs,
  jumpIsDead,
  jumpIso,
  jumpPowerRatio,
  jumpScore,
  jumpSquash,
  loadJumpBest,
  loadJumpStats,
  mulberry32,
  resolveJump,
  saveJumpBest,
  saveJumpRun,
} from '../jump'

/** 让距离正好落到某个落点所需的蓄力毫秒数（chargeMs → 线性距离） */
function chargeForDistance(distance: number): number {
  return (distance / JUMP_MAX_DISTANCE) * JUMP_MAX_CHARGE_MS
}

/** 让落点相对盒中心偏移 offset 所需的蓄力毫秒数 */
function chargeForOffset(gap: number, offset: number): number {
  return chargeForDistance(gap + offset)
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  window.localStorage.clear()
})

describe('常量口径（前后端唯一真相源）', () => {
  it('与服务端约定的数值逐字一致', () => {
    expect(JUMP_MAX_CHARGE_MS).toBe(2000)
    expect(JUMP_MAX_DISTANCE).toBe(260)
    expect(JUMP_GAP_MIN).toBe(60)
    expect(JUMP_GAP_MAX).toBe(150)
    expect(JUMP_SIZE_MIN).toBe(26)
    expect(JUMP_SIZE_MAX).toBe(36)
    expect(JUMP_CENTER_RATIO).toBe(0.3)
    expect(JUMP_COMBO_CAP).toBe(5)
    expect(JUMP_MAX_SCORE_GAIN).toBe(32)
  })
})

describe('jumpDistance', () => {
  it('满蓄力跳到最远距离、0 蓄力不前进', () => {
    expect(jumpDistance(JUMP_MAX_CHARGE_MS)).toBe(JUMP_MAX_DISTANCE)
    expect(jumpDistance(0)).toBe(0)
  })

  it('中段线性：一半蓄力跳一半距离', () => {
    expect(jumpDistance(1000)).toBeCloseTo(130, 6)
    expect(jumpDistance(500)).toBeCloseTo(65, 6)
  })

  it('超出上限按上限钳制，负数与脏数据当 0', () => {
    expect(jumpDistance(5000)).toBe(JUMP_MAX_DISTANCE)
    expect(jumpDistance(-100)).toBe(0)
    expect(jumpDistance(Number.NaN)).toBe(0)
    expect(clampJumpCharge(9999)).toBe(JUMP_MAX_CHARGE_MS)
    expect(jumpPowerRatio(JUMP_MAX_CHARGE_MS)).toBe(1)
    expect(jumpPowerRatio(0)).toBe(0)
  })
})

describe('resolveJump 五种边界', () => {
  // 蓄力 1000 毫秒恰好对应 130 逻辑单位（整数运算，边界断言不受浮点误差影响）
  const CHARGE = 1000
  const DISTANCE = 130
  const SIZE = 30
  const CENTER = SIZE * JUMP_CENTER_RATIO // 9

  it('offset = 0 判中心', () => {
    const result = resolveJump(CHARGE, DISTANCE, SIZE)
    expect(result.kind).toBe('center')
    expect(result.offset).toBe(0)
  })

  it('中心容差内侧算 center、刚好等于容差也算 center（正负两侧）', () => {
    expect(resolveJump(CHARGE, DISTANCE - CENTER + 1, SIZE).kind).toBe('center')
    expect(resolveJump(CHARGE, DISTANCE + CENTER - 1, SIZE).kind).toBe('center')
    expect(resolveJump(CHARGE, DISTANCE - CENTER, SIZE).kind).toBe('center')
    expect(resolveJump(CHARGE, DISTANCE + CENTER, SIZE).kind).toBe('center')
  })

  it('超出中心容差但仍在盒面内算 normal（两侧都覆盖，含 ±size 边界）', () => {
    expect(resolveJump(CHARGE, DISTANCE - CENTER - 1, SIZE).kind).toBe('normal')
    expect(resolveJump(CHARGE, DISTANCE + CENTER + 1, SIZE).kind).toBe('normal')
    expect(resolveJump(CHARGE, DISTANCE + SIZE, SIZE).kind).toBe('normal')
    expect(resolveJump(CHARGE, DISTANCE - SIZE, SIZE).kind).toBe('normal')
  })

  it('越过 ±size 立刻判落空：够不到（offset < -size）判 short、冲过头（offset > size）判 long', () => {
    // gap 比实际距离大 → 落点在盒中心之前 → 跳短；gap 比实际距离小 → 冲过头 → 跳长
    expect(resolveJump(CHARGE, DISTANCE + SIZE + 1, SIZE).kind).toBe('short')
    expect(resolveJump(CHARGE, DISTANCE - SIZE - 1, SIZE).kind).toBe('long')
    expect(jumpIsDead('short')).toBe(true)
    expect(jumpIsDead('long')).toBe(true)
    expect(jumpIsDead('off')).toBe(true)
    expect(jumpIsDead('center')).toBe(false)
    expect(jumpIsDead('normal')).toBe(false)
  })

  it('满蓄力最远跳：gap 取到上限时仍能落到近处盒子，取不满时判 short', () => {
    expect(resolveJump(JUMP_MAX_CHARGE_MS, JUMP_GAP_MAX, SIZE).kind).toBe('long')
    expect(resolveJump(0, JUMP_GAP_MIN, SIZE).kind).toBe('short')
    expect(resolveJump(JUMP_MAX_CHARGE_MS, JUMP_MAX_DISTANCE, SIZE).kind).toBe('center')
  })

  it('distance 与 offset 自洽：offset = distance - gap', () => {
    const result = resolveJump(1200, 100, SIZE)
    expect(result.distance).toBeCloseTo(jumpDistance(1200), 6)
    expect(result.offset).toBeCloseTo(result.distance - 100, 6)
  })
})

describe('jumpScore', () => {
  it('连续中心命中按 2/4/8/16/32 递增', () => {
    expect(jumpScore(0, 'center')).toEqual({ comboAfter: 1, gained: 2 })
    expect(jumpScore(1, 'center')).toEqual({ comboAfter: 2, gained: 4 })
    expect(jumpScore(2, 'center')).toEqual({ comboAfter: 3, gained: 8 })
    expect(jumpScore(3, 'center')).toEqual({ comboAfter: 4, gained: 16 })
    expect(jumpScore(4, 'center')).toEqual({ comboAfter: 5, gained: 32 })
  })

  it('连击超过封顶仍是 32 分', () => {
    expect(jumpScore(5, 'center')).toEqual({ comboAfter: 6, gained: 32 })
    expect(jumpScore(99, 'center')).toEqual({ comboAfter: 100, gained: JUMP_MAX_SCORE_GAIN })
  })

  it('普通落盒 +1 且连击归零；落空不得分并归零', () => {
    expect(jumpScore(4, 'normal')).toEqual({ comboAfter: 0, gained: 1 })
    expect(jumpScore(4, 'short')).toEqual({ comboAfter: 0, gained: 0 })
    expect(jumpScore(4, 'long')).toEqual({ comboAfter: 0, gained: 0 })
    expect(jumpScore(4, 'off')).toEqual({ comboAfter: 0, gained: 0 })
  })

  it('脏连击（负数）不会被带成正向加成', () => {
    expect(jumpScore(-3, 'center').gained).toBe(2)
  })
})

describe('createJumpCourse', () => {
  it('同一种子的序列完全一致（服务端可按同一 seed 复现同一路线）', () => {
    const a = createJumpCourse(20261024, 40)
    const b = createJumpCourse(20261024, 40)
    expect(a).toEqual(b)
    // 前缀稳定：更长序列的前 40 格与短序列一致
    expect(createJumpCourse(20261024, 80).slice(0, 40)).toEqual(a)
  })

  it('不同种子的序列不同', () => {
    expect(createJumpCourse(1, 20)).not.toEqual(createJumpCourse(2, 20))
  })

  it('第 0 盒 gap = 0，其余盒子 gap / size 在约定区间内，bonus 恒 false', () => {
    const boxes = createJumpCourse(7, 60)
    expect(boxes[0].index).toBe(0)
    expect(boxes[0].gap).toBe(0)
    expect(boxes[0].bonus).toBe(false)
    for (const box of boxes.slice(1)) {
      expect(box.gap).toBeGreaterThanOrEqual(JUMP_GAP_MIN)
      expect(box.gap).toBeLessThanOrEqual(JUMP_GAP_MAX)
      expect(box.size).toBeGreaterThanOrEqual(JUMP_SIZE_MIN)
      expect(box.size).toBeLessThanOrEqual(JUMP_SIZE_MAX)
      expect(box.kind === 'box' || box.kind === 'cylinder').toBe(true)
      expect(box.bonus).toBe(false)
      expect(box.index).toBeGreaterThan(0)
    }
  })

  it('index 连续递增且长度等于请求数量', () => {
    const boxes = createJumpCourse(99, 12)
    expect(boxes).toHaveLength(12)
    expect(boxes.map((box) => box.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('count 非法时至少生成 1 格', () => {
    expect(createJumpCourse(3, 0)).toHaveLength(1)
    expect(createJumpCourse(3, -5)).toHaveLength(1)
  })
})

describe('mulberry32', () => {
  it('同种子同序列、值域在 [0,1)', () => {
    const rnd = mulberry32(12345)
    const first = [rnd(), rnd(), rnd()]
    const rnd2 = mulberry32(12345)
    expect([rnd2(), rnd2(), rnd2()]).toEqual(first)
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('单机会话 finishJump', () => {
  it('初始站在第 0 盒、0 分、ready', () => {
    const session = createJumpSession(2026)
    expect(session.boxIndex).toBe(0)
    expect(session.score).toBe(0)
    expect(session.combo).toBe(0)
    expect(session.jumps).toBe(0)
    expect(session.status).toBe('ready')
    expect(Number.isFinite(session.bestOffset)).toBe(false)
  })

  it('命中盒面（normal）前进一格、+1 分', () => {
    const session = createJumpSession(4242)
    const target = session.course[1]
    const result = finishJump(session, chargeForOffset(target.gap, target.size * 0.6))
    expect(result.kind).toBe('normal')
    expect(result.gained).toBe(1)
    expect(result.dead).toBe(false)
    expect(result.boxIndex).toBe(1)
    expect(session.boxIndex).toBe(1)
    expect(session.score).toBe(1)
    expect(session.status).toBe('ready')
  })

  it('正中靶心连击加分并累计 combo', () => {
    const session = createJumpSession(4242)
    const first = finishJump(session, chargeForOffset(session.course[1].gap, 0))
    expect(first.kind).toBe('center')
    expect(first.gained).toBe(2)
    expect(session.combo).toBe(1)
    const second = finishJump(session, chargeForOffset(session.course[2].gap, 0))
    expect(second.gained).toBe(4)
    expect(session.combo).toBe(2)
    expect(session.score).toBe(6)
  })

  it('跳短了（short）判死：boxIndex 不变、combo 归零、status=over', () => {
    const session = createJumpSession(4242)
    const target = session.course[1]
    const result = finishJump(session, chargeForOffset(target.gap, -target.size - 6))
    expect(result.kind).toBe('short')
    expect(result.dead).toBe(true)
    expect(result.gained).toBe(0)
    expect(result.boxIndex).toBe(0)
    expect(session.status).toBe('over')
    expect(session.jumps).toBe(1)
  })

  it('跳过了（long）同样判死，且落点 targetIndex 记录目标盒', () => {
    const session = createJumpSession(4242)
    finishJump(session, 0) // 完全不蓄力：距离 0，必然 short
    expect(session.status).toBe('over')
    const session2 = createJumpSession(4242)
    const target = session2.course[1]
    const over = finishJump(session2, chargeForOffset(target.gap, target.size + 8))
    expect(over.kind).toBe('long')
    expect(over.targetIndex).toBe(1)
    expect(over.distance).toBeCloseTo(target.gap + target.size + 8, 4)
  })

  it('结束后再点不会被计分（幂等返回 off）', () => {
    const session = createJumpSession(4242)
    const target = session.course[1]
    finishJump(session, chargeForOffset(target.gap, -target.size - 1))
    const after = finishJump(session, chargeForOffset(session.course[1].gap, 0))
    expect(after.kind).toBe('off')
    expect(after.gained).toBe(0)
    expect(after.dead).toBe(false)
    expect(session.jumps).toBe(1)
  })

  it('落点记录 bestOffset（本局最准一次的绝对偏差）', () => {
    const session = createJumpSession(4242)
    const target = session.course[1]
    finishJump(session, chargeForOffset(target.gap, 5))
    expect(session.bestOffset).toBeCloseTo(5, 3)
    const next = session.course[2]
    finishJump(session, chargeForOffset(next.gap, 0))
    expect(session.bestOffset).toBeCloseTo(0, 6)
  })

  it('beginJumpCharge 只在 ready 时成功', () => {
    const session = createJumpSession(1)
    expect(beginJumpCharge(session)).toBe(true)
    expect(session.status).toBe('charging')
    // 已在蓄力时重复按下不生效
    expect(beginJumpCharge(session)).toBe(false)
    expect(session.status).toBe('charging')
    session.status = 'over'
    expect(beginJumpCharge(session)).toBe(false)
  })

  it('跳满预生成序列时自动续写，前缀保持不变', () => {
    const session = createJumpSession(777)
    const before = session.course.slice(0, 8)
    const originalLength = session.course.length
    const grown = ensureJumpCourse(session, originalLength + 100)
    expect(grown.length).toBeGreaterThanOrEqual(originalLength + 100)
    expect(grown.slice(0, 8)).toEqual(before)
    // 不足时按需补齐，已够则原样返回
    expect(ensureJumpCourse(session, 4)).toBe(grown)
    expect(jumpAxisOfBox(grown, 0)).toBe(0)
    expect(jumpAxisOfBox(grown, 3)).toBeCloseTo(
      grown[1].gap + grown[2].gap + grown[3].gap,
      6
    )
  })
})

describe('动画与几何 helper', () => {
  it('滞空时长 min(220 + chargeMs * 0.25, 700)', () => {
    expect(jumpFlightMs(0)).toBe(220)
    expect(jumpFlightMs(1000)).toBe(470)
    expect(jumpFlightMs(2000)).toBe(700)
    expect(jumpFlightMs(9999)).toBe(700)
  })

  it('蓄力压缩形变随蓄力增大且不超过上限', () => {
    expect(jumpSquash(0)).toBe(0)
    expect(jumpSquash(1000)).toBeCloseTo(0.21, 6)
    expect(jumpSquash(JUMP_MAX_CHARGE_MS)).toBeLessThanOrEqual(0.42)
  })

  it('等距投影：沿轴前进 x 增大、y 上移（负方向）', () => {
    const near = jumpIso(0)
    const far = jumpIso(120)
    expect(near).toEqual({ x: 0, y: 0 })
    expect(far.x).toBe(120)
    expect(far.y).toBeCloseTo(-60, 6)
    // 离地高度让 y 更负
    expect(jumpIso(120, 30).y).toBeCloseTo(-90, 6)
  })

  it('抛物线高度：两端为 0、中段为正', () => {
    expect(jumpArcLift(200, 0)).toBe(0)
    expect(jumpArcLift(200, 1)).toBeCloseTo(0, 6)
    expect(jumpArcLift(200, 0.5)).toBeGreaterThan(jumpArcLift(200, 0.2))
    expect(jumpArcLift(260, 0.5)).toBeGreaterThan(jumpArcLift(60, 0.5))
  })

  it('盒子配色随序号换色相、座位色越界取模', () => {
    expect(jumpBoxColors(0, false).top).not.toBe(jumpBoxColors(3, false).top)
    expect(jumpBoxColors(1, true).top).toMatch(/^hsl/)
    expect(jumpColorForSeat(0)).toBe('#0969da')
    expect(jumpColorForSeat(7)).toBe(jumpColorForSeat(1))
  })

  it('播报与偏移格式化文案', () => {
    expect(formatJumpBroadcast('张三', { kind: 'center', gained: 8 })).toBe('张三 正中靶心 +8')
    expect(formatJumpBroadcast('李四', { kind: 'short', gained: 0 })).toBe(
      '李四 跳短了，掉出盒子 —— 出局'
    )
    expect(formatJumpBroadcast('王五', { kind: 'normal', gained: 1 })).toBe('王五 稳稳落盒 +1')
    expect(formatJumpOffset(12.34)).toBe('+12.3')
    expect(formatJumpOffset(-12.34)).toBe('-12.3')
    expect(formatJumpOffset(null)).toBe('—')
  })
})

describe('本机记录（localStorage）', () => {
  it('无记录时最高分为 0', () => {
    expect(loadJumpBest()).toBe(0)
  })

  it('只存更高值：更低分数不会覆盖纪录', () => {
    expect(saveJumpBest(30)).toBe(30)
    expect(saveJumpBest(12)).toBe(30)
    expect(loadJumpBest()).toBe(30)
    expect(saveJumpBest(45)).toBe(45)
    expect(loadJumpBest()).toBe(45)
    expect(window.localStorage.getItem(JUMP_BEST_STORAGE_KEY)).toBe('45')
  })

  it('非正数与脏数据不入库', () => {
    saveJumpBest(20)
    expect(saveJumpBest(0)).toBe(20)
    expect(saveJumpBest(-8)).toBe(20)
    expect(saveJumpBest(Number.NaN)).toBe(20)
  })

  it('脏字符串回退为 0', () => {
    window.localStorage.setItem(JUMP_BEST_STORAGE_KEY, 'abc')
    expect(loadJumpBest()).toBe(0)
  })

  it('累计战绩：局数、总分、平均分数与平均落点偏差', () => {
    expect(loadJumpStats()).toEqual(emptyJumpStats())
    const afterFirst = saveJumpRun(10, { jumps: 6, bestCombo: 2, bestOffset: 3 })
    expect(afterFirst.runs).toBe(1)
    expect(afterFirst.totalScore).toBe(10)
    expect(afterFirst.totalJumps).toBe(6)
    expect(afterFirst.bestCombo).toBe(2)
    const afterSecond = saveJumpRun(20, { jumps: 4, bestCombo: 5, bestOffset: 1 })
    expect(afterSecond.runs).toBe(2)
    expect(afterSecond.totalScore).toBe(30)
    expect(afterSecond.bestCombo).toBe(5)
    expect(jumpAverageScore(afterSecond)).toBe(15)
    expect(jumpAverageOffset(afterSecond)).toBe(2)
    expect(jumpAverageOffset(emptyJumpStats())).toBeNull()
    expect(jumpAverageOffset({ ...emptyJumpStats(), offsetSum: 2, offsetCount: 4 })).toBe(0.5)
    expect(window.localStorage.getItem(JUMP_STATS_STORAGE_KEY)).toContain('"runs":2')
  })

  it('战绩脏数据回退为全 0', () => {
    window.localStorage.setItem(JUMP_STATS_STORAGE_KEY, '{ not json')
    expect(loadJumpStats()).toEqual(emptyJumpStats())
  })
})
