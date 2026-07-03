import { useState, useEffect } from 'react'

export type Breakpoint = 'mobile' | 'tablet' | 'desktop'

function getBreakpoint(): Breakpoint {
  if (typeof window === 'undefined') return 'desktop'
  if (window.innerWidth <= 480) return 'mobile'
  if (window.innerWidth <= 768) return 'tablet'
  return 'desktop'
}

export function useResponsive() {
  const [bp, setBp] = useState<Breakpoint>(getBreakpoint)

  useEffect(() => {
    const handleResize = () => setBp(getBreakpoint())
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return {
    breakpoint: bp,
    isMobile: bp === 'mobile',
    isTablet: bp === 'tablet',
    isDesktop: bp === 'desktop',
  }
}
