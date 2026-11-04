/**
 * 搜打撤对局舞台：实时引擎 + 自适应帧率 + 键鼠 / 双虚拟摇杆 + 横屏沉浸模式。
 *
 * 兼容性口径（2026-11）：
 *   - 旧 Android WebView / iOS Safari 没有 ResizeObserver、matchMedia().addEventListener、
 *     PointerEvent：全部做特性检测与降级，任何一项缺失都不会让对局初始化失败。
 *   - 画质分 high / balanced / low：低画质降 DPR、锁 30fps、减少粒子与环境特效，
 *     但技能特效与出口箭头保留。帧耗时连续超标会自动降档。
 *   - 竖屏会提示旋转横屏；平板横屏（iPad 1024×768 等）按触屏布局渲染。
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react'
import type { RaidEvent } from '../../lib/raid/raidRun'
import { RaidEngine, type RaidSnapshot } from '../../lib/raid/engine'
import { onTap } from '../../lib/raid/tap'
import { computeMetrics, renderMinimap, renderRaid, type RaidRenderQuality } from '../../lib/raid/renderer'
import { createRaidInput, type RaidInputController } from '../../lib/raid/input'
import { useLowPerformanceMode } from '../../lib/performanceMode'
import { onMediaQueryChange } from '../../lib/mediaQuery'
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

const SUPPORTS_POINTER = typeof window !== 'undefined' && 'PointerEvent' in window

const QUALITY_LABELS: Record<RaidRenderQuality, string> = {
  high: '画质 高',
  balanced: '画质 均衡',
  low: '画质 省电',
}

function detectQuality(lowPerf: boolean): RaidRenderQuality {
  if (lowPerf) return 'low'
  if (typeof navigator === 'undefined') return 'balanced'
  // 旧内核直接省电档：inset 是最可靠的「Chrome < 87 / Safari < 14」探针
  try {
    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && !CSS.supports('inset', '0px')) {
      return 'low'
    }
  } catch {
    /* 忽略 */
  }
  const ua = navigator.userAgent
  const chrome = /Chrome\/(\d+)/.exec(ua)
  if (chrome && Number(chrome[1]) < 80) return 'low'
  const ios = /OS (\d+)_/.exec(ua)
  if (ios && Number(ios[1]) < 13) return 'low'
  const cores = navigator.hardwareConcurrency ?? 4
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
  const coarse = typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches
    : false
  if (cores <= 4 || memory <= 3) return coarse ? 'low' : 'balanced'
  if (coarse) {
    // 平板（触屏 + 大屏）像素填充量约是手机 3 倍，直接走省电档；手机维持均衡档
    const wide = window.innerWidth >= 1024 || window.innerHeight >= 1024
    return wide ? 'low' : 'balanced'
  }
  return 'high'
}

function dprForQuality(quality: RaidRenderQuality): number {
  const raw = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  if (quality === 'low') return Math.min(1, raw)
  if (quality === 'balanced') return Math.min(1.5, raw)
  return Math.min(2, raw)
}

