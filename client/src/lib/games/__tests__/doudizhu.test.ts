/**
 * 斗地主纯函数引擎 + AI 测试
 *
 * 覆盖：牌堆构成与发牌确定性、全牌型解析与识别非法组合、
 * 牌型比较（炸弹 / 王炸 / 同型比大小）、候选出牌生成、手数评估、
 * AI 自对弈完整性（随机种子下整局必然打完且每步合法）、
 * 双端引擎源码对齐（服务端是权威判定，两边漂移会让本测试失败），
 * 以及游戏大厅目录的斗地主条目。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DoudizhuCard, DoudizhuCombo } from '../doudizhu'
import {
  canDoudizhuBeat,
  countDoudizhuHands,
  createDoudizhuDeck,
  dealDoudizhu,
  generateDoudizhuMoves,
  parseDoudizhuCombo,
  shuffleDoudizhuDeck,
  DOUDIZHU_RANK_2,
  DOUDIZHU_RANK_A,
  DOUDIZHU_RANK_JOKER_S,
  DOUDIZHU_RANK_JOKER_B,
} from '../doudizhu'
import { aiDoudizhuBid, aiDoudizhuPlay, doudizhuHandStrength } from '../doudizhuAi'
import { GAME_CATALOG, getGameCatalogEntry, isGamePlayable } from '../catalog'

/** 构造测试牌（id 仅需唯一；rank 参与规则判定） */
function card(rank: number, idx = 0, suit = 0): DoudizhuCard {
  return { id: rank * 10 + idx, rank, suit }
}

/** 按点数列表造牌：每个点数一张 */
function cardsOf(...ranks: number[]): DoudizhuCard[] {
  return ranks.map((rank, index) => card(rank, index))
}

/** 同一点数 n 张 */
function ofRank(rank: number, n: number): DoudizhuCard[] {
  return Array.from({ length: n }, (_, index) => card(rank, index))
}

/** 断言解析出的牌型（非法时 parse 返回 null，断言直接失败） */
function expectCombo(cards: DoudizhuCard[], type: DoudizhuCombo['type'], rank?: number): DoudizhuCombo {
  const parsed = parseDoudizhuCombo(cards)
  expect(parsed).not.toBeNull()
  expect(parsed?.type).toBe(type)
  if (rank !== undefined) expect(parsed?.rank).toBe(rank)
  return parsed as DoudizhuCombo
}

/** 简易可复现随机数（mulberry32，与服务端 2048 引擎同族） */
function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// === 牌堆与发牌 ===

describe('斗地主牌堆与发牌', () => {
  it('牌堆 54 张、id 唯一、点数构成正确', () => {
    const deck = createDoudizhuDeck()
    expect(deck).toHaveLength(54)
    expect(new Set(deck.map((c) => c.id)).size).toBe(54)

    const byRank = new Map<number, number>()
    for (const c of deck) byRank.set(c.rank, (byRank.get(c.rank) ?? 0) + 1)
    for (let rank = 3; rank <= DOUDIZHU_RANK_A; rank += 1) {
      expect(byRank.get(rank)).toBe(4)
    }
    expect(byRank.get(DOUDIZHU_RANK_2)).toBe(4)
    expect(byRank.get(DOUDIZHU_RANK_JOKER_S)).toBe(1)
    expect(byRank.get(DOUDIZHU_RANK_JOKER_B)).toBe(1)
  })

  it('洗牌不改牌集合；同一随机序列洗牌结果确定', () => {
    const deck = createDoudizhuDeck()
    const a = shuffleDoudizhuDeck(deck, seededRandom(42))
    const b = shuffleDoudizhuDeck(deck, seededRandom(42))
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id))
    expect(new Set(a.map((c) => c.id)).size).toBe(54)
  })

  it('发牌 17/17/17 + 3 张底牌，全部不重复；同一种子可复现', () => {
    const first = dealDoudizhu(seededRandom(7))
    const second = dealDoudizhu(seededRandom(7))
    expect(first.hands.map((hand) => hand.length)).toEqual([17, 17, 17])
    expect(first.bottom).toHaveLength(3)

    const all = [...first.hands.flat(), ...first.bottom]
    expect(new Set(all.map((c) => c.id)).size).toBe(54)
    expect(first.hands[0].map((c) => c.id)).toEqual(second.hands[0].map((c) => c.id))
    expect(first.bottom.map((c) => c.id)).toEqual(second.bottom.map((c) => c.id))
  })
})

