import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../ui/Icon'
import { api } from '../../lib/api'
import {
  findLrcIndex,
  formatSongDuration,
  parseLrc,
  upgradeMediaUrl,
  type LrcLine,
  type SongView,
} from '../../lib/music/song'
import { useMusicPlayer, type MusicPlayMode } from '../../contexts/MusicPlayerContext'
import type { MusicLyricResponse } from '../../types/music'

/**
 * 正在播放卡（音乐页顶部）：大封面 + 传输控制 + 歌词。
 *
 * - 歌词来自 GET /api/music/lyric（lrc.lyric 原文由 parseLrc 解析），按播放进度高亮并滚动
 * - 没有播放中的歌曲时展示引导态（不是空 div，避免页面看起来「坏了」）
 * - VIP 试听片段会显式提示（上游对非黑胶账号只返回 30s 左右的片段）
 */

const MODE_ICON: Record<MusicPlayMode, 'list' | 'repeat' | 'shuffle'> = {
  order: 'list',
  repeat: 'repeat',
  shuffle: 'shuffle',
}

const MODE_LABEL: Record<MusicPlayMode, string> = {
  order: '顺序播放',
  repeat: '单曲循环',
  shuffle: '随机播放',
}

/** 歌词：按歌曲 id 拉取一次，拿到 lrc + 翻译 */
function useLyrics(songId: number | null): { lines: LrcLine[]; translated: LrcLine[] } {
  const [lines, setLines] = useState<LrcLine[]>([])
  const [translated, setTranslated] = useState<LrcLine[]>([])

  useEffect(() => {
    if (songId == null) {
      setLines([])
      setTranslated([])
      return
    }
    let cancelled = false
    void api.get<MusicLyricResponse>(`/music/lyric?id=${songId}`)
      .then((data) => {
        if (cancelled) return
        setLines(parseLrc(data.lrc?.lyric))
        setTranslated(parseLrc(data.tlyric?.lyric))
      })
      .catch(() => {
        if (!cancelled) {
          setLines([])
          setTranslated([])
        }
      })
    return () => { cancelled = true }
  }, [songId])

  return { lines, translated }
}

function CoverArt({ song, size }: { song: SongView | null; size: 'lg' | 'sm' }) {
  const src = upgradeMediaUrl(song?.picUrl)
  if (!src) {
    return (
      <span className={`gh-music-now-cover gh-music-now-cover--${size} gh-music-now-cover--fallback`}>
        <Icon name="music" size={size === 'lg' ? 34 : 18} />
      </span>
    )
  }
  return <img className={`gh-music-now-cover gh-music-now-cover--${size}`} src={src} alt="" />
}

