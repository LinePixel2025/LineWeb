import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import { useTheme } from '../../contexts/ThemeContext'
import { GAME_SNAKE_ONLINE_ROUTE } from '../../lib/games/catalog'
import {
  SNAKE_COLORS,
  SNAKE_DEAD_COLOR,
  SNAKE_MIN_STEP_MS,
  SNAKE_SPEED_LEVELS,
  SNAKE_SPEED_ORDER,
  SNAKE_VERSUS_SIZE,
  createSoloSnakeState,
  createVersusSnakeState,
  directionDelta,
  loadSnakeBest,
  loadVersusRecord,
  randomSnakeSeed,
  saveSnakeBest,
  saveVersusResult,
  setSoloBaseSpeed,
  setSoloDirection,
  setVersusBaseSpeed,
  setVersusDirection,
  snakeColorForSeat,
  stepSoloSnake,
  stepVersusSnake,
  type SnakeDirection,
  type SnakeFood,
  type SnakePoint,
  type SnakeSpeedLevel,
  type SoloSnakeState,
  type VersusRecord,
  type VersusSnakeState,
} from '../../lib/games/snake'

/** 页面模式：单机冲分 / 同屏双人 */
type SnakeMode = 'solo' | 'versus'

/** 棋盘画布布局（CSS 像素，已按格子取整） */
interface BoardLayout {
  css: number
  cell: number
  dpr: number
}

/** 单条蛇的渲染入参（点为网格坐标，插值动画后传入像素级坐标） */
interface RenderSnake {
  points: SnakePoint[]
  color: string
  alive: boolean
  /** 蛇头朝向，用于画眼睛 */
  direction: SnakeDirection
}

interface BoardPalette {
  board: string
  grid: string
  border: string
  food: string
  gold: string
  goldGlow: string
  eye: string
  eyeWhite: string
}

const MAX_BOARD_CSS = 640
const MIN_BOARD_CSS = 240

function paletteFor(dark: boolean): BoardPalette {
  return dark
    ? {
        board: '#0b1220',
        grid: 'rgba(240, 246, 252, 0.05)',
        border: '#30363d',
        food: '#f85149',
        gold: '#f5c518',
        goldGlow: 'rgba(245, 197, 24, 0.35)',
        eye: '#0b1220',
        eyeWhite: '#f0f6fc',
      }
    : {
        board: '#f6f8fa',
        grid: 'rgba(31, 35, 40, 0.07)',
        border: '#d1d9e0',
        food: '#cf222e',
        gold: '#b08800',
        goldGlow: 'rgba(176, 136, 0, 0.28)',
        eye: '#1f2328',
        eyeWhite: '#ffffff',
      }
}

/** 圆角矩形路径（不依赖 ctx.roundRect 兼容性） */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

/** 绘制棋盘底色与网格底纹 */
function drawGridBackground(
  ctx: CanvasRenderingContext2D,
  size: number,
  layout: BoardLayout,
  palette: BoardPalette
): void {
  const { cell } = layout
  ctx.fillStyle = palette.board
  ctx.fillRect(0, 0, cell * size, cell * size)

  ctx.strokeStyle = palette.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 1; i < size; i += 1) {
    const offset = Math.round(i * cell) + 0.5
    ctx.moveTo(offset, 0)
    ctx.lineTo(offset, cell * size)
    ctx.moveTo(0, offset)
    ctx.lineTo(cell * size, offset)
  }
  ctx.stroke()

  ctx.strokeStyle = palette.border
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, cell * size - 1, cell * size - 1)
}

