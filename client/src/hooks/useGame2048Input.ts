import { useEffect, useMemo, useRef } from 'react'
import type { TouchEvent } from 'react'
import type { Game2048Direction } from '../types/game'

/** 触发一次滑动方向所需的最小位移（px） */
export const GAME2048_SWIPE_THRESHOLD = 24

export interface UseGame2048InputOptions {
  /** 方向输入回调（键盘 / 触摸滑动） */
  onMove: (direction: Game2048Direction) => void
  /** 关闭后键盘与触摸都不再触发（例如已结束、浮层显示中） */
  enabled?: boolean
  /** 是否监听 window keydown，默认 true */
  keyboard?: boolean
  /** 是否返回触摸滑动处理器，默认 true */
  touch?: boolean
  /** 滑动判定阈值（px），默认 24 */
  threshold?: number
}

export interface Game2048TouchHandlers {
  onTouchStart: (event: TouchEvent<HTMLElement>) => void
  onTouchEnd: (event: TouchEvent<HTMLElement>) => void
  onTouchCancel: () => void
}

export interface UseGame2048InputResult {
  touchHandlers: Game2048TouchHandlers
}

const KEY_DIRECTION: Record<string, Game2048Direction | undefined> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  W: 'up',
  s: 'down',
  S: 'down',
  a: 'left',
  A: 'left',
  d: 'right',
  D: 'right',
}

const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

/** 表单类元素上的输入不应触发棋盘移动 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return target.closest('[contenteditable="true"]') !== null
}

function directionFromDelta(dx: number, dy: number): Game2048Direction | null {
  if (Math.abs(dx) < Math.abs(dy)) {
    return dy === 0 ? null : dy > 0 ? 'down' : 'up'
  }
  return dx === 0 ? null : dx > 0 ? 'right' : 'left'
}

/**
 * 2048 棋盘输入：window 键盘（方向键 + WASD）与触摸滑动。
 *
 * 键盘监听挂在 window 上，因此不必让棋盘获得焦点；表单控件 / contenteditable
 * 内的按键会被忽略。触摸处理器返回给棋盘元素展开，配合 CSS `touch-action: none`
 * 实现滑动不滚页。
 */
export function useGame2048Input({
  onMove,
  enabled = true,
  keyboard = true,
  touch = true,
  threshold = GAME2048_SWIPE_THRESHOLD,
}: UseGame2048InputOptions): UseGame2048InputResult {
  const onMoveRef = useRef(onMove)
  const enabledRef = useRef(enabled)
  const thresholdRef = useRef(threshold)
  const touchOriginRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    onMoveRef.current = onMove
  }, [onMove])

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    thresholdRef.current = threshold
  }, [threshold])

  // 键盘：方向键 / WASD；方向键阻止页面滚动
  useEffect(() => {
    if (!enabled || !keyboard) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!enabledRef.current) return
      if (event.defaultPrevented) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isEditableTarget(event.target)) return

      const direction = KEY_DIRECTION[event.key]
      if (!direction) return

      if (ARROW_KEYS.has(event.key)) event.preventDefault()
      onMoveRef.current(direction)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled, keyboard])

  // 触摸：记录起点，抬手时按主方向触发
  const touchHandlers = useMemo<Game2048TouchHandlers>(
    () => ({
      onTouchStart: (event) => {
        touchOriginRef.current = null
        if (!enabledRef.current || !touch) return
        const point = event.touches[0]
        if (!point) return
        touchOriginRef.current = { x: point.clientX, y: point.clientY }
      },
      onTouchEnd: (event) => {
        const origin = touchOriginRef.current
        touchOriginRef.current = null
        if (!origin || !enabledRef.current || !touch) return
        const point = event.changedTouches[0]
        if (!point) return
        const dx = point.clientX - origin.x
        const dy = point.clientY - origin.y
        const limit = thresholdRef.current
        if (Math.abs(dx) < limit && Math.abs(dy) < limit) return
        const direction = directionFromDelta(dx, dy)
        if (direction) onMoveRef.current(direction)
      },
      onTouchCancel: () => {
        touchOriginRef.current = null
      },
    }),
    [touch]
  )

  return { touchHandlers }
}

export default useGame2048Input
