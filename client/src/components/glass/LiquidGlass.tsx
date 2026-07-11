import React, { useRef, useEffect, memo } from 'react'
import { useGlass } from '../../contexts/GlassContext'

export interface LiquidGlassProps {
  children: React.ReactNode
  /** strong — 对应 lg-surface-strong；regular — 对应 lg-surface；blur — 对应 lg-surface-strong-blur */
  variant?: 'regular' | 'strong' | 'blur'
  className?: string
  style?: React.CSSProperties
  /** Enable interactive specular highlight (mouse/touch follow) */
  interactive?: boolean
  /** Show chromatic aberration edge refraction */
  chromatic?: boolean
}

/**
 * Liquid Glass component — 利用已有的 CSS 类实现玻璃效果，
 * 同时叠加交互式镜面高光和色差边缘。
 *
 * 折射和毛玻璃由 CSS lg-surface / lg-surface-strong 类的
 * backdrop-filter + ::before 驱动，保证与纯 CSS 用法效果完全一致。
 *
 * 结构：
 *   ┌──────────────────────────────┐
 *   │  interactive highlight (z:3)  │  鼠标跟随镜面高光
 *   │  content (z:2)                │  子内容
 *   │  rim glow (z:1)               │  上边缘泛光
 *   │  CSS element (z:0)            │  SVG refr + blur + tint + shadow
 *   │  CSS ::before (z:-1)          │  heavy blur(16.8px) frosted underlay
 *   │  CSS ::after (z:1)            │  static specular (被 interactive 覆盖)
 *   └──────────────────────────────┘
 */
const LiquidGlass = memo(function LiquidGlass({
  children,
  variant = 'regular',
  className = '',
  style,
  interactive = true,
  chromatic = true,
}: LiquidGlassProps) {
  const { glassEnabled } = useGlass()
  const ref = useRef<HTMLDivElement>(null)
  const specularRef = useRef<HTMLDivElement>(null)

  // Mouse-following specular highlight — 直接操作 DOM 避免重渲染
  useEffect(() => {
    if (!interactive || !glassEnabled) return
    const el = ref.current
    const specular = specularRef.current
    if (!el || !specular) return

    let cachedRect: DOMRect | null = null
    let rectFrame = 0
    let lastMove = 0
    const throttleMs = window.innerWidth <= 768 ? 50 : 16

    const onMove = (e: MouseEvent | TouchEvent) => {
      specular.style.opacity = '1'
      // 每帧只读一次 getBoundingClientRect
      if (!cachedRect) {
        cachedRect = el.getBoundingClientRect()
        rectFrame = requestAnimationFrame(() => { cachedRect = null })
      }

      const now = Date.now()
      if (now - lastMove < throttleMs) return
      lastMove = now

      let cx = 0, cy = 0
      if ('touches' in e && e.touches.length > 0) {
        cx = e.touches[0].clientX - cachedRect.left
        cy = e.touches[0].clientY - cachedRect.top
      } else if ('clientX' in e) {
        cx = e.clientX - cachedRect.left
        cy = e.clientY - cachedRect.top
      }

      const x = Math.max(5, Math.min(95, (cx / cachedRect.width) * 100))
      const y = Math.max(5, Math.min(95, (cy / cachedRect.height) * 100))
      specular.style.background = `radial-gradient(circle at ${x}% ${y}%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.08) 30%, transparent 60%)`
    }

    el.addEventListener('mousemove', onMove)
    el.addEventListener('touchmove', onMove, { passive: true })

    const onEnter = () => {
      specular.style.opacity = '1'
    }
    const onLeave = () => {
      specular.style.opacity = '0'
    }

    el.addEventListener('mouseenter', onEnter)
    el.addEventListener('mouseleave', onLeave)
    return () => {
      el.removeEventListener('mousemove', onMove)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('mouseenter', onEnter)
      el.removeEventListener('mouseleave', onLeave)
      cancelAnimationFrame(rectFrame)
    }
  }, [interactive, glassEnabled])

  const isStrong = variant === 'strong' || variant === 'blur'
  const isBlur = variant === 'blur'

  // 使用 CSS class 驱动玻璃效果 — 确保与全局样式 100% 一致
  const glassClass = isBlur
    ? 'lg-surface-strong lg-surface-strong-blur'
    : isStrong
      ? 'lg-surface-strong'
      : 'lg-surface'

  const allClass = `${glassClass}${interactive ? '' : ' lg-surface-no-specular'} ${className}`.trim()

  return (
    <div
      ref={ref}
      className={allClass}
      style={style}
    >
      {/* Interactive specular highlight — only when glass is fully enabled */}
      {glassEnabled && (
        <div
          ref={specularRef}
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            pointerEvents: 'none',
            zIndex: 3,
            '--lg-specular-x': '30%',
            '--lg-specular-y': '20%',
            opacity: 0,
            background: interactive
              ? 'radial-gradient(circle at var(--lg-specular-x, 30%) var(--lg-specular-y, 20%), rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.08) 30%, transparent 60%)'
              : 'transparent',
            transition: interactive ? 'opacity 0.6s ease-out' : 'none',
          } as React.CSSProperties}
        />
      )}

      {/* Top edge rim glow — only when glass is fully enabled */}
      {glassEnabled && interactive && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            pointerEvents: 'none',
            zIndex: 1,
            background: 'linear-gradient(180deg, rgba(255,255,255,0.10) 0%, transparent 40%)',
          }}
        />
      )}

      {/* Chromatic aberration — only when glass is fully enabled */}
      {glassEnabled && chromatic && (
        <>
          <div
            style={{
              position: 'absolute',
              inset: -2,
              borderRadius: 'inherit',
              border: '1.5px solid rgba(255,50,50,0.06)',
              pointerEvents: 'none',
              zIndex: 0,
              transform: 'translateX(1.5px)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: -2,
              borderRadius: 'inherit',
              border: '1.5px solid rgba(50,100,255,0.06)',
              pointerEvents: 'none',
              zIndex: 0,
              transform: 'translateX(-1.5px)',
            }}
          />
        </>
      )}

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 2 }}>
        {children}
      </div>
    </div>
  )
})

export default LiquidGlass
