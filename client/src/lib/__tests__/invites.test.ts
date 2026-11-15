import { describe, expect, it } from 'vitest'
import { inviteGameLabel, inviteKey, invitePath, isStandaloneGame } from '../invites'
import type { GameInvite } from '../../types/game'

const base = {
  from: { id: 1, username: 'a' },
  to: { id: 2, username: 'b' },
  createdAt: '2026-11-15T00:00:00.000Z',
  expiresAt: '2026-11-15T00:10:00.000Z',
}

describe('统一邀请纯函数', () => {
  it('用 game:id 组合键区隔不同来源的自增 id', () => {
    expect(inviteKey({ id: 1, game: 'petbattle' })).toBe('petbattle:1')
    expect(inviteKey({ id: 1, game: 'raid' })).toBe('raid:1')
    expect(inviteKey({ ...base, id: 1 })).toBe('2048:1')
  })

  it('宠物 / 搜打撤有独立中文名', () => {
    expect(inviteGameLabel({ game: 'petbattle' })).toBe('宠物对决')
    expect(inviteGameLabel({ game: 'raid' })).toBe('搜打撤组队')
  })

  it('接受后跳转路径', () => {
    expect(invitePath({ ...base, id: 7, game: 'petbattle', matchId: 7 })).toBe('/pets/battle/7')
    expect(invitePath({ ...base, id: 7, game: 'raid', squadId: 's1' })).toBe('/pets/raid')
    expect(invitePath({ ...base, id: 7, game: '2048', matchId: 9 })).toBe('/games/2048/online/9')
    expect(invitePath({ ...base, id: 7, game: '2048' })).toBeNull()
  })

  it('standalone 判别', () => {
    expect(isStandaloneGame('petbattle')).toBe(true)
    expect(isStandaloneGame('raid')).toBe(true)
    expect(isStandaloneGame('2048')).toBe(false)
    expect(isStandaloneGame(undefined)).toBe(false)
  })

  it('兼容旧邀请缺省 game', () => {
    const legacy = { ...base, id: 3, matchId: 4 } as GameInvite
    expect(inviteKey(legacy)).toBe('2048:3')
    expect(invitePath(legacy)).toBe('/games/2048/online/4')
  })
})