// === 牌型解析 ===

describe('斗地主牌型解析', () => {
  it('基础牌型：单张 / 对子 / 三张 / 炸弹 / 王炸', () => {
    expectCombo(cardsOf(3), 'single', 3)
    expectCombo(ofRank(7, 2), 'pair', 7)
    expectCombo(ofRank(9, 3), 'trio', 9)
    expectCombo(ofRank(13, 4), 'bomb', 13)
    expectCombo([card(DOUDIZHU_RANK_JOKER_S), card(DOUDIZHU_RANK_JOKER_B)], 'rocket', DOUDIZHU_RANK_JOKER_B)
  })

  it('三带一 / 三带二', () => {
    expectCombo([...ofRank(5, 3), card(3)], 'trio1', 5)
    expectCombo([...ofRank(5, 3), ...ofRank(4, 2)], 'trio2', 5)
  })

  it('顺子 / 连对 / 飞机 / 飞机带翅膀 / 四带二', () => {
    expectCombo(cardsOf(3, 4, 5, 6, 7), 'straight', 7)
    expectCombo(cardsOf(10, 11, 12, 13, 14), 'straight', 14)
    expectCombo([...ofRank(3, 2), ...ofRank(4, 2), ...ofRank(5, 2)], 'pairStraight', 5)
    expectCombo([...ofRank(3, 3), ...ofRank(4, 3)], 'plane', 4)
    expectCombo([...ofRank(3, 3), ...ofRank(4, 3), card(7), card(8)], 'plane1', 4)
    expectCombo([...ofRank(3, 3), ...ofRank(4, 3), ...ofRank(7, 2), ...ofRank(8, 2)], 'plane2', 4)
    // 333444555666 优先解析为纯飞机（4 连三）
    expectCombo([...ofRank(3, 3), ...ofRank(4, 3), ...ofRank(5, 3), ...ofRank(6, 3)], 'plane', 6)
    expectCombo([...ofRank(3, 4), card(9), card(10)], 'four1', 3)
    expectCombo([...ofRank(3, 4), ...ofRank(9, 2)], 'four1', 3) // 一对拆两张单
    expectCombo([...ofRank(3, 4), ...ofRank(9, 2), ...ofRank(10, 2)], 'four2', 3)
  })

  it('非法组合返回 null', () => {
    expect(parseDoudizhuCombo([])).toBeNull()
    expect(parseDoudizhuCombo(cardsOf(3, 4))).toBeNull() // 两张不同
    expect(parseDoudizhuCombo(cardsOf(3, 4, 5, 6))).toBeNull() // 顺子不足 5 张
    expect(parseDoudizhuCombo(cardsOf(3, 4, 5, 6, DOUDIZHU_RANK_2))).toBeNull() // 2 不入顺
    expect(parseDoudizhuCombo(cardsOf(3, 4, 5, 6, 14, DOUDIZHU_RANK_JOKER_S))).toBeNull() // 王不入顺
    expect(parseDoudizhuCombo([...ofRank(3, 2), ...ofRank(4, 2), card(5)])).toBeNull() // 连对混单张
    expect(parseDoudizhuCombo([...ofRank(3, 3), ...ofRank(5, 3)])).toBeNull() // 飞机不连续
    expect(parseDoudizhuCombo([...ofRank(3, 3), ...ofRank(4, 3), ...ofRank(18, 1), ...ofRank(19, 1)])).toBeNull() // 双王不做翅膀
    expect(parseDoudizhuCombo([...ofRank(3, 4), ...ofRank(4, 1), ...ofRank(5, 1)])).not.toBeNull() // 3333+4+5 恰为四带二单
    expect(parseDoudizhuCombo([...ofRank(3, 4), ...cardsOf(4, 5, 6)])).toBeNull() // 四带二超量（7 张）
  })

  function parseDoodizhuStraight(): DoudizhuCombo | null {
    return parseDoudizhuCombo(cardsOf(3, 4, 5, 6))
  }
})

