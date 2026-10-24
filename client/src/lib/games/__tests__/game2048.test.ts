/**
 * 2048 纯函数引擎测试
 *
 * 覆盖：初始棋盘、四方向移动、每块单次合并、得分/步数/最大方块、
 * 无效移动不生成方块、胜负判定、固定种子确定性、快照可序列化，
 * 以及游戏大厅目录的数据约束。
 */

import { describe, expect, it } from 'vitest'
import type { Game2048Direction } from '../../../types/game'
import {
  BOARD_SIZE,
  INITIAL_TILES,
  TARGET_TILE,
  createBoard,
  createGame,
  hasMoves,
  maxTile,
  moveGame,
  randomSeed,
  type Game2048Snapshot,
  type Game2048State,
} from '../game2048'
import {
  COMING_SOON_GAMES,
  GAME_2048_ONLINE_ROUTE,
  GAME_2048_ROUTE,
  GAME_CATALOG,
  PLAYABLE_GAMES,
  getGameCatalogEntry,
  isGamePlayable,
} from '../catalog'

/** 空行（合法 4x4 棋盘的填充行） */
const EMPTY_ROW = [0, 0, 0, 0]

/** 用棋盘构造一个可移动的快照（默认进行中、0 分、0 步） */
function snapshotOf(
  rows: number[][],
  overrides: Partial<Game2048State> = {},
  rngState = 20260423,
): Game2048Snapshot {
  const board = createBoard(rows)
  return {
    state: {
      board,
      score: 0,
      moves: 0,
      status: 'playing',
      maxTile: maxTile(board),
      ...overrides,
    },
    rngState,
  }
}

/** 棋盘上非零方块数量 */
function countTiles(board: number[][]): number {
  return board.flat().filter((value) => value !== 0).length
}

/** 全满且横竖都不相邻相等的棋盘（任何方向都无法移动） */
function blockedBoard(): number[][] {
  return [
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 2],
  ]
}

describe('createGame', () => {
  it('初始棋盘恰好 2 个方块，值为 2 或 4', () => {
    for (const seed of [0, 1, 2, 7, 42, 12345, 987654321]) {
      const snapshot = createGame(seed)
      const { board } = snapshot.state

      expect(board).toHaveLength(BOARD_SIZE)
      for (const row of board) expect(row).toHaveLength(BOARD_SIZE)
      expect(countTiles(board)).toBe(INITIAL_TILES)
      expect(board.flat().filter((value) => value !== 0).every((value) => value === 2 || value === 4)).toBe(true)
      expect(snapshot.state.score).toBe(0)
      expect(snapshot.state.moves).toBe(0)
      expect(snapshot.state.status).toBe('playing')
      expect(snapshot.state.maxTile).toBe(maxTile(board))
    }
  })

  it('固定种子完全确定', () => {
    expect(createGame(2026)).toEqual(createGame(2026))
    expect(createGame(0)).toEqual(createGame(0))
  })

  it('不同种子的随机状态不同', () => {
    expect(createGame(1).rngState).not.toBe(createGame(2).rngState)
  })

  it('种子 0 与后端一致地映射为种子 1', () => {
    expect(createGame(0)).toEqual(createGame(1))
  })

  it('种子 42 的初始棋盘与 RNG 状态是固定金标准（与后端 mulberry32 序列一致）', () => {
    const snapshot = createGame(42)
    expect(snapshot.state.board).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 2, 0, 0],
      [0, 2, 0, 0],
    ])
    expect(snapshot.rngState).toBe(3031295998)
  })

  it('生成的随机种子是 32 位无符号整数', () => {
    for (let i = 0; i < 20; i += 1) {
      const seed = randomSeed()
      expect(Number.isInteger(seed)).toBe(true)
      expect(seed).toBeGreaterThanOrEqual(0)
      expect(seed).toBeLessThan(2 ** 32)
    }
  })

  it('快照可 JSON 序列化，恢复后继续对局结果一致', () => {
    const original = createGame(555)
    const restored = JSON.parse(JSON.stringify(original)) as Game2048Snapshot

    for (const direction of ['left', 'up', 'right', 'down'] as Game2048Direction[]) {
      expect(moveGame(restored, direction)).toEqual(moveGame(original, direction))
    }
  })

  it('初始两个方块价值大约 90% 为 2、10% 为 4', () => {
    let total = 0
    let fours = 0
    for (let seed = 1; seed <= 500; seed += 1) {
      for (const value of createGame(seed).state.board.flat()) {
        if (value === 0) continue
        total += 1
        if (value === 4) fours += 1
      }
    }
    expect(total).toBe(500 * INITIAL_TILES)
    // 1000 个方块的期望约为 100 个 4，给足容差但能拦住 50/50 之类的错误实现
    expect(fours).toBeGreaterThan(40)
    expect(fours).toBeLessThan(180)
  })
})

