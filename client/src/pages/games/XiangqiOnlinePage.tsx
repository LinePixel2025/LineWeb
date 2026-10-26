import { useMemo, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import UserAvatar from '../../components/UserAvatar'
import GameFriendPicker from '../../components/games/GameFriendPicker'
import XiangqiBoardView from '../../components/games/xiangqi/XiangqiBoardView'
import { useOnlineGameRoom } from '../../hooks/useOnlineGameRoom'
import { GAME_XIANGQI_ONLINE_ROUTE, GAME_XIANGQI_ROUTE } from '../../lib/games/catalog'
import {
  XIANGQI_BLACK,
  XIANGQI_RED,
  findXiangqiGeneral,
  xiangqiLegalMovesFrom,
  xiangqiPoint,
  xiangqiSideOf,
  type XiangqiSide,
} from '../../lib/games/xiangqi'
import type { GameXiangqiEndReason, GameXiangqiMatch, XiangqiActionBody } from '../../types/game'

const API_BASE = '/games/xiangqi'
const MIN_PLAYERS = 2
const MAX_PLAYERS = 2

const END_REASON_LABELS: Record<GameXiangqiEndReason, string> = {
  checkmate: '绝杀：对方被将军且无合法着法',
  stalemate: '困毙：无合法着法（象棋规则判负）',
  resign: '有玩家认输',
  forfeit: '掉线超过 120 秒判负',
  timeout: '全局 30 分钟超时，本局无胜者',
  draw: '连续 60 回合无吃子，判和',
  cancelled: '房间已解散',
}

function nameOf(match: GameXiangqiMatch, userId: number): string {
  return match.players.find((player) => player.userId === userId)?.username ?? '某位玩家'
}

function coordText(index: number): string {
  const { x, y } = xiangqiPoint(index)
  return `${'ABCDEFGHI'[x] ?? '?'}${10 - y}`
}

export default function XiangqiOnlinePage() {
  const room = useOnlineGameRoom<GameXiangqiMatch>({
    game: 'xiangqi',
    apiBase: API_BASE,
    lobbyPath: GAME_XIANGQI_ONLINE_ROUTE,
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
        <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={onRetry}>重试</button>
        <Link className="gh-btn gh-btn--ghost gh-btn--md" to="/games">返回游戏大厅</Link>
      </div>
    </div>
  )
  const errorBanner = (message: string | null) =>
    message ? <div className="gh-alert gh-alert--danger gh-game-alert" role="alert">{message}</div> : null

  if (!authLoading && !user) {
    return (
      <div className="gh-page-container gh-games-page gh-game-online-page">
        <section className="gh-gmk-guest" aria-label="需要登录">
          <p className="gh-g2048-eyebrow">中国象棋 · 好友对弈</p>
          <h1 className="gh-games-title">登录后即可邀请好友对弈</h1>
          <p className="gh-games-subtitle">联机需要账号：好友关系、邀请与对局都以账号身份进行。也可以先玩单机 AI。</p>
          <div className="gh-gmk-guest-actions">
            <Link className="gh-btn gh-btn--primary gh-btn--md" to="/login">去登录</Link>
            <Link className="gh-btn gh-btn--secondary gh-btn--md" to={GAME_XIANGQI_ROUTE}>单机人机</Link>
          </div>
        </section>
      </div>
    )
  }

  if (authLoading) {
    return (
      <div className="gh-page-container gh-games-page gh-game-online-page">
        <div className="gh-game-list-state" role="status"><div className="gh-spinner" /><span>正在确认登录状态…</span></div>
      </div>
    )
  }

  if (matchId) {
    if (!match && matchLoading) {
      return (
        <div className="gh-page-container gh-games-page gh-game-online-page">
          <div className="gh-game-list-state" role="status"><div className="gh-spinner" /><span>正在加载棋局…</span></div>
        </div>
      )
    }
    if (!match) {
      return (
        <div className="gh-page-container gh-games-page gh-game-online-page">
          {renderError(matchError ?? '对局不存在或已结束，返回大厅重新邀请好友吧。', () => { void loadMatch(matchId, true) })}
          <p className="gh-game-inline-link"><Link to={GAME_XIANGQI_ONLINE_ROUTE}>返回联机大厅</Link></p>
        </div>
      )
    }

    if (match.status === 'waiting') {
      return (
        <div className="gh-page-container gh-games-page gh-game-online-page">
          <section className="gh-game-room" aria-label="象棋等待房间">
            <header className="gh-game-room-header">
              <div>
                <p className="gh-g2048-eyebrow">中国象棋对局房间</p>
                <h1 className="gh-games-title">等待对手落座</h1>
                <p className="gh-games-subtitle">
                  恰好 2 人对弈：房主执红先行，每回合 60 秒，超时由服务端自动托管走子。
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
                  {busyKey === 'start' ? '正在开始…' : '开始对局（执红先行）'}
                </button>
              ) : (
                <span className="gh-game-room-waiting">等待房主开始对局…</span>
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
                        <span className={`gh-gmk-seat-stone gh-gmk-seat-stone--${seat === 0 ? 'black' : 'white'}`} aria-hidden="true" />
                        <span className="gh-gmk-seat-name">等待加入 · {seat === 0 ? '红方' : '黑方'}</span>
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
                          {player.online ? '在线' : '离线'} · {seat === 0 ? '红方' : '黑方'}
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
                <p className="gh-game-room-hint">对手已就座，房主可以开始对局。</p>
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
      <div className="gh-page-container gh-games-page gh-xq-online">
        <XiangqiOnlineStage
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
          <h1 className="gh-games-title">中国象棋 · 好友对弈</h1>
          <p className="gh-games-subtitle">
            邀请好友进行 2 人象棋对局：9×10 标准棋盘，房主执红先行，绝杀 / 困毙自动判定。
          </p>
        </div>
        <div className="gh-gmk-header-actions">
          <Link className="gh-btn gh-btn--secondary gh-btn--md" to={GAME_XIANGQI_ROUTE}>单机人机</Link>
          <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={refreshLobby} disabled={friendsLoading}>
            刷新列表
          </button>
        </div>
      </header>

      {errorBanner(actionError ?? invitesError)}
      {highlightFriendId !== null && (
        <p className="gh-game-highlight-hint">已从聊天页跳转：向高亮好友发送邀请即可开局。</p>
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
        <h2 className="gh-gmk-lobby-tips-title">对局规则</h2>
        <ul className="gh-gmk-lobby-tips-list">
          <li>恰好 2 人：房主执红先行，另一位执黑。</li>
          <li>走子后不得使己方将帅被将军（含将帅照面）；被将军且无合法着法为绝杀。</li>
          <li>无合法着法但未被将军为困毙（判负）；连续 60 回合无吃子判和。</li>
          <li>回合 60 秒，超时由服务端自动托管走子（不淘汰）；掉线 120 秒判负。</li>
          <li>棋盘全量公开，落子与胜负全部由服务端权威判定。</li>
        </ul>
      </div>
    </div>
  )
}

// ==================== 对局舞台 ====================

interface XiangqiOnlineStageProps {
  match: GameXiangqiMatch
  meId: number
  isHost: boolean
  transport: 'ws' | 'polling'
  actionPending: boolean
  turnRemainingMs: number | null
  actionError: string | null
  onSubmit: (body: XiangqiActionBody) => void
  onResign: () => void
  onBackToLobby: () => void
  onBlocked: (message: string) => void
  resignBusy: boolean
}

function XiangqiOnlineStage({
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
}: XiangqiOnlineStageProps) {
  const [selected, setSelected] = useState<number | null>(null)
  const me = match.players.find((player) => player.userId === meId)
  const mySide: XiangqiSide = me?.side === 'black' ? XIANGQI_BLACK : XIANGQI_RED
  const playing = match.status === 'playing'
  const myTurn = playing && match.turn?.userId === meId && me?.status === 'playing'
  const turnSeconds = turnRemainingMs === null ? null : Math.ceil(turnRemainingMs / 1000)
  const winner = match.players.find((player) => player.userId === match.winnerId) ?? null
  const checkSide: XiangqiSide | null = match.checked
    ? (match.players.find((player) => player.userId === match.turn?.userId)?.side === 'black' ? XIANGQI_BLACK : XIANGQI_RED)
    : null
  const checkGeneral = checkSide === null
    ? null
    : (() => {
        const index = findXiangqiGeneral(match.board, checkSide)
        return index >= 0 ? index : null
      })()

  const legalTargets = useMemo(() => {
    if (!myTurn || selected === null || actionPending) return []
    if (xiangqiSideOf(match.board[selected]) !== mySide) return []
    return xiangqiLegalMovesFrom(match.board, selected)
  }, [myTurn, selected, actionPending, match.board, mySide])

  useEffect(() => {
    setSelected(null)
  }, [match.version, match.turn?.userId])

  const handleSelect = (index: number) => {
    if (!playing) return
    if (!myTurn) {
      onBlocked('还没轮到你走子')
      return
    }
    if (actionPending) return
    if (selected !== null && legalTargets.includes(index)) {
      onSubmit({ type: 'move', from: selected, to: index })
      setSelected(null)
      return
    }
    const piece = match.board[index]
    if (xiangqiSideOf(piece) === mySide) {
      setSelected(index === selected ? null : index)
      return
    }
    if (selected === null) {
      onBlocked('先选择自己的棋子')
    } else if (piece !== 0) {
      onBlocked('不能吃自己的棋子')
    } else {
      onBlocked('这一步不合法（可能送将或不符合走子规则）')
    }
  }

  const lastMoveText = match.lastMove
    ? `${nameOf(match, match.lastMove.userId)} ${coordText(match.lastMove.from)} → ${coordText(match.lastMove.to)}${
        match.lastMove.captured !== 0 ? '（吃子）' : ''
      }${match.lastMove.auto ? ' · 超时托管' : ''}`
    : '开局：红方先行'

  return (
    <>
      <header className="gh-xq-online-header">
        <div>
          <p className="gh-g2048-eyebrow"><Link to={GAME_XIANGQI_ONLINE_ROUTE}>← 象棋联机大厅</Link></p>
          <h1 className="gh-games-title">
            中国象棋 · 好友对局
            <span className={`gh-game-conn-chip gh-game-conn-chip--${transport}`}>
              {transport === 'ws' ? '实时' : '轮询'}
            </span>
          </h1>
          <p className="gh-games-subtitle">
            {myTurn ? '轮到你走子' : match.turn ? `${nameOf(match, match.turn.userId)} 的回合` : '等待回合'}
            {transport === 'polling' ? ' · 轮询模式，约 2 秒延迟' : ''}
          </p>
        </div>
        <div className="gh-xq-online-actions">
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

      <div className="gh-xq-online-body">
        <div className="gh-xq-online-main">
          <div className={`gh-xq-turn-bar${myTurn ? ' gh-xq-turn-bar--me' : ''}`}>
            <span className="gh-xq-turn-label">当前回合</span>
            <strong>
              {match.turn ? `${nameOf(match, match.turn.userId)}${match.turn.userId === meId ? '（你）' : ''}` : '等待中'}
            </strong>
            {playing && turnSeconds !== null && (
              <span className={`gh-xq-countdown${turnSeconds <= 10 ? ' gh-xq-countdown--low' : ''}`} role="timer">
                {turnSeconds} 秒
              </span>
            )}
            <span className="gh-xq-turn-hint">
              {myTurn ? '点击棋子选中，再点绿色提示点落子' : '等待对方走子'}
            </span>
            {match.checked && <span className="gh-xq-check-badge">将军！</span>}
          </div>

          <XiangqiBoardView
            board={match.board}
            perspective={mySide}
            selected={selected}
            legalTargets={legalTargets}
            lastMove={match.lastMove}
            checkGeneral={checkGeneral}
            disabled={!myTurn || actionPending}
            onSelect={handleSelect}
          />

          <p className="gh-xq-last-move">最近一步：{lastMoveText}</p>
          {actionPending && <p className="gh-xq-pending" role="status">正在提交走子…</p>}

          {match.status === 'finished' && (
            <div className="gh-xq-overlay" role="dialog" aria-modal="true" aria-label="对局结算">
              <div className="gh-xq-overlay-card">
                <p className="gh-xq-overlay-eyebrow">对局结束</p>
                <h2 className={`gh-xq-overlay-title${winner?.userId === meId ? ' gh-xq-overlay-title--win' : ''}`}>
                  {winner ? `${winner.username} 获胜` : '本局无胜者'}
                </h2>
                <p className="gh-xq-overlay-detail">
                  {match.reason ? END_REASON_LABELS[match.reason] : '本局已结束'}
                </p>
                <div className="gh-xq-overlay-actions">
                  <button type="button" className="gh-btn gh-btn--primary gh-btn--lg" onClick={onBackToLobby}>
                    {isHost ? '回大厅再开一局' : '返回大厅'}
                  </button>
                  <Link className="gh-btn gh-btn--secondary gh-btn--lg" to={GAME_XIANGQI_ROUTE}>单机练习</Link>
                </div>
              </div>
            </div>
          )}
        </div>

        <aside className="gh-xq-online-side">
          <section className="gh-xq-info-card">
            <h2 className="gh-xq-info-title">对局双方</h2>
            <ul className="gh-xq-player-list">
              {match.players.map((player) => (
                <li
                  key={player.userId}
                  className={[
                    'gh-xq-player',
                    player.userId === meId ? 'gh-xq-player--me' : '',
                    match.turn?.userId === player.userId ? 'gh-xq-player--turn' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <UserAvatar userId={player.userId} username={player.username} size="sm" />
                  <span className="gh-xq-player-copy">
                    <span className="gh-xq-player-name">
                      {player.username}
                      {player.userId === meId && <span className="gh-game-room-badge gh-game-room-badge--me">你</span>}
                      {player.userId === match.hostId && <span className="gh-game-room-badge">房主</span>}
                    </span>
                    <span className="gh-xq-player-meta">
                      <span className={`gh-game-presence-dot${player.online ? ' gh-game-presence-dot--online' : ''}`} />
                      {player.side === 'red' ? '红方' : '黑方'} · 已走 {player.moves} 步 · {player.online ? '在线' : '离线'}
                    </span>
                  </span>
                  <span className="gh-xq-player-side">{player.side === 'red' ? '帅' : '将'}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="gh-xq-info-card">
            <h2 className="gh-xq-info-title">对局状态</h2>
            <p className="gh-xq-info-line">连续无吃子：<strong>{match.halfMoveClock}</strong> / 120 半回合</p>
            <p className="gh-xq-info-line">你执：<strong>{mySide === XIANGQI_RED ? '红方' : '黑方'}</strong></p>
            <p className="gh-xq-info-line">规则：绝杀 / 困毙 / 认输 / 掉线判负，60 回合无吃子判和。</p>
          </section>

          <section className="gh-xq-info-card">
            <h2 className="gh-xq-info-title">操作提示</h2>
            <ul className="gh-ddz-rules-list">
              <li>点击自己的棋子，绿色圆点为合法落点。</li>
              <li>不能送将，也不能走出将帅照面。</li>
              <li>回合 60 秒超时自动托管走子；掉线 120 秒判负。</li>
            </ul>
          </section>
        </aside>
      </div>
    </>
  )
}
