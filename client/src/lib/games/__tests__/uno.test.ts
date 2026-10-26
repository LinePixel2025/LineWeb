/**
 * UNO 纯函数引擎测试 + 双端源码对齐 + 大厅目录。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  UNO_COLORS,
  createUnoDeck,
  createUnoTable,
  createUnoRng,
  drawUnoTurn,
  passUnoTurn,
  playUnoCard,
  suggestUnoMove,
  unoIsPlayableCard,
  unoPlayableCards,
  unoTopCard,
} from '../uno'
import { GAME_CATALOG, getGameCatalogEntry, isGamePlayable } from '../catalog'

function findId(deck: ReturnType<typeof createUnoDeck>, color: string, kind: string, number: number | null = null): number {
  const card = deck.find((item) => item.color === color && item.kind === kind && item.number === number)
  if (!card) throw new Error(`missing ${color} ${kind} ${number}`)
  return card.id
}

const deck = createUnoDeck()
const cardOf = (id: number) => {
  const card = deck.find((item) => item.id === id)
  if (!card) throw new Error(`missing ${id}`)
  return card
}

function buildState(hands: number[][], topId: number, color: string) {
  const state = createUnoTable(Math.max(2, hands.length), () => 0.5)
  const all = hands.flat()
  state.players.forEach((player, seat) => {
    player.hand = (hands[seat] ?? []).map(cardOf)
    player.alive = true
  })
  state.discard = [cardOf(topId)]
  state.deck = deck.filter((card) => !all.includes(card.id) && card.id !== topId)
  state.currentColor = color as never
  state.turnSeat = 0
  state.drawnCardId = null
  state.status = 'playing'
  state.winnerSeat = null
  state.log = []
  return state
}

describe('UNO 牌堆与出牌规则', () => {
  it('108 张、四色各 25 张、万能 8 张', () => {
    expect(deck).toHaveLength(108)
    expect(new Set(deck.map((card) => card.id)).size).toBe(108)
    for (const color of UNO_COLORS) {
      expect(deck.filter((card) => card.color === color)).toHaveLength(25)
    }
    expect(deck.filter((card) => card.kind === 'wild' || card.kind === 'wild4')).toHaveLength(8)
  })

  it('同色 / 同数字 / 同功能可出；万能+4 受手牌颜色限制', () => {
    const red5 = cardOf(findId(deck, 'red', 'number', 5))
    const blue5 = cardOf(findId(deck, 'blue', 'number', 5))
    const blueSkip = cardOf(findId(deck, 'blue', 'skip'))
    const redSkip = cardOf(findId(deck, 'red', 'skip'))
    const wild4 = cardOf(findId(deck, 'wild', 'wild4'))
    expect(unoIsPlayableCard(blue5, [blue5], red5, 'red')).toBe(true)
    expect(unoIsPlayableCard(blueSkip, [blueSkip], redSkip, 'red')).toBe(true)
    expect(unoIsPlayableCard(blueSkip, [blueSkip], red5, 'red')).toBe(false)
    expect(unoIsPlayableCard(wild4, [wild4, redSkip], red5, 'red')).toBe(false)
    expect(unoIsPlayableCard(wild4, [wild4, blueSkip], red5, 'red')).toBe(true)
  })

  it('功能牌结算：禁止跳过、反转、+2 摸牌、出完获胜', () => {
    const red5 = findId(deck, 'red', 'number', 5)
    const blue1 = findId(deck, 'blue', 'number', 1)
    const green1 = findId(deck, 'green', 'number', 1)
    const redSkip = findId(deck, 'red', 'skip')
    const redReverse = findId(deck, 'red', 'reverse')
    const redDraw2 = findId(deck, 'red', 'draw2')

    let state = buildState([[redSkip, blue1], [blue1], [green1]], red5, 'red')
    state = playUnoCard(state, 0, redSkip)
    expect(state.turnSeat).toBe(2)

    state = buildState([[redReverse, blue1], [blue1], [green1]], red5, 'red')
    state = playUnoCard(state, 0, redReverse)
    expect(state.direction).toBe(-1)
    expect(state.turnSeat).toBe(2)

    state = buildState([[redDraw2, blue1], [blue1], [green1]], red5, 'red')
    state = playUnoCard(state, 0, redDraw2)
    expect(state.players[1].hand).toHaveLength(3)
    expect(state.turnSeat).toBe(2)

    state = buildState([[red5], [blue1]], red5, 'red')
    state = playUnoCard(state, 0, red5)
    expect(state.status).toBe('finished')
    expect(state.winnerSeat).toBe(0)
  })

  it('摸牌后可立即打出或跳过；摸牌后不能打其他牌', () => {
    const red5 = findId(deck, 'red', 'number', 5)
    const blue1 = findId(deck, 'blue', 'number', 1)
    const green1 = findId(deck, 'green', 'number', 1)
    let state = buildState([[red5, blue1], [green1]], red5, 'red')
    state.drawnCardId = blue1
    expect(() => playUnoCard(state, 0, red5)).toThrow('刚摸到')
    state = passUnoTurn(state, 0)
    expect(state.turnSeat).toBe(1)
    expect(state.drawnCardId).toBeNull()
  })

  it('AI 决策：无牌可出摸牌，下家剩一张时优先功能牌', () => {
    const red5 = cardOf(findId(deck, 'red', 'number', 5))
    const blue1 = cardOf(findId(deck, 'blue', 'number', 1))
    const redDraw2 = cardOf(findId(deck, 'red', 'draw2'))
    expect(suggestUnoMove({ hand: [blue1], top: red5, currentColor: 'red', drawnCardId: null }).action).toBe('draw')
    const move = suggestUnoMove({
      hand: [redDraw2, red5],
      top: red5,
      currentColor: 'red',
      drawnCardId: null,
      nextHandCount: 1,
    })
    expect(move).toMatchObject({ action: 'play', cardId: redDraw2.id })
  })

  it('AI 自对弈能结束在合法状态', () => {
    const rng = createUnoRng(7)
    let state = createUnoTable(3, rng)
    let steps = 0
    while (state.status === 'playing' && steps < 1000) {
      const seat = state.turnSeat
      if (seat === null) break
      const player = state.players[seat]
      const top = unoTopCard(state)
      const move = suggestUnoMove({
        hand: player.hand,
        top,
        currentColor: state.currentColor,
        drawnCardId: state.drawnCardId,
      }, rng)
      state = move.action === 'play'
        ? playUnoCard(state, seat, move.cardId, move.color, rng)
        : move.action === 'draw'
          ? drawUnoTurn(state, seat, rng)
          : passUnoTurn(state, seat)
      steps += 1
    }
    expect(state.status).toBe('finished')
    expect(steps).toBeLessThan(1000)
  })
})

describe('UNO 双端引擎对齐', () => {
  it('服务端引擎与前端引擎源码一致（除头注释外）', () => {
    const stripHeader = (source: string): string => {
      const end = source.indexOf('*/')
      return end === -1 ? source : source.slice(end + 2)
    }
    const clientSource = stripHeader(readFileSync(resolve(process.cwd(), 'src/lib/games/uno.ts'), 'utf8'))
    const serverSource = stripHeader(readFileSync(resolve(process.cwd(), '../server/src/services/gameUno.ts'), 'utf8'))
    expect(clientSource).toBe(serverSource)
  })
})

describe('游戏大厅目录（UNO）', () => {
  it('UNO 已上线且双模式路由正确', () => {
    expect(isGamePlayable('uno')).toBe(true)
    const entry = getGameCatalogEntry('uno')
    expect(entry?.modes).toEqual(['single', 'online'])
    expect(entry?.route).toBe('/games/uno')
    expect(entry?.onlineRoute).toBe('/games/uno/online')
    expect(GAME_CATALOG.filter((game) => game.playable).map((game) => game.id)).toContain('uno')
  })
})