export default function NowPlayingCard() {
  const player = useMusicPlayer()
  const { song } = player
  const { lines, translated } = useLyrics(song?.id ?? null)
  const [lyricsOpen, setLyricsOpen] = useState(true)
  const lyricsRef = useRef<HTMLDivElement | null>(null)
  const lineRefs = useRef(new Map<number, HTMLButtonElement>())

  const duration = player.durationSec > 0
    ? player.durationSec
    : song && song.durationMs > 0 ? song.durationMs / 1000 : 0
  const progress = duration > 0 ? Math.min(player.positionSec / duration, 1) : 0

  const activeIndex = useMemo(
    () => findLrcIndex(lines, player.positionSec),
    [lines, player.positionSec],
  )
  const translatedByTime = useMemo(() => {
    const map = new Map<number, string>()
    for (const line of translated) map.set(line.time, line.line)
    return map
  }, [translated])

  // 当前行滚动到歌词面板中间（只在行变化时滚）。这里直接改滚动容器的 scrollTop，
  // 不用 scrollIntoView —— 后者会把整个页面一起滚走，导致标题被顶部导航遮住。
  useEffect(() => {
    if (!lyricsOpen || activeIndex < 0) return
    const container = lyricsRef.current
    const el = lineRefs.current.get(activeIndex)
    if (!container || !el) return
    const target = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2
    container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  }, [activeIndex, lyricsOpen])

  if (!song) {
    return (
      <section className="gh-music-now gh-music-now--idle" aria-label="正在播放">
        <div className="gh-music-now-idle-icon"><Icon name="music" size={26} /></div>
        <div>
          <p className="gh-music-now-idle-title">还没有在播的歌</p>
          <p className="gh-music-now-idle-hint">点下面的榜单或搜索任意一首歌，就会立刻开始播放</p>
        </div>
      </section>
    )
  }

  return (
    <section className="gh-music-now" aria-label="正在播放">
      <div className="gh-music-now-head">
        <CoverArt song={song} size="lg" />
        <div className="gh-music-now-meta">
          <span className="gh-music-now-kicker">正在播放</span>
          <h2 className="gh-music-now-title" title={song.name}>{song.name}</h2>
          <p className="gh-music-now-sub">
            {song.artists || '未知歌手'}
            {song.albumName ? <span className="gh-music-now-album"> · {song.albumName}</span> : null}
          </p>
          <div className="gh-music-now-badges">
            {player.trialEndSec !== null && (
              <span className="gh-music-badge gh-music-badge--warn">试听片段 · 会员歌曲</span>
            )}
            {song.fee === 1 && player.trialEndSec === null && (
              <span className="gh-music-badge">VIP</span>
            )}
            {player.playing && <span className="gh-music-badge gh-music-badge--live">播放中</span>}
          </div>
        </div>
        <div className="gh-music-now-controls">
          <button
            className="gh-music-now-btn"
            onClick={player.prev}
            aria-label="上一首"
            title="上一首"
          >
            <Icon name="skip-back" size={18} />
          </button>
          <button
            className="gh-music-now-btn gh-music-now-btn--play"
            onClick={player.toggle}
            disabled={player.loading}
            aria-label={player.playing ? '暂停' : '播放'}
            title={player.playing ? '暂停' : '播放'}
          >
            {player.loading
              ? <Icon name="refresh" size={20} />
              : player.playing ? <Icon name="pause" size={20} /> : <Icon name="play" size={20} />}
          </button>
          <button
            className="gh-music-now-btn"
            onClick={player.next}
            aria-label="下一首"
            title="下一首"
          >
            <Icon name="skip-forward" size={18} />
          </button>
        </div>
      </div>

      <div className="gh-music-now-progress">
        <span className="gh-music-now-time">{formatSongDuration(player.positionSec * 1000)}</span>
        <div className="gh-music-now-track">
          <div className="gh-music-now-track-fill" style={{ width: `${progress * 100}%` }} />
          <input
            type="range"
            className="gh-music-now-seek"
            min={0}
            max={Math.max(duration, 1)}
            step={1}
            value={Math.min(player.positionSec, duration || 1)}
            onChange={(event) => player.seek(Number(event.target.value))}
            aria-label="播放进度"
          />
        </div>
        <span className="gh-music-now-time">{formatSongDuration(duration * 1000)}</span>
      </div>

      <div className="gh-music-now-tools">
        <button
          className="gh-music-now-tool"
          onClick={player.cycleMode}
          aria-label={`播放模式：${MODE_LABEL[player.mode]}`}
          title={MODE_LABEL[player.mode]}
        >
          <Icon name={MODE_ICON[player.mode]} size={15} />
          <span>{MODE_LABEL[player.mode]}</span>
        </button>

        <label className="gh-music-now-volume">
          <Icon name="volume" size={15} />
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(player.volume * 100)}
            onChange={(event) => player.setVolume(Number(event.target.value) / 100)}
            aria-label="音量"
          />
        </label>

        <button
          className={`gh-music-now-tool ${lyricsOpen ? 'gh-music-now-tool--active' : ''}`}
          onClick={() => setLyricsOpen(open => !open)}
          aria-expanded={lyricsOpen}
        >
          <Icon name="bookOpen" size={15} />
          <span>{lyricsOpen ? '收起歌词' : '显示歌词'}</span>
        </button>
      </div>

      {player.trialEndSec !== null && (
        <p className="gh-music-now-tip">
          该歌曲需要网易云黑胶会员，当前为非会员试听片段（约 {player.trialEndSec} 秒）。
          右上角「扫码绑定」自己的账号后可完整播放。
        </p>
      )}

      {lyricsOpen && (
        <div className="gh-music-lyrics" ref={lyricsRef} role="log" aria-label="歌词">
          {lines.length === 0
            ? <p className="gh-music-lyrics-empty">这首还没有歌词</p>
            : lines.map((line, index) => {
              const translation = translatedByTime.get(line.time)
              return (
                <button
                  key={`${line.time}-${index}`}
                  ref={(el) => {
                    if (el) lineRefs.current.set(index, el)
                    else lineRefs.current.delete(index)
                  }}
                  className={`gh-music-lyric ${index === activeIndex ? 'gh-music-lyric--active' : ''}`}
                  onClick={() => player.seek(line.time)}
                  title="跳到这一句"
                >
                  <span className="gh-music-lyric-text">{line.line || '♪'}</span>
                  {translation && <span className="gh-music-lyric-sub">{translation}</span>}
                </button>
              )
            })}
        </div>
      )}
    </section>
  )
}
