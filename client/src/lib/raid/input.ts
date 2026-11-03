/**
 * 搜打撤输入控制：桌面 WASD + 鼠标瞄准射击 + 技能键；手机由组件调用虚拟摇杆接口。
 */

import type { RaidEngine } from './engine'
import type { RaidRenderMetrics } from './renderer'

export interface RaidInputController {
  setMove(x: number, y: number): void
  setAim(x: number, y: number): void
  setFiring(firing: boolean): void
  pressInteract(): void
  pressSkill(index: number): void
  pressHeal(): void
  pressRepair(): void
  dispose(): void
}

interface InputCallbacks {
  onSkill?: (index: number) => void
  onInteract?: () => void
  onHeal?: () => void
  onRepair?: () => void
}

export function createRaidInput(
  canvas: HTMLCanvasElement,
  engine: RaidEngine,
  getMetrics: () => RaidRenderMetrics,
  callbacks: InputCallbacks = {},
): RaidInputController {
  const keys = new Set<string>()
  let firing = false

  const recomputeMove = (): void => {
    const left = keys.has('a') || keys.has('arrowleft')
    const right = keys.has('d') || keys.has('arrowright')
    const up = keys.has('w') || keys.has('arrowup')
    const down = keys.has('s') || keys.has('arrowdown')
    engine.input.moveX = (right ? 1 : 0) - (left ? 1 : 0)
    engine.input.moveY = (down ? 1 : 0) - (up ? 1 : 0)
  }

  const canvasPoint = (event: MouseEvent | PointerEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect()
    const metrics = getMetrics()
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top
    return {
      x: (px - metrics.offsetX) / metrics.tile,
      y: (py - metrics.offsetY) / metrics.tile,
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
    const key = event.key.toLowerCase()
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) {
      event.preventDefault()
    }
    if (key === 'e') {
      callbacks.onInteract?.()
      event.preventDefault()
      return
    }
    if (key === '1' || key === '2' || key === '3') {
      callbacks.onSkill?.(Number(key) - 1)
      return
    }
    if (key === 'q') {
      callbacks.onHeal?.()
      return
    }
    if (key === 'f') {
      callbacks.onRepair?.()
      return
    }
    if (key === ' ') firing = true
    if (!keys.has(key)) {
      keys.add(key)
      recomputeMove()
    }
  }

  const onKeyUp = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase()
    if (key === ' ') firing = false
    keys.delete(key)
    recomputeMove()
  }

  const onMouseMove = (event: MouseEvent): void => {
    const point = canvasPoint(event)
    engine.input.aimX = point.x
    engine.input.aimY = point.y
  }

  const onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) return
    firing = true
    const point = canvasPoint(event)
    engine.input.aimX = point.x
    engine.input.aimY = point.y
  }

  const onMouseUp = (): void => {
    firing = false
  }

  const onBlur = (): void => {
    keys.clear()
    firing = false
    engine.input.moveX = 0
    engine.input.moveY = 0
    engine.input.firing = false
  }

  const onContextMenu = (event: MouseEvent): void => {
    event.preventDefault()
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  canvas.addEventListener('mousemove', onMouseMove)
  canvas.addEventListener('mousedown', onMouseDown)
  window.addEventListener('mouseup', onMouseUp)
  canvas.addEventListener('contextmenu', onContextMenu)

  // 每帧同步开火状态（键盘空格 / 鼠标左键任一）
  const timer = window.setInterval(() => {
    engine.input.firing = firing
  }, 30)

  return {
    setMove(x: number, y: number): void {
      engine.input.moveX = Math.max(-1, Math.min(1, x))
      engine.input.moveY = Math.max(-1, Math.min(1, y))
    },
    setAim(x: number, y: number): void {
      engine.input.aimX = x
      engine.input.aimY = y
    },
    setFiring(value: boolean): void {
      firing = value
      engine.input.firing = value
    },
    pressInteract(): void {
      callbacks.onInteract?.()
    },
    pressSkill(index: number): void {
      callbacks.onSkill?.(index)
    },
    pressHeal(): void {
      callbacks.onHeal?.()
    },
    pressRepair(): void {
      callbacks.onRepair?.()
    },
    dispose(): void {
      window.clearInterval(timer)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      canvas.removeEventListener('contextmenu', onContextMenu)
    },
  }
}
