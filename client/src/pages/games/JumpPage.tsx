import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTheme } from '../../contexts/ThemeContext'
import { useGameStats } from '../../contexts/GameStatsContext'
import { GAME_JUMP_ONLINE_ROUTE } from '../../lib/games/catalog'
import {
  JUMP_ISO_RATIO,
  JUMP_MAX_CHARGE_MS,
  JUMP_SOLO_CHARACTER_COLOR,
  beginJumpCharge,
  createJumpSession,
  finishJump,
  formatJumpOffset,
  jumpArcLift,
  jumpAxisOfBox,
  jumpBoxColors,
  jumpFlightMs,
  jumpIso,
  jumpLandingAxis,
  jumpPowerRatio,
  jumpSquash,
  randomJumpSeed,
  type JumpBox,
  type JumpLanding,
  type JumpSession,
  type JumpSessionStatus,
  type JumpSoloResult,
} from '../../lib/games/jump'

/** 画布布局（CSS 像素 + 逻辑单位到像素的缩放 + 设备像素比） */
interface JumpLayout {
  cssWidth: number
  cssHeight: number
  scale: number
  dpr: number
}

/** 一帧里的跳跃 / 坠落动画 */
type JumpAnim =
  | { phase: 'idle' }
  | {
      phase: 'jump'
      start: number
      duration: number
      fromAxis: number
      toAxis: number
      distance: number
      chargeMs: number
      result: JumpSoloResult
    }
  | { phase: 'fall'; start: number; axis: number; lift: number; drift: number }

/** 落地灰尘粒子（逻辑坐标轴 + 离地高度） */
interface JumpParticle {
  axis: number
  lift: number
  vAxis: number
  vLift: number
  born: number
  life: number
  r: number
}

/** 飘字（+2 / +4 …） */
interface JumpFloat {
  text: string
  axis: number
  lift: number
  born: number
  color: string
}

/** 命中中心的高亮光环 */
interface JumpRing {
  axis: number
  size: number
  born: number
}

/** HUD 快照（只在结算时更新，避免每帧 setState） */
interface JumpHud {
  score: number
  combo: number
  boxIndex: number
  jumps: number
  status: JumpSessionStatus
  lastKind: JumpLanding | null
  lastGained: number
  lastOffset: number | null
}

const CAMERA_ANCHOR_X = 0.4
const BASE_LINE_Y = 0.68
/** 一屏可见的逻辑轴跨度（决定缩放） */
const VIEW_LOGICAL_SPAN = 430
const MIN_SCALE = 0.62
const MAX_SCALE = 1.5
/** 坠落动画时长与落地灰尘存活时间 */
const FALL_MS = 720
const DUST_MS = 520

function emptyHud(session: JumpSession): JumpHud {
  return {
    score: session.score,
    combo: session.combo,
    boxIndex: session.boxIndex,
    jumps: session.jumps,
    status: session.status,
    lastKind: null,
    lastGained: 0,
    lastOffset: null,
  }
}

// ==================== 程序化绘制（无外部素材） ====================

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

/** 背景：柔和渐变 + 远景等距网格（随镜头平移，制造前进感） */
function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  layout: JumpLayout,
  dark: boolean,
  camAxis: number
): void {
  const { cssWidth, cssHeight } = layout
  const gradient = ctx.createLinearGradient(0, 0, 0, cssHeight)
  if (dark) {
    gradient.addColorStop(0, '#0b1220')
    gradient.addColorStop(0.62, '#131c2c')
    gradient.addColorStop(1, '#1b2536')
  } else {
    gradient.addColorStop(0, '#eef4fb')
    gradient.addColorStop(0.62, '#f6f8fa')
    gradient.addColorStop(1, '#e9eef5')
  }
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, cssWidth, cssHeight)

  // 远景网格：与跳跃轴平行的斜线 + 横向水平线
  const step = 58 * layout.scale
  const slide = ((camAxis * layout.scale) % step + step) % step
  ctx.lineWidth = 1
  ctx.strokeStyle = dark ? 'rgba(240, 246, 252, 0.045)' : 'rgba(31, 35, 40, 0.055)'
  ctx.beginPath()
  for (let i = -2; i < cssWidth / step + 2; i += 1) {
    const x = i * step - slide
    ctx.moveTo(x, 0)
    ctx.lineTo(x + cssHeight * JUMP_ISO_RATIO, cssHeight)
  }
  for (let j = 1; j < 5; j += 1) {
    const y = (cssHeight / 5) * j
    ctx.moveTo(0, y)
    ctx.lineTo(cssWidth, y)
  }
  ctx.stroke()
}

