import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import { normalizeSongList, upgradeMediaUrl, type SongView } from '../lib/music/song'
import type { MusicSongUrlResponse } from '../types/music'

/**
 * 全局音乐播放器状态（跨页持续播放）。
 *
 * - <audio> 实例挂在 Provider 上，/music 页与全局迷你播放条共享
 * - 播放地址走 /api/music/song/url 代理取网易 CDN 直链（浏览器直连，不经服务器）
 * - MediaSession：锁屏/系统媒体控制
 * - 队列 / 播放模式 / 音量 / 进度 localStorage 持久化（刷新后恢复队列，不自动播放——浏览器限制）
 */

export type MusicPlayMode = 'order' | 'repeat' | 'shuffle'

const STORAGE_KEY = 'lineweb_music_player_v1'
const LEVEL_KEY = 'lineweb_music_level'
const SONG_LEVELS = ['standard', 'higher', 'exhigh', 'lossless', 'hires'] as const
const MODES: MusicPlayMode[] = ['order', 'repeat', 'shuffle']

/** 静音 WAV（约 0.1s 的空音频）：用于首次用户手势解锁 <audio>，iOS Safari 需要它 */
const SILENT_CLIP =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA='

/** 首选音质播不了时（网络/版权/上游降级）兜底的标准音质 */
const FALLBACK_LEVEL = 'standard'
/** 设置 src 后等待真正出声的上限：超过即判定音频源不可达，避免加载态无限转圈 */
const PLAY_WATCHDOG_MS = 20_000

/**
 * 媒体层播放失败（与浏览器拒绝自动播放的 NotAllowedError 区分开）：
 * 前者说明音频地址拿不到/加载不出来，可以降级音质重试；后者要等下一次用户手势。
 */
export class MediaPlaybackError extends Error {
  reason: 'timeout' | 'media'
  constructor(reason: 'timeout' | 'media', message: string) {
    super(message)
    this.name = 'MediaPlaybackError'
    this.reason = reason
  }
}

/** 读取偏好音质（localStorage 已被别处破坏时回退 exhigh） */
function readPreferredLevel(): string {
  try {
    const stored = localStorage.getItem(LEVEL_KEY) ?? 'exhigh'
    return (SONG_LEVELS as readonly string[]).includes(stored) ? stored : 'exhigh'
  } catch {
    return 'exhigh'
  }
}

/**
 * 播放地址请求失败是否值得降级重试：401/403（登录或权限）与 429（限流）重试无意义。
 */
function isRetryableSongUrlError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status
  return !(status === 401 || status === 403 || status === 429)
}

/**
 * 真正让 <audio> 出声：设置 src 后同时等 play() 与媒体事件。
 *
 * 老设备/受限网络里，音频 CDN 不可达时 play() 可能永远不 resolve（浏览器媒体栈
 * 不报错也不超时），表现为「点歌后一直转圈、没声音」。这里用看门狗兜底，
 * 超时或 error 事件都立刻失败，交给上层降级音质/给出可操作提示。
 */
export function playAudioSource(
  audio: HTMLAudioElement,
  url: string,
  timeoutMs: number = PLAY_WATCHDOG_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer: number | null = null

    const cleanup = () => {
      if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
      audio.removeEventListener('error', onError)
      audio.removeEventListener('abort', onAbort)
    }
    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      action()
    }
    const onError = () => finish(() => reject(new MediaPlaybackError('media', '音频源加载失败')))
    const onAbort = () => finish(() => reject(new DOMException('播放已取消', 'AbortError')))

    audio.addEventListener('error', onError)
    audio.addEventListener('abort', onAbort)
    timer = window.setTimeout(
      () => finish(() => reject(new MediaPlaybackError('timeout', '音频加载超时'))),
      timeoutMs,
    )

    audio.src = url
    // 部分老浏览器替换 src 后不会自动发起请求，必须显式 load()
    try {
      audio.load()
    } catch {
      // 某些 WebView 上 load() 可能抛异常，继续尝试 play()
    }
    audio.play().then(
      () => finish(() => resolve()),
      (err) => finish(() => reject(err)),
    )
  })
}

