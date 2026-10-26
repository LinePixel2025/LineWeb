import { beforeEach, describe, expect, it } from 'vitest'
import {
  PARKOUR_BEST_KEY,
  emptyParkourBest,
  readParkourBest,
  saveParkourRun,
} from '../parkourRecords'

describe('parkourRecords', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('reads an empty record when nothing is stored', () => {
    expect(readParkourBest()).toEqual(emptyParkourBest())
  })

  it('keeps the best of each field and increments runs', () => {
    const first = saveParkourRun({ distanceM: 320.44, coins: 12, score: 480, maxCombo: 9 })
    expect(first.newDistance).toBe(true)
    expect(first.newCoins).toBe(true)
    expect(first.newScore).toBe(true)
    expect(first.newCombo).toBe(true)
    expect(first.best).toEqual({ distanceM: 320.4, coins: 12, score: 480, maxCombo: 9, runs: 1 })

    const second = saveParkourRun({ distanceM: 120, coins: 30, score: 300, maxCombo: 4 })
    expect(second.newDistance).toBe(false)
    expect(second.newCoins).toBe(true)
    expect(second.newScore).toBe(false)
    expect(second.newCombo).toBe(false)
    expect(second.best).toEqual({ distanceM: 320.4, coins: 30, score: 480, maxCombo: 9, runs: 2 })
    expect(readParkourBest()).toEqual(second.best)
  })

  it('falls back safely on corrupted or negative data', () => {
    localStorage.setItem(PARKOUR_BEST_KEY, '{not json')
    expect(readParkourBest()).toEqual(emptyParkourBest())

    localStorage.setItem(
      PARKOUR_BEST_KEY,
      JSON.stringify({ distanceM: -10, coins: 'x', score: null, maxCombo: 3, runs: 2.8 }),
    )
    expect(readParkourBest()).toEqual({ distanceM: 0, coins: 0, score: 0, maxCombo: 3, runs: 2 })
  })

  it('does not throw when storage is unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked')
      },
    })
    try {
      expect(readParkourBest()).toEqual(emptyParkourBest())
      expect(() =>
        saveParkourRun({ distanceM: 10, coins: 1, score: 20, maxCombo: 1 }),
      ).not.toThrow()
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original)
      else delete (window as unknown as { localStorage?: Storage }).localStorage
    }
  })
})
