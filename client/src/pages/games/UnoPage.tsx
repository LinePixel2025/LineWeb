import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  UnoColorChooser,
  UnoHand,
  UnoInfoPanel,
  UnoSeat,
  UnoTurnStrip,
  UnoCardsCenter,
} from '../../components/games/uno/UnoTableParts'
import { GAME_UNO_ONLINE_ROUTE } from '../../lib/games/catalog'
import { useGameStats } from '../../contexts/GameStatsContext'
import {
  UNO_COLOR_LABELS,
  UNO_MAX_PLAYERS,
  UNO_MIN_PLAYERS,
  createUnoTable,
  drawUnoTurn,
  passUnoTurn,
  playUnoCard,
  suggestUnoMove,
  unoCardLabel,
  unoIsWild,
  unoPlayableCards,
  type UnoCard,
  type UnoColor,
  type UnoLogEntry,
  type UnoTableState,
} from '../../lib/games/uno'

const AI_THINK_MS = 700

function seatName(seat: number): string {
  return seat === 0 ? '你' : `AI ${seat}`
}

function nextAliveSeat(state: UnoTableState, fromSeat: number): number {
  const total = state.players.length
  for (let offset = 1; offset <= total; offset += 1) {
    const seat = ((fromSeat + offset * state.direction) % total + total) % total
    if (state.players[seat]?.alive) return seat
  }
  return fromSeat
}

function logText(entry: UnoLogEntry): string {
  switch (entry.type) {
    case 'play':
      return `${seatName(entry.seat)} 打出 ${unoCardLabel(entry.card)}（${UNO_COLOR_LABELS[entry.color]}）`
    case 'draw':
      return `${seatName(entry.seat)} 摸了 ${entry.count} 张牌`
    case 'pass':
      return `${seatName(entry.seat)} 跳过`
    case 'skip':
      return `${seatName(entry.seat)} 被跳过`
    case 'reverse':
      return `${seatName(entry.seat)} 反转出牌方向`
    case 'eliminate':
      return `${seatName(entry.seat)} 出局`
    case 'reshuffle':
      return '牌堆用尽，弃牌堆洗回牌堆'
    case 'win':
      return `${seatName(entry.seat)} 出完手牌，赢下本局`
    default:
      return ''
  }
}

