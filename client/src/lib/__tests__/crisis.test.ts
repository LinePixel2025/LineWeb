import { describe, expect, it } from 'vitest'
import {
  crisisMsUntilBlock,
  crisisQuickAmounts,
  formatCrisisCountdown,
  formatCrisisPoints,
} from '../crisis'
import type { CrisisStateDto } from '../../types/crisis'

function stateOf(overrides: Partial<CrisisStateDto> = {}): CrisisStateDto {
  const now = Date.UTC(2026, 10, 4, 12, 0, 0)
  return {
    enabled: true,
    exempt: false,
    status: 'due',
    blocked: false,
    hasLiveRaid: false,
    round: 1,
    snapshot: 10_000,
    required: 5000,
    paid: 0,
    remaining: 5000,
    assets: { total: 10_000, parts: {
      points: 1000, raidGear: 0, raidWarehouse: 0, raidBags: 0, petOutfits: 0, petEquipment: 0,
      petSkills: 0, stocks: 0, stockOrders: 0, bankDemand: 0, bankDeposits: 0, funds: 0,
    } },
    rules: { enabled: true, ratio: 0.5, intervalMs: 48 * 3600_000, graceMs: 12 * 3600_000, minLevy: 100 },
    openAt: new Date(now).toISOString(),
    graceUntil: new Date(now + 12 * 3600_000).toISOString(),
    settledAt: null,
    nextDueAt: null,
    msUntilBlock: 12 * 3600_000,
    poolTotal: '0',
    ...overrides,
  } as CrisisStateDto
}

describe('formatCrisisPoints', () => {
  it('数字按千分位分组并向下取整', () => {
    expect(formatCrisisPoints(1000)).toBe('1,000')
    expect(formatCrisisPoints(1234567)).toBe('1,234,567')
    expect(formatCrisisPoints(99.9)).toBe('99')
  })

  it('BigInt 字符串逐位分组，绝不先转 Number 丢精度', () => {
    expect(formatCrisisPoints('123456789012345678901234')).toBe('123,456,789,012,345,678,901,234')
    expect(formatCrisisPoints('9007199254740993')).toBe('9,007,199,254,740,993')
  })

  it('负数与零', () => {
    expect(formatCrisisPoints(-1500)).toBe('-1,500')
    expect(formatCrisisPoints('-2500')).toBe('-2,500')
    expect(formatCrisisPoints(0)).toBe('0')
  })

  it('脏输入回退 0 或原样，不抛异常', () => {
    expect(formatCrisisPoints(Number.NaN)).toBe('0')
    expect(formatCrisisPoints(null)).toBe('0')
    expect(formatCrisisPoints(undefined)).toBe('0')
    expect(formatCrisisPoints('abc')).toBe('abc')
  })
})

describe('formatCrisisCountdown', () => {
  const HOUR = 3600_000
  const DAY = 24 * HOUR

  it('到期与非正数一律「已到期」', () => {
    expect(formatCrisisCountdown(0)).toBe('已到期')
    expect(formatCrisisCountdown(-5000)).toBe('已到期')
    expect(formatCrisisCountdown(Number.NaN)).toBe('已到期')
  })

  it('不足一分钟不显示「0 分钟」', () => {
    expect(formatCrisisCountdown(30_000)).toBe('不足 1 分钟')
  })

  it('分 / 时 / 天三档', () => {
    expect(formatCrisisCountdown(45 * 60_000)).toBe('45 分钟')
    expect(formatCrisisCountdown(2 * HOUR + 30 * 60_000)).toBe('2 小时 30 分')
    expect(formatCrisisCountdown(50 * HOUR)).toBe('2 天 2 小时')
  })
})

describe('crisisQuickAmounts', () => {
  it('余额充足时给出递增的档位，末档是「能缴的全部」', () => {
    const amounts = crisisQuickAmounts(stateOf({ required: 1000, remaining: 1000 }), 5000)
    expect(amounts).toEqual([250, 500, 750, 1000])
    expect(amounts[amounts.length - 1]).toBe(1000)
  })

  it('余额不足时末档被截到余额，且不出现必然失败的档位', () => {
    const amounts = crisisQuickAmounts(stateOf({ required: 1000, remaining: 1000 }), 300)
    expect(amounts[amounts.length - 1]).toBe(300)
    expect(amounts.every((value) => value <= 300)).toBe(true)
  })

  it('没有可用积分时返回空数组（前端据此隐藏快捷方式）', () => {
    expect(crisisQuickAmounts(stateOf(), 0)).toEqual([])
    expect(crisisQuickAmounts(stateOf({ remaining: 0 }), 5000)).toEqual([])
  })

  it('已缴过一部分时按剩余应缴出档位', () => {
    const amounts = crisisQuickAmounts(stateOf({ required: 1000, paid: 600, remaining: 400 }), 9000)
    expect(amounts).toEqual([100, 200, 300, 400])
  })

  it('最多四档且严格递增', () => {
    const amounts = crisisQuickAmounts(stateOf({ required: 999_999, remaining: 999_999 }), 999_999)
    expect(amounts.length).toBeLessThanOrEqual(4)
    amounts.forEach((value, index) => {
      if (index > 0) expect(value).toBeGreaterThan(amounts[index - 1])
    })
  })

  it('脏余额不产生 0 或负数档位', () => {
    expect(crisisQuickAmounts(stateOf(), Number.NaN)).toEqual([])
    expect(crisisQuickAmounts(stateOf(), -100)).toEqual([])
  })
})

describe('crisisMsUntilBlock', () => {
  it('只有待缴状态给出倒计时', () => {
    const grace = Date.UTC(2026, 10, 5, 0, 0, 0)
    const now = Date.UTC(2026, 10, 4, 12, 0, 0)
    const state = stateOf({ graceUntil: new Date(grace).toISOString() })
    expect(crisisMsUntilBlock(state, now)).toBe(grace - now)
    expect(crisisMsUntilBlock({ ...state, status: 'blocked' } as CrisisStateDto, now)).toBe(0)
    expect(crisisMsUntilBlock({ ...state, status: 'clear', graceUntil: null } as CrisisStateDto, now)).toBe(0)
  })

  it('倒计时不会为负', () => {
    const grace = Date.UTC(2026, 10, 4, 11, 0, 0)
    const state = stateOf({ graceUntil: new Date(grace).toISOString() })
    expect(crisisMsUntilBlock(state, Date.UTC(2026, 10, 4, 12, 0, 0))).toBe(0)
  })
})
