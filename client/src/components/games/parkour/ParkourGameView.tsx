import { useEffect, useRef, useState } from 'react'
import {
  parkourPose,
  parkourScore,
  requestParkourJump,
  requestParkourLane,
  setParkourSlide,
  stepParkour,
  type ParkourRunState,
} from '../../../lib/games/parkour'
import { ParkourScene, type ParkourGhostView } from '../../../lib/games/parkourScene'
import { useSwipeDirection, type SwipeDirection } from '../../../hooks/useSwipeDirection'

export interface ParkourEndResult {
  distanceM: number
  coins: number
  score: number
  maxCombo: number
  cause: 'hit' | 'pit' | null
}

export interface ParkourHud {
  distanceM: number
  coins: number
  score: number
  combo: number
  maxCombo: number
  speed: number
  shield: boolean
  magnetMs: number
  dashMs: number
  alive: boolean
  finished: boolean
}

export interface ParkourGameViewProps {
  run: ParkourRunState
  mode: 'single' | 'online'
  playerColorIndex?: number
  ghosts?: ParkourGhostView[]
  paused?: boolean
  onEnd?: (result: ParkourEndResult) => void
  onPauseToggle?: () => void
}

const FIXED_STEP_MS = 1000 / 60
const SWIPE_SLIDE_MS = 650