interface PersistedState {
  queue: SongView[]
  index: number
  mode: MusicPlayMode
  volume: number
  positionSec: number
}

function loadPersisted(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) throw new Error('empty')
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    return {
      queue: normalizeSongList(parsed.queue),
      index: typeof parsed.index === 'number' && parsed.index >= 0 ? parsed.index : 0,
      mode: parsed.mode && MODES.includes(parsed.mode) ? parsed.mode : 'order',
      volume: typeof parsed.volume === 'number' ? Math.min(Math.max(parsed.volume, 0), 1) : 0.8,
      positionSec: typeof parsed.positionSec === 'number' ? parsed.positionSec : 0,
    }
  } catch {
    return { queue: [], index: 0, mode: 'order', volume: 0.8, positionSec: 0 }
  }
}

function pickNextIndex(mode: MusicPlayMode, index: number, length: number): number {
  if (length <= 0) return 0
  if (mode === 'shuffle') {
    if (length === 1) return index
    let next = index
    while (next === index) next = Math.floor(Math.random() * length)
    return next
  }
  return (index + 1) % length
}

export interface MusicPlayerContextValue {
  song: SongView | null
  queue: SongView[]
  index: number
  playing: boolean
  /** 取播放地址中（点了播放但还没出声） */
  loading: boolean
  positionSec: number
  durationSec: number
  mode: MusicPlayMode
  volume: number
  error: string
  /** 当前音频是 VIP 试听片段时给出可播放上限（秒）；完整歌曲为 null */
  trialEndSec: number | null
  playQueue: (songs: SongView[], startIndex?: number) => void
  playAt: (index: number) => void
  toggle: () => void
  next: () => void
  prev: () => void
  seek: (sec: number) => void
  setVolume: (value: number) => void
  cycleMode: () => void
  clearError: () => void
}

const MusicPlayerContext = createContext<MusicPlayerContextValue | null>(null)

