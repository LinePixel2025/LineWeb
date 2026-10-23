import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Game2048Board from '../../components/games/Game2048Board'
import { useGame2048Input } from '../../hooks/useGame2048Input'
import { createGame, moveGame, type Game2048Snapshot } from '../../lib/games/game2048'
import { GAME_2048_ONLINE_ROUTE } from '../../lib/games/catalog'
import type { Game2048Direction } from '../../types/game'

const BEST_SCORE_KEY = 'lineweb_2048_best'

function readBestScore(): number {
  try {
    const raw = localStorage.getItem(BEST_SCORE_KEY)
    if (!raw) return 0
    const value = Number.parseInt(raw, 10)
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

function writeBestScore(value: number): void {
  try {
    localStorage.setItem(BEST_SCORE_KEY, String(value))
  } catch {
    // localStorage 不可用（隐私模式）时仅影响最高分持久化，不影响本局
  }
}

/**
 * 2048 单机版：纯前端引擎 + 键盘/触摸/方向键操作，最高分保存在 localStorage。
 * 联机入口跳转 `/games/2048/online`（需登录）。
 */
export default function Game2048Page() {
  const [snapshot, setSnapshot] = useState<Game2048Snapshot>(() => createGame())
  const [best, setBest] = useState<number>(() => readBestScore())
  const [undoSnapshot, setUndoSnapshot] = useState<Game2048Snapshot | null>(null)
  const [winDismissed, setWinDismissed] = useState(false)
  const snapshotRef = useRef(snapshot)

  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  const status = snapshot.state.status
  const score = snapshot.state.score
  const moves = snapshot.state.moves
  const bestTile = snapshot.state.maxTile
  const lost = status === 'lost'
  const won = status === 'won'
  const overlayOpen = lost || (won && !winDismissed)
  const canPlay = !lost && !overlayOpen
  const canUndo = status === 'playing' && undoSnapshot !== null

  const handleMove = useCallback((direction: Game2048Direction) => {
    const current = snapshotRef.current
    if (current.state.status === 'lost') return
    const result = moveGame(current, direction)
    if (!result.moved) return
    // 一步撤销：只保留本次移动前的快照
    setUndoSnapshot(current)
    setSnapshot(result.snapshot)
  }, [])

  const handleUndo = useCallback(() => {
    if (!undoSnapshot) return
    setSnapshot(undoSnapshot)
    setUndoSnapshot(null)
    setWinDismissed(false)
  }, [undoSnapshot])

  const handleNewGame = useCallback(() => {
    setSnapshot(createGame())
    setUndoSnapshot(null)
    setWinDismissed(false)
  }, [])

  // 方向键 / WASD；触摸滑动由 Game2048Board 内部处理
  useGame2048Input({
    onMove: handleMove,
    enabled: canPlay,
    keyboard: true,
    touch: false,
  })

  // 刷新最高分
  useEffect(() => {
    if (score > best) {
      setBest(score)
      writeBestScore(score)
    }
  }, [score, best])

  const bestLabel = useMemo(() => `最高分 ${best}`, [best])

  return (
    <div className="gh-page-container gh-g2048-page">
      <header className="gh-g2048-topbar">
        <div className="gh-g2048-topbar-copy">
          <p className="gh-g2048-eyebrow">
            <Link to="/games">← 游戏大厅</Link>
          </p>
          <h1 className="gh-g2048-title">2048</h1>
          <p className="gh-g2048-subtitle">合并相同数字，合成 2048 方块。最高分保存在本机浏览器。</p>
        </div>
        <div className="gh-g2048-actions">
          <Link className="gh-btn gh-btn--secondary gh-btn--md" to={GAME_2048_ONLINE_ROUTE}>
            好友对战
          </Link>
        </div>
      </header>

      <div className="gh-g2048-scoreboard">
        <div className="gh-g2048-score-card">
          <span className="gh-g2048-score-label">分数</span>
          <strong className="gh-g2048-score-value" aria-live="polite">
            {score}
          </strong>
        </div>
        <div className="gh-g2048-score-card">
          <span className="gh-g2048-score-label">最高分</span>
          <strong className="gh-g2048-score-value" aria-label={bestLabel}>
            {best}
          </strong>
        </div>
        <div className="gh-g2048-score-card gh-g2048-score-card--subtle">
          <span className="gh-g2048-score-label">步数</span>
          <strong className="gh-g2048-score-value">{moves}</strong>
        </div>
        <div className="gh-g2048-score-card gh-g2048-score-card--subtle">
          <span className="gh-g2048-score-label">最大方块</span>
          <strong className="gh-g2048-score-value">{bestTile}</strong>
        </div>
      </div>

      <div className="gh-g2048-toolbar">
        <button type="button" className="gh-btn gh-btn--primary gh-btn--md" onClick={handleNewGame}>
          新游戏
        </button>
        <button
          type="button"
          className="gh-btn gh-btn--secondary gh-btn--md"
          onClick={handleUndo}
          disabled={!canUndo}
          title={canUndo ? '撤销上一步移动' : '仅可撤销最近一步'}
        >
          撤销一步
        </button>
        <span className="gh-g2048-toolbar-hint">方向键 / WASD 操作，也可滑动棋盘或使用方向键按钮</span>
      </div>

      <div className="gh-g2048-stage">
        <div className="gh-g2048-board-area">
          <Game2048Board
            board={snapshot.state.board}
            onMove={handleMove}
            disabled={!canPlay}
            label="我的 2048 棋盘"
          />

          {overlayOpen && (
            <div className="gh-g2048-overlay" role="dialog" aria-modal="true" aria-label="本局结果">
              <div className="gh-g2048-overlay-card">
                <p className="gh-g2048-overlay-eyebrow">{won ? '达到目标' : '本局结束'}</p>
                <h2 className="gh-g2048-overlay-title">
                  {won ? '恭喜，合成 2048！' : '无路可走'}
                </h2>
                <p className="gh-g2048-overlay-detail">
                  {won ? '你完成了目标方块，可以继续挑战更高分数。' : '棋盘已满且无法再合并，再来一局吧。'}
                </p>
                <div className="gh-g2048-overlay-scores">
                  <span>
                    分数 <strong>{score}</strong>
                  </span>
                  <span>
                    步数 <strong>{moves}</strong>
                  </span>
                </div>
                <div className="gh-g2048-overlay-actions">
                  {won && (
                    <button
                      type="button"
                      className="gh-btn gh-btn--secondary gh-btn--lg"
                      onClick={() => setWinDismissed(true)}
                    >
                      继续挑战
                    </button>
                  )}
                  <button type="button" className="gh-btn gh-btn--primary gh-btn--lg" onClick={handleNewGame}>
                    再来一局
                  </button>
                </div>
                <Link className="gh-g2048-overlay-link" to="/games">
                  返回游戏大厅
                </Link>
              </div>
            </div>
          )}
        </div>

        <aside className="gh-g2048-help" aria-label="玩法说明">
          <h2>玩法说明</h2>
          <ul>
            <li>滑动或按方向键移动方块，相同数字相撞时合并。</li>
            <li>每次有效移动后会随机出现一个 2 或 4。</li>
            <li>合成 2048 即获胜；棋盘无处可动时结束。</li>
          </ul>
          <p className="gh-g2048-help-note">
            当前步数 {moves}，最大方块 {bestTile}。联机对战请从右上角进入「好友对战」。
          </p>
          <Link to="/games" className="gh-g2048-help-link">
            返回游戏大厅
          </Link>
        </aside>
      </div>
    </div>
  )
}
