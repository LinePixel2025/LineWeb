import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../lib/api'
import { mergeMessages } from '../lib/chat'
import { useAuth } from '../contexts/AuthContext'
import { useChat } from '../contexts/ChatContext'
import ChatConversationList from '../components/chat/ChatConversationList'
import ChatThread from '../components/chat/ChatThread'
import FriendPanel from '../components/chat/FriendPanel'
import GroupDialog from '../components/chat/GroupDialog'
import type {
  ChatUser,
  Conversation,
  ConversationResponse,
  ConversationsResponse,
  Friend,
  FriendRequestsResponse,
  FriendsResponse,
  Message,
  MessagesResponse,
  SendMessageResponse,
  UserSearchResponse,
} from '../types/chat'

type PanelTab = 'conversations' | 'friends'

type DialogState = { mode: 'create-group' } | { mode: 'add-members' } | null

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    const timeA = Date.parse(a.lastMessageAt || '')
    const timeB = Date.parse(b.lastMessageAt || '')
    const diff = (Number.isNaN(timeB) ? 0 : timeB) - (Number.isNaN(timeA) ? 0 : timeA)
    return diff !== 0 ? diff : b.id - a.id
  })
}

/** 兼容服务端直接返回会话或包在 { conversation } 中的两种形式 */
function extractConversation(payload: ConversationResponse & Partial<Conversation>): Conversation | null {
  if (payload.conversation) return payload.conversation
  if (typeof payload.id === 'number' && Array.isArray(payload.members)) {
    return payload as Conversation
  }
  return null
}

/** 兼容服务端直接返回消息或包在 { message } 中的两种形式 */
function extractMessage(payload: SendMessageResponse & Partial<Message>): Message | null {
  if (payload.message) return payload.message
  if (typeof payload.id === 'number') return payload as Message
  return null
}

