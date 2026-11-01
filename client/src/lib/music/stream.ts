import { API_BASE } from '../api'
import { upgradeMediaUrl } from './song'

/**
 * 音乐媒体中转（设备无法直连网易云 CDN 时经 LineWeb 服务器转发）。
 *
 * 背景：浏览器默认直连网易云 CDN 播放（服务端零音频带宽）。部分设备/网络
 * 无法访问 `m*.music.126.net` 等域名，音频与封面都会失败。此时改走
 * `/api/music/stream`（音频，支持 Range/seek）与 `/api/music/image`（封面）。
 *
 * 偏好按设备记忆：直连失败自动写入，之后直接走中转；播放器里可手动改回直连。
 */

export const MUSIC_STREAM_PROXY_KEY = 'lineweb_music_stream_proxy'

/** 网易云 CDN 媒体域名（与 server/src/services/neteaseMusic.ts 白名单一致） */
const NCM_MEDIA_URL_RE =
  /^https?:\/\/((?:[a-z0-9-]+\.)*(?:music\.126\.net|126\.net|127\.net|netease\.com))([/?#].*)?$/i

function trimBase(base: string): string {
  return String(base || '').replace(/\/+$/, '')
}

/** 读取「经服务器中转」偏好（默认 false = 先尝试直连） */
export function readMusicStreamProxyPreference(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(MUSIC_STREAM_PROXY_KEY) === '1'
  } catch {
    return false
  }
}

export function writeMusicStreamProxyPreference(enabled: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(MUSIC_STREAM_PROXY_KEY, enabled ? '1' : '0')
  } catch {
    // 隐私模式：本次会话状态仍然生效
  }
}

/** 音频中转地址（可直接赋给 <audio src>；token 走 ?token=，浏览器无法带 Authorization 头） */
export function buildMusicStreamUrl(
  base: string,
  songId: number | string,
  level: string,
  token: string | null | undefined,
): string {
  const params = new URLSearchParams({ id: String(songId), level })
  if (token) params.set('token', token)
  return `${trimBase(base)}/music/stream?${params.toString()}`
}

/**
 * 封面中转地址：只代理网易云 CDN 的图片；其它地址原样返回（保持原行为）。
 * 无地址时返回 null，调用方显示占位。
 */
export function buildMusicImageUrl(
  base: string,
  rawUrl: string | null | undefined,
  token: string | null | undefined,
): string | null {
  const upgraded = upgradeMediaUrl(rawUrl)
  if (!upgraded) return null
  if (!NCM_MEDIA_URL_RE.test(upgraded)) return upgraded
  const params = new URLSearchParams({ u: upgraded })
  if (token) params.set('token', token)
  return `${trimBase(base)}/music/image?${params.toString()}`
}

/** 按当前模式给出图片 src：direct 用原地址，proxy 用服务端中转 */
export function resolveMusicImageSrc(
  rawUrl: string | null | undefined,
  proxy: boolean,
  token: string | null | undefined,
  base: string = API_BASE,
): string | null {
  if (!proxy) return upgradeMediaUrl(rawUrl)
  return buildMusicImageUrl(base, rawUrl, token)
}
