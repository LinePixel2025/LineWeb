import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import GameFriendPicker from '../../components/games/GameFriendPicker'
import UserAvatar from '../../components/UserAvatar'
import { useOnlineGameRoom } from '../../hooks/useOnlineGameRoom'
import api from '../../lib/api'
import { createParkourRun, type ParkourRunState } from '../../lib/games/parkour'
import type {
  ParkourEndResult,
  ParkourGameViewProps,
} from '../../components/games/parkour/ParkourGameView'
import { useParkourProgress } from '../../components/games/parkour/useParkourProgress'
import type { GameParkourMatch, GameParkourPlayer } from '../../types/game'

type GameViewComponent = ComponentType<ParkourGameViewProps>

const MIN_PLAYERS = 2
const MAX_PLAYERS = 6
const TRACK_LENGTH_M = 800
const SEAT_COLORS = ['#22d3ee', '#fb7185', '#a3e635', '#a78bfa', '#fbbf24', '#f472b6']

function seatColor(index: number): string {
  return SEAT_COLORS[((index % SEAT_COLORS.length) + SEAT_COLORS.length) % SEAT_COLORS.length]
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString('zh-CN')
}

function formatFinishTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—'
  return `${(ms / 1000).toFixed(1)}s`
}

function errorBanner(message: string | null | undefined) {
  return message ? (
    <div className="gh-alert gh-alert--danger gh-game-alert" role="alert">{message}</div>
  ) : null
}

function sortPlayers(players: GameParkourPlayer[]): GameParkourPlayer[] {
  return [...players].sort((a, b) => {
    if (a.status === 'finished' && b.status === 'finished') {
      return (a.rank ?? 99) - (b.rank ?? 99)
    }
    if (a.status === 'finished') return -1
    if (b.status === 'finished') return 1
    if (a.status === 'lost' && b.status !== 'lost') return 1
    if (b.status === 'lost' && a.status !== 'lost') return -1
    return b.distanceM - a.distanceM || b.coins - a.coins
  })
}

function statusLabel(player: GameParkourPlayer): string {
  if (player.status === 'finished') return `完赛 ${formatFinishTime(player.finishMs)}`
  if (player.status === 'lost') return '出局'
  return `${Math.floor(player.distanceM)}m`
}

