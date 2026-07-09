// client/src/components/glass/LiquidGlass.tsx
import React, { useRef, useEffect, memo } from 'react'
import AdvancedGlass from 'liquid-glass-react'
import { useGlassCapabilities } from './useGlassCapabilities'

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
 * Map variant + chromatic props to liquid-glass-react props.
 *
 * variant → displacementScale + blurAmount + saturation:
 *   regular:  medium refraction, standard blur (matches lg-surface)
 *   strong:   heavy refraction, thick glass feel (matches lg-surface-strong)
 *   blur:     medium refraction, darker tint for content-heavy surfaces
 *
 * chromatic → aberrationIntensity:
 *   true:  2 (subtle RGB channel separation at edges)
 *   false: 0 (disabled)
 *
 * interactive → elasticity:
 *   true:  0.15 (subtle elastic pull toward cursor)
 *   false: 0 (rigid, no mouse response)
 */
function mapPropsToAdvanced(
  variant: 'regular' | 'strong' | 'blur',
  chromatic: boolean,
  interactive: boolean,
): {
  displacementScale: number
  blurAmount: number
  saturation: number
  aberrationIntensity: number
  elasticity: number
  cornerRadius: number
} {
  const base = {
    aberrationIntensity: chromatic ? 2 : 0,
    elasticity: interactive ? 0.15 : 0,
    cornerRadius: 28, // matches --lg-radius-xl
  }

  switch (variant) {
    case 'strong':
      return { ...base, displacementScale: 80, blurAmount: 0.06, saturation: 140 }
    case 'blur':
      return { ...base, displacementScale: 45, blurAmount: 0.05, saturation: 120 }
    case 'regular':
    default:
      return { ...base, displacementScale: 45, blurAmount: 0.05, saturation: 150 }
  }
}

/* ================================================================
   Advanced Mode — liquid-glass-react with SVG displacement
   Only active on Chromium desktop browsers.
   ================================================================ */
const AdvancedMode = memo(function AdvancedMode({
  children,
  variant,
  className = '',
  style,
  interactive,
  chromatic,
}: Required<Pick<LiquidGlassProps, 'children' | 'variant' | 'interactive' | 'chromatic'>> &
  Pick<LiquidGlassProps, 'className' | 'style'>) {
  const advancedProps = mapPropsToAdvanced(variant, chromatic, interactive)

  return (
    <AdvancedGlass
      {...advancedProps}
      className={className}
      style={style}
    >
      {children}
    </AdvancedGlass>
  )
})

/* ================================================================
   Legacy Mode — CSS-only glass (Safari, Firefox, mobile)
   Preserves the original implementation exactly.
   ================================================================ */
const LegacyMode = memo(function LegacyMode({
  children,
  variant = 'regular',
  className = '',
  style,
  interactive = true,
  chromatic = true,
}: Required<Pick<LiquidGlassProps, 'children' | 'variant' | 'interactive' | 'chromatic'>> &
  Pick<LiquidGlassProps, 'className' | 'style'>) {
  const ref = useRef<HTMLDivElement>(null)
  const specularRef = useRef<HTMLDivElement>(null)

  // Mouse-following specular highlight — 直接操作 DOM 避免重渲染
  useEffect(() => {
    if (!interactive) return
    const el = ref.current
    const specular = specularRef.current
    if (!el || !specular) return

    let cachedRect: DOMRect | null = null
    let rectFrame = 0
    let lastMove = 0
    const throttleMs = window.innerWidth <= 768 ? 50 : 16

    const onMove = (e: MouseEvent | TouchEvent) => {
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
    return () => {
      el.removeEventListener('mousemove', onMove)
      el.removeEventListener('touchmove', onMove)
      cancelAnimationFrame(rectFrame)
    }
  }, [interactive])

  const isStrong = variant === 'strong' || variant === 'blur'
  const isBlur = variant === 'blur'

  const glassClass = isBlur
    ? 'lg-surface-strong lg-surface-strong-blur'
    : isStrong
      ? 'lg-surface-strong'
      : 'lg-surface'

  const allClass = `${glassClass}${interactive ? '' : ' lg-surface-no-specular'} ${className}`.trim()

  return (
    <div ref={ref} className={allClass} style={style}>
      {/* Interactive specular highlight */}
      <div
        ref={specularRef}
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 'inherit',
          pointerEvents: 'none',
          zIndex: 3,
          background: interactive
            ? 'radial-gradient(circle at var(--lg-specular-x, 30%) var(--lg-specular-y, 20%), rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.08) 30%, transparent 60%)'
            : 'transparent',
          transition: interactive ? 'background 0.15s ease-out' : 'none',
        } as React.CSSProperties}
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
})

/* ================================================================
   Main Component — auto-selects mode based on browser capabilities
   Public API unchanged — all consumer files work without modification.
   ================================================================ */
const LiquidGlass = memo(function LiquidGlass({
  children,
  variant = 'regular',
  className = '',
  style,
  interactive = true,
  chromatic = true,
}: LiquidGlassProps) {
  const { supportsDisplacement } = useGlassCapabilities()

  const modeProps = {
    variant: variant ?? 'regular',
    interactive: interactive ?? true,
    chromatic: chromatic ?? true,
    className,
    style,
    children,
  }

  if (supportsDisplacement) {
    return <AdvancedMode {...modeProps} />
  }

  return <LegacyMode {...modeProps} />
})

export default LiquidGlass
