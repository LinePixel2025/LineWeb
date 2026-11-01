import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import UserAvatar from '../../components/UserAvatar'
import GameFriendPicker from '../../components/games/GameFriendPicker'
import {
  UnoColorChooser,
  UnoHand,
  UnoInfoPanel,
  UnoSeat,
  UnoTurnStrip,
  UnoCardsCenter,
} from '../../components/games/uno/UnoTableParts'
import { useOnlineGameRoom } from '../../hooks/useOnlineGameRoom'
import { GAME_UNO_ONLINE_ROUTE, GAME_UNO_ROUTE } from '../../lib/games/catalog'
import {
  UNO_COLOR_LABELS,
  unoCardLabel,
  unoIsWild,
  unoPlayableCards,
  type UnoColor,
} from '../../lib/games/uno'
import type {
  GameUnoEndReason,
  GameUnoMatch,
  UnoActionBody,
  UnoCardDto,
  UnoLatelyDto,
} from '../../types/game'

const API_BASE = '/games/uno'
const MIN_PLAYERS = 2
const MAX_PLAYERS = 10

const END_REASON_LABELS: Record<GameUnoEndReason, string> = {
  hand_empty: '有人出完手牌，本局结束',
  last_standing: '其他玩家全部出局，最后存活者获胜',
  timeout: '全局 30 分钟超时，本局无胜者',
  cancelled: '房间已解散',
}

function nameOf(match: GameUnoMatch, userId: number): string {
  return match.players.find((player) => player.userId === userId)?.username ?? '某位玩家'
}

function actionText(match: GameUnoMatch, action: UnoLatelyDto | null): string {
  if (!action) return '等待第一步动作…'
  if (action.type === 'play') {
    return `${nameOf(match, action.userId)} 打出 ${unoCardLabel(action.card)}，当前颜色 ${UNO_COLOR_LABELS[action.color]}`
  }
  if (action.type === 'draw') return `${nameOf(match, action.userId)} 摸了 ${action.count} 张牌`
  return `${nameOf(match, action.userId)} 跳过`
}