/** 等距盒子：棱柱（明暗两面）或圆柱（椭圆顶 + 侧壁） */
function drawJumpBox(
  ctx: CanvasRenderingContext2D,
  box: JumpBox,
  sx: number,
  sy: number,
  scale: number,
  dark: boolean
): void {
  const half = box.size * scale
  const depth = half * JUMP_ISO_RATIO
  const body = Math.max(14, box.size * 1.55) * scale
  const colors = jumpBoxColors(box.index, dark)

  if (box.kind === 'cylinder') {
    // 侧壁：左右竖线 + 底部半椭圆
    ctx.fillStyle = colors.right
    ctx.beginPath()
    ctx.moveTo(sx - half, sy)
    ctx.lineTo(sx - half, sy + body)
    ctx.ellipse(sx, sy + body, half, depth, 0, Math.PI, 0, true)
    ctx.closePath()
    ctx.fill()
    // 亮面（左侧一点高光带）
    ctx.fillStyle = colors.left
    ctx.beginPath()
    ctx.ellipse(sx, sy + body, half, depth, 0, Math.PI, 0, true)
    ctx.lineTo(sx, sy + body + depth)
    ctx.ellipse(sx, sy + body, half, depth, 0, 0, Math.PI, true)
    ctx.closePath()
    ctx.globalAlpha = 0.5
    ctx.fill()
    ctx.globalAlpha = 1
    // 顶面椭圆
    ctx.fillStyle = colors.top
    ctx.beginPath()
    ctx.ellipse(sx, sy, half, depth, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = colors.edge
    ctx.lineWidth = 1
    ctx.stroke()
    // 靶心：内圈
    ctx.globalAlpha = dark ? 0.5 : 0.42
    ctx.beginPath()
    ctx.ellipse(sx, sy, half * 0.3, depth * 0.3, 0, 0, Math.PI * 2)
    ctx.strokeStyle = colors.edge
    ctx.stroke()
    ctx.globalAlpha = 1
    return
  }

  // 棱柱：左面（暗）、右面（中）、顶面菱形（亮）
  ctx.fillStyle = colors.left
  ctx.beginPath()
  ctx.moveTo(sx - half, sy)
  ctx.lineTo(sx, sy + depth)
  ctx.lineTo(sx, sy + depth + body)
  ctx.lineTo(sx - half, sy + body)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = colors.right
  ctx.beginPath()
  ctx.moveTo(sx + half, sy)
  ctx.lineTo(sx, sy + depth)
  ctx.lineTo(sx, sy + depth + body)
  ctx.lineTo(sx + half, sy + body)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = colors.top
  ctx.beginPath()
  ctx.moveTo(sx, sy - depth)
  ctx.lineTo(sx + half, sy)
  ctx.lineTo(sx, sy + depth)
  ctx.lineTo(sx - half, sy)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = colors.edge
  ctx.lineWidth = 1
  ctx.stroke()

  // 靶心：中心菱形
  ctx.globalAlpha = dark ? 0.45 : 0.38
  ctx.beginPath()
  ctx.moveTo(sx, sy - depth * 0.3)
  ctx.lineTo(sx + half * 0.3, sy)
  ctx.lineTo(sx, sy + depth * 0.3)
  ctx.lineTo(sx - half * 0.3, sy)
  ctx.closePath()
  ctx.strokeStyle = colors.edge
  ctx.stroke()
  ctx.globalAlpha = 1
}

/**
 * 角色：带眼睛的小方块人（微信「跳一跳」的 i 形小人剪影）。
 * @param squash 蓄力压缩量（0–0.42），高度变矮、宽度变胖
 * @param rotate 滞空翻转角度（弧度）
 */
function drawCharacter(
  ctx: CanvasRenderingContext2D,
  footX: number,
  footY: number,
  scale: number,
  color: string,
  opts: { squash: number; rotate: number; alpha: number; shadowAlpha: number }
): void {
  const w = 21 * scale
  const h = 33 * scale
  const squash = opts.squash
  const scaleX = 1 + squash * 0.55
  const scaleY = 1 - squash

  // 地面投影（离地越高越淡）
  if (opts.shadowAlpha > 0) {
    ctx.save()
    ctx.globalAlpha = opts.shadowAlpha
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)'
    ctx.beginPath()
    ctx.ellipse(footX, footY + 2 * scale, w * 0.52, w * 0.2, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  ctx.save()
  ctx.globalAlpha = opts.alpha
  ctx.translate(footX, footY)
  if (opts.rotate !== 0) ctx.rotate(opts.rotate)
  ctx.scale(scaleX, scaleY)

  // 腿
  ctx.fillStyle = color
  roundRectPath(ctx, -w * 0.36, -h * 0.3, w * 0.26, h * 0.3, w * 0.08)
  ctx.fill()
  roundRectPath(ctx, w * 0.1, -h * 0.3, w * 0.26, h * 0.3, w * 0.08)
  ctx.fill()

  // 身体（上窄下宽的圆角块）
  roundRectPath(ctx, -w * 0.46, -h * 0.82, w * 0.92, h * 0.55, w * 0.2)
  ctx.fill()

  // 头
  roundRectPath(ctx, -w * 0.34, -h, w * 0.68, h * 0.24, w * 0.14)
  ctx.fill()

  // 眼睛
  ctx.fillStyle = '#ffffff'
  const eyeY = -h * 0.88
  ctx.beginPath()
  ctx.arc(-w * 0.13, eyeY, w * 0.09, 0, Math.PI * 2)
  ctx.arc(w * 0.13, eyeY, w * 0.09, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#1f2328'
  ctx.beginPath()
  ctx.arc(-w * 0.11, eyeY, w * 0.042, 0, Math.PI * 2)
  ctx.arc(w * 0.15, eyeY, w * 0.042, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

// ==================== 棋盘 ====================

/**
 * 跳一跳单机棋盘：长按（鼠标按住 / 触屏按住 / 空格按住）蓄力，松手起跳。
 * 规则与判定全部来自 lib/games/jump.ts，本组件只做输入、动画与 canvas 渲染。
 */
function JumpBoard({ dark }: { dark: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)

  const sessionRef = useRef<JumpSession>(createJumpSession(randomJumpSeed()))
  const layoutRef = useRef<JumpLayout>({ cssWidth: 320, cssHeight: 220, scale: 1, dpr: 1 })
  const camRef = useRef(sessionRef.current.boxIndex)
  /** 角色当前视觉落点（落地后向盒面中心缓动） */
  const standRef = useRef(0)
  const chargeRef = useRef<{ active: boolean; startedAt: number; ms: number }>({
    active: false,
    startedAt: 0,
    ms: 0,
  })
  const animRef = useRef<JumpAnim>({ phase: 'idle' })
  const particlesRef = useRef<JumpParticle[]>([])
  const floatsRef = useRef<JumpFloat[]>([])
  const ringsRef = useRef<JumpRing[]>([])
  const darkRef = useRef(dark)
  darkRef.current = dark

  const [hud, setHud] = useState<JumpHud>(() => emptyHud(sessionRef.current))
  const [charging, setCharging] = useState(false)
  const [chargeMs, setChargeMs] = useState(0)
  const { getStat, recordResult } = useGameStats()
  const jumpStat = getStat('jump', 'solo')
  const best = jumpStat?.bestScore ?? 0
  const stats = {
    runs: jumpStat?.games ?? 0,
    totalScore: jumpStat?.scoreTotal ?? 0,
    bestCombo: jumpStat?.bestCombo ?? 0,
    offsetSum: jumpStat?.offsetSum ?? 0,
    offsetCount: jumpStat?.offsetCount ?? 0,
  }
  const [isRecord, setIsRecord] = useState(false)

  const syncHud = useCallback(() => {
    const session = sessionRef.current
    setHud((prev) =>
      prev.score === session.score
      && prev.combo === session.combo
      && prev.boxIndex === session.boxIndex
      && prev.jumps === session.jumps
      && prev.status === session.status
        ? prev
        : {
            ...prev,
            score: session.score,
            combo: session.combo,
            boxIndex: session.boxIndex,
            jumps: session.jumps,
            status: session.status,
          }
    )
  }, [])

  /** 逻辑轴坐标 → 画布坐标（镜头平滑跟随，角色固定在偏左锚点） */
  const project = useCallback((axis: number, lift: number, camAxis: number, layout: JumpLayout) => {
    const delta = axis - camAxis
    const iso = jumpIso(delta, lift)
    return {
      x: layout.cssWidth * CAMERA_ANCHOR_X + iso.x * layout.scale,
      y: layout.cssHeight * BASE_LINE_Y + iso.y * layout.scale,
    }
  }, [])

  const startCharge = useCallback(() => {
    const session = sessionRef.current
    if (animRef.current.phase !== 'idle' || session.status === 'over') return
    if (!beginJumpCharge(session)) return
    chargeRef.current = { active: true, startedAt: performance.now(), ms: 0 }
    setCharging(true)
  }, [])

  const releaseCharge = useCallback(() => {
    const charge = chargeRef.current
    chargeRef.current = { active: false, startedAt: 0, ms: 0 }
    setCharging(false)
    if (!charge.active) return
    const session = sessionRef.current
    if (session.status !== 'charging' || animRef.current.phase !== 'idle') return
    // 蓄力时长在客户端测量后交给引擎判定（钳制 1–2000 毫秒）
    const measured = Math.round(performance.now() - charge.startedAt)
    const clamped = Math.max(1, Math.min(JUMP_MAX_CHARGE_MS, measured))
    chargeRef.current.ms = clamped
    setChargeMs(clamped)

    const fromAxis = jumpAxisOfBox(session.course, session.boxIndex)
    const result = finishJump(session, clamped)
    if (result.kind === 'off') {
      session.status = 'ready'
      syncHud()
      return
    }
    const toAxis = jumpLandingAxis(session.course, result.targetIndex, result.offset)
    animRef.current = {
      phase: 'jump',
      start: performance.now(),
      duration: jumpFlightMs(clamped),
      fromAxis,
      toAxis,
      distance: result.distance,
      chargeMs: clamped,
      result,
    }
    session.status = 'flying'
    syncHud()
  }, [syncHud])

  /** 落地：灰尘 + 光环 + 飘字（命中）或进入坠落动画（落空） */
  const onLanded = useCallback(
    (anim: Extract<JumpAnim, { phase: 'jump' }>, now: number) => {
      const session = sessionRef.current
      const result = anim.result
      const landAxis = anim.toAxis
      if (result.dead) {
        animRef.current = { phase: 'fall', start: now, axis: landAxis, lift: 0, drift: result.offset > 0 ? 26 : -18 }
        return
      }
      animRef.current = { phase: 'idle' }
      session.status = 'ready'
      const target = session.course[result.targetIndex]
      if (target) {
        const dust = result.kind === 'center' ? 16 : 10
        for (let i = 0; i < dust; i += 1) {
          const angle = (i / dust) * Math.PI * 2
          particlesRef.current.push({
            axis: landAxis + Math.cos(angle) * target.size * 0.55,
            lift: 0,
            vAxis: Math.cos(angle) * 26,
            vLift: 18 + Math.abs(Math.sin(angle)) * 22,
            born: now,
            life: DUST_MS + Math.random() * 180,
            r: 2 + Math.random() * 2.4,
          })
        }
        if (result.kind === 'center') {
          ringsRef.current.push({ axis: landAxis, size: target.size, born: now })
          floatsRef.current.push({
            text: `+${result.gained}`,
            axis: landAxis,
            lift: target.size * 1.4,
            born: now,
            color: result.gained >= 8 ? '#f5c518' : '#1a7f37',
          })
        }
      }
      setHud((prev) => ({
        ...prev,
        lastKind: result.kind,
        lastGained: result.gained,
        lastOffset: result.offset,
      }))
      syncHud()
    },
    [syncHud]
  )

  const finishRun = useCallback(() => {
    const session = sessionRef.current
    if (session.status === 'over') return
    session.status = 'over'
    setIsRecord(session.score > 0 && session.score > best)
    recordResult({
      game: 'jump',
      variant: 'solo',
      score: session.score,
      jumps: session.jumps,
      maxCombo: session.combo,
      offset: Number.isFinite(session.bestOffset) ? session.bestOffset : undefined,
    })
    syncHud()
  }, [best, recordResult, syncHud])

  const restart = useCallback(() => {
    sessionRef.current = createJumpSession(randomJumpSeed())
    animRef.current = { phase: 'idle' }
    particlesRef.current = []
    floatsRef.current = []
    ringsRef.current = []
    chargeRef.current = { active: false, startedAt: 0, ms: 0 }
    camRef.current = 0
    standRef.current = 0
    setCharging(false)
    setChargeMs(0)
    setIsRecord(false)
    setHud(emptyHud(sessionRef.current))
  }, [])

  // 尺寸自适应（DPR + ResizeObserver）
  useEffect(() => {
    const measure = () => {
      const stage = stageRef.current
      const canvas = canvasRef.current
      if (!stage || !canvas) return
      const cssWidth = Math.max(240, Math.floor(stage.clientWidth || 320))
      const cssHeight = Math.max(220, Math.min(560, Math.floor(cssWidth * 0.58)))
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cssWidth / VIEW_LOGICAL_SPAN))
      const dpr = Math.min(3, Math.max(1, Math.round((window.devicePixelRatio || 1) * 100) / 100))
      layoutRef.current = { cssWidth, cssHeight, scale, dpr }
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`
      canvas.width = Math.round(cssWidth * dpr)
      canvas.height = Math.round(cssHeight * dpr)
    }
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      if (stageRef.current) observer.observe(stageRef.current)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // 主循环：动画推进 + 每帧重绘
  useEffect(() => {
    let raf = 0
    const frame = (time: number) => {
      raf = requestAnimationFrame(frame)
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const session = sessionRef.current
      const layout = layoutRef.current
      ctx.setTransform(layout.dpr, 0, 0, layout.dpr, 0, 0)
      ctx.clearRect(0, 0, layout.cssWidth, layout.cssHeight)

      // --- 动画推进 ---
      const anim = animRef.current
      const centerAxis = jumpAxisOfBox(session.course, session.boxIndex)
      let charAxis = centerAxis
      let charLift = 0
      let squash = 0
      let rotate = 0
      let charAlpha = 1
      let shadowAlpha = 0.28

      if (anim.phase === 'jump') {
        const progress = Math.max(0, Math.min(1, (time - anim.start) / anim.duration))
        charAxis = anim.fromAxis + (anim.toAxis - anim.fromAxis) * progress
        charLift = jumpArcLift(anim.distance, progress)
        rotate = progress * Math.PI * 2
        shadowAlpha = 0.3 * (1 - Math.min(1, charLift / 90))
        standRef.current = charAxis
        if (progress >= 1) onLanded(anim, time)
      } else if (anim.phase === 'fall') {
        const progress = Math.max(0, Math.min(1, (time - anim.start) / FALL_MS))
        charAxis = anim.axis + anim.drift * progress
        charLift = anim.lift - progress * 170
        rotate = progress * 2.4
        charAlpha = 1 - progress * 0.75
        shadowAlpha = 0
        standRef.current = charAxis
        if (progress >= 1) {
          animRef.current = { phase: 'idle' }
          finishRun()
        }
      } else if (session.status === 'over') {
        // 已结束：停在坠落点，别滑回盒面中心（结束遮罩下仍能看到掉下去的小人）
        charAxis = standRef.current
      } else {
        // 落地后从实际落点滑回盒面中心（引擎按盒面中心结算，视觉上抹掉那一下抖动）
        const eased = standRef.current + (centerAxis - standRef.current) * 0.3
        standRef.current = eased
        charAxis = eased
        if (chargeRef.current.active) {
          squash = jumpSquash(time - chargeRef.current.startedAt)
        }
      }

      // 力度实时反馈（直接改 DOM，避免每帧 setState）
      if (chargeRef.current.active) {
        const ratio = jumpPowerRatio(time - chargeRef.current.startedAt)
        if (barRef.current) {
          barRef.current.style.width = `${(ratio * 100).toFixed(1)}%`
          barRef.current.dataset.ratio = ratio.toFixed(2)
        }
      } else if (barRef.current && barRef.current.style.width !== '0%') {
        barRef.current.style.width = '0%'
      }

      // --- 镜头缓动跟随（往前多看一格） ---
      const camTarget = charAxis + 34
      const easing = anim.phase === 'idle' ? 0.08 : 0.14
      camRef.current += (camTarget - camRef.current) * easing
      const camAxis = camRef.current

      // --- 绘制 ---
      drawBackdrop(ctx, layout, darkRef.current, camAxis)

      const boxes = session.course
      // 可见窗口按「当前盒子序号」取，而不是按 camAxis / 平均间距估算：
      // 盒子间距在 60–150 之间随机，早期用 /60 估算会让 visibleFrom 随跳数增长
      // 迅速超过 boxIndex + 12，跳约 25 格后画面上的盒子会整体消失。
      const visibleFrom = Math.max(0, session.boxIndex - 5)
      const visibleTo = Math.min(boxes.length - 1, session.boxIndex + 14)
      // 远处先画（沿轴越远越靠后），避免近盒被覆盖
      for (let index = visibleTo; index >= visibleFrom; index -= 1) {
        const box = boxes[index]
        if (!box) continue
        const point = project(jumpAxisOfBox(boxes, index), 0, camAxis, layout)
        if (point.x < -140 || point.x > layout.cssWidth + 160) continue
        drawJumpBox(ctx, box, point.x, point.y, layout.scale, darkRef.current)
      }

      // 光环
      ringsRef.current = ringsRef.current.filter((ring) => time - ring.born < 620)
      for (const ring of ringsRef.current) {
        const age = (time - ring.born) / 620
        const point = project(ring.axis, 0, camAxis, layout)
        ctx.save()
        ctx.globalAlpha = 1 - age
        ctx.strokeStyle = darkRef.current ? '#f5c518' : '#b08800'
        ctx.lineWidth = 2
        const grow = 1 + age * 0.9
        ctx.beginPath()
        ctx.ellipse(
          point.x,
          point.y,
          ring.size * layout.scale * 0.55 * grow,
          ring.size * layout.scale * 0.55 * JUMP_ISO_RATIO * grow,
          0,
          0,
          Math.PI * 2
        )
        ctx.stroke()
        ctx.restore()
      }

      // 灰尘
      particlesRef.current = particlesRef.current.filter(
        (dust) => time - dust.born < dust.life
      )
      for (const dust of particlesRef.current) {
        const age = (time - dust.born) / dust.life
        const point = project(dust.axis + dust.vAxis * age, dust.lift + dust.vLift * age * (1 - age), camAxis, layout)
        ctx.save()
        ctx.globalAlpha = 0.5 * (1 - age)
        ctx.fillStyle = darkRef.current ? '#c9d1d9' : '#8c959f'
        ctx.beginPath()
        ctx.arc(point.x, point.y, dust.r * layout.scale, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      // 角色
      const charPoint = project(charAxis, charLift, camAxis, layout)
      const groundPoint = project(charAxis, 0, camAxis, layout)
      drawCharacter(ctx, charPoint.x, charPoint.y, layout.scale, JUMP_SOLO_CHARACTER_COLOR, {
        squash,
        rotate,
        alpha: charAlpha,
        shadowAlpha,
      })

      // 跳跃弧线（蓄力中给出方向提示：下一盒中心）
      if (chargeRef.current.active || anim.phase === 'jump') {
        const nextIndex = session.boxIndex + 1
        const nextBox = boxes[nextIndex]
        if (nextBox) {
          const nextPoint = project(jumpAxisOfBox(boxes, nextIndex), 0, camAxis, layout)
          ctx.save()
          ctx.globalAlpha = 0.32
          ctx.setLineDash([4, 6])
          ctx.strokeStyle = darkRef.current ? '#f0f6fc' : '#59636e'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(groundPoint.x, groundPoint.y)
          ctx.lineTo(nextPoint.x, nextPoint.y)
          ctx.stroke()
          ctx.restore()
        }
      }

      // 飘字
      floatsRef.current = floatsRef.current.filter((item) => time - item.born < 900)
      for (const item of floatsRef.current) {
        const age = (time - item.born) / 900
        const point = project(item.axis, item.lift + age * 44, camAxis, layout)
        ctx.save()
        ctx.globalAlpha = 1 - age
        ctx.fillStyle = item.color
        ctx.font = `700 ${Math.round(19 * layout.scale)}px 'SFMono-Regular', Consolas, monospace`
        ctx.textAlign = 'center'
        ctx.fillText(item.text, point.x, point.y)
        ctx.restore()
      }
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [onLanded, finishRun, project])

  // 键盘：空格按住蓄力 / 松手起跳，结束后回车再来一局
  useEffect(() => {
    const isTyping = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false
      if (target.isContentEditable) return true
      const tag = target.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTyping(event.target)) return
      if (event.code === 'Space') {
        event.preventDefault()
        if (event.repeat) return
        startCharge()
        return
      }
      if (event.key === 'Enter' && sessionRef.current.status === 'over') {
        event.preventDefault()
        restart()
      }
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        event.preventDefault()
        releaseCharge()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [startCharge, releaseCharge, restart])

  // 蓄力数值每 80 毫秒同步一次（只用于文案与无障碍播报，力度条走 DOM 直改）
  useEffect(() => {
    if (!charging) return
    const timer = setInterval(() => {
      setChargeMs(Math.round(performance.now() - chargeRef.current.startedAt))
    }, 80)
    return () => clearInterval(timer)
  }, [charging])

  const session = sessionRef.current
  const over = hud.status === 'over'
  const nextBox = session.course[session.boxIndex + 1]
  const powerPercent = Math.round(jumpPowerRatio(chargeMs) * 100)

  const ariaLabel = over
    ? `跳一跳棋盘，本局结束：得分 ${hud.score} 分，跳到第 ${hud.boxIndex + 1} 个盒子，共跳 ${hud.jumps} 次。按回车键或点击再来一局重新开始。`
    : `跳一跳棋盘：当前 ${hud.score} 分，站在第 ${hud.boxIndex + 1} 个盒子，连击 ${hud.combo}，最高分 ${best}。${
        nextBox ? `下一个盒子中心间距约 ${Math.round(nextBox.gap)}，满蓄力可跳 260。` : ''
      }`

  const landingHint = useMemo(() => {
    if (over) return '落空了 —— 按住重新蓄力，先按距离估一估时长'
    if (charging) return `蓄力中 ${Math.min(JUMP_MAX_CHARGE_MS, chargeMs)} / ${JUMP_MAX_CHARGE_MS} 毫秒`
    if (hud.lastKind === 'center') return `上一次：正中靶心 +${hud.lastGained}，连击 x${hud.combo}`
    if (hud.lastKind === 'normal') return `上一次：稳稳落盒 +1（偏移 ${formatJumpOffset(hud.lastOffset)}）`
    if (hud.jumps === 0) return '按住蓄力，松手起跳：蓄得越久跳得越远'
    return '按住屏幕继续跳'
  }, [over, charging, chargeMs, hud])

  return (
    <div className="gh-jump-board-area">
      <div className="gh-jump-cards" role="status" aria-live="polite">
        <span className="gh-jump-card">
          <span className="gh-jump-card-label">当前分数</span>
          <strong className="gh-jump-card-value">{hud.score}</strong>
        </span>
        <span className="gh-jump-card">
          <span className="gh-jump-card-label">连击</span>
          <strong className={`gh-jump-card-value${hud.combo > 0 ? ' gh-jump-card-value--hot' : ''}`}>
            x{hud.combo}
          </strong>
        </span>
        <span className="gh-jump-card">
          <span className="gh-jump-card-label">盒子进度</span>
          <strong className="gh-jump-card-value">
            {hud.boxIndex + 1}
            <span className="gh-jump-card-unit"> / 已跳 {hud.jumps}</span>
          </strong>
        </span>
        <span className="gh-jump-card">
          <span className="gh-jump-card-label">最高分</span>
          <strong className="gh-jump-card-value">{best}</strong>
        </span>
      </div>

      <div
        className={`gh-jump-stage${charging ? ' gh-jump-stage--charging' : ''}`}
        ref={stageRef}
        onPointerDown={(event) => {
          event.preventDefault()
          startCharge()
        }}
        onPointerUp={releaseCharge}
        onPointerCancel={releaseCharge}
        onPointerLeave={releaseCharge}
        onContextMenu={(event) => event.preventDefault()}
        role="button"
        tabIndex={0}
        aria-label="按住蓄力、松手起跳（也可直接按住空格键）"
      >
        <canvas ref={canvasRef} className="gh-jump-canvas" role="img" aria-label={ariaLabel} />

        <div className="gh-jump-power" aria-hidden="true">
          <div className="gh-jump-power-track">
            <div ref={barRef} className="gh-jump-power-bar" data-ratio="0" style={{ width: '0%' }} />
          </div>
          <span className="gh-jump-power-text">{landingHint}</span>
        </div>

        {over && (
          <div className="gh-jump-overlay" role="dialog" aria-modal="true" aria-label="本局结果">
            <div className="gh-jump-overlay-card">
              <p className="gh-jump-overlay-eyebrow">本局结束</p>
              <h2 className={`gh-jump-overlay-title${isRecord ? ' gh-jump-overlay-title--win' : ''}`}>
                {isRecord ? '新纪录！' : '掉出盒子了'}
              </h2>
              <p className="gh-jump-overlay-detail">
                {isRecord
                  ? `恭喜刷新账号最高分：${best} 分。`
                  : '蓄力不足会跳短、蓄过头会跳过 —— 记一下「间距 ↔ 时长」的手感再来一次。'}
              </p>
              <div className="gh-jump-overlay-scores">
                <span>
                  本局分数 <strong>{hud.score}</strong>
                </span>
                <span>
                  最远盒子 <strong>{hud.boxIndex + 1}</strong>
                </span>
                <span>
                  最高分 <strong>{best}</strong>
                </span>
              </div>
              <div className="gh-jump-overlay-actions">
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
      </div>

      <div className="gh-jump-toolbar">
        <button
          type="button"
          className="gh-jump-hold-btn"
          onPointerDown={(event) => {
            event.preventDefault()
            startCharge()
          }}
          onPointerUp={releaseCharge}
          onPointerCancel={releaseCharge}
          onPointerLeave={() => {
            if (chargeRef.current.active) releaseCharge()
          }}
          disabled={over}
          aria-label="按住蓄力，松手起跳"
        >
          {over ? '本局已结束' : charging ? `蓄力中 ${powerPercent}%` : '按住蓄力'}
        </button>
        <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={restart}>
          重置本局
        </button>
        <span className="gh-jump-toolbar-hint">
          当前力度 {powerPercent}%（约 {Math.round(jumpPowerRatio(chargeMs) * 260)} / 260 逻辑距离）·
          下一盒间距 {nextBox ? Math.round(nextBox.gap) : '—'}
        </span>
      </div>

      <div className="gh-jump-record" role="status">
        账号战绩 —— {stats.runs} 局 · 平均 {stats.runs > 0 ? (stats.totalScore / stats.runs).toFixed(1) : '0.0'} 分 ·
        历史最高连击 x{stats.bestCombo} · 平均最准落点偏差{' '}
        {formatJumpOffset(
          stats.offsetCount > 0 ? Math.round((stats.offsetSum / stats.offsetCount) * 10) / 10 : null
        )}
      </div>
    </div>
  )
}

// ==================== 页面 ====================

/**
 * 跳一跳单机页：长按蓄力、松手起跳，冲击账号最高分。
 * 判定与关卡序列在 lib/games/jump.ts（纯函数、可单测），本页只做输入与等距 canvas 渲染。
 * 好友轮流对战在 `/games/jump/online`。
 */
export default function JumpPage() {
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === 'dark'

  return (
    <div className="gh-page-container gh-games-page gh-jump-page">
      <header className="gh-games-header">
        <div className="gh-games-header-copy">
          <p className="gh-g2048-eyebrow">
            <Link to="/games">← 游戏大厅</Link>
          </p>
          <h1 className="gh-games-title">跳一跳</h1>
          <p className="gh-games-subtitle">
            按住屏幕蓄力，松手翻转起跳：蓄得越久跳得越远。落在盒面 +1 分，正中靶心 +2 起，
            连续中心按 2 / 4 / 8 / 16 / 32 翻倍，落空即结束。想和好友比分，点右上角「好友轮流」。
          </p>
        </div>
        <div className="gh-jump-header-actions">
          <Link className="gh-btn gh-btn--secondary gh-btn--md" to={GAME_JUMP_ONLINE_ROUTE}>
            好友轮流跳
          </Link>
        </div>
      </header>

      <div className="gh-jump-layout">
        <div className="gh-jump-main">
          <JumpBoard dark={dark} />
        </div>

        <aside className="gh-jump-help" aria-label="玩法说明">
          <h2 className="gh-jump-help-title">操作</h2>
          <ul className="gh-jump-help-list">
            <li>电脑：在画面上按住鼠标左键蓄力，松手起跳；也可以一直按住空格键。</li>
            <li>手机：手指按住画面（或下方「按住蓄力」大按钮），松手即跳。</li>
            <li>本局结束后：按回车或点「再来一局」重开，盒子路线会重新随机。</li>
          </ul>
          <h2 className="gh-jump-help-title">规则</h2>
          <ul className="gh-jump-help-list">
            <li>蓄力上限 {JUMP_MAX_CHARGE_MS} 毫秒，满蓄力跳 260 逻辑距离；时长与距离成正比。</li>
            <li>盒子中心间距在 60–150 之间随机，盒面上表面半宽 26–36，所以每一跳都要重新估时长。</li>
            <li>落点与盒面中心偏差在「半宽 × 0.3」以内算正中靶心，连击翻倍；在盒面内 +1 分并清零连击。</li>
            <li>偏差超过盒面半宽就掉出盒子：跳短（short）或跳过（long）都立即结束。</li>
            <li>最高分与战绩随账号保存。</li>
          </ul>
          <p className="gh-jump-help-note">
            画面全部程序化绘制（等距 2.5D：棱柱 / 圆柱盒子 + 带眼睛的小方块人），没有引入任何图片素材。
          </p>
          <Link to={GAME_JUMP_ONLINE_ROUTE} className="gh-jump-help-link">
            去好友轮流跳
          </Link>
        </aside>
      </div>
    </div>
  )
}
