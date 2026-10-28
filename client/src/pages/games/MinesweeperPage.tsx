import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { GAME_MINESWEEPER_ONLINE_ROUTE } from '../../lib/games/catalog'
import { useGameStats } from '../../contexts/GameStatsContext'
import {
  MS_LEVELS,
  MS_LEVEL_ORDER,
  createMsSession,
  formatMsTenths,
  formatMsTime,
  msAdjacent,
  msChordCell,
  msOpenCell,
  msRemainingMines,
  msSessionElapsedMs,
  msToggleFlag,
  randomMsSeed,
  type MsLevel,
  type MsSession,
  type MsStatus,
} from '../../lib/games/minesweeper'

/** 长按多少毫秒视为插旗（触屏没有右键） */
const LONG_PRESS_MS = 450

/** 计时刷新间隔（毫秒）——界面显示 mm:ss + 十分位，内部保留毫秒精度 */
const TIMER_TICK_MS = 100

const ARROW_KEY_DELTA: Record<string, { dx: number; dy: number } | undefined> = {
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  w: { dx: 0, dy: -1 },
  W: { dx: 0, dy: -1 },
  s: { dx: 0, dy: 1 },
  S: { dx: 0, dy: 1 },
  a: { dx: -1, dy: 0 },
  A: { dx: -1, dy: 0 },
  d: { dx: 1, dy: 0 },
  D: { dx: 1, dy: 0 },
}

/** 表单类元素上的按键不应触发棋盘操作 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** 单元格视角（渲染用，不含雷位信息） */
interface CellView {
  /** closed | blank | number | mine | boom | flag | flaggedMine */
  kind: 'closed' | 'blank' | 'number' | 'mine' | 'boom' | 'flag' | 'flaggedMine'
  value: number
}

/** 把引擎会话换算成纯展示的格子视图（失败时揭示所有雷位） */
function buildCellView(session: MsSession, index: number): CellView {
  const board = session.board
  if (!board) return { kind: 'closed', value: 0 }
  const isBoomCell = session.status === 'lost' && board.bombs[index]
  if (session.opened.has(index)) {
    if (board.bombs[index]) {
      return { kind: index === session.boomIndex ? 'boom' : 'mine', value: 0 }
    }
    const count = msAdjacent(board, index)
    return count === 0 ? { kind: 'blank', value: 0 } : { kind: 'number', value: count }
  }
  if (isBoomCell) {
    return { kind: session.flags.has(index) ? 'flaggedMine' : 'mine', value: 0 }
  }
  if (session.flags.has(index)) return { kind: 'flag', value: 0 }
  return { kind: 'closed', value: 0 }
}

/**
 * 单机棋盘：三档难度、首点必安全、左键开格 / 右键或长按插旗 / 双击数字和弦。
 * 判定与计时全部在 lib/games/minesweeper.ts，这里只做 DOM 网格渲染与事件分发。
 */
