import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import UserTitleBadge from '../UserTitleBadge'
import type { UserTitleDto } from '../../types/points'

const legendary: UserTitleDto = {
  id: 22,
  name: '虚空领主',
  color: '#6639ba',
  icon: '🕳️',
  rarity: 'legendary',
  effect: 'void',
}

const origin: UserTitleDto = {
  id: 44,
  name: '源初',
  color: '#f5e6c8',
  icon: '✴️',
  rarity: 'origin',
  effect: 'etch',
}

const mythic: UserTitleDto = {
  id: 33,
  name: '奇点',
  color: '#a371f7',
  icon: '🌀',
  rarity: 'mythic',
  effect: 'singularity',
}

describe('UserTitleBadge', () => {
  it('传说称号完整模式渲染光环 / 粒子 / 爆发层', () => {
    const { container } = render(<UserTitleBadge title={legendary} />)
    const badge = container.querySelector('.gh-title-badge--legendary')!
    expect(badge.classList.contains('gh-title-badge--fx-void')).toBe(true)
    expect(badge.querySelectorAll('.gh-title-badge-sparks i')).toHaveLength(8)
    expect(badge.querySelector('.gh-title-badge-aura')).not.toBeNull()
    expect(badge.querySelector('.gh-title-badge-burst')).not.toBeNull()
  })

  it('神话称号同时挂传说特效与 --mythic 专属翼饰层', () => {
    const { container } = render(<UserTitleBadge title={mythic} />)
    const badge = container.querySelector('.gh-title-badge--mythic')!
    expect(badge.classList.contains('gh-title-badge--legendary')).toBe(true)
    expect(badge.classList.contains('gh-title-badge--fx-singularity')).toBe(true)
    expect(badge.getAttribute('data-rarity')).toBe('mythic')
    expect(badge.querySelector('.gh-title-badge-mythic')).not.toBeNull()
    expect(badge.querySelector('.gh-title-badge-burst')).not.toBeNull()
  })

  it('神话称号 compact 模式不渲染翼饰层', () => {
    const { container } = render(<UserTitleBadge title={mythic} variant="compact" />)
    const badge = container.querySelector('.gh-title-badge--mythic')!
    expect(badge.querySelector('.gh-title-badge-mythic')).toBeNull()
    expect(badge.children).toHaveLength(2)
  })

  it('compact 模式只保留图标与文字（聊天高密度场景零动画）', () => {
    const { container } = render(<UserTitleBadge title={legendary} variant="compact" />)
    const badge = container.querySelector('.gh-title-badge--compact')!
    expect(badge.classList.contains('gh-title-badge--legendary')).toBe(true)
    // 静态配色仍保留传说渐变（class 在），但不渲染任何动画层
    expect(badge.classList.contains('gh-title-badge--fx-void')).toBe(true)
    expect(badge.querySelector('.gh-title-badge-sparks')).toBeNull()
    expect(badge.querySelector('.gh-title-badge-aura')).toBeNull()
    expect(badge.querySelector('.gh-title-badge-burst')).toBeNull()
    expect(badge.children).toHaveLength(2)
  })

  it('源初称号使用角切铭牌，不再渲染光环 / 粒子 / 爆发层', () => {
    const { container } = render(<UserTitleBadge title={origin} />)
    const badge = container.querySelector('.gh-title-badge--origin')!
    expect(badge.classList.contains('gh-title-badge--legendary')).toBe(false)
    expect(badge.classList.contains('gh-title-badge--fx-etch')).toBe(true)
    expect(badge.getAttribute('data-rarity')).toBe('origin')
    expect(badge.querySelector('.gh-title-badge-origin')).not.toBeNull()
    expect(badge.querySelector('.gh-title-badge-aura')).toBeNull()
    expect(badge.querySelector('.gh-title-badge-sparks')).toBeNull()
    expect(badge.querySelector('.gh-title-badge-burst')).toBeNull()
  })

  it('源初称号 compact 模式不渲染铭牌层', () => {
    const { container } = render(<UserTitleBadge title={origin} variant="compact" />)
    const badge = container.querySelector('.gh-title-badge--origin')!
    expect(badge.querySelector('.gh-title-badge-origin')).toBeNull()
    expect(badge.children).toHaveLength(2)
  })

  it('title 为空时不渲染', () => {
    const { container } = render(<UserTitleBadge title={null} />)
    expect(container.firstChild).toBeNull()
  })
})
