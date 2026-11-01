import { useCallback, useSyncExternalStore } from 'react'

/**
 * 低性能模式（个人资料页手动开关，按设备保存在 localStorage）。
 *
 * 只在 <html> 上挂一个 `data-perf="low"`，由 CSS（styles/performance.css）
 * 削弱称号 / 头像框 / 聊天装饰的动效 —— 不是完全关闭，而是去掉最费的
 * 合成层（粒子、旋转光晕、背景位移），保留静态配色与一个轻量呼吸动画。
 *
 * 用 useSyncExternalStore 而不是 Context：开关变化时只通知订阅者，
 * 不触发整棵树的 Provider 重渲染；聊天里已经渲染的徽章靠 CSS 属性选择器
 * 立即生效，无需重新渲染。
 */

export const LOW_PERF_STORAGE_KEY = 'lineweb_low_perf_mode'
/** <html> 上的属性名：值为 'low' 时启用降级样式 */
export const LOW_PERF_ATTR = 'data-perf'
const CHANGE_EVENT = 'lineweb:perf-mode-change'

function readStored(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(LOW_PERF_STORAGE_KEY) === '1'
  } catch {
    // 隐私模式 localStorage 不可用：按关闭处理
    return false
  }
}

function applyToDocument(enabled: boolean): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (enabled) root.setAttribute(LOW_PERF_ATTR, 'low')
  else root.removeAttribute(LOW_PERF_ATTR)
}

/** 应用启动时调用一次（渲染前），避免首帧闪一下完整动效 */
export function initPerformanceMode(): void {
  applyToDocument(readStored())
}

export function readLowPerformanceMode(): boolean {
  return readStored()
}

/** 写入并立即生效（同标签页广播自定义事件，跨标签页由 storage 事件同步） */
export function setLowPerformanceMode(enabled: boolean): void {
  try {
    window.localStorage.setItem(LOW_PERF_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // 存储不可用时仅本次会话生效
  }
  applyToDocument(enabled)
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT))
  } catch {
    // ignore
  }
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onCustom = () => onChange()
  const onStorage = (event: StorageEvent) => {
    // key 为 null 表示 storage 被清空
    if (event.key !== null && event.key !== LOW_PERF_STORAGE_KEY) return
    applyToDocument(readStored())
    onChange()
  }
  window.addEventListener(CHANGE_EVENT, onCustom)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onCustom)
    window.removeEventListener('storage', onStorage)
  }
}

/** [是否开启, 设置开关] */
export function useLowPerformanceMode(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, readStored, () => false)
  const update = useCallback((next: boolean) => setLowPerformanceMode(next), [])
  return [enabled, update]
}
