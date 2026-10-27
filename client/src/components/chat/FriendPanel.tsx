import { useEffect, useState } from 'react'
import UserAvatar from '../UserAvatar'
import { contactLabel } from '../../lib/chat'
import type {
  ChatUser,
  NekoContact,
  NekoDirectoryUser,
  NekoFriendRequest,
} from '../../types/chat'

interface Props {
  friends: NekoContact[]
  incoming: NekoFriendRequest[]
  outgoing: NekoFriendRequest[]
  loading?: boolean
  onAcceptRequest: (request: NekoFriendRequest) => void | Promise<void>
  onRejectRequest: (request: NekoFriendRequest) => void | Promise<void>
  onRemoveFriend: (contact: NekoContact) => void | Promise<void>
  /** 发起私聊：好友传 NekoContact，搜索到的 neko 原生用户传 NekoDirectoryUser */
  onStartDirect: (target: NekoContact | NekoDirectoryUser) => void | Promise<void>
  /** LineWeb 用户搜索（LineWeb 好友申请走 Prisma） */
  searchUsers: (query: string) => Promise<ChatUser[]>
  /** neko 目录搜索（可搜到原生账号） */
  searchDirectory: (query: string) => Promise<NekoDirectoryUser[]>
  onAddFriend: (linewebId: number) => void | Promise<void>
  /** 向 neko 原生账号发起好友申请 */
  onAddNativeFriend: (nekoId: number) => void | Promise<void>
  /** 邀请好友进行联机对战（仅 LineWeb 好友可用；未传则不渲染按钮） */
  onInviteGame?: (linewebId: number) => void
}

const SEARCH_DELAY = 300

function relationLabel(relation: ChatUser['relation']): string {
  switch (relation) {
    case 'friend':
      return '已是好友'
    case 'outgoing':
      return '已发送申请'
    case 'incoming':
      return '待你处理'
    default:
      return ''
  }
}

/** 头像 id：LineWeb 用户用真实 id，neko 原生账号用负数（UserAvatar 不请求头像，走首字母） */
function avatarIdOf(linewebId: number | null, nekoId: number): number {
  return linewebId && linewebId > 0 ? linewebId : -nekoId
}