// === 牌型比较 ===

describe('斗地主牌型比较', () => {
  const rocket = parseDoudizhuCombo([card(DOUDIZHU_RANK_JOKER_S), card(DOUDIZHU_RANK_JOKER_B)]) as DoudizhuCombo
  const bomb3 = parseDoudizhuCombo(ofRank(3, 4)) as DoudizhuCombo
  const bomb5 = parseDoudizhuCombo(ofRank(5, 4)) as DoudizhuCombo
  const pair7 = parseDoudizhuCombo(ofRank(7, 2)) as DoudizhuCombo
  const pair9 = parseDoudizhuCombo(ofRank(9, 2)) as DoudizhuCombo
  const trio7 = parseDoudizhuCombo(ofRank(7, 3)) as DoudizhuCombo
  const straightLow = parseDoudizhuCombo(cardsOf(3, 4, 5, 6, 7)) as DoudizhuCombo
  const straightHigh = parseDoudizhuCombo(cardsOf(5, 6, 7, 8, 9)) as DoudizhuCombo
  const straightLong = parseDoudizhuCombo(cardsOf(3, 4, 5, 6, 7, 8)) as DoudizhuCombo

  it('王炸压一切，一切压不了王炸', () => {
    expect(canDoudizhuBeat(rocket, bomb5)).toBe(true)
    expect(canDoudizhuBeat(rocket, pair9)).toBe(true)
    expect(canDoudizhuBeat(bomb5, rocket)).toBe(false)
  })

  it('炸弹压普通牌型；炸弹之间比点数', () => {
    expect(canDoudizhuBeat(bomb3, pair9)).toBe(true)
    expect(canDoudizhuBeat(pair9, bomb3)).toBe(false)
    expect(canDoudizhuBeat(bomb5, bomb3)).toBe(true)
    expect(canDoudizhuBeat(bomb3, bomb5)).toBe(false)
  })

  it('同型同长比主牌点数；不同型 / 不同长不可比', () => {
    expect(canDoudizhuBeat(pair9, pair7)).toBe(true)
    expect(canDoudizhuBeat(pair7, pair9)).toBe(false)
    expect(canDoudizhuBeat(trio7, pair7)).toBe(false)
    expect(canDoudizhuBeat(straightHigh, straightLow)).toBe(true)
    expect(canDoudizhuBeat(straightLong, straightLow)).toBe(false)
  })

  it('主动出牌（last=null）恒真', () => {
    expect(canDoudizhuBeat(pair7, null)).toBe(true)
  })

  function parseDoodizhuTrio(): DoudizhuCombo {
    return parseDoudizhuCombo(ofRank(7, 3)) as DoudizhuCombo
  }

  function parseDoodizhuStraight6(): DoudizhuCombo {
    return parseDoodizhuStraightFallback()
  }

  function parseDoodizhuStraightFallback(): DoudizhuCombo {
    return parseDoudizhuCombo(cardsOf(3, 4, 5, 6, 7, 8)) as DoudizhuCombo
  }
})

// === 候选生成 ===

