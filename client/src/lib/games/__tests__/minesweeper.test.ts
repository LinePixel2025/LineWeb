/**
 * 扫雷纯函数引擎测试（单机三档）
 *
 * 覆盖：首点安全（3×3 无雷）、同 seed 确定性、雷数正确、adjacent 计算、
 * 洪水展开边界（角 / 边）、和弦正确展开与旗数不符时不动、
 * msIsCleared / 剩余雷数、旗子开关、计时与状态推进、
 * 最佳时间只存更快值与胜败场统计（localStorage mock）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MS_BEST_STORAGE_PREFIX,
  MS_LEVELS,
  MS_LEVEL_ORDER,
  MS_ONLINE,
  MS_PLAYER_COLORS,
  MS_STATS_STORAGE_KEY,
  createMsBoard,
  createMsSession,
  emptyMsStats,
  formatMsTenths,
  formatMsTime,
  loadMsBest,
  loadMsStats,
  msAdjacent,
  msChord,
  msChordCell,
  msColorForSeat,
  msIsCleared,
  msIsMine,
  msNeighborIndices,
  msOpenCell,
  msRemainingMines,
  msRemainingSafe,
  msReveal,
  msSessionElapsedMs,
  msToIndex,
  msToXY,
  msToggleFlag,
  mulberry32,
  saveMsBest,
  saveMsResult,
  type MsBoard,
  type MsLevel,
} from '../minesweeper'

/** 手工造一个盘面：mines 列表标雷 */
function boardFrom(width: number, height: number, mines: number[]): MsBoard {
  const bombs: boolean[] = new Array<boolean>(width * height).fill(false)
  for (const index of mines) bombs[index] = true
  return { width, height, mines: mines.length, bombs }
}

/** 数一遍盘面雷数 */
function countMines(board: MsBoard): number {
  return board.bombs.filter((cell) => cell).length
}

/** 首点 3×3 邻域（含自己）是否全部无雷 */
function neighborhoodIsSafe(board: MsBoard, index: number): boolean {
  if (board.bombs[index]) return false
  return msNeighborIndices(board, index).every((n) => !board.bombs[n])
}

describe('难度与盘面常量', () => {
  it('三档尺寸与雷数：初级 9×9/10、中级 12×12/22、高级 16×16/40', () => {
    expect(MS_LEVEL_ORDER).toEqual(['beginner', 'intermediate', 'expert'])
    expect(MS_LEVELS.beginner).toMatchObject({ width: 9, height: 9, mines: 10 })
    expect(MS_LEVELS.intermediate).toMatchObject({ width: 12, height: 12, mines: 22 })
    expect(MS_LEVELS.expert).toMatchObject({ width: 16, height: 16, mines: 40 })
    expect(MS_LEVELS.beginner.label).toBe('初级')
  })

  it('联机盘面与中级一致（12×12 / 22），插旗配色至少 4 个', () => {
    expect(MS_ONLINE).toEqual({ width: 12, height: 12, mines: 22 })
    expect(MS_PLAYER_COLORS).toHaveLength(4)
    expect(msColorForSeat(0)).toBe(MS_PLAYER_COLORS[0])
    expect(msColorForSeat(6)).toBe(MS_PLAYER_COLORS[2])
    expect(msColorForSeat(-1)).toBe(MS_PLAYER_COLORS[3])
  })
})

describe('几何 helper', () => {
  it('msToXY / msToIndex 互为逆运算，越界安全', () => {
    const board = boardFrom(9, 9, [])
    expect(msToXY(board, 40)).toEqual({ x: 4, y: 4 })
    expect(msToIndex(board, 4, 4)).toBe(40)
    expect(msToIndex(board, -1, 0)).toBe(-1)
    expect(msToIndex(board, 9, 0)).toBe(-1)
    expect(msToXY(board, 81)).toBeNull()
    expect(msToXY(board, -2)).toBeNull()
  })

  it('邻格数量：角 3、边 5、心 8', () => {
    const board = boardFrom(9, 9, [])
    expect(msNeighborIndices(board, 0)).toHaveLength(3)
    expect(msNeighborIndices(board, 4)).toHaveLength(5)
    expect(msNeighborIndices(board, 40)).toHaveLength(8)
    // 非法索引返回空数组，不抛异常
    expect(msNeighborIndices(board, 999)).toEqual([])
  })
})

