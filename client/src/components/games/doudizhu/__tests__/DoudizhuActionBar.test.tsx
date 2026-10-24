import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DoudizhuActionBar, { type DoudizhuActionBarProps } from '../DoudizhuActionBar'

const noop = () => {}

function renderBar(overrides: Partial<DoudizhuActionBarProps> = {}) {
  const props: DoudizhuActionBarProps = {
    stage: null,
    highestBid: 0,
    canHint: false,
    canPass: false,
    canPlay: false,
    onBid: noop,
    onHint: noop,
    onPass: noop,
    onPlay: noop,
    ...overrides,
  }
  return render(<DoudizhuActionBar {...props} />)
}

describe('DoudizhuActionBar', () => {
  it('叫分阶段禁用不高于当前最高分的选项', () => {
    renderBar({ stage: 'bidding', highestBid: 2 })

    expect(screen.getByRole('button', { name: '不叫' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '1 分' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '2 分' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '3 分' })).toBeEnabled()
  })

  it('叫分回调携带所叫分数', () => {
    const onBid = vi.fn()
    renderBar({ stage: 'bidding', onBid })

    fireEvent.click(screen.getByRole('button', { name: '3 分' }))
    expect(onBid).toHaveBeenCalledWith(3)
  })

  it('出牌阶段按能力禁用按钮并触发回调', () => {
    const onHint = vi.fn()
    const onPlay = vi.fn()
    renderBar({ stage: 'playing', canHint: false, canPass: false, canPlay: true, onHint, onPlay })

    expect(screen.getByRole('button', { name: '提示' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '不出' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '出牌' }))
    expect(onPlay).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '提示' }))
    expect(onHint).not.toHaveBeenCalled()
  })

  it('非我方回合不渲染任何按钮', () => {
    const { container } = renderBar({ stage: null })

    expect(container).toBeEmptyDOMElement()
  })
})