function VirtualStick({ className, label, glyph, onChange }: VirtualStickProps) {
  const zoneRef = useRef<HTMLDivElement | null>(null)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null)
  const [active, setActive] = useState(false)
  const activeRef = useRef<number | null>(null)
  const originRef = useRef<{ x: number; y: number } | null>(null)
  /** 摇杆有效半径（与 CSS 的底盘尺寸 112px 对应的一半再略收） */
  const radius = 54

  /** 摇杆跟随手指：手指超出半径时底盘整体向手指方向漂移，knob 始终贴在圆缘 */
  const updatePoint = (clientX: number, clientY: number): void => {
    const base = originRef.current
    if (!base) return
    let dx = clientX - base.x
    let dy = clientY - base.y
    const dist = Math.hypot(dx, dy)
    if (dist > radius && dist > 0.0001) {
      const drift = dist - radius
      const nx = dx / dist
      const ny = dy / dist
      const next = { x: base.x + nx * drift, y: base.y + ny * drift }
      originRef.current = next
      setOrigin(next)
      dx = nx * radius
      dy = ny * radius
    }
    setKnob({ x: dx, y: dy })
    onChange(dx / radius, dy / radius, true)
  }

  const reset = (): void => {
    activeRef.current = null
    originRef.current = null
    setOrigin(null)
    setKnob({ x: 0, y: 0 })
    setActive(false)
    onChange(0, 0, false)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (activeRef.current !== null) return
    activeRef.current = event.pointerId
    const base = { x: event.clientX, y: event.clientY }
    originRef.current = base
    setOrigin(base)
    setActive(true)
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      /* 旧内核不支持指针捕获：不影响拖动 */
    }
    updatePoint(event.clientX, event.clientY)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (activeRef.current !== event.pointerId) return
    updatePoint(event.clientX, event.clientY)
  }

  const onTouchStart = (event: ReactTouchEvent<HTMLDivElement>): void => {
    if (activeRef.current !== null) return
    const touch = event.changedTouches[0]
    if (!touch) return
    activeRef.current = touch.identifier
    const base = { x: touch.clientX, y: touch.clientY }
    originRef.current = base
    setOrigin(base)
    setActive(true)
    updatePoint(touch.clientX, touch.clientY)
  }

  const onTouchMove = (event: ReactTouchEvent<HTMLDivElement>): void => {
    const touches = Array.from(event.touches)
    const touch = touches.find((entry) => entry.identifier === activeRef.current)
    if (!touch) return
    updatePoint(touch.clientX, touch.clientY)
  }

  const onTouchEnd = (): void => reset()

  return (
    <div
      ref={zoneRef}
      className={`gh-raid-stick-zone ${className ?? ''}${active ? ' is-active' : ''}`}
      role="presentation"
      onPointerDown={SUPPORTS_POINTER ? onPointerDown : undefined}
      onPointerMove={SUPPORTS_POINTER ? onPointerMove : undefined}
      onPointerUp={SUPPORTS_POINTER ? reset : undefined}
      onPointerCancel={SUPPORTS_POINTER ? reset : undefined}
      onTouchStart={SUPPORTS_POINTER ? undefined : onTouchStart}
      onTouchMove={SUPPORTS_POINTER ? undefined : onTouchMove}
      onTouchEnd={SUPPORTS_POINTER ? undefined : onTouchEnd}
      onTouchCancel={SUPPORTS_POINTER ? undefined : onTouchEnd}
    >
      {active && origin ? (
        <div
          className="gh-raid-stick is-floating"
          style={{ left: origin.x, top: origin.y }}
        >
          <span className="gh-raid-stick-glyph" aria-hidden>{glyph}</span>
          <span className="gh-raid-stick-label" aria-hidden>{label}</span>
          <span
            className="gh-raid-stick-knob"
            style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
            aria-hidden
          />
        </div>
      ) : (
        <div className="gh-raid-stick is-idle">
          <span className="gh-raid-stick-glyph" aria-hidden>{glyph}</span>
          <span className="gh-raid-stick-label" aria-hidden>{label}</span>
        </div>
      )}
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
  const requestResizeRef = useRef<() => void>(() => {})
  const metricsRef = useRef({ tile: 32, offsetX: 0, offsetY: 0, width: 800, height: 560 })
  const pausedRef = useRef(paused)
  const callbacksRef = useRef({ onEngineReady, onSnapshot, onFlush })
  const [touchMode, setTouchMode] = useState(() => {
    if (typeof window === 'undefined') return false
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
    return Boolean(coarse) || window.innerWidth < 900
  })
  const touchModeRef = useRef(touchMode)
  touchModeRef.current = touchMode
  const [immersive, setImmersive] = useState(false)
  const [lowPerf] = useLowPerformanceMode()
  const [quality, setQuality] = useState<RaidRenderQuality>(() => detectQuality(false))
  const qualityRef = useRef<RaidRenderQuality>(quality)
  const manualQualityRef = useRef(false)
  const [hint, setHint] = useState<'none' | 'rotate' | 'fullscreen'>('none')

  callbacksRef.current = { onEngineReady, onSnapshot, onFlush }
  pausedRef.current = paused
  qualityRef.current = quality

  // 用户手动切换 / 系统低性能模式：手动选择后不再自动降档
  useEffect(() => {
    manualQualityRef.current = false
    setQuality(lowPerf ? 'low' : detectQuality(false))
  }, [lowPerf])

  useEffect(() => {
    const query = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null
    const update = (): void => setTouchMode(Boolean(query?.matches) || window.innerWidth < 900)
    const off = onMediaQueryChange('(pointer: coarse)', update)
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    update()
    return () => {
      off()
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  // 触屏自动锁敌开关跟随触屏模式（引擎在挂载 effect 中创建，这里兜底同步）
  useEffect(() => {
    if (engineRef.current) engineRef.current.aimAssist = touchMode
  }, [touchMode])

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
      // 进入 / 退出全屏后舞台尺寸变化，但旧内核没有 ResizeObserver，需要显式重排画布
      window.setTimeout(() => requestResizeRef.current(), 60)
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
    // 双前缀判定真全屏：iPad Safari 等纯 webkit 环境只认 webkitFullscreenElement，
    // 只看标准 API 会把「已全屏」误判成「未全屏」，导致永远退不出去。
    const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void }
    const isFull = Boolean(document.fullscreenElement || doc.webkitFullscreenElement)
    // CSS 降级全屏（requestFullscreen 存在但被权限策略拒绝的环境）：直接还原，
    // 绝不重试 request——重试会再次被拒、再次进降级，形成「按退出反而刷新全屏」的死循环。
    if (stage.classList.contains('is-fallback') || (immersive && !isFull)) {
      stage.classList.remove('is-fallback')
      setImmersive(false)
      const orientation = (screen as unknown as { orientation?: { unlock?: () => void } }).orientation
      try {
        orientation?.unlock?.()
      } catch {
        /* 旧内核没有该 API */
      }
      window.setTimeout(() => requestResizeRef.current(), 60)
      return
    }
    if (isFull) {
      // 退出同样要双前缀兜底：webkit 环境没有 exitFullscreen，得走 webkitExitFullscreen
      if (typeof document.exitFullscreen === 'function') {
        void Promise.resolve(document.exitFullscreen()).catch(() => undefined)
      } else {
        doc.webkitExitFullscreen?.()
      }
      stage.classList.remove('is-fallback')
      setImmersive(false)
      const orientation = (screen as unknown as { orientation?: { unlock?: () => void } }).orientation
      try {
        orientation?.unlock?.()
      } catch {
        /* 旧内核没有该 API */
      }
      window.setTimeout(() => requestResizeRef.current(), 60)
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
        try {
          orientation?.lock?.('landscape').catch(() => undefined)
        } catch {
          /* 旧内核没有锁屏 API */
        }
        return
      } catch {
        /* 继续走降级 */
      }
    }
    stage.classList.toggle('is-fallback')
    setImmersive(stage.classList.contains('is-fallback'))
    window.setTimeout(() => requestResizeRef.current(), 60)
  }

  const cycleQuality = (): void => {
    manualQualityRef.current = true
    const order: RaidRenderQuality[] = ['high', 'balanced', 'low']
    const next = order[(order.indexOf(qualityRef.current) + 1) % order.length] ?? 'balanced'
    setQuality(next)
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
    engine.aimAssist = touchModeRef.current
    engine.setCosmeticLevel(qualityRef.current)
    if (import.meta.env.DEV) {
      ;(window as unknown as { __raidEngine?: RaidEngine }).__raidEngine = engine
      // 调试钩子：IAB 等环境可能暂停 rAF，用它可以手动推进并重绘
      ;(window as unknown as { __raidRender?: typeof renderRaid }).__raidRender = renderRaid
    }
    callbacksRef.current.onEngineReady(engine)

    let cssWidth = 0
    let cssHeight = 0
    let activeDpr = dprForQuality(qualityRef.current)

    const resize = (): void => {
      const rect = container.getBoundingClientRect()
      cssWidth = Math.max(320, rect.width)
      cssHeight = Math.max(220, rect.height)
      const desired = dprForQuality(qualityRef.current)
      if (desired !== activeDpr) activeDpr = desired
      canvas.width = Math.round(cssWidth * activeDpr)
      canvas.height = Math.round(cssHeight * activeDpr)
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`
      ctx.setTransform(activeDpr, 0, 0, activeDpr, 0, 0)
      if (minimap) {
        const miniRect = minimap.getBoundingClientRect()
        minimap.width = Math.round(Math.max(60, miniRect.width) * activeDpr)
        minimap.height = Math.round(Math.max(60, miniRect.height) * activeDpr)
        const mctx = minimap.getContext('2d')
        mctx?.setTransform(activeDpr, 0, 0, activeDpr, 0, 0)
      }
      metricsRef.current = computeMetrics(engine.map, engine.room, cssWidth, cssHeight)
    }
    resize()
    let rafResize = 0
    let fallbackResizeTimer = 0
    let resizeObserver: ResizeObserver | null = null
    const scheduleResize = (): void => {
      if (rafResize) return
      rafResize = window.requestAnimationFrame(() => {
        rafResize = 0
        resize()
      })
    }
    requestResizeRef.current = scheduleResize
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(scheduleResize)
      resizeObserver.observe(container)
      if (minimap) resizeObserver.observe(minimap)
    } else {
      // 旧 WebView：没有 ResizeObserver，退化成窗口尺寸 / 旋转监听
      window.addEventListener('resize', scheduleResize)
      window.addEventListener('orientationchange', scheduleResize)
      fallbackResizeTimer = window.setTimeout(scheduleResize, 120)
    }

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
    let lastRender = 0
    let lastSnapshot = 0
    let lastFlush = 0
    let lastMinimap = 0
    let lastQuality = qualityRef.current
    let slowdownAccum = 0
    let slowdownCount = 0
    let lastDowngradeAt = performance.now()

    const loop = (time: number): void => {
      const dt = Math.min(50, Math.max(0, time - last))
      last = time
      const now = Date.now()
      if (!pausedRef.current) engine.update(dt, now)
      metricsRef.current = computeMetrics(engine.map, engine.room, cssWidth, cssHeight)

      const currentQuality = qualityRef.current
      if (currentQuality !== lastQuality) {
        lastQuality = currentQuality
        engine.setCosmeticLevel(currentQuality)
        resize()
      }
      const targetInterval = currentQuality === 'low' ? 32 : 0
      if (!pausedRef.current && (targetInterval === 0 || time - lastRender >= targetInterval)) {
        const renderStart = performance.now()
        renderRaid(ctx, engine, cssWidth, cssHeight, now, {
          quality: currentQuality,
          dpr: activeDpr,
        })
        const renderCost = performance.now() - renderStart
        lastRender = time
        // 自动降档：连续 90 帧渲染耗时偏高时降一级，避免旧设备卡成幻灯片
        if (!manualQualityRef.current && currentQuality !== 'low' && time - lastDowngradeAt > 2500) {
          slowdownAccum += renderCost
          slowdownCount += 1
          if (slowdownCount >= 90) {
            const avg = slowdownAccum / slowdownCount
            slowdownAccum = 0
            slowdownCount = 0
            if (avg > (currentQuality === 'high' ? 15 : 22)) {
              lastDowngradeAt = time
              setQuality(currentQuality === 'high' ? 'balanced' : 'low')
            }
          }
        }
      }

      if (!pausedRef.current && now - lastMinimap >= (currentQuality === 'low' ? 180 : 80)) {
        lastMinimap = now
        const mctx = minimap?.getContext('2d')
        if (mctx && minimap) {
          const rect = minimap.getBoundingClientRect()
          renderMinimap(mctx, engine, now, rect.width, rect.height)
        }
      }
      const snapshotInterval = currentQuality === 'low' ? 220 : currentQuality === 'balanced' ? 140 : 110
      if (now - lastSnapshot >= snapshotInterval) {
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
      if (rafResize) cancelAnimationFrame(rafResize)
      if (fallbackResizeTimer) window.clearTimeout(fallbackResizeTimer)
      resizeObserver?.disconnect()
      requestResizeRef.current = () => {}
      if (!resizeObserver) {
        window.removeEventListener('resize', scheduleResize)
        window.removeEventListener('orientationchange', scheduleResize)
      }
      input.dispose()
      inputRef.current = null
      engineRef.current = null
      if (import.meta.env.DEV) {
        delete (window as unknown as { __raidEngine?: RaidEngine }).__raidEngine
        delete (window as unknown as { __raidRender?: typeof renderRaid }).__raidRender
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
      data-quality={quality}
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
          <button type="button" className="gh-raid-tool" {...onTap(cycleQuality)}>
            {QUALITY_LABELS[quality]}
          </button>
          <button type="button" className={`gh-raid-tool${immersive ? ' is-on' : ''}`} {...onTap(toggleImmersive)}>
            {immersive ? '退出横屏' : '横屏沉浸'}
          </button>
          <button type="button" className="gh-raid-tool" {...onTap(() => setHint(hint === 'none' ? 'fullscreen' : 'none'))}>
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
              ? '左摇杆移动 · 右摇杆瞄准并开火 · 右侧按钮：技能 1/2/3、治疗、维修、E 交互 · 左上「背包」可整理物资'
              : 'WASD 移动 · 鼠标瞄准并点击开火 · E 交互 · 1 / 2 / 3 技能 · Q 治疗 · F 维修 · B 背包'}
          </span>
          <button type="button" onClick={() => setHint('none')}>关闭</button>
        </div>
      )}
    </div>
  )
}
