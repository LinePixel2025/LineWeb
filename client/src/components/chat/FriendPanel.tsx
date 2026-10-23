import { useEffect, useState } from 'react'
import UserAvatar from '../UserAvatar'
import type { ChatUser, Friend, FriendRequest } from '../../types/chat'

interface Props {
  friends: Friend[]
  incoming: FriendRequest[]
  outgoing: FriendRequest[]
  loading?: boolean
  onAcceptRequest: (requestId: number) => void | Promise<void>
  onRejectRequest: (requestId: number) => void | Promise<void>
  onRemoveFriend: (userId: number) => void | Promise<void>
  onStartDirect: (userId: number) => void | Promise<void>
  searchUsers: (query: string) => Promise<ChatUser[]>
  onAddFriend: (userId: number) => void | Promise<void>
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
  onAddFriend,
}: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ChatUser[]>([])
  const [searching, setSearching] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  useEffect(() => {
    const keyword = query.trim()
    if (!keyword) {
      setResults([])
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(() => {
      searchUsers(keyword)
        .then((users) => {
          if (!cancelled) setResults(users)
        })
        .catch(() => {
          if (!cancelled) setResults([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, SEARCH_DELAY)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, searchUsers])

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
      setResults((prev) => prev.map((item) => (item.id === user.id ? { ...item, relation: 'outgoing' } : item)))
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

  return (
    <div className="gh-chat-friends">
      <div className="gh-chat-search">
        <input
          className="gh-input gh-chat-search-input"
          type="search"
          value={query}
          placeholder="搜索用户名，添加好友"
          aria-label="搜索用户"
          onChange={(event) => setQuery(event.target.value)}
        />
        {searching && <span className="gh-chat-search-state">搜索中…</span>}
      </div>

      {query.trim() !== '' && (
        <section className="gh-chat-friend-section">
          <h3 className="gh-chat-friend-section-title">搜索结果</h3>
          {!searching && results.length === 0 && <p className="gh-chat-friend-empty">没有找到匹配的用户</p>}
          <ul className="gh-chat-friend-list">
            {results.map((user) => {
              const relation = relationLabel(user.relation)
              return (
                <li key={user.id} className="gh-chat-friend-row">
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
                <UserAvatar userId={request.user.id} username={request.user.username} size="sm" />
                <span className="gh-chat-friend-name">{request.user.username}</span>
                <span className="gh-chat-friend-actions">
                  <button
                    type="button"
                    className="gh-btn gh-btn--primary gh-btn--sm"
                    disabled={busyKey === `accept-${request.id}`}
                    onClick={() => void run(`accept-${request.id}`, () => onAcceptRequest(request.id))}
                  >
                    接受
                  </button>
                  <button
                    type="button"
                    className="gh-btn gh-btn--secondary gh-btn--sm"
                    disabled={busyKey === `reject-${request.id}`}
                    onClick={() => void run(`reject-${request.id}`, () => onRejectRequest(request.id))}
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
            {friends.map((friend) => (
              <li key={friend.id} className="gh-chat-friend-row">
                <UserAvatar userId={friend.id} username={friend.username} size="sm" />
                <span className="gh-chat-friend-name">{friend.username}</span>
                <span className="gh-chat-friend-actions">
                  <button
                    type="button"
                    className="gh-btn gh-btn--primary gh-btn--sm"
                    disabled={busyKey === `chat-${friend.id}`}
                    onClick={() => void run(`chat-${friend.id}`, () => onStartDirect(friend.id))}
                  >
                    发消息
                  </button>
                  <button
                    type="button"
                    className="gh-btn gh-btn--danger gh-btn--sm"
                    disabled={busyKey === `remove-${friend.id}`}
                    onClick={() => {
                      if (!window.confirm(`确定删除好友 ${friend.username} 吗？`)) return
                      void run(`remove-${friend.id}`, () => onRemoveFriend(friend.id))
                    }}
                  >
                    删除
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {outgoing.length > 0 && (
        <section className="gh-chat-friend-section">
          <h3 className="gh-chat-friend-section-title">已发送的申请</h3>
          <ul className="gh-chat-friend-list">
            {outgoing.map((request) => (
              <li key={request.id} className="gh-chat-friend-row">
                <UserAvatar userId={request.user.id} username={request.user.username} size="sm" />
                <span className="gh-chat-friend-name">{request.user.username}</span>
                <span className="gh-chat-friend-relation">等待对方确认</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