export function MusicProvider({ children }: { children: ReactNode }) {
  const initial = useRef(loadPersisted()).current
  const [queue, setQueue] = useState<SongView[]>(initial.queue)
  const [index, setIndex] = useState(initial.index)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [positionSec, setPositionSec] = useState(initial.positionSec)
  const [durationSec, setDurationSec] = useState(0)
  const [mode, setMode] = useState<MusicPlayMode>(initial.mode)
  const [volume, setVolumeState] = useState(initial.volume)
  const [error, setError] = useState('')
  const [trialEndSec, setTrialEndSec] = useState<number | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  /** 正在走「取地址 → 出声」流程：此刻媒体 error 由播放流程自己降级处理，不要弹全局错误 */
  const startingRef = useRef(false)
  /** 播放请求令牌：连点切歌时丢弃过期流程的状态写入 */
  const playTokenRef = useRef(0)
  const indexRef = useRef(index)
  const modeRef = useRef(mode)
  const queueRef = useRef(queue)
  indexRef.current = index
  modeRef.current = mode
  queueRef.current = queue

  const song = queue[index] ?? null

  /** 持久化（audio 时间更新节流写入） */
  const persist = useCallback((override?: Partial<PersistedState>) => {
    try {
      const data: PersistedState = {
        queue: queueRef.current,
        index: indexRef.current,
        mode: modeRef.current,
        volume: audioRef.current?.volume ?? 0.8,
        positionSec: audioRef.current?.currentTime ?? 0,
        ...override,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch { /* 存储满等异常忽略 */ }
  }, [])

  const getAudio = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      const audio = new Audio()
      audio.preload = 'metadata'
      audio.volume = initial.volume
      // 挂进文档：老浏览器 / 老 WebView 里游离的 Audio 对象可能不真正播放
      // （表现为 play() 不报错也没声音）。隐藏后不影响布局。
      try {
        audio.setAttribute('playsinline', '')
        audio.style.display = 'none'
        document.body.appendChild(audio)
      } catch {
        // 极端环境（无 document.body）下退回游离元素
      }
      audioRef.current = audio
    }
    return audioRef.current
  }, [initial.volume])

  const playAt = useCallback((targetIndex: number) => {
    const list = queueRef.current
    const target = list[targetIndex]
    if (!target) return
    setIndex(targetIndex)
    indexRef.current = targetIndex
    setError('')
    setLoading(true)
    setTrialEndSec(null)
    setPositionSec(0)
    setDurationSec(target.durationMs > 0 ? target.durationMs / 1000 : 0)

    // 连点切歌时旧请求可能后返回：用递增令牌让过期流程不再改动播放器状态
    const token = (playTokenRef.current += 1)

    void (async () => {
      startingRef.current = true
      const audio = getAudio()
      const preferred = readPreferredLevel()
      // 首选音质失败后降到标准音质再试一次：老设备/弱网对高码率更敏感
      const levels = preferred === FALLBACK_LEVEL ? [preferred] : [preferred, FALLBACK_LEVEL]
      let lastError: unknown = null
      let noSource = false

      try {
        for (const level of levels) {
          let url = ''
          try {
            const data = await api.get<MusicSongUrlResponse>(`/music/song/url?id=${target.id}&level=${level}`)
            // 已经切到别的歌：本次请求的后续动作全部作废
            if (token !== playTokenRef.current) return
            const entry = data.data?.[0]
            // 服务端已把网易 CDN 地址升级为 https，这里再兜一层（旧缓存 / 上游变化）
            url = upgradeMediaUrl(entry?.url) ?? ''
            if (!url) {
              // 版权限制/需要付费时上游会返回空地址：换音质也没用，直接收尾
              noSource = true
              continue
            }
            // VIP 试听片段：上游会在 freeTrialInfo 里给出截断区间（只用于 UI 提示，时长以音频元数据为准）
            const trial = entry?.freeTrialInfo
            setTrialEndSec(trial && typeof trial.end === 'number' && trial.end > 0 ? trial.end : null)
          } catch (err) {
            lastError = err
            if (!isRetryableSongUrlError(err)) throw err
            continue
          }

          try {
            await playAudioSource(audio, url)
            if (token !== playTokenRef.current) return
            setLoading(false)
            setPlaying(true)
            // 起播即落盘一次：刷新后顶栏仍能显示这首歌（不自动播放）
            persist()
            return
          } catch (err) {
            if (token !== playTokenRef.current) return
            // 浏览器拒绝播放 / 用户取消：不降级，交给外层统一提示
            if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'NotAllowedError')) throw err
            lastError = err
            // 加载不出来就继续尝试下一个音质
          }
        }

        if (token !== playTokenRef.current) return
        // 所有音质都失败：清掉坏地址，下次点击重新取地址（而不是重复播放同一个坏链接）
        try {
          audio.removeAttribute('src')
          audio.load()
        } catch {
          // ignore
        }
        setLoading(false)
        setPlaying(false)
        if (lastError instanceof MediaPlaybackError) {
          setError('音频加载失败：这台设备的网络可能无法直连网易云音乐 CDN，请检查网络后重试')
          return
        }
        if (lastError instanceof Error && lastError.message) {
          setError(lastError.message)
          return
        }
        if (noSource) {
          setError(`《${target.name}》暂无可播放的音频源（版权限制）`)
          return
        }
        setError('播放失败，请稍后再试')
      } catch (err) {
        if (token !== playTokenRef.current) return
        setLoading(false)
        setPlaying(false)
        if (err instanceof DOMException && err.name === 'AbortError') return
        // iOS Safari：play() 不在用户手势的同一任务里会被拒绝（NotAllowedError）
        if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'NotSupportedError')) {
          setError('浏览器阻止了自动播放，请再点一次播放按钮')
          return
        }
        setError(err instanceof Error && err.message ? err.message : '播放失败，请稍后再试')
      } finally {
        // 只有最新的流程才有资格结束「启动中」标记（旧流程可能在新的流程开始后才返回）
        if (token === playTokenRef.current) startingRef.current = false
      }
    })()
  }, [getAudio, persist])

  const next = useCallback(() => {
    playAt(pickNextIndex(modeRef.current, indexRef.current, queueRef.current.length))
  }, [playAt])

  const prev = useCallback(() => {
    // 播放中超过 3 秒先回到本曲开头（常见播放器习惯）
    const audio = audioRef.current
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0
      return
    }
    const length = queueRef.current.length
    if (length === 0) return
    playAt((indexRef.current - 1 + length) % length)
  }, [playAt])

  const playQueue = useCallback((songs: SongView[], startIndex = 0) => {
    if (songs.length === 0) return
    const safeIndex = Math.min(Math.max(startIndex, 0), songs.length - 1)
    setQueue(songs)
    queueRef.current = songs
    playAt(safeIndex)
  }, [playAt])

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !audio.src) {
      if (queueRef.current.length > 0) playAt(indexRef.current)
      return
    }
    if (audio.paused) {
      void audio.play().then(() => setPlaying(true)).catch((err) => {
        setPlaying(false)
        // 多半是浏览器要求「用户手势」：给出可操作提示而不是静默失败
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          setError('浏览器阻止了播放，请在页面上点一下后再试')
        }
      })
    } else {
      audio.pause()
      setPlaying(false)
    }
  }, [playAt])

  const seek = useCallback((sec: number) => {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(sec)) return
    const target = Math.min(Math.max(sec, 0), audio.duration || sec)
    try {
      audio.currentTime = target
      setPositionSec(audio.currentTime)
    } catch {
      // 尚未加载音频源（点歌词/拖动进度但还没播放）时 currentTime 可能不可写：
      // 只推进 UI 位置，等真正播放时再从音频元数据对齐，避免抛异常打断交互。
      setPositionSec(target)
    }
  }, [])

  const setVolume = useCallback((value: number) => {
    const clamped = Math.min(Math.max(value, 0), 1)
    setVolumeState(clamped)
    const audio = audioRef.current
    if (audio) audio.volume = clamped
    persist({ volume: clamped })
  }, [persist])

  const cycleMode = useCallback(() => {
    setMode(current => {
      const nextMode = MODES[(MODES.indexOf(current) + 1) % MODES.length]
      modeRef.current = nextMode
      persist({ mode: nextMode })
      return nextMode
    })
  }, [persist])

  const clearError = useCallback(() => setError(''), [])

  // === audio 事件绑定（一次） ===
  useEffect(() => {
    const audio = getAudio()
    const onTime = () => {
      setPositionSec(audio.currentTime)
      // 节流持久化（约每 5 秒）
      if (Math.floor(audio.currentTime) % 5 === 0) persist()
    }
    const onLoaded = () => {
      if (Number.isFinite(audio.duration)) setDurationSec(audio.duration)
    }
    const onEnded = () => {
      if (modeRef.current === 'repeat') {
        audio.currentTime = 0
        void audio.play().catch(() => {})
        return
      }
      next()
    }
    const onPause = () => setPlaying(false)
    const onPlay = () => setPlaying(true)
    const onError = () => {
      const current = audio.currentSrc || audio.src
      // 静音解锁片段 / 已清空 src 的中间态不算错误
      if (!current || current.startsWith('data:')) return
      // 正在取地址/降级重试：交给 playAt 的看门狗与兜底流程收尾，避免抢先弹错
      if (startingRef.current) {
        setPlaying(false)
        return
      }
      setError('音频加载失败，请尝试切换曲目')
      setPlaying(false)
      setLoading(false)
    }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('error', onError)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('error', onError)
    }
  }, [getAudio, next, persist])

  // === 卸载前恢复持久化位置（刷新后从上次进度继续） ===
  useEffect(() => {
    const audio = getAudio()
    if (initial.positionSec > 0) {
      // 元数据加载后 seek（src 设置前 seek 无效，改在 canplay 一次性消费）
      const onCanPlay = () => {
        if (Number.isFinite(audio.duration) && initial.positionSec < audio.duration) {
          audio.currentTime = initial.positionSec
        }
      }
      audio.addEventListener('canplay', onCanPlay, { once: true })
      return () => audio.removeEventListener('canplay', onCanPlay)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getAudio])

  // === 首次用户手势解锁 <audio>（iOS Safari 只在手势的同一任务里允许 play()） ===
  // 点歌后要等 /song/url 返回再 play()，那时已不是手势任务 → iOS 会以 NotAllowedError 拒绝。
  // 标准做法：在第一次 pointerdown/keydown 里播一个极短的静音片段，把这个元素「解锁」。
  useEffect(() => {
    const audio = getAudio()
    if (audio.src) return
    let unlocked = false
    const unlock = () => {
      if (unlocked || audio.src) return
      unlocked = true
      audio.src = SILENT_CLIP
      const cleanup = () => {
        if (audio.src !== SILENT_CLIP) return
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
        audio.currentTime = 0
      }
      void audio.play().then(cleanup, cleanup)
    }
    // 老 iOS Safari 没有 Pointer Events，只监听 pointerdown 会让音频永远无法解锁；
    // touchstart / mousedown / click 都要接上（都只触发一次，重复触发由 unlocked 兜底）。
    const unlockEvents = ['pointerdown', 'touchstart', 'mousedown', 'click', 'keydown'] as const
    for (const name of unlockEvents) {
      document.addEventListener(name, unlock, { capture: true, once: true })
    }
    return () => {
      for (const name of unlockEvents) {
        document.removeEventListener(name, unlock, true)
      }
    }
  }, [getAudio])

  // === MediaSession（锁屏/系统媒体控制） ===
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (song) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: song.name,
          artist: song.artists,
          album: song.albumName,
          artwork: song.picUrl ? [{ src: song.picUrl, sizes: '512x512' }] : [],
        })
      } catch { /* 旧浏览器忽略 */ }
    }
    // 部分浏览器只支持部分 action，遇到不支持的会抛 NotSupportedError（不能让整个 Provider 崩掉）
    const handlers: [MediaSessionAction, () => void][] = [
      ['play', () => toggle()],
      ['pause', () => toggle()],
      ['previoustrack', () => prev()],
      ['nexttrack', () => next()],
    ]
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler)
      } catch {
        // 该浏览器不支持这个媒体键，忽略
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song])

  // === 离开页面前保存一次 ===
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') persist()
    }
    const onPageHide = () => persist()
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [persist])

  const value = useMemo<MusicPlayerContextValue>(() => ({
    song,
    queue,
    index,
    playing,
    loading,
    positionSec,
    durationSec,
    mode,
    volume,
    error,
    trialEndSec,
    playQueue,
    playAt,
    toggle,
    next,
    prev,
    seek,
    setVolume,
    cycleMode,
    clearError,
  }), [song, queue, index, playing, loading, positionSec, durationSec, mode, volume, error, trialEndSec,
    playQueue, playAt, toggle, next, prev, seek, setVolume, cycleMode, clearError])

  return <MusicPlayerContext.Provider value={value}>{children}</MusicPlayerContext.Provider>
}

export function useMusicPlayer(): MusicPlayerContextValue {
  const ctx = useContext(MusicPlayerContext)
  if (!ctx) throw new Error('useMusicPlayer 必须在 MusicProvider 内使用')
  return ctx
}