export default function UnoOnlinePage() {
  const room = useOnlineGameRoom<GameUnoMatch>({
    game: 'uno',
    apiBase: API_BASE,
    lobbyPath: GAME_UNO_ONLINE_ROUTE,
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
          <p className="gh-g2048-eyebrow">UNO · 好友联机</p>
          <h1 className="gh-games-title">登录后即可邀请好友打 UNO</h1>
          <p className="gh-games-subtitle">联机需要账号：好友关系、邀请与对局都以账号身份进行。也可以先玩单机 AI。</p>
          <div className="gh-gmk-guest-actions">
            <Link className="gh-btn gh-btn--primary gh-btn--md" to="/login">去登录</Link>
            <Link className="gh-btn gh-btn--secondary gh-btn--md" to={GAME_UNO_ROUTE}>单机 AI</Link>
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
          <div className="gh-game-list-state" role="status"><div className="gh-spinner" /><span>正在加载牌桌…</span></div>
        </div>
      )
    }
    if (!match) {
      return (
        <div className="gh-page-container gh-games-page gh-game-online-page">
          {renderError(matchError ?? '对局不存在或已结束，返回大厅重新邀请好友吧。', () => { void loadMatch(matchId, true) })}
          <p className="gh-game-inline-link"><Link to={GAME_UNO_ONLINE_ROUTE}>返回联机大厅</Link></p>
        </div>
      )
    }

    if (match.status === 'waiting') {
      return (
        <div className="gh-page-container gh-games-page gh-game-online-page">
          <section className="gh-game-room" aria-label="UNO 等待房间">
            <header className="gh-game-room-header">
              <div>
                <p className="gh-g2048-eyebrow">UNO 牌桌</p>
                <h1 className="gh-games-title">等待好友入座</h1>
                <p className="gh-games-subtitle">
                  2–10 人经典 UNO：房主开始后立即发牌，座位顺序即出牌顺序；人齐前可以继续邀请。
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
              <ul className="gh-uno-seat-list">
                {Array.from({ length: MAX_PLAYERS }, (_, seat) => {
                  const player = match.players[seat]
                  if (!player) {
                    return (
                      <li key={`empty-${seat}`} className="gh-uno-seat gh-uno-seat--empty">
                        等待加入 · {seat + 1} 号位
                      </li>
                    )
                  }
                  return (
                    <li key={player.userId} className={`gh-uno-seat${player.userId === meId ? ' gh-uno-seat--me' : ''}`}>
                      <span className="gh-uno-seat-order">{seat + 1}</span>
                      <UserAvatar userId={player.userId} username={player.username} size="sm" />
                      <span className="gh-uno-seat-name">
                        {player.username}
                        {player.userId === match.hostId && <span className="gh-game-room-badge">房主</span>}
                        {player.userId === meId && <span className="gh-game-room-badge gh-game-room-badge--me">你</span>}
                      </span>
                      <span className={`gh-game-presence-dot${player.online ? ' gh-game-presence-dot--online' : ''}`} />
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
                  variant="embedded"
                />
              )}
            </section>
          </section>
        </div>
      )
    }

    return (
      <div className="gh-page-container gh-games-page gh-uno-online gh-u2-page">
        <UnoOnlineStage
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
          <h1 className="gh-games-title">UNO · 好友联机</h1>
          <p className="gh-games-subtitle">
            邀请好友开一桌 2–10 人 UNO：同色 / 同数字 / 同功能出牌，先出完手牌者获胜。
          </p>
        </div>
        <div className="gh-gmk-header-actions">
          <Link className="gh-btn gh-btn--secondary gh-btn--md" to={GAME_UNO_ROUTE}>单机 AI</Link>
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
          <li>108 张牌，每人 7 张；翻开第一张非万能牌开局，房主先手。</li>
          <li>同色 / 同数字 / 同功能可出；万能牌指定颜色；万能+4 需手里没有当前颜色。</li>
          <li>禁止跳过下一家；反转 2 人局视作禁止；+2 / 万能+4 让下一家摸牌并被跳过。</li>
          <li>摸一张后可立即打出或跳过；先出完手牌者获胜。</li>
          <li>回合 60 秒超时自动托管；掉线 120 秒出局，最后存活者获胜。</li>
        </ul>
      </div>
    </div>
  )
}

// ==================== 对局舞台 ====================

interface UnoOnlineStageProps {
  match: GameUnoMatch
  meId: number
  isHost: boolean
  transport: 'ws' | 'polling'
  actionPending: boolean
  turnRemainingMs: number | null
  actionError: string | null
  onSubmit: (body: UnoActionBody) => void
  onResign: () => void
  onBackToLobby: () => void
  onBlocked: (message: string) => void
  resignBusy: boolean
}

function UnoOnlineStage({
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
}: UnoOnlineStageProps) {
  const [pendingWild, setPendingWild] = useState<number | null>(null)
  const playing = match.status === 'playing'
  const me = match.players.find((player) => player.userId === meId)
  const myTurn = playing && match.turn?.userId === meId && me?.status === 'playing'
  const top = match.topCard
  const myHand = match.myHand
  const currentColor = match.currentColor
  const playable = useMemo(() => {
    if (!top || !currentColor) return []
    const cards = unoPlayableCards(myHand, top, currentColor)
    if (match.drawnCardId !== null) return cards.filter((card) => card.id === match.drawnCardId)
    return cards
  }, [myHand, top, currentColor, match.drawnCardId])
  const playableIds = useMemo(() => new Set(playable.map((card) => card.id)), [playable])
  const winner = match.players.find((player) => player.userId === match.winnerId) ?? null
  const turnSeconds = turnRemainingMs === null ? null : Math.ceil(turnRemainingMs / 1000)
  const drawnCard = match.drawnCardId === null ? null : myHand.find((card) => card.id === match.drawnCardId) ?? null
  const pendingWildCard = pendingWild === null ? null : myHand.find((card) => card.id === pendingWild) ?? null

  useEffect(() => {
    setPendingWild(null)
  }, [match.version])

  const handleCardClick = (card: UnoCardDto) => {
    if (!myTurn) {
      onBlocked('还没轮到你')
      return
    }
    if (!playableIds.has(card.id)) {
      onBlocked(
        card.kind === 'wild4' && currentColor && myHand.some((item) => item.color === currentColor)
          ? '手里还有当前颜色的牌，不能出万能+4'
          : '这张牌现在不能出：需要同色、同数字或同功能（万能牌可随时出）',
      )
      return
    }
    if (unoIsWild(card)) {
      setPendingWild(card.id)
      return
    }
    onSubmit({ type: 'play', cardId: card.id })
  }

  const handleDraw = () => {
    if (!myTurn) {
      onBlocked('还没轮到你')
      return
    }
    if (match.drawnCardId !== null) {
      onBlocked('本回合已经摸过牌，请打出刚摸到的牌或跳过')
      return
    }
    onSubmit({ type: 'draw' })
  }

  const handlePass = () => {
    if (!myTurn || match.drawnCardId === null) return
    onSubmit({ type: 'pass' })
  }

  const turnName = match.status === 'finished'
    ? '本局结束'
    : myTurn
      ? '你'
      : match.turn
        ? nameOf(match, match.turn.userId)
        : '等待中'
  const turnSub = match.status === 'finished'
    ? '本局已结算'
    : myTurn
      ? (match.drawnCardId !== null
        ? `摸到 ${drawnCard ? unoCardLabel(drawnCard) : '一张牌'}，可立即打出或跳过`
        : '点高亮手牌出牌，或点牌堆摸一张')
      : match.turn
        ? `${nameOf(match, match.turn.userId)} 正在出牌…`
        : '等待服务端安排回合…'
  const turnHint = match.status === 'finished'
    ? '本局已结束，回大厅可以再开一局。'
    : myTurn
      ? '先看桌面顶牌与当前颜色：能出就点抬起的手牌，不能出就点牌堆摸一张。'
      : '等对手出牌会自动轮到你，不需要点任何按钮。'
  const lastActionText = actionText(match, match.lastAction)

  return (
    <>
      <header className="gh-u2-page-head">
        <div className="gh-u2-page-copy">
          <p className="gh-g2048-eyebrow"><Link to={GAME_UNO_ONLINE_ROUTE}>← UNO 联机大厅</Link></p>
          <h1 className="gh-games-title">
            UNO · 好友对局
          </h1>
          <p className="gh-games-subtitle">
            {match.players.length} 人牌桌 · 先出完手牌者获胜 · 回合 60 秒超时自动托管
          </p>
        </div>
        <div className="gh-u2-page-actions">
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

      <div className="gh-u2-layout">
        <div className="gh-u2-main">
          <div className="gh-u2-seats" aria-label="座位">
            {match.players.map((player) => (
              <UnoSeat
                key={player.userId}
                name={player.username}
                handCount={player.handCount}
                isTurn={match.turn?.userId === player.userId}
                isMe={player.userId === meId}
                isHost={player.userId === match.hostId}
                online={player.online}
                status={player.status === 'won' ? 'won' : player.status === 'lost' ? 'lost' : 'playing'}
                avatar={<UserAvatar userId={player.userId} username={player.username} size="md" />}
              />
            ))}
          </div>

          <UnoTurnStrip
            turnLabel={turnName}
            subLabel={turnSub}
            countdown={playing ? turnSeconds : null}
            currentColor={currentColor}
            direction={match.direction}
            deckCount={match.deckCount}
            isMyTurn={myTurn}
            transport={transport}
          />

          <div className="gh-u2-board">
            <UnoCardsCenter
              topCard={top}
              deckCount={match.deckCount}
              discardCount={match.discardCount}
              currentColor={currentColor}
              canDraw={myTurn && match.drawnCardId === null && !actionPending}
              drawDisabledReason={
                !myTurn ? '还没轮到你' : match.drawnCardId !== null ? '本回合已摸过牌' : undefined
              }
              onDraw={handleDraw}
              hint={
                !myTurn
                  ? '对手出牌中，牌堆暂时不可摸'
                  : match.drawnCardId !== null
                    ? '摸牌完成：打出刚摸到的那张，或点「跳过」结束回合'
                    : playableIds.size > 0
                      ? '有可出的牌：直接点手牌出牌'
                      : '没有可出的牌：点牌堆摸一张'
              }
              pulseDraw={myTurn && match.drawnCardId === null && playableIds.size === 0}
            />

            <div className={`gh-u2-action-row${myTurn ? ' gh-u2-action-row--me' : ''}`}>
              <div className="gh-u2-action-copy">
                <strong>
                  {match.status === 'finished'
                    ? '本局结算'
                    : myTurn
                      ? (match.drawnCardId !== null ? '你已摸牌' : '轮到你行动')
                      : `${match.turn ? nameOf(match, match.turn.userId) : '对手'} 行动中`}
                </strong>
                <span>
                  {match.status === 'finished'
                    ? '回大厅可以再开一局'
                    : myTurn
                      ? (match.drawnCardId !== null
                        ? '只能打出刚摸到的那张牌，或跳过'
                        : '点手牌出牌；没有可出的牌就摸一张')
                      : '等待对手出牌，轮到你时会自动提示'}
                </span>
              </div>
              {myTurn && match.drawnCardId !== null ? (
                <button
                  type="button"
                  className="gh-btn gh-btn--secondary gh-btn--md"
                  onClick={handlePass}
                  disabled={actionPending}
                >
                  跳过本回合
                </button>
              ) : (
                <span className="gh-u2-action-state">
                  {actionPending ? '提交中…' : match.status === 'finished' ? '—' : myTurn ? '等待你出牌' : '自动轮转'}
                </span>
              )}
            </div>

            <UnoHand
              cards={myHand}
              playableIds={playableIds}
              myTurn={myTurn}
              actionPending={actionPending}
              drawnCardId={match.drawnCardId}
              onCardClick={handleCardClick}
            />
          </div>
        </div>

        <UnoInfoPanel
          turnHint={turnHint}
          lastActionText={`最近一步：${lastActionText}`}
          recentLog={match.lastAction ? [lastActionText] : []}
          rules={[
            '点击高亮手牌直接出牌；万能牌会弹出颜色选择。',
            '摸牌后只能打出刚摸到的那张，或点「跳过」。',
            '万能+4 在你手里还有当前颜色时不可出。',
            '回合 60 秒超时由服务端自动托管；掉线 120 秒出局。',
          ]}
        />
      </div>

      <UnoColorChooser
        open={pendingWild !== null}
        card={pendingWildCard}
        onPick={(color) => {
          const cardId = pendingWild
          setPendingWild(null)
          if (cardId !== null) onSubmit({ type: 'play', cardId, color })
        }}
        onCancel={() => setPendingWild(null)}
      />

      {match.status === 'finished' && (
        <div className="gh-u2-modal" role="dialog" aria-modal="true" aria-label="对局结算">
          <div className="gh-u2-result-card">
            <p className="gh-u2-result-kicker">牌局结束</p>
            <h2 className={`gh-u2-result-title${winner?.userId === meId ? ' gh-u2-result-title--win' : ''}`}>
              {winner ? `${winner.username} 获胜` : '本局无胜者'}
            </h2>
            <p className="gh-u2-result-detail">{match.reason ? END_REASON_LABELS[match.reason] : '本局已结束'}</p>
            <div className="gh-u2-result-actions">
              <button type="button" className="gh-btn gh-btn--primary gh-btn--lg" onClick={onBackToLobby}>
                {isHost ? '回大厅再开一局' : '返回大厅'}
              </button>
              <Link className="gh-btn gh-btn--secondary gh-btn--lg" to={GAME_UNO_ROUTE}>单机练习</Link>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

