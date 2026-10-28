import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import LiarCardView from '../../components/games/liar/LiarCardView'
import { GAME_LIAR_ONLINE_ROUTE } from '../../lib/games/catalog'
import { useGameStats } from '../../contexts/GameStatsContext'
import {
  LIAR_HAND_SIZE,
  LIAR_MAX_PLAYERS,
  LIAR_MIN_PLAYERS,
  applyLiarTableChallenge,
  applyLiarTablePlay,
  createLiarTable,
  isValidLiarPlay,
  liarCardKind,
  liarCardIsTruthy,
  liarGunBullets,
  suggestLiarMove,
  type LiarTableLogEntry,
  type LiarTableState,
} from '../../lib/games/liar'

const AI_THINK_MS = 750

function seatName(state: LiarTableState, seat: number): string {
  if (seat === 0) return '你'
  const player = state.players[seat]
  return player ? `AI ${seat}` : `座位 ${seat + 1}`
}

function playerStatus(state: LiarTableState, seat: number): string {
  if (state.players[seat]?.alive) return `手牌 ${state.players[seat]?.hand.length ?? 0} 张`
  return '已出局'
}

function logText(state: LiarTableState, entry: LiarTableLogEntry): string {
  const name = (seat: number) => seatName(state, seat)
  switch (entry.type) {
    case 'round':
      return `第 ${entry.round} 局开始，目标牌面 ${entry.target}，${name(entry.starterSeat)} 先手`
    case 'play':
      return `${name(entry.seat)} 盖着出 ${entry.count} 张`
    case 'challenge':
      return `${name(entry.seat)} 质疑 ${name(entry.targetSeat)}`
    case 'reveal':
      return `开牌：${entry.cards.map((card) => (liarCardKind(card) === 'JOKER' ? '鬼' : liarCardKind(card))).join(' ')} —— ${entry.truthful ? '全真' : '有假'}`
    case 'trigger':
      return `${name(entry.seat)} 扣动扳机（${entry.bullets}/6）${entry.died ? '，中弹出局' : '，空枪'}`
    case 'death':
      return `${name(entry.seat)} ${entry.cause === 'resign' ? '认输' : entry.cause === 'forfeit' ? '掉线判负' : '中弹'}出局`
    case 'flush':
      return `第 ${entry.round} 局流局，重洗重发`
    default:
      return ''
  }
}

