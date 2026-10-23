import Game2048Board from './Game2048Board'
import UserAvatar from '../UserAvatar'
import type { ChatTransport } from '../../types/chat'
import type { Game2048Direction, Game2048Match, Game2048Player } from '../../types/game'

export interface GameMatchPanelProps {
  match: Game2048Match
  /** 当前登录用户 id */
  meId: number
  /** 当前传输模式，用于显示「实时 / 轮询」 */
  transport: ChatTransport
  /** 距离 endsAt 的剩余毫秒（由页面每秒计算） */
  remainingMs: number
  /** 移动请求处理中 */
  moving?: boolean
  onMove: (direction: Game2048Direction) => void
  onResign: () => void
  onBackToLobby: () => void
  onRematch: () => void
}

const REASON_LABEL: Record<NonNullable<Game2048Match['reason']>, string> = {
  target: '率先合成 2048',
  timeout: '时间到，按分数判定',
  resign: '认输',
  forfeit: '掉线判负',
  blocked: '无路可走',
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function playerStatusLabel(player: Game2048Player | null, match: Game2048Match): string {
  if (!player) return ''
  switch (player.status) {
    case 'won':
      return '已达成 2048'
    case 'lost':
      // 已被对手认输/掉线/超时结束的对局，不应误显示为「无路可走」
      if (match.status === 'finished' && match.reason !== 'blocked') return '对局结束'
      return '无路可走'
    default:
      return '对战中'
  }
}

interface ResultCopy {
  title: string
  detail: string
}

/** 把服务端结果（winnerId + reason）翻译成用户可读文案 */
function describeResult(match: Game2048Match, meId: number): ResultCopy {
  const winner = match.players.find((player) => player.userId === match.winnerId) ?? null
  const loser = match.players.find((player) => player.userId !== match.winnerId) ?? null
  const isDraw = match.winnerId === null

  if (isDraw) {
    return {
      title: '平局',
      detail:
        match.reason === 'timeout'
          ? '时间到，双方分数相同，本局平局。'
          : '双方战成平手。',
    }
  }

  const iWon = match.winnerId === meId
  const winnerName = winner?.username ?? '对手'
  const loserName = loser?.username ?? '对手'
  const iLost = loser?.userId === meId

  let detail: string
  switch (match.reason) {
    case 'target':
      detail = `${winnerName} 率先合成 2048，赢下本局。`
      break
    case 'blocked':
      detail = `${loserName} 无路可走，${winnerName} 获胜。`
      break
    case 'resign':
      detail = iLost ? '你选择了认输。' : `${loserName} 认输，你赢下本局。`
      break
    case 'forfeit':
      detail = iLost ? '你掉线超时，本局判负。' : `${loserName} 掉线超时，你赢下本局。`
      break
    case 'timeout':
      detail = `时间到，${winnerName} 分数更高，赢下本局。`
      break
    default:
      detail = '对局已结束。'
      break
  }

  return { title: iWon ? '你获胜了' : `${winnerName} 获胜`, detail }
}

/**
 * 联机对局面板：双方比分、我方棋盘（含方向键）、对手缩略棋盘与结算浮层。
 * 所有网络请求由页面（Game2048OnlinePage）负责，本组件只展示与回调。
 */
export default function GameMatchPanel({
  match,
  meId,
  transport,
  remainingMs,
  moving = false,
  onMove,
  onResign,
  onBackToLobby,
  onRematch,
}: GameMatchPanelProps) {
  const me = match.players.find((player) => player.userId === meId) ?? null
  const opponent = match.players.find((player) => player.userId !== meId) ?? null
  const finished = match.status === 'finished'
  const canMove = !finished && me !== null && me.status === 'playing'
  const lowTime = !finished && remainingMs > 0 && remainingMs < 60_000
  const result = finished ? describeResult(match, meId) : null

  return (
    <section className="gh-game-match" aria-label="2048 联机对局">
      <header className="gh-game-match-header">
        <div className="gh-game-match-opponent">
          {opponent && <UserAvatar userId={opponent.userId} username={opponent.username} size="md" />}
          <div className="gh-game-match-opponent-copy">
            <span className="gh-game-match-eyebrow">对手</span>
            <strong className="gh-game-match-opponent-name">{opponent?.username ?? '等待对手'}</strong>
            {opponent && (
              <span
                className={`gh-game-presence ${opponent.online ? 'gh-game-presence--online' : 'gh-game-presence--offline'}`}
              >
                <span className="gh-game-presence-dot" aria-hidden="true" />
                {opponent.online ? '在线' : '离线'}
              </span>
            )}
          </div>
        </div>

        <div className="gh-game-match-meta">
          <span className={`gh-game-conn-chip gh-game-conn-chip--${transport}`}>
            {transport === 'ws' ? '实时连接' : '轮询模式'}
          </span>
          <span
            className={`gh-game-timer${lowTime ? ' gh-game-timer--low' : ''}`}
            aria-label={finished ? '对局已结束' : `剩余时间 ${formatDuration(remainingMs)}`}
          >
            {finished ? '已结束' : formatDuration(remainingMs)}
          </span>
        </div>
      </header>

      <div className="gh-game-scoreboard" aria-live="polite">
        <div className="gh-game-score-card gh-game-score-card--me">
          <span className="gh-game-score-label">我</span>
          <strong className="gh-game-score-value">{me?.score ?? 0}</strong>
          <span className="gh-game-score-meta">
            最大方块 {me?.maxTile ?? 0} · {playerStatusLabel(me, match)}
          </span>
        </div>
        <span className="gh-game-score-vs" aria-hidden="true">
          VS
        </span>
        <div className="gh-game-score-card">
          <span className="gh-game-score-label">{opponent?.username ?? '对手'}</span>
          <strong className="gh-game-score-value">{opponent?.score ?? 0}</strong>
          <span className="gh-game-score-meta">
            最大方块 {opponent?.maxTile ?? 0} · {playerStatusLabel(opponent, match)}
          </span>
        </div>
      </div>

      <div className="gh-game-boards">
        <div className="gh-game-board-panel">
          <div className="gh-game-board-panel-head">
            <h2 className="gh-game-board-panel-title">我的棋盘</h2>
            {moving && <span className="gh-game-board-panel-state">同步中…</span>}
          </div>
          <Game2048Board
            board={me?.board ?? []}
            onMove={canMove ? onMove : undefined}
            disabled={!canMove}
            label="我的 2048 棋盘"
          />
        </div>

        <aside className="gh-game-opponent-panel">
          <div className="gh-game-board-panel-head">
            <h2 className="gh-game-board-panel-title">对手棋盘</h2>
          </div>
          <Game2048Board
            board={opponent?.board ?? []}
            variant="mini"
            disabled
            label={`${opponent?.username ?? '对手'}的棋盘`}
          />
          <button
            type="button"
            className="gh-btn gh-btn--danger gh-btn--md gh-game-resign"
            onClick={onResign}
            disabled={finished}
          >
            认输
          </button>
        </aside>
      </div>

      {finished && result && (
        <div className="gh-game-result" role="dialog" aria-modal="true" aria-label="对局结果">
          <div className="gh-game-result-card">
            <p className="gh-game-result-eyebrow">对局结束</p>
            <h2 className="gh-game-result-title">{result.title}</h2>
            <p className="gh-game-result-detail">{result.detail}</p>
            {(match.reason || match.winnerId !== null) && (
              <p className="gh-game-result-reason">
                {match.reason ? REASON_LABEL[match.reason] : '对局结束'}
              </p>
            )}
            <div className="gh-game-result-scores">
              <span>
                我 <strong>{me?.score ?? 0}</strong>
              </span>
              <span>
                {opponent?.username ?? '对手'} <strong>{opponent?.score ?? 0}</strong>
              </span>
            </div>
            <div className="gh-game-result-actions">
              <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={onBackToLobby}>
                返回大厅
              </button>
              <button type="button" className="gh-btn gh-btn--primary gh-btn--md" onClick={onRematch}>
                再来一局
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
