/**
 * 骗子酒馆引擎测试 + 双端源码对齐 + 大厅目录。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  LIAR_DECK_SIZE,
  LIAR_MAX_PLAYERS,
  LIAR_MIN_PLAYERS,
  applyLiarTableChallenge,
  applyLiarTablePlay,
  createLiarDeck,
  createLiarRng,
  createLiarTable,
  dealLiarHands,
  liarCardKind,
  liarGunBullets,
  liarTriggerHits,
  suggestLiarMove,
  type LiarTableState,
} from '../liar'
import { GAME_CATALOG, getGameCatalogEntry, isGamePlayable } from '../catalog'

function targetIds(state: LiarTableState, target: 'K' | 'Q' | 'A', count = 1): number[] {
  const player = state.players[state.turnSeat ?? 0]
  const truthy = player.hand.filter((card) => {
    const kind = liarCardKind(card)
    return kind === target || kind === 'JOKER'
  })
  return truthy.slice(0, count)
}

describe('骗子酒馆牌堆与规则', () => {
  it('20 张牌：K/Q/A 各 6 张、鬼牌 2 张', () => {
    const deck = createLiarDeck()
    expect(deck).toHaveLength(LIAR_DECK_SIZE)
    expect(deck.filter((card) => liarCardKind(card) === 'K')).toHaveLength(6)
    expect(deck.filter((card) => liarCardKind(card) === 'Q')).toHaveLength(6)
    expect(deck.filter((card) => liarCardKind(card) === 'A')).toHaveLength(6)
    expect(deck.filter((card) => liarCardKind(card) === 'JOKER')).toHaveLength(2)
    expect(LIAR_MIN_PLAYERS).toBe(2)
    expect(LIAR_MAX_PLAYERS).toBe(4)
  })

  it('发牌每人 5 张且不重复', () => {
    for (const count of [2, 3, 4]) {
      const hands = dealLiarHands(count, createLiarRng(11))
      expect(hands).toHaveLength(count)
      const all = hands.flat()
      expect(all).toHaveLength(count * 5)
      expect(new Set(all).size).toBe(all.length)
    }
  })

  it('左轮子弹数 = 死亡人数 + 1，封顶 6', () => {
    expect(liarGunBullets(0)).toBe(1)
    expect(liarGunBullets(2)).toBe(3)
    expect(liarGunBullets(10)).toBe(6)
    expect(liarTriggerHits(0, () => 0.1)).toBe(true)
    expect(liarTriggerHits(0, () => 0.9)).toBe(false)
  })

  it('出牌 / 质疑状态机：开牌真假决定输家并重发新局', () => {
    const rng = createLiarRng(123)
    let state = createLiarTable(3, rng)
    const starter = state.turnSeat
    expect(starter).not.toBeNull()
    if (starter === null) return

    // 第一手：挑真牌出（若没有真牌就随便出一张）
    const truthy = targetIds(state, state.target, 2)
    const starterHand = state.players[starter].hand
    const cards = truthy.length > 0 ? truthy : starterHand.slice(0, 1)
    const expectedTruthful = truthy.length > 0
    state = applyLiarTablePlay(state, starter, cards, rng)
    const challenger = state.turnSeat
    expect(challenger).not.toBeNull()
    if (challenger === null) return
    expect(challenger).not.toBe(starter)

    const beforeRound = state.round
    state = applyLiarTableChallenge(state, challenger, () => 0.99)
    expect(state.lastReveal?.truthful).toBe(expectedTruthful)
    // 无论是否中弹都重发下一局（除非只剩一人）
    if (!state.finished) expect(state.round).toBe(beforeRound + 1)
  })

  it('AI 决策可复现且自对弈能结束', () => {
    const rng = createLiarRng(2026)
    let state = createLiarTable(3, rng)
    let steps = 0
    while (!state.finished && steps < 500) {
      const seat = state.turnSeat
      if (seat === null) break
      const player = state.players[seat]
      const top = state.pile[state.pile.length - 1] ?? null
      const move = suggestLiarMove({
        hand: player.hand,
        target: state.target,
        lastPlay: top ? { seat: top.seat, count: top.count } : null,
      }, rng)
      if (!move) break
      state = move.action === 'play'
        ? applyLiarTablePlay(state, seat, move.cards, rng)
        : applyLiarTableChallenge(state, seat, rng)
      steps += 1
    }
    expect(steps).toBeLessThan(500)
    expect(state.finished).toBe(true)
  })
})

describe('骗子酒馆双端引擎对齐', () => {
  it('服务端引擎与前端引擎源码一致（除头注释外）', () => {
    const stripHeader = (source: string): string => {
      const end = source.indexOf('*/')
      return end === -1 ? source : source.slice(end + 2)
    }
    const clientSource = stripHeader(readFileSync(resolve(process.cwd(), 'src/lib/games/liar.ts'), 'utf8'))
    const serverSource = stripHeader(readFileSync(resolve(process.cwd(), '../server/src/services/gameLiar.ts'), 'utf8'))
    expect(clientSource).toBe(serverSource)
  })
})

describe('游戏大厅目录（骗子酒馆）', () => {
  it('骗子酒馆已上线且双模式路由正确', () => {
    expect(isGamePlayable('liar')).toBe(true)
    const entry = getGameCatalogEntry('liar')
    expect(entry?.modes).toEqual(['single', 'online'])
    expect(entry?.route).toBe('/games/liar')
    expect(entry?.onlineRoute).toBe('/games/liar/online')
    expect(GAME_CATALOG.filter((game) => game.playable).map((game) => game.id)).toContain('liar')
  })
})
