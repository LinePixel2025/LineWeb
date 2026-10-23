import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import DoudizhuTable, { type DoudizhuSeatInfo } from '../../components/games/doudizhu/DoudizhuTable'
import {
  canDoudizhuBeat,
  dealDoudizhu,
  doudizhuComboLabel,
  generateDoudizhuMoves,
  parseDoudizhuCombo,
  sortDoudizhuCards,
  type DoudizhuCard,
  type DoudizhuCombo,
} from '../../lib/games/doudizhu'
import { aiDoudizhuBid, aiDoudizhuPlay } from '../../lib/games/doudizhuAi'
import { GAME_DOUDIZHU_ONLINE_ROUTE } from '../../lib/games/catalog'

/**
 * 斗地主单机：我（座位 0）+ 两个 AI（座位 1 下家 / 座位 2 上家）。
 * 规则引擎与联机共用（lib/games/doudizhu.ts），AI 为启发式（doudizhuAi.ts）。
 * 战绩（局数 / 胜场 / 累计积分）保存在 localStorage。
 */

const RECORD_KEY = 'lineweb_ddz_record'
const BASE_SCORE = 100
const SEAT_NAMES = ['我', '下家 AI', '上家 AI']
const AI_THINK_MS = 800

interface RecordData {
  games: number
  wins: number
  score: number
}

function readRecord(): RecordData {
  try {
    const raw = localStorage.getItem(RECORD_KEY)
    if (!raw) return { games: 0, wins: 0, score: 0 }
    const parsed = JSON.parse(raw) as Partial<RecordData>
    return {
      games: Number.isFinite(parsed.games) ? Number(parsed.games) : 0,
      wins: Number.isFinite(parsed.wins) ? Number(parsed.wins) : 0,
      score: Number.isFinite(parsed.score) ? Number(parsed.score) : 0,
    }
  } catch {
    return { games: 0, wins: 0, score: 0 }
  }
}

function writeRecord(record: RecordData): void {
  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify(record))
  } catch {
    // localStorage 不可用时仅影响战绩持久化
  }
}

type Phase = 'bidding' | 'playing' | 'finished'

interface TrickEntry {
  seat: number
  action: 'pass' | 'play'
  cards: DoudizhuCard[]
  combo: DoudizhuCombo | null
}

interface GameState {
  phase: Phase
  hands: DoudizhuCard[][]
  bottom: DoudizhuCard[]
  roles: Array<'landlord' | 'farmer' | null>
  /** 叫分 */
  bidRound: number
  bidTurn: number
  bidFirstSeat: number
  bids: Array<{ seat: number; bid: number }>
  highestBid: number
  highestSeat: number | null
  /** 出牌 */
  turnSeat: number
  lastMove: { seat: number; cards: DoudizhuCard[]; combo: DoudizhuCombo } | null
  passCount: number
  trick: TrickEntry[]
  lastTrick: TrickEntry[]
  playedCount: number[]
  multiplier: number
  winnerSide: 'landlord' | 'farmers' | null
  scoreDeltas: number[] | null
  redealNotice: string | null
}

function createInitialState(randomFirst: boolean): GameState {
  const { hands, bottom } = dealDoudizhu(() => Math.random())
  return {
    phase: 'bidding',
    hands,
    bottom,
    roles: [null, null, null],
    bidRound: 1,
    bidTurn: randomFirst ? Math.floor(Math.random() * 3) : 0,
    bidFirstSeat: 0,
    bids: [],
    highestBid: 0,
    highestSeat: null,
    turnSeat: 0,
    lastMove: null,
    passCount: 0,
    trick: [],
    lastTrick: [],
    playedCount: [0, 0, 0],
    multiplier: 1,
    winnerSide: null,
    scoreDeltas: null,
    redealNotice: null,
  }
}

/** 叫分后的落定：地主拿底牌、进入出牌 */
function settleLandlord(state: GameState, seat: number): GameState {
  const hands = state.hands.map((hand) => hand.slice())
  hands[seat] = sortDoudizhuCards([...hands[seat], ...state.bottom])
  const roles: Array<'landlord' | 'farmer'> = [0, 1, 2].map((index) =>
    index === seat ? 'landlord' : 'farmer'
  )
  return {
    ...state,
    hands,
    roles,
    phase: 'playing',
    turnSeat: seat,
    lastMove: null,
    passCount: 0,
    trick: [],
    lastTrick: [],
    multiplier: 1,
    winnerSide: null,
    scoreDeltas: null,
  }
}

