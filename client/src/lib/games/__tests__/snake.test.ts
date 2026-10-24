/**
 * 贪吃蛇纯函数引擎测试（单机 + 同屏双人）
 *
 * 覆盖：初始局面、180° 反向被拒、吃果加分与变长、金果、提速、
 * 撞墙 / 撞自己死亡、同屏双死判平局、撞对方蛇身判负、
 * 果实不重叠生成、mulberry32 确定性、localStorage 读写与容错。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SNAKE_BIG_SCORE,
  SNAKE_COLORS,
  SNAKE_GROW_BIG,
  SNAKE_NORMAL_SCORE,
  SNAKE_MIN_STEP_MS,
  SNAKE_SPEED_LEVELS,
  SNAKE_SOLO_SIZE,
  SNAKE_VERSUS_SIZE,
  createSoloSnakeState,
  createVersusSnakeState,
  loadSnakeBest,
  loadVersusRecord,
  mulberry32,
  samePoint,
  saveSnakeBest,
  saveVersusResult,
  setSoloBaseSpeed,
  setSoloDirection,
  setVersusDirection,
  snakeColorForSeat,
  snakeKey,
  stepSoloSnake,
  stepVersusSnake,
  type SoloSnakeState,
  type SnakeDirection,
  type VersusSnakeState,
} from '../snake'

const ALL_DIRECTIONS: SnakeDirection[] = ['up', 'down', 'left', 'right']

const DELTA: Record<SnakeDirection, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

/** 在蛇头正前方放一颗果（保证吃果用例可预测） */
function putFoodAhead(state: SoloSnakeState, big = false): SoloSnakeState {
  const head = state.snake[0]
  const delta = DELTA[state.direction]
  state.foods = [{ x: head.x + delta.x, y: head.y + delta.y, big }]
  return state
}