describe('斗地主候选出牌生成', () => {
  it('主动出牌包含全部基础牌型；炸弹不拆', () => {
    const hand = [...ofRank(3, 4), ...ofRank(7, 2), card(14), card(DOUDIZHU_RANK_JOKER_B)]
    const moves = generateDoudizhuMoves(hand, null)
    const types = new Set(moves.map((move) => move.combo.type))
    expect(types.has('single')).toBe(true)
    expect(types.has('pair')).toBe(true)
    expect(types.has('bomb')).toBe(true)
    // 炸弹点数不拆做单张 / 对子
    expect(moves.some((m) => m.combo.type === 'single' && m.combo.rank === 3)).toBe(false)
    expect(moves.some((m) => m.combo.type === 'pair' && m.combo.rank === 3)).toBe(false)
  })

  it('跟单张只生成更大的单张 / 炸弹 / 王炸', () => {
    const hand = [card(3), card(14), card(DOUDIZHU_RANK_2), ...ofRank(5, 4)]
    const last = parseDoudizhuCombo([card(13)]) as DoudizhuCombo
    const moves = generateDoudizhuMoves(hand, last)
    expect(moves.length).toBeGreaterThan(0)
    for (const move of moves) {
      expect(canDoudizhuBeat(move.combo, last)).toBe(true)
    }
    const singles = moves.filter((m) => m.combo.type === 'single').map((m) => m.combo.rank)
    expect(singles).toEqual(expect.arrayContaining([14, DOUDIZHU_RANK_2]))
    expect(singles).not.toContain(3)
    expect(moves.some((m) => m.combo.type === 'bomb')).toBe(true)
  })

  it('跟对子没有更大对子时只能用炸弹', () => {
    const hand = [card(3), card(5), ...ofRank(9, 4)]
    const last = parseDoudizhuCombo(ofRank(13, 2)) as DoudizhuCombo
    const moves = generateDoudizhuMoves(hand, last)
    expect(moves.length).toBeGreaterThan(0)
    for (const move of moves) {
      expect(move.combo.type === 'bomb' || move.combo.type === 'rocket').toBe(true)
    }
  })

  it('压不住时返回空', () => {
    const hand = [card(3)]
    const last = parseDoudizhuCombo(ofRank(7, 2)) as DoudizhuCombo
    expect(generateDoudizhuMoves(hand, last)).toEqual([])
  })
})

// === 手数评估 ===

describe('斗地主手数评估', () => {
  it('常见形状的手数', () => {
    expect(countDoudizhuHands(cardsOf(3, 4, 5, 6, 7))).toBe(1) // 一手顺子
    expect(countDoudizhuHands(ofRank(3, 4))).toBe(1) // 炸弹
    expect(countDoudizhuHands([card(DOUDIZHU_RANK_JOKER_S), card(DOUDIZHU_RANK_JOKER_B)])).toBe(1) // 王炸
    expect(countDoudizhuHands(cardsOf(3, 4))).toBe(2) // 两张散单
  })

  function countDoudizhuRocket(): number {
    return countDoudizhuHands([card(DOUDIZHU_RANK_JOKER_S), card(DOUDIZHU_RANK_JOKER_B)])
  }
})

// === AI 自对弈（引擎 + AI 完整性） ===

