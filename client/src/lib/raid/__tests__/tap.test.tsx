import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { onTap } from '../tap'

/** 把 onTap 挂到一个真实按钮上，模拟触屏 / 鼠标 / 键盘三种触发路径 */
function TapButton({ onFire }: { onFire: () => void }) {
  return <button type="button" {...onTap(onFire)}>技能</button>
}

function rectOf(el: HTMLElement, box: DOMRect): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(box)
}

const INSIDE: Partial<DOMRect> = { left: 0, top: 0, right: 100, bottom: 100 }
const touch = { identifier: 1, clientX: 50, clientY: 50 }

describe('onTap 触屏点击助手', () => {
  it('多点触控下浏览器不合成 click 时，touchend 仍要触发', () => {
    const onFire = vi.fn()
    const { getByRole } = render(<TapButton onFire={onFire} />)
    const button = getByRole('button')
    rectOf(button, INSIDE as DOMRect)
    fireEvent.touchEnd(button, { changedTouches: [touch] })
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('touchend 之后紧跟的 click 必须去重，不能双触发', () => {
    const onFire = vi.fn()
    const { getByRole } = render(<TapButton onFire={onFire} />)
    const button = getByRole('button')
    rectOf(button, INSIDE as DOMRect)
    fireEvent.touchEnd(button, { changedTouches: [touch] })
    fireEvent.click(button)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('纯鼠标路径只走 click', () => {
    const onFire = vi.fn()
    const { getByRole } = render(<TapButton onFire={onFire} />)
    const button = getByRole('button')
    fireEvent.click(button)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('手指滑出按钮范围不算点击', () => {
    const onFire = vi.fn()
    const { getByRole } = render(<TapButton onFire={onFire} />)
    const button = getByRole('button')
    rectOf(button, INSIDE as DOMRect)
    fireEvent.touchEnd(button, { changedTouches: [{ identifier: 1, clientX: 240, clientY: 50 }] })
    expect(onFire).not.toHaveBeenCalled()
    // 滑出后不写去重水位，随后的真实点击仍要生效
    fireEvent.click(button)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('不同按钮之间互不影响去重（A 的 touch 不该吞掉 B 的 click）', () => {
    const fireA = vi.fn()
    const fireB = vi.fn()
    // 两次 render 会让 getByRole 命中多个按钮，这里一次渲染两个再按序取
    const { getAllByRole } = render(
      <div>
        <TapButton onFire={fireA} />
        <TapButton onFire={fireB} />
      </div>,
    )
    const [a, b] = getAllByRole('button')
    rectOf(a, INSIDE as DOMRect)
    fireEvent.touchEnd(a, { changedTouches: [touch] })
    fireEvent.click(b)
    expect(fireA).toHaveBeenCalledTimes(1)
    expect(fireB).toHaveBeenCalledTimes(1)
  })
})