describe('常量与几何 helper', () => {
  it('单机 20×20、同屏 24×24、8 个座位配色、三档速度', () => {
    expect(SNAKE_SOLO_SIZE).toBe(20)
    expect(SNAKE_VERSUS_SIZE).toBe(24)
    expect(SNAKE_COLORS).toHaveLength(8)
    expect(SNAKE_SPEED_LEVELS).toEqual({ 慢: 220, 中: 150, 快: 100 })
    expect(snakeColorForSeat(0)).toBe(SNAKE_COLORS[0])
    // 座位号越界取模，负数也回到合法色
    expect(snakeColorForSeat(9)).toBe(SNAKE_COLORS[1])
    expect(snakeColorForSeat(-1)).toBe(SNAKE_COLORS[7])
  })

  it('snakeKey / samePoint 表示同一格', () => {
    expect(snakeKey({ x: 3, y: 7 })).toBe('3,7')
    expect(samePoint({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true)
    expect(samePoint({ x: 1, y: 2 }, { x: 2, y: 1 })).toBe(false)
  })
})

describe('createSoloSnakeState', () => {
  it('初始 3 节蛇身、朝右、活着、0 分，且果实不在蛇身上', () => {
    const state = createSoloSnakeState({ seed: 2026 })
    expect(state.size).toBe(SNAKE_SOLO_SIZE)
    expect(state.snake).toHaveLength(3)
    expect(state.direction).toBe('right')
    expect(state.alive).toBe(true)
    expect(state.score).toBe(0)
    expect(state.foods.length).toBeGreaterThan(0)
    for (const food of state.foods) {
      expect(state.snake.some((cell) => samePoint(cell, food))).toBe(false)
      expect(food.x).toBeGreaterThanOrEqual(0)
      expect(food.y).toBeGreaterThanOrEqual(0)
    }
  })

  it('同一种子完全确定，不同种子 RNG 状态不同', () => {
    expect(createSoloSnakeState({ seed: 42 })).toEqual(createSoloSnakeState({ seed: 42 }))
    expect(createSoloSnakeState({ seed: 1 }).rngState).not.toBe(
      createSoloSnakeState({ seed: 2 }).rngState
    )
  })

  it('速度档位写入基准步长', () => {
    expect(createSoloSnakeState({ speedMs: SNAKE_SPEED_LEVELS['快'], seed: 7 }).baseStepMs).toBe(100)
  })
})

describe('setSoloDirection', () => {
  it('禁止 180° 掉头与重复方向，允许垂直方向', () => {
    const state = createSoloSnakeState({ seed: 5 })
    expect(state.direction).toBe('right')
    expect(setSoloDirection(state, 'left')).toBe(false)
    expect(setSoloDirection(state, 'right')).toBe(false)
    expect(state.pendingDirection).toBeNull()
    expect(setSoloDirection(state, 'up')).toBe(true)
    expect(state.pendingDirection).toBe('up')
    // 已排队方向同样不允许反向（防止一步内连按两次掉头自杀）
    expect(setSoloDirection(state, 'down')).toBe(false)
    expect(state.pendingDirection).toBe('up')
  })

  it('死亡后不再接受任何方向', () => {
    const state = createSoloSnakeState({ seed: 6 })
    state.alive = false
    expect(setSoloDirection(state, 'up')).toBe(false)
  })
})

describe('stepSoloSnake：吃果与得分', () => {
  it('吃普通果 +10 分、蛇长净增 1 节', () => {
    const state = putFoodAhead(createSoloSnakeState({ seed: 11 }))
    const expectedLength = state.snake.length + 1
    const headBefore = { ...state.snake[0] }

    const result = stepSoloSnake(state)

    expect(result.ate).toBe(true)
    expect(result.big).toBe(false)
    expect(result.dead).toBe(false)
    expect(state.score).toBe(SNAKE_NORMAL_SCORE)
    expect(state.eaten).toBe(1)
    expect(state.snake).toHaveLength(expectedLength)
    expect(samePoint(state.snake[0], { x: headBefore.x + 1, y: headBefore.y })).toBe(true)

    // 下一步正常缩尾，长度保持在新值
    stepSoloSnake(state)
    expect(state.snake).toHaveLength(expectedLength)
  })

  it('吃金果 +30 分、蛇长在 3 步内净增 3 节', () => {
    const state = putFoodAhead(createSoloSnakeState({ seed: 12 }), true)
    const lengthBefore = state.snake.length

    const result = stepSoloSnake(state)

    expect(result.ate).toBe(true)
    expect(result.big).toBe(true)
    expect(state.score).toBe(SNAKE_BIG_SCORE)
    expect(state.pendingGrowth).toBe(SNAKE_GROW_BIG - 1)
    expect(state.snake).toHaveLength(lengthBefore + 1)
    stepSoloSnake(state)
    stepSoloSnake(state)
    expect(state.pendingGrowth).toBe(0)
    expect(state.snake).toHaveLength(lengthBefore + 3)
  })

  it('步进过程中始终只有一颗普通果、且果实不落在蛇身或已有果实上', () => {
    let state = createSoloSnakeState({ seed: 13 })
    for (let i = 0; i < 60; i += 1) {
      // 简单避墙策略：朝墙时换一个方向
      const head = state.snake[0]
      if (head.x === 0) setSoloDirection(state, 'right')
      else if (head.x === state.size - 1) setSoloDirection(state, 'left')
      else if (head.y === 0) setSoloDirection(state, 'down')
      else if (head.y === state.size - 1) setSoloDirection(state, 'up')

      const before = state.snake.length
      const result = stepSoloSnake(state)
      if (!state.alive) {
        state = createSoloSnakeState({ seed: 1000 + i })
        continue
      }
      // 金果当步只兑现 1 节，余下 2 节在后续两步补齐；不吃果且不生长时长度不变
      if (result.ate) expect(state.snake.length).toBe(before + 1)
      else if (state.pendingGrowth === 0) expect(state.snake.length).toBe(before)

      const normals = state.foods.filter((food) => !food.big)
      expect(normals.length).toBe(1)
      const keys = new Set<string>()
      for (const food of state.foods) {
        expect(keys.has(snakeKey(food))).toBe(false)
        keys.add(snakeKey(food))
        expect(state.snake.some((cell) => samePoint(cell, food))).toBe(false)
      }
    }
  })

  it('每吃 5 个果提速 5%，且不低于最小步长', () => {
    const state = createSoloSnakeState({ speedMs: 200, seed: 14 })
    expect(state.stepMs).toBe(200)

    state.eaten = 5
    setSoloBaseSpeed(state, 200)
    expect(state.stepMs).toBe(Math.round(200 * 0.95))

    state.eaten = 10
    setSoloBaseSpeed(state, 200)
    expect(state.stepMs).toBe(Math.round(200 * 0.95 ** 2))

    state.eaten = 200
    setSoloBaseSpeed(state, 220)
    expect(state.stepMs).toBeGreaterThanOrEqual(SNAKE_MIN_STEP_MS)
  })
})

describe('stepSoloSnake：死亡判定', () => {
  it('撞墙死亡并拒绝后续输入', () => {
    const state = createSoloSnakeState({ seed: 21 })
    state.snake = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]
    state.direction = 'up'
    state.foods = [{ x: 10, y: 10, big: false }]

    expect(stepSoloSnake(state).dead).toBe(true)
    expect(state.alive).toBe(false)
    expect(stepSoloSnake(state).dead).toBe(true)
    expect(setSoloDirection(state, 'down')).toBe(false)
  })

  it('撞自己身体死亡', () => {
    const state = createSoloSnakeState({ seed: 22 })
    state.snake = [
      { x: 5, y: 5 },
      { x: 5, y: 6 },
      { x: 6, y: 6 },
      { x: 6, y: 5 },
      { x: 7, y: 5 },
    ]
    state.direction = 'right'
    state.foods = [{ x: 0, y: 0, big: false }]
    expect(stepSoloSnake(state).dead).toBe(true)
  })

  it('目标格是即将腾出的尾巴格 → 不算死亡', () => {
    const state = createSoloSnakeState({ seed: 23 })
    state.snake = [
      { x: 5, y: 5 },
      { x: 5, y: 6 },
      { x: 6, y: 6 },
      { x: 6, y: 5 },
    ]
    state.direction = 'right'
    state.foods = [{ x: 0, y: 0, big: false }]
    expect(stepSoloSnake(state).dead).toBe(false)
  })
})

describe('同屏双人', () => {
  it('P1 左侧朝右、P2 右侧朝左，双方各自出生', () => {
    const state = createVersusSnakeState({ seed: 31 })
    expect(state.size).toBe(SNAKE_VERSUS_SIZE)
    expect(state.directions).toEqual(['right', 'left'])
    expect(state.snakes[0][0].x).toBeLessThan(Math.floor(state.size / 2))
    expect(state.snakes[1][0].x).toBeGreaterThan(Math.floor(state.size / 2))
    expect(state.alive).toEqual([true, true])
    expect(state.foods.length).toBeGreaterThan(0)
  })

  it('P1 不能直接朝左、P2 不能直接朝右（180° 掉头被拒）', () => {
    const state = createVersusSnakeState({ seed: 32 })
    expect(setVersusDirection(state, 0, 'left')).toBe(false)
    expect(setVersusDirection(state, 1, 'right')).toBe(false)
    expect(setVersusDirection(state, 0, 'up')).toBe(true)
    expect(setVersusDirection(state, 1, 'up')).toBe(true)
    expect(state.pendingDirections).toEqual(['up', 'up'])
  })

  it('双方同时撞墙 → 判平局（winner 为 null）', () => {
    const state = createVersusSnakeState({ seed: 33 })
    state.snakes = [
      [
        { x: state.size - 1, y: 3 },
        { x: state.size - 2, y: 3 },
        { x: state.size - 3, y: 3 },
      ],
      [
        { x: 0, y: 9 },
        { x: 1, y: 9 },
        { x: 2, y: 9 },
      ],
    ]
    state.directions = ['right', 'left']

    const result = stepVersusSnake(state)
    expect(result.dead).toEqual([true, true])
    expect(result.winner).toBeNull()
    expect(state.finished).toBe(true)
    // 结算后继续步进不改变结论
    expect(stepVersusSnake(state).dead).toEqual([true, true])
  })

  it('双头对撞同格 → 双方同死判平局', () => {
    const state = createVersusSnakeState({ seed: 34 })
    state.snakes = [
      [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 3, y: 5 },
      ],
      [
        { x: 7, y: 5 },
        { x: 8, y: 5 },
        { x: 9, y: 5 },
      ],
    ]
    state.directions = ['right', 'left']

    const result = stepVersusSnake(state)
    expect(result.dead).toEqual([true, true])
    expect(result.winner).toBeNull()
  })

  it('P1 撞对方蛇身 → P2 胜', () => {
    const state = createVersusSnakeState({ seed: 35 })
    // P2 竖着排在第 6 列，(6,5) 是它身体的中段；P1 朝右正好撞上
    state.snakes = [
      [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 3, y: 5 },
      ],
      [
        { x: 6, y: 7 },
        { x: 6, y: 6 },
        { x: 6, y: 5 },
        { x: 6, y: 4 },
      ],
    ]
    state.directions = ['right', 'down']
    state.foods = [{ x: 0, y: 0, big: false }]

    const result = stepVersusSnake(state)
    expect(result.dead).toEqual([true, false])
    expect(result.winner).toBe(1)
    expect(state.finished).toBe(true)
    expect(state.alive).toEqual([false, true])
  })

  it('撞上对方即将腾出的尾巴格不算死亡', () => {
    const state = createVersusSnakeState({ seed: 38 })
    state.snakes = [
      [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 3, y: 5 },
      ],
      [
        { x: 7, y: 5 },
        { x: 6, y: 5 },
      ],
    ]
    state.directions = ['right', 'right']
    state.foods = [{ x: 0, y: 0, big: false }]

    const result = stepVersusSnake(state)
    expect(result.dead).toEqual([false, false])
    expect(result.winner).toBeNull()
  })

  it('吃果加分与变长，果实补足到 2 颗且不与蛇身重叠', () => {
    const state = createVersusSnakeState({ seed: 36 })
    const head = state.snakes[0][0]
    const lengthBefore = state.snakes[0].length
    state.foods = [{ x: head.x + 1, y: head.y, big: false }]

    stepVersusSnake(state)

    expect(state.scores[0]).toBe(SNAKE_NORMAL_SCORE)
    expect(state.scores[1]).toBe(0)
    expect(state.snakes[0]).toHaveLength(lengthBefore + 1)
    expect(state.foods).toHaveLength(2)
    for (const food of state.foods) {
      for (const snake of state.snakes) {
        expect(snake.some((cell) => samePoint(cell, food))).toBe(false)
      }
    }
  })

  it('固定种子 + 固定操作序列得到完全一致的轨迹', () => {
    const replay = (seed: number): VersusSnakeState => {
      const state = createVersusSnakeState({ seed })
      for (let i = 0; i < 25 && !state.finished; i += 1) {
        for (const seat of [0, 1] as const) {
          for (const direction of ALL_DIRECTIONS) {
            if (setVersusDirection(state, seat, direction)) break
          }
        }
        stepVersusSnake(state)
      }
      return state
    }

    expect(JSON.stringify(replay(88))).toBe(JSON.stringify(replay(88)))
  })
})

