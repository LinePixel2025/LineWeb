/**
 * 搜打撤对局画布：创建实时引擎、驱动 60fps 循环、渲染房间、处理键鼠与手机虚拟摇杆。
 *
 * 页面职责：拿到 onEngineReady 的引擎实例后周期上报事件（engine.flushEvents 由本组件按时调用），
 * 并把服务端返回的 run 通过 engine.applyServerRun 同步回本地。
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { RaidEvent } from '../../lib/raid/raidRun'
import { RaidEngine, type RaidSnapshot } from '../../lib/raid/engine'
import { computeMetrics, renderRaid } from '../../lib/raid/renderer'
import { createRaidInput, type RaidInputController } from '../../lib/raid/input'
import type { RaidRun } from '../../types/petRaid'

interface RaidCanvasProps {
  initialRun: RaidRun
  species: string
  paused?: boolean
  onEngineReady: (engine: RaidEngine) => void
  onSnapshot: (snapshot: RaidSnapshot) => void
  onFlush: (events: RaidEvent[]) => void
}

interface VirtualStickProps {
  className?: string
  label: string
  onChange: (x: number, y: number, active: boolean) => void
}

function VirtualStick({ className, label, onChange }: VirtualStickProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
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
    onChange(0, 0, false)
  }

  return (
    <div
      ref={ref}
      className={`gh-raid-stick ${className ?? ''}`}
      role="presentation"
      onPointerDown={(event) => {
        activeRef.current = event.pointerId
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
}: RaidCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<RaidEngine | null>(null)
  const inputRef = useRef<RaidInputController | null>(null)
  const metricsRef = useRef({ tile: 32, offsetX: 0, offsetY: 0, width: 800, height: 560 })
  const pausedRef = useRef(paused)
  const callbacksRef = useRef({ onEngineReady, onSnapshot, onFlush })
  const [touchMode, setTouchMode] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 900
  })

  callbacksRef.current = { onEngineReady, onSnapshot, onFlush }
  pausedRef.current = paused

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

  useEffect(() => {
    const canvas = canvasRef.current
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
      metricsRef.current = computeMetrics(engine.map, engine.room, cssWidth, cssHeight)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(container)

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
    const loop = (time: number): void => {
      const dt = Math.min(50, Math.max(0, time - last))
      last = time
      const now = Date.now()
      if (!pausedRef.current && !engine.dead && !engine.ended) {
        engine.update(dt, now)
      }
      metricsRef.current = computeMetrics(engine.map, engine.room, cssWidth, cssHeight)
      renderRaid(ctx, engine, cssWidth, cssHeight, now)
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
    <div ref={containerRef} className="gh-raid-canvas-wrap">
      <canvas ref={canvasRef} className="gh-raid-canvas" aria-label="搜打撤对局画面" />
      {touchMode && (
        <div className="gh-raid-touch">
          <VirtualStick className="gh-raid-stick--move" label="移动" onChange={handleMove} />
          <VirtualStick className="gh-raid-stick--aim" label="射击" onChange={handleAim} />
          <div className="gh-raid-touch-actions">
            <button type="button" className="gh-raid-touch-btn" onClick={() => inputRef.current?.pressInteract()}>E</button>
            <button type="button" className="gh-raid-touch-btn" onClick={() => inputRef.current?.pressHeal()}>💊</button>
            <button type="button" className="gh-raid-touch-btn" onClick={() => inputRef.current?.pressRepair()}>🛠</button>
            <div className="gh-raid-touch-skills">
              {[0, 1, 2].map((index) => (
                <button
                  key={index}
                  type="button"
                  className="gh-raid-touch-btn gh-raid-touch-btn--skill"
                  onClick={() => inputRef.current?.pressSkill(index)}
                >
                  {index + 1}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
