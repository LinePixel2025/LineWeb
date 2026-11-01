import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  LiarActionBar,
  LiarHand,
  LiarInfoPanel,
  LiarPileLane,
  LiarRevealBanner,
  LiarRoundBar,
  LiarSeat,
  LiarTurnBanner,
} from '../../components/games/liar/LiarTableParts'
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
  const recordedRef = useRef(false)

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
  const recentLog = table.log.slice(-10).map((entry) => logText(table, entry)).reverse()
  const opponents = table.players.filter((player) => player.seat !== 0)
  const me = table.players[0]
  const turnName = table.finished
    ? '本场结束'
    : table.turnSeat === null
      ? '等待中'
      : table.turnSeat === 0
        ? '你'
        : `${seatName(table, table.turnSeat)} 思考中…`
  const turnHint = table.finished
    ? '本场已结束，点「再来一场」重新开始。'
    : myTurn
      ? (top && top.seat !== 0
        ? `出 1–3 张盖牌，或质疑 ${seatName(table, top.seat)} 的 ${top.count} 张。`
        : '先出 1–3 张盖牌；下一家可以质疑你。')
      : '等待对手出牌；他们质疑或出牌后会自动轮到你。'
  const challengeLabel = canChallenge && top
    ? `开牌：全真 → 你扣扳机；有假 → ${seatName(table, top.seat)} 扣扳机`
    : top === null
      ? '牌堆为空，暂无可质疑目标'
      : top.seat === 0
        ? '不能质疑自己的出牌'
        : '还没轮到你'
  const actionHint = myTurn
    ? `目标 ${table.target ?? '—'}：真牌 / 鬼牌可直接出；假牌也能盖着出，赌对手不质疑。`
    : '等待对手行动，轮到你时按钮会亮起。'
  const lastReveal = table.lastReveal

  return (
    <div className="gh-page-container gh-games-page gh-l2-page">
      <header className="gh-l2-page-head">
        <div className="gh-l2-page-copy">
          <p className="gh-g2048-eyebrow"><Link to="/games">← 游戏大厅</Link></p>
          <h1 className="gh-games-title">骗子酒馆 · 单机</h1>
          <p className="gh-games-subtitle">
            盖着出牌、互相质疑：每局随机一个目标牌面，质疑只翻开上一手，输家扣左轮扳机。
          </p>
        </div>
        <div className="gh-l2-page-actions">
          <Link className="gh-btn gh-btn--secondary gh-btn--md" to={GAME_LIAR_ONLINE_ROUTE}>好友联机</Link>
          <button type="button" className="gh-btn gh-btn--primary gh-btn--md" onClick={() => newGame()}>
            重新开局
          </button>
        </div>
      </header>

      <div className="gh-l2-toolbar">
        <div className="gh-l2-toolbar-group" role="group" aria-label="人数选择">
          <span className="gh-l2-toolbar-label">人数</span>
          {[2, 3, 4].map((count) => (
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
          <span className="gh-l2-toolbar-note">联机 {LIAR_MIN_PLAYERS}–{LIAR_MAX_PLAYERS} 人</span>
        </div>
        <span className="gh-l2-toolbar-record">
          账号战绩 <strong>{stat?.games ?? 0}</strong> 局 · <strong>{stat?.wins ?? 0}</strong> 胜 · 中弹{' '}
          <strong>{stat?.deaths ?? 0}</strong> 次
        </span>
      </div>

      {error && <div className="gh-alert gh-alert--danger gh-game-alert" role="alert">{error}</div>}

      <div className="gh-l2-layout">
        <div className="gh-l2-main">
          <div className="gh-l2-seats" aria-label="座位">
            {opponents.map((player) => (
              <LiarSeat
                key={player.seat}
                name={`AI ${player.seat}`}
                handCount={player.hand.length}
                isTurn={!table.finished && table.turnSeat === player.seat}
                alive={player.alive}
                avatar={<span className="gh-l2-seat-robot">AI</span>}
              />
            ))}
            {me && (
              <LiarSeat
                name="你"
                handCount={me.hand.length}
                isTurn={myTurn}
                isMe
                alive={me.alive}
                avatar={<span className="gh-l2-seat-robot gh-l2-seat-robot--user" />}
              />
            )}
          </div>

          <div className="gh-l2-table">
            <LiarRoundBar round={table.round} target={table.target} bullets={bullets} />

            <LiarTurnBanner
              isMyTurn={myTurn}
              turnName={turnName}
              hint={turnHint}
              countdown={null}
            />

            <LiarPileLane
              items={table.pile.map((entry, index) => ({
                key: `${entry.seat}-${index}`,
                name: seatName(table, entry.seat),
                count: entry.count,
              }))}
            />

            {lastReveal && (
              <LiarRevealBanner
                cards={lastReveal.cards}
                truthful={lastReveal.truthful}
                title={`${seatName(table, lastReveal.seat)} 的第 ${lastReveal.round} 局出牌`}
                verdict={lastReveal.truthful ? '全是真牌 —— 质疑者扣扳机' : '掺了假牌 —— 被打出者扣扳机'}
              />
            )}

            <LiarHand
              hand={myHand}
              target={table.target}
              selected={selected}
              canSelect={myTurn}
              onToggle={toggleCard}
            />

            <LiarActionBar
              myTurn={myTurn}
              selectedCount={selectedCards.length}
              canPlay={canPlay}
              canChallenge={canChallenge}
              challengeLabel={challengeLabel}
              onPlay={handlePlay}
              onChallenge={handleChallenge}
              actionPending={false}
              hint={actionHint}
            />
          </div>

          <p className="gh-l2-footnote">
            鬼牌万能；开牌只看被质疑的那一手。手牌 {myHand.length}/{LIAR_HAND_SIZE} 张 · 当前目标 {table.target ?? '—'}
          </p>
        </div>

        <LiarInfoPanel
          turnHint={turnHint}
          logLines={recentLog}
          rules={[
            '牌堆 20 张：K×6、Q×6、A×6、鬼牌×2；每局每人 5 张，系统随机宣布目标牌面。',
            '轮到你时盖着出 1–3 张（声称是目标牌面，实际可以任意），或质疑上一手。',
            '质疑只翻开上一手：全是目标牌面 / 鬼牌则质疑者输，否则被打出者输。',
            '输家扣左轮：子弹数 = 死亡人数 + 1（6 弹巢），中弹出局；无论生死都重洗重发。',
            '全员出完无人质疑为流局直接重发；最后存活者获胜。',
          ]}
        />
      </div>

      {table.finished && (
        <div className="gh-l2-modal" role="dialog" aria-modal="true" aria-label="本场结算">
          <div className="gh-l2-result-card">
            <p className="gh-l2-result-kicker">本场结束</p>
            <h2 className={`gh-l2-result-title${iWon ? ' gh-l2-result-title--win' : ''}`}>
              {iWon ? '你是最后的幸存者！' : table.winnerSeat === null ? '无人幸存' : `${seatName(table, table.winnerSeat)} 获胜`}
            </h2>
            <p className="gh-l2-result-detail">
              共进行 {table.round} 局，累计 {table.deaths} 人死亡，左轮子弹数 {bullets}/6。
            </p>
            <div className="gh-l2-result-actions">
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
      </p>
    </div>
  )
}

