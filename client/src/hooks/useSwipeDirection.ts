import { useEffect, useRef, type RefObject } from 'react'

/** 滑动方向（与贪吃蛇等四向游戏的方向枚举一致） */
export type SwipeDirection = 'up' | 'down' | 'left' | 'right'

/** 触发一次改向所需的最小位移（CSS 像素） */
const SWIPE_THRESHOLD = 22

/** 位移 → 四向之一；未超过阈值返回 null */
export function directionFromDelta(dx: number, dy: number): SwipeDirection | null {
  if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return null
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'down' : 'up'
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('button, a, input, select, textarea, [role="button"]'))
}

/**
 * 触摸 / 鼠标 / 触控笔统一的滑动改向。
 *
 * 后台项目此前的实现只监听 TouchEvent，且只在 touchend 结算；在部分平板上
 * （尤其是带触控笔 / 混合输入设备与长按拖拽手势）会出现滑动无响应或只识别
 * 到第一段手势。这里改用 Pointer Events：
 *   - 一次手势只触发一次方向（越过阈值立即触发，手感更跟手）；
 *   - 指针捕获保证手指滑出棋盘后 pointerup 仍能收到；
 *   - 覆盖触摸、触控笔与鼠标拖拽，按钮 / 链接上的按下不当作棋盘手势。
 */
export function useSwipeDirection(
  targetRef: RefObject<HTMLElement | null>,
  onDirection: (direction: SwipeDirection) => void,
  enabled: boolean
): void {
  const callbackRef = useRef(onDirection)
  callbackRef.current = onDirection
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  useEffect(() => {
    const node = targetRef.current
    if (!node) return

    let gesture: { pointerId: number; startX: number; startY: number; fired: boolean } | null = null

    const releaseCapture = (pointerId: number) => {
      try {
        if (node.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId)
      } catch {
        // 指针已失效（浏览器取消手势）时忽略
      }
    }

    const handleDown = (event: PointerEvent) => {
      if (!enabledRef.current || !event.isPrimary) return
      if (event.pointerType === 'mouse' && event.button !== 0) return
      if (isInteractiveTarget(event.target)) return
      gesture = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, fired: false }
      try {
        node.setPointerCapture(event.pointerId)
      } catch {
        // 某些浏览器 / 指针类型不支持捕获，退化为普通事件流
      }
    }

    const handleMove = (event: PointerEvent) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return
      if (gesture.fired || !enabledRef.current) return
      const direction = directionFromDelta(event.clientX - gesture.startX, event.clientY - gesture.startY)
      if (!direction) return
      gesture.fired = true
      event.preventDefault()
      callbackRef.current(direction)
    }

    const handleUp = (event: PointerEvent) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return
      const current = gesture
      gesture = null
      releaseCapture(event.pointerId)
      // 轻扫时 pointermove 可能一帧都没触发，在结束时补一次判定
      if (!current.fired && enabledRef.current) {
        const direction = directionFromDelta(event.clientX - current.startX, event.clientY - current.startY)
        if (direction) callbackRef.current(direction)
      }
    }

    const handleCancel = (event: PointerEvent) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return
      releaseCapture(event.pointerId)
      gesture = null
    }

    node.addEventListener('pointerdown', handleDown)
    node.addEventListener('pointermove', handleMove, { passive: false })
    node.addEventListener('pointerup', handleUp)
    node.addEventListener('pointercancel', handleCancel)
    return () => {
      node.removeEventListener('pointerdown', handleDown)
      node.removeEventListener('pointermove', handleMove)
      node.removeEventListener('pointerup', handleUp)
      node.removeEventListener('pointercancel', handleCancel)
    }
  }, [targetRef])
}