function applyBid(state: GameState, seat: number, bid: number): GameState {
  if (state.phase !== 'bidding' || state.bidTurn !== seat) return state
  const bids = [...state.bids, { seat, bid }]
  let next: GameState = { ...state, bids }
  if (bid > state.highestBid) next = { ...next, highestBid: bid, highestSeat: seat }

  if (bid === 3) return settleLandlord(next, seat)

  if (bids.length >= 3) {
    if (next.highestBid === 0) {
      // 无人叫地主：重新发牌
      const redeal = createInitialState(false)
      return {
        ...redeal,
        bidRound: state.bidRound + 1,
        redealNotice: `第 ${state.bidRound} 轮无人叫地主，重新发牌`,
      }
    }
    return settleLandlord(next, next.highestSeat ?? seat)
  }

  return { ...next, bidTurn: (seat + 1) % 3 }
}

function applyPlay(state: GameState, seat: number, cards: DoudizhuCard[]): GameState {
  if (state.phase !== 'playing' || state.turnSeat !== seat) return state
  const combo = parseDoudizhuCombo(cards)
  if (!combo) return state
  if (state.lastMove !== null && !canDoudizhuBeat(combo, state.lastMove.combo)) return state

  const ids = new Set(cards.map((card) => card.id))
  const hands = state.hands.map((hand, index) =>
    index === seat ? hand.filter((card) => !ids.has(card.id)) : hand
  )
  const playedCount = state.playedCount.map((count, index) => (index === seat ? count + 1 : count))
  const multiplier = combo.type === 'bomb' || combo.type === 'rocket' ? state.multiplier * 2 : state.multiplier
  const playedCards = cards.map((card) => ({ ...card }))
  const trick: TrickEntry[] = [
    ...state.trick,
    { seat, action: 'play', cards: playedCards, combo },
  ]

  if (hands[seat].length === 0) {
    return finishGame(
      { ...state, hands, playedCount, multiplier, trick },
      seat
    )
  }

  return {
    ...state,
    hands,
    playedCount,
    multiplier,
    trick,
    lastMove: { seat, cards: playedCards, combo },
    passCount: 0,
    turnSeat: (seat + 1) % 3,
  }
}

function applyPass(state: GameState, seat: number): GameState {
  if (state.phase !== 'playing' || state.turnSeat !== seat || state.lastMove === null) return state
  const trick: TrickEntry[] = [...state.trick, { seat, action: 'pass', cards: [], combo: null }]

  if (state.passCount + 1 >= 2 && state.lastMove) {
    // 两家不要 → 上一手玩家重新领出
    return {
      ...state,
      lastTrick: trick,
      trick: [],
      lastMove: null,
      passCount: 0,
      turnSeat: state.lastMove.seat,
    }
  }
  return { ...state, trick, passCount: state.passCount + 1, turnSeat: (seat + 1) % 3 }
}

function finishGame(state: GameState, winnerSeat: number): GameState {
  const winnerSide: 'landlord' | 'farmers' = state.roles[winnerSeat] === 'landlord' ? 'landlord' : 'farmers'
  let multiplier = state.multiplier
  const farmers = [0, 1, 2].filter((seat) => state.roles[seat] === 'farmer')
  const landlordSeat = [0, 1, 2].find((seat) => state.roles[seat] === 'landlord') ?? -1
  if (winnerSide === 'landlord' && farmers.every((seat) => state.playedCount[seat] === 0)) {
    multiplier *= 2 // 春天
  } else if (winnerSide === 'farmers' && landlordSeat >= 0 && state.playedCount[landlordSeat] === 1) {
    multiplier *= 2 // 反春
  }
  const unit = BASE_SCORE * multiplier
  const scoreDeltas = [0, 1, 2].map((seat) => {
    const isLandlord = state.roles[seat] === 'landlord'
    const won = isLandlord === (winnerSide === 'landlord')
    return won ? (isLandlord ? 2 * unit : unit) : (isLandlord ? -2 * unit : -unit)
  })
  return { ...state, phase: 'finished', multiplier, winnerSide, scoreDeltas, lastTrick: state.trick, trick: [] }
}

/** 每个座位在桌面上最近一次动作（当前轮 + 上一轮） */
function latestActionPerSeat(state: GameState): Array<TrickEntry | null> {
  const merged = [...state.lastTrick, ...state.trick]
  const latest: Array<TrickEntry | null> = [null, null, null]
  for (const entry of merged) {
    latest[entry.seat] = entry
  }
  return latest
}

