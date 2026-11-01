import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import { normalizeSongList, type SongView } from '../lib/music/song'
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

  const audioRef = useRef<HTMLAudioElement | null>(null)
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
    setPositionSec(0)
    setDurationSec(target.durationMs > 0 ? target.durationMs / 1000 : 0)

    void (async () => {
      try {
        const storedLevel = localStorage.getItem(LEVEL_KEY) ?? 'exhigh'
        const level = (SONG_LEVELS as readonly string[]).includes(storedLevel) ? storedLevel : 'exhigh'
        const data = await api.get<MusicSongUrlResponse>(`/music/song/url?id=${target.id}&level=${level}`)
        const url = data.data?.[0]?.url
        if (!url) {
          setLoading(false)
          setPlaying(false)
          setError(`《${target.name}》暂无可播放的音频源（版权限制）`)
          return
        }
        const audio = getAudio()
        audio.src = url
        await audio.play()
        setLoading(false)
        setPlaying(true)
      } catch (err) {
        setLoading(false)
        setPlaying(false)
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError(err instanceof Error && err.message ? err.message : '播放失败，请稍后再试')
      }
    })()
  }, [getAudio])

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
      void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    } else {
      audio.pause()
      setPlaying(false)
    }
  }, [playAt])

  const seek = useCallback((sec: number) => {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(sec)) return
    audio.currentTime = Math.min(Math.max(sec, 0), audio.duration || sec)
    setPositionSec(audio.currentTime)
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
      if (audio.src) setError('音频加载失败，请尝试切换曲目')
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
    navigator.mediaSession.setActionHandler('play', () => toggle())
    navigator.mediaSession.setActionHandler('pause', () => toggle())
    navigator.mediaSession.setActionHandler('previoustrack', () => prev())
    navigator.mediaSession.setActionHandler('nexttrack', () => next())
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
    playQueue,
    playAt,
    toggle,
    next,
    prev,
    seek,
    setVolume,
    cycleMode,
    clearError,
  }), [song, queue, index, playing, loading, positionSec, durationSec, mode, volume, error,
    playQueue, playAt, toggle, next, prev, seek, setVolume, cycleMode, clearError])

  return <MusicPlayerContext.Provider value={value}>{children}</MusicPlayerContext.Provider>
}

export function useMusicPlayer(): MusicPlayerContextValue {
  const ctx = useContext(MusicPlayerContext)
  if (!ctx) throw new Error('useMusicPlayer 必须在 MusicProvider 内使用')
  return ctx
}