describe('createMsBoard', () => {
  it('首点 3×3 邻域保证无雷（含四角与边上的首点）', () => {
    const spec = MS_LEVELS.expert
    const corners = [0, spec.width - 1, (spec.height - 1) * spec.width, spec.width * spec.height - 1]
    for (const first of corners) {
      const board = createMsBoard('expert', first, 20261024)
      expect(board.bombs[first]).toBe(false)
      expect(neighborhoodIsSafe(board, first)).toBe(true)
    }
    // 中心点：整个 3×3 都是安全圈
    const middle = msToIndex(
      { width: spec.width, height: spec.height, mines: 0, bombs: [] },
      Math.floor(spec.width / 2),
      Math.floor(spec.height / 2)
    )
    const board = createMsBoard('expert', middle, 7)
    expect(neighborhoodIsSafe(board, middle)).toBe(true)
    expect(msNeighborIndices(board, middle)).toHaveLength(8)
  })

  it('同 seed + 同首点 → 完全相同的盘面；不同 seed 盘面不同', () => {
    const a = createMsBoard('intermediate', 63, 1234)
    const b = createMsBoard('intermediate', 63, 1234)
    const c = createMsBoard('intermediate', 63, 1235)
    expect(a.bombs).toEqual(b.bombs)
    expect(a.bombs.some((cell, i) => cell !== c.bombs[i])).toBe(true)
    // 确定性 RNG 本身也稳定
    const r1 = mulberry32(99)
    const r2 = mulberry32(99)
    expect(r1()).toBe(r2())
  })

  it('每档雷数正确，且尺寸与档位一致', () => {
    for (const level of MS_LEVEL_ORDER) {
      const spec = MS_LEVELS[level]
      const board = createMsBoard(level, Math.floor((spec.width * spec.height) / 2), 42)
      expect(board.width).toBe(spec.width)
      expect(board.height).toBe(spec.height)
      expect(board.bombs).toHaveLength(spec.width * spec.height)
      expect(board.mines).toBe(spec.mines)
      expect(countMines(board)).toBe(spec.mines)
    }
  })

  it('首点保护圈不会挤占雷位：初级仍足额 10 雷，且保护圈内一格无雷', () => {
    const board = createMsBoard('beginner', 40, 5)
    const blocked = 1 + msNeighborIndices(board, 40).length
    const safeTotal = MS_LEVELS.beginner.width * MS_LEVELS.beginner.height
    // 保护圈占 9 格，剩余可撒雷格远多于 10 → mines 足额
    expect(safeTotal - blocked).toBeGreaterThan(MS_LEVELS.beginner.mines)
    expect(board.mines).toBe(MS_LEVELS.beginner.mines)
    expect(countMines(board)).toBe(board.mines)
    // 雷全部落在保护圈之外
    const outside = msNeighborIndices(board, 40).filter((n) => board.bombs[n])
    expect(outside).toHaveLength(0)
  })
})