describe('斗地主 AI 自对弈', () => {
  it('30 局随机种子对局全部正常打完且每步合法', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      expect(playAiGame(seed).finished).toBe(true)
    }
  })

  it('强牌叫 3 分、强度评估单调', () => {
    const strong = [
      card(DOUDIZHU_RANK_JOKER_S),
      card(DOUDIZHU_RANK_JOKER_B),
      ...ofRank(DOUDIZHU_RANK_2, 2),
      ...ofRank(10, 4),
      ...cardsOf(3, 4, 5, 6, 7, 8, 9, 14),
    ]
    expect(aiDoudizhuBid(strong, 0)).toBe(3)
    const weak = [...cardsOf(3, 4, 5, 6, 7, 8, 9, 10, 11, 12), ...ofRank(5, 2), ...ofRank(6, 2)]
    expect(doudizhuHandStrength(strong)).toBeGreaterThan(doudizhuHandStrength(weak))
  })

  /** 完整跑一局 AI 对 AI；返回是否正常结束（无死循环 / 非法步） */
  function playAiGame(seed: number): { finished: boolean } {
    const random = seededRandom(seed)
    let hands: DoudizhuCard[][] = [[], [], []]
    let landlordSeat = -1

    // 叫分（最多 5 轮，防止极端随机下反复流局）
    for (let round = 0; round < 5 && landlordSeat < 0; round += 1) {
      const deal = dealDoudizhu(random)
      hands = deal.hands
      let highest = 0
      let highestSeat = -1
      let acted = 0
      let seat = Math.floor(random() * 3)
      while (acted < 3) {
        const bid = aiDoudizhuBid(hands[seat], highest)
        if (bid === 3) {
          highest = 3
          highestSeat = seat
          break
        }
        if (bid > highest) {
          highest = bid
          highestSeat = seat
        }
        acted += 1
        seat = (seat + 1) % 3
      }
      if (highestSeat >= 0) {
        landlordSeat = highestSeat
        hands[landlordSeat] = [...hands[landlordSeat], ...deal.bottom]
      }
    }
    if (landlordSeat < 0) return { finished: false }

    const roles: Array<'landlord' | 'farmer'> = [0, 1, 2].map((seat) =>
      seat === landlordSeat ? 'landlord' : 'farmer'
    )

    let lastMove: { seat: number; combo: DoudizhuCombo } | null = null
    let passCount = 0
    let turnSeat = landlordSeat

    for (let step = 0; step < 600; step += 1) {
      if (hands[turnSeat].length === 0) {
        turnSeat = (turnSeat + 1) % 3
        continue
      }
      const landlordHand = hands[[0, 1, 2].find((s) => roles[s] === 'landlord') as number]
      const move = aiDoudizhuPlay({
        myRole: roles[turnSeat],
        hand: hands[turnSeat],
        lastCombo: lastMove?.combo ?? null,
        lastPlayedBy: lastMove
          ? roles[lastMove.seat] === roles[turnSeat] ? 'teammate' : 'landlord'
          : null,
        landlordCards: landlordHand.length,
        nextCards: hands[(turnSeat + 1) % 3].length,
      })

      if (move === null) {
        expect(lastMove).not.toBeNull() // 领出时不允许不出
        passCount += 1
        if (passCount >= 2 && lastMove) {
          turnSeat = lastMove.seat
          lastMove = null
          passCount = 0
          continue
        }
        turnSeat = (turnSeat + 1) % 3
        continue
      }

      // 每步出牌必须：来自手牌、不重复、能压住上一手
      const ids = new Set(move.cards.map((c) => c.id))
      expect(ids.size).toBe(move.cards.length)
      for (const c of move.cards) {
        expect(hands[turnSeat].some((h) => h.id === c.id)).toBe(true)
      }
      expect(canDoudizhuBeat(move.combo, lastMove?.combo ?? null)).toBe(true)

      hands[turnSeat] = hands[turnSeat].filter((c) => !ids.has(c.id))
      lastMove = { seat: turnSeat, combo: move.combo }
      passCount = 0

      if (hands[turnSeat].length === 0) {
        return { finished: true }
      }
      turnSeat = (turnSeat + 1) % 3
    }
    return { finished: false }
  }

})

// === 双端引擎对齐 ===

describe('斗地主双端引擎对齐', () => {
  it('服务端引擎与前端单机引擎源码一致（除头注释外）', () => {
    const clientFile = resolve(process.cwd(), 'src/lib/games/doudizhu.ts')
    const serverFile = resolve(process.cwd(), '../server/src/services/gameDoudizhu.ts')
    const stripHeader = (source: string): string => {
      const end = source.indexOf('*/')
      return end === -1 ? source : source.slice(end + 2)
    }
    const clientSource = stripHeader(readFileSync(clientFile, 'utf8'))
    const serverSource = stripHeader(readFileSync(serverFile, 'utf8'))
    expect(clientSource).toBe(serverSource)
  })
})

// === 大厅目录 ===

describe('游戏大厅目录（斗地主）', () => {
  it('斗地主已上线且双模式路由正确', () => {
    expect(isGamePlayable('doudizhu')).toBe(true)
    const entry = getGameCatalogEntry('doudizhu')
    expect(entry?.modes).toEqual(['single', 'online'])
    expect(entry?.route).toBe('/games/doudizhu')
    expect(entry?.onlineRoute).toBe('/games/doudizhu/online')
    expect(GAME_CATALOG.filter((game) => game.playable).map((game) => game.id)).toContain('doudizhu')
  })
})
