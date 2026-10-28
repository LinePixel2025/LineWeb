import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import XiangqiBoardView, { xiangqiPieceChar } from '../../components/games/xiangqi/XiangqiBoardView'
import { GAME_XIANGQI_ONLINE_ROUTE } from '../../lib/games/catalog'
import { useGameStats } from '../../contexts/GameStatsContext'
import {
  XIANGQI_BLACK,
  XIANGQI_RED,
  createXiangqiBoard,
  evaluateXiangqiStatus,
  findXiangqiGeneral,
  generateLegalXiangqiMoves,
  isXiangqiMoveLegal,
  makeXiangqiMove,
  suggestXiangqiMove,
  xiangqiLegalMovesFrom,
  xiangqiPoint,
  xiangqiSideOf,
  type XiangqiSide,
} from '../../lib/games/xiangqi'

const AI_THINK_MS = 450
type Difficulty = 'easy' | 'normal' | 'hard'
const DEPTHS: Record<Difficulty, number> = { easy: 1, normal: 2, hard: 3 }

interface MoveRecord {
  from: number
  to: number
  captured: number
  auto: boolean
}

interface GameState {
  board: number[]
  turn: XiangqiSide
  playing: boolean
  winner: XiangqiSide | null
  reason: 'checkmate' | 'stalemate' | null
  lastMove: MoveRecord | null
  checkedSide: XiangqiSide | null
}

function newGame(): GameState {
  return {
    board: createXiangqiBoard(),
    turn: XIANGQI_RED,
    playing: true,
    winner: null,
    reason: null,
    lastMove: null,
    checkedSide: null,
  }
}

function applyMove(state: GameState, from: number, to: number, auto: boolean): GameState {
  const board = [...state.board]
  const captured = makeXiangqiMove(board, from, to)
  if (captured === null) return state
  const nextSide: XiangqiSide = state.turn === XIANGQI_RED ? XIANGQI_BLACK : XIANGQI_RED
  const status = evaluateXiangqiStatus(board, nextSide)
  return {
    board,
    turn: nextSide,
    playing: !status.finished,
    winner: status.winner,
    reason: status.reason,
    lastMove: { from, to, captured, auto },
    checkedSide: status.finished ? null : status.checked ? nextSide : null,
  }
}

function coordText(index: number): string {
  const { x, y } = xiangqiPoint(index)
  return `${'ABCDEFGHI'[x] ?? '?'}${10 - y}`
}

const REASON_TEXT: Record<'checkmate' | 'stalemate', string> = {
  checkmate: '绝杀：对方被将军且没有合法着法',
  stalemate: '困毙：对方无合法着法，按象棋规则判负',
}

