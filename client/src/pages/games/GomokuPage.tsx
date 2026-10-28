import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { GAME_GOMOKU_ONLINE_ROUTE } from '../../lib/games/catalog'
import { useGameStats } from '../../contexts/GameStatsContext'
import {
  GOMOKU_BLACK,
  GOMOKU_BOARD_SIZE,
  GOMOKU_CELL_COUNT,
  GOMOKU_WHITE,
  createGomokuBoard,
  findGomokuWin,
  isGomokuBoardFull,
  placeGomokuStone,
  suggestGomokuMove,
  type GomokuBoard,
  type GomokuColor,
} from '../../lib/games/gomoku'

/** AI 思考延迟（毫秒）：给画面留出落子节奏，也避免长阻塞 */
const AI_THINK_DELAY_MS = 400

type GameStatus = 'playing' | 'won' | 'lost' | 'draw'

/** 星位坐标（0 起下标）：天元 + 四星 */
const GOMOKU_STARS: ReadonlyArray<readonly [number, number]> = [
  [3, 3],
  [11, 3],
  [3, 11],
  [11, 11],
  [7, 7],
]

/** 格子边长范围（与联机页一致；窄屏缩到 18px 保证 15 列装得下） */
const CELL_MIN = 18
const CELL_MAX = 34

/** 单局状态（引擎棋盘 + 结算 + 悔棋快照） */
interface GameState {
  board: GomokuBoard
  status: GameStatus
  winningLine: Array<{ x: number; y: number }> | null
  lastMove: { x: number; y: number; color: GomokuColor } | null
}

function newGame(): GameState {
  return { board: createGomokuBoard(), status: 'playing', winningLine: null, lastMove: null }
}

/**
 * 五子棋单机（人机对战）：
 * - 15×15 无禁手，玩家可选执黑（先手）或执白（后手），AI 与联机托管共用同一引擎；
 * - 悔棋一次撤销「AI + 自己」各一手；战绩（胜/负/平）随账号保存在服务端。
 * - AI 走子用 setTimeout 延迟触发，组件卸载 / 开新局时清理。
 */
