import { beforeEach, describe, expect, it } from 'vitest'
import {
  LOW_PERF_ATTR,
  LOW_PERF_STORAGE_KEY,
  initPerformanceMode,
  readLowPerformanceMode,
  setLowPerformanceMode,
} from '../performanceMode'

describe('performanceMode', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute(LOW_PERF_ATTR)
  })

  it('默认关闭：不写 localStorage、不挂 data-perf', () => {
    expect(readLowPerformanceMode()).toBe(false)
    initPerformanceMode()
    expect(document.documentElement.hasAttribute(LOW_PERF_ATTR)).toBe(false)
  })

  it('开启后写入存储并挂 data-perf="low"', () => {
    setLowPerformanceMode(true)
    expect(readLowPerformanceMode()).toBe(true)
    expect(localStorage.getItem(LOW_PERF_STORAGE_KEY)).toBe('1')
    expect(document.documentElement.getAttribute(LOW_PERF_ATTR)).toBe('low')
  })

  it('关闭后清除属性（保留 0 作为显式关闭标记）', () => {
    setLowPerformanceMode(true)
    setLowPerformanceMode(false)
    expect(readLowPerformanceMode()).toBe(false)
    expect(document.documentElement.hasAttribute(LOW_PERF_ATTR)).toBe(false)
    expect(localStorage.getItem(LOW_PERF_STORAGE_KEY)).toBe('0')
  })

  it('启动时按已保存的值恢复', () => {
    localStorage.setItem(LOW_PERF_STORAGE_KEY, '1')
    initPerformanceMode()
    expect(document.documentElement.getAttribute(LOW_PERF_ATTR)).toBe('low')
  })
})
