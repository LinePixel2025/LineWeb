/**
 * 网易云歌曲数据归一化与歌词解析（纯函数）。
 *
 * 网易云不同接口返回字段名不一致（新接口 ar/al/dt，旧接口 artists/album/duration），
 * 统一归一化为 SongView 供播放器与页面使用。
 */

export interface SongView {
  id: number
  name: string
  /** 作者拼接（「A / B」） */
  artists: string
  albumName: string
  /** 封面 URL（可直接 <img src>；服务端 CSP imgSrc 已放行 https:） */
  picUrl: string | null
  /** 时长毫秒 */
  durationMs: number
  /** fee: 0 免费 / 1 VIP / 4 购买专辑 / 8 低音质免费（仅作 UI 标记） */
  fee: number
}

interface RawSong {
  id?: number
  name?: string
  ar?: { name?: string; id?: number }[]
  artists?: { name?: string; id?: number }[]
  al?: { name?: string; picUrl?: string; id?: number }
  album?: { name?: string; picUrl?: string; id?: number }
  dt?: number
  duration?: number
  fee?: number
}

/**
 * 网易云媒体 CDN 域名（封面 / 音频 / 头像）。
 *
 * 上游接口大多返回明文 http 地址，而页面 CSP 的 img-src 只放行 https：
 * 搜索结果里的封面此前被 CSP 直接拦掉（表现为「大多数封面无法显示」）。
 * 服务端已统一升级为 https，这里是前端兜底（例如 localStorage 里持久化的旧队列）。
 */
const NCM_MEDIA_HTTP_RE = /^http:\/\/((?:[a-z0-9-]+\.)*(?:music\.126\.net|126\.net|127\.net|netease\.com))([/?#].*)?$/i

/** http 网易 CDN 地址 → https；其它地址原样返回 */
export function upgradeMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null
  return url.replace(NCM_MEDIA_HTTP_RE, (_, host: string, rest = '') => `https://${host}${rest}`)
}

export function normalizeSong(raw: RawSong): SongView | null {
  if (raw?.id == null || !raw.name) return null
  const artistList = raw.ar ?? raw.artists ?? []
  const album = raw.al ?? raw.album
  return {
    id: raw.id,
    name: raw.name,
    artists: artistList.map(a => a?.name).filter(Boolean).join(' / '),
    albumName: album?.name ?? '',
    picUrl: upgradeMediaUrl(album?.picUrl),
    durationMs: raw.dt ?? raw.duration ?? 0,
    fee: raw.fee ?? 0,
  }
}

export function normalizeSongList(raw: unknown): SongView[] {
  if (!Array.isArray(raw)) return []
  return raw.map(item => normalizeSong(item as RawSong)).filter((s): s is SongView => s !== null)
}

/** 毫秒 → m:ss */
export function formatSongDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '--:--'
  const total = Math.floor(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export interface LrcLine {
  /** 行起始时间（秒） */
  time: number
  line: string
}

/**
 * 解析 LRC 歌词（[mm:ss.xx]逐行时间戳，支持一行多时间标签）。
 * 返回按时间排序的行；无时间标签的元数据行（[ti:] 等）被丢弃。
 */
export function parseLrc(lrcText: string | null | undefined): LrcLine[] {
  if (!lrcText) return []
  const lines: LrcLine[] = []
  const tagRe = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
  for (const rawLine of lrcText.split(/\r?\n/)) {
    tagRe.lastIndex = 0
    const times: number[] = []
    let match: RegExpExecArray | null
    let lastIndex = 0
    while ((match = tagRe.exec(rawLine)) !== null) {
      if (match.index !== lastIndex) break // 时间标签必须连续出现在行首
      const minutes = Number(match[1])
      const seconds = Number(match[2])
      const fractionRaw = match[3] ?? '0'
      // [xx:xx.xx] 两位是百分秒、三位是毫秒
      const fraction = Number(fractionRaw) / 10 ** fractionRaw.length
      times.push(minutes * 60 + seconds + fraction)
      lastIndex = tagRe.lastIndex
    }
    if (times.length === 0) continue
    const text = rawLine.slice(lastIndex).trim()
    for (const time of times) {
      lines.push({ time, line: text })
    }
  }
  lines.sort((a, b) => a.time - b.time)
  return lines
}

/** 二分查找当前播放行（time ≤ position 的最后一行） */
export function findLrcIndex(lines: LrcLine[], positionSec: number): number {
  if (lines.length === 0) return -1
  let lo = 0
  let hi = lines.length - 1
  let result = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= positionSec) {
      result = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return result
}