export default function ChatPage() {
  const { user } = useAuth()
  const meId = user?.id ?? 0
  const navigate = useNavigate()
  const { conversationId: conversationIdParam } = useParams<{ conversationId?: string }>()
  const {
    connectionState,
    unreadTotal,
    pendingFriendRequests,
    error: chatError,
    setActiveConversationId,
    subscribe,
    refreshSummary,
  } = useChat()

  const activeId = conversationIdParam && /^\d+$/.test(conversationIdParam) ? Number(conversationIdParam) : null

  const [panelTab, setPanelTab] = useState<PanelTab>('conversations')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [conversationsLoading, setConversationsLoading] = useState(true)
  const [conversationsError, setConversationsError] = useState<string | null>(null)

  const [messages, setMessages] = useState<Message[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesLoadingMore, setMessagesLoadingMore] = useState(false)
  const [messagesHasMore, setMessagesHasMore] = useState(false)
  const [messagesError, setMessagesError] = useState<string | null>(null)

  const [friends, setFriends] = useState<Friend[]>([])
  const [incomingRequests, setIncomingRequests] = useState<FriendRequestsResponse['incoming']>([])
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequestsResponse['outgoing']>([])
  const [friendsLoading, setFriendsLoading] = useState(true)

  const [dialog, setDialog] = useState<DialogState>(null)
  const [dialogLoading, setDialogLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const conversationsRef = useRef<Conversation[]>([])
  const activeIdRef = useRef<number | null>(activeId)

  useEffect(() => {
    conversationsRef.current = conversations
  }, [conversations])

  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  // 让 ChatProvider 知道当前正在查看的会话（决定 message:new 是否增加未读）
  useEffect(() => {
    setActiveConversationId(activeId)
    return () => setActiveConversationId(null)
  }, [activeId, setActiveConversationId])

  const loadConversations = useCallback(async (showLoading = false): Promise<Conversation[]> => {
    if (showLoading) setConversationsLoading(true)
    try {
      const data = await api.get<ConversationsResponse>('/chat/conversations')
      const list = sortConversations(data.conversations ?? [])
      setConversations(list)
      conversationsRef.current = list
      setConversationsError(null)
      return list
    } catch (error) {
      setConversationsError(errorMessage(error, '加载会话失败'))
      return []
    } finally {
      setConversationsLoading(false)
    }
  }, [])

  const loadFriends = useCallback(async () => {
    setFriendsLoading(true)
    try {
      const [friendData, requestData] = await Promise.all([
        api.get<FriendsResponse>('/chat/friends'),
        api.get<FriendRequestsResponse>('/chat/friend-requests'),
      ])
      setFriends(friendData.friends ?? [])
      setIncomingRequests(requestData.incoming ?? [])
      setOutgoingRequests(requestData.outgoing ?? [])
    } catch (error) {
      setActionError(errorMessage(error, '加载好友失败'))
    } finally {
      setFriendsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadConversations(true)
    void loadFriends()
  }, [loadConversations, loadFriends])

  const markRead = useCallback(
    async (conversationId: number, lastMessageId: number) => {
      try {
        await api.put(`/chat/conversations/${conversationId}/read`, { lastMessageId })
        setConversations((prev) =>
          prev.map((conversation) =>
            conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation
          )
        )
        void refreshSummary()
      } catch {
        // 已读上报失败不阻塞聊天
      }
    },
    [refreshSummary]
  )

  // 打开会话：加载最近一页消息并上报已读
  useEffect(() => {
    if (activeId === null) {
      setMessages([])
      setMessagesHasMore(false)
      setMessagesError(null)
      setMessagesLoading(false)
      return
    }

    let cancelled = false
    setMessages([])
    setMessagesLoading(true)
    setMessagesHasMore(false)
    setMessagesError(null)

    api
      .get<MessagesResponse>(`/chat/conversations/${activeId}/messages?limit=30`)
      .then((data) => {
        if (cancelled) return
        const list = data.messages ?? []
        setMessages(list)
        setMessagesHasMore(Boolean(data.hasMore))
        const lastMessage = list[list.length - 1]
        if (lastMessage) void markRead(activeId, lastMessage.id)
      })
      .catch((error) => {
        if (!cancelled) setMessagesError(errorMessage(error, '加载消息失败'))
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeId, markRead])

  const loadMoreMessages = useCallback(async () => {
    if (activeId === null || messagesLoadingMore || !messagesHasMore || messages.length === 0) return
    setMessagesLoadingMore(true)
    try {
      const before = messages[0].id
      const data = await api.get<MessagesResponse>(
        `/chat/conversations/${activeId}/messages?before=${before}&limit=30`
      )
      setMessages((prev) => mergeMessages(data.messages ?? [], prev))
      setMessagesHasMore(Boolean(data.hasMore))
    } catch (error) {
      setMessagesError(errorMessage(error, '加载更早的消息失败'))
    } finally {
      setMessagesLoadingMore(false)
    }
  }, [activeId, messages, messagesHasMore, messagesLoadingMore])

  /**
   * 把刚刚发出的消息合并进当前会话，并更新会话列表的最后一条消息。
   *
   * 上传/发送期间用户可能已切到别的会话：只有当前仍停留在该会话时才合并进消息列表，
   * 否则只更新会话列表（避免消息被渲染进错误的会话窗口）。
   */
  const applyOutgoingMessage = useCallback(
    (conversationId: number, created: Message) => {
      if (activeIdRef.current === conversationId) {
        setMessages((prev) => mergeMessages(prev, created))
      }
      setConversations((prev) =>
        sortConversations(
          prev.map((conversation) =>
            conversation.id === conversationId
              ? {
                  ...conversation,
                  lastMessage: created,
                  lastMessageAt: created.createdAt,
                  unreadCount: 0,
                }
              : conversation
          )
        )
      )
      void markRead(conversationId, created.id)
    },
    [markRead]
  )

  const sendMessage = useCallback(
    async (content: string) => {
      if (activeId === null) return
      setActionError(null)
      try {
        const data = await api.post<SendMessageResponse & Partial<Message>>(
          `/chat/conversations/${activeId}/messages`,
          { content }
        )
        const created = extractMessage(data)

        if (created) {
          applyOutgoingMessage(activeId, created)
        } else {
          // 契约未约定响应体时回退到重新拉取最后一页，避免消息丢失
          const data2 = await api.get<MessagesResponse>(`/chat/conversations/${activeId}/messages?limit=30`)
          setMessages((prev) => mergeMessages(prev, data2.messages ?? []))
        }
      } catch (error) {
        setActionError(errorMessage(error, '发送消息失败'))
        throw error
      }
    },
    [activeId, applyOutgoingMessage]
  )

  /** 发送图片：multipart 字段名固定为 file */
  const sendImage = useCallback(
    async (file: File) => {
      if (activeId === null) return
      setActionError(null)
      const form = new FormData()
      form.append('file', file)
      try {
        const data = await api.postForm<SendMessageResponse & Partial<Message>>(
          `/chat/conversations/${activeId}/images`,
          form
        )
        const created = extractMessage(data)
        if (created) {
          applyOutgoingMessage(activeId, created)
        } else {
          const data2 = await api.get<MessagesResponse>(`/chat/conversations/${activeId}/messages?limit=30`)
          setMessages((prev) => mergeMessages(prev, data2.messages ?? []))
        }
      } catch (error) {
        setActionError(errorMessage(error, '发送图片失败'))
        throw error
      }
    },
    [activeId, applyOutgoingMessage]
  )

  /** 撤回本人 2 分钟内的消息 */
  const recallMessage = useCallback(async (messageId: number) => {
    setActionError(null)
    try {
      const data = await api.post<SendMessageResponse & Partial<Message>>(`/chat/messages/${messageId}/recall`)
      const updated = extractMessage(data)
      if (!updated) return
      // 用服务端返回的消息替换本地同 id 消息（recalledAt 非空即渲染为系统行）
      setMessages((prev) => mergeMessages(prev, updated))
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.lastMessage?.id === updated.id ? { ...conversation, lastMessage: updated } : conversation
        )
      )
    } catch (error) {
      setActionError(errorMessage(error, '撤回消息失败'))
      throw error
    }
  }, [])

  // WebSocket 事件驱动：当前会话消息、标题/成员、会话移除、好友变化
  useEffect(() => {
    return subscribe((event) => {
      switch (event.type) {
        case 'message:new': {
          const { conversationId, message } = event
          const mine = message.senderId === meId
          const isActive = activeIdRef.current === conversationId

          if (!conversationsRef.current.some((conversation) => conversation.id === conversationId)) {
            void loadConversations()
          } else {
            setConversations((prev) =>
              sortConversations(
                prev.map((conversation) =>
                  conversation.id === conversationId
                    ? {
                        ...conversation,
                        lastMessage: message,
                        lastMessageAt: message.createdAt,
                        unreadCount: isActive || mine ? conversation.unreadCount : conversation.unreadCount + 1,
                      }
                    : conversation
                )
              )
            )
          }

          if (isActive) {
            setMessages((prev) => mergeMessages(prev, message))
            void markRead(conversationId, message.id)
          }
          break
        }
        case 'message:recalled': {
          // 撤回不产生未读；当前会话内替换消息，并同步会话列表预览（lastMessage 换成新消息）
          const { conversationId, message } = event
          if (activeIdRef.current === conversationId) {
            setMessages((prev) => mergeMessages(prev, message))
          }
          setConversations((prev) =>
            prev.map((conversation) =>
              conversation.id === conversationId && conversation.lastMessage?.id === message.id
                ? { ...conversation, lastMessage: message }
                : conversation
            )
          )
          break
        }
        case 'conversation:updated':
          void loadConversations()
          break
        case 'conversation:removed':
          if (activeIdRef.current === event.conversationId) navigate('/chat')
          setConversations((prev) => prev.filter((conversation) => conversation.id !== event.conversationId))
          break
        case 'friend:request':
        case 'friend:rejected':
          void loadFriends()
          break
        case 'friend:accepted':
        case 'friend:removed':
          // 好友关系变化会实时影响私聊会话的 canSend，需要同时刷新会话列表
          void loadFriends()
          void loadConversations()
          break
        default:
          break
      }
    })
  }, [subscribe, meId, markRead, loadConversations, loadFriends, navigate])

  const activeConversation = useMemo(
    () => (activeId === null ? null : conversations.find((conversation) => conversation.id === activeId) ?? null),
    [activeId, conversations]
  )

  const emptyMessage = useMemo(() => {
    if (activeId === null) return '选择一个会话，开始聊天'
    if (!conversationsLoading && !activeConversation) return '会话不存在，或你已不是该会话成员'
    return '正在加载会话…'
  }, [activeId, conversationsLoading, activeConversation])

  const handleSelectConversation = useCallback(
    (conversation: Conversation) => {
      setPanelTab('conversations')
      navigate(`/chat/${conversation.id}`)
    },
    [navigate]
  )

  const startDirect = useCallback(
    async (userId: number) => {
      setActionError(null)
      try {
        const data = await api.post<ConversationResponse & Partial<Conversation>>(
          '/chat/conversations/direct',
          { userId }
        )
        const created = extractConversation(data)
        if (created) {
          setConversations((prev) => sortConversations([created, ...prev.filter((item) => item.id !== created.id)]))
          setPanelTab('conversations')
          navigate(`/chat/${created.id}`)
          return
        }
        const list = await loadConversations()
        const existing = list.find(
          (conversation) => conversation.type === 'direct' && conversation.members.some((member) => member.id === userId)
        )
        if (existing) {
          setPanelTab('conversations')
          navigate(`/chat/${existing.id}`)
        }
      } catch (error) {
        setActionError(errorMessage(error, '创建私聊失败'))
      }
    },
    [loadConversations, navigate]
  )

  const createGroup = useCallback(
    async (name: string, memberIds: number[]) => {
      setActionError(null)
      setDialogLoading(true)
      try {
        const data = await api.post<ConversationResponse & Partial<Conversation>>(
          '/chat/conversations/group',
          { name, memberIds }
        )
        const created = extractConversation(data)
        if (created) {
          setConversations((prev) => sortConversations([created, ...prev.filter((item) => item.id !== created.id)]))
          setDialog(null)
          setPanelTab('conversations')
          navigate(`/chat/${created.id}`)
          return
        }
        const list = await loadConversations()
        const found = list
          .filter((conversation) => conversation.type === 'group' && conversation.name === name)
          .sort((a, b) => b.id - a.id)[0]
        setDialog(null)
        if (found) {
          setPanelTab('conversations')
          navigate(`/chat/${found.id}`)
        }
      } catch (error) {
        setActionError(errorMessage(error, '创建群聊失败'))
      } finally {
        setDialogLoading(false)
      }
    },
    [loadConversations, navigate]
  )

  const addMembers = useCallback(
    async (memberIds: number[]) => {
      if (activeId === null) return
      setActionError(null)
      setDialogLoading(true)
      try {
        await api.post(`/chat/conversations/${activeId}/members`, { userIds: memberIds })
        await loadConversations()
        setDialog(null)
      } catch (error) {
        setActionError(errorMessage(error, '添加成员失败'))
      } finally {
        setDialogLoading(false)
      }
    },
    [activeId, loadConversations]
  )

  const removeMember = useCallback(
    async (userId: number) => {
      if (activeId === null) return
      setActionError(null)
      try {
        await api.delete(`/chat/conversations/${activeId}/members/${userId}`)
        await loadConversations()
      } catch (error) {
        setActionError(errorMessage(error, '移除成员失败'))
      }
    },
    [activeId, loadConversations]
  )

  const renameConversation = useCallback(
    async (name: string) => {
      if (activeId === null) return
      setActionError(null)
      try {
        await api.put(`/chat/conversations/${activeId}`, { name })
        await loadConversations()
      } catch (error) {
        setActionError(errorMessage(error, '修改群名失败'))
        throw error
      }
    },
    [activeId, loadConversations]
  )

  const leaveGroup = useCallback(async () => {
    if (activeId === null) return
    if (!window.confirm('确定退出该群聊吗？')) return
    setActionError(null)
    try {
      await api.delete(`/chat/conversations/${activeId}/members/${meId}`)
      setConversations((prev) => prev.filter((conversation) => conversation.id !== activeId))
      navigate('/chat')
    } catch (error) {
      setActionError(errorMessage(error, '退出群聊失败'))
    }
  }, [activeId, meId, navigate])

  const dissolveGroup = useCallback(async () => {
    if (activeId === null) return
    if (!window.confirm('确定解散该群聊吗？此操作不可撤销。')) return
    setActionError(null)
    try {
      await api.delete(`/chat/conversations/${activeId}`)
      setConversations((prev) => prev.filter((conversation) => conversation.id !== activeId))
      navigate('/chat')
    } catch (error) {
      setActionError(errorMessage(error, '解散群聊失败'))
    }
  }, [activeId, navigate])

  const acceptRequest = useCallback(
    async (requestId: number) => {
      setActionError(null)
      try {
        await api.post(`/chat/friend-requests/${requestId}/accept`)
        // 接受方不会收到 friend:accepted 推送，主动刷新会话以更新私聊 canSend
        await Promise.all([loadFriends(), loadConversations()])
        void refreshSummary()
      } catch (error) {
        setActionError(errorMessage(error, '接受好友申请失败'))
      }
    },
    [loadConversations, loadFriends, refreshSummary]
  )

  const rejectRequest = useCallback(
    async (requestId: number) => {
      setActionError(null)
      try {
        await api.post(`/chat/friend-requests/${requestId}/reject`)
        await loadFriends()
        void refreshSummary()
      } catch (error) {
        setActionError(errorMessage(error, '拒绝好友申请失败'))
      }
    },
    [loadFriends, refreshSummary]
  )

  const addFriend = useCallback(
    async (userId: number) => {
      setActionError(null)
      try {
        await api.post('/chat/friend-requests', { userId })
        await loadFriends()
      } catch (error) {
        setActionError(errorMessage(error, '发送好友申请失败'))
        throw error
      }
    },
    [loadFriends]
  )

  const removeFriend = useCallback(
    async (userId: number) => {
      setActionError(null)
      try {
        await api.delete(`/chat/friends/${userId}`)
        // 删除好友后私聊 canSend 立即变为 false
        await Promise.all([loadFriends(), loadConversations()])
      } catch (error) {
        setActionError(errorMessage(error, '删除好友失败'))
      }
    },
    [loadConversations, loadFriends]
  )

  const searchUsers = useCallback(async (keyword: string): Promise<ChatUser[]> => {
    const data = await api.get<UserSearchResponse>(`/chat/users/search?q=${encodeURIComponent(keyword)}`)
    return data.users ?? []
  }, [])

  const handleGroupDialogSubmit = useCallback(
    (name: string, memberIds: number[]) => {
      if (!dialog) return
      if (dialog.mode === 'create-group') void createGroup(name, memberIds)
      else void addMembers(memberIds)
    },
    [dialog, createGroup, addMembers]
  )

  const connectionLabel =
    connectionState === 'open'
      ? '实时连接正常'
      : connectionState === 'connecting'
        ? '正在连接实时消息…'
        : '实时连接已断开'

  return (
    <div className="gh-chat-page">
      {actionError && (
        <div className="gh-chat-banner gh-chat-banner--error" role="alert">
          <span>{actionError}</span>
          <button type="button" className="gh-chat-banner-close" aria-label="关闭错误提示" onClick={() => setActionError(null)}>
            ×
          </button>
        </div>
      )}
      {!actionError && chatError && (
        <div className="gh-chat-banner gh-chat-banner--error" role="alert">
          <span>{chatError}</span>
        </div>
      )}

      <div className={`gh-chat-layout ${activeId !== null ? 'gh-chat-layout--thread' : ''}`}>
        <aside className="gh-chat-sidebar" aria-label="会话与好友">
          <div className="gh-chat-sidebar-head">
            <div className="gh-chat-tabs" role="tablist" aria-label="聊天面板">
              <button
                type="button"
                role="tab"
                aria-selected={panelTab === 'conversations'}
                className={`gh-chat-tab ${panelTab === 'conversations' ? 'gh-chat-tab--active' : ''}`}
                onClick={() => setPanelTab('conversations')}
              >
                会话
                {unreadTotal > 0 && <span className="gh-chat-tab-badge">{unreadTotal > 99 ? '99+' : unreadTotal}</span>}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={panelTab === 'friends'}
                className={`gh-chat-tab ${panelTab === 'friends' ? 'gh-chat-tab--active' : ''}`}
                onClick={() => setPanelTab('friends')}
              >
                好友
                {pendingFriendRequests > 0 && (
                  <span className="gh-chat-tab-badge">{pendingFriendRequests > 99 ? '99+' : pendingFriendRequests}</span>
                )}
              </button>
            </div>
            <button
              type="button"
              className="gh-chat-new-group"
              title="新建群聊"
              aria-label="新建群聊"
              onClick={() => setDialog({ mode: 'create-group' })}
            >
              +
            </button>
            <span
              className={`gh-chat-status gh-chat-status--${connectionState}`}
              title={connectionLabel}
              aria-label={connectionLabel}
            />
          </div>

          <div className="gh-chat-sidebar-body">
            {panelTab === 'conversations' ? (
              <ChatConversationList
                conversations={conversations}
                activeId={activeId}
                meId={meId}
                loading={conversationsLoading}
                error={conversationsError}
                onSelect={handleSelectConversation}
              />
            ) : (
              <FriendPanel
                friends={friends}
                incoming={incomingRequests}
                outgoing={outgoingRequests}
                loading={friendsLoading}
                onAcceptRequest={acceptRequest}
                onRejectRequest={rejectRequest}
                onRemoveFriend={removeFriend}
                onStartDirect={startDirect}
                searchUsers={searchUsers}
                onAddFriend={addFriend}
              />
            )}
          </div>
        </aside>

        <ChatThread
          conversation={activeConversation}
          meId={meId}
          messages={messages}
          loading={messagesLoading}
          loadingMore={messagesLoadingMore}
          hasMore={messagesHasMore}
          error={messagesError}
          emptyMessage={emptyMessage}
          onBack={() => navigate('/chat')}
          onSend={sendMessage}
          onSendImage={sendImage}
          onRecall={recallMessage}
          onLoadMore={() => void loadMoreMessages()}
          onAddMembers={() => setDialog({ mode: 'add-members' })}
          onRemoveMember={(userId) => void removeMember(userId)}
          onRename={renameConversation}
          onDissolve={() => void dissolveGroup()}
          onLeave={() => void leaveGroup()}
        />
      </div>

      <GroupDialog
        open={dialog !== null}
        title={dialog?.mode === 'add-members' ? '添加成员' : '新建群聊'}
        submitLabel={dialog?.mode === 'add-members' ? '添加' : '创建群聊'}
        friends={friends}
        excludeIds={
          dialog?.mode === 'add-members' && activeConversation
            ? activeConversation.members.map((member) => member.id)
            : []
        }
        showNameInput={dialog?.mode !== 'add-members'}
        loading={dialogLoading}
        error={actionError}
        onClose={() => {
          if (dialogLoading) return
          setDialog(null)
          setActionError(null)
        }}
        onSubmit={handleGroupDialogSubmit}
      />
    </div>
  )
}
