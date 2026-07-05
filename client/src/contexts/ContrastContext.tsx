import { createContext, useContext, useEffect, useRef, useCallback, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useWallpaper } from './WallpaperContext'

const ContrastContext = createContext(null)

/* 仅扫描页面内容区域内需要反色的文本元素 */
const SCAN_SELECTOR = [
  'h1, h2, h3, h4, h5, h6, p, span, a, li, label, th, td, small, strong, em, code, pre',
  '.calc-expression, .calc-display',
].join(', ')

/* 不需要反色的元素 — 按钮、输入框等自身有固定配色 */
const EXCLUDE_CLASSES = [
  '.article-content', '.liquid-btn', '.lg-input', '.calc-btn',
  '.theme-toggle', '.admin-page-btn', '.wallpaper-refresh-btn',
  '.admin-header h1', '.admin-layout',
  '.post-title', '.profile-page', '.drive-page',
  '.comment-section', '.reply-form',
]

/* 管理后台页面 — 完全不扫描 */
const ADMIN_PATHS = ['/admin']

/* 滚动节流间隔（ms）— 移动端不需要每帧扫描 */
const SCROLL_THROTTLE_MS = 200

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function buildWallpaperCanvas(img: HTMLImageElement): HTMLCanvasElement | null {
  const W = 200
  const H = Math.round(W * (img.naturalHeight / img.naturalWidth))
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, W, H)
  return c
}

function gradientOverlayAlpha(t: number): number {
  if (t <= 0.5) return 0.35 - (0.35 - 0.15) * (t / 0.5)
  return 0.15 + (0.40 - 0.15) * ((t - 0.5) / 0.5)
}

function isExcluded(el: Element): boolean {
  for (const cls of EXCLUDE_CLASSES) {
    if (el.closest(cls)) return true
  }
  return false
}

/* 检测是否应禁用扫描：移动端或用户偏好减少动画 */
function shouldDisableScan(): boolean {
  if (typeof window === 'undefined') return true
  // 移动端默认禁用（backdrop-filter 已降级，文本反色不必要）
  if (window.innerWidth <= 768) return true
  // 用户偏好减少动画
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true
  return false
}

// ============================================================

