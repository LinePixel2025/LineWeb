import { useState, useEffect } from 'react'

interface GlassCapabilities {
  /** Browser supports SVG feDisplacementMap in backdrop-filter (Chromium desktop) */
  supportsDisplacement: boolean
  /** Mobile device or narrow viewport — skip heavy effects */
  isMobile: boolean
}

/**
 * Detects whether the current browser/device can render SVG displacement
 * effects properly. Only Chromium desktop browsers support feDisplacementMap
 * in backdrop-filter. Safari and Firefox silently ignore it.
 *
 * Mobile devices are always flagged — globals.css already downgrades
 * backdrop-filter at ≤768px, and liquid-glass-react's SVG filters
 * would cause GPU pressure on mobile.
 */
export function useGlassCapabilities(): GlassCapabilities {
  const [capabilities, setCapabilities] = useState<GlassCapabilities>({
    supportsDisplacement: false,
    isMobile: false,
  })

  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase()
    const isChromium = !!(window as any).chrome || ua.includes('chrome') || ua.includes('edg/')
    const isMobile = window.innerWidth <= 768 || /android|iphone|ipad|ipod/i.test(ua)
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    setCapabilities({
      supportsDisplacement: isChromium && !isMobile && !prefersReducedMotion,
      isMobile,
    })
  }, [])

  return capabilities
}