export default function UnoPage() {
  const [playerCount, setPlayerCount] = useState(3)
  const [table, setTable] = useState<UnoTableState>(() => createUnoTable(3))
  const [error, setError] = useState<string | null>(null)
  const [pendingWild, setPendingWild] = useState<number | null>(null)
  const { getStat, recordResult, ensureTicket } = useGameStats()
  const stat = getStat('uno', 'solo')
  const recordedRef = useRef(false)

  const aiSeat = table.status === 'playing' && table.turnSeat !== null && table.turnSeat !== 0
    ? table.turnSeat
    : null

  // AI 回合：延迟决策，摸到可出的牌后会继续行动（效果在 table 变化时重跑）
  useEffect(() => {
    if (aiSeat === null) return undefined
    const timer = window.setTimeout(() => {
      setTable((prev) => {
        if (prev.status !== 'playing' || prev.turnSeat !== aiSeat) return prev
        const player = prev.players[aiSeat]
        const top = prev.discard[prev.discard.length - 1]
        if (!player || !player.alive || !top) return prev
        const nextSeat = nextAliveSeat(prev, aiSeat)
        const suggestion = suggestUnoMove({
          hand: player.hand,
          top,
          currentColor: prev.currentColor,
          drawnCardId: prev.drawnCardId,
          nextHandCount: prev.players[nextSeat]?.hand.length,
        })
        try {
          if (suggestion.action === 'play') {
            return playUnoCard(prev, aiSeat, suggestion.cardId, suggestion.color)
          }
          if (suggestion.action === 'draw') return drawUnoTurn(prev, aiSeat)
          return passUnoTurn(prev, aiSeat)
        } catch {
          return prev
        }
      })
    }, AI_THINK_MS)
    return () => window.clearTimeout(timer)
  }, [aiSeat, table])

  // 结算统计（每局只记一次）
  useEffect(() => {
    if (table.status !== 'finished' || recordedRef.current) return
    recordedRef.current = true
    recordResult({
      game: 'uno',
      variant: 'solo',
      outcome: table.winnerSeat === 0 ? 'win' : 'loss',
    })
  }, [table.status, table.winnerSeat, recordResult])

  const newGame = useCallback(async (count?: number) => {
    if (!(await ensureTicket('uno'))) return
    const nextCount = count ?? playerCount
    recordedRef.current = false
    setError(null)
    setPendingWild(null)
    setPlayerCount(nextCount)
    setTable(createUnoTable(nextCount))
  }, [playerCount])

  const myHand = table.players[0]?.hand ?? []
  const top = table.discard[table.discard.length - 1] ?? null
  const myTurn = table.status === 'playing' && table.turnSeat === 0
  const playable = useMemo(() => {
    if (!top) return []
    const cards = unoPlayableCards(myHand, top, table.currentColor)
    if (table.drawnCardId !== null) return cards.filter((card) => card.id === table.drawnCardId)
    return cards
  }, [myHand, top, table.currentColor, table.drawnCardId])
  const playableIds = useMemo(() => new Set(playable.map((card) => card.id)), [playable])

  const applyPlay = (card: UnoCard, color?: UnoColor) => {
    try {
      const next = playUnoCard(table, 0, card.id, color)
      setTable(next)
      setPendingWild(null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '这张牌不能出')
    }
  }

  const handleCardClick = (card: UnoCard) => {
    if (!myTurn) {
      setError('还没轮到你')
      return
    }
    if (!playableIds.has(card.id)) {
      setError(
        card.kind === 'wild4' && myHand.some((item) => item.color === table.currentColor)
          ? '手里还有当前颜色的牌，不能出万能+4'
          : '这张牌现在不能出：需要同色、同数字或同功能（万能牌可随时出）',
      )
      return
    }
    if (unoIsWild(card)) {
      setPendingWild(card.id)
      return
    }
    applyPlay(card)
  }

  const handleDraw = () => {
    if (!myTurn) {
      setError('还没轮到你')
      return
    }
    if (table.drawnCardId !== null) {
      setError('本回合已经摸过牌，请打出刚摸到的牌或跳过')
      return
    }
    try {
      setTable(drawUnoTurn(table, 0))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '摸牌失败')
    }
  }

  const handlePass = () => {
    if (!myTurn || table.drawnCardId === null) return
    try {
      setTable(passUnoTurn(table, 0))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '跳过失败')
    }
  }

  const winner = table.winnerSeat === null ? null : table.players[table.winnerSeat]
  const iWon = table.winnerSeat === 0
  const recentLog = table.log.slice(-8).map(logText).reverse()
  const opponents = table.players.filter((player) => player.seat !== 0)
  const drawnCard = table.drawnCardId === null ? null : myHand.find((card) => card.id === table.drawnCardId) ?? null
  const pendingWildCard = pendingWild === null ? null : myHand.find((card) => card.id === pendingWild) ?? null
  const me = table.players[0]
  const turnName = table.status === 'finished'
    ? '本局结束'
    : table.turnSeat === null
      ? '等待中'
      : seatName(table.turnSeat)
  const turnSub = table.status === 'finished'
    ? '查看结算结果'
    : myTurn
      ? (table.drawnCardId !== null
        ? `摸到 ${drawnCard ? unoCardLabel(drawnCard) : '一张牌'}，可立即打出或跳过`
        : '点高亮手牌出牌，或点牌堆摸一张')
      : `${seatName(table.turnSeat ?? 0)} 正在出牌…`
  const turnHint = table.status === 'finished'
    ? '本局已结束，点「再来一局」继续。'
    : myTurn
      ? '先看桌面顶牌与当前颜色：能出就点抬起的手牌，不能出就点牌堆摸一张。'
      : '等对手出完牌会自动轮到你，不需要点任何按钮。'
  const lastActionText = table.log.length > 0 ? logText(table.log[table.log.length - 1]) : '还没有人出牌'

  return (
    <div className="gh-page-container gh-games-page gh-u2-page">
      <header className="gh-u2-page-head">
        <div className="gh-u2-page-copy">
          <p className="gh-g2048-eyebrow"><Link to="/games">← 游戏大厅</Link></p>
          <h1 className="gh-games-title">UNO · 单机</h1>
          <p className="gh-games-subtitle">
            和 AI 打一局经典 UNO：同色 / 同数字 / 同功能出牌，先出完手牌者获胜。
          </p>
        </div>
        <div className="gh-u2-page-actions">
          <Link className="gh-btn gh-btn--secondary gh-btn--md" to={GAME_UNO_ONLINE_ROUTE}>好友联机</Link>
          <button type="button" className="gh-btn gh-btn--primary gh-btn--md" onClick={() => newGame()}>
            重新开局
          </button>
        </div>
      </header>

      <div className="gh-u2-toolbar">
        <div className="gh-u2-toolbar-group" role="group" aria-label="人数选择">
          <span className="gh-u2-toolbar-label">人数</span>
          {[UNO_MIN_PLAYERS, 3, 4].map((count) => (
            <button
              key={count}
              type="button"
              className={`gh-btn gh-btn--sm ${playerCount === count ? 'gh-btn--primary' : 'gh-btn--secondary'}`}
              aria-pressed={playerCount === count}
              onClick={() => newGame(count)}
            >
              {count} 人
            </button>
          ))}
          <span className="gh-u2-toolbar-note">联机最多 {UNO_MAX_PLAYERS} 人</span>
        </div>
        <span className="gh-u2-toolbar-record">
          账号战绩 <strong>{stat?.games ?? 0}</strong> 局 · <strong>{stat?.wins ?? 0}</strong> 胜
        </span>
      </div>

      {error && <div className="gh-alert gh-alert--danger gh-game-alert" role="alert">{error}</div>}

      <div className="gh-u2-layout">
        <div className="gh-u2-main">
          <div className="gh-u2-seats" aria-label="座位">
            {opponents.map((player) => (
              <UnoSeat
                key={player.seat}
                name={seatName(player.seat)}
                handCount={player.hand.length}
                isTurn={table.status === 'playing' && table.turnSeat === player.seat}
                status={player.alive ? 'playing' : 'lost'}
                avatar={<span className="gh-u2-seat-robot">AI</span>}
              />
            ))}
            {me && (
              <UnoSeat
                name="你"
                handCount={me.hand.length}
                isTurn={myTurn}
                isMe
                status={me.alive ? 'playing' : 'lost'}
                avatar={<span className="gh-u2-seat-robot gh-u2-seat-robot--user" />}
              />
            )}
          </div>

          <UnoTurnStrip
            turnLabel={turnName}
            subLabel={turnSub}
            countdown={null}
            currentColor={table.currentColor}
            direction={table.direction}
            deckCount={table.deck.length}
            isMyTurn={myTurn}
          />

          <div className="gh-u2-board">
            <UnoCardsCenter
              topCard={top}
              deckCount={table.deck.length}
              discardCount={table.discard.length}
              currentColor={table.currentColor}
              canDraw={myTurn && table.drawnCardId === null}
              drawDisabledReason={
                !myTurn ? '还没轮到你' : table.drawnCardId !== null ? '本回合已摸过牌' : undefined
              }
              onDraw={handleDraw}
              hint={
                !myTurn
                  ? '对手出牌中，牌堆暂时不可摸'
                  : table.drawnCardId !== null
                    ? '摸牌完成：打出刚摸到的那张，或点「跳过」结束回合'
                    : playableIds.size > 0
                      ? '有可出的牌：直接点手牌出牌'
                      : '没有可出的牌：点牌堆摸一张'
              }
              pulseDraw={myTurn && table.drawnCardId === null && playableIds.size === 0}
            />

            <div className={`gh-u2-action-row${myTurn ? ' gh-u2-action-row--me' : ''}`}>
              <div className="gh-u2-action-copy">
                <strong>
                  {table.status === 'finished'
                    ? '本局结算'
                    : myTurn
                      ? (table.drawnCardId !== null ? '你已摸牌' : '轮到你行动')
                      : `${seatName(table.turnSeat ?? 0)} 行动中`}
                </strong>
                <span>
                  {table.status === 'finished'
                    ? '点下方「再来一局」重新开始'
                    : myTurn
                      ? (table.drawnCardId !== null
                        ? '只能打出刚摸到的那张牌，或跳过'
                        : '点手牌出牌；没有可出的牌就摸一张')
                      : '等待对手出牌，轮到你时会自动提示'}
                </span>
              </div>
              {myTurn && table.drawnCardId !== null ? (
                <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={handlePass}>
                  跳过本回合
                </button>
              ) : (
                <span className="gh-u2-action-state">
                  {table.status === 'finished' ? '—' : myTurn ? '等待你出牌' : '自动轮转'}
                </span>
              )}
            </div>

            <UnoHand
              cards={myHand}
              playableIds={playableIds}
              myTurn={myTurn}
              actionPending={false}
              drawnCardId={table.drawnCardId}
              onCardClick={handleCardClick}
            />
          </div>
        </div>

        <UnoInfoPanel
          turnHint={turnHint}
          lastActionText={`最近一步：${lastActionText}`}
          recentLog={recentLog}
          rules={[
            '108 张牌，每人 7 张；你（座位 0）先手，摸牌后只能打刚摸到的那张或跳过。',
            '出牌需同色 / 同数字 / 同功能；万能牌可以随时出并指定新颜色。',
            '万能+4 有官方限制：手里还有当前颜色的牌时不能出。',
            '禁止跳过下一家；反转 2 人局视作禁止；+2 / 万能+4 让下一家摸牌并被跳过（不叠加）。',
            '先出完手牌者获胜；牌堆用尽会把弃牌堆洗回。',
          ]}
        />
      </div>

      <UnoColorChooser
        open={pendingWild !== null}
        card={pendingWildCard}
        onPick={(color) => {
          const card = pendingWildCard
          if (card) applyPlay(card, color)
        }}
        onCancel={() => setPendingWild(null)}
      />

      {table.status === 'finished' && (
        <div className="gh-u2-modal" role="dialog" aria-modal="true" aria-label="本局结算">
          <div className="gh-u2-result-card">
            <p className="gh-u2-result-kicker">本局结束</p>
            <h2 className={`gh-u2-result-title${iWon ? ' gh-u2-result-title--win' : ''}`}>
              {iWon ? '你出完手牌，获胜！' : winner ? `${seatName(winner.seat)} 获胜` : '本局无胜者'}
            </h2>
            <p className="gh-u2-result-detail">
              {table.endReason === 'last_standing' ? '其他玩家全部出局，最后存活者获胜。' : '率先出完手牌者获胜。'}
            </p>
            <div className="gh-u2-result-actions">
              <button type="button" className="gh-btn gh-btn--primary gh-btn--lg" onClick={() => newGame()}>
                再来一局
              </button>
              <Link className="gh-btn gh-btn--secondary gh-btn--lg" to={GAME_UNO_ONLINE_ROUTE}>好友联机</Link>
            </div>
          </div>
        </div>
      )}

      <p className="gh-games-footnote">
        规则引擎与好友联机完全一致；AI 的决策由 suggestUnoMove 启发式给出。
      </p>
    </div>
  )
}

