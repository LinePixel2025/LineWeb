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
  '.post-title', '.profile-page', '.drive-page',
  '.comment-section', '.reply-form',
]

// 节流间隔（毫秒）
const SCAN_THROTTLE_MS = 150

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/**
 * 将壁纸绘制到 canvas（不叠加渐变 — 渐变在 doScan 中数学计算，
 * 避免 cover 裁剪导致的渐变位置偏移）
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
  return c
}

/**
 * Layout 中 linear-gradient 的 alpha 计算
 * 渐变: 0% → 0.35, 50% → 0.15, 100% → 0.40（黑色叠加）
 * t: 0 视口顶部, 1 视口底部
 */
function gradientOverlayAlpha(t: number): number {
  if (t <= 0.5) return 0.35 - (0.35 - 0.15) * (t / 0.5)    // 0.35 → 0.15
  return 0.15 + (0.40 - 0.15) * ((t - 0.5) / 0.5)          // 0.15 → 0.40
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

    /* 模拟 background-size: cover 的坐标映射
     *
     * cover 将 canvas 放大到完全覆盖视口，较短边居中裁剪。
     * coverScale = max(vw/W, vh/H) — 渲染缩放倍数
     * cropOff = (dim * coverScale - viewport) / 2 — 被裁剪的像素（屏幕空间）
     * 逆变换：canvasCoord = (screenCoord + cropOff) / coverScale
     */
    const coverScale = Math.max(vw / W, vh / H)
    const cropOffX = Math.max(0, (W * coverScale - vw) / 2)
    const cropOffY = Math.max(0, (H * coverScale - vh) / 2)

    // 一次读取全 canvas 像素（无渐变叠加，渐变在下方数学计算）
    let fullData: Uint8ClampedArray
    try {
      fullData = ctx.getImageData(0, 0, W, H).data
    } catch (e) {
      console.warn('[Contrast] getImageData failed (canvas tainted?)', e)
      return
    }

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

      const sx = rect.left + rect.width / 2
      const sy = rect.top + rect.height / 2
      const cx = (sx + cropOffX) / coverScale
      const cy = (sy + cropOffY) / coverScale
      const ix = Math.round(Math.max(0, Math.min(W - 1, cx)))
      const iy = Math.round(Math.max(0, Math.min(H - 1, cy)))
      const i = (iy * W + ix) * 4

      // 3×3 区域平均亮度，避免单像素抖动
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

      // 数学叠加渐变层 α，匹配 Layout 的 linear-gradient
      const t = sy / vh  // 0=视口顶, 1=视口底
      const alpha = gradientOverlayAlpha(t)
      avgLum *= (1 - alpha)

      // 亮度阈值 128（全范围 0-255，叠加黑色渐变后合理）
      updates.push({ el, value: avgLum > 128 ? 'black' : 'white' })
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

    // 使用后端代理加载壁纸，避免 canvas 被跨域图片污损导致 getImageData 抛出 SecurityError
    const queryUrl = bgUrl.replace(/[?&]_t=\d+$/, '')

    const loadViaProxy = async () => {
      try {
        const resp = await fetch(`/api/bing-wallpaper/proxy?url=${encodeURIComponent(queryUrl)}`)
        if (!resp.ok) throw new Error(`Proxy returned ${resp.status}`)
        const blob = await resp.blob()
        if (cancelled) return
        const blobUrl = URL.createObjectURL(blob)

        const img = new Image()
        // 同源的 blob URL，无需 crossOrigin 属性
        img.onload = () => {
          if (cancelled) { URL.revokeObjectURL(blobUrl); return }
          // 释放旧 canvas
          if (canvasRef.current) canvasRef.current.width = 0
          canvasRef.current = buildWallpaperCanvas(img)
          URL.revokeObjectURL(blobUrl) // 加载到 canvas 后可释放 blob URL
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