export default function GomokuPage() {
  /** 玩家执子颜色；AI 执另一色 */
  const [playerColor, setPlayerColor] = useState<GomokuColor>(GOMOKU_BLACK)
  const [state, setState] = useState<GameState>(newGame)
  const [thinking, setThinking] = useState(false)
  const { getStat, recordResult } = useGameStats()
  const stat = getStat('gomoku', 'solo')
  const statsRecordedRef = useRef(false)
  const aiTimerRef = useRef<number | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [cell, setCell] = useState(CELL_MAX)

  // 格子尺寸自适应（容器宽度换算，移动端保持 15 列一屏装下）
  useEffect(() => {
    const measure = () => {
      const stage = stageRef.current
      if (!stage) return
      const available = Math.max(240, Math.floor(stage.clientWidth || 320))
      const fit = Math.floor(available / GOMOKU_BOARD_SIZE)
      setCell(Math.max(CELL_MIN, Math.min(CELL_MAX, fit)))
    }
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      if (stageRef.current) observer.observe(stageRef.current)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const aiColor: GomokuColor = playerColor === GOMOKU_BLACK ? GOMOKU_WHITE : GOMOKU_BLACK
  const playing = state.status === 'playing'
  const size = GOMOKU_BOARD_SIZE

  const clearAiTimer = useCallback(() => {
    if (aiTimerRef.current !== null) {
      window.clearTimeout(aiTimerRef.current)
      aiTimerRef.current = null
    }
  }, [])

  // 卸载时清理 AI 定时器
  useEffect(() => clearAiTimer, [clearAiTimer])

  /** 结算时上报一次战绩（每局只记一次） */
  useEffect(() => {
    if (state.status === 'playing' || statsRecordedRef.current) return
    statsRecordedRef.current = true
    recordResult({
      game: 'gomoku',
      variant: 'solo',
      outcome: state.status === 'won' ? 'win' : state.status === 'lost' ? 'loss' : 'draw',
    })
  }, [state.status, recordResult])

  /** 在 (x, y) 落 color 一子并做胜负 / 满盘判定（纯函数式返回新状态） */
  const applyMove = useCallback((prev: GameState, x: number, y: number, color: GomokuColor): GameState => {
    const board = [...prev.board]
    placeGomokuStone(board, x, y, color)
    const win = findGomokuWin(board, x, y)
    if (win !== null) {
      return { board, status: color === playerColor ? 'won' : 'lost', winningLine: win, lastMove: { x, y, color } }
    }
    if (isGomokuBoardFull(board)) {
      return { board, status: 'draw', winningLine: null, lastMove: { x, y, color } }
    }
    return { board, status: 'playing', winningLine: null, lastMove: { x, y, color } }
  }, [playerColor])

  // AI 回合：轮到 AI 且对局进行中时延迟落子
  useEffect(() => {
    if (!playing || state.status !== 'playing') return
    // 轮到谁：按手数奇偶推（黑恒先手）
    const blackPlays = state.board.reduce((count, cell) => count + (cell !== 0 ? 1 : 0), 0) % 2 === 0
    const turnColor: GomokuColor = blackPlays ? GOMOKU_BLACK : GOMOKU_WHITE
    if (turnColor !== aiColor) return

    setThinking(true)
    aiTimerRef.current = window.setTimeout(() => {
      aiTimerRef.current = null
      setState((prev) => {
        if (prev.status !== 'playing') return prev
        const move = suggestGomokuMove(prev.board, aiColor)
        if (move === null) return prev
        return applyMove(prev, move.x, move.y, aiColor)
      })
      setThinking(false)
    }, AI_THINK_DELAY_MS)
    return clearAiTimer
  }, [playing, state, aiColor, applyMove, clearAiTimer])

  const handlePointClick = useCallback(
    (x: number, y: number) => {
      if (!playing || thinking) return
      setState((prev) => {
        if (prev.status !== 'playing') return prev
        if (prev.board[y * size + x] !== 0) return prev
        // 手数奇偶判定轮到谁：轮到 AI 时点击无效
        const blackPlays = prev.board.reduce((count, cell) => count + (cell !== 0 ? 1 : 0), 0) % 2 === 0
        const turnColor: GomokuColor = blackPlays ? GOMOKU_BLACK : GOMOKU_WHITE
        if (turnColor !== playerColor) return prev
        return applyMove(prev, x, y, playerColor)
      })
    },
    [playing, thinking, playerColor, applyMove, size]
  )

  /** 悔棋：撤销「AI + 自己」各一手（不足两手时只撤已有的）；结算后悔棋视为继续本局 */
  const handleUndo = useCallback(() => {
    if (thinking) return
    setState((prev) => {
      const stones: number[] = []
      for (let index = 0; index < GOMOKU_CELL_COUNT; index += 1) {
        if (prev.board[index] !== 0) stones.push(index)
      }
      if (stones.length === 0) return prev
      const keep = Math.max(0, stones.length - 2)
      const board = createGomokuBoard()
      let last: GameState['lastMove'] = null
      for (let i = 0; i < keep; i += 1) {
        const index = stones[i]
        board[index] = prev.board[index]
        last = { x: index % size, y: Math.floor(index / size), color: board[index] as GomokuColor }
      }
      statsRecordedRef.current = false
      return { board, status: 'playing', winningLine: null, lastMove: last }
    })
  }, [thinking, size])

  /** 重开一局（换边时同时重开） */
  const handleRestart = useCallback(
    (nextColor?: GomokuColor) => {
      clearAiTimer()
      statsRecordedRef.current = false
      setThinking(false)
      if (nextColor) setPlayerColor(nextColor)
      setState(newGame())
    },
    [clearAiTimer]
  )

  const statusText = useMemo(() => {
    if (state.status === 'won') return '🎉 你赢了！连成五子'
    if (state.status === 'lost') return 'AI 连成五子，再接再厉'
    if (state.status === 'draw') return '棋盘已下满，平局'
    if (thinking) return 'AI 思考中…'
    const blackPlays = state.board.reduce((count, cell) => count + (cell !== 0 ? 1 : 0), 0) % 2 === 0
    const turnColor: GomokuColor = blackPlays ? GOMOKU_BLACK : GOMOKU_WHITE
    return turnColor === playerColor ? '轮到你落子' : '等待 AI 落子'
  }, [state, thinking, playerColor])

  const lastMoveIndex = state.lastMove ? state.lastMove.y * size + state.lastMove.x : -1
  const winningSet = useMemo(() => {
    const set = new Set<number>()
    for (const point of state.winningLine ?? []) set.add(point.y * size + point.x)
    return set
  }, [state.winningLine, size])

  const placedCount = state.board.reduce((count, cell) => count + (cell !== 0 ? 1 : 0), 0)

  return (
    <div className="gh-page-container gh-games-page gh-gmk-page">
      <header className="gh-games-header">
        <div className="gh-games-header-copy">
          <p className="gh-g2048-eyebrow">
            <Link to="/games">← 游戏大厅</Link>
          </p>
          <h1 className="gh-games-title">五子棋 · 人机对战</h1>
          <p className="gh-games-subtitle">
            {size}×{size} 无禁手规则：黑先白后，率先连成五子（含长连）获胜；AI 与联机托管共用同一引擎。
          </p>
        </div>
        <div className="gh-gmk-header-actions">
          <Link className="gh-btn gh-btn--secondary gh-btn--md" to={GAME_GOMOKU_ONLINE_ROUTE}>
            好友联机
          </Link>
        </div>
      </header>

      <div className="gh-gmk-toolbar">
        <div className="gh-gmk-toolbar-group" role="group" aria-label="执子选择">
          <span className="gh-gmk-toolbar-label">执子</span>
          <button
            type="button"
            className={`gh-btn gh-btn--sm ${playerColor === GOMOKU_BLACK ? 'gh-btn--primary' : 'gh-btn--secondary'}`}
            onClick={() => handleRestart(GOMOKU_BLACK)}
            disabled={playing && placedCount > 0}
          >
            ⚫ 执黑先行
          </button>
          <button
            type="button"
            className={`gh-btn gh-btn--sm ${playerColor === GOMOKU_WHITE ? 'gh-btn--primary' : 'gh-btn--secondary'}`}
            onClick={() => handleRestart(GOMOKU_WHITE)}
            disabled={playing && placedCount > 0}
          >
            ⚪ 执白后行
          </button>
        </div>
        <div className="gh-gmk-toolbar-group">
          <button
            type="button"
            className="gh-btn gh-btn--secondary gh-btn--sm"
            onClick={handleUndo}
            disabled={!playing || placedCount === 0 || thinking}
          >
            悔棋
          </button>
          <button type="button" className="gh-btn gh-btn--primary gh-btn--sm" onClick={() => handleRestart()}>
            重新开始
          </button>
        </div>
      </div>

      <p className={`gh-gmk-status gh-gmk-status--${state.status}`} role="status">
        {statusText}
      </p>

      <div className="gh-gmk-stage" ref={stageRef} role="group" aria-label={`五子棋棋盘，${size} 乘 ${size}，已落 ${placedCount} 子`}>
        <div className="gh-gmk-board" style={{ '--gh-gmk-cell': `${cell}px` } as CSSProperties}>
          <div className="gh-gmk-stars" aria-hidden="true">
            {GOMOKU_STARS.map(([sx, sy]) => (
              <span
                key={`star-${sx}-${sy}`}
                className="gh-gmk-star"
                style={{
                  left: `calc(var(--gh-gmk-cell) * ${sx + 0.5})`,
                  top: `calc(var(--gh-gmk-cell) * ${sy + 0.5})`,
                }}
              />
            ))}
          </div>
          {state.board.map((stone, index) => {
            const x = index % size
            const y = Math.floor(index / size)
            const classes = [
              'gh-gmk-point',
              stone !== 0 ? `gh-gmk-point--${stone === 1 ? 'black' : 'white'}` : '',
              winningSet.has(index) ? 'gh-gmk-point--win' : '',
              index === lastMoveIndex ? 'gh-gmk-point--last' : '',
              playing && !thinking && stone === 0 ? 'gh-gmk-point--clickable' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <button
                key={index}
                type="button"
                className={classes}
                aria-label={`第 ${y + 1} 行第 ${x + 1} 列，${stone === 0 ? '空位' : stone === 1 ? '黑子' : '白子'}`}
                tabIndex={-1}
                onClick={() => handlePointClick(x, y)}
              >
                {index === lastMoveIndex && stone !== 0 && <span className="gh-gmk-point-mark" aria-hidden="true" />}
              </button>
            )
          })}
          {state.status !== 'playing' && (
            <div className="gh-gmk-overlay" role="dialog" aria-modal="true" aria-label="本局结算">
              <div className="gh-gmk-overlay-card">
                <p className="gh-gmk-overlay-eyebrow">本局结束</p>
                <h2
                  className={`gh-gmk-overlay-title${
                    state.status === 'won' ? ' gh-gmk-overlay-title--win' : state.status === 'draw' ? ' gh-gmk-overlay-title--draw' : ''
                  }`}
                >
                  {state.status === 'won' ? '你赢了' : state.status === 'lost' ? 'AI 获胜' : '平局'}
                </h2>
                <p className="gh-gmk-overlay-detail">
                  {state.status === 'draw' ? '棋盘已下满且无人连五。' : '五子连线已在棋盘上高亮。'}
                </p>
                <div className="gh-gmk-overlay-actions">
                  <button type="button" className="gh-btn gh-btn--primary gh-btn--lg" onClick={() => handleRestart()}>
                    再来一局
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="gh-gmk-stats" aria-label="战绩">
        <span className="gh-gmk-stats-item">
          执子：<strong>{playerColor === GOMOKU_BLACK ? '黑（先手）' : '白（后手）'}</strong>
        </span>
        <span className="gh-gmk-stats-item">胜 <strong>{stat?.wins ?? 0}</strong></span>
        <span className="gh-gmk-stats-item">负 <strong>{stat?.losses ?? 0}</strong></span>
        <span className="gh-gmk-stats-item">平 <strong>{stat?.draws ?? 0}</strong></span>
      </div>

      <p className="gh-games-footnote">
        悔棋会同时撤销 AI 与你的各一手；战绩随账号保存。想和好友对弈？试试{' '}
        <Link to={GAME_GOMOKU_ONLINE_ROUTE}>好友联机</Link>。
      </p>
    </div>
  )
}