function SoloBoard({ level }: { level: MsLevel }) {
  const spec = MS_LEVELS[level]
  const total = spec.width * spec.height

  const sessionRef = useRef<MsSession>(createMsSession(level, randomMsSeed()))
  const [tick, setTick] = useState(0)
  const [status, setStatus] = useState<MsStatus>('ready')
  const [elapsed, setElapsed] = useState(0)
  const { getStat, recordResult } = useGameStats()
  const stat = getStat('minesweeper', level)
  const best = stat?.bestTimeMs ?? 0
  const [isRecord, setIsRecord] = useState(false)
  const reportedRef = useRef(false)
  const [focusIndex, setFocusIndex] = useState<number>(Math.floor(spec.height / 2) * spec.width + Math.floor(spec.width / 2))

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFiredRef = useRef(false)
  const boardRef = useRef<HTMLDivElement | null>(null)

  const session = sessionRef.current

  // 会话状态镜像到 React state，驱动重渲染与遮罩
  const sync = useCallback((next: MsSession) => {
    setStatus(next.status)
    setElapsed(msSessionElapsedMs(next))
    setTick((value) => value + 1)
  }, [])

  /** 终局结算：上报一次胜负与最佳用时 */
  const finalize = useCallback(
    (next: MsSession) => {
      if (reportedRef.current) return
      if (next.status === 'won') {
        reportedRef.current = true
        const ms = msSessionElapsedMs(next)
        setIsRecord(best === 0 || ms < best)
        recordResult({ game: 'minesweeper', variant: next.level, outcome: 'win', timeMs: ms })
      } else if (next.status === 'lost') {
        reportedRef.current = true
        setIsRecord(false)
        recordResult({ game: 'minesweeper', variant: next.level, outcome: 'loss' })
      }
    },
    [best, recordResult]
  )

  const openCell = useCallback(
    (index: number) => {
      const next = sessionRef.current
      const result = msOpenCell(next, index)
      if (result.cells.length === 0 && !result.mine) {
        setStatus(next.status)
        setTick((value) => value + 1)
        return
      }
      finalize(next)
      sync(next)
    },
    [finalize, sync]
  )

  const toggleFlag = useCallback(
    (index: number) => {
      const next = sessionRef.current
      if (msToggleFlag(next, index)) sync(next)
    },
    [sync]
  )

  const chordCell = useCallback(
    (index: number) => {
      const next = sessionRef.current
      const result = msChordCell(next, index)
      if (result.cells.length === 0 && !result.mine) return
      finalize(next)
      sync(next)
    },
    [finalize, sync]
  )

  const restart = useCallback(() => {
    const fresh = createMsSession(level, randomMsSeed())
    sessionRef.current = fresh
    reportedRef.current = false
    setIsRecord(false)
    setStatus('ready')
    setElapsed(0)
    setFocusIndex(Math.floor(spec.height / 2) * spec.width + Math.floor(spec.width / 2))
    setTick((value) => value + 1)
  }, [level, spec.height, spec.width])

  // 计时：只有 playing 状态在跑
  useEffect(() => {
    if (status !== 'playing') return
    const update = () => setElapsed(msSessionElapsedMs(sessionRef.current))
    update()
    const timer = setInterval(update, TIMER_TICK_MS)
    return () => clearInterval(timer)
  }, [status])


  // === 长按插旗（触屏） ===

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const startLongPress = useCallback(
    (index: number) => {
      clearLongPress()
      longPressFiredRef.current = false
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null
        longPressFiredRef.current = true
        toggleFlag(index)
      }, LONG_PRESS_MS)
    },
    [clearLongPress, toggleFlag]
  )

  useEffect(() => clearLongPress, [clearLongPress])

  const handleClick = useCallback(
    (index: number) => {
      if (longPressFiredRef.current) {
        longPressFiredRef.current = false
        return
      }
      setFocusIndex(index)
      openCell(index)
    },
    [openCell]
  )

  const handleContextMenu = useCallback(
    (index: number) => toggleFlag(index),
    [toggleFlag]
  )

  // === 键盘：方向键移动焦点格、Enter 开格、F 插旗、空格和弦 ===

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isTypingTarget(event.target)) return

      const delta = ARROW_KEY_DELTA[event.key]
      if (delta) {
        event.preventDefault()
        setFocusIndex((prev) => {
          const x = prev % spec.width
          const y = Math.floor(prev / spec.width)
          const nx = Math.min(spec.width - 1, Math.max(0, x + delta.dx))
          const ny = Math.min(spec.height - 1, Math.max(0, y + delta.dy))
          return ny * spec.width + nx
        })
        return
      }

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        const current = sessionRef.current
        const index = focusIndex
        const isOpenable = !current.opened.has(index) && !current.flags.has(index)
        if (isOpenable) openCell(index)
        else chordCell(index)
        return
      }

      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault()
        toggleFlag(focusIndex)
      }
    },
    [chordCell, focusIndex, openCell, spec.height, spec.width, toggleFlag]
  )

  // === 渲染 ===

  const cells = useMemo(() => {
    void tick
    const list: CellView[] = []
    for (let index = 0; index < total; index += 1) {
      list.push(buildCellView(sessionRef.current, index))
    }
    return list
  }, [tick, total])

  const remainingMines = msRemainingMines(session)
  const finished = status === 'won' || status === 'lost'
  const openedCount = session.opened.size
  const totalSafe = total - spec.mines

  const boardAriaLabel =
    status === 'ready'
      ? `${spec.label}扫雷棋盘，${spec.width} 乘 ${spec.height}，共 ${spec.mines} 雷，尚未开始。点任意一格开始计时，首点一定安全。`
      : `${spec.label}扫雷棋盘，${spec.width} 乘 ${spec.height}，已翻开 ${openedCount} 格，共 ${totalSafe} 个安全格，剩余旗数 ${remainingMines}，用时 ${formatMsTime(elapsed)}${
          status === 'won' ? '，本局已全清获胜' : status === 'lost' ? '，本局踩雷失败' : ''
        }。`

  return (
    <div className="gh-ms-board-area">
      <div className="gh-ms-hud" role="status" aria-live="polite">
        <span className="gh-ms-hud-card">
          <span className="gh-ms-hud-label">剩余雷数</span>
          <strong className="gh-ms-hud-value">{remainingMines}</strong>
        </span>
        <span className="gh-ms-hud-card">
          <span className="gh-ms-hud-label">用时</span>
          <strong className="gh-ms-hud-value gh-ms-hud-value--time">
            {formatMsTime(elapsed)}
            <span className="gh-ms-hud-tenths">.{formatMsTenths(elapsed)}</span>
          </strong>
        </span>
        <span className="gh-ms-hud-card">
          <span className="gh-ms-hud-label">本档最佳</span>
          <strong className="gh-ms-hud-value">{best > 0 ? formatMsTime(best) : '—'}</strong>
        </span>
        <span className="gh-ms-hud-card gh-ms-hud-card--subtle">
          <span className="gh-ms-hud-label">账号战绩</span>
          <strong className="gh-ms-hud-value">
            {stat?.wins ?? 0} 胜 · {stat?.losses ?? 0} 败
          </strong>
        </span>
      </div>

      <div className="gh-ms-toolbar">
        <button
          type="button"
          className="gh-btn gh-btn--primary gh-btn--md"
          onClick={restart}
          disabled={status === 'ready'}
        >
          重新开始
        </button>
        <span className="gh-ms-toolbar-hint">
          {status === 'ready'
            ? '点任意一格翻开第一块，首点连同它的 3×3 邻域保证无雷，计时同时开始。'
            : finished
              ? '本局已结束，点「重新开始」再来一局。'
              : '左键开格，右键或长按插旗，双击数字格和弦展开。'}
        </span>
      </div>

      <div
        className="gh-ms-stage"
        ref={boardRef}
        tabIndex={0}
        role="group"
        aria-label={boardAriaLabel}
        onKeyDown={handleKeyDown}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div
          className="gh-ms-board"
          data-width={spec.width}
          style={{ gridTemplateColumns: `repeat(${spec.width}, var(--gh-ms-cell))` }}
        >
          {cells.map((view, index) => {
            const x = index % spec.width
            const y = Math.floor(index / spec.width)
            const isFocused = focusIndex === index && !finished
            const label =
              view.kind === 'number'
                ? `第 ${y + 1} 行第 ${x + 1} 列，数字 ${view.value}`
                : view.kind === 'blank'
                  ? `第 ${y + 1} 行第 ${x + 1} 列，空白`
                  : view.kind === 'flag'
                    ? `第 ${y + 1} 行第 ${x + 1} 列，已插旗`
                    : view.kind === 'mine' || view.kind === 'boom' || view.kind === 'flaggedMine'
                      ? `第 ${y + 1} 行第 ${x + 1} 列，地雷`
                      : `第 ${y + 1} 行第 ${x + 1} 列，未翻开`
            return (
              <button
                key={index}
                type="button"
                className={[
                  'gh-ms-cell',
                  `gh-ms-cell--${view.kind}`,
                  view.kind === 'number' ? `gh-ms-cell--n${view.value}` : '',
                  isFocused ? 'gh-ms-cell--focus' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-n={view.kind === 'number' ? view.value : undefined}
                aria-label={label}
                aria-pressed={view.kind === 'flag'}
                tabIndex={-1}
                onClick={() => handleClick(index)}
                onDoubleClick={() => chordCell(index)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  handleContextMenu(index)
                }}
                onTouchStart={() => startLongPress(index)}
                onTouchEnd={clearLongPress}
                onTouchMove={clearLongPress}
                onTouchCancel={clearLongPress}
              >
                {view.kind === 'number' ? view.value : null}
                {view.kind === 'flag' || view.kind === 'flaggedMine' ? '🚩' : null}
                {view.kind === 'mine' || view.kind === 'boom' ? '💣' : null}
              </button>
            )
          })}
        </div>

        {status === 'won' && (
          <div className="gh-ms-overlay" role="dialog" aria-modal="true" aria-label="本局结果">
            <div className="gh-ms-overlay-card">
              <p className="gh-ms-overlay-eyebrow">{spec.label} · 全清</p>
              <h2 className="gh-ms-overlay-title">
                {isRecord ? '新纪录！' : '扫干净了'}
              </h2>
              <p className="gh-ms-overlay-detail">
                {isRecord
                  ? `本档最佳刷新为 ${formatMsTime(elapsed)}。`
                  : `所有安全格都翻开了，用时 ${formatMsTime(elapsed)}，本档最佳 ${
                      best > 0 ? formatMsTime(best) : '—'
                    }。`}
              </p>
              <div className="gh-ms-overlay-scores">
                <span>
                  本局用时 <strong>{formatMsTime(elapsed)}</strong>
                </span>
                <span>
                  翻开 <strong>{openedCount}</strong> 格
                </span>
                <span>
                  最佳 <strong>{best > 0 ? formatMsTime(best) : '—'}</strong>
                </span>
              </div>
              <div className="gh-ms-overlay-actions">
                <button type="button" className="gh-btn gh-btn--primary gh-btn--lg" onClick={restart}>
                  再来一局
                </button>
                <Link className="gh-btn gh-btn--secondary gh-btn--lg" to={GAME_MINESWEEPER_ONLINE_ROUTE}>
                  好友轮流扫雷
                </Link>
              </div>
            </div>
          </div>
        )}

        {status === 'lost' && (
          <div className="gh-ms-overlay gh-ms-overlay--lost" role="dialog" aria-modal="true" aria-label="本局结果">
            <div className="gh-ms-overlay-card">
              <p className="gh-ms-overlay-eyebrow">{spec.label} · 踩雷</p>
              <h2 className="gh-ms-overlay-title gh-ms-overlay-title--lost">boom！</h2>
              <p className="gh-ms-overlay-detail">
                踩到雷了，全部雷位已在棋盘上标出。数字是周围 8 格的雷数，先推再点更稳。
              </p>
              <div className="gh-ms-overlay-scores">
                <span>
                  用时 <strong>{formatMsTime(elapsed)}</strong>
                </span>
                <span>
                  翻开 <strong>{openedCount}</strong> / {totalSafe}
                </span>
                <span>
                  最佳 <strong>{best > 0 ? formatMsTime(best) : '—'}</strong>
                </span>
              </div>
              <div className="gh-ms-overlay-actions">
                <button type="button" className="gh-btn gh-btn--primary gh-btn--lg" onClick={restart}>
                  再来一局
                </button>
                <button type="button" className="gh-btn gh-btn--secondary gh-btn--lg" onClick={restart}>
                  换个盘面
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <p className="gh-ms-sr-only" aria-live="polite">
        {status === 'won'
          ? `本局获胜，用时 ${formatMsTime(elapsed)}${isRecord ? '，刷新本档最佳' : ''}`
          : status === 'lost'
            ? '本局踩雷结束'
            : `剩余 ${Math.max(0, totalSafe - openedCount)} 个安全格，用时 ${formatMsTime(elapsed)}`}
      </p>
    </div>
  )
}

/**
 * 扫雷单机页：三档难度（初级 9×9/10、中级 12×12/22、高级 16×16/40）。
 * 规则引擎在 lib/games/minesweeper.ts（纯函数、可单测），本页只做渲染与事件。
 * 好友轮流扫雷在 `/games/minesweeper/online`。
 */
export default function MinesweeperPage() {
  const [level, setLevel] = useState<MsLevel>('beginner')
  const spec = MS_LEVELS[level]

  return (
    <div className="gh-page-container gh-games-page gh-ms-page">
      <header className="gh-games-header">
        <div className="gh-games-header-copy">
          <p className="gh-g2048-eyebrow">
            <Link to="/games">← 游戏大厅</Link>
          </p>
          <h1 className="gh-games-title">扫雷</h1>
          <p className="gh-games-subtitle">
            数字告诉你周围 8 格里埋了几颗雷：靠推理翻开所有安全格就赢。单机三档难度冲账号最佳，
            或者去联机模式和朋友一人只点一下、轮流扫。
          </p>
        </div>
        <div className="gh-ms-header-actions">
          <Link className="gh-btn gh-btn--secondary gh-btn--md" to={GAME_MINESWEEPER_ONLINE_ROUTE}>
            好友轮流扫雷
          </Link>
        </div>
      </header>

      <div className="gh-ms-tabs" role="tablist" aria-label="扫雷难度">
        {MS_LEVEL_ORDER.map((key) => {
          const item = MS_LEVELS[key]
          const active = key === level
          return (
            <button
              key={key}
              type="button"
              role="tab"
              id={`gh-ms-tab-${key}`}
              aria-selected={active}
              className={`gh-ms-tab${active ? ' gh-ms-tab--active' : ''}`}
              onClick={() => setLevel(key)}
            >
              {item.label}
              <span className="gh-ms-tab-meta">
                {item.width}×{item.height} · {item.mines} 雷
              </span>
            </button>
          )
        })}
      </div>

      <div className="gh-ms-layout">
        <div className="gh-ms-main" role="tabpanel" aria-labelledby={`gh-ms-tab-${level}`}>
          <SoloBoard key={level} level={level} />
        </div>

        <aside className="gh-ms-help" aria-label="玩法说明">
          <h2 className="gh-ms-help-title">玩法</h2>
          <p className="gh-ms-help-lede">
            一句话：翻开格子看到数字 <strong>n</strong>，就说明它周围 8 格里正好有 <strong>n</strong> 颗雷 ——
            据此插旗排雷，把非雷格全部翻开即胜。
          </p>

          <h2 className="gh-ms-help-title">快捷键</h2>
          <table className="gh-ms-keys">
            <thead>
              <tr>
                <th>按键</th>
                <th>作用</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>左键</td>
                <td>翻开格子</td>
              </tr>
              <tr>
                <td>右键 / 长按</td>
                <td>插旗 / 撤旗</td>
              </tr>
              <tr>
                <td>双击数字格</td>
                <td>和弦：旗数与数字一致时一次展开其余邻格</td>
              </tr>
              <tr>
                <td>↑ ↓ ← → / WASD</td>
                <td>移动焦点格</td>
              </tr>
              <tr>
                <td>Enter / 空格</td>
                <td>翻开焦点格（已开格则执行和弦）</td>
              </tr>
              <tr>
                <td>F</td>
                <td>给焦点格插旗 / 撤旗</td>
              </tr>
            </tbody>
          </table>

          <h2 className="gh-ms-help-title">规则</h2>
          <ul className="gh-ms-help-list">
            <li>第一次翻开的位置连同它的 3×3 邻域保证无雷，点开就行，不用赌。</li>
            <li>计时从第一次翻开开始，踩雷或全清立即停表。</li>
            <li>当前难度：{spec.label} {spec.width}×{spec.height}，{spec.mines} 颗雷。</li>
            <li>最佳时间与胜败场随账号保存，换档互不影响。</li>
          </ul>

          <Link to="/games" className="gh-ms-help-link">
            返回游戏大厅
          </Link>
        </aside>
      </div>
    </div>
  )
}
