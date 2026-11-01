import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../components/ui/Icon'
import { useMusicPlayer } from '../contexts/MusicPlayerContext'
import { api } from '../lib/api'
import { formatSongDuration, normalizeSongList, type SongView } from '../lib/music/song'
import type {
  MusicQrCheck,
  MusicQrPrepare,
  MusicRecommendResponse,
  MusicSearchResponse,
  MusicStatus,
  MusicToplistItem,
  MusicToplistResponse,
} from '../types/music'

/**
 * 网易云音乐页（/music）：
 *   - 未绑定：扫码登录卡（1.5s 轮询；含第三方接口登录的账号风控提示）
 *   - 已绑定：显示昵称 + 解绑
 *   - Tab：每日推荐（需绑定）/ 排行榜 / 搜索（单曲 + 歌单；未绑定匿名可搜可听免费歌）
 * 点歌即入队（playQueue），实际播放由全局 MusicPlayerBar 承载。
 */

type MainTab = 'recommend' | 'toplist' | 'search'
type SearchType = 1 | 1000
interface PlaylistBrief { id: number; name: string; coverImgUrl?: string }

const QR_POLL_INTERVAL_MS = 1500

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function songArtistsText(song: SongView): string {
  return song.artists || '未知歌手'
}

export default function MusicPage() {
  const player = useMusicPlayer()
  const [status, setStatus] = useState<MusicStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [toast, setToast] = useState<{ text: string; kind: 'success' | 'error' } | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)

  const [tab, setTab] = useState<MainTab>('toplist')

  // 扫码登录
  const [qr, setQr] = useState<MusicQrPrepare | null>(null)
  const [qrCreating, setQrCreating] = useState(false)
  const [qrState, setQrState] = useState<{ code: number; message: string } | null>(null)
  const [unbinding, setUnbinding] = useState(false)

  // 排行榜与歌单
  const [toplists, setToplists] = useState<MusicToplistItem[]>([])
  const [toplistLoading, setToplistLoading] = useState(false)
  const [playlist, setPlaylist] = useState<{ id: number; name: string } | null>(null)
  const [playlistSongs, setPlaylistSongs] = useState<SongView[]>([])
  const [playlistLoading, setPlaylistLoading] = useState(false)

  // 每日推荐
  const [recommendSongs, setRecommendSongs] = useState<SongView[]>([])
  const [recommendLoading, setRecommendLoading] = useState(false)

  // 搜索
  const [keywords, setKeywords] = useState('')
  const [searchType, setSearchType] = useState<SearchType>(1)
  const [searching, setSearching] = useState(false)
  const [searchSongs, setSearchSongs] = useState<SongView[]>([])
  const [searchPlaylists, setSearchPlaylists] = useState<PlaylistBrief[] | null>(null)

  const showToast = useCallback((text: string, kind: 'success' | 'error') => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    setToast({ text, kind })
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2600)
  }, [])

  const loadStatus = useCallback(async () => {
    try {
      const data = await api.get<MusicStatus>('/music/status')
      if (mountedRef.current) setStatus(data)
    } catch (err) {
      if (mountedRef.current) showToast(errMessage(err, '绑定状态获取失败'), 'error')
    } finally {
      if (mountedRef.current) setStatusLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    mountedRef.current = true
    void loadStatus()
    return () => {
      mountedRef.current = false
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    }
  }, [loadStatus])

  // === 排行榜（默认 Tab）===
  useEffect(() => {
    if (tab !== 'toplist' || toplists.length > 0) return
    setToplistLoading(true)
    void api.get<MusicToplistResponse>('/music/toplist')
      .then((data) => {
        if (mountedRef.current) setToplists((data.list ?? []).filter(item => item && item.id != null))
      })
      .catch((err) => showToast(errMessage(err, '排行榜加载失败'), 'error'))
      .finally(() => { if (mountedRef.current) setToplistLoading(false) })
  }, [tab, toplists.length, showToast])

  // === 每日推荐（需绑定）===
  useEffect(() => {
    if (tab !== 'recommend' || !status?.bound || recommendSongs.length > 0) return
    setRecommendLoading(true)
    void api.get<MusicRecommendResponse>('/music/recommend/songs')
      .then((data) => {
        if (mountedRef.current) setRecommendSongs(normalizeSongList(data.data?.dailySongs))
      })
      .catch((err) => showToast(errMessage(err, '每日推荐加载失败'), 'error'))
      .finally(() => { if (mountedRef.current) setRecommendLoading(false) })
  }, [tab, status?.bound, recommendSongs.length, showToast])

  // === 扫码登录 ===
  const createQr = useCallback(async () => {
    setQrCreating(true)
    setQrState(null)
    try {
      const data = await api.get<MusicQrPrepare>('/music/login/qr/prepare')
      if (mountedRef.current) setQr(data)
    } catch (err) {
      showToast(errMessage(err, '二维码生成失败'), 'error')
    } finally {
      if (mountedRef.current) setQrCreating(false)
    }
  }, [showToast])

  const cancelQr = useCallback(() => {
    setQr(null)
    setQrState(null)
  }, [])

  // 轮询扫码状态
  useEffect(() => {
    if (!qr) return
    let stopped = false
    let timer: number | null = null

    const poll = () => {
      void api.get<MusicQrCheck>(`/music/login/qr/check?key=${encodeURIComponent(qr.key)}`)
        .then((data) => {
          if (stopped || !mountedRef.current) return
          setQrState({ code: data.code, message: data.message })
          if (data.code === 803 && data.account) {
            setStatus(data.account)
            setQr(null)
            showToast(`已绑定网易云账号「${data.account.nickname || '未知昵称'}」`, 'success')
            return
          }
          if (data.code === 800) return // 二维码过期，停在提示态等用户刷新
          timer = window.setTimeout(poll, QR_POLL_INTERVAL_MS)
        })
        .catch(() => {
          if (stopped || !mountedRef.current) return
          timer = window.setTimeout(poll, QR_POLL_INTERVAL_MS * 2) // 网络抖动后放慢重试
        })
    }
    poll()
    return () => {
      stopped = true
      if (timer) window.clearTimeout(timer)
    }
  }, [qr, showToast])

  const unbind = useCallback(async () => {
    if (!window.confirm('确定解绑网易云账号吗？播放队列会保留，但每日推荐等需要重新扫码。')) return
    setUnbinding(true)
    try {
      await api.post('/music/logout')
      if (mountedRef.current) {
        setStatus({ bound: false, nickname: '', avatarUrl: '' })
        setRecommendSongs([])
        showToast('已解绑', 'success')
      }
    } catch (err) {
      showToast(errMessage(err, '解绑失败'), 'error')
    } finally {
      if (mountedRef.current) setUnbinding(false)
    }
  }, [showToast])

  // === 搜索 ===
  const doSearch = useCallback(() => {
    const trimmed = keywords.trim()
    if (!trimmed) return
    setSearching(true)
    void api.get<MusicSearchResponse>(
      `/music/search?keywords=${encodeURIComponent(trimmed)}&type=${searchType}&limit=30`,
    )
      .then((data) => {
        if (!mountedRef.current) return
        setSearchSongs(normalizeSongList(data.result?.songs))
        setSearchPlaylists(data.result?.playlists ?? [])
      })
      .catch((err) => showToast(errMessage(err, '搜索失败'), 'error'))
      .finally(() => { if (mountedRef.current) setSearching(false) })
  }, [keywords, searchType, showToast])

  const openPlaylist = useCallback(async (id: number, name: string) => {
    setPlaylist({ id, name })
    setPlaylistLoading(true)
    setPlaylistSongs([])
    try {
      const data = await api.get<{ songs?: unknown[] }>(`/music/playlist/${id}/tracks?limit=50`)
      if (mountedRef.current) setPlaylistSongs(normalizeSongList(data.songs))
    } catch (err) {
      showToast(errMessage(err, '歌单加载失败'), 'error')
    } finally {
      if (mountedRef.current) setPlaylistLoading(false)
    }
  }, [showToast])

  // === 渲染辅助 ===
  const renderSongList = (songs: SongView[], emptyText: string) => {
    if (songs.length === 0) return <div className="gh-music-empty">{emptyText}</div>
    return (
      <ul className="gh-music-song-list">
        {songs.map((song, songIndex) => (
          <li
            key={`${song.id}-${songIndex}`}
            className={`gh-music-song ${player.song?.id === song.id ? 'gh-music-song--active' : ''}`}
          >
            <button
              className="gh-music-song-main"
              onClick={() => player.playQueue(songs, songIndex)}
              disabled={player.loading && player.song?.id === song.id}
            >
              {song.picUrl
                ? <img className="gh-music-song-cover" src={song.picUrl} alt="" loading="lazy" />
                : <span className="gh-music-song-cover gh-music-song-cover--fallback"><Icon name="music" size={14} /></span>}
              <span className="gh-music-song-meta">
                <span className="gh-music-song-name">
                  {song.name}
                  {song.fee === 1 && <span className="gh-music-song-vip">VIP</span>}
                </span>
                <span className="gh-music-song-artists">{songArtistsText(song)}{song.albumName ? ` · ${song.albumName}` : ''}</span>
              </span>
              <span className="gh-music-song-duration">{formatSongDuration(song.durationMs)}</span>
            </button>
          </li>
        ))}
      </ul>
    )
  }

  const renderPlaylists = () => {
    const lists = searchPlaylists ?? []
    if (lists.length === 0) return <div className="gh-music-empty">没有找到相关歌单</div>
    return (
      <ul className="gh-music-playlist-grid">
        {lists.map(item => (
          <li key={item.id}>
            <button className="gh-music-playlist-card" onClick={() => void openPlaylist(item.id, item.name)}>
              {item.coverImgUrl
                ? <img src={item.coverImgUrl} alt="" loading="lazy" />
                : <span className="gh-music-playlist-card-fallback"><Icon name="music" size={18} /></span>}
              <span className="gh-music-playlist-card-name">{item.name}</span>
            </button>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="gh-page gh-music-page">
      <header className="gh-music-header">
        <div>
          <h1 className="gh-music-title">网易云音乐</h1>
          <p className="gh-music-subtitle">站内搜索与播放（不解灰的接口代理；VIP 歌曲需本人黑胶账号，仅 30 秒试听）</p>
        </div>
        {statusLoading ? (
          <span className="gh-music-subtitle">状态加载中…</span>
        ) : status?.bound ? (
          <div className="gh-music-account">
            {status.avatarUrl && <img className="gh-music-account-avatar" src={status.avatarUrl} alt="" />}
            <span>{status.nickname || '已绑定'}</span>
            <button className="gh-btn gh-btn--ghost" onClick={() => void unbind()} disabled={unbinding}>解绑</button>
          </div>
        ) : (
          <button className="gh-btn gh-btn--primary" onClick={() => void createQr()} disabled={qrCreating}>
            扫码绑定网易云
          </button>
        )}
      </header>

      {!statusLoading && !status?.bound && qr === null && (
        <div className="gh-music-notice">
          <Icon name="shield" size={14} />
          未绑定账号也能搜索和听免费歌曲；绑定自己的账号可听 VIP 试听、每日推荐与更高音质。二维码登录使用第三方开源接口，存在极低的账号风控风险。
        </div>
      )}

      {qr && (
        <div className="gh-music-qr-card">
          <div className="gh-music-qr-head">
            <span>使用网易云音乐 App 扫码登录</span>
            <button className="gh-reader-icon-btn" onClick={cancelQr} aria-label="取消扫码">
              <Icon name="close" size={13} />
            </button>
          </div>
          <div className="gh-music-qr-body">
            <img className="gh-music-qr-img" src={qr.qrimg} alt="网易云登录二维码" />
            <div className="gh-music-qr-state">
              {qrState?.code === 800 ? (
                <>
                  <span>二维码已过期</span>
                  <button className="gh-btn gh-btn--ghost" onClick={() => void createQr()}>刷新二维码</button>
                </>
              ) : (
                <span>{qrState?.message ?? '等待扫码…'}</span>
              )}
            </div>
          </div>
        </div>
      )}

      <nav className="gh-music-tabs" role="tablist">
        <button
          className={`gh-music-tab ${tab === 'recommend' ? 'gh-music-tab--active' : ''}`}
          onClick={() => setTab('recommend')}
          role="tab"
          aria-selected={tab === 'recommend'}
        >
          每日推荐
        </button>
        <button
          className={`gh-music-tab ${tab === 'toplist' ? 'gh-music-tab--active' : ''}`}
          onClick={() => { setTab('toplist'); setPlaylist(null) }}
          role="tab"
          aria-selected={tab === 'toplist'}
        >
          排行榜
        </button>
        <button
          className={`gh-music-tab ${tab === 'search' ? 'gh-music-tab--active' : ''}`}
          onClick={() => { setTab('search'); setPlaylist(null) }}
          role="tab"
          aria-selected={tab === 'search'}
        >
          搜索
        </button>
      </nav>

      {player.error && (
        <div className="gh-music-notice gh-music-notice--error">
          {player.error}
          <button className="gh-reader-icon-btn" onClick={player.clearError} aria-label="关闭提示">
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      {tab === 'recommend' && (
        status?.bound
          ? (recommendLoading ? <div className="gh-music-empty">推荐加载中…</div> : renderSongList(recommendSongs, '今天还没有推荐，稍后再来看看'))
          : <div className="gh-music-empty">绑定网易云账号后可查看每日推荐</div>
      )}

      {tab === 'toplist' && (
        playlist ? (
          <div>
            <div className="gh-music-playlist-head">
              <button className="gh-btn gh-btn--ghost" onClick={() => setPlaylist(null)}>
                <Icon name="arrow-left" size={14} /> 返回榜单
              </button>
              <span className="gh-music-playlist-name">{playlist.name}</span>
            </div>
            {playlistLoading ? <div className="gh-music-empty">加载中…</div> : renderSongList(playlistSongs, '这个榜单暂时是空的')}
          </div>
        ) : (
          toplists.length === 0
            ? <div className="gh-music-empty">{toplistLoading ? '榜单加载中…' : '榜单加载失败'}</div>
            : (
              <ul className="gh-music-toplist-grid">
                {toplists.map(item => (
                  <li key={item.id}>
                    <button className="gh-music-toplist-card" onClick={() => void openPlaylist(item.id, item.name)}>
                      {item.coverImgUrl
                        ? <img src={item.coverImgUrl} alt="" loading="lazy" />
                        : <span className="gh-music-playlist-card-fallback"><Icon name="trophy" size={18} /></span>}
                      <span className="gh-music-toplist-card-name">{item.name}</span>
                      {item.updateFrequency && <span className="gh-music-toplist-card-freq">{item.updateFrequency}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )
        )
      )}

      {tab === 'search' && (
        <div>
          <div className="gh-music-search-bar">
            <div className="gh-music-search-input">
              <Icon name="search" size={15} />
              <input
                type="text"
                value={keywords}
                placeholder="搜索歌曲或歌单…"
                onChange={event => setKeywords(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') doSearch() }}
              />
            </div>
            <div className="gh-music-search-type">
              <button
                className={`gh-music-tab ${searchType === 1 ? 'gh-music-tab--active' : ''}`}
                onClick={() => setSearchType(1)}
              >单曲</button>
              <button
                className={`gh-music-tab ${searchType === 1000 ? 'gh-music-tab--active' : ''}`}
                onClick={() => setSearchType(1000)}
              >歌单</button>
            </div>
            <button className="gh-btn gh-btn--primary" onClick={doSearch} disabled={searching || !keywords.trim()}>
              {searching ? '搜索中…' : '搜索'}
            </button>
          </div>
          {searchType === 1
            ? (searchSongs.length > 0 || searching
                ? renderSongList(searchSongs, searching ? '搜索中…' : '输入关键词开始搜索')
                : <div className="gh-music-empty">输入关键词开始搜索（未绑定账号可听免费歌曲）</div>)
            : renderPlaylists()}
        </div>
      )}

      {toast && <div className={`gh-reader-toast gh-reader-toast--${toast.kind}`}>{toast.text}</div>}
    </div>
  )
}
