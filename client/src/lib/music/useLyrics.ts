import { useEffect, useState } from 'react'
import { api } from '../api'
import { parseLrc, type LrcLine } from './song'
import type { MusicLyricResponse } from '../../types/music'

/**
 * 歌词共享缓存 Hook。
 *
 * 音乐页大卡片和顶栏迷你播放器会同时订阅同一首歌的歌词：没有缓存时
 * 两个组件各请求一次 `/music/lyric`，切歌瞬间还会互相覆盖。这里用模块级
 * Map + in-flight Promise 做去重，组件只负责订阅结果。
 *
 * 缓存上限 60 首（LRU 近似：超出后淘汰最早写入的一首），空歌词也缓存，
 * 避免反复点同一首无歌词的歌时重复打接口。
 */

export interface MusicLyricsState {
  /** 原文歌词（已按时间排序） */
  lines: LrcLine[]
  /** 翻译歌词（按 time 对齐，可能为空） */
  translated: LrcLine[]
}

const EMPTY: MusicLyricsState = { lines: [], translated: [] }
const CACHE_LIMIT = 60
const cache = new Map<number, MusicLyricsState>()
const inFlight = new Map<number, Promise<MusicLyricsState>>()

function remember(songId: number, value: MusicLyricsState): MusicLyricsState {
  cache.set(songId, value)
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  return value
}

function requestLyrics(songId: number): Promise<MusicLyricsState> {
  const cached = cache.get(songId)
  if (cached) return Promise.resolve(cached)

  const pending = inFlight.get(songId)
  if (pending) return pending

  const request = api.get<MusicLyricResponse>(`/music/lyric?id=${songId}`)
    .then((data) => remember(songId, {
      lines: parseLrc(data.lrc?.lyric),
      translated: parseLrc(data.tlyric?.lyric),
    }))
    .catch(() => remember(songId, EMPTY))
    .finally(() => {
      inFlight.delete(songId)
    })

  inFlight.set(songId, request)
  return request
}

export function useLyrics(songId: number | null): MusicLyricsState {
  const [state, setState] = useState<MusicLyricsState>(() => (
    songId == null ? EMPTY : cache.get(songId) ?? EMPTY
  ))

  useEffect(() => {
    if (songId == null) {
      setState(EMPTY)
      return
    }

    const cached = cache.get(songId)
    if (cached) {
      setState(cached)
      return
    }

    setState(EMPTY)
    let cancelled = false
    void requestLyrics(songId).then((next) => {
      if (!cancelled) setState(next)
    })
    return () => { cancelled = true }
  }, [songId])

  return state
}
