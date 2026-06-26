import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useWallpaper } from './WallpaperContext'

const ContrastContext = createContext(null)

/* 需要反色的文本元素 */
const SCAN_SELECTOR = [
  'h1, h2, h3, h4, h5, h6, p, span, a, button, li, blockquote, label, th, td, small, strong, em, code, pre',
  '.calc-expression, .calc-display',
].join(', ')

/* 不需要反色的元素 — 按钮、输入框、主题切换等自身有固定配色 */
const EXCLUDE_CLASSES = [
  '.article-content', '.liquid-btn', '.lg-input', '.calc-btn',
  '.theme-toggle', '.admin-page-btn', '.wallpaper-refresh-btn',
  '.admin-header h1', '.admin-layout',
  '.post-title', '.profile-page',
  '.comment-section', '.reply-form',
]

// 防抖：N 个动画帧中只扫描一次
const SCAN_FRAME_INTERVAL = 3

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/**
 * 将壁纸 + 渐变叠加层合成到一个 canvas
 * 使用 CanvasGradient API 替代逐像素循环
 */
function buildWallpaperCanvas(img: HTMLImageElement): HTMLCanvasElement | null {
  const W = 200
  const H = Math.round(W * (img.naturalHeight / img.naturalWidth))
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')
  if (!ctx) return null

  ctx.drawImage(img, 0, 0, W, H)

  // 用 CanvasGradient 叠加渐变层（匹配 Layout 的 linear-gradient 参数）
  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, 'rgba(0,0,0,0.35)')
  grad.addColorStop(0.5, 'rgba(0,0,0,0.15)')
  grad.addColorStop(1, 'rgba(0,0,0,0.40)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  return c
}

function isExcluded(el: Element): boolean {
  for (const cls of EXCLUDE_CLASSES) {
    if (el.closest(cls)) return true
  }
  return false
}

// ============================================================

export function ContrastProvider({ children }: { children: ReactNode }) {
  const { bgUrl } = useWallpaper()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef(0)
  const frameCountRef = useRef(0)
  const location = useLocation()

  /* 1. 壁纸变化 → 重建合成 canvas */
  useEffect(() => {
    if (!bgUrl) {
      // 无壁纸时清理所有 data-ac
      canvasRef.current = null
      document.querySelectorAll('[data-ac]').forEach(el => el.removeAttribute('data-ac'))
      return
    }
    let cancelled = false

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (cancelled) return
      canvasRef.current = buildWallpaperCanvas(img)
      scheduleScan()
    }
    img.onerror = () => { canvasRef.current = null }
    img.src = bgUrl
    return () => { cancelled = true }
  }, [bgUrl])

  /* 2. 核心扫描函数 — 批量读取像素，避免逐元素 getImageData */
  const doScan = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = canvas.width, H = canvas.height
    const vw = window.innerWidth, vh = window.innerHeight

    // 一次读取全 canvas 像素
    const fullData = ctx.getImageData(0, 0, W, H).data

    const scanEl = (el: Element) => {
      if (isExcluded(el)) {
        el.removeAttribute('data-ac')
        return
      }

      const rect = el.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return

      const cx = (rect.left + rect.width / 2) / vw * W
      const cy = (rect.top + rect.height / 2) / vh * H
      const ix = Math.round(Math.max(0, Math.min(W - 1, cx)))
      const iy = Math.round(Math.max(0, Math.min(H - 1, cy)))
      const i = (iy * W + ix) * 4

      const lum = luminance(fullData[i], fullData[i + 1], fullData[i + 2])
      el.setAttribute('data-ac', lum > 120 ? 'black' : 'white')
    }

    const elements = document.querySelectorAll(SCAN_SELECTOR)
    for (const el of elements) scanEl(el)
  }

  const scheduleScan = () => {
    cancelAnimationFrame(rafRef.current)
    frameCountRef.current = 0
    rafRef.current = requestAnimationFrame(function tick() {
      if (frameCountRef.current % SCAN_FRAME_INTERVAL === 0) {
        doScan()
      }
      frameCountRef.current++
    })
  }

  /* 3. 触发场景 */
  useEffect(() => { scheduleScan() }, [location.pathname])

  useEffect(() => {
    const onScroll = () => scheduleScan()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const onResize = () => scheduleScan()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 首次挂载后扫（用 rAF 链避免 300ms 脆皮定时器）
  useEffect(() => {
    let id = requestAnimationFrame(function check() {
      if (canvasRef.current) { scheduleScan(); return }
      id = requestAnimationFrame(check)
    })
    return () => cancelAnimationFrame(id)
  }, [])

  return <ContrastContext.Provider value={null}>{children}</ContrastContext.Provider>
}

export function useContrast() {
  return useContext(ContrastContext)
}
