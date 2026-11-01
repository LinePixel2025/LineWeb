/**
 * 网易云音乐类型（与服务端 /api/music 代理的响应契约保持一致，见 docs/music-api.md）。
 * 网易云原始字段经服务端透传，这里只声明前端实际消费的部分。
 */

/** GET /api/music/status */
export interface MusicStatus {
  bound: boolean
  nickname: string
  avatarUrl: string
}

/** GET /api/music/login/qr/prepare */
export interface MusicQrPrepare {
  key: string
  /** base64 data URL 图片 */
  qrimg: string
}

/** GET /api/music/login/qr/check */
export interface MusicQrCheck {
  /** 800 过期 / 801 待扫 / 802 已扫待确认 / 803 成功 */
  code: number
  message: string
  account: MusicStatus | null
}

/** 排行榜条目（GET /api/music/toplist 的 list[]） */
export interface MusicToplistItem {
  id: number
  name: string
  description?: string
  updateFrequency?: string
  coverImgUrl?: string
}

export interface MusicToplistResponse {
  list?: MusicToplistItem[]
}

/** 搜索响应（cloudsearch 透传：result.songs / result.albums / result.playlists） */
export interface MusicSearchResponse {
  code?: number
  result?: {
    songs?: unknown[]
    songCount?: number
    albums?: { id: number; name: string; picUrl?: string; artist?: { name?: string } }[]
    albumCount?: number
    playlists?: { id: number; name: string; coverImgUrl?: string; trackCount?: number }[]
    playlistCount?: number
  }
}

/** 歌单曲目响应（playlist_track_all 透传） */
export interface MusicPlaylistTracksResponse {
  code?: number
  songs?: unknown[]
}

/** 每日推荐（recommend_songs 透传） */
export interface MusicRecommendResponse {
  code?: number
  data?: { dailySongs?: unknown[] }
}

/** 播放地址（song_url_v1 透传：data[0].url） */
export interface MusicSongUrlResponse {
  code?: number
  data?: {
    url?: string | null
    level?: string
    type?: string
    fee?: number
    /** 音频实际时长（毫秒）。VIP 试听片段会明显短于歌曲本身 */
    time?: number
    /** 非 null 表示这是 VIP 试听片段（start/end 单位秒） */
    freeTrialInfo?: { start?: number; end?: number; fragmentType?: number } | null
  }[]
}

/** 歌词（lyric_new 透传） */
export interface MusicLyricResponse {
  code?: number
  lrc?: { lyric?: string }
  tlyric?: { lyric?: string }
}
