import { useState, useEffect } from 'react'

export type DeviceType = 'desktop' | 'tablet' | 'mobile'

export interface ResponsiveInfo {
  deviceType: DeviceType
  isDesktop: boolean
  isTablet: boolean
  isMobile: boolean
  width: number
  height: number
}

const BREAKPOINTS = {
  desktop: 1024,
  tablet: 768
}

export function useResponsive(): ResponsiveInfo {
  const [size, setSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768
  })

  useEffect(() => {
    const handleResize = () => {
      setSize({
        width: window.innerWidth,
        height: window.innerHeight
      })
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const deviceType: DeviceType =
    size.width >= BREAKPOINTS.desktop ? 'desktop' :
    size.width >= BREAKPOINTS.tablet ? 'tablet' :
    'mobile'

  return {
    deviceType,
    isDesktop: deviceType === 'desktop',
    isTablet: deviceType === 'tablet',
    isMobile: deviceType === 'mobile',
    width: size.width,
    height: size.height
  }
}