export default function XiangqiPage() {
  const [playerSide, setPlayerSide] = useState<XiangqiSide>(XIANGQI_RED)
  const [difficulty, setDifficulty] = useState<Difficulty>('normal')
  const [state, setState] = useState<GameState>(newGame)
  const [selected, setSelected] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { getStat, recordResult } = useGameStats()
  const stat = getStat('xiangqi', 'solo')
  const [rulesOpen, setRulesOpen] = useState(false)
  const stateRef = useRef(state)
  const recordedRef = useRef(false)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const aiSide: XiangqiSide = playerSide === XIANGQI_RED ? XIANGQI_BLACK : XIANGQI_RED
  const myTurn = state.playing && state.turn === playerSide

  // 结算统计（每局只记一次）
  useEffect(() => {
    if (state.playing || recordedRef.current) return
    recordedRef.current = true
    recordResult({
      game: 'xiangqi',
      variant: 'solo',
      outcome: state.winner === playerSide ? 'win' : state.winner === null ? 'draw' : 'loss',
    })
  }, [state.playing, state.winner, playerSide, recordResult])

  const restart = useCallback((side?: XiangqiSide) => {
    recordedRef.current = false
    setError(null)
    setSelected(null)
    if (side) setPlayerSide(side)
    setState(newGame())
  }, [])

  // AI 回合：延迟搜索一手
  useEffect(() => {
    if (!state.playing || state.turn !== aiSide) return undefined
    const timer = window.setTimeout(() => {
      const current = stateRef.current
      if (!current.playing || current.turn !== aiSide) return
      const status = evaluateXiangqiStatus(current.board, aiSide)
      if (status.finished) {
        setState((prev) => ({
          ...prev,
          playing: false,
          winner: status.winner,
          reason: status.reason,
          checkedSide: null,
        }))
        return
      }
      const move = suggestXiangqiMove(current.board, aiSide, { depth: DEPTHS[difficulty] })
      if (!move) return
      // 兜底：AI 的着法必须过一遍规则校验，绝不允许出现「乱吃」（引擎回归时退回首个合法着法）
      const safeMove = isXiangqiMoveLegal(current.board, move.from, move.to, aiSide)
        ? move
        : generateLegalXiangqiMoves(current.board, aiSide)[0]
      if (!safeMove) return
      setState((prev) => applyMove(prev, safeMove.from, safeMove.to, true))
    }, AI_THINK_MS)
    return () => window.clearTimeout(timer)
  }, [state.playing, state.turn, aiSide, difficulty, state.board])

  const legalTargets = useMemo(() => {
    if (!myTurn || selected === null) return []
    if (xiangqiSideOf(state.board[selected]) !== playerSide) return []
    return xiangqiLegalMovesFrom(state.board, selected)
  }, [myTurn, selected, state.board, playerSide])

  const handleSelect = (index: number) => {
    if (!state.playing) return
    if (!myTurn) {
      setError('还没轮到你走子')
      return
    }
    const piece = state.board[index]
    if (selected !== null && legalTargets.includes(index)) {
      setState((prev) => applyMove(prev, selected, index, false))
      setSelected(null)
      setError(null)
      return
    }
    if (xiangqiSideOf(piece) === playerSide) {
      setSelected(index === selected ? null : index)
      setError(null)
      return
    }
    if (selected === null) {
      setError('先选择自己的棋子')
    } else if (piece !== 0) {
      setError('不能吃自己的棋子')
    } else {
      setError('这一步不合法（可能送将或不符合走子规则）')
    }
  }

  const checkedGeneral = state.checkedSide === null
    ? null
    : (() => {
        const index = findXiangqiGeneral(state.board, state.checkedSide)
        return index >= 0 ? index : null
      })()

  const statusText = (() => {
    if (!state.playing) {
      if (state.winner === null) return '本局结束'
      return state.winner === playerSide ? '你赢了！' : 'AI 获胜'
    }
    if (state.checkedSide === playerSide) return '你被将军了，必须先应将'
    if (state.checkedSide === aiSide) return 'AI 被将军'
    return myTurn ? '轮到你走子' : 'AI 思考中…'
  })()

  const lastMoveText = state.lastMove
    ? `${state.lastMove.auto ? 'AI' : '你'} ${coordText(state.lastMove.from)} → ${coordText(state.lastMove.to)}${
        state.lastMove.captured !== 0 ? `（吃 ${xiangqiPieceChar(state.lastMove.captured)}）` : ''
      }`
    : '开局：红方先行'

  return (
    <div className="gh-page-container gh-games-page gh-xq-page">
      <header className="gh-games-header">
        <div className="gh-games-header-copy">
          <p className="gh-g2048-eyebrow"><Link to="/games">← 游戏大厅</Link></p>
          <h1 className="gh-games-title">中国象棋 · 人机对战</h1>
          <p className="gh-games-subtitle">
            9×10 标准棋盘：车马炮兵士象全规则，将军 / 绝杀 / 困毙由引擎判定；AI 使用 alpha-beta 搜索。
          </p>
        </div>
        <div className="gh-xq-header-actions">
          <Link className="gh-btn gh-btn--secondary gh-btn--md" to={GAME_XIANGQI_ONLINE_ROUTE}>好友联机</Link>
        </div>
      </header>

      <div className="gh-xq-toolbar">
        <div className="gh-xq-toolbar-group" role="group" aria-label="执子选择">
          <span className="gh-xq-toolbar-label">执子</span>
          <button
            type="button"
            className={`gh-btn gh-btn--sm ${playerSide === XIANGQI_RED ? 'gh-btn--primary' : 'gh-btn--secondary'}`}
            onClick={() => restart(XIANGQI_RED)}
            disabled={state.playing && state.lastMove !== null}
          >
            红方先行
          </button>
          <button
            type="button"
            className={`gh-btn gh-btn--sm ${playerSide === XIANGQI_BLACK ? 'gh-btn--primary' : 'gh-btn--secondary'}`}
            onClick={() => restart(XIANGQI_BLACK)}
            disabled={state.playing && state.lastMove !== null}
          >
            黑方后行
          </button>
        </div>
        <div className="gh-xq-toolbar-group" role="group" aria-label="难度选择">
          <span className="gh-xq-toolbar-label">难度</span>
          {(['easy', 'normal', 'hard'] as Difficulty[]).map((level) => (
            <button
              key={level}
              type="button"
              className={`gh-btn gh-btn--sm ${difficulty === level ? 'gh-btn--primary' : 'gh-btn--secondary'}`}
              onClick={() => setDifficulty(level)}
            >
              {level === 'easy' ? '简单' : level === 'normal' ? '普通' : '困难'}
            </button>
          ))}
        </div>
        <div className="gh-xq-toolbar-group">
          <button type="button" className="gh-btn gh-btn--primary gh-btn--sm" onClick={() => restart()}>
            重新开局
          </button>
        </div>
      </div>

      {error && <div className="gh-alert gh-alert--danger gh-game-alert" role="alert">{error}</div>}

      <div className="gh-xq-layout">
        <div className="gh-xq-main">
          <p className={`gh-xq-status${state.checkedSide !== null ? ' gh-xq-status--check' : ''}`} role="status">
            {statusText}
          </p>
          <XiangqiBoardView
            board={state.board}
            perspective={playerSide}
            selected={selected}
            legalTargets={legalTargets}
            lastMove={state.lastMove}
            checkGeneral={checkedGeneral}
            disabled={!myTurn}
            onSelect={handleSelect}
          />
          <p className="gh-xq-last-move">最近一步：{lastMoveText}</p>
        </div>

        <aside className="gh-xq-side" aria-label="对局信息">
          <section className="gh-xq-info-card">
            <h2 className="gh-xq-info-title">对局</h2>
            <p className="gh-xq-info-line">你执 <strong>{playerSide === XIANGQI_RED ? '红' : '黑'}</strong>，
              AI 执 <strong>{aiSide === XIANGQI_RED ? '红' : '黑'}</strong>
            </p>
            <p className="gh-xq-info-line">AI 难度：<strong>{difficulty === 'easy' ? '简单（1 层）' : difficulty === 'normal' ? '普通（2 层）' : '困难（3 层）'}</strong></p>
            <p className="gh-xq-info-line">当前状态：<strong>{state.playing ? (myTurn ? '你的回合' : 'AI 回合') : '已结束'}</strong></p>
          </section>

          <section className="gh-xq-info-card">
            <h2 className="gh-xq-info-title">账号战绩</h2>
            <p className="gh-xq-info-line">共 {stat?.games ?? 0} 局 · {stat?.wins ?? 0} 胜 · {stat?.losses ?? 0} 负 · {stat?.draws ?? 0} 和</p>
            <p className="gh-xq-info-line">胜率：{(stat?.games ?? 0) > 0 ? Math.round(((stat?.wins ?? 0) / (stat?.games ?? 1)) * 100) : 0}%</p>
          </section>

          <section className="gh-xq-info-card">
            <button type="button" className="gh-ddz-rules-toggle" onClick={() => setRulesOpen((prev) => !prev)}>
              {rulesOpen ? '收起玩法说明' : '玩法说明'}
            </button>
            {rulesOpen && (
              <ul className="gh-ddz-rules-list">
                <li>红方先行；点击自己的棋子选中，再点合法落点走子（绿色圆点提示）。</li>
                <li>帅/将九宫一步；仕/士斜行；相/象田字不过河；马走日别马腿；车走直线；炮隔子吃。</li>
                <li>兵/卒只能向前，过河后可左右；不能后退。</li>
                <li>走子后不得使己方将帅被将军（含将帅照面）；被将军且无合法着法为绝杀。</li>
                <li>无合法着法但未被将军为困毙，象棋规则判负。</li>
              </ul>
            )}
          </section>
        </aside>
      </div>

      {!state.playing && (
        <div className="gh-xq-overlay" role="dialog" aria-modal="true" aria-label="本局结算">
          <div className="gh-xq-overlay-card">
            <p className="gh-xq-overlay-eyebrow">本局结束</p>
            <h2 className={`gh-xq-overlay-title${state.winner === playerSide ? ' gh-xq-overlay-title--win' : ''}`}>
              {state.winner === null ? '平局' : state.winner === playerSide ? '你赢了！' : 'AI 获胜'}
            </h2>
            <p className="gh-xq-overlay-detail">{state.reason ? REASON_TEXT[state.reason] : '本局已结束'}</p>
            <div className="gh-xq-overlay-actions">
              <button type="button" className="gh-btn gh-btn--primary gh-btn--lg" onClick={() => restart()}>
                再来一局
              </button>
              <Link className="gh-btn gh-btn--secondary gh-btn--lg" to={GAME_XIANGQI_ONLINE_ROUTE}>
                好友联机
              </Link>
            </div>
          </div>
        </div>
      )}

      <p className="gh-games-footnote">
        棋盘与规则引擎与联机共用；AI 搜索会优先吃子、保护将帅，并避免送将。
      </p>
    </div>
  )
}
