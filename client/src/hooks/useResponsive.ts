import { useEffect, useState } from 'react'

export type Breakpoint = 'mobile' | 'tablet' | 'desktop'

function getBreakpoint(): Breakpoint {
  if (typeof window === 'undefined') return 'desktop'
  if (window.matchMedia('(max-width: 480px)').matches) return 'mobile'
  if (window.matchMedia('(max-width: 768px)').matches) return 'tablet'
  return 'desktop'
}

export function useResponsive() {
  const [bp, setBp] = useState<Breakpoint>(getBreakpoint)

  useEffect(() => {
    const mqlMobile = window.matchMedia('(max-width: 480px)')
    const mqlTablet = window.matchMedia('(max-width: 768px)')
    const handler = () => setBp(getBreakpoint())
    mqlMobile.addEventListener('change', handler)
    mqlTablet.addEventListener('change', handler)
    return () => {
      mqlMobile.removeEventListener('change', handler)
      mqlTablet.removeEventListener('change', handler)
    }
  }, [])

  return {
    breakpoint: bp,
    isMobile: bp === 'mobile',
    isTablet: bp === 'tablet',
    isDesktop: bp === 'desktop',
  }
}
