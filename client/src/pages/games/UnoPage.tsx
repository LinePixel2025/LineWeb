import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import UnoCardView from '../../components/games/uno/UnoCardView'
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
  unoTopCard,
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
      return `${seatName(entry.seat)} 摸 ${entry.count} 张牌`
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
  const { getStat, recordResult } = useGameStats()
  const stat = getStat('uno', 'solo')
  const [rulesOpen, setRulesOpen] = useState(false)
  const recordedRef = useRef(false)
  const tableRef = useRef(table)

  useEffect(() => {
    tableRef.current = table
  }, [table])

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

  const newGame = useCallback((count?: number) => {
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
        card.kind === 'wild4' && top && myHand.some((item) => item.color === table.currentColor)
          ? '手里还有当前颜色的牌，不能出万能+4'
          : '这张牌现在不能出（需要同色 / 同数字 / 同功能，或使用万能牌）',
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
  const recentLog = table.log.slice(-8)
  const opponents = table.players.filter((player) => player.seat !== 0)
  const drawnCard = table.drawnCardId === null ? null : myHand.find((card) => card.id === table.drawnCardId) ?? null

  return (
    <div className="gh-page-container gh-games-page gh-uno-page">
      <header className="gh-games-header">
        <div className="gh-games-header-copy">
          <p className="gh-g2048-eyebrow"><Link to="/games">← 游戏大厅</Link></p>
          <h1 className="gh-games-title">UNO · 单机</h1>
          <p className="gh-games-subtitle">
            经典 108 张牌：同色 / 同数字 / 同功能出牌，万能牌指定颜色；禁止、反转、+2、万能+4 改变牌局节奏。
          </p>
        </div>
        <div className="gh-uno-header-actions">
          <Link className="gh-btn gh-btn--secondary gh-btn--md" to={GAME_UNO_ONLINE_ROUTE}>好友联机</Link>
          <button type="button" className="gh-btn gh-btn--primary gh-btn--md" onClick={() => newGame()}>
            重新开局
          </button>
        </div>
      </header>

      <div className="gh-uno-toolbar">
        <div className="gh-uno-toolbar-group" role="group" aria-label="人数选择">
          <span className="gh-uno-toolbar-label">人数</span>
          {[UNO_MIN_PLAYERS, 3, 4].map((count) => (
            <button
              key={count}
              type="button"
              className={`gh-btn gh-btn--sm ${playerCount === count ? 'gh-btn--primary' : 'gh-btn--secondary'}`}
              onClick={() => newGame(count)}
            >
              {count} 人
            </button>
          ))}
          <span className="gh-uno-toolbar-label" title="联机支持 2–10 人">联机最多 {UNO_MAX_PLAYERS} 人</span>
        </div>
        <span className="gh-uno-toolbar-hint">账号战绩：{stat?.games ?? 0} 局 · {stat?.wins ?? 0} 胜</span>
      </div>

      {error && <div className="gh-alert gh-alert--danger gh-game-alert" role="alert">{error}</div>}

      <div className="gh-uno-table">
        <section className="gh-uno-opponents" aria-label="其他玩家">
          {opponents.map((player) => (
            <article
              key={player.seat}
              className={[
                'gh-uno-opponent',
                table.turnSeat === player.seat && table.status === 'playing' ? 'gh-uno-opponent--turn' : '',
                player.alive ? '' : 'gh-uno-opponent--out',
              ].filter(Boolean).join(' ')}
            >
              <span className="gh-uno-opponent-name">
                {seatName(player.seat)}
                {table.turnSeat === player.seat && table.status === 'playing' && (
                  <span className="gh-game-room-badge gh-gmk-turn-badge">回合中</span>
                )}
                {!player.alive && <span className="gh-game-room-badge">出局</span>}
              </span>
              <span className="gh-uno-opponent-count">{player.hand.length} 张</span>
              <div className="gh-uno-card-stack" aria-hidden="true">
                {Array.from({ length: Math.min(player.hand.length, 5) }, (_, index) => (
                  <UnoCardView key={index} card={{ id: 0, color: 'wild', kind: 'wild', number: null }} size="sm" faceDown />
                ))}
              </div>
            </article>
          ))}
        </section>

        <section className="gh-uno-center" aria-label="牌桌中心">
          <div className="gh-uno-status-bar">
            <span className="gh-uno-turn-chip">
              {table.status === 'finished'
                ? '本局结束'
                : table.turnSeat === 0
                  ? '轮到你出牌'
                  : `${seatName(table.turnSeat ?? 0)} 思考中…`}
            </span>
            <span className={`gh-uno-color-chip gh-uno-color-chip--${table.currentColor}`}>
              当前颜色 {UNO_COLOR_LABELS[table.currentColor]}
            </span>
            <span className="gh-uno-direction" title="出牌方向">
              {table.direction === 1 ? '↻ 顺时针' : '↺ 逆时针'}
            </span>
          </div>

          <div className="gh-uno-center-row">
            <div className="gh-uno-pile-box">
              <span className="gh-uno-pile-label">牌堆</span>
              <span className="gh-uno-deck" aria-label={`牌堆剩余 ${table.deck.length} 张`}>
                <span className="gh-uno-deck-count">{table.deck.length}</span>
              </span>
              <button
                type="button"
                className="gh-btn gh-btn--secondary gh-btn--sm"
                onClick={handleDraw}
                disabled={!myTurn || table.drawnCardId !== null}
              >
                摸一张
              </button>
            </div>

            <div className={`gh-uno-discard gh-uno-discard--${table.currentColor}`}>
              <span className="gh-uno-pile-label">弃牌堆顶</span>
              <span className="gh-uno-discard-stack">
                <span className="gh-uno-discard-under" aria-hidden="true" />
                {top && <UnoCardView card={top} size="lg" />}
              </span>
              <span className="gh-uno-discard-count">弃牌 {table.discard.length} 张</span>
            </div>

            <div className="gh-uno-action-box">
              <span className="gh-uno-pile-label">本回合</span>
              {table.drawnCardId !== null ? (
                <>
                  <span className="gh-uno-drawn-hint">
                    摸到 {drawnCard ? unoCardLabel(drawnCard) : '一张牌'}
                    {drawnCard && playableIds.has(drawnCard.id) ? '，可以立即打出' : '，不可出'}
                  </span>
                  <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={handlePass}>
                    跳过
                  </button>
                </>
              ) : (
                <span className="gh-uno-drawn-hint">
                  {myTurn ? '点击手牌出牌；没有可出的牌就摸一张' : '等待对方行动'}
                </span>
              )}
            </div>
          </div>

          <div className="gh-uno-hand-wrap">
            <div className="gh-uno-me-header">
              <span className="gh-uno-me-name">你的手牌</span>
              <span className="gh-uno-me-count">{myHand.length} 张</span>
              {myHand.length === 1 && <span className="gh-uno-uno-badge">UNO!</span>}
              {myTurn && <span className="gh-uno-me-hint">高亮 = 当前可出</span>}
            </div>
            <div className="gh-uno-hand">
              {myHand.map((card) => (
                <UnoCardView
                  key={card.id}
                  card={card}
                  size="md"
                  playable={myTurn && playableIds.has(card.id)}
                  disabled={!myTurn}
                  onClick={() => handleCardClick(card)}
                />
              ))}
            </div>
          </div>
        </section>

        {pendingWild !== null && (
          <div className="gh-uno-color-overlay" role="dialog" aria-modal="true" aria-label="选择万能牌颜色">
            <div className="gh-uno-color-dialog">
              <p className="gh-uno-color-title">选择万能牌的颜色</p>
              <div className="gh-uno-color-options">
                {(['red', 'yellow', 'green', 'blue'] as UnoColor[]).map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`gh-uno-color-btn gh-uno-color-btn--${color}`}
                    onClick={() => {
                      const card = myHand.find((item) => item.id === pendingWild)
                      if (card) applyPlay(card, color)
                    }}
                  >
                    {UNO_COLOR_LABELS[color]}
                  </button>
                ))}
              </div>
              <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={() => setPendingWild(null)}>
                取消
              </button>
            </div>
          </div>
        )}

        {table.status === 'finished' && (
          <div className="gh-uno-overlay" role="dialog" aria-modal="true" aria-label="本局结算">
            <div className="gh-uno-overlay-card">
              <p className="gh-uno-overlay-eyebrow">本局结束</p>
              <h2 className={`gh-uno-overlay-title${iWon ? ' gh-uno-overlay-title--win' : ''}`}>
                {iWon ? '你出完手牌，获胜！' : winner ? `${seatName(winner.seat)} 获胜` : '本局无胜者'}
              </h2>
              <p className="gh-uno-overlay-detail">
                {table.endReason === 'last_standing' ? '其他玩家全部出局，最后存活者获胜。' : '率先出完手牌者获胜。'}
              </p>
              <div className="gh-uno-overlay-actions">
                <button type="button" className="gh-btn gh-btn--primary gh-btn--lg" onClick={() => newGame()}>
                  再来一局
                </button>
                <Link className="gh-btn gh-btn--secondary gh-btn--lg" to={GAME_UNO_ONLINE_ROUTE}>好友联机</Link>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="gh-uno-bottom">
        <section className="gh-uno-log" aria-label="对局记录">
          <h2 className="gh-liar-log-title">对局记录</h2>
          <ul className="gh-liar-log-list">
            {recentLog.length === 0 && <li className="gh-liar-log-empty">打出第一张牌吧。</li>}
            {recentLog.map((entry, index) => (
              <li key={`${entry.type}-${index}`} className="gh-liar-log-item">{logText(entry)}</li>
            ))}
          </ul>
        </section>

        <section className="gh-liar-rules">
          <button type="button" className="gh-ddz-rules-toggle" onClick={() => setRulesOpen((prev) => !prev)}>
            {rulesOpen ? '收起玩法说明' : '玩法说明'}
          </button>
          {rulesOpen && (
            <ul className="gh-ddz-rules-list">
              <li>108 张牌，每人 7 张，翻开第一张非万能牌开局；房主 / 你（座位 0）先手。</li>
              <li>出牌需与当前颜色相同，或数字 / 功能类型相同；万能牌可指定颜色。</li>
              <li>万能+4 有官方限制：手里还有当前颜色的牌时不能出。</li>
              <li>禁止跳过下一家；反转 2 人局视作禁止；+2 / 万能+4 让下一家摸牌并被跳过（不叠加）。</li>
              <li>摸一张后可立即打出或跳过；先出完手牌获胜。牌堆用尽会把弃牌堆洗回。</li>
            </ul>
          )}
        </section>
      </div>

      <p className="gh-games-footnote">
        规则引擎与好友联机完全一致；AI 的决策由 suggestUnoMove 启发式给出。
      </p>
    </div>
  )
}
