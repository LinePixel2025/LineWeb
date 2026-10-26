import { useEffect, useMemo, useRef, useState } from 'react'
import {
  XIANGQI_COLS,
  XIANGQI_EMPTY,
  XIANGQI_PIECE_NAMES,
  XIANGQI_ROWS,
  xiangqiPoint,
  xiangqiSideOf,
  xiangqiTypeOf,
  type XiangqiSide,
} from '../../../lib/games/xiangqi'

export interface XiangqiBoardViewProps {
  board: number[]
  /** 玩家视角：红方在下 / 黑方在下（黑方视角自动翻转棋盘） */
  perspective: XiangqiSide
  selected: number | null
  legalTargets: number[]
  lastMove: { from: number; to: number } | null
  /** 被将军一方的将/帅下标（用于脉冲提示） */
  checkGeneral: number | null
  disabled?: boolean
  onSelect: (index: number) => void
}

const RED = 1
const BLACK = -1

/** 棋子中文名 */
export function xiangqiPieceChar(piece: number): string {
  const type = xiangqiTypeOf(piece)
  const names = XIANGQI_PIECE_NAMES[type]
  if (!names) return ''
  return xiangqiSideOf(piece) === RED ? names.red : names.black
}

/**
 * 中国象棋棋盘：DOM 交叉点按钮 + SVG 线框（楚河汉界 / 九宫斜线）。
 * 黑方视角时整体旋转 180° 映射（只改显示坐标，回传的仍是内部一维下标）。
 */
export default function XiangqiBoardView({
  board,
  perspective,
  selected,
  legalTargets,
  lastMove,
  checkGeneral,
  disabled = false,
  onSelect,
}: XiangqiBoardViewProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [cell, setCell] = useState(40)

  useEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current
      if (!wrap) return
      const available = Math.max(240, Math.floor(wrap.clientWidth || 360))
      setCell(Math.max(26, Math.min(60, Math.floor(available / XIANGQI_COLS))))
    }
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      if (wrapRef.current) observer.observe(wrapRef.current)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const width = cell * XIANGQI_COLS
  const height = cell * XIANGQI_ROWS
  const legalSet = useMemo(() => new Set(legalTargets), [legalTargets])

  /** 内部下标 → 显示坐标 */
  const displayPoint = (index: number): { x: number; y: number } => {
    const { x, y } = xiangqiPoint(index)
    return perspective === RED ? { x, y } : { x: XIANGQI_COLS - 1 - x, y: XIANGQI_ROWS - 1 - y }
  }

  const pieceSize = Math.round(cell * 0.84)

  return (
    <div className="gh-xq-board-wrap" ref={wrapRef}>
      <div
        className="gh-xq-board"
        style={{ width, height, padding: Math.round(cell * 0.5) }}
        role="group"
        aria-label="中国象棋棋盘"
      >
        <div
          className="gh-xq-board-inner"
          style={{ width: width - cell, height: height - cell }}
        >
          <svg
            className="gh-xq-lines"
            viewBox={`0 0 ${XIANGQI_COLS - 1} ${XIANGQI_ROWS - 1}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {/* 横线 10 条 */}
            {Array.from({ length: XIANGQI_ROWS }, (_, y) => (
              <line key={`h-${y}`} x1={0} y1={y} x2={XIANGQI_COLS - 1} y2={y} />
            ))}
            {/* 竖线：边线贯通，中间 7 条在楚河汉界处断开 */}
            {Array.from({ length: XIANGQI_COLS }, (_, x) => (
              x === 0 || x === XIANGQI_COLS - 1 ? (
                <line key={`v-${x}`} x1={x} y1={0} x2={x} y2={XIANGQI_ROWS - 1} />
              ) : (
                <g key={`v-${x}`}>
                  <line x1={x} y1={0} x2={x} y2={4} />
                  <line x1={x} y1={5} x2={x} y2={XIANGQI_ROWS - 1} />
                </g>
              )
            ))}
            {/* 九宫斜线（上 / 下各两条） */}
            <line x1={3} y1={0} x2={5} y2={2} />
            <line x1={5} y1={0} x2={3} y2={2} />
            <line x1={3} y1={7} x2={5} y2={9} />
            <line x1={5} y1={7} x2={3} y2={9} />
            {/* 兵/卒与炮位标记（小十字） */}
            {[0, 2, 4, 6, 8].flatMap((x) => [3, 6].map((y) => (
              <g key={`mark-${x}-${y}`} className="gh-xq-mark">
                <line x1={x - 0.12} y1={y} x2={x + 0.12} y2={y} />
                <line x1={x} y1={y - 0.12} x2={x} y2={y + 0.12} />
              </g>
            )))}
          </svg>

          <div className="gh-xq-river" aria-hidden="true">
            <span>楚 河</span>
            <span>漢 界</span>
          </div>

          {Array.from({ length: XIANGQI_COLS * XIANGQI_ROWS }, (_, index) => {
            const { x, y } = displayPoint(index)
            const piece = board[index] ?? XIANGQI_EMPTY
            const side = xiangqiSideOf(piece)
            const isSelected = selected === index
            const isLegal = legalSet.has(index)
            const isLast = lastMove !== null && (lastMove.from === index || lastMove.to === index)
            const isCheck = checkGeneral === index
            const label = piece === XIANGQI_EMPTY
              ? '空位'
              : `${xiangqiPieceChar(piece)}（${side === RED ? '红' : '黑'}）`
            return (
              <button
                key={index}
                type="button"
                className={[
                  'gh-xq-point',
                  isLegal ? 'gh-xq-point--legal' : '',
                  isSelected ? 'gh-xq-point--selected' : '',
                  piece !== XIANGQI_EMPTY ? 'gh-xq-point--occupied' : '',
                  isLast ? 'gh-xq-point--last' : '',
                  isCheck ? 'gh-xq-point--check' : '',
                ].filter(Boolean).join(' ')}
                style={{
                  left: `calc(${x} * (100% / ${XIANGQI_COLS - 1}))`,
                  top: `calc(${y} * (100% / ${XIANGQI_ROWS - 1}))`,
                  width: pieceSize,
                  height: pieceSize,
                  fontSize: Math.round(cell * 0.48),
                }}
                onClick={() => onSelect(index)}
                disabled={disabled}
                tabIndex={-1}
                aria-label={`第 ${y + 1} 行第 ${x + 1} 列，${label}`}
              >
                {piece !== XIANGQI_EMPTY ? (
                  <span className={`gh-xq-piece gh-xq-piece--${side === RED ? 'red' : 'black'}`}>
                    {xiangqiPieceChar(piece)}
                  </span>
                ) : isLegal ? (
                  <span className="gh-xq-legal-dot" aria-hidden="true" />
                ) : null}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