describe('msAdjacent / msIsMine', () => {
  it('按 8 邻域正确计数（只数邻格，不含自己）', () => {
    // 3×3，雷放在三个对角线格 0、4、8
    const board = boardFrom(3, 3, [0, 4, 8])
    expect(msIsMine(board, 0)).toBe(true)
    expect(msIsMine(board, 4)).toBe(true)
    expect(msIsMine(board, 1)).toBe(false)
    expect(msIsMine(board, 99)).toBe(false)
    // 角：邻格 1、3、4 → 只有 4 是雷
    expect(msAdjacent(board, 0)).toBe(1)
    expect(msAdjacent(board, 8)).toBe(1)
    // 边中：邻格含两个雷
    expect(msAdjacent(board, 1)).toBe(2)
    expect(msAdjacent(board, 7)).toBe(2)
    // 中心自己也是雷，但数字只数邻格（0 与 8）
    expect(msAdjacent(board, 4)).toBe(2)
    expect(msAdjacent(board, 99)).toBe(0)
  })

  it('满雷盘中心数字为 8', () => {
    const board = boardFrom(3, 3, [0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(msAdjacent(board, 4)).toBe(8)
  })
})

describe('msReveal 洪水展开', () => {
  it('数字格只开自己，空白格向外扩散', () => {
    // 5×5，雷只在 (4,4) = 24
    const board = boardFrom(5, 5, [24])
    // (0,0) 周围无雷 → 空白 → 洪水展开
    const blank = msReveal(board, new Set<number>(), 0)
    expect(blank.mine).toBe(false)
    expect(blank.cells.length).toBeGreaterThan(1)
    expect(blank.cells).toContain(0)
    // 已开格再开 → 空结果，且不含重复
    const again = msReveal(board, new Set<number>(blank.cells), 0)
    expect(again.cells).toEqual([])
    expect(new Set(blank.cells).size).toBe(blank.cells.length)
  })

  it('踩雷只返回该雷格本身，mine 为 true', () => {
    const board = boardFrom(5, 5, [12])
    const result = msReveal(board, new Set<number>(), 12)
    expect(result.mine).toBe(true)
    expect(result.cells).toEqual([12])
  })

  it('洪水展开在角 / 边被棋盘边界裁住，不越界', () => {
    const board = boardFrom(5, 5, [])
    const result = msReveal(board, new Set<number>(), 0)
    // 全盘无雷 → 一次展开 25 格
    expect(result.cells).toHaveLength(25)
    expect(msIsCleared(board, new Set<number>(result.cells))).toBe(true)
    expect(result.cells.every((i) => i >= 0 && i < 25)).toBe(true)
  })

  it('和弦的洪水展开被旗子挡住，不会重复输出', () => {
    // 5×5：格 0 为数字 1（雷在 6），把旗插对 6 后在 0 上和弦
    const board = boardFrom(5, 5, [6])
    const opened = new Set<number>([0])
    const flags = new Set<number>([6])
    const result = msChord(board, opened, flags, 0)
    expect(result.mine).toBe(false)
    expect(result.cells).not.toContain(6)
    expect(result.cells).not.toContain(0)
    expect(new Set(result.cells).size).toBe(result.cells.length)
  })
})

describe('msChord 和弦', () => {
  it('旗数 == 数字时展开其余邻格', () => {
    // 4×4：雷在 0 与 1；格 5（x=1,y=1）周围有 2 雷
    const board = boardFrom(4, 4, [0, 1])
    const opened = new Set<number>([5])
    const flags = new Set<number>([0, 1])
    const result = msChord(board, opened, flags, 5)
    expect(result.mine).toBe(false)
    // 邻格 8 个里去掉两个已插旗的雷 → 展开 6 个（含继续扩散的空白）
    expect(result.cells.length).toBeGreaterThanOrEqual(6)
    expect(result.cells).not.toContain(0)
    expect(result.cells).not.toContain(1)
    expect(result.cells).not.toContain(5)
  })

  it('旗数不足或过多时完全不动', () => {
    const board = boardFrom(4, 4, [0, 1])
    const opened = new Set<number>([5])
    expect(msChord(board, opened, new Set<number>([0]), 5)).toEqual({ cells: [], mine: false })
    expect(msChord(board, opened, new Set<number>([0, 1, 2]), 5)).toEqual({ cells: [], mine: false })
    expect(msChord(board, opened, new Set<number>(), 5)).toEqual({ cells: [], mine: false })
  })

  it('未翻开的格子、空白格与索引越界时和弦都完全不动', () => {
    const board = boardFrom(4, 4, [0])
    // 未翻开 → 拒绝
    expect(msChord(board, new Set<number>(), new Set<number>(), 5)).toEqual({ cells: [], mine: false })
    // 已翻开但是数字 0 → 拒绝（和弦只对数字格有意义）
    expect(msChord(board, new Set<number>([15]), new Set<number>(), 15)).toEqual({
      cells: [],
      mine: false,
    })
    // 越界索引 → 拒绝
    expect(msChord(board, new Set<number>([99]), new Set<number>(), 99)).toEqual({
      cells: [],
      mine: false,
    })
  })

  it('和弦踩到标错的旗 → mine 为 true', () => {
    // 3×3：雷在 2 与 6；格 4 数字 2。把旗插错在 1 和 3，则 2、6 会被和弦翻开
    const board = boardFrom(3, 3, [2, 6])
    const opened = new Set<number>([4])
    const flags = new Set<number>([1, 3])
    const result = msChord(board, opened, flags, 4)
    expect(result.mine).toBe(true)
    expect(result.cells).toContain(2)
    expect(result.cells).toContain(6)
  })
})

describe('剩余雷数与全清判定', () => {
  it('msRemainingSafe 随翻开递减，msIsCleared 只在看清后为真', () => {
    // 4×4，雷 2 个 → safe 14
    const board = boardFrom(4, 4, [0, 15])
    expect(msRemainingSafe(board, new Set<number>())).toBe(14)
    const opened = new Set<number>()
    for (let i = 1; i < 15; i += 1) opened.add(i)
    expect(msRemainingSafe(board, opened)).toBe(0)
    expect(msIsCleared(board, opened)).toBe(true)
    opened.delete(7)
    expect(msIsCleared(board, opened)).toBe(false)
    expect(msRemainingSafe(board, opened)).toBe(1)
  })

  it('会话剩余雷数 = 雷数 - 旗数', () => {
    const session = createMsSession('beginner', 1)
    expect(msRemainingMines(session)).toBe(10)
    expect(msToggleFlag(session, 0)).toBe(true)
    expect(msToggleFlag(session, 1)).toBe(true)
    expect(msRemainingMines(session)).toBe(8)
    // 再点一次是撤旗：0 撤掉回到 9，1 撤掉回到 10
    expect(msToggleFlag(session, 0)).toBe(true)
    expect(msRemainingMines(session)).toBe(9)
    expect(msToggleFlag(session, 1)).toBe(true)
    expect(msRemainingMines(session)).toBe(10)
    // 重新插旗又减一
    expect(msToggleFlag(session, 0)).toBe(true)
    expect(msRemainingMines(session)).toBe(9)
    // 非法索引不改变任何东西
    expect(msToggleFlag(session, -1)).toBe(false)
    expect(msRemainingMines(session)).toBe(9)
  })
})

describe('会话状态与计时', () => {
  it('首点前 status=ready、用时 0；首点必安全并进入 playing', () => {
    const session = createMsSession('expert', 4242)
    expect(session.board).toBeNull()
    expect(session.status).toBe('ready')
    expect(msSessionElapsedMs(session, 1_000_000)).toBe(0)

    const result = msOpenCell(session, 40, 1_000)
    expect(result.mine).toBe(false)
    expect(session.board).not.toBeNull()
    expect(neighborhoodIsSafe(session.board as MsBoard, 40)).toBe(true)
    expect(session.status).toBe('playing')
    expect(session.startedAt).toBe(1_000)
    expect(msSessionElapsedMs(session, 5_000)).toBe(4_000)
  })

  it('已插旗的格子不能翻开，已开格不能插旗', () => {
    const session = createMsSession('intermediate', 77)
    msOpenCell(session, 63, 1_000)
    const target = 0
    expect(msToggleFlag(session, target)).toBe(true)
    const blocked = msOpenCell(session, target, 2_000)
    expect(blocked.cells).toEqual([])
    expect(session.opened.has(target)).toBe(false)
    // 已开格插旗失败
    expect(msToggleFlag(session, 63)).toBe(false)
  })

  it('踩雷进入 lost 并记录雷格、冻结计时', () => {
    const session = createMsSession('beginner', 2024)
    msOpenCell(session, 40, 1_000)
    const board = session.board as MsBoard
    const mineIndex = board.bombs.findIndex((cell) => cell)
    const result = msOpenCell(session, mineIndex, 9_000)
    expect(result.mine).toBe(true)
    expect(session.status).toBe('lost')
    expect(session.boomIndex).toBe(mineIndex)
    expect(session.finishedAt).toBe(9_000)
    expect(msSessionElapsedMs(session, 99_000)).toBe(8_000)
    // 结束后任何操作都不再改变状态
    expect(msOpenCell(session, 0, 120_000).cells).toEqual([])
    expect(msToggleFlag(session, 1)).toBe(false)
  })

  it('会话和弦：旗数不符时不动，旗插错时判负', () => {
    const session = createMsSession('beginner', 5)
    // 注入手工盘面（3×3，雷在两个上角），中心格数字为 2
    session.board = boardFrom(3, 3, [0, 2])
    session.opened = new Set<number>([4])
    session.flags = new Set<number>([1])
    session.startedAt = 1_000
    session.status = 'playing'

    // 只插了 1 面旗 ≠ 数字 2 → 完全不动
    const noop = msChordCell(session, 4, 1_500)
    expect(noop).toEqual({ cells: [], mine: false })
    expect(session.status).toBe('playing')
    expect(session.opened.size).toBe(1)
    expect(session.finishedAt).toBeNull()

    // 再补一面插错的旗（非雷格 3）→ 旗数 == 2 生效，把真雷 0、2 炸出来
    expect(msToggleFlag(session, 3)).toBe(true)
    const boom = msChordCell(session, 4, 2_000)
    expect(boom.mine).toBe(true)
    expect(boom.cells).toContain(0)
    expect(session.status).toBe('lost')
    expect(session.boomIndex).toBe(0)
    expect(session.finishedAt).toBe(2_000)
  })

  it('全清即胜：status=won、剩余雷数为 0', () => {
    const session = createMsSession('intermediate', 3333)
    msOpenCell(session, 0, 1_000)
    const board = session.board as MsBoard
    // 逐个翻开所有非雷格（不靠洪水展开，直接按引擎接口喂）
    for (let i = 0; i < board.bombs.length; i += 1) {
      if (board.bombs[i] || session.opened.has(i) || session.flags.has(i)) continue
      msOpenCell(session, i, 2_000)
      if (session.status !== 'playing') break
    }
    expect(session.status).toBe('won')
    expect(msIsCleared(board, session.opened)).toBe(true)
    expect(msRemainingMines(session)).toBeLessThanOrEqual(0)
    expect(msSessionElapsedMs(session, 60_000)).toBe(1_000)
  })
})

describe('时间格式化', () => {
  it('mm:ss 补零，十分位单独给', () => {
    expect(formatMsTime(0)).toBe('00:00')
    expect(formatMsTime(9_400)).toBe('00:09')
    expect(formatMsTime(65_000)).toBe('01:05')
    expect(formatMsTime(600_000)).toBe('10:00')
    expect(formatMsTime(-5)).toBe('00:00')
    expect(formatMsTenths(9_480)).toBe('4')
    expect(formatMsTenths(9_580)).toBe('5')
  })
})

describe('本机纪录（localStorage）', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

  /** 用内存字典替换 globalThis.localStorage，返回内部字典便于断言 */
  function installFakeStorage(initial: Record<string, string> = {}): Record<string, string> {
    const store: Record<string, string> = { ...initial }
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) => (key in store ? store[key] : null),
        setItem: (key: string, value: string) => {
          store[key] = String(value)
        },
      },
      configurable: true,
      writable: true,
    })
    return store
  }

  function restoreStorage(): void {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  }

  beforeEach(() => {
    installFakeStorage()
  })

  afterEach(() => {
    restoreStorage()
    vi.restoreAllMocks()
  })

  it('最佳时间按档独立，且只存更快值', () => {
    const store = installFakeStorage()
    expect(loadMsBest('beginner')).toBe(0)
    expect(saveMsBest('beginner', 12_000)).toBe(12_000)
    expect(store[`${MS_BEST_STORAGE_PREFIX}beginner`]).toBe('12000')
    // 更慢不覆盖
    expect(saveMsBest('beginner', 15_000)).toBe(12_000)
    expect(store[`${MS_BEST_STORAGE_PREFIX}beginner`]).toBe('12000')
    // 更快才覆盖
    expect(saveMsBest('beginner', 9_870)).toBe(9_870)
    expect(loadMsBest('beginner')).toBe(9_870)
    // 另一档互不影响
    expect(saveMsBest('expert', 30_000)).toBe(30_000)
    expect(loadMsBest('intermediate')).toBe(0)
    // 非法值不写入
    expect(saveMsBest('beginner', 0)).toBe(9_870)
    expect(saveMsBest('beginner', Number.NaN)).toBe(9_870)
  })

  it('脏数据回退为 0', () => {
    installFakeStorage({ [`${MS_BEST_STORAGE_PREFIX}beginner`]: 'abc' })
    expect(loadMsBest('beginner')).toBe(0)
    installFakeStorage({ [`${MS_BEST_STORAGE_PREFIX}beginner`]: '-5' })
    expect(loadMsBest('beginner')).toBe(0)
  })

  it('胜败场按档累计', () => {
    const store = installFakeStorage()
    expect(loadMsStats()).toEqual(emptyMsStats())
    const afterWin = saveMsResult('intermediate', true)
    expect(afterWin.wins.intermediate).toBe(1)
    const afterLoss = saveMsResult('intermediate', false)
    expect(afterLoss.wins.intermediate).toBe(1)
    expect(afterLoss.losses.intermediate).toBe(1)
    expect(loadMsStats().losses.intermediate).toBe(1)
    expect(store[MS_STATS_STORAGE_KEY]).toContain('intermediate')
    saveMsResult('expert', true)
    expect(loadMsStats().wins.expert).toBe(1)
    expect(loadMsStats().wins.beginner).toBe(0)
  })

  it('统计脏数据回退全 0，存储不可用时不抛异常', () => {
    installFakeStorage({ [MS_STATS_STORAGE_KEY]: '{坏数据' })
    expect(loadMsStats()).toEqual(emptyMsStats())
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => {
          throw new Error('隐私模式')
        },
        setItem: () => {
          throw new Error('配额超限')
        },
      },
      configurable: true,
      writable: true,
    })
    expect(loadMsBest('beginner')).toBe(0)
    expect(saveMsBest('beginner', 5_000)).toBe(5_000)
    expect(loadMsStats()).toEqual(emptyMsStats())
    expect(() => saveMsResult('beginner', true)).not.toThrow()
  })
})

describe('档位类型契约', () => {
  it('MS_LEVEL_ORDER 覆盖全部档位的键', () => {
    const keys = Object.keys(MS_LEVELS).sort()
    expect(keys).toEqual([...MS_LEVEL_ORDER].sort())
    const levels: MsLevel[] = ['beginner', 'intermediate', 'expert']
    expect(levels).toHaveLength(3)
  })
})