/** TrickEntry → 牌桌组件的动作表示 */
function toSeatAction(entry: TrickEntry | null): DoudizhuSeatInfo['lastAction'] {
  if (!entry) return null
  if (entry.action === 'pass') return 'pass'
  return { cards: entry.cards }
}

export default function DoudizhuPage() {
  const [state, setState] = useState<GameState>(() => createInitialState(true))
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [record, setRecord] = useState<RecordData>(() => readRecord())
  const [error, setError] = useState<string | null>(null)
  const [hintIndex, setHintIndex] = useState(0)
  const [rulesOpen, setRulesOpen] = useState(false)
  const timersRef = useRef<number[]>([])
  const stateRef = useRef(state)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) window.clearTimeout(timer)
    timersRef.current = []
  }, [])

  useEffect(() => () => clearTimers(), [clearTimers])

  const schedule = useCallback((fn: () => void, ms: number) => {
    const timer = window.setTimeout(fn, ms)
    timersRef.current.push(timer)
  }, [])

  const newGame = useCallback(() => {
    clearTimers()
    setSelectedIds(new Set())
    setError(null)
    setHintIndex(0)
    setState(createInitialState(true))
  }, [clearTimers])

  // 结算后累计战绩
  useEffect(() => {
    if (state.phase !== 'finished' || state.scoreDeltas === null) return
    setRecord((prev) => {
      const delta = state.scoreDeltas?.[0] ?? 0
      const next: RecordData = {
        games: prev.games + 1,
        wins: prev.wins + (delta > 0 ? 1 : 0),
        score: prev.score + delta,
      }
      writeRecord(next)
      return next
    })
  }, [state.phase, state.scoreDeltas])

  // AI 应叫
  useEffect(() => {
    if (state.phase !== 'bidding' || state.bidTurn === 0) return
    const seat = state.bidTurn
    schedule(() => {
      const current = stateRef.current
      if (current.phase !== 'bidding' || current.bidTurn !== seat) return
      const bid = aiDoudizhuBid(current.hands[seat], current.highestBid)
      setState((prev) => applyBid(prev, seat, bid))
    }, AI_THINK_MS)
    return clearTimers
  }, [state.phase, state.bidTurn, state.bids.length, schedule, clearTimers])

  // AI 出牌
  useEffect(() => {
    if (state.phase !== 'playing' || state.turnSeat === 0) return
    const seat = state.turnSeat
    schedule(() => {
      const current = stateRef.current
      if (current.phase !== 'playing' || current.turnSeat !== seat) return
      const role = current.roles[seat]
      const move = aiDoudizhuPlay({
        myRole: role ?? 'farmer',
        hand: current.hands[seat],
        lastCombo: current.lastMove?.combo ?? null,
        lastPlayedBy: current.lastMove
          ? current.roles[current.lastMove.seat] === role
            ? 'teammate'
            : 'landlord'
          : null,
        landlordCards: current.hands[[0, 1, 2].find((s) => current.roles[s] === 'landlord') ?? 0].length,
        nextCards: current.hands[(seat + 1) % 3].length,
      })
      setState((prev) => {
        if (move) return applyPlay(prev, seat, move.cards)
        return applyPass(prev, seat)
      })
    }, AI_THINK_MS)
    return clearTimers
  }, [state.phase, state.turnSeat, state.lastMove, schedule, clearTimers])

  // === 我的操作 ===

  const lastBidOf = useCallback((seat: number): number | null => {
    const entry = state.bids.filter((b) => b.seat === seat).slice(-1)[0]
    return entry ? entry.bid : null
  }, [state.bids])

  const handleBid = useCallback((bid: number) => {
    setError(null)
    setState((prev) => {
      const next = applyBid(prev, 0, bid)
      if (next === prev) {
        setError('还没轮到你叫分')
        return prev
      }
      return next
    })
  }, [])

  const toggleCard = useCallback((card: DoudizhuCard) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(card.id)) next.delete(card.id)
      else next.add(card.id)
      return next
    })
    setError(null)
  }, [])

  const selectedCards = useMemo(
    () => sortDoudizhuCards(state.hands[0].filter((card) => selectedIds.has(card.id))),
    [state.hands, selectedIds]
  )

  const myTurn = state.phase === 'playing' && state.turnSeat === 0
  const myBidTurn = state.phase === 'bidding' && state.bidTurn === 0
  const leading = state.lastMove === null
  const selectedCombo = selectedCards.length > 0 ? parseDoudizhuCombo(selectedCards) : null
  const canPlaySelected =
    myTurn && selectedCombo !== null && (leading || canDoudizhuBeat(selectedCombo, state.lastMove!.combo))

  const handlePlay = useCallback(() => {
    if (selectedCombo === null) {
      setError('所选牌不是合法牌型')
      return
    }
    if (!leading && !canDoudizhuBeat(selectedCombo, state.lastMove!.combo)) {
      setError('压不住上一手牌')
      return
    }
    setState((prev) => applyPlay(prev, 0, selectedCards))
    setSelectedIds(new Set())
    setError(null)
    setHintIndex(0)
  }, [selectedCombo, leading, selectedCards])

  const handlePass = useCallback(() => {
    if (!myTurn) return
    if (leading) {
      setError('新一轮出牌必须出牌')
      return
    }
    setState((prev) => applyPass(prev, 0))
    setSelectedIds(new Set())
    setError(null)
    setHintIndex(0)
  }, [myTurn, leading])

  // === 提示（循环可用出牌） ===

  const hints = useMemo(() => {
    if (state.phase !== 'playing' || state.turnSeat !== 0) return []
    return generateDoudizhuMoves(state.hands[0], state.lastMove?.combo ?? null)
  }, [state.phase, state.turnSeat, state.hands, state.lastMove])

  const handleHint = useCallback(() => {
    if (hints.length === 0) return
    const move = hints[hintIndex % hints.length]
    setHintIndex((prev) => prev + 1)
    setSelectedIds(new Set(move.cards.map((card) => card.id)))
    setError(null)
  }, [hints, hintIndex])

  // === 牌桌视图数据 ===

  const latestActions = latestActionPerSeat(state)
  const myRole = state.roles[0]
  const myScoreDelta = state.scoreDeltas?.[0] ?? null
  const iWon = state.winnerSide !== null && myRole !== null && (myRole === 'landlord') === (state.winnerSide === 'landlord')

  const seatInfo = (seat: number): DoudizhuSeatInfo => ({
    name: SEAT_NAMES[seat],
    role: state.roles[seat],
    cardCount: state.hands[seat].length,
    isTurn:
      (state.phase === 'playing' && state.turnSeat === seat)
      || (state.phase === 'bidding' && state.bidTurn === seat),
    bid: lastBidOf(seat),
    lastAction: toSeatAction(latestActions[seat]),
  })

  const centerHint = (() => {
    if (state.phase === 'bidding') {
      return myBidTurn
        ? '轮到你叫分：牌越强叫得越高（底分 100 × 倍率结算）'
        : `${SEAT_NAMES[state.bidTurn]} 正在考虑叫分…`
    }
    if (state.phase === 'playing') {
      if (state.turnSeat === 0) {
        return leading ? '轮到你出牌（新一轮）' : `压住 ${SEAT_NAMES[state.lastMove!.seat]} 的${doudizhuComboLabel(state.lastMove!.combo)}`
      }
      return `${SEAT_NAMES[state.turnSeat]} 思考中…`
    }
    return `${state.winnerSide === 'landlord' ? '地主' : '农民'}获胜${state.multiplier > 1 ? `（倍率 ×${state.multiplier}）` : ''}`
  })()

  const actions = (() => {
    if (myBidTurn) {
      return (
        <>
          <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={() => handleBid(0)}>
            不叫
          </button>
          {[1, 2, 3].map((bid) => (
            <button
              key={bid}
              type="button"
              className="gh-btn gh-btn--primary gh-btn--md"
              disabled={bid <= state.highestBid}
              onClick={() => handleBid(bid)}
            >
              {bid} 分
            </button>
          ))}
        </>
      )
    }
    if (myTurn) {
      return (
        <>
          <button
            type="button"
            className="gh-btn gh-btn--secondary gh-btn--md"
            disabled={hints.length === 0}
            onClick={handleHint}
          >
            提示
          </button>
          <button
            type="button"
            className="gh-btn gh-btn--secondary gh-btn--md"
            disabled={leading}
            onClick={handlePass}
          >
            不出
          </button>
          <button
            type="button"
            className="gh-btn gh-btn--primary gh-btn--md gh-ddz-play-btn"
            disabled={!canPlaySelected}
            onClick={handlePlay}
          >
            出牌
          </button>
        </>
      )
    }
    return null
  })()

  const overlay = state.phase === 'finished' && state.scoreDeltas ? (
    <div className="gh-ddz-overlay" role="dialog" aria-modal="true" aria-label="本局结果">
      <div className="gh-ddz-overlay-card">
        <h2 className={`gh-ddz-overlay-title${iWon ? ' gh-ddz-overlay-title--win' : ' gh-ddz-overlay-title--lose'}`}>
          {iWon ? '恭喜获胜！' : '本局告负'}
        </h2>
        <p className="gh-ddz-overlay-detail">
          {state.winnerSide === 'landlord' ? '地主' : '农民'}获胜 · 倍率 ×{state.multiplier}
        </p>
        <div className="gh-ddz-scores">
          {[0, 1, 2].map((seat) => (
            <span key={seat} className="gh-ddz-score">
              <span className="gh-ddz-score-name">{SEAT_NAMES[seat]}</span>
              <span className={`gh-ddz-score-value${(state.scoreDeltas ?? [])[seat] >= 0 ? ' gh-ddz-score-value--up' : ' gh-ddz-score-value--down'}`}>
                {(state.scoreDeltas ?? [])[seat] >= 0 ? '+' : ''}
                {(state.scoreDeltas ?? [])[seat]}
              </span>
            </span>
          ))}
        </div>
        <div className="gh-ddz-overlay-actions">
          <button type="button" className="gh-btn gh-btn--primary gh-btn--lg" onClick={newGame}>
            再来一局
          </button>
          <Link className="gh-btn gh-btn--secondary gh-btn--lg" to="/games">
            返回大厅
          </Link>
        </div>
        {myScoreDelta !== null && (
          <p className="gh-ddz-overlay-detail">
            你的积分变化：{myScoreDelta >= 0 ? '+' : ''}{myScoreDelta}
          </p>
        )}
      </div>
    </div>
  ) : null

  return (
    <div className="gh-ddz-game">
      <header className="gh-ddz-gamebar">
        <Link to="/games" className="gh-ddz-gamebar-back">← 游戏大厅</Link>
        <span className="gh-ddz-gamebar-title">斗地主 · 单机</span>
        <div className="gh-ddz-gamebar-actions">
          <span className="gh-ddz-gamebar-chip" title="本机战绩">
            {record.wins}胜 / {record.games}局 · 积分 {record.score >= 0 ? `+${record.score}` : record.score}
          </span>
          <Link className="gh-btn gh-btn--secondary gh-btn--sm" to={GAME_DOUDIZHU_ONLINE_ROUTE}>
            好友联机
          </Link>
          <button type="button" className="gh-btn gh-btn--primary gh-btn--sm" onClick={newGame}>
            重新开局
          </button>
        </div>
      </header>

      {state.redealNotice && (
        <div className="gh-ddz-notice" role="status">{state.redealNotice}</div>
      )}
      {error && <div className="gh-ddz-notice gh-ddz-notice--error" role="alert">{error}</div>}

      <DoudizhuTable
        phase={state.phase}
        leftSeat={seatInfo(2)}
        rightSeat={seatInfo(1)}
        me={{
          name: '我',
          role: myRole,
          bid: lastBidOf(0),
          isTurn: myBidTurn || myTurn,
          hand: state.hands[0],
          lastAction: toSeatAction(latestActions[0]),
        }}
        bottomCards={state.bottom}
        multiplier={state.multiplier}
        centerHint={centerHint}
        selectedIds={selectedIds}
        onToggleCard={myTurn ? toggleCard : undefined}
        handDisabled={!myTurn}
        actions={actions}
        overlay={overlay}
      />

      <div className="gh-ddz-rules">
        <button type="button" className="gh-ddz-rules-toggle" onClick={() => setRulesOpen((prev) => !prev)}>
          {rulesOpen ? '收起玩法说明' : '玩法说明'}
        </button>
        {rulesOpen && (
          <ul className="gh-ddz-rules-list">
            <li>54 张牌，每人 17 张，3 张底牌归地主；叫分最高者当地主（3 分立即成交）。</li>
            <li>单张 / 对子 / 三带 / 顺子 / 连对 / 飞机 / 四带二；炸弹与王炸压任意牌型并让倍率 ×2。</li>
            <li>两家连续不出即开启新一轮出牌；先出完的一方获胜。</li>
            <li>春天（农民整局未出牌）与反春（地主只出过一手）倍率 ×2。</li>
            <li>积分 = 底分 100 × 倍率；地主赢 +2 份、输 −2 份。战绩保存在本机。</li>
          </ul>
        )}
      </div>
    </div>
  )
}