export default function LiarPage() {
  const [playerCount, setPlayerCount] = useState(3)
  const [table, setTable] = useState<LiarTableState>(() => createLiarTable(3))
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const { getStat, recordResult } = useGameStats()
  const stat = getStat('liar', 'solo')
  const [rulesOpen, setRulesOpen] = useState(false)
  const recordedRef = useRef(false)
  const tableRef = useRef(table)

  useEffect(() => {
    tableRef.current = table
  }, [table])

  const aiSeat = !table.finished && table.turnSeat !== null && table.turnSeat !== 0
    ? table.turnSeat
    : null

  // AI 回合：延迟决策（引擎与联机托管共用）
  useEffect(() => {
    if (aiSeat === null) return undefined
    const timer = window.setTimeout(() => {
      setTable((prev) => {
        if (prev.finished || prev.turnSeat !== aiSeat) return prev
        const player = prev.players[aiSeat]
        if (!player || !player.alive || player.hand.length === 0) return prev
        const top = prev.pile[prev.pile.length - 1] ?? null
        const suggestion = suggestLiarMove({
          hand: player.hand,
          target: prev.target,
          lastPlay: top === null ? null : { seat: top.seat, count: top.count },
        })
        if (!suggestion) return prev
        try {
          return suggestion.action === 'play'
            ? applyLiarTablePlay(prev, aiSeat, suggestion.cards)
            : applyLiarTableChallenge(prev, aiSeat)
        } catch {
          return prev
        }
      })
    }, AI_THINK_MS)
    return () => window.clearTimeout(timer)
  }, [aiSeat, table])

  // 回合切换时清空选牌
  useEffect(() => {
    setSelected(new Set())
  }, [table.turnSeat, table.round])

  // 结算统计（每场只记一次）
  useEffect(() => {
    if (!table.finished || recordedRef.current) return
    recordedRef.current = true
    recordResult({
      game: 'liar',
      variant: 'solo',
      outcome: table.winnerSeat === 0 ? 'win' : 'loss',
      deaths: table.players[0]?.alive ? 0 : 1,
    })
  }, [table.finished, table.winnerSeat, table.players, recordResult])

  const newGame = useCallback((count?: number) => {
    const nextCount = count ?? playerCount
    recordedRef.current = false
    setError(null)
    setSelected(new Set())
    setPlayerCount(nextCount)
    setTable(createLiarTable(nextCount))
  }, [playerCount])

  const myTurn = !table.finished && table.turnSeat === 0
  const top = table.pile[table.pile.length - 1] ?? null
  const canChallenge = myTurn && top !== null && top.seat !== 0
  const myHand = table.players[0]?.hand ?? []
  const selectedCards = useMemo(
    () => myHand.filter((card) => selected.has(card)),
    [myHand, selected],
  )
  const canPlay = myTurn && isValidLiarPlay(myHand, selectedCards)

  const toggleCard = (card: number) => {
    if (!myTurn) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(card)) {
        next.delete(card)
      } else if (next.size < 3) {
        next.add(card)
      }
      return next
    })
    setError(null)
  }

  const handlePlay = () => {
    if (!myTurn) {
      setError('还没轮到你')
      return
    }
    if (!isValidLiarPlay(myHand, selectedCards)) {
      setError(`请选择 1–3 张手牌（当前选了 ${selectedCards.length} 张）`)
      return
    }
    try {
      const next = applyLiarTablePlay(table, 0, selectedCards)
      setTable(next)
      setSelected(new Set())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '出牌失败')
    }
  }

  const handleChallenge = () => {
    if (!canChallenge) {
      setError(top === null ? '牌堆上还没有可质疑的出牌' : '不能质疑自己的出牌')
      return
    }
    try {
      const next = applyLiarTableChallenge(table, 0)
      setTable(next)
      setSelected(new Set())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '质疑失败')
    }
  }

  const bullets = liarGunBullets(table.deaths)
  const iWon = table.finished && table.winnerSeat === 0
  const recentLog = table.log.slice(-8)
  const myStatus = playerStatus(table, 0)

  return (
    <div className="gh-page-container gh-games-page gh-liar-page">
      <header className="gh-games-header">
        <div className="gh-games-header-copy">
          <p className="gh-g2048-eyebrow">
            <Link to="/games">← 游戏大厅</Link>
          </p>
          <h1 className="gh-games-title">骗子酒馆 · 单机</h1>
          <p className="gh-games-subtitle">
            盖着出牌、虚张声势：轮到你时出 1–3 张手牌，或质疑上一手。开牌见真假，输家扣左轮扳机。
          </p>
        </div>
        <div className="gh-liar-header-actions">
          <Link className="gh-btn gh-btn--secondary gh-btn--md" to={GAME_LIAR_ONLINE_ROUTE}>
            好友联机
          </Link>
          <button type="button" className="gh-btn gh-btn--primary gh-btn--md" onClick={() => newGame()}>
            重新开局
          </button>
        </div>
      </header>

      <div className="gh-liar-toolbar">
        <div className="gh-liar-toolbar-group" role="group" aria-label="人数选择">
          <span className="gh-liar-toolbar-label">人数</span>
          {[2, 3, 4].map((count) => (
            <button
              key={count}
              type="button"
              className={`gh-btn gh-btn--sm ${playerCount === count ? 'gh-btn--primary' : 'gh-btn--secondary'}`}
              onClick={() => newGame(count)}
            >
              {count} 人
            </button>
          ))}
        </div>
        <span className="gh-liar-toolbar-hint">
          账号战绩：{stat?.games ?? 0} 局 · {stat?.wins ?? 0} 胜 · 中弹 {stat?.deaths ?? 0} 次
        </span>
      </div>

      {error && <div className="gh-alert gh-alert--danger gh-game-alert" role="alert">{error}</div>}

      <div className="gh-liar-table">
        <section className="gh-liar-opponents" aria-label="其他玩家">
          {table.players.filter((player) => player.seat !== 0).map((player) => (
            <article
              key={player.seat}
              className={[
                'gh-liar-opponent',
                table.turnSeat === player.seat && !table.finished ? 'gh-liar-opponent--turn' : '',
                player.alive ? '' : 'gh-liar-opponent--dead',
              ].filter(Boolean).join(' ')}
            >
              <span className="gh-liar-opponent-name">
                AI {player.seat}
                {table.turnSeat === player.seat && !table.finished && (
                  <span className="gh-game-room-badge gh-gmk-turn-badge">回合中</span>
                )}
                {!player.alive && <span className="gh-game-room-badge">出局</span>}
              </span>
              <span className="gh-liar-opponent-meta">{playerStatus(table, player.seat)}</span>
              <div className="gh-liar-hand-stack" aria-hidden="true">
                {Array.from({ length: Math.min(player.hand.length, 5) }, (_, index) => (
                  <LiarCardView key={index} card={0} faceDown size="sm" />
                ))}
              </div>
            </article>
          ))}
        </section>

        <section className="gh-liar-center" aria-label="牌桌中心">
          <div className="gh-liar-round-bar">
            <span className="gh-liar-round-chip">第 {table.round} 局</span>
            <span className="gh-liar-target">
              目标牌面
              <span
                className={`gh-liar-target-card gh-liar-target-card--${table.target.toLowerCase()}`}
                aria-label={`目标牌面 ${table.target}`}
              >
                {table.target}
              </span>
            </span>
            <span className={`gh-liar-gun${bullets >= 4 ? ' gh-liar-gun--danger' : ''}`} title={`左轮 ${bullets}/6 有子弹`}>
              左轮 {bullets}/6
              <span className="gh-liar-gun-dots" aria-hidden="true">
                {Array.from({ length: 6 }, (_, index) => (
                  <span
                    key={index}
                    className={`gh-liar-gun-dot${index < bullets ? ' gh-liar-gun-dot--loaded' : ''}`}
                  />
                ))}
              </span>
            </span>
          </div>

          <div className="gh-liar-pile">
            <span className="gh-liar-pile-label">牌堆</span>
            <div className="gh-liar-pile-cards">
              {table.pile.length === 0 && <span className="gh-liar-pile-empty">本局还没有人出牌</span>}
              {table.pile.map((entry, index) => (
                <span key={`${entry.seat}-${index}`} className="gh-liar-pile-entry">
                  <span className="gh-liar-pile-backs" aria-hidden="true">
                    {Array.from({ length: Math.min(entry.count, 3) }, (_, cardIndex) => (
                      <span key={cardIndex} className="gh-liar-pile-back" />
                    ))}
                  </span>
                  <span className="gh-liar-pile-count">×{entry.count}</span>
                  <span className="gh-liar-pile-name">{seatName(table, entry.seat)}</span>
                </span>
              ))}
            </div>
          </div>

          <div className={`gh-liar-turn${myTurn ? ' gh-liar-turn--me' : ''}`}>
            <span className="gh-liar-turn-label">当前回合</span>
            <strong>
              {table.finished
                ? '本场结束'
                : table.turnSeat === null
                  ? '等待中'
                  : table.turnSeat === 0
                    ? '你'
                    : `${seatName(table, table.turnSeat)} 思考中…`}
            </strong>
            {top && !table.finished && (
              <span className="gh-liar-turn-hint">
                上一手是 {seatName(table, top.seat)} 的 {top.count} 张牌 —— 质疑只翻开这一手
              </span>
            )}
          </div>

          {table.lastReveal && (
            <div className={`gh-liar-reveal${table.lastReveal.truthful ? ' gh-liar-reveal--true' : ' gh-liar-reveal--lie'}`}>
              <span className="gh-liar-reveal-stamp" aria-hidden="true">
                {table.lastReveal.truthful ? '真' : '假'}
              </span>
              <span className="gh-liar-reveal-title">
                最近开牌 · {seatName(table, table.lastReveal.seat)} 的第 {table.lastReveal.round} 局出牌
              </span>
              <div className="gh-liar-reveal-cards">
                {table.lastReveal.cards.map((card) => (
                  <LiarCardView key={card} card={card} size="sm" />
                ))}
              </div>
              <span className="gh-liar-reveal-verdict">
                {table.lastReveal.truthful ? '全是真牌 —— 质疑者扣扳机' : '掺了假牌 —— 被打出者扣扳机'}
              </span>
            </div>
          )}

          {myTurn && (
            <div className="gh-liar-actions">
              <button
                type="button"
                className="gh-btn gh-btn--primary gh-btn--md"
                onClick={handlePlay}
                disabled={!canPlay}
              >
                盖牌出牌（{selectedCards.length} 张）
              </button>
              <button
                type="button"
                className="gh-btn gh-btn--danger gh-btn--md"
                onClick={handleChallenge}
                disabled={!canChallenge}
                title={canChallenge ? '质疑上一手，翻开定真假' : '当前没有可质疑的上一手'}
              >
                质疑上一手
              </button>
            </div>
          )}
        </section>

        <section className="gh-liar-me" aria-label="我的手牌">
          <div className="gh-liar-me-header">
            <span className="gh-liar-me-name">你</span>
            <span className="gh-liar-me-meta">{myStatus}</span>
            {myTurn && <span className="gh-liar-me-hint">选择 1–3 张盖牌出牌，或质疑上一手</span>}
          </div>
          <div className="gh-liar-hand">
            {myHand.length === 0 && <span className="gh-liar-pile-empty">本局手牌已出完</span>}
            {myHand.map((card) => (
              <LiarCardView
                key={card}
                card={card}
                selected={selected.has(card)}
                disabled={!myTurn}
                onClick={myTurn ? () => toggleCard(card) : undefined}
                title={`${liarCardKind(card) === 'JOKER' ? '鬼牌（万能）' : liarCardKind(card)}${
                  liarCardIsTruthy(card, table.target) ? ' · 真牌' : ' · 假牌'
                }`}
              />
            ))}
          </div>
          <p className="gh-liar-hand-tip">
            鬼牌万能；开牌只看被质疑的那一手。手牌 {myHand.length}/{LIAR_HAND_SIZE} 张。
          </p>
        </section>
      </div>

      <div className="gh-liar-bottom">
        <section className="gh-liar-log" aria-label="对局记录">
          <h2 className="gh-liar-log-title">对局记录</h2>
          <ul className="gh-liar-log-list">
            {recentLog.length === 0 && <li className="gh-liar-log-empty">还没有动作，先出牌吧。</li>}
            {recentLog.map((entry, index) => (
              <li key={`${entry.type}-${index}`} className={`gh-liar-log-item gh-liar-log-item--${entry.type}`}>
                {logText(table, entry)}
              </li>
            ))}
          </ul>
        </section>

        <section className="gh-liar-rules">
          <button type="button" className="gh-ddz-rules-toggle" onClick={() => setRulesOpen((prev) => !prev)}>
            {rulesOpen ? '收起玩法说明' : '玩法说明'}
          </button>
          {rulesOpen && (
            <ul className="gh-ddz-rules-list">
              <li>牌堆 20 张：K×6、Q×6、A×6、鬼牌×2；每局每人 5 张，系统随机宣布目标牌面（K/Q/A）。</li>
              <li>轮到你时盖着出 1–3 张（声称是目标牌面，实际可以是任意牌），或质疑上一手。</li>
              <li>质疑只翻开上一手：全是目标牌面 / 鬼牌则质疑者输，否则被打出者输。</li>
              <li>输家扣左轮扳机：子弹数 = 死亡人数 + 1（6 弹巢），中弹出局；无论生死都重洗重发。</li>
              <li>全员出完无人质疑为流局直接重发；最后存活者获胜。</li>
            </ul>
          )}
        </section>
      </div>

      {table.finished && (
        <div className="gh-liar-overlay" role="dialog" aria-modal="true" aria-label="本场结算">
          <div className="gh-liar-overlay-card">
            <p className="gh-liar-overlay-eyebrow">本场结束</p>
            <h2 className={`gh-liar-overlay-title${iWon ? ' gh-liar-overlay-title--win' : ''}`}>
              {iWon ? '你是最后的幸存者！' : table.winnerSeat === null ? '无人幸存' : `${seatName(table, table.winnerSeat)} 获胜`}
            </h2>
            <p className="gh-liar-overlay-detail">
              共进行 {table.round} 局，累计 {table.deaths} 人死亡，左轮子弹数 {bullets}/6。
            </p>
            <div className="gh-liar-overlay-actions">
              <button type="button" className="gh-btn gh-btn--primary gh-btn--lg" onClick={() => newGame()}>
                再来一场
              </button>
              <Link className="gh-btn gh-btn--secondary gh-btn--lg" to={GAME_LIAR_ONLINE_ROUTE}>
                好友联机
              </Link>
            </div>
          </div>
        </div>
      )}

      <p className="gh-games-footnote">
        规则引擎与好友联机完全一致；AI 的决策由 suggestLiarMove 启发式给出，也会虚张声势。
        当前目标牌面：{table.target}（鬼牌万能）。
      </p>
    </div>
  )
}
