import { useEffect, useState } from 'react'
import UserAvatar from '../UserAvatar'
import NekoAvatar from './NekoAvatar'
import UserTitleBadge from '../UserTitleBadge'
import { contactLabel } from '../../lib/chat'
import Icon from '../ui/Icon'
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
  /** 发起私聊 */
  onStartDirect: (target: NekoContact) => void | Promise<void>
  /** LineWeb 用户搜索（LineWeb 好友申请走 Prisma） */
  searchUsers: (query: string) => Promise<ChatUser[]>
  /** 站内用户搜索（目录口径，可发起会话的对象） */
  searchDirectory: (query: string) => Promise<NekoDirectoryUser[]>
  onAddFriend: (linewebId: number) => void | Promise<void>
  /** 邀请好友进行联机对战（仅 LineWeb 好友可用；未传则不渲染按钮） */
  onInviteGame?: (linewebId: number) => void
  /** 设置联系人备注（未传则不渲染按钮） */
  onSetRemark?: (contact: NekoContact) => void
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
  onInviteGame,
  onSetRemark,
}: Props) {
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<ChatUser[]>([])
  const [searching, setSearching] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  useEffect(() => {
    const keyword = query.trim()
    if (!keyword) {
      setUsers([])
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
        .then(([userList]) => {
          if (cancelled) return
          setUsers(userList)
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

  if (loading) {
    return (
      <div className="gh-chat-list-state">
        <div className="gh-spinner" />
        <span>正在加载好友…</span>
      </div>
    )
  }

  const hasResults = users.length > 0

  return (
    <div className="gh-chat-friends">
      <div className="gh-chat-search">
        <input
          className="gh-input gh-chat-search-input"
          type="search"
          value={query}
          placeholder="搜索用户名"
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

          </ul>
        </section>
      )}

      {incoming.length > 0 && (
        <section className="gh-chat-friend-section">
          <h3 className="gh-chat-friend-section-title">好友申请（{incoming.length}）</h3>
          <ul className="gh-chat-friend-list">
            {incoming.map((request) => (
              <li key={request.id} className="gh-chat-friend-row">
                <NekoAvatar
                  nekoId={request.nekoId}
                  avatarVersion={request.avatarVersion ?? 0}
                  fallbackId={avatarIdOf(request.linewebId, request.nekoId)}
                  name={request.displayName || request.username}
                  size="sm"
                />
                <span className="gh-chat-friend-name">
                  {contactLabel(request)}
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
                  <NekoAvatar
                    nekoId={friend.nekoId}
                    avatarVersion={friend.avatarVersion}
                    fallbackId={avatarIdOf(friend.linewebId, friend.nekoId)}
                    name={contactLabel(friend)}
                    size="sm"
                  />
                  <span className="gh-chat-friend-name">
                    <span className="gh-chat-name-text">{contactLabel(friend)}</span>
                    <UserTitleBadge title={friend.title} variant="compact" />
                  </span>
                  <span className="gh-chat-friend-actions">
                    {onInviteGame && linewebId !== null && (
                      <button
                        type="button"
                        className="gh-chat-game-btn"
                        aria-label="邀请对战"
                        title="邀请对战"
                        onClick={() => onInviteGame(linewebId)}
                      >
                        <Icon name="gamepad" size={14} />
                      </button>
                    )}
                    {onSetRemark && (
                      <button
                        type="button"
                        className="gh-btn gh-btn--ghost gh-btn--sm"
                        onClick={() => onSetRemark(friend)}
                      >
                        备注
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
                        if (!window.confirm(`确定删除好友 ${contactLabel(friend)} 吗？`)) return
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
                <NekoAvatar
                  nekoId={request.nekoId}
                  avatarVersion={request.avatarVersion ?? 0}
                  fallbackId={avatarIdOf(request.linewebId, request.nekoId)}
                  name={request.displayName || request.username}
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