/** 绘制果实（普通果圆点、金果带光晕与脉动） */
function drawFoods(
  ctx: CanvasRenderingContext2D,
  foods: SnakeFood[],
  layout: BoardLayout,
  palette: BoardPalette,
  time: number
): void {
  const { cell } = layout
  for (const food of foods) {
    const cx = (food.x + 0.5) * cell
    const cy = (food.y + 0.5) * cell
    if (food.big) {
      const pulse = 0.5 + 0.5 * Math.sin(time / 220)
      const glowRadius = cell * (0.95 + pulse * 0.35)
      const gradient = ctx.createRadialGradient(cx, cy, cell * 0.2, cx, cy, glowRadius)
      gradient.addColorStop(0, palette.goldGlow)
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = palette.gold
      ctx.beginPath()
      ctx.arc(cx, cy, cell * (0.34 + pulse * 0.04), 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillStyle = palette.food
      ctx.beginPath()
      ctx.arc(cx, cy, cell * 0.3, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

/** 绘制一条蛇：圆角矩形蛇身 + 蛇头眼睛 */
function drawSnake(
  ctx: CanvasRenderingContext2D,
  snake: RenderSnake,
  layout: BoardLayout,
  palette: BoardPalette
): void {
  const { cell } = layout
  const inset = Math.max(1, cell * 0.09)
  const color = snake.alive ? snake.color : SNAKE_DEAD_COLOR

  ctx.globalAlpha = snake.alive ? 1 : 0.62
  snake.points.forEach((point, index) => {
    const x = point.x * cell + inset
    const y = point.y * cell + inset
    const side = cell - inset * 2
    // 蛇头最亮，身体往尾部逐节变淡，层次更清楚；出局蛇整体变灰
    ctx.fillStyle = color
    ctx.globalAlpha = snake.alive ? Math.max(0.6, 1 - index * 0.015) : 0.45
    roundRectPath(ctx, x, y, side, side, cell * 0.3)
    ctx.fill()
  })

  ctx.globalAlpha = 1

  const head = snake.points[0]
  if (!head) return
  const delta = directionDelta(snake.direction)
  const cx = (head.x + 0.5) * cell
  const cy = (head.y + 0.5) * cell
  const px = -delta.y
  const py = delta.x
  const forward = cell * 0.2
  const lateral = cell * 0.17
  for (const sign of [1, -1]) {
    const ex = cx + delta.x * forward + px * lateral * sign
    const ey = cy + delta.y * forward + py * lateral * sign
    ctx.fillStyle = snake.alive ? palette.eyeWhite : SNAKE_DEAD_COLOR
    ctx.beginPath()
    ctx.arc(ex, ey, cell * 0.13, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = palette.eye
    ctx.beginPath()
    ctx.arc(ex + delta.x * cell * 0.03, ey + delta.y * cell * 0.03, cell * 0.065, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** 清空画布并按 DPR 建立 CSS 像素坐标系 */
function prepareContext(
  canvas: HTMLCanvasElement,
  layout: BoardLayout
): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(layout.dpr, 0, 0, layout.dpr, 0, 0)
  ctx.clearRect(0, 0, layout.css, layout.css)
  return ctx
}

/**
 * 棋盘主循环：requestAnimationFrame + 固定步长累加器。
 * getStepMs() 返回 <= 0 表示暂停（不再推进，但仍然重绘）。
 */
function useBoardLoop(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  wrapRef: RefObject<HTMLDivElement | null>,
  handlers: {
    getSize: () => number
    getStepMs: () => number
    onStep: () => void
    onDraw: (time: number, layout: BoardLayout) => void
  }
): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const layoutRef = useRef<BoardLayout>({ css: MIN_BOARD_CSS, cell: 12, dpr: 1 })

  // 尺寸自适应：容器宽度变化时重算格子边长（整除，避免半格）
  useEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current
      const canvas = canvasRef.current
      if (!wrap || !canvas) return
      const size = Math.max(8, handlersRef.current.getSize())
      const available = Math.max(MIN_BOARD_CSS, Math.floor(wrap.clientWidth || MIN_BOARD_CSS))
      const capped = Math.min(available, MAX_BOARD_CSS)
      const cell = Math.max(6, Math.floor(capped / size))
      const css = cell * size
      const dpr = Math.min(3, Math.max(1, Math.round((window.devicePixelRatio || 1) * 100) / 100))
      layoutRef.current = { css, cell, dpr }
      canvas.style.width = `${css}px`
      canvas.style.height = `${css}px`
      canvas.width = Math.round(css * dpr)
      canvas.height = Math.round(css * dpr)
    }

    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      if (wrapRef.current) observer.observe(wrapRef.current)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [canvasRef, wrapRef])

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let accumulator = 0

    const frame = (time: number) => {
      raf = requestAnimationFrame(frame)
      // 标签页切回时 dt 可能很大，做一次钳制，避免瞬间追进多步
      const delta = Math.min(250, time - last)
      last = time
      const stepMs = handlersRef.current.getStepMs()
      if (stepMs > 0) {
        accumulator += delta
        let guard = 0
        while (accumulator >= stepMs && guard < 6) {
          accumulator -= stepMs
          guard += 1
          handlersRef.current.onStep()
          if (handlersRef.current.getStepMs() <= 0) {
            accumulator = 0
            break
          }
        }
      } else {
        accumulator = 0
      }
      handlersRef.current.onDraw(time, layoutRef.current)
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])
}

/** 表单类元素上的按键不应触发蛇的移动 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** 焦点在按钮 / 链接上时，空格与回车交给该控件，避免重复触发 */
function isActionTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'BUTTON' || tag === 'A' || target.getAttribute('role') === 'button'
}

const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

/** 单机按键：方向键 + WASD */
const SOLO_KEY_MAP: Record<string, SnakeDirection | undefined> = {
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

/** 同屏双人按键：P1 用 WASD，P2 用方向键 */
const VERSUS_KEY_MAP: Array<{ keys: Record<string, SnakeDirection>; player: 0 | 1 }> = [
  {
    player: 0,
    keys: { w: 'up', W: 'up', s: 'down', S: 'down', a: 'left', A: 'left', d: 'right', D: 'right' },
  },
  {
    player: 1,
    keys: { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' },
  },
]

const SWIPE_THRESHOLD = 24

function directionFromDelta(dx: number, dy: number): SnakeDirection | null {
  if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return null
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'down' : 'up'
}

/** 移动端滑动改向的触摸处理器 */
function useSwipeDirection(
  wrapRef: RefObject<HTMLDivElement | null>,
  onDirection: (direction: SnakeDirection) => void,
  enabled: boolean
): void {
  const callbackRef = useRef(onDirection)
  callbackRef.current = onDirection
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  useEffect(() => {
    const node = wrapRef.current
    if (!node) return
    let origin: { x: number; y: number } | null = null

    const handleStart = (event: TouchEvent) => {
      const point = event.touches[0]
      origin = point ? { x: point.clientX, y: point.clientY } : null
    }
    const handleEnd = (event: TouchEvent) => {
      if (!origin || !enabledRef.current) {
        origin = null
        return
      }
      const point = event.changedTouches[0]
      const start = origin
      origin = null
      if (!point) return
      const direction = directionFromDelta(point.clientX - start.x, point.clientY - start.y)
      if (direction) {
        event.preventDefault()
        callbackRef.current(direction)
      }
    }
    const handleMove = (event: TouchEvent) => {
      // 棋盘上滑动不滚页
      if (origin) event.preventDefault()
    }
    const handleCancel = () => {
      origin = null
    }

    node.addEventListener('touchstart', handleStart, { passive: true })
    node.addEventListener('touchmove', handleMove, { passive: false })
    node.addEventListener('touchend', handleEnd, { passive: false })
    node.addEventListener('touchcancel', handleCancel)
    return () => {
      node.removeEventListener('touchstart', handleStart)
      node.removeEventListener('touchmove', handleMove)
      node.removeEventListener('touchend', handleEnd)
      node.removeEventListener('touchcancel', handleCancel)
    }
  }, [wrapRef])
}

// ==================== 单机棋盘 ====================

interface SoloHud {
  score: number
  length: number
  eaten: number
  stepMs: number
  alive: boolean
}

function SoloBoard({ speedMs, dark }: { speedMs: number; dark: boolean }) {
  // useState 初始化函数只跑一次，避免每次渲染都新建局面对象
  const [initialSolo] = useState(() => createSoloSnakeState({ speedMs, seed: randomSnakeSeed() }))
  const stateRef = useRef<SoloSnakeState>(initialSolo)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const pausedRef = useRef(false)
  const darkRef = useRef(dark)
  darkRef.current = dark

  const [hud, setHud] = useState<SoloHud>(() => snapshotSoloHud(stateRef.current))
  const [paused, setPaused] = useState(false)
  const [best, setBest] = useState(() => loadSnakeBest())
  const [isRecord, setIsRecord] = useState(false)

  const bestRef = useRef(best)
  bestRef.current = best

  useEffect(() => {
    setSoloBaseSpeed(stateRef.current, speedMs)
    syncSoloHud(stateRef.current, setHud)
  }, [speedMs])

  const sync = useCallback(() => syncSoloHud(stateRef.current, setHud), [])

  const handleDirection = useCallback(
    (direction: SnakeDirection) => {
      if (pausedRef.current) return
      if (setSoloDirection(stateRef.current, direction)) sync()
    },
    [sync]
  )

  const togglePause = useCallback(() => {
    const state = stateRef.current
    if (!state.alive) return
    pausedRef.current = !pausedRef.current
    setPaused(pausedRef.current)
  }, [])

  const restart = useCallback(() => {
    stateRef.current = createSoloSnakeState({
      size: stateRef.current.size,
      speedMs,
      seed: randomSnakeSeed(),
    })
    pausedRef.current = false
    setPaused(false)
    setIsRecord(false)
    sync()
  }, [speedMs, sync])

  const onStep = useCallback(() => {
    const state = stateRef.current
    const result = stepSoloSnake(state)
    if (result.dead) {
      if (state.score > bestRef.current) {
        setBest(saveSnakeBest(state.score))
        if (state.score > 0) setIsRecord(true)
      }
      pausedRef.current = false
    }
    sync()
  }, [sync])

  const getStepMs = useCallback(() => {
    const state = stateRef.current
    if (pausedRef.current || !state.alive) return 0
    return state.stepMs
  }, [])

  const onDraw = useCallback((time: number, layout: BoardLayout) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const state = stateRef.current
    const ctx = prepareContext(canvas, layout)
    if (!ctx) return
    const palette = paletteFor(darkRef.current)
    drawGridBackground(ctx, state.size, layout, palette)
    drawFoods(ctx, state.foods, layout, palette, time)
    drawSnake(
      ctx,
      {
        points: state.snake,
        color: snakeColorForSeat(0),
        alive: state.alive,
        direction: state.direction,
      },
      layout,
      palette
    )
  }, [])

  useBoardLoop(canvasRef, wrapRef, {
    getSize: () => stateRef.current.size,
    getStepMs,
    onStep,
    onDraw,
  })

  useSwipeDirection(wrapRef, handleDirection, hud.alive && !paused)

  // 键盘：方向键 / WASD 改向，空格或 P 暂停，回车重开
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      if (event.code === 'Space' || event.key === 'p' || event.key === 'P') {
        if (isActionTarget(event.target)) return
        event.preventDefault()
        togglePause()
        return
      }
      if (event.key === 'Enter' && !stateRef.current.alive) {
        if (isActionTarget(event.target)) return
        event.preventDefault()
        restart()
        return
      }
      const direction = SOLO_KEY_MAP[event.key]
      if (!direction) return
      if (ARROW_KEYS.has(event.key)) event.preventDefault()
      handleDirection(direction)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleDirection, restart, togglePause])

  const ariaLabel = hud.alive
    ? `贪吃蛇棋盘，当前分数 ${hud.score} 分，蛇长 ${hud.length} 节，已吃 ${hud.eaten} 个果，速度每步 ${hud.stepMs} 毫秒。`
    : `贪吃蛇棋盘，本局结束，得分 ${hud.score} 分，蛇长 ${hud.length} 节。按回车键或点击再来一局重新开始。`

  return (
    <div className="gh-snake-board-area">
      <div className="gh-snake-cards" role="status" aria-live="polite">
        <span className="gh-snake-card">
          <span className="gh-snake-card-label">分数</span>
          <strong className="gh-snake-card-value">{hud.score}</strong>
        </span>
        <span className="gh-snake-card">
          <span className="gh-snake-card-label">蛇长</span>
          <strong className="gh-snake-card-value">{hud.length}</strong>
        </span>
        <span className="gh-snake-card">
          <span className="gh-snake-card-label">已吃果</span>
          <strong className="gh-snake-card-value">{hud.eaten}</strong>
        </span>
        <span className="gh-snake-card">
          <span className="gh-snake-card-label">最高分</span>
          <strong className="gh-snake-card-value">{best}</strong>
        </span>
      </div>

      <div className="gh-snake-toolbar">
        <button
          type="button"
          className="gh-btn gh-btn--primary gh-btn--md"
          onClick={togglePause}
          disabled={!hud.alive}
        >
          {paused ? '继续' : '暂停'}
        </button>
        <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={restart}>
          重新开始
        </button>
        <span className="gh-snake-toolbar-hint">
          空格 / P 暂停，回车重新开始；方向键或 WASD 控制，手机可直接在棋盘上滑动。
        </span>
      </div>

      <div className="gh-snake-stage" ref={wrapRef}>
        <canvas ref={canvasRef} className="gh-snake-canvas" aria-label={ariaLabel} role="img" />

        {!hud.alive && (
          <div className="gh-snake-overlay" role="dialog" aria-modal="true" aria-label="本局结果">
            <div className="gh-snake-overlay-card">
              <p className="gh-snake-overlay-eyebrow">本局结束</p>
              <h2 className="gh-snake-overlay-title">
                {isRecord ? '新纪录！' : '撞到墙或自己的身体'}
              </h2>
              <p className="gh-snake-overlay-detail">
                {isRecord
                  ? `恭喜刷新本机最高分：${best} 分。`
                  : '蛇不能撞墙，也不能撞自己的身体。换个速度档位再试一次？'}
              </p>
              <div className="gh-snake-overlay-scores">
                <span>
                  本局分数 <strong>{hud.score}</strong>
                </span>
                <span>
                  蛇长 <strong>{hud.length}</strong>
                </span>
                <span>
                  最高分 <strong>{best}</strong>
                </span>
              </div>
              <div className="gh-snake-overlay-actions">
                <button type="button" className="gh-btn gh-btn--primary gh-btn--lg" onClick={restart}>
                  再来一局
                </button>
                <Link className="gh-btn gh-btn--secondary gh-btn--lg" to="/games">
                  返回游戏大厅
                </Link>
              </div>
            </div>
          </div>
        )}

        {hud.alive && paused && (
          <div className="gh-snake-overlay gh-snake-overlay--paused" role="status">
            <div className="gh-snake-overlay-card">
              <p className="gh-snake-overlay-eyebrow">已暂停</p>
              <h2 className="gh-snake-overlay-title">按空格继续</h2>
              <p className="gh-snake-overlay-detail">蛇停在原地，随时可以回来冲分。</p>
              <div className="gh-snake-overlay-actions">
                <button type="button" className="gh-btn gh-btn--primary gh-btn--lg" onClick={togglePause}>
                  继续游戏
                </button>
                <button type="button" className="gh-btn gh-btn--secondary gh-btn--lg" onClick={restart}>
                  重新开始
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <p className="gh-snake-sr-only" aria-live="polite">
        {hud.alive
          ? `分数 ${hud.score}，蛇长 ${hud.length}${paused ? '，已暂停' : ''}`
          : `本局结束，得分 ${hud.score}${isRecord ? '，刷新最高分' : ''}`}
      </p>
    </div>
  )
}

function snapshotSoloHud(state: SoloSnakeState): SoloHud {
  return {
    score: state.score,
    length: state.snake.length,
    eaten: state.eaten,
    stepMs: state.stepMs,
    alive: state.alive,
  }
}

function syncSoloHud(state: SoloSnakeState, setHud: Dispatch<SetStateAction<SoloHud>>): void {
  setHud((prev) => {
    const next = snapshotSoloHud(state)
    if (
      prev.score === next.score
      && prev.length === next.length
      && prev.eaten === next.eaten
      && prev.stepMs === next.stepMs
      && prev.alive === next.alive
    ) {
      return prev
    }
    return next
  })
}

// ==================== 同屏双人棋盘 ====================

interface VersusHud {
  scores: [number, number]
  lengths: [number, number]
  alive: [boolean, boolean]
  finished: boolean
  winner: 0 | 1 | null
}

function VersusBoard({ speedMs, dark }: { speedMs: number; dark: boolean }) {
  // useState 初始化函数只跑一次，避免每次渲染都新建局面对象
  const [initialVersus] = useState(() => createVersusSnakeState({ seed: randomSnakeSeed() }))
  const stateRef = useRef<VersusSnakeState>(initialVersus)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const pausedRef = useRef(false)
  const darkRef = useRef(dark)
  darkRef.current = dark

  const [hud, setHud] = useState<VersusHud>(() => snapshotVersusHud(stateRef.current))
  const [paused, setPaused] = useState(false)
  const [record, setRecord] = useState<VersusRecord>(() => loadVersusRecord())

  useEffect(() => {
    setVersusBaseSpeed(stateRef.current, speedMs)
    syncVersusHud(stateRef.current, setHud)
  }, [speedMs])

  const sync = useCallback(() => syncVersusHud(stateRef.current, setHud), [])

  const handleDirection = useCallback(
    (player: 0 | 1, direction: SnakeDirection) => {
      if (pausedRef.current) return
      if (setVersusDirection(stateRef.current, player, direction)) sync()
    },
    [sync]
  )

  const togglePause = useCallback(() => {
    const state = stateRef.current
    if (state.finished) return
    pausedRef.current = !pausedRef.current
    setPaused(pausedRef.current)
  }, [])

  const restart = useCallback(() => {
    const previous = stateRef.current
    stateRef.current = createVersusSnakeState({ size: previous.size, seed: randomSnakeSeed() })
    stateRef.current.baseStepMs = previous.baseStepMs
    stateRef.current.stepMs = previous.stepMs
    pausedRef.current = false
    setPaused(false)
    sync()
  }, [sync])

  const onStep = useCallback(() => {
    const state = stateRef.current
    const result = stepVersusSnake(state)
    if (result.dead[0] || result.dead[1]) {
      setRecord(saveVersusResult(result.winner))
      pausedRef.current = false
    }
    sync()
  }, [sync])

  const getStepMs = useCallback(() => {
    const state = stateRef.current
    if (pausedRef.current || state.finished) return 0
    return state.stepMs
  }, [])

  const onDraw = useCallback((time: number, layout: BoardLayout) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const state = stateRef.current
    const ctx = prepareContext(canvas, layout)
    if (!ctx) return
    const palette = paletteFor(darkRef.current)
    drawGridBackground(ctx, state.size, layout, palette)
    drawFoods(ctx, state.foods, layout, palette, time)
    for (const seat of [0, 1] as const) {
      drawSnake(
        ctx,
        {
          points: state.snakes[seat],
          color: snakeColorForSeat(seat),
          alive: state.alive[seat],
          direction: state.directions[seat],
        },
        layout,
        palette
      )
    }
  }, [])

  useBoardLoop(canvasRef, wrapRef, {
    getSize: () => stateRef.current.size,
    getStepMs,
    onStep,
    onDraw,
  })

  // 键盘：P1 = WASD，P2 = 方向键；空格暂停 / 继续，结束后回车再来一局
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      if (event.code === 'Space') {
        if (isActionTarget(event.target)) return
        event.preventDefault()
        if (stateRef.current.finished) restart()
        else togglePause()
        return
      }
      if (event.key === 'Enter' && stateRef.current.finished) {
        if (isActionTarget(event.target)) return
        event.preventDefault()
        restart()
        return
      }
      for (const group of VERSUS_KEY_MAP) {
        const direction = group.keys[event.key]
        if (!direction) continue
        if (ARROW_KEYS.has(event.key)) event.preventDefault()
        handleDirection(group.player, direction)
        return
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleDirection, restart, togglePause])

  const winnerLabel =
    hud.winner === 0 ? 'P1（绿）获胜' : hud.winner === 1 ? 'P2（蓝）获胜' : '平局：两条蛇同时撞线'

  const ariaLabel = hud.finished
    ? `同屏双人棋盘，本局结束：${winnerLabel}。P1 ${hud.scores[0]} 分、${hud.lengths[0]} 节，P2 ${hud.scores[1]} 分、${hud.lengths[1]} 节。`
    : `同屏双人棋盘，边长 ${SNAKE_VERSUS_SIZE} 格。P1 ${hud.scores[0]} 分、蛇长 ${hud.lengths[0]} 节${
        hud.alive[0] ? '存活' : '已出局'
      }；P2 ${hud.scores[1]} 分、蛇长 ${hud.lengths[1]} 节${hud.alive[1] ? '存活' : '已出局'}。`

  return (
    <div className="gh-snake-board-area">
      <div className="gh-snake-versus-bar" role="status" aria-live="polite">
        <span className="gh-snake-versus-player" data-seat="0">
          <span className="gh-snake-swatch" style={{ background: SNAKE_COLORS[0] }} aria-hidden="true" />
          <span className="gh-snake-versus-name">P1 · WASD</span>
          <strong>{hud.scores[0]}</strong>
          <span className="gh-snake-versus-meta">
            蛇长 {hud.lengths[0]} · {hud.alive[0] ? '存活' : '出局'}
          </span>
        </span>
        <span className="gh-snake-versus-player" data-seat="1">
          <span className="gh-snake-swatch" style={{ background: SNAKE_COLORS[1] }} aria-hidden="true" />
          <span className="gh-snake-versus-name">P2 · 方向键</span>
          <strong>{hud.scores[1]}</strong>
          <span className="gh-snake-versus-meta">
            蛇长 {hud.lengths[1]} · {hud.alive[1] ? '存活' : '出局'}
          </span>
        </span>
      </div>

      <div className="gh-snake-toolbar">
        <button
          type="button"
          className="gh-btn gh-btn--primary gh-btn--md"
          onClick={togglePause}
          disabled={hud.finished}
        >
          {paused ? '继续' : '暂停'}
        </button>
        <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={restart}>
          再来一局
        </button>
        <span className="gh-snake-toolbar-hint">
          一台电脑两个人：左边 WASD，右边方向键，空格暂停。
        </span>
      </div>

      <div className="gh-snake-versus-record">
        本机战绩 —— P1 {record.p1} 胜 · P2 {record.p2} 胜 · 平局 {record.draws} 场
      </div>

      <div className="gh-snake-stage" ref={wrapRef}>
        <canvas ref={canvasRef} className="gh-snake-canvas" aria-label={ariaLabel} role="img" />

        {hud.finished && (
          <div className="gh-snake-overlay" role="dialog" aria-modal="true" aria-label="本局结果">
            <div className="gh-snake-overlay-card">
              <p className="gh-snake-overlay-eyebrow">同屏双人对局结束</p>
              <h2
                className={[
                  'gh-snake-overlay-title',
                  hud.winner === null ? 'gh-snake-overlay-title--draw' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {winnerLabel}
              </h2>
              <p className="gh-snake-overlay-detail">
                撞墙、撞对方蛇身、撞自己都会出局；两头同时撞上判平局。
              </p>
              <div className="gh-snake-overlay-scores">
                <span>
                  P1 <strong>{hud.scores[0]}</strong>
                </span>
                <span>
                  P2 <strong>{hud.scores[1]}</strong>
                </span>
                <span>
                  累计战绩 <strong>{record.p1} : {record.p2}</strong>
                </span>
              </div>
              <div className="gh-snake-overlay-actions">
                <button type="button" className="gh-btn gh-btn--primary gh-btn--lg" onClick={restart}>
                  再来一局
                </button>
                <Link className="gh-btn gh-btn--secondary gh-btn--lg" to="/games">
                  返回游戏大厅
                </Link>
              </div>
            </div>
          </div>
        )}

        {!hud.finished && paused && (
          <div className="gh-snake-overlay gh-snake-overlay--paused" role="status">
            <div className="gh-snake-overlay-card">
              <p className="gh-snake-overlay-eyebrow">已暂停</p>
              <h2 className="gh-snake-overlay-title">按空格继续</h2>
              <p className="gh-snake-overlay-detail">两条蛇都停在原地，准备好再一起出发。</p>
              <div className="gh-snake-overlay-actions">
                <button type="button" className="gh-btn gh-btn--primary gh-btn--lg" onClick={togglePause}>
                  继续游戏
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function snapshotVersusHud(state: VersusSnakeState): VersusHud {
  return {
    scores: [state.scores[0], state.scores[1]],
    lengths: [state.snakes[0].length, state.snakes[1].length],
    alive: [state.alive[0], state.alive[1]],
    finished: state.finished,
    winner: state.winner,
  }
}

function syncVersusHud(state: VersusSnakeState, setHud: Dispatch<SetStateAction<VersusHud>>): void {
  setHud((prev) => {
    const next = snapshotVersusHud(state)
    if (
      prev.scores[0] === next.scores[0]
      && prev.scores[1] === next.scores[1]
      && prev.lengths[0] === next.lengths[0]
      && prev.lengths[1] === next.lengths[1]
      && prev.alive[0] === next.alive[0]
      && prev.alive[1] === next.alive[1]
      && prev.finished === next.finished
      && prev.winner === next.winner
    ) {
      return prev
    }
    return next
  })
}

// ==================== 页面 ====================

/**
 * 贪吃蛇单机页：页内 tab 切换「单机冲分」与「同屏双人」。
 * 规则引擎在 lib/games/snake.ts（纯函数、可单测），本页只负责 rAF 主循环与 canvas 渲染。
 * 大地图好友联机在 `/games/snake/online`。
 */
export default function SnakePage() {
  const { resolvedTheme } = useTheme()
  const [mode, setMode] = useState<SnakeMode>('solo')
  const [speed, setSpeed] = useState<SnakeSpeedLevel>('中')

  const speedMs = SNAKE_SPEED_LEVELS[speed]
  const dark = resolvedTheme === 'dark'

  const legend = useMemo(
    () =>
      mode === 'solo'
        ? [
            '方向键 或 W / A / S / D —— 改变蛇的朝向（不能 180° 掉头）',
            '空格 或 P —— 暂停 / 继续',
            '回车 —— 死亡后重新开始',
            '手机 —— 直接在棋盘上滑动改向',
          ]
        : [
            'P1（绿，左侧出生）—— W / A / S / D',
            'P2（蓝，右侧出生）—— 方向键 ↑ ↓ ← →',
            '空格 —— 暂停 / 继续，结束后回车再来一局',
            '同屏双人需要一把键盘，建议两人各守半边',
          ],
    [mode]
  )

  return (
    <div className="gh-page-container gh-games-page gh-snake-page">
      <header className="gh-games-header">
        <div className="gh-games-header-copy">
          <p className="gh-g2048-eyebrow">
            <Link to="/games">← 游戏大厅</Link>
          </p>
          <h1 className="gh-games-title">贪吃蛇</h1>
          <p className="gh-games-subtitle">
            吃果变长、越吃越快：单机冲本机最高分，或一台电脑两个人同屏对掐。想上 40×40 大地图，去右上角「好友联机」。
          </p>
        </div>
        <div className="gh-snake-header-actions">
          <label className="gh-snake-speed">
            速度
            <select
              className="gh-input gh-snake-speed-select"
              value={speed}
              onChange={(event) => setSpeed(event.target.value as SnakeSpeedLevel)}
              aria-label="选择每步速度"
            >
              {SNAKE_SPEED_ORDER.map((level) => (
                <option key={level} value={level}>
                  {level}（{SNAKE_SPEED_LEVELS[level]} 毫秒/步）
                </option>
              ))}
            </select>
          </label>
          <Link className="gh-btn gh-btn--secondary gh-btn--md" to={GAME_SNAKE_ONLINE_ROUTE}>
            好友联机
          </Link>
        </div>
      </header>

      <div className="gh-snake-tabs" role="tablist" aria-label="贪吃蛇模式">
        <button
          type="button"
          role="tab"
          id="gh-snake-tab-solo"
          aria-selected={mode === 'solo'}
          className={`gh-snake-tab${mode === 'solo' ? ' gh-snake-tab--active' : ''}`}
          onClick={() => setMode('solo')}
        >
          单机冲分
        </button>
        <button
          type="button"
          role="tab"
          id="gh-snake-tab-versus"
          aria-selected={mode === 'versus'}
          className={`gh-snake-tab${mode === 'versus' ? ' gh-snake-tab--active' : ''}`}
          onClick={() => setMode('versus')}
        >
          同屏双人
        </button>
      </div>

      <div className="gh-snake-layout">
        <div className="gh-snake-main" role="tabpanel" aria-labelledby={`gh-snake-tab-${mode}`}>
          {mode === 'solo' ? (
            <SoloBoard key="solo" speedMs={speedMs} dark={dark} />
          ) : (
            <VersusBoard key="versus" speedMs={speedMs} dark={dark} />
          )}
        </div>

        <aside className="gh-snake-help" aria-label="玩法说明">
          <h2 className="gh-snake-help-title">操作说明</h2>
          <ul className="gh-snake-help-list">
            {legend.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <h2 className="gh-snake-help-title">规则</h2>
          <ul className="gh-snake-help-list">
            <li>普通果 10 分、蛇长 +1；金果 30 分、蛇长 +3，且金果会过期消失。</li>
            <li>每吃 5 个果提速 5%（最快 {SNAKE_MIN_STEP_MS} 毫秒/步封顶，防止快到没法操作）。</li>
            <li>撞墙、撞自己立即结束；同屏双人还会撞对方蛇身。</li>
            <li>最高分与同屏战绩都只保存在本机浏览器。</li>
          </ul>
          <p className="gh-snake-help-note">
            当前棋盘：单机 20×20、同屏双人 {SNAKE_VERSUS_SIZE}×{SNAKE_VERSUS_SIZE}。
          </p>
          <Link to="/games" className="gh-snake-help-link">
            返回游戏大厅
          </Link>
        </aside>
      </div>
    </div>
  )
}
