import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../ui/Icon'
import {
  findLrcIndex,
  formatSongDuration,
  upgradeMediaUrl,
  type SongView,
} from '../../lib/music/song'
import { useLyrics } from '../../lib/music/useLyrics'
import { useMusicPlayer, type MusicPlayMode } from '../../contexts/MusicPlayerContext'

/**
 * 正在播放卡（音乐页顶部）：大封面 + 传输控制 + 歌词。
 *
 * - 歌词来自 GET /api/music/lyric，useLyrics 做模块级缓存（与顶栏迷你播放器共享）
 * - 当前行按播放进度高亮；自动滚动只在「跟随」状态下进行，用户主动滚歌词后
 *   暂停跟随（12 秒后或点「回到当前」恢复），避免读歌词时被强行拽回
 * - 歌词容器自身是定位上下文，滚动目标按 offsetTop 计算，不会再滚错位置或把
 *   整个页面一起滚走
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

/** 用户滚歌词后暂停跟随的时长；期间不会把视图拽回当前行 */
const FOLLOW_RESUME_MS = 12_000

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

function MiniEqualizer({ className = '' }: { className?: string }) {
  return (
    <span className={`gh-music-eq ${className}`.trim()} aria-hidden="true">
      <span /><span /><span /><span />
    </span>
  )
}