describe('mulberry32 确定性', () => {
  it('同种子序列一致，取值落在 [0,1)', () => {
    const a = mulberry32(2026)
    const b = mulberry32(2026)
    const values: number[] = []
    for (let i = 0; i < 20; i += 1) {
      const value = a()
      expect(value).toBe(b())
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
      values.push(value)
    }
    expect(new Set(values).size).toBeGreaterThan(15)
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })
})

describe('本机记录（localStorage）', () => {
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

  it('最高分只升不降', () => {
    const store = installFakeStorage()
    expect(loadSnakeBest()).toBe(0)
    expect(saveSnakeBest(120)).toBe(120)
    expect(store['lineweb.snake.best']).toBe('120')
    expect(saveSnakeBest(80)).toBe(120)
    expect(saveSnakeBest(300)).toBe(300)
    expect(loadSnakeBest()).toBe(300)
    expect(store['lineweb.snake.best']).toBe('300')
  })

  it('脏数据按 0 处理', () => {
    installFakeStorage({ 'lineweb.snake.best': 'not-a-number' })
    expect(loadSnakeBest()).toBe(0)
    installFakeStorage({ 'lineweb.snake.best': '-50' })
    expect(loadSnakeBest()).toBe(0)
    installFakeStorage({ 'lineweb.snake.versus': '{坏掉的 JSON' })
    expect(loadVersusRecord()).toEqual({ p1: 0, p2: 0, draws: 0 })
  })

  it('同屏战绩累计 P1 / P2 / 平局', () => {
    const store = installFakeStorage()
    expect(loadVersusRecord()).toEqual({ p1: 0, p2: 0, draws: 0 })
    expect(saveVersusResult(0)).toEqual({ p1: 1, p2: 0, draws: 0 })
    expect(saveVersusResult(1)).toEqual({ p1: 1, p2: 1, draws: 0 })
    expect(saveVersusResult(null)).toEqual({ p1: 1, p2: 1, draws: 1 })
    expect(loadVersusRecord()).toEqual({ p1: 1, p2: 1, draws: 1 })
    expect(JSON.parse(String(store['lineweb.snake.versus']))).toEqual({ p1: 1, p2: 1, draws: 1 })
  })

  it('localStorage 抛异常或不可用时不抛出', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => {
          throw new Error('SecurityError')
        },
        setItem: () => {
          throw new Error('QuotaExceededError')
        },
      },
      configurable: true,
      writable: true,
    })
    expect(loadSnakeBest()).toBe(0)
    expect(() => saveSnakeBest(50)).not.toThrow()
    expect(loadVersusRecord()).toEqual({ p1: 0, p2: 0, draws: 0 })
    // 写入失败但内存累加仍然可用
    expect(saveVersusResult(0)).toEqual({ p1: 1, p2: 0, draws: 0 })

    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      configurable: true,
      writable: true,
    })
    expect(loadSnakeBest()).toBe(0)
    expect(() => saveSnakeBest(10)).not.toThrow()
  })

  it('恢复真实存储后读取仍安全', () => {
    installFakeStorage({ 'lineweb.snake.best': '77' })
    expect(loadSnakeBest()).toBe(77)
    restoreStorage()
    expect(() => loadSnakeBest()).not.toThrow()
  })
})
