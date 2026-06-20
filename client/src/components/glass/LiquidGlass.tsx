import React, { useRef, useState, useEffect, useMemo } from 'react'

const THICKNESS_MAP = {
  thin: { refraction: '25', blur: '0.3px', glow: '8px', shadowOpacity: 0.2 },
  medium: { refraction: '45', blur: '0.5px', glow: '12px', shadowOpacity: 0.35 },
  thick: { refraction: '70', blur: '0.8px', glow: '18px', shadowOpacity: 0.5 },
} as const

function hexToRgb(hex: string): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.substring(0, 2), 16)
  const g = parseInt(clean.substring(2, 4), 16)
  const b = parseInt(clean.substring(4, 6), 16)
  return `${r}, ${g}, ${b}`
}

export interface LiquidGlassProps {
  children: React.ReactNode
  variant?: 'regular' | 'strong' | 'clear'
  thickness?: 'thin' | 'medium' | 'thick'
  tint?: string
  className?: string
  style?: React.CSSProperties
  /** Enable interactive light follow (mouse/touch) */
  interactive?: boolean
  /** Show chromatic aberration edge effect */
  chromatic?: boolean
}

/**
 * Liquid Glass component
 * Refracts background content, applies specular highlights,
 * and simulates real glass optical properties.
 */
export default function LiquidGlass({
  children,
  variant = 'regular',
  thickness = 'medium',
  tint,
  className = '',
  style,
  interactive = true,
  chromatic = true,
}: LiquidGlassProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [lightPos, setLightPos] = useState({ x: 50, y: 50 })

  // Mouse-following light effect
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
      const x = (cx / rect.width) * 100
      const y = (cy / rect.height) * 100
      setLightPos({ x: Math.max(5, Math.min(95, x)), y: Math.max(5, Math.min(95, y)) })
    }

    el.addEventListener('mousemove', onMove)
    el.addEventListener('touchmove', onMove, { passive: true })
    return () => {
      el.removeEventListener('mousemove', onMove)
      el.removeEventListener('touchmove', onMove)
    }
  }, [interactive])

  const t = THICKNESS_MAP[thickness]

  // Dynamic specular highlight — follows cursor
  const specularGradient = interactive
    ? `radial-gradient(circle at ${lightPos.x}% ${lightPos.y}%, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.08) 30%, transparent 60%)`
    : 'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.06) 40%, transparent 60%)'

  // Tint, if provided
  const tintBg = useMemo(
    () => (tint ? `rgba(${hexToRgb(tint)}, 0.15)` : undefined),
    [tint],
  )

  return (
    <div
      ref={ref}
      className={`liquid-glass ${variant} ${className}`}
      style={{
        position: 'relative',
        borderRadius: 'var(--lg-radius-xl)',
        overflow: 'hidden',

        // === Core glass surface ===
        background: tintBg || 'rgba(255,255,255,0.06)',
        backdropFilter: `url(#lg-core) blur(${t.blur}) saturate(160%) brightness(1.05)`,
        WebkitBackdropFilter: `url(#lg-core) blur(${t.blur}) saturate(160%) brightness(1.05)`,

        // === Border — glass edge ===
        border: '1px solid rgba(255,255,255,0.20)',
        borderRightColor: 'rgba(255,255,255,0.12)',
        borderBottomColor: 'rgba(255,255,255,0.08)',

        // === Box shadow — dynamic lens shadow ===
        boxShadow: `
          inset 0 0 0 0.5px rgba(255,255,255,0.15),
          inset 0 2px ${t.glow} rgba(255,255,255,0.08),
          0 ${4 + (thickness === 'thick' ? 8 : 0)}px ${16 + (thickness === 'thick' ? 16 : 0)}px rgba(0,0,0,${t.shadowOpacity}),
          0 2px 4px rgba(0,0,0,${t.shadowOpacity * 0.6})
        `,

        ...style,
      }}
    >
      {/* Specular highlight overlay — follows cursor */}
      <div
        className="lg-specular"
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 'inherit',
          background: specularGradient,
          pointerEvents: 'none',
          zIndex: 2,
          transition: 'background 0.15s ease-out',
        }}
      />

      {/* Top edge rim light */}
      <div
        className="lg-rim"
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 'inherit',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, transparent 40%, transparent 80%, rgba(0,0,0,0.04) 100%)',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />

      {/* Chromatic aberration edge refraction */}
      {chromatic && (
        <>
          <div
            className="lg-chromatic-r"
            style={{
              position: 'absolute',
              inset: -2,
              borderRadius: 'inherit',
              border: '1.5px solid rgba(255, 50, 50, 0.08)',
              pointerEvents: 'none',
              zIndex: 0,
              transform: 'translateX(1.5px)',
            }}
          />
          <div
            className="lg-chromatic-b"
            style={{
              position: 'absolute',
              inset: -2,
              borderRadius: 'inherit',
              border: '1.5px solid rgba(50, 100, 255, 0.08)',
              pointerEvents: 'none',
              zIndex: 0,
              transform: 'translateX(-1.5px)',
            }}
          />
        </>
      )}

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 3, isolation: 'isolate' }}>
        {children}
      </div>
    </div>
  )
}
