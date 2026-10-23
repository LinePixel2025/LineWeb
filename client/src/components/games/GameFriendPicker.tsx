import UserAvatar from '../UserAvatar'
import type { GameFriend, GameInvite } from '../../types/game'

export interface GameFriendPickerProps {
  friends: GameFriend[]
  incomingInvites: GameInvite[]
  outgoingInvites: GameInvite[]
  loading?: boolean
  error?: string | null
  /** URL ?friend= 指定的好友，高亮提示 */
  highlightFriendId?: number | null
  /** 已在房间中的玩家，不再显示邀请按钮 */
  excludeIds?: number[]
  /** 正在处理的动作 key（invite-1 / cancel-2 / respond-3） */
  busyKey?: string | null
  onInvite: (friendId: number) => void | Promise<void>
  onCancelInvite: (inviteId: number) => void | Promise<void>
  onRespondInvite: (inviteId: number, action: 'accept' | 'decline') => void | Promise<void>
  onRefresh?: () => void
}

/**
 * 联机大厅好友选择器：展示在线状态 / 对局中状态，支持发出、取消、接受、拒绝邀请。
 * 拉取数据由页面负责，本组件只做展示与回调。
 */
export default function GameFriendPicker({
  friends,
  incomingInvites,
  outgoingInvites,
  loading = false,
  error = null,
  highlightFriendId = null,
  excludeIds = [],
  busyKey = null,
  onInvite,
  onCancelInvite,
  onRespondInvite,
  onRefresh,
}: GameFriendPickerProps) {
  const outgoingByFriendId = new Map<number, GameInvite>()
  for (const invite of outgoingInvites) outgoingByFriendId.set(invite.to.id, invite)

  if (loading) {
    return (
      <div className="gh-game-list-state" role="status">
        <div className="gh-spinner" />
        <span>正在加载好友…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="gh-game-list-state gh-game-list-state--error" role="alert">
        <p className="gh-game-list-state-title">好友列表加载失败</p>
        <p className="gh-game-list-state-hint">{error}</p>
        {onRefresh && (
          <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={onRefresh}>
            重试
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="gh-game-friend-picker">
      {incomingInvites.length > 0 && (
        <section className="gh-game-friend-section" aria-label="收到的对战邀请">
          <h2 className="gh-game-friend-section-title">收到的邀请（{incomingInvites.length}）</h2>
          <ul className="gh-game-friend-list">
            {incomingInvites.map((invite) => (
              <li key={invite.id} className="gh-game-friend-row gh-game-friend-row--invite">
                <UserAvatar userId={invite.from.id} username={invite.from.username} size="md" />
                <span className="gh-game-friend-copy">
                  <span className="gh-game-friend-name">{invite.from.username}</span>
                  <span className="gh-game-friend-meta">邀请你进行 2048 对战</span>
                </span>
                <span className="gh-game-friend-actions">
                  <button
                    type="button"
                    className="gh-btn gh-btn--primary gh-btn--md"
                    disabled={busyKey === `respond-${invite.id}`}
                    onClick={() => void onRespondInvite(invite.id, 'accept')}
                    aria-label={`接受 ${invite.from.username} 的对战邀请`}
                  >
                    接受
                  </button>
                  <button
                    type="button"
                    className="gh-btn gh-btn--secondary gh-btn--md"
                    disabled={busyKey === `respond-${invite.id}`}
                    onClick={() => void onRespondInvite(invite.id, 'decline')}
                    aria-label={`拒绝 ${invite.from.username} 的对战邀请`}
                  >
                    拒绝
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="gh-game-friend-section" aria-label="好友列表">
        <h2 className="gh-game-friend-section-title">
          好友（{friends.filter((friend) => !excludeIds.includes(friend.id)).length}）
        </h2>
        {friends.filter((friend) => !excludeIds.includes(friend.id)).length === 0 ? (
          <div className="gh-game-list-state">
            <p className="gh-game-list-state-title">没有可邀请的好友</p>
            <p className="gh-game-list-state-hint">
              可能好友已在房间中，或还没有添加好友。可在聊天页搜索用户名添加好友。
            </p>
          </div>
        ) : (
          <ul className="gh-game-friend-list">
            {friends
              .filter((friend) => !excludeIds.includes(friend.id))
              .map((friend) => {
              const outgoing = outgoingByFriendId.get(friend.id)
              const highlighted = highlightFriendId === friend.id
              const disabled = !friend.online || friend.inMatch
              return (
                <li
                  key={friend.id}
                  className={[
                    'gh-game-friend-row',
                    highlighted ? 'gh-game-friend-row--highlight' : '',
                    friend.inMatch ? 'gh-game-friend-row--busy' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  data-friend-id={friend.id}
                >
                  <span className="gh-game-friend-avatar">
                    <UserAvatar userId={friend.id} username={friend.username} size="md" />
                    <span
                      className={`gh-game-online-dot${friend.online ? ' gh-game-online-dot--online' : ''}`}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="gh-game-friend-copy">
                    <span className="gh-game-friend-name">
                      {friend.username}
                      {highlighted && <span className="gh-game-friend-hint">来自聊天邀请</span>}
                    </span>
                    <span className="gh-game-friend-meta">
                      {friend.online ? '在线' : '离线'}
                      {friend.inMatch ? ' · 房间/对局中' : ''}
                    </span>
                  </span>
                  <span className="gh-game-friend-actions">
                    {outgoing ? (
                      <button
                        type="button"
                        className="gh-btn gh-btn--secondary gh-btn--md"
                        disabled={busyKey === `cancel-${outgoing.id}`}
                        onClick={() => void onCancelInvite(outgoing.id)}
                        aria-label={`取消邀请 ${friend.username}`}
                      >
                        取消邀请
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="gh-btn gh-btn--primary gh-btn--md"
                        disabled={disabled || busyKey === `invite-${friend.id}`}
                        onClick={() => void onInvite(friend.id)}
                        aria-label={`邀请 ${friend.username} 对战`}
                        title={!friend.online ? '对方不在线' : friend.inMatch ? '对方正在房间/对局中' : undefined}
                      >
                        {friend.inMatch ? '房间/对局中' : '邀请对战'}
                      </button>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