export default function NowPlayingCard() {
  const player = useMusicPlayer()
  const { song } = player
  const { lines, translated } = useLyrics(song?.id ?? null)
  const [lyricsOpen, setLyricsOpen] = useState(true)
  /** 是否让歌词自动跟随当前行（用户滚动后暂时关闭） */
  const [follow, setFollow] = useState(true)
  const lyricsRef = useRef<HTMLDivElement | null>(null)
  const lineRefs = useRef(new Map<number, HTMLButtonElement>())
  const followTimerRef = useRef<number | null>(null)

  const cover = upgradeMediaUrl(song?.picUrl)

  const duration = player.durationSec > 0
    ? player.durationSec
    : song && song.durationMs > 0 ? song.durationMs / 1000 : 0
  const progress = duration > 0 ? Math.min(player.positionSec / duration, 1) : 0

  const activeIndex = useMemo(
    () => findLrcIndex(lines, player.positionSec),
    [lines, player.positionSec],
  )
  const activeLine = activeIndex >= 0 ? lines[activeIndex] : null

  const translatedByTime = useMemo(() => {
    const map = new Map<number, string>()
    for (const line of translated) map.set(line.time, line.line)
    return map
  }, [translated])

  /** 恢复跟随：清掉暂停计时器并滚回当前行 */
  const resumeFollow = useCallback(() => {
    if (followTimerRef.current !== null) {
      window.clearTimeout(followTimerRef.current)
      followTimerRef.current = null
    }
    setFollow(true)
  }, [])

  /** 用户主动浏览歌词：暂停跟随一段时间，超时后自动恢复 */
  const pauseFollow = useCallback(() => {
    setFollow(false)
    if (followTimerRef.current !== null) window.clearTimeout(followTimerRef.current)
    followTimerRef.current = window.setTimeout(() => {
      followTimerRef.current = null
      setFollow(true)
    }, FOLLOW_RESUME_MS)
  }, [])

  // 切歌 / 重新打开歌词时回到跟随状态
  useEffect(() => {
    setFollow(true)
    if (followTimerRef.current !== null) {
      window.clearTimeout(followTimerRef.current)
      followTimerRef.current = null
    }
  }, [song?.id])

  useEffect(() => () => {
    if (followTimerRef.current !== null) window.clearTimeout(followTimerRef.current)
  }, [])

  // 当前行滚动到歌词面板中间（只在行变化且处于跟随状态时滚）。
  // 直接改滚动容器的 scrollTop，不用 scrollIntoView —— 后者会把整个页面一起滚走。
  useEffect(() => {
    if (!lyricsOpen || !follow || activeIndex < 0) return
    const container = lyricsRef.current
    const el = lineRefs.current.get(activeIndex)
    if (!container || !el) return
    // 歌词容器是 position: relative，offsetTop 才是相对容器的真实偏移
    const target = Math.max(0, el.offsetTop - (container.clientHeight - el.offsetHeight) / 2)
    const distance = Math.abs(container.scrollTop - target)
    // 跨段跳转（拖动进度条 / 点歌词）用瞬时定位，逐行前进才用平滑滚动，
    // 避免大跨度时长时间滚动动画导致高亮行迟迟不到中间。
    const behavior: ScrollBehavior = distance > container.clientHeight * 2.5 ? 'auto' : 'smooth'
    container.scrollTo({ top: target, behavior })
  }, [activeIndex, follow, lyricsOpen, lines.length])

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

  const cardClass = [
    'gh-music-now',
    lyricsOpen ? '' : 'gh-music-now--solo',
    player.playing ? 'gh-music-now--playing' : '',
  ].filter(Boolean).join(' ')

  return (
    <section className={cardClass} aria-label="正在播放">
      <span
        className={`gh-music-now-ambient${cover ? '' : ' gh-music-now-ambient--fallback'}`}
        style={cover ? { backgroundImage: `url("${cover}")` } : undefined}
        aria-hidden="true"
      />

      <div className="gh-music-now-info">
        <div className="gh-music-now-head">
          <div className="gh-music-now-art">
            <span className="gh-music-now-art-ring" aria-hidden="true" />
            <CoverArt song={song} size="lg" />
            {player.playing && (
              <span className="gh-music-now-art-eq" title="正在播放" aria-hidden="true">
                <MiniEqualizer />
              </span>
            )}
          </div>

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
              className={`gh-music-now-btn gh-music-now-btn--play${player.loading ? ' gh-music-now-btn--loading' : ''}`}
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
              onPointerDown={resumeFollow}
              aria-label="播放进度"
              aria-valuetext={`${formatSongDuration(player.positionSec * 1000)} / ${formatSongDuration(duration * 1000)}`}
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

          <label className="gh-music-now-volume" title={`音量 ${Math.round(player.volume * 100)}%`}>
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
            title={lyricsOpen ? '收起歌词' : '显示歌词'}
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
      </div>

      {lyricsOpen && (
        <div className="gh-music-now-lyric-pane">
          <div className="gh-music-now-lyric-head">
            <div>
              <span className="gh-music-now-kicker">LYRICS</span>
              <h3>歌词</h3>
            </div>
            <div className="gh-music-now-lyric-meta">
              {translated.length > 0 && <span className="gh-music-badge">双语</span>}
              <span className="gh-music-now-lyric-count">
                {lines.length > 0 ? `${lines.length} 行` : '暂无'}
              </span>
              {!follow && activeLine && (
                <button
                  className="gh-music-now-follow"
                  onClick={resumeFollow}
                  title="回到当前播放的一句"
                >
                  回到当前
                </button>
              )}
            </div>
          </div>

          <div
            className="gh-music-lyrics"
            ref={lyricsRef}
            role="log"
            aria-label="歌词"
            aria-live="off"
            onWheel={pauseFollow}
            onTouchMove={pauseFollow}
          >
            {lines.length === 0 ? (
              <div className="gh-music-lyrics-empty">
                <MiniEqualizer />
                <p>这首还没有歌词</p>
                <span>先听听旋律，下一首也许就有</span>
              </div>
            ) : lines.map((line, index) => {
              const translation = translatedByTime.get(line.time)
              return (
                <button
                  key={`${line.time}-${index}`}
                  type="button"
                  ref={(el) => {
                    if (el) lineRefs.current.set(index, el)
                    else lineRefs.current.delete(index)
                  }}
                  className={`gh-music-lyric ${index === activeIndex ? 'gh-music-lyric--active' : ''}`}
                  onClick={() => { resumeFollow(); player.seek(line.time) }}
                  aria-current={index === activeIndex ? 'true' : undefined}
                  title="跳到这一句"
                >
                  <span className="gh-music-lyric-text">{line.line || '♪'}</span>
                  {translation && <span className="gh-music-lyric-sub">{translation}</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
