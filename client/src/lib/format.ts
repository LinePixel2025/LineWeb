/* ============================================
 *   统一格式化工具函数
 *   ============================================ */

/** 文件大小格式化：1024 → "1.0 KB" */
export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++ }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** 速度格式化：1024 → "1.0 KB/s" */
export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '—'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let i = 0
  let speed = bytesPerSec
  while (speed >= 1024 && i < units.length - 1) { speed /= 1024; i++ }
  return `${speed.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** 预估剩余时间格式化：150 → "3m" */
export function formatETA(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '—'
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}

/** 日期格式化：ISO → "7月4日 14:30" */
export function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** MB 显示：1048576 → "1.0MB" */
export function formatMB(bytes: number): string {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10}MB`
}
