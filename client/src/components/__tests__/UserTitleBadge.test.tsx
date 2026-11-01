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

describe('UserTitleBadge', () => {
  it('传说称号完整模式渲染光环 / 粒子 / 爆发层', () => {
    const { container } = render(<UserTitleBadge title={legendary} />)
    const badge = container.querySelector('.gh-title-badge--legendary')!
    expect(badge.classList.contains('gh-title-badge--fx-void')).toBe(true)
    expect(badge.querySelectorAll('.gh-title-badge-sparks i')).toHaveLength(8)
    expect(badge.querySelector('.gh-title-badge-aura')).not.toBeNull()
    expect(badge.querySelector('.gh-title-badge-burst')).not.toBeNull()
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

  it('title 为空时不渲染', () => {
    const { container } = render(<UserTitleBadge title={null} />)
    expect(container.firstChild).toBeNull()
  })
})
