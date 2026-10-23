import UserAvatar from '../UserAvatar'
import GameFriendPicker from './GameFriendPicker'
import type { Game2048Match, GameFriend, GameInvite } from '../../types/game'

const MAX_PLAYERS = 10

export interface GameRoomPanelProps {
  match: Game2048Match
  meId: number
  friends: GameFriend[]
  incomingInvites: GameInvite[]
  outgoingInvites: GameInvite[]
  friendsLoading?: boolean
  friendsError?: string | null
  highlightFriendId?: number | null
  busyKey?: string | null
  error?: string | null
  /** 房主选择的竞速时长（分钟） */
  durationMinutes: number
  onDurationChange: (minutes: number) => void
  onInvite: (friendId: number) => void | Promise<void>
  onCancelInvite: (inviteId: number) => void | Promise<void>
  onRespondInvite: (inviteId: number, action: 'accept' | 'decline') => void | Promise<void>
  onStart: () => void | Promise<void>
  onLeave: () => void | Promise<void>
  onRefresh: () => void
}

/**
 * 2048 等待房间：展示已加入玩家（最多 10 人）、房主开始按钮与邀请好友入口。
 * 房间内不做棋盘渲染；房主开始后由 GameMatchPanel 接管。
 */
export default function GameRoomPanel({
  match,
  meId,
  friends,
  incomingInvites,
  outgoingInvites,
  friendsLoading = false,
  friendsError = null,
  highlightFriendId = null,
  busyKey = null,
  error = null,
  durationMinutes,
  onDurationChange,
  onInvite,
  onCancelInvite,
  onRespondInvite,
  onStart,
  onLeave,
  onRefresh,
}: GameRoomPanelProps) {
  const isHost = match.hostId === meId
  const playerCount = match.players.length
  const isFull = playerCount >= MAX_PLAYERS
  const canStart = isHost && playerCount >= 2

  return (
    <section className="gh-game-room" aria-label="2048 等待房间">
      <header className="gh-game-room-header">
        <div>
          <p className="gh-g2048-eyebrow">2048 好友房间</p>
          <h1 className="gh-games-title">等待玩家加入</h1>
          <p className="gh-games-subtitle">
            房主开始后，所有玩家使用完全相同的初始棋盘同步竞速；最多 {MAX_PLAYERS} 人。
          </p>
        </div>
        <span className="gh-game-room-count">
          {playerCount}/{MAX_PLAYERS}
        </span>
      </header>

      {error && (
        <div className="gh-alert gh-alert--danger gh-game-alert" role="alert">
          {error}
        </div>
      )}

      <div className="gh-game-room-actions">
        {isHost ? (
          <>
            <label className="gh-game-room-duration">
              <span>竞速时长</span>
              <select
                className="gh-input gh-game-room-duration-select"
                value={durationMinutes}
                onChange={(event) => onDurationChange(Number(event.target.value))}
                disabled={busyKey === 'start'}
                aria-label="选择竞速时长"
              >
                {[1, 3, 5, 10, 15, 20, 30, 45, 60].map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} 分钟
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="gh-btn gh-btn--primary gh-btn--lg"
              onClick={() => void onStart()}
              disabled={!canStart || busyKey === 'start'}
            >
              {busyKey === 'start' ? '正在开始…' : `开始游戏（${playerCount}/${MAX_PLAYERS}）`}
            </button>
          </>
        ) : (
          <span className="gh-game-room-waiting">等待房主开始游戏…（竞速时长由房主选择）</span>
        )}
        <button
          type="button"
          className="gh-btn gh-btn--danger gh-btn--md"
          onClick={() => void onLeave()}
          disabled={busyKey === 'leave'}
        >
          {busyKey === 'leave' ? '正在离开…' : isHost ? '解散房间' : '离开房间'}
        </button>
      </div>

      {isHost && playerCount < 2 && (
        <p className="gh-game-room-hint">至少邀请 1 位好友加入后才能开始。</p>
      )}
      {isFull && <p className="gh-game-room-hint">房间已满（{MAX_PLAYERS} 人），可以开始游戏。</p>}

      <section className="gh-game-room-players" aria-label="房间玩家">
        <h2 className="gh-game-room-section-title">玩家（{playerCount}/{MAX_PLAYERS}）</h2>
        <ul className="gh-game-room-player-list">
          {match.players.map((player) => {
            const isMe = player.userId === meId
            const isRoomHost = player.userId === match.hostId
            return (
              <li key={player.userId} className={`gh-game-room-player${isMe ? ' gh-game-room-player--me' : ''}`}>
                <UserAvatar userId={player.userId} username={player.username} size="md" />
                <span className="gh-game-room-player-copy">
                  <span className="gh-game-room-player-name">
                    {player.username}
                    {isRoomHost && <span className="gh-game-room-badge">房主</span>}
                    {isMe && <span className="gh-game-room-badge gh-game-room-badge--me">你</span>}
                  </span>
                  <span className="gh-game-room-player-meta">
                    <span className={`gh-game-presence-dot${player.online ? ' gh-game-presence-dot--online' : ''}`} />
                    {player.online ? '在线' : '离线'} · 等待开始
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="gh-game-room-invite" aria-label="邀请好友">
        <h2 className="gh-game-room-section-title">邀请好友</h2>
        {isFull ? (
          <p className="gh-game-room-hint">房间已满，不能再邀请。</p>
        ) : (
          <GameFriendPicker
            friends={friends}
            incomingInvites={incomingInvites}
            outgoingInvites={outgoingInvites}
            loading={friendsLoading}
            error={friendsError}
            highlightFriendId={highlightFriendId}
            excludeIds={match.players.map((player) => player.userId)}
            busyKey={busyKey}
            onInvite={onInvite}
            onCancelInvite={onCancelInvite}
            onRespondInvite={onRespondInvite}
            onRefresh={onRefresh}
          />
        )}
      </section>
    </section>
  )
}
