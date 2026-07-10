import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useResponsive } from '../useResponsive'

function setWindowSize(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true })
  Object.defineProperty(window, 'innerHeight', { value: height, writable: true })
}

function fireResize() {
  window.dispatchEvent(new Event('resize'))
}

describe('useResponsive', () => {
  beforeEach(() => {
    setWindowSize(1024, 768)
  })

  it('宽度 >= 1024 返回 desktop', () => {
    setWindowSize(1200, 800)
    const { result } = renderHook(() => useResponsive())

    expect(result.current.deviceType).toBe('desktop')
    expect(result.current.isDesktop).toBe(true)
    expect(result.current.isTablet).toBe(false)
    expect(result.current.isMobile).toBe(false)
    expect(result.current.width).toBe(1200)
    expect(result.current.height).toBe(800)
  })

  it('宽度 768-1023 返回 tablet', () => {
    setWindowSize(800, 600)
    const { result } = renderHook(() => useResponsive())

    expect(result.current.deviceType).toBe('tablet')
    expect(result.current.isTablet).toBe(true)
    expect(result.current.isDesktop).toBe(false)
    expect(result.current.isMobile).toBe(false)
    expect(result.current.width).toBe(800)
    expect(result.current.height).toBe(600)
  })

  it('宽度 < 768 返回 mobile', () => {
    setWindowSize(375, 667)
    const { result } = renderHook(() => useResponsive())

    expect(result.current.deviceType).toBe('mobile')
    expect(result.current.isMobile).toBe(true)
    expect(result.current.isDesktop).toBe(false)
    expect(result.current.isTablet).toBe(false)
    expect(result.current.width).toBe(375)
    expect(result.current.height).toBe(667)
  })

  it('窗口 resize 时更新状态', () => {
    setWindowSize(1200, 800)
    const { result } = renderHook(() => useResponsive())

    expect(result.current.deviceType).toBe('desktop')

    act(() => {
      setWindowSize(800, 600)
      fireResize()
    })

    expect(result.current.deviceType).toBe('tablet')
    expect(result.current.width).toBe(800)

    act(() => {
      setWindowSize(375, 667)
      fireResize()
    })

    expect(result.current.deviceType).toBe('mobile')
    expect(result.current.width).toBe(375)
  })

  it('边界值 1024 为 desktop', () => {
    setWindowSize(1024, 768)
    const { result } = renderHook(() => useResponsive())

    expect(result.current.deviceType).toBe('desktop')
  })

  it('边界值 768 为 tablet', () => {
    setWindowSize(768, 600)
    const { result } = renderHook(() => useResponsive())

    expect(result.current.deviceType).toBe('tablet')
  })

  it('边界值 767 为 mobile', () => {
    setWindowSize(767, 600)
    const { result } = renderHook(() => useResponsive())

    expect(result.current.deviceType).toBe('mobile')
  })
})
