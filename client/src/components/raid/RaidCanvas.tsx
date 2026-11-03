/**
 * 搜打撤对局舞台：实时引擎 + 60fps 循环 + 键鼠 / 双虚拟摇杆 + 横屏沉浸模式。
 *
 * 口径：
 *   - 画布铺满舞台，HUD 作为 children 叠在舞台上（浮层，不再占据画布下方一整块空间）；
 *   - 小地图改用舞台内的独立 canvas（`renderMinimap`），位置交给 CSS，
 *     这样手机横屏时摇杆、按钮不会再压在画布画的小地图上；
 *   - 引擎的 update 每帧都跑（阵亡后特效仍需衰减），暂停时整体冻结。
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { RaidEvent } from '../../lib/raid/raidRun'
import { RaidEngine, type RaidSnapshot } from '../../lib/raid/engine'
import { computeMetrics, renderMinimap, renderRaid } from '../../lib/raid/renderer'
import { createRaidInput, type RaidInputController } from '../../lib/raid/input'
import { useLowPerformanceMode } from '../../lib/performanceMode'
import type { RaidRun } from '../../types/petRaid'

interface RaidCanvasProps {
  initialRun: RaidRun
  species: string
  paused?: boolean
  onEngineReady: (engine: RaidEngine) => void
  onSnapshot: (snapshot: RaidSnapshot) => void
  onFlush: (events: RaidEvent[]) => void
  /** HUD 浮层（由页面传入，渲染在舞台内、画布之上） */
  children?: ReactNode
}

interface VirtualStickProps {
  className?: string
  label: string
  glyph: string
  onChange: (x: number, y: number, active: boolean) => void
}

function VirtualStick({ className, label, glyph, onChange }: VirtualStickProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const [active, setActive] = useState(false)
  const activeRef = useRef<number | null>(null)

  const update = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const element = ref.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const dx = event.clientX - cx
    const dy = event.clientY - cy
    const radius = rect.width * 0.38
    const dist = Math.hypot(dx, dy)
    const scale = dist > radius ? radius / dist : 1
    const nx = (dx * scale) / radius
    const ny = (dy * scale) / radius
    setKnob({ x: nx * radius, y: ny * radius })
    onChange(nx, ny, true)
  }

  const reset = (): void => {
    activeRef.current = null
    setKnob({ x: 0, y: 0 })
    setActive(false)
    onChange(0, 0, false)
  }

  return (
    <div
      ref={ref}
      className={`gh-raid-stick ${className ?? ''}${active ? ' is-active' : ''}`}
      role="presentation"
      onPointerDown={(event) => {
        activeRef.current = event.pointerId
        setActive(true)
        event.currentTarget.setPointerCapture(event.pointerId)
        update(event)
      }}
      onPointerMove={(event) => {
        if (activeRef.current !== event.pointerId) return
        update(event)
      }}
      onPointerUp={reset}
      onPointerCancel={reset}
    >
      <span className="gh-raid-stick-glyph" aria-hidden>{glyph}</span>
      <span className="gh-raid-stick-label" aria-hidden>{label}</span>
      <span
        className="gh-raid-stick-knob"
        style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
        aria-hidden
      />
    </div>
  )
}

