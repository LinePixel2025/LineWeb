import { createContext, useContext, useEffect, useRef, useCallback, type ReactNode } from 'react'
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

// 节流间隔（毫秒）
const SCAN_THROTTLE_MS = 150

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
  const lastScanTime = useRef(0)
  const location = useLocation()

  /* 2. 核心扫描函数 — 批量读取像素，先读 rect 再批量写 data-ac */
  const doScan = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = canvas.width, H = canvas.height
    const vw = window.innerWidth, vh = window.innerHeight

    // 一次读取全 canvas 像素
    const fullData = ctx.getImageData(0, 0, W, H).data

    // 批量收集所有需要更新的元素和目标值
    const elements = document.querySelectorAll(SCAN_SELECTOR)
    const updates: Array<{ el: Element; value: string | null }> = []

    for (const el of elements) {
      if (isExcluded(el)) {
        updates.push({ el, value: null })
        continue
      }

      const rect = el.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) continue

      const cx = (rect.left + rect.width / 2) / vw * W
      const cy = (rect.top + rect.height / 2) / vh * H
      const ix = Math.round(Math.max(0, Math.min(W - 1, cx)))
      const iy = Math.round(Math.max(0, Math.min(H - 1, cy)))
      const i = (iy * W + ix) * 4

      const lum = luminance(fullData[i], fullData[i + 1], fullData[i + 2])
      updates.push({ el, value: lum > 120 ? 'black' : 'white' })
    }

    // 批量写入 — 读写分离避免 layout thrashing
    for (const { el, value } of updates) {
      if (value === null) {
        el.removeAttribute('data-ac')
      } else {
        el.setAttribute('data-ac', value)
      }
    }
  }, [])

  /* 150ms 时间节流调度 */
  const scheduleScan = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    const now = performance.now()
    const elapsed = now - lastScanTime.current

    if (elapsed >= SCAN_THROTTLE_MS) {
      // 已过节流窗口，下一帧立即执行
      lastScanTime.current = now
      rafRef.current = requestAnimationFrame(doScan)
    } else {
      // 延迟到节流窗口结束
      const delay = SCAN_THROTTLE_MS - elapsed
      rafRef.current = requestAnimationFrame(() => {
        lastScanTime.current = performance.now()
        doScan()
      })
    }
  }, [doScan])

  /* 1. 壁纸变化 → 重建合成 canvas */
  useEffect(() => {
    if (!bgUrl) {
      // 无壁纸时释放 canvas 并清理所有 data-ac
      if (canvasRef.current) {
        canvasRef.current.width = 0
        canvasRef.current = null
      }
      document.querySelectorAll('[data-ac]').forEach(el => el.removeAttribute('data-ac'))
      return
    }
    let cancelled = false

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (cancelled) return
      // 释放旧 canvas
      if (canvasRef.current) canvasRef.current.width = 0
      canvasRef.current = buildWallpaperCanvas(img)
      img.src = '' // 释放 Image 内存
      scheduleScan()
    }
    img.onerror = () => {
      canvasRef.current = null
      img.src = ''
    }
    img.src = bgUrl
    return () => {
      cancelled = true
    }
  }, [bgUrl, scheduleScan])

  /* 3. 触发场景 */
  useEffect(() => { scheduleScan() }, [location.pathname, scheduleScan])

  useEffect(() => {
    const onScroll = () => scheduleScan()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [scheduleScan])

  useEffect(() => {
    const onResize = () => scheduleScan()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [scheduleScan])

  // 首次挂载后扫（用 rAF 链避免 300ms 脆皮定时器）
  useEffect(() => {
    let id = requestAnimationFrame(function check() {
      if (canvasRef.current) { scheduleScan(); return }
      id = requestAnimationFrame(check)
    })
    return () => cancelAnimationFrame(id)
  }, [scheduleScan])

  // 卸载时释放资源
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current)
      if (canvasRef.current) {
        canvasRef.current.width = 0
        canvasRef.current = null
      }
      document.querySelectorAll('[data-ac]').forEach(el => el.removeAttribute('data-ac'))
    }
  }, [])

  return <ContrastContext.Provider value={null}>{children}</ContrastContext.Provider>
}

export function useContrast() {
  return useContext(ContrastContext)
}