function StandingsRail({ match, meId }: { match: GameParkourMatch; meId: number }) {
  const players = sortPlayers(match.players)
  return (
    <div className="gh-pk-standings" aria-label="实时排名">
      {players.map((player) => {
        const percent = Math.max(0, Math.min(100, (player.distanceM / TRACK_LENGTH_M) * 100))
        return (
          <div
            key={player.userId}
            className={`gh-pk-standing${player.userId === meId ? ' gh-pk-standing--me' : ''}${player.status === 'lost' ? ' gh-pk-standing--lost' : ''}`}
            style={{ '--pk-seat': seatColor(player.colorIndex) } as CSSProperties}
          >
            <div className="gh-pk-standing-top">
              <UserAvatar userId={player.userId} username={player.username} size="sm" />
              <span className="gh-pk-standing-name">{player.username}</span>
              {player.userId === meId && <span className="gh-pk-standing-me">你</span>}
              <span className="gh-pk-standing-status">{statusLabel(player)}</span>
            </div>
            <div className="gh-pk-standing-track" aria-hidden>
              <span style={{ width: `${percent}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ResultsCard({
  match,
  meId,
  me,
  onBack,
}: {
  match: GameParkourMatch
  meId: number
  me: GameParkourPlayer | null
  onBack: () => void
}) {
  const players = sortPlayers(match.players)
  const winner = match.players.find((player) => player.userId === match.winnerId)
  const reasonLabel =
    match.reason === 'elimination'
      ? '全员出局'
      : match.reason === 'timeout'
        ? '时间到'
        : match.reason === 'cancelled'
          ? '比赛取消'
          : '比赛结束'
  const myLabel = me
    ? me.status === 'finished'
      ? me.rank === 1
        ? '冠军！'
        : `第 ${me.rank ?? '—'} 名`
      : '本局出局'
    : '比赛结束'
  return (
    <div className="gh-pk-overlay" role="dialog" aria-modal="true" aria-label="比赛结算">
      <div className="gh-pk-overlay-card gh-pk-overlay-card--result">
        <p className="gh-pk-overlay-eyebrow">RACE COMPLETE</p>
        <h2>{myLabel}</h2>
        <p className="gh-pk-overlay-sub">
          {reasonLabel}
          {winner ? ` · ${winner.username} 夺冠` : ''}
          {match.reason === 'timeout' ? ' · 按最远距离排名' : ''}
        </p>
        <div className="gh-pk-result-table" role="table" aria-label="最终排名">
          <div className="gh-pk-result-head" role="row">
            <span role="columnheader">名次</span>
            <span role="columnheader">跑者</span>
            <span role="columnheader">距离</span>
            <span role="columnheader">金币</span>
            <span role="columnheader">用时</span>
          </div>
          {players.map((player) => (
            <div
              key={player.userId}
              className={`gh-pk-result-row${player.userId === meId ? ' gh-pk-result-row--me' : ''}`}
              role="row"
              style={{ '--pk-seat': seatColor(player.colorIndex) } as CSSProperties}
            >
              <span role="cell" className="gh-pk-result-rank">
                {player.rank ?? '—'}
                {player.userId === match.winnerId ? ' ★' : ''}
              </span>
              <span role="cell" className="gh-pk-result-name">
                <span className="gh-pk-standing-dot" aria-hidden />
                {player.username}
              </span>
              <span role="cell">{player.status === 'finished' ? '800m' : `${Math.floor(player.distanceM)}m`}</span>
              <span role="cell">{player.coins}</span>
              <span role="cell">
                {player.status === 'finished' ? formatFinishTime(player.finishMs) : player.status === 'lost' ? '未完成' : '—'}
              </span>
            </div>
          ))}
        </div>
        <div className="gh-pk-overlay-actions">
          <button type="button" className="gh-btn gh-btn--primary gh-btn--lg" onClick={onBack}>
            返回大厅
          </button>
          <Link className="gh-btn gh-btn--secondary gh-btn--md" to="/games/parkour">
            单机练习
          </Link>
        </div>
      </div>
    </div>
  )
}

/**
 * 霓虹跑酷联机页：2–6 人同 seed 的 800m 幽灵竞速。
 * 大厅 / 等待房间走普通页面，比赛（含结算）为全屏 3D 舞台。
 */
export default function ParkourOnlinePage() {
  const room = useOnlineGameRoom<GameParkourMatch>({
    game: 'parkour',
    apiBase: '/games/parkour',
    lobbyPath: '/games/parkour/online',
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
  })
  const {
    authLoading,
    meId,
    transport,
    invitesError,
    match,
    matchId,
    matchLoading,
    matchError,
    friends,
    friendsLoading,
    friendsError,
    pageIncomingInvites,
    pageOutgoingInvites,
    actionError,
    busyKey,
    highlightFriendId,
    refreshLobby,
    startMatch,
    leaveRoom,
    invite,
    cancelInvite,
    respondInvite,
  } = room

  const navigate = useNavigate()
  const [GameView, setGameView] = useState<GameViewComponent | null>(null)
  const gameViewRef = useRef<GameViewComponent | null>(null)
  const [viewError, setViewError] = useState<string | null>(null)
  const [run, setRun] = useState<ParkourRunState | null>(null)
  const runRef = useRef<ParkourRunState | null>(null)
  const runMatchRef = useRef<number | null>(null)
  const [raceStarted, setRaceStarted] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const countdownKeyRef = useRef<string | null>(null)
  const [localResult, setLocalResult] = useState<ParkourEndResult | null>(null)
  const [quitError, setQuitError] = useState<string | null>(null)

  const me = match?.players.find((player) => player.userId === meId) ?? null
  const playing = match?.status === 'playing'
  const finishedMatch = match?.status === 'finished'

  const loadGameView = useCallback(async (): Promise<void> => {
    if (gameViewRef.current) return
    try {
      const mod = await import('../../components/games/parkour/ParkourGameView')
      gameViewRef.current = mod.default
      setGameView(() => mod.default)
      setViewError(null)
    } catch (err) {
      setViewError(err instanceof Error ? err.message : '3D 场景加载失败')
    }
  }, [])

  useEffect(() => {
    if (!match || (match.status !== 'waiting' && match.status !== 'playing')) return
    void loadGameView()
  }, [match?.status, loadGameView])

  // 3 秒倒计时：只消费服务端算好的 countdownMs，不依赖 countdownMs 的实时变化重置
  useEffect(() => {
    if (!match || match.status !== 'playing') {
      countdownKeyRef.current = null
      setRaceStarted(false)
      setCountdown(0)
      return undefined
    }
    const key = `${match.id}:${match.startsAt ?? ''}`
    if (countdownKeyRef.current === key) return undefined
    countdownKeyRef.current = key
    const initial = Math.max(0, Math.floor(match.countdownMs))
    if (initial <= 0) {
      setRaceStarted(true)
      setCountdown(0)
      return undefined
    }
    setRaceStarted(false)
    setCountdown(Math.ceil(initial / 1000))
    const endsAt = performance.now() + initial
    const timer = setInterval(() => {
      const left = endsAt - performance.now()
      if (left <= 0) {
        clearInterval(timer)
        setCountdown(0)
        setRaceStarted(true)
        return
      }
      setCountdown(Math.ceil(left / 1000))
    }, 100)
    return () => clearInterval(timer)
    // countdownMs 只在首次进入 playing 时读取，后续 DTO 更新不应重置计时器
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.status, match?.id, match?.startsAt])

  // 本地 run：同一条 seed；刷新恢复从服务端已接受的距离/车道继续
  useEffect(() => {
    if (!match || match.status !== 'playing' || !raceStarted || !me || me.status !== 'playing') return
    if (runRef.current && runMatchRef.current === match.id) return
    const next = createParkourRun({
      seed: match.seed,
      mode: 'race',
      startDistanceM: me.distanceM,
      lane: me.lane,
      coins: me.coins,
      maxCombo: me.maxCombo,
      invincibleMs: me.distanceM > 1 ? 1500 : 0,
    })
    runRef.current = next
    runMatchRef.current = match.id
    setRun(next)
    setLocalResult(null)
    // 不跟随 me.distanceM 等 2Hz 字段重建；只在比赛/倒计时/身份变化时初始化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.id, match?.seed, match?.status, me?.status, raceStarted])

  const getRun = useCallback(() => runRef.current, [])
  useParkourProgress({
    matchId: match?.id ?? null,
    enabled: Boolean(match?.status === 'playing' && me?.status === 'playing' && run),
    getRun,
  })

  const handleEnd = useCallback((end: ParkourEndResult): void => {
    setLocalResult(end)
  }, [])

  const quitRace = useCallback(async (): Promise<void> => {
    if (!match) {
      navigate('/games/parkour/online', { replace: true })
      return
    }
    // 本地已经冲线/出局时，final progress/finish 已经发出，直接离开即可，
    // 不再调用 resign（服务端可能已把本人标 lost，重复 resign 会 409）。
    const isRacing = match.status === 'playing' && me?.status === 'playing' && !localResult
    if (isRacing && !window.confirm('退出比赛会被记为未完成，确定吗？')) return
    setQuitError(null)
    if (isRacing) {
      try {
        await api.post(`/games/parkour/matches/${match.id}/resign`)
      } catch (err) {
        const message = err instanceof Error ? err.message : '退出失败'
        if (
          message.includes('已结束')
          || message.includes('不存在')
          || message.includes('你已出局')
        ) {
          navigate('/games/parkour/online', { replace: true })
        } else {
          setQuitError(message)
        }
        return
      }
    }
    navigate('/games/parkour/online', { replace: true })
  }, [match, me?.status, localResult, navigate])

  const ghosts = useMemo(
    () =>
      (match?.players ?? [])
        .filter((player) => player.userId !== meId && player.status === 'playing')
        .map((player) => ({
          userId: player.userId,
          name: player.username,
          colorIndex: player.colorIndex,
          distanceM: player.distanceM,
          lane: player.lane,
          pose: player.pose,
        })),
    [match?.players, meId],
  )

  const showEndCard =
    Boolean(playing && me && (me.status === 'finished' || me.status === 'lost'))
    || Boolean(playing && localResult)
  const localFinished = localResult !== null && localResult.cause === null

  // === 认证 / 加载 ===

  if (authLoading) {
    return (
      <div className="gh-page-container gh-games-page gh-pk-page">
        <div className="gh-game-list-state" role="status">
          <div className="gh-spinner" />
          <span>正在确认登录状态…</span>
        </div>
      </div>
    )
  }

  // === 有 matchId 但详情尚未加载 ===

  if (matchId && !match) {
    return (
      <div className="gh-page-container gh-games-page gh-pk-page">
        <header className="gh-games-header">
          <div className="gh-games-header-copy">
            <p className="gh-g2048-eyebrow"><Link to="/games/parkour/online">← 跑酷大厅</Link></p>
            <h1 className="gh-games-title">正在进入比赛</h1>
          </div>
        </header>
        {matchError ? errorBanner(matchError) : (
          <div className="gh-game-list-state" role="status">
            <div className="gh-spinner" />
            <span>{matchLoading ? '正在同步比赛…' : '正在准备舞台…'}</span>
          </div>
        )}
      </div>
    )
  }

  // === 跑酷大厅 ===

  if (!matchId) {
    return (
      <div className="gh-page-container gh-games-page gh-pk-page gh-pk-online-page">
        <header className="gh-games-header">
          <div className="gh-games-header-copy">
            <p className="gh-g2048-eyebrow"><Link to="/games">← 游戏大厅</Link></p>
            <h1 className="gh-games-title">霓虹跑酷 · 好友竞速</h1>
            <p className="gh-games-subtitle">
              邀请 1–5 位好友，在同一个 seed 的 800m 三车道霓虹赛道上幽灵竞速：
              换道、跳跃、滑铲，先冲线者胜。所有跑者共享同一套障碍，互不碰撞。
            </p>
          </div>
          <div className="gh-gmk-header-actions">
            <Link className="gh-btn gh-btn--secondary gh-btn--md" to="/games/parkour">
              单机练习
            </Link>
            <button
              type="button"
              className="gh-btn gh-btn--secondary gh-btn--md"
              onClick={refreshLobby}
              disabled={friendsLoading}
            >
              刷新列表
            </button>
          </div>
        </header>

        {errorBanner(actionError ?? invitesError)}
        {highlightFriendId !== null && (
          <p className="gh-game-highlight-hint">已从聊天页跳转：向高亮好友发送邀请即可开赛。</p>
        )}
        {matchLoading && (
          <p className="gh-pk-lobby-loading" role="status">正在检查进行中的跑酷房间…</p>
        )}
        {friendsError ? (
          <div className="gh-game-list-state gh-game-list-state--error" role="alert">
            <p className="gh-game-list-state-title">好友列表加载失败</p>
            <p className="gh-game-list-state-hint">{friendsError}</p>
            <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={refreshLobby}>
              重试
            </button>
          </div>
        ) : (
          <GameFriendPicker
            friends={friends}
            incomingInvites={pageIncomingInvites}
            outgoingInvites={pageOutgoingInvites}
            loading={friendsLoading || matchLoading}
            highlightFriendId={highlightFriendId}
            busyKey={busyKey}
            onInvite={invite}
            onCancelInvite={cancelInvite}
            onRespondInvite={respondInvite}
            onRefresh={refreshLobby}
          />
        )}

        <div className="gh-pk-lobby-tips">
          <h2>竞速规则</h2>
          <ul className="gh-pk-list">
            <li>2–6 人，房主开始后 3 秒倒计时；所有跑者同一条 800m 赛道、同一 seed。</li>
            <li>一次撞击或掉坑即出局；护盾抵挡一次撞击，冲刺 4 秒无敌加速。</li>
            <li>先冲线者胜；全员结束或 150 秒后按 距离 → 金币 → 连击 排名。</li>
            <li>中途退出记为未完成；掉线超过 30 秒判 DNF。</li>
          </ul>
        </div>
      </div>
    )
  }

  // === 等待房间 ===

  if (match && match.status === 'waiting') {
    const host = match.players.find((player) => player.userId === match.hostId)
    return (
      <div className="gh-page-container gh-games-page gh-pk-page gh-pk-online-page">
        <section className="gh-game-room gh-pk-room" aria-label="霓虹跑酷等待房间">
          <header className="gh-game-room-header">
            <div>
              <p className="gh-g2048-eyebrow"><Link to="/games/parkour/online">← 跑酷大厅</Link></p>
              <h1 className="gh-games-title">霓虹跑酷 · 好友竞速</h1>
              <p className="gh-games-subtitle">
                2–6 人同一条 seed 的 800m 三车道赛道，幽灵竞速、互不碰撞；先冲线者胜。
                一次撞击或掉坑就结束，护盾能救你一次。
              </p>
            </div>
            <span className="gh-game-room-count">{match.players.length}/{MAX_PLAYERS}</span>
          </header>

          {errorBanner(actionError ?? matchError ?? invitesError)}
          <div className="gh-pk-room-meta">
            <span className={`gh-pk-conn ${transport === 'ws' ? 'gh-pk-conn--ws' : ''}`}>
              {transport === 'ws' ? '实时连接' : '轮询降级'}
            </span>
            <span>房主：{host?.username ?? '—'}</span>
            <span>等待房间 30 分钟有效</span>
          </div>

          <div className="gh-game-room-actions">
            {meId === match.hostId ? (
              <button
                type="button"
                className="gh-btn gh-btn--primary gh-btn--lg"
                onClick={() => void startMatch()}
                disabled={match.players.length < MIN_PLAYERS || busyKey === 'start'}
              >
                {busyKey === 'start' ? '正在开始…' : `开始比赛（${match.players.length}/${MAX_PLAYERS}）`}
              </button>
            ) : (
              <span className="gh-game-room-waiting">等待房主开始比赛…</span>
            )}
            <button
              type="button"
              className="gh-btn gh-btn--danger gh-btn--md"
              onClick={() => void leaveRoom()}
              disabled={busyKey === 'leave'}
            >
              {busyKey === 'leave' ? '正在离开…' : meId === match.hostId ? '解散房间' : '离开房间'}
            </button>
          </div>
          {meId === match.hostId && match.players.length < MIN_PLAYERS && (
            <p className="gh-game-room-hint">至少 {MIN_PLAYERS} 人才能开始，先邀请一位好友。</p>
          )}

          <section className="gh-game-room-players" aria-label="房间座位">
            <h2 className="gh-game-room-section-title">跑者（{match.players.length}/{MAX_PLAYERS}）</h2>
            <ul className="gh-pk-seat-list">
              {Array.from({ length: MAX_PLAYERS }, (_, seat) => {
                const player = match.players[seat]
                if (!player) {
                  return (
                    <li key={`empty-${seat}`} className="gh-pk-seat gh-pk-seat--empty">
                      <span className="gh-pk-seat-swatch" style={{ background: seatColor(seat) }} aria-hidden />
                      <span className="gh-pk-seat-name">空位 · {seat + 1} 号赛道</span>
                    </li>
                  )
                }
                const isMe = player.userId === meId
                const isRoomHost = player.userId === match.hostId
                return (
                  <li
                    key={player.userId}
                    className={`gh-pk-seat${isMe ? ' gh-pk-seat--me' : ''}`}
                    style={{ '--pk-seat': seatColor(player.colorIndex) } as CSSProperties}
                  >
                    <span className="gh-pk-seat-swatch" aria-hidden />
                    <UserAvatar userId={player.userId} username={player.username} size="md" />
                    <span className="gh-pk-seat-copy">
                      <span className="gh-pk-seat-name">
                        {player.username}
                        {isRoomHost && <span className="gh-game-room-badge">房主</span>}
                        {isMe && <span className="gh-game-room-badge gh-game-room-badge--me">你</span>}
                      </span>
                      <span className="gh-pk-seat-meta">
                        <span className={`gh-game-presence-dot${player.online ? ' gh-game-presence-dot--online' : ''}`} />
                        {player.online ? '在线' : '离线'} · 车道 {player.colorIndex + 1}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="gh-game-room-invite" aria-label="邀请好友">
            <h2 className="gh-game-room-section-title">邀请好友</h2>
            {match.players.length >= MAX_PLAYERS ? (
              <p className="gh-game-room-hint">房间已满（{MAX_PLAYERS} 人），不能再邀请。</p>
            ) : (
              <GameFriendPicker
                friends={friends}
                incomingInvites={pageIncomingInvites}
                outgoingInvites={pageOutgoingInvites}
                loading={friendsLoading}
                error={friendsError}
                highlightFriendId={highlightFriendId}
                excludeIds={match.players.map((player) => player.userId)}
                busyKey={busyKey}
                onInvite={invite}
                onCancelInvite={cancelInvite}
                onRespondInvite={respondInvite}
                onRefresh={refreshLobby}
              />
            )}
          </section>

          <div className="gh-pk-room-rules">
            <h2 className="gh-game-room-section-title">赛道规则</h2>
            <ul className="gh-pk-list">
              <li>同一条 800m 赛道、同 seed、同障碍；所有跑者看到完全一致的世界。</li>
              <li>换道 / 跳跃 / 滑铲；列车只能换道，低路障跳，悬空牌滑，坑洞跳。</li>
              <li>一次撞击或掉坑即出局；护盾抵挡一次撞击；冲刺 4 秒无敌加速。</li>
              <li>先冲线者胜；全员结束或 150 秒后按 距离 → 金币 → 连击 排名。</li>
              <li>掉线超过 30 秒判 DNF；中途退出记为未完成。</li>
            </ul>
          </div>
        </section>
      </div>
    )
  }

  // === 比赛中 / 比赛结束：全屏 3D 舞台 ===

  if (!match) {
    return (
      <div className="gh-page-container gh-games-page gh-pk-page">
        <div className="gh-game-list-state" role="status">
          <div className="gh-spinner" />
          <span>正在准备跑酷大厅…</span>
        </div>
      </div>
    )
  }

  const showView = Boolean(GameView && run && raceStarted)
  const pausedView = !playing || me?.status !== 'playing'
  const remainingSeconds = Math.max(0, Math.ceil(match.remainingMs / 1000))
  const canBackDirect = match.status === 'finished' || me?.status !== 'playing'

  return createPortal(
    <div className="gh-pk-full">
      <div className="gh-pk-topbar">
        <button type="button" className="gh-pk-topbar-btn" onClick={() => void quitRace()}>
          ← {canBackDirect ? '返回大厅' : '退出比赛'}
        </button>
        <div className="gh-pk-topbar-title">
          <span className="gh-pk-live-dot" aria-hidden />
          {finishedMatch ? '比赛结束' : `霓虹竞速 · ${remainingSeconds}s`}
        </div>
        <div className="gh-pk-topbar-right">
          <span className={`gh-pk-conn ${transport === 'ws' ? 'gh-pk-conn--ws' : ''}`}>
            {transport === 'ws' ? '实时' : '轮询'}
          </span>
        </div>
      </div>

      {(actionError || matchError || invitesError || quitError) && (
        <div className="gh-pk-race-errors">
          {errorBanner(actionError ?? matchError ?? invitesError ?? quitError)}
        </div>
      )}

      <StandingsRail match={match} meId={meId} />

      {showView && GameView && run ? (
        <GameView
          key={`${match.id}-${run.seed}`}
          run={run}
          mode="online"
          playerColorIndex={me?.colorIndex ?? 0}
          ghosts={ghosts}
          paused={pausedView}
          onEnd={handleEnd}
        />
      ) : (
        <div className="gh-pk-prelude" aria-label="比赛准备中">
          <div className="gh-pk-prelude-sky" aria-hidden />
          <div className="gh-pk-prelude-grid" aria-hidden />
          {playing && !raceStarted ? (
            <div className="gh-pk-countdown" role="status">
              <span>{countdown > 0 ? countdown : 'GO'}</span>
              <strong>准备冲进霓虹都市</strong>
              <small>左右换道 · 跳跃 · 滑铲</small>
            </div>
          ) : (
            <div className="gh-pk-countdown gh-pk-countdown--loading" role="status">
              {viewError ? (
                <>
                  <strong>3D 场景加载失败</strong>
                  <small>{viewError}</small>
                  <button type="button" className="gh-btn gh-btn--primary" onClick={() => void loadGameView()}>
                    重试
                  </button>
                </>
              ) : (
                <>
                  <strong>{finishedMatch ? '比赛结束' : '正在构建霓虹都市…'}</strong>
                  <small>{finishedMatch ? '正在整理最终排名' : '首次加载 3D 场景需要一点时间'}</small>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {playing && showEndCard && !finishedMatch && (
        <div className="gh-pk-race-status" role="status">
          <strong>
            {localFinished || me?.status === 'finished'
              ? '冲线成功'
              : localResult?.cause === 'pit' || me?.cause === 'pit'
                ? '坠入坑洞'
                : '撞上障碍'}
          </strong>
          <span>
            {me?.status === 'finished'
              ? `第 ${me.rank ?? '—'} 名 · ${formatFinishTime(me.finishMs)}`
              : localFinished
                ? '等待服务器确认…'
                : `本次 ${Math.floor(localResult?.distanceM ?? me?.distanceM ?? 0)}m · 观战中`}
          </span>
          <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={() => void quitRace()}>
            返回大厅
          </button>
        </div>
      )}

      {finishedMatch && (
        <ResultsCard
          match={match}
          meId={meId}
          me={me}
          onBack={() => navigate('/games/parkour/online', { replace: true })}
        />
      )}
    </div>,
    document.body,
  )
}
