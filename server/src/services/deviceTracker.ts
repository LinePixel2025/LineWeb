import type { Request } from 'express'

interface DeviceInfo {
  id: number
  ip: string
  userAgent: string
  os: string
  browser: string
  deviceType: string
  firstSeen: string
  lastSeen: string
  requestCount: number
  pathsAccessed: string[]
}

const INACTIVE_TIMEOUT_MS = 30 * 60 * 1000
const CLEANUP_INTERVAL_MS = 60 * 1000
const UPDATE_THROTTLE_MS = 60 * 1000

const devices = new Map<string, DeviceInfo>()
let nextId = 1
let cleanupTimer: ReturnType<typeof setInterval> | null = null

function parseUA(ua: string): { os: string; browser: string; deviceType: string } {
  const lower = ua.toLowerCase()

  let os = '未知'
  if (/windows nt 10/.test(lower)) os = 'Windows 10'
  else if (/windows nt 11/.test(lower)) os = 'Windows 11'
  else if (/mac os x/.test(lower) || /macintosh/.test(lower)) os = 'macOS'
  else if (/iphone/.test(lower) || /ipad/.test(lower)) os = 'iOS'
  else if (/android/.test(lower)) os = 'Android'
  else if (/linux/.test(lower)) os = 'Linux'
  else if (/harmonyos/.test(lower)) os = 'HarmonyOS'
  else if (/ohos/.test(lower)) os = 'HarmonyOS'
  else if (/openharmony/.test(lower)) os = 'OpenHarmony'

  let browser = '未知'
  if (/edg\//.test(lower) || /edge\//.test(lower)) browser = 'Edge'
  else if (/chrome\//.test(lower) && !/edg\//.test(lower)) browser = 'Chrome'
  else if (/safari\//.test(lower) && !/chrome\//.test(lower)) browser = 'Safari'
  else if (/firefox\//.test(lower)) browser = 'Firefox'
  else if (/opera\//.test(lower) || /opr\//.test(lower)) browser = 'Opera'

  let deviceType = '桌面端'
  if (/iphone/.test(lower)) deviceType = '手机 (iOS)'
  else if (/ipad/.test(lower)) deviceType = '平板 (iPad)'
  else if (/android/.test(lower) && /mobile/.test(lower)) deviceType = '手机 (Android)'
  else if (/android/.test(lower)) deviceType = '平板 (Android)'
  else if (/harmonyos/.test(lower) || /ohos/.test(lower)) {
    if (/mobile/.test(lower) || /phone/.test(lower)) deviceType = '手机 (HarmonyOS)'
    else deviceType = '鸿蒙设备'
  }

  return { os, browser, deviceType }
}

function fingerprint(req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || 'unknown'
  const ua = req.headers['user-agent'] || ''
  const { os, browser } = parseUA(ua)
  return `${ip}|${os}|${browser}`
}

export function recordRequest(req: Request): void {
  const key = fingerprint(req)
  const now = new Date().toISOString()
  const ip = req.ip || req.socket.remoteAddress || 'unknown'
  const ua = req.headers['user-agent'] || ''
  const path = req.originalUrl || req.url || ''
  const parsed = parseUA(ua)
  const existing = devices.get(key)

  if (existing) {
    if (Date.now() - new Date(existing.lastSeen).getTime() < UPDATE_THROTTLE_MS) {
      existing.requestCount++
      if (!existing.pathsAccessed.includes(path)) {
        existing.pathsAccessed.push(path)
      }
      return
    }
    existing.lastSeen = now
    existing.requestCount++
    if (!existing.pathsAccessed.includes(path)) {
      existing.pathsAccessed.push(path)
    }
  } else {
    devices.set(key, {
      id: nextId++,
      ip,
      userAgent: ua,
      os: parsed.os,
      browser: parsed.browser,
      deviceType: parsed.deviceType,
      firstSeen: now,
      lastSeen: now,
      requestCount: 1,
      pathsAccessed: [path],
    })
  }
}

export function getDevices(): DeviceInfo[] {
  const now = Date.now()
  const active: DeviceInfo[] = []
  for (const device of devices.values()) {
    if (now - new Date(device.lastSeen).getTime() < INACTIVE_TIMEOUT_MS) {
      active.push(device)
    }
  }
  return active.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime())
}

export function getAllDevices(): DeviceInfo[] {
  return Array.from(devices.values()).sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime())
}

export function getOnlineCount(): number {
  return getDevices().length
}

export function getTotalCount(): number {
  return devices.size
}

function cleanup() {
  const now = Date.now()
  for (const [key, device] of devices.entries()) {
    if (now - new Date(device.lastSeen).getTime() > INACTIVE_TIMEOUT_MS) {
      devices.delete(key)
    }
  }
}

export function startTracking(): void {
  if (cleanupTimer) return
  cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL_MS)
}

export function stopTracking(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
}
