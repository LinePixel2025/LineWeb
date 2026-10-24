import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import DoudizhuResultOverlay, {
  type DoudizhuResultOverlayProps,
} from '../DoudizhuResultOverlay'

function renderOverlay(overrides: Partial<DoudizhuResultOverlayProps> = {}) {
  const props: DoudizhuResultOverlayProps = {
    open: true,
    outcome: 'win',
    scores: [],
    actions: <button type="button">再来一局</button>,
    ...overrides,
  }
  return render(<DoudizhuResultOverlay {...props} />)
}

describe('DoudizhuResultOverlay', () => {
  it('渲染胜负标题、比分与操作，并聚焦首个操作', () => {
    renderOverlay({
      outcome: 'win',
      detail: '地主获胜 · 倍率 ×2',
      scores: [
        { key: 0, name: '我', delta: 400 },
        { key: 1, name: '下家 AI', delta: -200 },
        { key: 2, name: '上家 AI', delta: -200 },
      ],
      footnote: '你的积分变化：+400',
    })

    expect(screen.getByRole('dialog', { name: '恭喜获胜！' })).toBeInTheDocument()
    expect(screen.getByText('地主获胜 · 倍率 ×2')).toBeInTheDocument()
    expect(screen.getByText('+400')).toBeInTheDocument()
    expect(screen.getAllByText('-200')).toHaveLength(2)
    expect(screen.getByText('你的积分变化：+400')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再来一局' })).toHaveFocus()
  })

  it('流局未结算时显示占位符', () => {
    renderOverlay({
      outcome: 'draw',
      detail: '无人叫地主，本局流局',
      scores: [{ key: 0, name: '我', delta: null }],
    })

    expect(screen.getByRole('dialog', { name: '本局结束' })).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('open 为 false 时不渲染', () => {
    const { container } = renderOverlay({ open: false })

    expect(container).toBeEmptyDOMElement()
  })
})