describe('createBoard', () => {
  it('接受合法 4x4 棋盘并返回副本（不共享引用）', () => {
    const rows = [
      [2, 0, 0, 0],
      [0, 4, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]
    const board = createBoard(rows)

    expect(board).toEqual(rows)
    board[0][0] = 128
    expect(rows[0][0]).toBe(2)
  })

  it('行数或列数不是 4 时抛错', () => {
    expect(() => createBoard([])).toThrow(Error)
    expect(() => createBoard([[0, 0, 0, 0]])).toThrow(Error)
    expect(() => createBoard([EMPTY_ROW, EMPTY_ROW, EMPTY_ROW])).toThrow(Error)
    expect(() => createBoard([EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, EMPTY_ROW])).toThrow(Error)
    expect(() => createBoard([[0, 0, 0], EMPTY_ROW, EMPTY_ROW, EMPTY_ROW])).toThrow(Error)
    expect(() => createBoard([[0, 0, 0, 0, 0], EMPTY_ROW, EMPTY_ROW, EMPTY_ROW])).toThrow(Error)
    expect(() =>
      createBoard([[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], null as unknown as number[]]),
    ).toThrow(Error)
    expect(() => createBoard(null as unknown as number[][])).toThrow(Error)
  })

  it('方块值不是非负整数时抛错', () => {
    expect(() => createBoard([[2, 0, 0, -2], EMPTY_ROW, EMPTY_ROW, EMPTY_ROW])).toThrow(Error)
    expect(() => createBoard([[2, 0, 0, 1.5], EMPTY_ROW, EMPTY_ROW, EMPTY_ROW])).toThrow(Error)
    expect(() =>
      createBoard([[2, 0, 0, Number.NaN], EMPTY_ROW, EMPTY_ROW, EMPTY_ROW]),
    ).toThrow(Error)
  })
})

describe('maxTile / hasMoves', () => {
  it('maxTile 返回棋盘最大值，空棋盘为 0', () => {
    expect(maxTile([EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, EMPTY_ROW])).toBe(0)
    expect(
      maxTile([
        [2, 8, 4, 2],
        [4, 2, 16, 4],
        [2, 4, 8, 2],
        [4, 2, 4, 8],
      ]),
    ).toBe(16)
  })

  it('hasMoves：有空格即可移动', () => {
    expect(hasMoves([EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, EMPTY_ROW])).toBe(true)
    expect(
      hasMoves([
        [2, 4, 2, 4],
        [4, 2, 4, 2],
        [2, 4, 2, 4],
        [4, 2, 4, 0],
      ]),
    ).toBe(true)
  })

  it('hasMoves：满盘无相邻相等则不可移动', () => {
    expect(hasMoves(blockedBoard())).toBe(false)
  })

  it('hasMoves：满盘存在横向可合并对', () => {
    const board = blockedBoard()
    board[0] = [2, 2, 4, 8]
    expect(hasMoves(board)).toBe(true)
  })

  it('hasMoves：满盘存在纵向可合并对', () => {
    const board = blockedBoard()
    board[0] = [2, 4, 8, 16]
    board[1] = [2, 8, 16, 32]
    expect(hasMoves(board)).toBe(true)
  })
})

describe('moveGame：四方向移动与合并', () => {
  it('向左：[2,2,2,2] → [4,4,0,0]，得分 8', () => {
    const start = snapshotOf([[2, 2, 2, 2], EMPTY_ROW, EMPTY_ROW, EMPTY_ROW])
    const { snapshot, moved } = moveGame(start, 'left')

    expect(moved).toBe(true)
    expect(snapshot.state.board[0].slice(0, 2)).toEqual([4, 4])
    expect(snapshot.state.score).toBe(8)
    expect(snapshot.state.moves).toBe(1)
    expect(snapshot.state.maxTile).toBe(4)
    expect(snapshot.state.status).toBe('playing')
    // 4 个方块合并成 2 个，再生成 1 个新方块
    expect(countTiles(snapshot.state.board)).toBe(3)
  })

  it('向右：[2,2,2,2] → [0,0,4,4]，得分 8', () => {
    const start = snapshotOf([[2, 2, 2, 2], EMPTY_ROW, EMPTY_ROW, EMPTY_ROW])
    const { snapshot, moved } = moveGame(start, 'right')

    expect(moved).toBe(true)
    expect(snapshot.state.board[0].slice(2)).toEqual([4, 4])
    expect(snapshot.state.score).toBe(8)
  })

  it('向上：纵向 [2,2,2,2] → [4,4,0,0]，得分 8', () => {
    const start = snapshotOf([
      [2, 0, 0, 0],
      [2, 0, 0, 0],
      [2, 0, 0, 0],
      [2, 0, 0, 0],
    ])
    const { snapshot, moved } = moveGame(start, 'up')

    expect(moved).toBe(true)
    expect(snapshot.state.board[0][0]).toBe(4)
    expect(snapshot.state.board[1][0]).toBe(4)
    expect(snapshot.state.score).toBe(8)
  })

  it('向下：纵向 [2,2,2,2] → [0,0,4,4]，得分 8', () => {
    const start = snapshotOf([
      [2, 0, 0, 0],
      [2, 0, 0, 0],
      [2, 0, 0, 0],
      [2, 0, 0, 0],
    ])
    const { snapshot, moved } = moveGame(start, 'down')

    expect(moved).toBe(true)
    expect(snapshot.state.board[3][0]).toBe(4)
    expect(snapshot.state.board[2][0]).toBe(4)
    expect(snapshot.state.score).toBe(8)
  })

  it('每个方块一回合只合并一次：[4,4,8,0] 左移 → [8,8,0,0]，新 8 不再与旧 8 合并', () => {
    const start = snapshotOf([[4, 4, 8, 0], EMPTY_ROW, EMPTY_ROW, EMPTY_ROW])
    const { snapshot, moved } = moveGame(start, 'left')

    expect(moved).toBe(true)
    expect(snapshot.state.board[0].slice(0, 2)).toEqual([8, 8])
    expect(snapshot.state.score).toBe(8)
    expect(snapshot.state.maxTile).toBe(8)
  })

  it('合并后的新方块不会继续参与合并：[2,2,4,4] 左移 → [4,8,0,0]，得分 12', () => {
    const start = snapshotOf([[2, 2, 4, 4], EMPTY_ROW, EMPTY_ROW, EMPTY_ROW])
    const { snapshot } = moveGame(start, 'left')

    expect(snapshot.state.board[0].slice(0, 2)).toEqual([4, 8])
    expect(snapshot.state.score).toBe(12)
  })

  it('三连与四连的合并顺序符合 2048 规则', () => {
    const three = moveGame(snapshotOf([[2, 2, 2, 0], EMPTY_ROW, EMPTY_ROW, EMPTY_ROW]), 'left')
    expect(three.snapshot.state.board[0].slice(0, 2)).toEqual([4, 2])
    expect(three.snapshot.state.score).toBe(4)

    const four = moveGame(snapshotOf([[2, 2, 2, 2], EMPTY_ROW, EMPTY_ROW, EMPTY_ROW]), 'left')
    expect(four.snapshot.state.board[0].slice(0, 2)).toEqual([4, 4])
    expect(four.snapshot.state.score).toBe(8)
  })

  it('移动会压缩空格并累加得分与步数', () => {
    const start = snapshotOf([[0, 2, 0, 2], EMPTY_ROW, EMPTY_ROW, EMPTY_ROW], {
      score: 100,
      moves: 5,
    })
    const { snapshot, moved } = moveGame(start, 'left')

    expect(moved).toBe(true)
    expect(snapshot.state.board[0].slice(0, 1)).toEqual([4])
    expect(snapshot.state.score).toBe(104)
    expect(snapshot.state.moves).toBe(6)
  })

  it('纯压缩（无合并）也算移动：moved 为 true 且生成 1 个新方块', () => {
    const start = snapshotOf([[0, 2, 4, 8], EMPTY_ROW, EMPTY_ROW, EMPTY_ROW])
    expect(countTiles(start.state.board)).toBe(3)

    const { snapshot, moved } = moveGame(start, 'left')

    expect(moved).toBe(true)
    expect(snapshot.state.board[0].slice(0, 3)).toEqual([2, 4, 8])
    expect(countTiles(snapshot.state.board)).toBe(4)
    expect(snapshot.state.score).toBe(0)
    expect(snapshot.state.moves).toBe(1)
  })

  it('不会修改传入的快照', () => {
    const start = snapshotOf([[2, 2, 0, 0], EMPTY_ROW, EMPTY_ROW, EMPTY_ROW])
    const boardBefore = JSON.parse(JSON.stringify(start.state.board))
    const rngBefore = start.rngState

    moveGame(start, 'left')

    expect(start.state.board).toEqual(boardBefore)
    expect(start.rngState).toBe(rngBefore)
    expect(start.state.moves).toBe(0)
    expect(start.state.score).toBe(0)
  })

  it('四个方向无效移动都返回 moved=false，不生成方块、不改变状态', () => {
    const directions: Game2048Direction[] = ['up', 'down', 'left', 'right']

    for (const direction of directions) {
      const start = snapshotOf(blockedBoard())
      const result = moveGame(start, direction)

      expect(result.moved).toBe(false)
      // 引用不变，方便 UI / Context 直接复用旧状态
      expect(result.snapshot).toBe(start)
      expect(result.snapshot.state.board).toEqual(blockedBoard())
      expect(result.snapshot.state.moves).toBe(0)
      expect(result.snapshot.state.score).toBe(0)
      expect(result.snapshot.state.status).toBe('playing')
      expect(result.snapshot.rngState).toBe(start.rngState)
    }
  })
})

describe('moveGame：胜负判定', () => {
  it('合成 2048 时状态变为 won', () => {
    const start = snapshotOf([[1024, 1024, 0, 0], EMPTY_ROW, EMPTY_ROW, EMPTY_ROW])
    const { snapshot, moved } = moveGame(start, 'left')

    expect(moved).toBe(true)
    expect(snapshot.state.status).toBe('won')
    expect(snapshot.state.maxTile).toBe(TARGET_TILE)
    expect(snapshot.state.score).toBe(TARGET_TILE)
    expect(snapshot.state.board[0][0]).toBe(TARGET_TILE)
  })

  it('已经获胜后继续移动仍保持 won', () => {
    const wonState = snapshotOf([[2048, 0, 0, 0], EMPTY_ROW, EMPTY_ROW, EMPTY_ROW])
    // 手动标记为已获胜（例如从存档恢复）
    const wonSnapshot: Game2048Snapshot = {
      ...wonState,
      state: { ...wonState.state, status: 'won' },
    }
    const { snapshot, moved } = moveGame(wonSnapshot, 'down')

    expect(moved).toBe(true)
    expect(snapshot.state.status).toBe('won')
  })

  it('满盘且无相邻相同数字时状态变为 lost', () => {
    const start = snapshotOf([
      [0, 2, 4, 8],
      [16, 32, 64, 128],
      [32, 64, 128, 256],
      [64, 128, 256, 512],
    ])
    const { snapshot, moved } = moveGame(start, 'left')

    expect(moved).toBe(true)
    expect(snapshot.state.status).toBe('lost')
    expect(snapshot.state.maxTile).toBe(512)
    expect(snapshot.state.score).toBe(0)
    expect(countTiles(snapshot.state.board)).toBe(BOARD_SIZE * BOARD_SIZE)
    expect(hasMoves(snapshot.state.board)).toBe(false)
  })
})

describe('确定性', () => {
  it('固定种子 + 固定操作序列得到完全一致的轨迹', () => {
    const directions: Game2048Direction[] = ['left', 'up', 'right', 'down']

    const replay = (seed: number): Game2048Snapshot[] => {
      const trace: Game2048Snapshot[] = []
      let snapshot = createGame(seed)
      trace.push(snapshot)
      for (let i = 0; i < 80; i += 1) {
        const result = moveGame(snapshot, directions[i % directions.length])
        snapshot = result.snapshot
        trace.push(snapshot)
      }
      return trace
    }

    const first = replay(1234)
    const second = replay(1234)

    expect(first).toEqual(second)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    // 操作序列中确实发生过有效移动，否则上面的断言说明不了什么
    expect(first[first.length - 1].state.moves).toBeGreaterThan(0)
  })

  it('不同种子会得到不同的对局轨迹', () => {
    const run = (seed: number) => {
      let snapshot = createGame(seed)
      snapshot = moveGame(snapshot, 'left').snapshot
      snapshot = moveGame(snapshot, 'up').snapshot
      return snapshot
    }
    expect(run(1)).not.toEqual(run(2))
  })

  it('每步最多生成一个新方块且方块值只可能是 2 或 4', () => {
    let snapshot = createGame(99)
    for (let i = 0; i < 40; i += 1) {
      const before = countTiles(snapshot.state.board)
      const { snapshot: next, moved } = moveGame(snapshot, 'left')
      if (!moved) {
        snapshot = next
        continue
      }
      // 合并会减少方块，因此只用「变更后数量 <= 变更前 + 1」判断没有一次生成多个
      expect(countTiles(next.state.board)).toBeLessThanOrEqual(before + 1)
      for (const value of next.state.board.flat()) {
        expect([0, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048]).toContain(value)
      }
      snapshot = next
    }
  })
})

describe('catalog：游戏大厅目录', () => {
  it('包含 2048 / 斗地主 / 贪吃蛇 / 扫雷 / 跳一跳 / 我的世界 / 五子棋（占位可留空）', () => {
    expect(GAME_CATALOG.length).toBeGreaterThanOrEqual(5)
    expect(GAME_CATALOG.length).toBeLessThanOrEqual(9)

    const first = GAME_CATALOG[0]
    expect(first.id).toBe('2048')
    expect(first.name).toBe('2048')
    expect(first.status).toBe('available')
    expect(first.playable).toBe(true)
    expect(first.modes).toEqual(['single', 'online'])
    expect(first.route).toBe(GAME_2048_ROUTE)
    expect(first.onlineRoute).toBe(GAME_2048_ONLINE_ROUTE)
    expect(first.route).toBe('/games/2048')
    expect(first.onlineRoute).toBe('/games/2048/online')

    const placeholders = GAME_CATALOG.filter((game) => game.status === 'coming-soon')
    expect(placeholders.length).toBeGreaterThanOrEqual(0)
    expect(placeholders.length).toBeLessThanOrEqual(3)
    for (const game of placeholders) {
      expect(game.status).toBe('coming-soon')
      expect(game.playable).toBe(false)
      expect(game.route).toBeNull()
      expect(game.onlineRoute).toBeNull()
      expect(game.name.length).toBeGreaterThan(0)
      expect(game.description.length).toBeGreaterThan(0)
      expect(game.modes.length).toBeGreaterThan(0)
    }
  })

  it('目录 id 唯一且 status 与 playable 一致', () => {
    const ids = GAME_CATALOG.map((game) => game.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const game of GAME_CATALOG) {
      expect(game.playable).toBe(game.status === 'available')
    }
  })

  it('PLAYABLE_GAMES / COMING_SOON_GAMES 与 status 划分一致', () => {
    expect(PLAYABLE_GAMES.map((game) => game.id)).toEqual([
      '2048',
      'doudizhu',
      'snake',
      'minesweeper',
      'jump',
      'minecraft',
      'gomoku',
    ])
    expect(COMING_SOON_GAMES.every((game) => game.status === 'coming-soon')).toBe(true)
    expect(PLAYABLE_GAMES.length + COMING_SOON_GAMES.length).toBe(GAME_CATALOG.length)
  })

  it('按 id 查找与可玩判断', () => {
    expect(getGameCatalogEntry('2048')?.name).toBe('2048')
    expect(getGameCatalogEntry('not-exist')).toBeUndefined()
    expect(isGamePlayable('2048')).toBe(true)
    expect(isGamePlayable('gomoku')).toBe(true)
    expect(isGamePlayable('not-exist')).toBe(false)
  })
})
