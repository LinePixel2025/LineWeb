import React, { useRef, useState, useEffect } from 'react'

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
export default function LiquidGlass({
  children,
  variant = 'regular',
  className = '',
  style,
  interactive = true,
  chromatic = true,
}: LiquidGlassProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [lightPos, setLightPos] = useState({ x: 30, y: 20 })

  // Mouse-following specular highlight
  useEffect(() => {
    if (!interactive) return
    const el = ref.current
    if (!el) return

    const onMove = (e: MouseEvent | TouchEvent) => {
      const rect = el.getBoundingClientRect()
      let cx = 0, cy = 0
      if ('touches' in e && e.touches.length > 0) {
        cx = e.touches[0].clientX - rect.left
        cy = e.touches[0].clientY - rect.top
      } else if ('clientX' in e) {
        cx = e.clientX - rect.left
        cy = e.clientY - rect.top
      }
      setLightPos({
        x: Math.max(5, Math.min(95, (cx / rect.width) * 100)),
        y: Math.max(5, Math.min(95, (cy / rect.height) * 100)),
      })
    }

    el.addEventListener('mousemove', onMove)
    el.addEventListener('touchmove', onMove, { passive: true })
    return () => {
      el.removeEventListener('mousemove', onMove)
      el.removeEventListener('touchmove', onMove)
    }
  }, [interactive])

  const isStrong = variant === 'strong' || variant === 'blur'
  const isBlur = variant === 'blur'

  // 使用 CSS class 驱动玻璃效果 — 确保与全局样式 100% 一致
  const glassClass = isBlur
    ? 'lg-surface-strong lg-surface-strong-blur'
    : isStrong
      ? 'lg-surface-strong'
      : 'lg-surface'

  // 交互式镜面高光 — 替代 CSS ::after 静态高光
  const specularGrad = interactive
    ? `radial-gradient(circle at ${lightPos.x}% ${lightPos.y}%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.08) 30%, transparent 60%)`
    : 'transparent'

  const allClass = `${glassClass}${interactive ? '' : ' lg-surface-no-specular'} ${className}`.trim()

  return (
    <div
      ref={ref}
      className={allClass}
      style={{
        // 仅覆盖必要的结构样式，背景/滤镜/阴影均由 CSS 类控制
        ...style,
      }}
    >
      {/* Interactive specular highlight — 鼠标跟随高光，覆盖 CSS ::after */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 'inherit',
          pointerEvents: 'none',
          zIndex: 3,
          background: specularGrad,
          transition: interactive ? 'background 0.15s ease-out' : 'none',
        }}
      />

      {/* Top edge rim glow */}
      {interactive && (
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

      {/* Chromatic aberration edge refraction */}
      {chromatic && (
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
}
