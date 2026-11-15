import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/**
 * 通用游戏沉浸模式（2026-11-15）。
 *
 * 优先原生 Fullscreen API（含 webkit 前缀），被浏览器拒绝时降级为 CSS fixed 铺满；
 * 绝不在被拒后自动重试，避免「按退出反而重新进入全屏」的死循环。
 * 同时负责 body 锁滚动与 Esc 退出。
 */
export function useGameImmersive(stageRef: RefObject<HTMLElement | null>) {
  const [immersive, setImmersive] = useState(false)
  const fallbackRef = useRef(false)
  const listenersRef = useRef(new Set<() => void>())

  const notifyResize = useCallback(() => {
    for (const listener of listenersRef.current) listener()
  }, [])

  const onResize = useCallback((listener: () => void) => {
    listenersRef.current.add(listener)
    return () => {
      listenersRef.current.delete(listener)
    }
  }, [])

  useEffect(() => {
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null
      webkitExitFullscreen?: () => void
    }
    const onChange = () => {
      const full = Boolean(document.fullscreenElement || doc.webkitFullscreenElement)
      if (!full) fallbackRef.current = false
      setImmersive(full || fallbackRef.current)
      notifyResize()
    }
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('webkitfullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('webkitfullscreenchange', onChange)
    }
  }, [notifyResize])

  useEffect(() => {
    if (!immersive) return undefined
    document.body.classList.add('gh-game-immersive')
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.fullscreenElement) {
        setImmersive(false)
        fallbackRef.current = false
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.classList.remove('gh-game-immersive')
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [immersive])

  const exit = useCallback(() => {
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null
      webkitExitFullscreen?: () => void
    }
    fallbackRef.current = false
    if (typeof document.exitFullscreen === 'function') {
      if (document.fullscreenElement) {
        void Promise.resolve(document.exitFullscreen()).catch(() => undefined)
      }
    } else {
      doc.webkitExitFullscreen?.()
    }
    setImmersive(false)
    notifyResize()
  }, [notifyResize])

  const enter = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    const request = stage.requestFullscreen
      ?? (stage as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }).webkitRequestFullscreen?.bind(stage)
    if (!request) {
      fallbackRef.current = true
      setImmersive(true)
      notifyResize()
      return
    }
    try {
      const result = request.call(stage) as Promise<void> | undefined
      if (result && typeof result.then === 'function') {
        result.then(() => {
          setImmersive(true)
          notifyResize()
        }).catch(() => {
          fallbackRef.current = true
          setImmersive(true)
          notifyResize()
        })
      } else {
        setImmersive(true)
        notifyResize()
      }
    } catch {
      fallbackRef.current = true
      setImmersive(true)
      notifyResize()
    }
  }, [stageRef, notifyResize])

  const toggle = useCallback(() => {
    if (immersive) exit()
    else enter()
  }, [immersive, enter, exit])

  return { immersive, enter, exit, toggle, onResize }
}