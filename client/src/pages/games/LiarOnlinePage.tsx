import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import UserAvatar from '../../components/UserAvatar'
import GameFriendPicker from '../../components/games/GameFriendPicker'
import LiarCardView from '../../components/games/liar/LiarCardView'
import { useOnlineGameRoom } from '../../hooks/useOnlineGameRoom'
import { GAME_LIAR_ONLINE_ROUTE, GAME_LIAR_ROUTE } from '../../lib/games/catalog'
import { liarCardKind, liarCardIsTruthy } from '../../lib/games/liar'
import type {
  GameLiarEndReason,
  GameLiarLogEntry,
  GameLiarMatch,
  GameLiarPlayer,
  LiarActionBody,
} from '../../types/game'

const API_BASE = '/games/liar'
const MIN_PLAYERS = 2
const MAX_PLAYERS = 4

const END_REASON_LABELS: Record<GameLiarEndReason, string> = {
  last_standing: '最后一名幸存者获胜',
  timeout: '全局 30 分钟超时，本场废弃',
  cancelled: '房间已解散',
}

function nameOf(match: GameLiarMatch, userId: number): string {
  return match.players.find((player) => player.userId === userId)?.username ?? '某位玩家'
}

function logText(match: GameLiarMatch, entry: GameLiarLogEntry): string {
  const name = (id: number) => nameOf(match, id)
  switch (entry.type) {
    case 'round':
      return `第 ${entry.round} 局开始，目标 ${entry.target}，${name(entry.starterUserId)} 先手`
    case 'play':
      return `${name(entry.userId)} 盖着出 ${entry.count} 张`
    case 'challenge':
      return `${name(entry.userId)} 质疑 ${name(entry.targetUserId)}`
    case 'reveal':
      return `开牌：${entry.cards.map((card) => (liarCardKind(card) === 'JOKER' ? '鬼' : liarCardKind(card))).join(' ')} —— ${entry.truthful ? '全真' : '有假'}`
    case 'trigger':
      return `${name(entry.userId)} 扣动扳机（${entry.bullets}/6）${entry.died ? '，中弹出局' : '，空枪'}`
    case 'death':
      return `${name(entry.userId)} ${entry.cause === 'resign' ? '认输' : entry.cause === 'forfeit' ? '掉线判负' : '中弹'}出局`
    case 'flush':
      return `第 ${entry.round} 局流局，重洗重发`
    default:
      return ''
  }
}

