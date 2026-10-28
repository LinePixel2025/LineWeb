import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'

interface LongPressOptions {
  delayMs?: number
  moveTolerance?: number
}

/**
 * 长按识别（pointer events）：500ms、位移超过阈值取消。
 * 返回的 begin/end 可直接挂到消息行；右键由调用方单独处理。
 */
export function useLongPress(
  onLongPress: (x: number, y: number) => void,
  options: LongPressOptions = {},
) {
  const delayMs = options.delayMs ?? 500
  const moveTolerance = options.moveTolerance ?? 10
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const firedRef = useRef(false)

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    startRef.current = null
  }, [])

  const begin = useCallback((event: ReactPointerEvent) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    clear()
    firedRef.current = false
    startRef.current = { x: event.clientX, y: event.clientY }
    const { clientX, clientY } = event
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      firedRef.current = true
      onLongPress(clientX, clientY)
    }, delayMs)
  }, [clear, delayMs, onLongPress])

  const move = useCallback((event: ReactPointerEvent) => {
    const start = startRef.current
    if (!start) return
    if (Math.abs(event.clientX - start.x) > moveTolerance || Math.abs(event.clientY - start.y) > moveTolerance) {
      clear()
    }
  }, [clear, moveTolerance])

  const end = useCallback(() => {
    clear()
  }, [clear])

  /** 长按后浏览器可能补发 click；调用方可据此吞掉一次点击 */
  const wasLongPress = useCallback(() => firedRef.current, [])

  return { begin, move, end, clear, wasLongPress }
}
