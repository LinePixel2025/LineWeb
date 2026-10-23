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
  last_standing: '最后存活',
  elimination: '全部出局，按分数判定',
  cancelled: '房间已解散',
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function playerStatusLabel(player: Game2048Player, match: Game2048Match): string {
  switch (player.status) {
    case 'waiting':
      return '等待开始'
    case 'won':
      return '已达成 2048'
    case 'lost':
      if (match.status === 'finished' && match.reason !== 'blocked') return '对局结束'
      return '已出局'
    default:
      return '竞速中'
  }
}

interface ResultCopy {
  title: string
  detail: string
}

/** 把服务端结果（winnerId + reason）翻译成用户可读文案 */
function describeResult(match: Game2048Match, meId: number): ResultCopy {
  const winner = match.players.find((player) => player.userId === match.winnerId) ?? null
  const winnerName = winner?.username ?? '对手'
  const iWon = match.winnerId === meId

  if (match.winnerId === null) {
    return {
      title: '平局',
      detail:
        match.reason === 'timeout'
          ? '时间到，存活玩家分数相同，本局平局。'
          : '所有玩家均已出局且分数相同，本局平局。',
    }
  }

  switch (match.reason) {
    case 'target':
      return { title: iWon ? '你获胜了' : `${winnerName} 获胜`, detail: `${winnerName} 率先合成 2048，赢下本局。` }
    case 'timeout':
      return { title: iWon ? '你获胜了' : `${winnerName} 获胜`, detail: `时间到，${winnerName} 分数最高，赢下本局。` }
    case 'last_standing':
      return { title: iWon ? '你获胜了' : `${winnerName} 获胜`, detail: `${winnerName} 成为最后存活的玩家。` }
    case 'elimination':
      return { title: iWon ? '你获胜了' : `${winnerName} 获胜`, detail: `所有玩家均已出局，${winnerName} 分数最高。` }
    case 'resign':
      return { title: iWon ? '你获胜了' : `${winnerName} 获胜`, detail: `${winnerName} 成为最后存活的玩家（其余玩家认输）。` }
    case 'forfeit':
      return { title: iWon ? '你获胜了' : `${winnerName} 获胜`, detail: `${winnerName} 成为最后存活的玩家（其余玩家掉线）。` }
    case 'blocked':
      return { title: iWon ? '你获胜了' : `${winnerName} 获胜`, detail: `${winnerName} 成为最后存活的玩家（其余玩家无路可走）。` }
    case 'cancelled':
      return { title: '房间已解散', detail: '房主解散了房间，本局未开始。' }
    default:
      return { title: iWon ? '你获胜了' : `${winnerName} 获胜`, detail: '对局已结束。' }
  }
}

/**
 * 2048 联机对局面板（2–10 人）：
 * - 顶部展示传输模式、计时与所有玩家比分；
 * - 左侧是我的主棋盘，右侧/下方是其他玩家的缩略棋盘；
 * - 结算浮层按 winnerId + reason 展示结果。
 *
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
  const others = match.players.filter((player) => player.userId !== meId)
  const sortedPlayers = [...match.players].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.userId - b.userId
  })
  const sortedOthers = [...others].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.userId - b.userId
  })
  const finished = match.status === 'finished'
  const canMove = !finished && me !== null && me.status === 'playing'
  const lowTime = !finished && remainingMs > 0 && remainingMs < 60_000
  const result = finished ? describeResult(match, meId) : null
  const playerCount = match.players.length
  const durationMinutes = Math.max(1, Math.round((match.durationMs || 10 * 60_000) / 60_000))

  return (
    <section className="gh-game-match" aria-label="2048 联机对局">
      <header className="gh-game-match-header">
        <div className="gh-game-match-opponent">
          <div className="gh-game-match-opponent-copy">
            <span className="gh-game-match-eyebrow">2048 同步竞速</span>
            <strong className="gh-game-match-opponent-name">
              {playerCount} 人同场 · {durationMinutes} 分钟
            </strong>
            <span className={`gh-game-presence ${me?.online ? 'gh-game-presence--online' : 'gh-game-presence--offline'}`}>
              <span className="gh-game-presence-dot" aria-hidden="true" />
              我 {me?.online ? '在线' : '离线'}
            </span>
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
        {sortedPlayers.map((player) => {
          const isMe = player.userId === meId
          const isHost = player.userId === match.hostId
          return (
            <div
              key={player.userId}
              className={`gh-game-score-card${isMe ? ' gh-game-score-card--me' : ''}${player.status === 'lost' ? ' gh-game-score-card--out' : ''}`}
            >
              <span className="gh-game-score-label">
                {player.username}
                {isHost && <span className="gh-game-room-badge">房主</span>}
                {isMe && <span className="gh-game-room-badge gh-game-room-badge--me">你</span>}
              </span>
              <strong className="gh-game-score-value">{player.score}</strong>
              <span className="gh-game-score-meta">
                最大方块 {player.maxTile} · {playerStatusLabel(player, match)}
              </span>
            </div>
          )
        })}
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

        <aside className="gh-game-opponents-panel" aria-label="其他玩家棋盘">
          <div className="gh-game-board-panel-head">
            <h2 className="gh-game-board-panel-title">其他玩家（{sortedOthers.length}）</h2>
          </div>
          <div className="gh-game-opponent-grid">
            {sortedOthers.map((player) => (
              <article
                key={player.userId}
                className={`gh-game-opponent-card${player.status === 'lost' ? ' gh-game-opponent-card--out' : ''}`}
              >
                <header className="gh-game-opponent-card-head">
                  <UserAvatar userId={player.userId} username={player.username} size="sm" />
                  <span className="gh-game-opponent-card-copy">
                    <span className="gh-game-opponent-card-name">{player.username}</span>
                    <span className="gh-game-opponent-card-meta">
                      <span className={`gh-game-presence-dot${player.online ? ' gh-game-presence-dot--online' : ''}`} />
                      {player.online ? '在线' : '离线'} · {playerStatusLabel(player, match)}
                    </span>
                  </span>
                  <strong className="gh-game-opponent-card-score">{player.score}</strong>
                </header>
                <Game2048Board
                  board={player.board}
                  variant="mini"
                  disabled
                  label={`${player.username} 的棋盘`}
                />
              </article>
            ))}
          </div>
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
            {match.reason && <p className="gh-game-result-reason">{REASON_LABEL[match.reason]}</p>}
            <div className="gh-game-result-scores">
              {sortedPlayers.map((player) => (
                <span key={player.userId}>
                  {player.username} <strong>{player.score}</strong>
                </span>
              ))}
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