export default function RaidCanvas({
  initialRun,
  species,
  paused = false,
  onEngineReady,
  onSnapshot,
  onFlush,
  children,
}: RaidCanvasProps) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const minimapRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<RaidEngine | null>(null)
  const inputRef = useRef<RaidInputController | null>(null)
  const metricsRef = useRef({ tile: 32, offsetX: 0, offsetY: 0, width: 800, height: 560 })
  const pausedRef = useRef(paused)
  const lowPerfRef = useRef(false)
  const callbacksRef = useRef({ onEngineReady, onSnapshot, onFlush })
  const [touchMode, setTouchMode] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 900
  })
  const [immersive, setImmersive] = useState(false)
  const [lowPerf] = useLowPerformanceMode()
  const [hint, setHint] = useState<'none' | 'rotate' | 'fullscreen'>('none')

  callbacksRef.current = { onEngineReady, onSnapshot, onFlush }
  pausedRef.current = paused
  lowPerfRef.current = lowPerf

  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)')
    const update = (): void => setTouchMode(query.matches || window.innerWidth < 900)
    query.addEventListener('change', update)
    window.addEventListener('resize', update)
    return () => {
      query.removeEventListener('change', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  // 手机竖屏时提示转横屏：竖屏里 HUD 浮层会把战斗画面压得很扁
  useEffect(() => {
    if (!touchMode) {
      setHint('none')
      return
    }
    const check = (): void => setHint(window.innerHeight > window.innerWidth ? 'rotate' : 'none')
    check()
    window.addEventListener('resize', check)
    window.addEventListener('orientationchange', check)
    return () => {
      window.removeEventListener('resize', check)
      window.removeEventListener('orientationchange', check)
    }
  }, [touchMode])

  // 沉浸模式：优先原生全屏，被禁用时（iOS Safari 不支持元素全屏）退化成 fixed 铺满
  useEffect(() => {
    const onChange = (): void => {
      const full = document.fullscreenElement || (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement
      if (!full && immersive && !stageRef.current?.classList.contains('is-fallback')) setImmersive(false)
    }
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('webkitfullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('webkitfullscreenchange', onChange)
    }
  }, [immersive])

  const toggleImmersive = (): void => {
    const stage = stageRef.current
    if (!stage) return
    const isFull = Boolean(document.fullscreenElement)
    if (isFull) {
      void Promise.resolve(document.exitFullscreen?.()).catch(() => undefined)
      stage.classList.remove('is-fallback')
      setImmersive(false)
      return
    }
    const request = stage.requestFullscreen ?? ((stage as HTMLElement & { webkitRequestFullscreen?: () => void }).webkitRequestFullscreen?.bind(stage))
    if (request) {
      try {
        const result = request() as unknown as Promise<void> | undefined
        setImmersive(true)
        void Promise.resolve(result).catch(() => {
          // 被权限策略拒绝时（iframe / 非用户手势）走 CSS 铺满，效果同样可用
          stage.classList.add('is-fallback')
          setImmersive(true)
        })
        const orientation = (screen as unknown as { orientation?: { lock?: (o: string) => Promise<void> } }).orientation
        orientation?.lock?.('landscape').catch(() => undefined)
        return
      } catch {
        /* 继续走降级 */
      }
    }
    stage.classList.toggle('is-fallback')
    setImmersive(stage.classList.contains('is-fallback'))
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const minimap = minimapRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const engine = new RaidEngine(initialRun, species)
    engineRef.current = engine
    if (import.meta.env.DEV) {
      ;(window as unknown as { __raidEngine?: RaidEngine }).__raidEngine = engine
    }
    callbacksRef.current.onEngineReady(engine)

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    let cssWidth = 0
    let cssHeight = 0

    const resize = (): void => {
      const rect = container.getBoundingClientRect()
      cssWidth = Math.max(320, rect.width)
      cssHeight = Math.max(220, rect.height)
      canvas.width = Math.round(cssWidth * dpr)
      canvas.height = Math.round(cssHeight * dpr)
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (minimap) {
        const miniRect = minimap.getBoundingClientRect()
        minimap.width = Math.round(Math.max(60, miniRect.width) * dpr)
        minimap.height = Math.round(Math.max(60, miniRect.height) * dpr)
        const mctx = minimap.getContext('2d')
        mctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
      metricsRef.current = computeMetrics(engine.map, engine.room, cssWidth, cssHeight)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    if (minimap) observer.observe(minimap)

    const input = createRaidInput(
      canvas,
      engine,
      () => metricsRef.current,
      {
        onInteract: () => engine.interact(),
        onSkill: (index) => engine.castSkill(index),
        onHeal: () => engine.useConsumable('heal'),
        onRepair: () => engine.useConsumable('repair'),
      },
    )
    inputRef.current = input

    let raf = 0
    let last = performance.now()
    let lastSnapshot = 0
    let lastFlush = 0
    let lastMinimap = 0
    const loop = (time: number): void => {
      const dt = Math.min(50, Math.max(0, time - last))
      last = time
      const now = Date.now()
      if (!pausedRef.current) engine.update(dt, now)
      metricsRef.current = computeMetrics(engine.map, engine.room, cssWidth, cssHeight)
      renderRaid(ctx, engine, cssWidth, cssHeight, now, { lowPerf: lowPerfRef.current })
      // 小地图独立 canvas：20fps 足够，省下的都是战斗帧预算
      if (now - lastMinimap >= 50) {
        lastMinimap = now
        const mctx = minimap?.getContext('2d')
        if (mctx && minimap) {
          const rect = minimap.getBoundingClientRect()
          renderMinimap(mctx, engine, now, rect.width, rect.height)
        }
      }
      if (now - lastSnapshot >= 100) {
        lastSnapshot = now
        callbacksRef.current.onSnapshot(engine.snapshot(now))
      }
      if (now - lastFlush >= 1500 && engine.hasPendingEvents()) {
        lastFlush = now
        callbacksRef.current.onFlush(engine.flushEvents())
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    const onVisibility = (): void => {
      if (document.hidden && engine.hasPendingEvents()) {
        callbacksRef.current.onFlush(engine.flushEvents())
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      cancelAnimationFrame(raf)
      observer.disconnect()
      input.dispose()
      inputRef.current = null
      engineRef.current = null
      if (import.meta.env.DEV) {
        delete (window as unknown as { __raidEngine?: RaidEngine }).__raidEngine
      }
    }
    // 只在首次挂载时创建引擎；对局内的服务端同步通过 applyServerRun 完成
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleMove = (x: number, y: number, active: boolean): void => {
    inputRef.current?.setMove(active ? x : 0, active ? y : 0)
  }

  const handleAim = (x: number, y: number, active: boolean): void => {
    const engine = engineRef.current
    if (!engine) return
    if (!active || Math.hypot(x, y) < 0.25) {
      inputRef.current?.setFiring(false)
      return
    }
    const len = Math.hypot(x, y) || 1
    const nx = x / len
    const ny = y / len
    inputRef.current?.setAim(engine.player.x + nx * 5, engine.player.y + ny * 5)
    inputRef.current?.setFiring(true)
  }

  return (
    <div
      ref={stageRef}
      className={`gh-raid-stage${immersive ? ' is-immersive' : ''}${touchMode ? ' is-touch' : ' is-desktop'}`}
      data-layout={touchMode ? 'touch' : 'desktop'}
    >
      <div ref={containerRef} className="gh-raid-canvas-wrap">
        <canvas ref={canvasRef} className="gh-raid-canvas" aria-label="搜打撤对局画面" />
      </div>

      <div className="gh-raid-overlay">
        {/* 小地图浮层：位置完全交给 CSS，战斗画面不再被画上去的小地图占位 */}
        <div className="gh-raid-pod gh-raid-pod--map">
          <div className="gh-raid-pod-title">
            <span>TACMAP</span>
            <b>{initialRun.mapName}</b>
          </div>
          <canvas ref={minimapRef} className="gh-raid-minimap" aria-hidden />
        </div>

        {children}

        <div className="gh-raid-toolbar">
          <button type="button" className={`gh-raid-tool${immersive ? ' is-on' : ''}`} onClick={toggleImmersive}>
            {immersive ? '退出横屏' : '横屏沉浸'}
          </button>
          <button type="button" className="gh-raid-tool" onClick={() => setHint(hint === 'none' ? 'fullscreen' : 'none')}>
            操作提示
          </button>
        </div>
      </div>

      {touchMode && (
        <div className="gh-raid-touch">
          <VirtualStick className="gh-raid-stick--move" label="移动" glyph="✥" onChange={handleMove} />
          <VirtualStick className="gh-raid-stick--aim" label="射击" glyph="◎" onChange={handleAim} />
        </div>
      )}

      {hint === 'rotate' && (
        <div className="gh-raid-hint">
          <strong>请旋转手机横屏游玩</strong>
          <span>竖屏下战斗区域过小，横屏并进入「横屏沉浸」后 HUD 才不会压住画面</span>
          <button type="button" onClick={() => setHint('none')}>知道了</button>
        </div>
      )}
      {hint === 'fullscreen' && (
        <div className="gh-raid-hint">
          <strong>操作方式</strong>
          <span>
            {touchMode
              ? '左摇杆移动 · 右摇杆瞄准并开火 · 右侧圆形按钮：技能 1/2/3、治疗、维修、E 交互'
              : 'WASD 移动 · 鼠标瞄准并点击开火 · E 交互 · 1 / 2 / 3 技能 · Q 治疗 · F 维修'}
          </span>
          <button type="button" onClick={() => setHint('none')}>关闭</button>
        </div>
      )}
    </div>
  )
}
