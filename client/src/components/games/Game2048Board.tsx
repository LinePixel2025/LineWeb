import { useMemo } from 'react'
import { useGame2048Input } from '../../hooks/useGame2048Input'
import type { Game2048Direction } from '../../types/game'

export interface Game2048BoardProps {
  /** 4x4 棋盘数值，0 表示空格 */
  board: number[][]
  /** 方向输入回调；未提供时棋盘只读 */
  onMove?: (direction: Game2048Direction) => void
  /** normal = 主棋盘（含 D-pad），mini = 对手棋盘缩略图 */
  variant?: 'normal' | 'mini'
  /** 禁止操作（对局结束、动作发送中等） */
  disabled?: boolean
  /** 是否显示方向键（默认 normal 显示、mini 不显示） */
  showDpad?: boolean
  /** 无障碍标签 */
  label?: string
  /** 附加类名 */
  className?: string
}

interface DpadItem {
  direction: Game2048Direction
  label: string
  ariaLabel: string
  area: string
}

const DPAD_ITEMS: DpadItem[] = [
  { direction: 'up', label: '↑', ariaLabel: '向上移动', area: 'up' },
  { direction: 'left', label: '←', ariaLabel: '向左移动', area: 'left' },
  { direction: 'down', label: '↓', ariaLabel: '向下移动', area: 'down' },
  { direction: 'right', label: '→', ariaLabel: '向右移动', area: 'right' },
]

const SIZE = 4

function buildRows(board: number[][]): number[][] {
  const rows: number[][] = []
  for (let row = 0; row < SIZE; row += 1) {
    const source = board[row] ?? []
    const cells: number[] = []
    for (let col = 0; col < SIZE; col += 1) {
      const value = source[col]
      cells.push(typeof value === 'number' && value > 0 ? value : 0)
    }
    rows.push(cells)
  }
  return rows
}

export default function Game2048Board({
  board,
  onMove,
  variant = 'normal',
  disabled = false,
  showDpad,
  label,
  className,
}: Game2048BoardProps) {
  const isMini = variant === 'mini'
  const interactive = typeof onMove === 'function' && !disabled
  const withDpad = showDpad ?? !isMini
  const rows = useMemo(() => buildRows(board), [board])

  const { touchHandlers } = useGame2048Input({
    onMove: onMove ?? (() => {}),
    enabled: interactive,
    keyboard: false,
    touch: interactive,
  })

  const classes = [
    'gh-g2048-board-wrap',
    isMini ? 'gh-g2048-board-wrap--mini' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      <div
        className="gh-g2048-board"
        role="grid"
        aria-label={label ?? (isMini ? '对手棋盘' : '2048 棋盘')}
        aria-disabled={disabled || undefined}
        {...(interactive ? touchHandlers : {})}
      >
        {rows.map((cells, rowIndex) => (
          <div key={rowIndex} className="gh-g2048-row" role="row">
            {cells.map((value, colIndex) => (
              <div
                key={`${rowIndex}-${colIndex}`}
                className="gh-g2048-cell"
                role="gridcell"
                aria-label={`第 ${rowIndex + 1} 行第 ${colIndex + 1} 列，${value > 0 ? value : '空'}`}
              >
                {value > 0 && (
                  <div className="gh-g2048-tile" data-value={value}>
                    {value}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {withDpad && onMove && (
        <div className="gh-g2048-dpad" role="group" aria-label="方向控制">
          {DPAD_ITEMS.map((item) => (
            <button
              key={item.direction}
              type="button"
              className={`gh-g2048-dpad-btn gh-g2048-dpad-btn--${item.area}`}
              onClick={() => onMove(item.direction)}
              disabled={disabled}
              aria-label={item.ariaLabel}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
