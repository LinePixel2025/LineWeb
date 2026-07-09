import { useMemo } from 'react'

interface GlassCapabilities {
  supportsDisplacement: boolean
  isMobile: boolean
}

export function useGlassCapabilities(): GlassCapabilities {
  return useMemo(() => {
    if (typeof window === 'undefined') return { supportsDisplacement: false, isMobile: false }
    const ua = navigator.userAgent.toLowerCase()
    const isChromium = !!(window as any).chrome || ua.includes('chrome') || ua.includes('edg/')
    const isMobile = window.innerWidth <= 768 || /android|iphone|ipad|ipod/i.test(ua)
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    return {
      supportsDisplacement: isChromium && !isMobile && !prefersReducedMotion,
      isMobile,
    }
  }, [])
}