export function ContrastProvider({ children }: { children: ReactNode }) {
  const { bgUrl } = useWallpaper()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef(0)
  const lastScanRef = useRef(0)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const location = useLocation()
  const isAdminPath = ADMIN_PATHS.some(p => location.pathname.startsWith(p))

  /* 核心扫描 — 仅扫描视口内元素，避免全屏像素读回 */
  const doScan = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (shouldDisableScan()) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = canvas.width, H = canvas.height
    const vw = window.innerWidth, vh = window.innerHeight

    const coverScale = Math.max(vw / W, vh / H)
    const cropOffX = Math.max(0, (W * coverScale - vw) / 2)
    const cropOffY = Math.max(0, (H * coverScale - vh) / 2)

    let fullData: Uint8ClampedArray
    try {
      fullData = ctx.getImageData(0, 0, W, H).data
    } catch {
      return
    }

    const elements = document.querySelectorAll(SCAN_SELECTOR)
    const updates: Array<{ el: Element; value: string | null }> = []

    // 视口边界（带 50px 缓冲区，避免边缘元素漏判）
    const viewportTop = -50
    const viewportBottom = vh + 50

    for (const el of elements) {
      if (isExcluded(el)) {
        updates.push({ el, value: null })
        continue
      }

      const rect = el.getBoundingClientRect()
      // 跳过视口外的元素 — 显著减少计算量
      if (rect.bottom < viewportTop || rect.top > viewportBottom) continue
      if (rect.width < 1 || rect.height < 1) continue

      const sx = rect.left + rect.width / 2
      const sy = rect.top + rect.height / 2
      const cx = (sx + cropOffX) / coverScale
      const cy = (sy + cropOffY) / coverScale
      const ix = Math.round(Math.max(0, Math.min(W - 1, cx)))
      const iy = Math.round(Math.max(0, Math.min(H - 1, cy)))
      const i = (iy * W + ix) * 4

      // 3×3 区域平均亮度
      let totalLum = 0, count = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const px = Math.max(0, Math.min(W - 1, ix + dx))
          const py = Math.max(0, Math.min(H - 1, iy + dy))
          const pi = (py * W + px) * 4
          totalLum += luminance(fullData[pi], fullData[pi + 1], fullData[pi + 2])
          count++
        }
      }
      let avgLum = totalLum / count

      const t = sy / vh
      const alpha = gradientOverlayAlpha(t)
      avgLum *= (1 - alpha)

      updates.push({ el, value: avgLum > 128 ? 'black' : 'white' })
    }

    // 批量写入
    for (const { el, value } of updates) {
      if (value === null) {
        el.removeAttribute('data-ac')
      } else {
        el.setAttribute('data-ac', value)
      }
    }
  }, [])

  /* RAF 包装的调度 — 合并多次请求为单次扫描 */
  const scheduleScan = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(doScan)
  }, [doScan])

  /* 节流的扫描 — 滚动时最多每 200ms 扫描一次 */
  const throttledScan = useCallback(() => {
    if (scrollTimerRef.current) return
    const now = Date.now()
    const elapsed = now - lastScanRef.current
    const delay = Math.max(0, SCROLL_THROTTLE_MS - elapsed)
    scrollTimerRef.current = setTimeout(() => {
      scrollTimerRef.current = null
      lastScanRef.current = Date.now()
      scheduleScan()
    }, delay)
  }, [scheduleScan])

  /* 壁纸变化 → 重建 canvas */
  useEffect(() => {
    if (!bgUrl) {
      if (canvasRef.current) {
        canvasRef.current.width = 0
        canvasRef.current = null
      }
      document.querySelectorAll('[data-ac]').forEach(el => el.removeAttribute('data-ac'))
      return
    }
    let cancelled = false

    const queryUrl = bgUrl.replace(/[?&]_t=\d+$/, '')

    const loadViaProxy = async () => {
      try {
        const resp = await fetch(`/api/bing-wallpaper/proxy?url=${encodeURIComponent(queryUrl)}`)
        if (!resp.ok) throw new Error(`Proxy returned ${resp.status}`)
        const blob = await resp.blob()
        if (cancelled) return
        const blobUrl = URL.createObjectURL(blob)

        const img = new Image()
        img.onload = () => {
          if (cancelled) { URL.revokeObjectURL(blobUrl); return }
          if (canvasRef.current) canvasRef.current.width = 0
          canvasRef.current = buildWallpaperCanvas(img)
          URL.revokeObjectURL(blobUrl)
          scheduleScan()
        }
        img.onerror = () => {
          URL.revokeObjectURL(blobUrl)
          canvasRef.current = null
        }
        img.src = blobUrl
      } catch {
        canvasRef.current = null
      }
    }
    loadViaProxy()

    return () => { cancelled = true }
  }, [bgUrl, scheduleScan])

  /* 路由变化 → 扫描（跳过管理后台） */
  useEffect(() => {
    if (isAdminPath) {
      document.querySelectorAll('[data-ac]').forEach(el => el.removeAttribute('data-ac'))
      return
    }
    scheduleScan()
  }, [location.pathname, scheduleScan, isAdminPath])

  /* 滚动 → 节流扫描（非管理后台时） */
  useEffect(() => {
    if (isAdminPath || shouldDisableScan()) return
    const onScroll = () => throttledScan()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current)
        scrollTimerRef.current = null
      }
    }
  }, [throttledScan, isAdminPath])

  /* 窗口大小变化 → ResizeObserver 延迟扫描 */
  useEffect(() => {
    if (isAdminPath || shouldDisableScan()) return
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const ro = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => scheduleScan(), 300)
    })
    ro.observe(document.documentElement)
    return () => {
      ro.disconnect()
      if (resizeTimer) clearTimeout(resizeTimer)
    }
  }, [scheduleScan, isAdminPath])

  /* 首次挂载后找 canvas 触发扫描 */
  useEffect(() => {
    if (isAdminPath || shouldDisableScan()) return
    let id = requestAnimationFrame(function check() {
      if (canvasRef.current) { scheduleScan(); return }
      id = requestAnimationFrame(check)
    })
    return () => cancelAnimationFrame(id)
  }, [scheduleScan, isAdminPath])

  /* 卸载时清理 */
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current)
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
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
