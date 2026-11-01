import UserAvatar from '../UserAvatar'
import { getGameCatalogEntry } from '../../lib/games/catalog'
import type { GameFriend, GameInvite, GameKind } from '../../types/game'

/** 邀请徽章文案里的游戏名（未知 id 兜底为「2048」，与旧邀请载荷缺省 game 一致） */
function gameNameOf(game?: GameKind): string {
  return getGameCatalogEntry(game ?? '2048')?.name ?? '2048'
}

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
  /**
   * standalone：联机大厅首页使用，自带卡片外壳与内边距；
   * embedded：等待房间内部使用，外层房间卡已经提供留白。
   */
  variant?: 'standalone' | 'embedded'
}

interface FriendRowProps {
  friend: GameFriend
  outgoing?: GameInvite
  highlighted: boolean
  busyKey: string | null
  onInvite: (friendId: number) => void | Promise<void>
  onCancelInvite: (inviteId: number) => void | Promise<void>
}

function FriendRow({
  friend,
  outgoing,
  highlighted,
  busyKey,
  onInvite,
  onCancelInvite,
}: FriendRowProps) {
  const disabled = !friend.online || friend.inMatch
  return (
    <li
      className={[
        'gh-game-friend-row',
        highlighted ? 'gh-game-friend-row--highlight' : '',
        friend.inMatch ? 'gh-game-friend-row--busy' : '',
        friend.online ? '' : 'gh-game-friend-row--offline',
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
          {friend.inMatch ? '房间/对局中' : friend.online ? '在线 · 可邀请' : '离线 · 无法接收邀请'}
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
            className={`gh-btn gh-btn--md ${friend.online && !friend.inMatch ? 'gh-btn--primary' : 'gh-btn--secondary'}`}
            disabled={disabled || busyKey === `invite-${friend.id}`}
            onClick={() => void onInvite(friend.id)}
            aria-label={`邀请 ${friend.username} 对战`}
            title={!friend.online ? '对方不在线' : friend.inMatch ? '对方正在房间/对局中' : undefined}
          >
            {friend.inMatch ? '对局中' : friend.online ? '邀请' : '离线'}
          </button>
        )}
      </span>
    </li>
  )
}

/**
 * 联机大厅好友选择器：展示在线状态 / 对局中状态，支持发出、取消、接受、拒绝邀请。
 *
 * 排序口径：收到的邀请 → 在线好友 → 离线好友。离线好友保留但按钮禁用，
 * 避免玩家反复点击「邀请」却不知道对方收不到。
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
  variant = 'standalone',
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

  const available = friends.filter((friend) => !excludeIds.includes(friend.id))
  const online = available.filter((friend) => friend.online)
  const offline = available.filter((friend) => !friend.online)
  const sortByName = (list: GameFriend[]) => [...list].sort((a, b) => a.username.localeCompare(b.username, 'zh-CN'))

  return (
    <div className={`gh-game-friend-picker${variant === 'standalone' ? ' gh-game-friend-picker--panel' : ''}`}>
      <div className="gh-game-friend-flow" aria-label="联机开桌流程">
        <span className="gh-game-friend-flow-step"><b>1</b> 邀请在线好友</span>
        <span className="gh-game-friend-flow-arrow" aria-hidden="true">→</span>
        <span className="gh-game-friend-flow-step"><b>2</b> 对方接受邀请</span>
        <span className="gh-game-friend-flow-arrow" aria-hidden="true">→</span>
        <span className="gh-game-friend-flow-step"><b>3</b> 入座后房主开始</span>
      </div>

      {incomingInvites.length > 0 && (
        <section className="gh-game-friend-section gh-game-friend-section--incoming" aria-label="收到的对战邀请">
          <h2 className="gh-game-friend-section-title">
            收到的邀请
            <span className="gh-game-friend-count">{incomingInvites.length}</span>
          </h2>
          <ul className="gh-game-friend-list">
            {incomingInvites.map((invite) => (
              <li key={invite.id} className="gh-game-friend-row gh-game-friend-row--invite">
                <UserAvatar userId={invite.from.id} username={invite.from.username} size="md" />
                <span className="gh-game-friend-copy">
                  <span className="gh-game-friend-name">{invite.from.username}</span>
                  <span className="gh-game-friend-meta">邀请你进行 {gameNameOf(invite.game)} 对战</span>
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

      <section className="gh-game-friend-section" aria-label="在线好友">
        <h2 className="gh-game-friend-section-title">
          在线好友
          <span className="gh-game-friend-count gh-game-friend-count--online">{online.length}</span>
        </h2>
        {online.length === 0 ? (
          <div className="gh-game-list-state gh-game-list-state--compact">
            <p className="gh-game-list-state-title">当前没有可邀请的在线好友</p>
            <p className="gh-game-list-state-hint">
              可能对方已在房间中；离线好友收不到邀请，可以先去聊天页约人，或让对方打开 LineWeb 后刷新列表。
            </p>
          </div>
        ) : (
          <ul className="gh-game-friend-list">
            {sortByName(online).map((friend) => (
              <FriendRow
                key={friend.id}
                friend={friend}
                outgoing={outgoingByFriendId.get(friend.id)}
                highlighted={highlightFriendId === friend.id}
                busyKey={busyKey}
                onInvite={onInvite}
                onCancelInvite={onCancelInvite}
              />
            ))}
          </ul>
        )}
      </section>

      {offline.length > 0 && (
        <details className="gh-game-friend-section gh-game-friend-section--offline">
          <summary className="gh-game-friend-section-title">
            离线好友
            <span className="gh-game-friend-count">{offline.length}</span>
            <span className="gh-game-friend-summary-hint">展开后无法邀请</span>
          </summary>
          <ul className="gh-game-friend-list">
            {sortByName(offline).map((friend) => (
              <FriendRow
                key={friend.id}
                friend={friend}
                outgoing={outgoingByFriendId.get(friend.id)}
                highlighted={highlightFriendId === friend.id}
                busyKey={busyKey}
                onInvite={onInvite}
                onCancelInvite={onCancelInvite}
              />
            ))}
          </ul>
        </details>
      )}

      {available.length === 0 && (
        <div className="gh-game-list-state">
          <p className="gh-game-list-state-title">没有可邀请的好友</p>
          <p className="gh-game-list-state-hint">
            可能好友已在房间中，或还没有添加好友。可在聊天页搜索用户名添加好友。
          </p>
        </div>
      )}
    </div>
  )
}