function hudFromRun(run: ParkourRunState): ParkourHud {
  return {
    distanceM: Math.floor(run.distanceM),
    coins: run.coins,
    score: parkourScore(run),
    combo: run.combo,
    maxCombo: run.maxCombo,
    speed: run.speed,
    shield: run.shield,
    magnetMs: Math.max(0, run.magnetUntil - run.elapsedMs),
    dashMs: Math.max(0, run.dashUntil - run.elapsedMs),
    alive: run.alive,
    finished: run.finished,
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable
}

/** 全屏 3D 舞台：canvas + 场景 + 输入 + HUD；run 由页面持有 */
export default function ParkourGameView({
  run,
  mode,
  playerColorIndex = 0,
  ghosts = [],
  paused = false,
  onEnd,
  onPauseToggle,
}: ParkourGameViewProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const initializedRef = useRef(false)
  const ghostsRef = useRef<ParkourGhostView[]>(ghosts)
  const pausedRef = useRef(paused)
  const onEndRef = useRef(onEnd)
  const onPauseToggleRef = useRef(onPauseToggle)
  const endedRef = useRef(false)
  const slideKeyRef = useRef(false)
  const slideButtonRef = useRef(false)
  const swipeSlideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [hud, setHud] = useState<ParkourHud>(() => hudFromRun(run))
  const [error, setError] = useState<string | null>(null)
  const [contextLost, setContextLost] = useState(false)
  const [sceneVersion, setSceneVersion] = useState(0)

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  useEffect(() => {
    ghostsRef.current = ghosts
  }, [ghosts])

  useEffect(() => {
    onEndRef.current = onEnd
  }, [onEnd])

  useEffect(() => {
    onPauseToggleRef.current = onPauseToggle
  }, [onPauseToggle])

  const syncSlide = (): void => {
    setParkourSlide(run, slideKeyRef.current || slideButtonRef.current)
  }

  const triggerSwipeSlide = (): void => {
    setParkourSlide(run, true)
    if (swipeSlideTimerRef.current) clearTimeout(swipeSlideTimerRef.current)
    swipeSlideTimerRef.current = setTimeout(() => {
      if (endedRef.current || pausedRef.current) return
      if (!slideKeyRef.current && !slideButtonRef.current) setParkourSlide(run, false)
    }, SWIPE_SLIDE_MS)
  }

  useSwipeDirection(
    stageRef,
    (direction: SwipeDirection) => {
      if (pausedRef.current || endedRef.current || !run.alive || run.finished) return
      if (direction === 'left') requestParkourLane(run, -1)
      else if (direction === 'right') requestParkourLane(run, 1)
      else if (direction === 'up') requestParkourJump(run)
      else triggerSwipeSlide()
    },
    true,
  )

  useEffect(() => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas || !stage) return
    if (initializedRef.current) return
    initializedRef.current = true
    endedRef.current = Boolean(!run.alive || run.finished)

    let scene: ParkourScene
    try {
      scene = new ParkourScene(canvas, run.seed, playerColorIndex)
    } catch (err) {
      initializedRef.current = false
      setError(err instanceof Error ? err.message : '3D 场景初始化失败')
      return
    }
    setError(null)

    const handleContextLost = (event: Event): void => {
      event.preventDefault()
      setContextLost(true)
    }
    const handleContextRestored = (): void => {
      setContextLost(false)
      scene.resize()
    }
    canvas.addEventListener('webglcontextlost', handleContextLost)
    canvas.addEventListener('webglcontextrestored', handleContextRestored)

    let raf = 0
    let last = performance.now()
    let accumulator = 0
    let hudAccumulator = 0

    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop)
      const dtMs = Math.min(100, Math.max(0, now - last))
      last = now
      const active = !pausedRef.current && !endedRef.current

      if (active) {
        accumulator = Math.min(accumulator + dtMs, FIXED_STEP_MS * 4)
        let steps = 0
        while (accumulator >= FIXED_STEP_MS && steps < 4) {
          stepParkour(run, FIXED_STEP_MS)
          accumulator -= FIXED_STEP_MS
          steps += 1
          if (!run.alive || run.finished) break
        }
        if (steps === 4) accumulator = 0
        if (!run.alive || run.finished) {
          endedRef.current = true
          setHud(hudFromRun(run))
          onEndRef.current?.({
            distanceM: run.distanceM,
            coins: run.coins,
            score: parkourScore(run),
            maxCombo: run.maxCombo,
            cause: run.cause,
          })
        }
      }

      scene.update(run, ghostsRef.current, dtMs / 1000)
      scene.render()

      hudAccumulator += dtMs
      if (hudAccumulator >= 100) {
        hudAccumulator = 0
        setHud(hudFromRun(run))
      }
    }
    raf = requestAnimationFrame(loop)

    const resize = (): void => scene.resize()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    observer?.observe(stage)
    window.addEventListener('resize', resize)

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return
      if (event.code === 'Escape' || event.code === 'KeyP') {
        event.preventDefault()
        onPauseToggleRef.current?.()
        return
      }
      if (pausedRef.current || endedRef.current || !run.alive || run.finished) return
      if (event.repeat && event.code !== 'ArrowDown' && event.code !== 'KeyS') return
      if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
        event.preventDefault()
        requestParkourLane(run, -1)
      } else if (event.code === 'ArrowRight' || event.code === 'KeyD') {
        event.preventDefault()
        requestParkourLane(run, 1)
      } else if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'KeyW') {
        event.preventDefault()
        requestParkourJump(run)
      } else if (event.code === 'ArrowDown' || event.code === 'KeyS') {
        event.preventDefault()
        slideKeyRef.current = true
        syncSlide()
      }
    }
    const handleKeyUp = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return
      if (event.code === 'ArrowDown' || event.code === 'KeyS') {
        slideKeyRef.current = false
        syncSlide()
      }
    }
    const handleBlur = (): void => {
      slideKeyRef.current = false
      slideButtonRef.current = false
      if (run.alive && !run.finished) setParkourSlide(run, false)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)

    return () => {
      cancelAnimationFrame(raf)
      observer?.disconnect()
      window.removeEventListener('resize', resize)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
      canvas.removeEventListener('webglcontextlost', handleContextLost)
      canvas.removeEventListener('webglcontextrestored', handleContextRestored)
      if (swipeSlideTimerRef.current) {
        clearTimeout(swipeSlideTimerRef.current)
        swipeSlideTimerRef.current = null
      }
      scene.dispose()
      initializedRef.current = false
    }
    // run 在页面重开时换成新对象；其余 ref 不参与重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, mode, playerColorIndex, sceneVersion])

  const handleRetry = (): void => {
    setError(null)
    setContextLost(false)
    setSceneVersion((value) => value + 1)
  }

  const jump = (): void => {
    if (pausedRef.current || endedRef.current || !run.alive || run.finished) return
    requestParkourJump(run)
  }
  const lane = (direction: -1 | 1): void => {
    if (pausedRef.current || endedRef.current || !run.alive || run.finished) return
    requestParkourLane(run, direction)
  }
  const slideDown = (): void => {
    if (pausedRef.current || endedRef.current || !run.alive || run.finished) return
    slideButtonRef.current = true
    syncSlide()
  }
  const slideUp = (): void => {
    slideButtonRef.current = false
    syncSlide()
  }

  return (
    <div className={`gh-pk-stage gh-pk-stage--${mode}`} ref={stageRef}>
      <canvas ref={canvasRef} className="gh-pk-canvas" aria-label="霓虹跑酷 3D 游戏画面" />

      <div className="gh-pk-hud" aria-hidden={endedRef.current}>
        <div className="gh-pk-hud-left">
          <div className="gh-pk-distance">
            <strong>{hud.distanceM}</strong>
            <span>m</span>
          </div>
          <div className="gh-pk-stats">
            <span className="gh-pk-coin">◉ {hud.coins}</span>
            <span>{hud.score} 分</span>
            <span className="gh-pk-speed">{Math.round(hud.speed * 3.6)} km/h</span>
          </div>
        </div>
        <div className="gh-pk-hud-right">
          {hud.shield && <span className="gh-pk-buff gh-pk-buff--shield">护盾</span>}
          {hud.magnetMs > 0 && (
            <span className="gh-pk-buff gh-pk-buff--magnet">
              磁铁 {(hud.magnetMs / 1000).toFixed(1)}s
            </span>
          )}
          {hud.dashMs > 0 && (
            <span className="gh-pk-buff gh-pk-buff--dash">冲刺 {(hud.dashMs / 1000).toFixed(1)}s</span>
          )}
          {hud.combo > 1 && <span className="gh-pk-combo">×{hud.combo}</span>}
        </div>
      </div>

      {hud.dashMs > 0 && <div className="gh-pk-speedlines" aria-hidden />}

      <div className="gh-pk-pad" aria-label="跑酷触控操作">
        <div className="gh-pk-pad-group">
          <button
            type="button"
            className="gh-pk-pad-btn"
            aria-label="向左换道"
            onPointerDown={(event) => {
              event.preventDefault()
              lane(-1)
            }}
          >
            ←
          </button>
          <button
            type="button"
            className="gh-pk-pad-btn"
            aria-label="向右换道"
            onPointerDown={(event) => {
              event.preventDefault()
              lane(1)
            }}
          >
            →
          </button>
        </div>
        <div className="gh-pk-pad-group">
          <button
            type="button"
            className="gh-pk-pad-btn gh-pk-pad-btn--slide"
            aria-label="按住滑铲"
            onPointerDown={(event) => {
              event.preventDefault()
              slideDown()
            }}
            onPointerUp={slideUp}
            onPointerCancel={slideUp}
            onPointerLeave={slideUp}
          >
            滑铲
          </button>
          <button
            type="button"
            className="gh-pk-pad-btn gh-pk-pad-btn--jump"
            aria-label="跳跃"
            onPointerDown={(event) => {
              event.preventDefault()
              jump()
            }}
          >
            跳跃
          </button>
        </div>
      </div>

      {contextLost && (
        <div className="gh-pk-boot" role="alert">
          <strong>3D 渲染中断</strong>
          <p>浏览器暂时收回了 WebGL 上下文，正在等待恢复。</p>
          <button type="button" className="gh-btn gh-btn--primary" onClick={handleRetry}>
            重新加载画面
          </button>
        </div>
      )}
      {error && (
        <div className="gh-pk-boot" role="alert">
          <strong>3D 画面初始化失败</strong>
          <p>{error}</p>
          <button type="button" className="gh-btn gh-btn--primary" onClick={handleRetry}>
            重试
          </button>
        </div>
      )}
    </div>
  )
}