export default function FriendPanel({
  friends,
  incoming,
  outgoing,
  loading = false,
  onAcceptRequest,
  onRejectRequest,
  onRemoveFriend,
  onStartDirect,
  searchUsers,
  searchDirectory,
  onAddFriend,
  onAddNativeFriend,
  onInviteGame,
}: Props) {
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<ChatUser[]>([])
  const [natives, setNatives] = useState<NekoDirectoryUser[]>([])
  const [searching, setSearching] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  // 本次会话内已发出的原生好友申请（refresh 后以 outgoing 为准）
  const [requestedNatives, setRequestedNatives] = useState<number[]>([])

  const friendNekoIds = new Set(friends.map((friend) => friend.nekoId))
  const outgoingNekoIds = new Set(
    outgoing.filter((request) => request.source === 'neko').map((request) => request.nekoId),
  )

  useEffect(() => {
    const keyword = query.trim()
    if (!keyword) {
      setUsers([])
      setNatives([])
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(() => {
      Promise.all([
        searchUsers(keyword).catch(() => [] as ChatUser[]),
        searchDirectory(keyword).catch(() => [] as NekoDirectoryUser[]),
      ])
        .then(([userList, directory]) => {
          if (cancelled) return
          setUsers(userList)
          const usernames = new Set(userList.map((user) => user.username))
          setNatives(
            directory.filter((user) => !user.isLineWeb && !usernames.has(user.username)),
          )
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, SEARCH_DELAY)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, searchUsers, searchDirectory])

  const run = async (key: string, action: () => void | Promise<void>) => {
    setBusyKey(key)
    try {
      await action()
    } catch {
      // 错误由页面统一展示
    } finally {
      setBusyKey(null)
    }
  }

  const handleAdd = async (user: ChatUser) => {
    setBusyKey(`add-${user.id}`)
    try {
      await onAddFriend(user.id)
      setUsers((prev) =>
        prev.map((item) => (item.id === user.id ? { ...item, relation: 'outgoing' } : item)),
      )
    } catch {
      // ignore
    } finally {
      setBusyKey(null)
    }
  }

  const handleAddNative = async (user: NekoDirectoryUser) => {
    setBusyKey(`add-native-${user.nekoId}`)
    try {
      await onAddNativeFriend(user.nekoId)
      setRequestedNatives((prev) =>
        prev.includes(user.nekoId) ? prev : [...prev, user.nekoId],
      )
    } catch {
      // 错误由页面统一展示
    } finally {
      setBusyKey(null)
    }
  }

  if (loading) {
    return (
      <div className="gh-chat-list-state">
        <div className="gh-spinner" />
        <span>正在加载好友…</span>
      </div>
    )
  }

  const hasResults = users.length > 0 || natives.length > 0

  return (
    <div className="gh-chat-friends">
      <div className="gh-chat-search">
        <input
          className="gh-input gh-chat-search-input"
          type="search"
          value={query}
          placeholder="搜索用户名或 neko 用户"
          aria-label="搜索用户"
          onChange={(event) => setQuery(event.target.value)}
        />
        {searching && <span className="gh-chat-search-state">搜索中…</span>}
      </div>

      {query.trim() !== '' && (
        <section className="gh-chat-friend-section">
          <h3 className="gh-chat-friend-section-title">搜索结果</h3>
          {!searching && !hasResults && <p className="gh-chat-friend-empty">没有找到匹配的用户</p>}
          <ul className="gh-chat-friend-list">
            {users.map((user) => {
              const relation = relationLabel(user.relation)
              return (
                <li key={`user-${user.id}`} className="gh-chat-friend-row">
                  <UserAvatar userId={user.id} username={user.username} size="sm" />
                  <span className="gh-chat-friend-name">{user.username}</span>
                  {relation ? (
                    <span className="gh-chat-friend-relation">{relation}</span>
                  ) : (
                    <button
                      type="button"
                      className="gh-btn gh-btn--primary gh-btn--sm"
                      disabled={busyKey === `add-${user.id}`}
                      onClick={() => void handleAdd(user)}
                    >
                      添加好友
                    </button>
                  )}
                </li>
              )
            })}
            {natives.map((user) => {
              const rowKey = `native-${user.nekoId}`
              const isFriend = friendNekoIds.has(user.nekoId)
              const requested =
                requestedNatives.includes(user.nekoId) || outgoingNekoIds.has(user.nekoId)
              return (
                <li key={rowKey} className="gh-chat-friend-row">
                  <UserAvatar
                    userId={avatarIdOf(user.linewebId, user.nekoId)}
                    username={user.displayName || user.username}
                    size="sm"
                  />
                  <span className="gh-chat-friend-name">
                    {contactLabel(user)}
                    <span className="gh-chat-member-tag">neko</span>
                  </span>
                  <span className="gh-chat-friend-actions">
                    {isFriend ? (
                      <span className="gh-chat-friend-relation">已是好友</span>
                    ) : requested ? (
                      <span className="gh-chat-friend-relation">已发送申请</span>
                    ) : (
                      <button
                        type="button"
                        className="gh-btn gh-btn--secondary gh-btn--sm"
                        disabled={busyKey === `add-native-${user.nekoId}`}
                        onClick={() => void handleAddNative(user)}
                      >
                        加好友
                      </button>
                    )}
                    <button
                      type="button"
                      className="gh-btn gh-btn--primary gh-btn--sm"
                      disabled={busyKey === `chat-${rowKey}`}
                      onClick={() => {
                        setBusyKey(`chat-${rowKey}`)
                        setQuery('')
                        setUsers([])
                        setNatives([])
                        void onStartDirect(user)
                        setBusyKey(null)
                      }}
                    >
                      发消息
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {incoming.length > 0 && (
        <section className="gh-chat-friend-section">
          <h3 className="gh-chat-friend-section-title">好友申请（{incoming.length}）</h3>
          <ul className="gh-chat-friend-list">
            {incoming.map((request) => (
              <li key={request.id} className="gh-chat-friend-row">
                <UserAvatar
                  userId={avatarIdOf(request.linewebId, request.nekoId)}
                  username={request.displayName || request.username}
                  size="sm"
                />
                <span className="gh-chat-friend-name">
                  {contactLabel(request)}
                  {request.source === 'neko' && <span className="gh-chat-member-tag">neko</span>}
                </span>
                <span className="gh-chat-friend-actions">
                  <button
                    type="button"
                    className="gh-btn gh-btn--primary gh-btn--sm"
                    disabled={busyKey === `accept-${request.id}`}
                    onClick={() => void run(`accept-${request.id}`, () => onAcceptRequest(request))}
                  >
                    接受
                  </button>
                  <button
                    type="button"
                    className="gh-btn gh-btn--secondary gh-btn--sm"
                    disabled={busyKey === `reject-${request.id}`}
                    onClick={() => void run(`reject-${request.id}`, () => onRejectRequest(request))}
                  >
                    拒绝
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="gh-chat-friend-section">
        <h3 className="gh-chat-friend-section-title">好友（{friends.length}）</h3>
        {friends.length === 0 ? (
          <p className="gh-chat-friend-empty">还没有好友，搜索用户名添加好友吧。</p>
        ) : (
          <ul className="gh-chat-friend-list">
            {friends.map((friend) => {
              const linewebId = friend.linewebId
              return (
                <li key={friend.key} className="gh-chat-friend-row">
                  <UserAvatar
                    userId={avatarIdOf(friend.linewebId, friend.nekoId)}
                    username={friend.displayName || friend.username}
                    size="sm"
                  />
                  <span className="gh-chat-friend-name">{contactLabel(friend)}</span>
                  <span className="gh-chat-friend-actions">
                    {onInviteGame && linewebId !== null && (
                      <button
                        type="button"
                        className="gh-chat-game-btn"
                        aria-label="邀请对战"
                        title="邀请对战"
                        onClick={() => onInviteGame(linewebId)}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
                          <path d="M6.5 4a3.5 3.5 0 0 0-3.46 2.97l-.7 4.2a1.2 1.2 0 0 0 2.05 1.07l1.2-1.2h4.82l1.2 1.2a1.2 1.2 0 0 0 2.05-1.07l-.7-4.2A3.5 3.5 0 0 0 9.5 4h-3ZM5 6h1v1h1v1H6v1H5V8H4V7h1V6Zm5.25 1.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Zm-1.5 1.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Z" />
                        </svg>
                      </button>
                    )}
                    <button
                      type="button"
                      className="gh-btn gh-btn--primary gh-btn--sm"
                      disabled={busyKey === `chat-${friend.key}`}
                      onClick={() => void run(`chat-${friend.key}`, () => onStartDirect(friend))}
                    >
                      发消息
                    </button>
                    <button
                      type="button"
                      className="gh-btn gh-btn--danger gh-btn--sm"
                      disabled={busyKey === `remove-${friend.key}`}
                      onClick={() => {
                        if (!window.confirm(`确定删除好友 ${friend.displayName || friend.username} 吗？`)) return
                        void run(`remove-${friend.key}`, () => onRemoveFriend(friend))
                      }}
                    >
                      删除
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {outgoing.length > 0 && (
        <section className="gh-chat-friend-section">
          <h3 className="gh-chat-friend-section-title">已发送的申请</h3>
          <ul className="gh-chat-friend-list">
            {outgoing.map((request) => (
              <li key={request.id} className="gh-chat-friend-row">
                <UserAvatar
                  userId={avatarIdOf(request.linewebId, request.nekoId)}
                  username={request.displayName || request.username}
                  size="sm"
                />
                <span className="gh-chat-friend-name">{contactLabel(request)}</span>
                <span className="gh-chat-friend-relation">等待对方确认</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