export default function LiarOnlinePage() {
  const room = useOnlineGameRoom<GameLiarMatch>({
    game: 'liar',
    apiBase: API_BASE,
    lobbyPath: GAME_LIAR_ONLINE_ROUTE,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
  })
  const {
    user,
    authLoading,
    meId,
    matchId,
    match,
    matchLoading,
    matchError,
    friends,
    friendsLoading,
    friendsError,
    pageIncomingInvites,
    pageOutgoingInvites,
    actionError,
    setActionError,
    busyKey,
    actionPending,
    turnRemainingMs,
    isHost,
    playerCount,
    loadMatch,
    refreshLobby,
    startMatch,
    leaveRoom,
    resign,
    invite,
    cancelInvite,
    respondInvite,
    submitAction,
    backToLobby,
    highlightFriendId,
    invitesError,
    transport,
  } = room

  const renderError = (message: string, onRetry: () => void) => (
    <div className="gh-game-list-state gh-game-list-state--error" role="alert">
      <p className="gh-game-list-state-title">加载失败</p>
      <p className="gh-game-list-state-hint">{message}</p>
      <div className="gh-game-list-state-actions">
        <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={onRetry}>
          重试
        </button>
        <Link className="gh-btn gh-btn--ghost gh-btn--md" to="/games">
          返回游戏大厅
        </Link>
      </div>
    </div>
  )

  const errorBanner = (message: string | null) =>
    message ? <div className="gh-alert gh-alert--danger gh-game-alert" role="alert">{message}</div> : null

  if (!authLoading && !user) {
    return (
      <div className="gh-page-container gh-games-page gh-game-online-page">
        <section className="gh-gmk-guest" aria-label="需要登录">
          <p className="gh-g2048-eyebrow">骗子酒馆 · 好友联机</p>
          <h1 className="gh-games-title">登录后即可和好友开桌</h1>
          <p className="gh-games-subtitle">
            联机需要账号：好友关系、邀请与对局都以账号身份进行。不想登录也可以先玩单机 AI。
          </p>
          <div className="gh-gmk-guest-actions">
            <Link className="gh-btn gh-btn--primary gh-btn--md" to="/login">去登录</Link>
            <Link className="gh-btn gh-btn--secondary gh-btn--md" to={GAME_LIAR_ROUTE}>单机 AI</Link>
          </div>
        </section>
      </div>
    )
  }

  if (authLoading) {
    return (
      <div className="gh-page-container gh-games-page gh-game-online-page">
        <div className="gh-game-list-state" role="status">
          <div className="gh-spinner" />
          <span>正在确认登录状态…</span>
        </div>
      </div>
    )
  }

  if (matchId) {
    if (!match && matchLoading) {
      return (
        <div className="gh-page-container gh-games-page gh-game-online-page">
          <div className="gh-game-list-state" role="status">
            <div className="gh-spinner" />
            <span>正在加载牌桌…</span>
          </div>
        </div>
      )
    }
    if (!match) {
      return (
        <div className="gh-page-container gh-games-page gh-game-online-page">
          {renderError(matchError ?? '对局不存在或已结束，返回大厅重新邀请好友吧。', () => {
            void loadMatch(matchId, true)
          })}
          <p className="gh-game-inline-link"><Link to={GAME_LIAR_ONLINE_ROUTE}>返回联机大厅</Link></p>
        </div>
      )
    }

    if (match.status === 'waiting') {
      return (
        <div className="gh-page-container gh-games-page gh-game-online-page">
          <section className="gh-game-room" aria-label="骗子酒馆等待房间">
            <header className="gh-game-room-header">
              <div>
                <p className="gh-g2048-eyebrow">骗子酒馆牌桌</p>
                <h1 className="gh-games-title">等待好友入座</h1>
                <p className="gh-games-subtitle">
                  2–4 人成桌：盖牌出牌、互相质疑，输家扣左轮扳机。房主开始后立即发牌。
                </p>
              </div>
              <span className="gh-game-room-count">{playerCount}/{MAX_PLAYERS}</span>
            </header>

            {errorBanner(actionError ?? matchError)}

            <div className="gh-game-room-actions">
              {isHost ? (
                <button
                  type="button"
                  className="gh-btn gh-btn--primary gh-btn--lg"
                  onClick={() => void startMatch()}
                  disabled={playerCount < MIN_PLAYERS || busyKey === 'start'}
                >
                  {busyKey === 'start' ? '正在开始…' : '开始牌局'}
                </button>
              ) : (
                <span className="gh-game-room-waiting">等待房主开始牌局…</span>
              )}
              <button
                type="button"
                className="gh-btn gh-btn--danger gh-btn--md"
                onClick={() => void leaveRoom()}
                disabled={busyKey === 'leave'}
              >
                {isHost ? '解散房间' : '离开房间'}
              </button>
            </div>

            <section className="gh-game-room-players" aria-label="房间座位">
              <h2 className="gh-game-room-section-title">座位（{playerCount}/{MAX_PLAYERS}）</h2>
              <ul className="gh-gmk-seat-list">
                {Array.from({ length: MAX_PLAYERS }, (_, seat) => {
                  const player = match.players[seat]
                  if (!player) {
                    return (
                      <li key={`empty-${seat}`} className="gh-gmk-seat gh-gmk-seat--empty">
                        <span className="gh-gmk-seat-name">等待加入 · {seat + 1} 号位</span>
                      </li>
                    )
                  }
                  return (
                    <li key={player.userId} className={`gh-gmk-seat${player.userId === meId ? ' gh-gmk-seat--me' : ''}`}>
                      <UserAvatar userId={player.userId} username={player.username} size="md" />
                      <span className="gh-gmk-seat-copy">
                        <span className="gh-gmk-seat-name">
                          {player.username}
                          {player.userId === match.hostId && <span className="gh-game-room-badge">房主</span>}
                          {player.userId === meId && <span className="gh-game-room-badge gh-game-room-badge--me">你</span>}
                        </span>
                        <span className="gh-gmk-seat-meta">
                          <span className={`gh-game-presence-dot${player.online ? ' gh-game-presence-dot--online' : ''}`} />
                          {player.online ? '在线' : '离线'} · {seat + 1} 号位
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section className="gh-game-room-invite" aria-label="邀请好友">
              <h2 className="gh-game-room-section-title">邀请好友</h2>
              {playerCount >= MAX_PLAYERS ? (
                <p className="gh-game-room-hint">牌桌已满（{MAX_PLAYERS} 人），房主可以开始。</p>
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
          </section>
        </div>
      )
    }

    return (
      <div className="gh-page-container gh-games-page gh-liar-online">
        <LiarOnlineStage
          key={match.id}
          match={match}
          meId={meId}
          isHost={isHost}
          transport={transport}
          actionPending={actionPending}
          turnRemainingMs={turnRemainingMs}
          actionError={actionError ?? matchError}
          onSubmit={(body) => void submitAction(body)}
          onResign={() => void resign()}
          onBackToLobby={backToLobby}
          onBlocked={(message) => setActionError(message)}
          resignBusy={busyKey === 'resign'}
        />
      </div>
    )
  }

  return (
    <div className="gh-page-container gh-games-page gh-game-online-page">
      <header className="gh-games-header">
        <div className="gh-games-header-copy">
          <p className="gh-g2048-eyebrow"><Link to="/games">← 游戏大厅</Link></p>
          <h1 className="gh-games-title">骗子酒馆 · 好友联机</h1>
          <p className="gh-games-subtitle">
            邀请 1–3 位好友开桌：盖牌出牌、质疑开牌，输家扣左轮扳机；最后存活者获胜。
          </p>
        </div>
        <div className="gh-gmk-header-actions">
          <Link className="gh-btn gh-btn--secondary gh-btn--md" to={GAME_LIAR_ROUTE}>单机 AI</Link>
          <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={refreshLobby} disabled={friendsLoading}>
            刷新列表
          </button>
        </div>
      </header>

      {errorBanner(actionError ?? invitesError)}
      {highlightFriendId !== null && (
        <p className="gh-game-highlight-hint">已从聊天页跳转：向高亮好友发送邀请即可开桌。</p>
      )}
      {friendsError ? (
        renderError(friendsError, refreshLobby)
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

      <div className="gh-gmk-lobby-tips">
        <h2 className="gh-gmk-lobby-tips-title">牌桌规则</h2>
        <ul className="gh-gmk-lobby-tips-list">
          <li>2–4 人成桌，每人 5 张手牌；每局随机宣布目标牌面（K / Q / A），鬼牌万能。</li>
          <li>轮到你了：盖着出 1–3 张，或质疑上一手。质疑只翻开上一手。</li>
          <li>开出的牌全真 → 质疑者输；掺假 → 被打出者输。输家扣左轮（子弹数 = 死亡人数 + 1）。</li>
          <li>中弹出局；扣扳机后无论生死都重洗重发。最后存活者获胜。</li>
          <li>回合 60 秒超时自动托管；掉线 120 秒判负出局。</li>
        </ul>
      </div>
    </div>
  )
}

// ==================== 对局舞台 ====================

interface LiarOnlineStageProps {
  match: GameLiarMatch
  meId: number
  isHost: boolean
  transport: 'ws' | 'polling'
  actionPending: boolean
  turnRemainingMs: number | null
  actionError: string | null
  onSubmit: (body: LiarActionBody) => void
  onResign: () => void
  onBackToLobby: () => void
  onBlocked: (message: string) => void
  resignBusy: boolean
}

function LiarOnlineStage({
  match,
  meId,
  isHost,
  transport,
  actionPending,
  turnRemainingMs,
  actionError,
  onSubmit,
  onResign,
  onBackToLobby,
  onBlocked,
  resignBusy,
}: LiarOnlineStageProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const playing = match.status === 'playing'
  const me = match.players.find((player) => player.userId === meId)
  const myTurn = playing && match.turn?.userId === meId && me?.status === 'playing'
  const top = match.pile[match.pile.length - 1] ?? null
  const canChallenge = myTurn && top !== null && top.userId !== meId
  const myHand = match.myHand
  const selectedCards = useMemo(() => myHand.filter((card) => selected.has(card)), [myHand, selected])
  const canPlay = myTurn && selectedCards.length >= 1 && selectedCards.length <= 3
  const turnSeconds = turnRemainingMs === null ? null : Math.ceil(turnRemainingMs / 1000)
  const winner = match.players.find((player) => player.userId === match.winnerId) ?? null
  const recentLog = match.log.slice(-10)

  useEffect(() => {
    setSelected(new Set())
  }, [match.round, match.turn?.userId])

  const toggleCard = (card: number) => {
    if (!myTurn || actionPending) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(card)) next.delete(card)
      else if (next.size < 3) next.add(card)
      return next
    })
  }

  const handlePlay = () => {
    if (!myTurn) {
      onBlocked('还没轮到你')
      return
    }
    if (selectedCards.length < 1 || selectedCards.length > 3) {
      onBlocked('请选择 1–3 张手牌')
      return
    }
    onSubmit({ type: 'play', cards: selectedCards })
    setSelected(new Set())
  }

  const handleChallenge = () => {
    if (!canChallenge) {
      onBlocked(top === null ? '牌堆上还没有可质疑的出牌' : '不能质疑自己的出牌')
      return
    }
    onSubmit({ type: 'challenge' })
  }

  const gunDots = Array.from({ length: 6 }, (_, index) => index < match.gunBullets)

  return (
    <>
      <header className="gh-liar-online-header">
        <div>
          <p className="gh-g2048-eyebrow"><Link to={GAME_LIAR_ONLINE_ROUTE}>← 骗子酒馆联机大厅</Link></p>
          <h1 className="gh-games-title">
            骗子酒馆 · 好友对局
            <span className={`gh-game-conn-chip gh-game-conn-chip--${transport}`}>
              {transport === 'ws' ? '实时' : '轮询'}
            </span>
          </h1>
          <p className="gh-games-subtitle">
            第 {match.round} 局 · 目标 {match.target ?? '—'} · 左轮 {match.gunBullets}/6
            {transport === 'polling' ? ' · 轮询模式，约 2 秒延迟' : ''}
          </p>
        </div>
        <div className="gh-liar-online-actions">
          {playing && (
            <button
              type="button"
              className="gh-btn gh-btn--danger gh-btn--sm"
              onClick={onResign}
              disabled={resignBusy || me?.status !== 'playing'}
            >
              {resignBusy ? '提交中…' : '认输'}
            </button>
          )}
          <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={onBackToLobby}>
            {match.status === 'finished' ? (isHost ? '回大厅再开一局' : '返回大厅') : '返回大厅'}
          </button>
        </div>
      </header>

      {actionError && <div className="gh-alert gh-alert--danger gh-game-alert" role="alert">{actionError}</div>}

      <div className="gh-liar-online-body">
        <section className="gh-liar-online-main">
          <div className="gh-liar-round-bar">
            <span className="gh-liar-round-chip">第 {match.round} 局</span>
            <span className="gh-liar-target">目标牌面 <strong>{match.target ?? '—'}</strong></span>
            <span className={`gh-liar-gun${match.gunBullets >= 4 ? ' gh-liar-gun--danger' : ''}`}>
              左轮 {match.gunBullets}/6
              <span className="gh-liar-gun-dots" aria-hidden="true">
                {gunDots.map((loaded, index) => (
                  <span key={index} className={`gh-liar-gun-dot${loaded ? ' gh-liar-gun-dot--loaded' : ''}`} />
                ))}
              </span>
            </span>
          </div>

          <div className={`gh-liar-turn${myTurn ? ' gh-liar-turn--me' : ''}`}>
            <span className="gh-liar-turn-label">当前回合</span>
            <strong>
              {match.status === 'finished'
                ? '本场结束'
                : match.turn
                  ? `${nameOf(match, match.turn.userId)}${match.turn.userId === meId ? '（你）' : ''}`
                  : '等待服务端安排回合…'}
            </strong>
            {playing && turnSeconds !== null && (
              <span className={`gh-liar-countdown${turnSeconds <= 10 ? ' gh-liar-countdown--low' : ''}`} role="timer">
                {turnSeconds} 秒
              </span>
            )}
            <span className="gh-liar-turn-hint">
              {myTurn ? '出 1–3 张盖牌，或质疑上一手。' : top ? `上一手：${nameOf(match, top.userId)} 的 ${top.count} 张` : '等待首位玩家出牌'}
            </span>
          </div>

          <div className="gh-liar-pile">
            <span className="gh-liar-pile-label">牌堆</span>
            <div className="gh-liar-pile-cards">
              {match.pile.length === 0 && <span className="gh-liar-pile-empty">本局还没有人出牌</span>}
              {match.pile.map((entry, index) => (
                <span key={`${entry.userId}-${index}`} className="gh-liar-pile-entry">
                  <span className="gh-liar-pile-count">×{entry.count}</span>
                  <span className="gh-liar-pile-name">{nameOf(match, entry.userId)}</span>
                </span>
              ))}
            </div>
          </div>

          {match.lastReveal && (
            <div className={`gh-liar-reveal${match.lastReveal.truthful ? ' gh-liar-reveal--true' : ' gh-liar-reveal--lie'}`}>
              <span className="gh-liar-reveal-title">
                最近开牌 · {nameOf(match, match.lastReveal.userId)} 的第 {match.lastReveal.round} 局出牌
              </span>
              <div className="gh-liar-reveal-cards">
                {match.lastReveal.cards.map((card) => <LiarCardView key={card} card={card} size="sm" />)}
              </div>
              <span className="gh-liar-reveal-verdict">
                {match.lastReveal.truthful ? '全是真牌 —— 质疑者扣扳机' : '掺了假牌 —— 被打出者扣扳机'}
              </span>
            </div>
          )}

          <div className="gh-liar-online-actions-row">
            <button type="button" className="gh-btn gh-btn--primary gh-btn--md" onClick={handlePlay} disabled={!canPlay || actionPending}>
              盖牌出牌（{selectedCards.length} 张）
            </button>
            <button type="button" className="gh-btn gh-btn--danger gh-btn--md" onClick={handleChallenge} disabled={!canChallenge || actionPending}>
              质疑上一手
            </button>
            {actionPending && <span className="gh-liar-action-pending">提交中…</span>}
          </div>

          <div className="gh-liar-me">
            <div className="gh-liar-me-header">
              <span className="gh-liar-me-name">你的手牌</span>
              <span className="gh-liar-me-meta">{me?.handCount ?? 0} 张</span>
              {myTurn && <span className="gh-liar-me-hint">点击选择 1–3 张</span>}
            </div>
            <div className="gh-liar-hand">
              {myHand.map((card) => (
                <LiarCardView
                  key={card}
                  card={card}
                  selected={selected.has(card)}
                  disabled={!myTurn || actionPending}
                  onClick={myTurn ? () => toggleCard(card) : undefined}
                  title={`${liarCardKind(card) === 'JOKER' ? '鬼牌（万能）' : liarCardKind(card)}${
                    match.target && liarCardIsTruthy(card, match.target) ? ' · 真牌' : ' · 假牌'
                  }`}
                />
              ))}
            </div>
          </div>

          {match.status === 'finished' && (
            <div className="gh-liar-overlay" role="dialog" aria-modal="true" aria-label="对局结算">
              <div className="gh-liar-overlay-card">
                <p className="gh-liar-overlay-eyebrow">牌局结束</p>
                <h2 className={`gh-liar-overlay-title${winner?.userId === meId ? ' gh-liar-overlay-title--win' : ''}`}>
                  {winner ? `${winner.username} 获胜` : '本场无胜者'}
                </h2>
                <p className="gh-liar-overlay-detail">
                  {match.reason ? END_REASON_LABELS[match.reason] : '本场已结束'} · 共 {match.round} 局
                </p>
                <div className="gh-liar-overlay-actions">
                  <button type="button" className="gh-btn gh-btn--primary gh-btn--lg" onClick={onBackToLobby}>
                    {isHost ? '回大厅再开一局' : '返回大厅'}
                  </button>
                  <Link className="gh-btn gh-btn--secondary gh-btn--lg" to={GAME_LIAR_ROUTE}>单机 AI</Link>
                </div>
              </div>
            </div>
          )}
        </section>

        <aside className="gh-liar-online-side">
          <section className="gh-liar-online-players" aria-label="玩家状态">
            <h2 className="gh-liar-log-title">玩家</h2>
            <ul className="gh-liar-player-list">
              {match.players.map((player: GameLiarPlayer) => (
                <li
                  key={player.userId}
                  className={[
                    'gh-liar-player',
                    player.userId === meId ? 'gh-liar-player--me' : '',
                    player.status === 'playing' ? '' : 'gh-liar-player--out',
                    match.turn?.userId === player.userId ? 'gh-liar-player--turn' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <UserAvatar userId={player.userId} username={player.username} size="sm" />
                  <span className="gh-liar-player-copy">
                    <span className="gh-liar-player-name">
                      {player.username}
                      {player.userId === meId && <span className="gh-game-room-badge gh-game-room-badge--me">你</span>}
                      {player.userId === match.hostId && <span className="gh-game-room-badge">房主</span>}
                    </span>
                    <span className="gh-liar-player-meta">
                      <span className={`gh-game-presence-dot${player.online ? ' gh-game-presence-dot--online' : ''}`} />
                      {player.status === 'playing' ? `手牌 ${player.handCount} 张` : player.status === 'won' ? '获胜' : '出局'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="gh-liar-log" aria-label="对局记录">
            <h2 className="gh-liar-log-title">对局记录</h2>
            <ul className="gh-liar-log-list">
              {recentLog.length === 0 && <li className="gh-liar-log-empty">等待第一条记录…</li>}
              {recentLog.map((entry, index) => (
                <li key={`${entry.type}-${index}`} className={`gh-liar-log-item gh-liar-log-item--${entry.type}`}>
                  {logText(match, entry)}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </>
  )
}
