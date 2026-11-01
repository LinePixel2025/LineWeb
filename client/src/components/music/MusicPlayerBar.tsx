import { useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../ui/Icon'
import { useMusicPlayer, type MusicPlayMode } from '../../contexts/MusicPlayerContext'
import { formatSongDuration } from '../../lib/music/song'

/**
 * 全局迷你播放条（挂在 App Routes 外层，跨页持续显示）。
 * 没有播放中的歌曲时渲染 null。
 */

const MODE_LABEL: Record<MusicPlayMode, string> = {
  order: '顺序播放',
  repeat: '单曲循环',
  shuffle: '随机播放',
}

export default function MusicPlayerBar() {
  const player = useMusicPlayer()
  const [queueOpen, setQueueOpen] = useState(false)
  const { song } = player

  if (!song) return null

  const duration = player.durationSec > 0
    ? player.durationSec
    : song.durationMs > 0 ? song.durationMs / 1000 : 0
  const progress = duration > 0 ? Math.min(player.positionSec / duration, 1) : 0

  return (
    <div className="gh-music-bar" role="region" aria-label="音乐播放器">
      <Link to="/music" className="gh-music-bar-info">
        {song.picUrl
          ? <img className="gh-music-bar-cover" src={song.picUrl} alt="" />
          : <span className="gh-music-bar-cover gh-music-bar-cover--fallback"><Icon name="music" size={16} /></span>}
        <span className="gh-music-bar-meta">
          <span className="gh-music-bar-name">{song.name}</span>
          <span className="gh-music-bar-artists">{song.artists}</span>
        </span>
      </Link>

      <div className="gh-music-bar-controls">
        <button className="gh-music-bar-btn" onClick={player.prev} aria-label="上一首">
          <Icon name="chevron-left" size={16} />
        </button>
        <button
          className="gh-music-bar-btn gh-music-bar-btn--play"
          onClick={player.toggle}
          disabled={player.loading}
          aria-label={player.playing ? '暂停' : '播放'}
        >
          {player.loading
            ? <Icon name="refresh" size={16} />
            : player.playing ? <Icon name="audio" size={16} /> : <Icon name="chevron-right" size={18} />}
        </button>
        <button className="gh-music-bar-btn" onClick={player.next} aria-label="下一首">
          <Icon name="chevron-right" size={16} />
        </button>
      </div>

      <div className="gh-music-bar-progress">
        <span className="gh-music-bar-time">{formatSongDuration(player.positionSec * 1000)}</span>
        <input
          type="range"
          className="gh-music-bar-seek"
          min={0}
          max={Math.max(duration, 1)}
          step={1}
          value={Math.min(player.positionSec, duration || 1)}
          onChange={(event) => player.seek(Number(event.target.value))}
          aria-label="播放进度"
        />
        <span className="gh-music-bar-time">{formatSongDuration(duration * 1000)}</span>
      </div>

      <div className="gh-music-bar-extra">
        <button
          className="gh-music-bar-btn"
          onClick={player.cycleMode}
          aria-label={`播放模式：${MODE_LABEL[player.mode]}`}
          title={MODE_LABEL[player.mode]}
        >
          <span className="gh-music-bar-mode">{player.mode === 'order' ? '顺' : player.mode === 'repeat' ? '循' : '随'}</span>
        </button>
        <button
          className="gh-music-bar-btn"
          onClick={() => setQueueOpen(open => !open)}
          aria-label="播放队列"
        >
          <Icon name="list" size={15} />
        </button>
      </div>

      {queueOpen && (
        <div className="gh-music-bar-queue" role="listbox" aria-label="播放队列">
          <div className="gh-music-bar-queue-head">
            <span>播放队列（{player.queue.length}）</span>
            <button className="gh-reader-icon-btn" onClick={() => setQueueOpen(false)} aria-label="收起队列">
              <Icon name="close" size={13} />
            </button>
          </div>
          <ul className="gh-music-bar-queue-list">
            {player.queue.map((item, itemIndex) => (
              <li key={`${item.id}-${itemIndex}`}>
                <button
                  className={`gh-music-bar-queue-item ${itemIndex === player.index ? 'gh-music-bar-queue-item--active' : ''}`}
                  onClick={() => {
                    player.playAt(itemIndex)
                  }}
                >
                  <span className="gh-music-bar-queue-name">{item.name}</span>
                  <span className="gh-music-bar-queue-artists">{item.artists}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
