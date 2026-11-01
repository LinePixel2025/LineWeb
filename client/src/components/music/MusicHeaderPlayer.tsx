import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../ui/Icon'
import MusicImage from './MusicImage'
import { useMusicPlayer, type MusicPlayMode } from '../../contexts/MusicPlayerContext'
import { getToken } from '../../lib/api'
import { findLrcIndex, formatSongDuration } from '../../lib/music/song'
import { resolveMusicImageSrc } from '../../lib/music/stream'
import { useLyrics } from '../../lib/music/useLyrics'

/**
 * 标题栏内嵌的音乐播放器（取代原先悬浮在页面底部挡住内容的迷你播放条）。
 *
 * - 挂在全局 Header 中间，跨页持续显示；没有播放中的歌曲时返回 null（顶栏保持原有留白）
 * - 宽度允许时（播放器自身 ≥ 380px）第二行显示当前一句歌词，否则回退为歌手名；
 *   没有歌词时始终显示歌手名
 * - 窄屏逐级收窄：先去掉进度条/时间，再去掉模式键，最后只保留封面 + 播放/暂停 + 下一首
 * - 队列是顶栏内的下拉浮层（.gh-music-hp-queue），不占用页面空间
 */

const MODE_LABEL: Record<MusicPlayMode, string> = {
  order: '顺序播放',
  repeat: '单曲循环',
  shuffle: '随机播放',
}

const MODE_ICON: Record<MusicPlayMode, 'list' | 'repeat' | 'shuffle'> = {
  order: 'list',
  repeat: 'repeat',
  shuffle: 'shuffle',
}

export default function MusicHeaderPlayer() {
  const player = useMusicPlayer()
  const [queueOpen, setQueueOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const { song } = player
  const { lines } = useLyrics(song?.id ?? null)

  const activeIndex = useMemo(
    () => findLrcIndex(lines, player.positionSec),
    [lines, player.positionSec],
  )
  const activeLyric = activeIndex >= 0 ? (lines[activeIndex]?.line ?? '').trim() : ''

  // 点浮层外面收起队列
  useEffect(() => {
    if (!queueOpen) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setQueueOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setQueueOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [queueOpen])

  // 切歌时收起队列（避免浮层里高亮错位）
  useEffect(() => { setQueueOpen(false) }, [song?.id])

  if (!song) return null

  const duration = player.durationSec > 0
    ? player.durationSec
    : song.durationMs > 0 ? song.durationMs / 1000 : 0
  const progress = duration > 0 ? Math.min(player.positionSec / duration, 1) : 0
  // 背景氛围图用同一套地址策略（直连失败时列表里的 <MusicImage> 会自行降级）
  const cover = resolveMusicImageSrc(song.picUrl, player.streamViaProxy, getToken())
  const subtitle = activeLyric || song.artists || '未知歌手'
  const rootStyle = cover
    ? ({ '--gh-hp-art': `url("${cover}")` } as CSSProperties)
    : undefined

  return (
    <div
      className={`gh-music-hp${queueOpen ? ' gh-music-hp--open' : ''}${activeLyric ? ' gh-music-hp--lyric' : ''}${player.playing ? ' gh-music-hp--playing' : ''}`}
      role="region"
      aria-label="音乐播放器"
      ref={rootRef}
      style={rootStyle}
    >
      <Link to="/music" className="gh-music-hp-info" title={`${song.name} · ${subtitle}`}>
        <MusicImage
          url={song.picUrl}
          proxy={player.streamViaProxy}
          className="gh-music-hp-cover"
          loading="eager"
          fallback={<span className="gh-music-hp-cover gh-music-hp-cover--fallback"><Icon name="music" size={14} /></span>}
        />
        <span className={`gh-music-hp-meta${activeLyric ? ' gh-music-hp-meta--lyric' : ''}`}>
          <span className="gh-music-hp-name">
            {song.name}
            {player.trialEndSec !== null && <span className="gh-music-hp-trial">试听</span>}
          </span>
          <span className="gh-music-hp-artists">{song.artists || '未知歌手'}</span>
          {activeLyric && (
            <span
              key={`${activeIndex}-${activeLyric}`}
              className="gh-music-hp-lyric"
              title={activeLyric}
            >
              {activeLyric}
            </span>
          )}
        </span>
      </Link>

      <div className="gh-music-hp-controls">
        <button className="gh-music-hp-btn gh-music-hp-btn--skip" onClick={player.prev} aria-label="上一首" title="上一首">
          <Icon name="skip-back" size={15} />
        </button>
        <button
          className={`gh-music-hp-btn gh-music-hp-btn--play${player.loading ? ' gh-music-hp-btn--loading' : ''}`}
          onClick={player.toggle}
          disabled={player.loading}
          aria-label={player.playing ? '暂停' : '播放'}
          title={player.playing ? '暂停' : '播放'}
        >
          {player.loading
            ? <Icon name="refresh" size={14} />
            : player.playing ? <Icon name="pause" size={14} /> : <Icon name="play" size={14} />}
        </button>
        <button className="gh-music-hp-btn gh-music-hp-btn--skip" onClick={player.next} aria-label="下一首" title="下一首">
          <Icon name="skip-forward" size={15} />
        </button>
      </div>

      <div className="gh-music-hp-progress">
        <span className="gh-music-hp-time">{formatSongDuration(player.positionSec * 1000)}</span>
        <div className="gh-music-hp-track">
          <div className="gh-music-hp-track-fill" style={{ width: `${progress * 100}%` }} />
          <input
            type="range"
            className="gh-music-hp-seek"
            min={0}
            max={Math.max(duration, 1)}
            step={1}
            value={Math.min(player.positionSec, duration || 1)}
            onChange={(event) => player.seek(Number(event.target.value))}
            aria-label="播放进度"
          />
        </div>
        <span className="gh-music-hp-time">{formatSongDuration(duration * 1000)}</span>
      </div>

      <div className="gh-music-hp-extra">
        <button
          className="gh-music-hp-btn gh-music-hp-mode"
          onClick={player.cycleMode}
          aria-label={`播放模式：${MODE_LABEL[player.mode]}`}
          title={MODE_LABEL[player.mode]}
        >
          <Icon name={MODE_ICON[player.mode]} size={14} />
        </button>
        <button
          className={`gh-music-hp-btn gh-music-hp-btn--queue ${queueOpen ? 'gh-music-hp-btn--active' : ''}`}
          onClick={() => setQueueOpen(open => !open)}
          aria-label="播放队列"
          aria-expanded={queueOpen}
          title="播放队列"
        >
          <Icon name="queue" size={14} />
        </button>
      </div>

      {queueOpen && (
        <div className="gh-music-hp-queue" role="listbox" aria-label="播放队列">
          <div className="gh-music-hp-queue-head">
            <span>播放队列（{player.queue.length}）</span>
            <button className="gh-reader-icon-btn" onClick={() => setQueueOpen(false)} aria-label="收起队列">
              <Icon name="close" size={12} />
            </button>
          </div>
          <ul className="gh-music-hp-queue-list">
            {player.queue.map((item, itemIndex) => (
              <li key={`${item.id}-${itemIndex}`}>
                <button
                  className={`gh-music-hp-queue-item ${itemIndex === player.index ? 'gh-music-hp-queue-item--active' : ''}`}
                  onClick={() => player.playAt(itemIndex)}
                >
                  <span className="gh-music-hp-queue-name">{item.name}</span>
                  <span className="gh-music-hp-queue-artists">{item.artists || '未知歌手'}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
