import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../lib/api'
import { isConversationKey } from '../lib/chat'
import { useXmppChat } from '../contexts/XmppChatContext'
import ChatConversationList from '../components/chat/ChatConversationList'
import ChatThread from '../components/chat/ChatThread'
import FriendPanel from '../components/chat/FriendPanel'
import GroupDialog from '../components/chat/GroupDialog'
import ContactRemarkDialog from '../components/chat/ContactRemarkDialog'
import type {
  ChatUser,
  NekoConversation,
  NekoDirectoryUser,
  NekoContact,
  NekoFriendRequest,
  NekoMessage,
  UserSearchResponse,
} from '../types/chat'

type PanelTab = 'conversations' | 'friends'

type DialogState =
  | { mode: 'create-group' }
  | { mode: 'add-members' }
  | { mode: 'contact-remark'; contact: NekoContact }
  | null

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export default function ChatPage() {
  const navigate = useNavigate()
  const { conversationId: keyParam } = useParams<{ conversationId?: string }>()
  /** 会话键：单聊 u<nekoId> / 群聊 r<roomId> */
  const activeKey = keyParam && isConversationKey(keyParam) ? keyParam : null

  const {
    connectionState,
    transport,
    loading,
    error: connectionError,
    self,
    conversations,
    contacts,
    friends,
    incoming,
    outgoing,
    unreadTotal,
    peerRead,
    stickers,
    setActiveKey,
    messages,
    messagesLoading,
    messagesLoadingMore,
    messagesHasMore,
    messagesError,
    loadMore,
    sendText,
    sendPoke,
    forwardMessages,
    sendImage,
    sendSticker,
    addSticker,
    saveStickerFromMessage,
    removeSticker,
    recallMessage,
    startDirect,
    createGroup,
    addMembers,
    removeMember,
    renameRoom,
    leaveRoom,
    disbandRoom,
    acceptRequest,
    rejectRequest,
    addFriend,
    addNativeFriend,
    removeFriend,
    setContactRemark,
    searchDirectory,
  } = useXmppChat()

  const [panelTab, setPanelTab] = useState<PanelTab>('conversations')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [dialogLoading, setDialogLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  /** 记录「曾经存在」的会话：之后从列表消失说明被移出/被解散，需要退回列表 */
  const seenKeyRef = useRef<string | null>(null)

  // 把当前路由会话告知数据层：负责加载历史、上报已读
  useEffect(() => {
    setActiveKey(activeKey)
    return () => setActiveKey(null)
  }, [activeKey, setActiveKey])

  const activeConversation = useMemo(
    () => (activeKey === null ? null : conversations.find((item) => item.key === activeKey) ?? null),
    [activeKey, conversations],
  )

  // 会话被移出/解散（列表里消失）时回到列表页；直接访问未知会话键则保留提示
  useEffect(() => {
    if (activeKey === null) {
      seenKeyRef.current = null
      return
    }
    if (activeConversation) {
      seenKeyRef.current = activeKey
      return
    }
    if (loading) return
    if (seenKeyRef.current === activeKey) {
      seenKeyRef.current = null
      navigate('/chat', { replace: true })
    }
  }, [activeKey, activeConversation, loading, navigate])

  const handleSelectConversation = useCallback(
    (conversation: NekoConversation) => {
      setPanelTab('conversations')
      navigate(`/chat/${conversation.key}`)
    },
    [navigate],
  )

  const handleSetRemark = useCallback((contact: NekoContact) => {
    setActionError(null)
    setDialog({ mode: 'contact-remark', contact })
  }, [])

  const handleStartDirect = useCallback(
    (target: NekoContact | NekoDirectoryUser) => {
      setActionError(null)
      try {
        const key = startDirect(target)
        setPanelTab('conversations')
        navigate(`/chat/${key}`)
      } catch (error) {
        setActionError(errorMessage(error, '创建私聊失败'))
      }
    },
    [navigate, startDirect],
  )

  const handleSend = useCallback(
    async (content: string, replyTo?: number, mentions?: number[]) => {
      if (!activeKey) return
      setActionError(null)
      try {
        await sendText(activeKey, content, replyTo, mentions)
      } catch (error) {
        setActionError(errorMessage(error, '发送消息失败'))
        throw error
      }
    },
    [activeKey, sendText],
  )

  const handleSaveSticker = useCallback(async (message: NekoMessage) => {
    setActionError(null)
    try {
      await saveStickerFromMessage(message)
    } catch (error) {
      setActionError(errorMessage(error, '收藏表情失败'))
    }
  }, [saveStickerFromMessage])

  const handlePoke = useCallback(async (targetNekoId: number) => {
    if (!activeKey) return
    setActionError(null)
    try {
      await sendPoke(activeKey, targetNekoId)
    } catch (error) {
      setActionError(errorMessage(error, '拍一拍失败'))
    }
  }, [activeKey, sendPoke])

  const handleForward = useCallback(
    async (
      messageIds: number[],
      targetKeys: string[],
      mode: 'merge' | 'separate',
    ) => {
      if (!activeKey) throw new Error('请先打开一个会话')
      setActionError(null)
      try {
        await forwardMessages(activeKey, messageIds, targetKeys, mode)
      } catch (error) {
        setActionError(errorMessage(error, '转发失败'))
        throw error
      }
    },
    [activeKey, forwardMessages],
  )

  const handleSendImage = useCallback(
    async (file: File) => {
      if (!activeKey) return
      setActionError(null)
      try {
        await sendImage(activeKey, file)
      } catch (error) {
        setActionError(errorMessage(error, '发送图片失败'))
        throw error
      }
    },
    [activeKey, sendImage],
  )

  const handleRecall = useCallback(
    async (messageId: number, admin = false) => {
      if (!activeKey) return
      setActionError(null)
      try {
        await recallMessage(activeKey, messageId, admin)
      } catch (error) {
        setActionError(errorMessage(error, '撤回消息失败'))
        throw error
      }
    },
    [activeKey, recallMessage],
  )

  const handleRename = useCallback(
    async (name: string) => {
      const roomId = activeConversation?.room?.id
      if (!roomId) return
      setActionError(null)
      try {
        await renameRoom(roomId, name)
      } catch (error) {
        setActionError(errorMessage(error, '修改群名失败'))
        throw error
      }
    },
    [activeConversation, renameRoom],
  )

  const handleRemoveMember = useCallback(
    async (nekoId: number) => {
      const roomId = activeConversation?.room?.id
      if (!roomId) return
      setActionError(null)
      try {
        await removeMember(roomId, nekoId)
      } catch (error) {
        setActionError(errorMessage(error, '移除成员失败'))
      }
    },
    [activeConversation, removeMember],
  )

  const handleLeave = useCallback(async () => {
    const roomId = activeConversation?.room?.id
    if (!roomId) return
    if (!window.confirm('确定退出该群聊吗？')) return
    setActionError(null)
    try {
      await leaveRoom(roomId)
      navigate('/chat')
    } catch (error) {
      setActionError(errorMessage(error, '退出群聊失败'))
    }
  }, [activeConversation, leaveRoom, navigate])

  const handleDissolve = useCallback(async () => {
    const roomId = activeConversation?.room?.id
    if (!roomId) return
    if (!window.confirm('确定解散该群聊吗？此操作不可撤销。')) return
    setActionError(null)
    try {
      await disbandRoom(roomId)
      navigate('/chat')
    } catch (error) {
      setActionError(errorMessage(error, '解散群聊失败'))
    }
  }, [activeConversation, disbandRoom, navigate])

  const handleGroupSubmit = useCallback(
    (name: string, memberNekoIds: number[]) => {
      if (!dialog) return
      if (dialog.mode === 'create-group') {
        setActionError(null)
        setDialogLoading(true)
        void createGroup(name, memberNekoIds)
          .then((key) => {
            setDialog(null)
            setPanelTab('conversations')
            navigate(`/chat/${key}`)
          })
          .catch((error: unknown) => {
            setActionError(errorMessage(error, '创建群聊失败'))
          })
          .finally(() => setDialogLoading(false))
        return
      }
      const roomId = activeConversation?.room?.id
      if (!roomId) return
      setActionError(null)
      setDialogLoading(true)
      void addMembers(roomId, memberNekoIds)
        .then(() => setDialog(null))
        .catch((error: unknown) => {
          setActionError(errorMessage(error, '添加成员失败'))
        })
        .finally(() => setDialogLoading(false))
    },
    [activeConversation, addMembers, createGroup, dialog, navigate],
  )

  const handleAcceptRequest = useCallback(
    async (request: NekoFriendRequest) => {
      setActionError(null)
      try {
        await acceptRequest(request)
      } catch (error) {
        setActionError(errorMessage(error, '接受好友申请失败'))
      }
    },
    [acceptRequest],
  )

  const handleRejectRequest = useCallback(
    async (request: NekoFriendRequest) => {
      setActionError(null)
      try {
        await rejectRequest(request)
      } catch (error) {
        setActionError(errorMessage(error, '拒绝好友申请失败'))
      }
    },
    [rejectRequest],
  )

  const handleAddFriend = useCallback(
    async (linewebId: number) => {
      setActionError(null)
      try {
        await addFriend(linewebId)
      } catch (error) {
        setActionError(errorMessage(error, '发送好友申请失败'))
        throw error
      }
    },
    [addFriend],
  )

  const handleAddNativeFriend = useCallback(
    async (nekoId: number) => {
      setActionError(null)
      try {
        await addNativeFriend(nekoId)
      } catch (error) {
        setActionError(errorMessage(error, '发送好友申请失败'))
        throw error
      }
    },
    [addNativeFriend],
  )

  const handleRemoveFriend = useCallback(
    async (contact: NekoContact) => {
      setActionError(null)
      try {
        await removeFriend(contact)
      } catch (error) {
        setActionError(errorMessage(error, '删除好友失败'))
      }
    },
    [removeFriend],
  )

  /** LineWeb 用户搜索（好友申请仍以 Prisma 关系为准） */
  const searchUsers = useCallback(async (keyword: string): Promise<ChatUser[]> => {
    const data = await api.get<UserSearchResponse>(`/chat/users/search?q=${encodeURIComponent(keyword)}`)
    return data.users ?? []
  }, [])

  /** 邀请好友进行 2048 联机对战（仅 LineWeb 好友） */
  const inviteGame = useCallback(
    (linewebId: number) => {
      navigate(`/games/2048/online?friend=${linewebId}`)
    },
    [navigate],
  )

  const emptyMessage = useMemo(() => {
    if (activeKey === null) return '选择一个会话，开始聊天'
    if (!activeConversation && loading) return '正在加载会话…'
    if (!activeConversation) return '会话不存在，或你已不是该会话成员'
    return '正在加载消息…'
  }, [activeKey, activeConversation, loading])

  // 传输模式文案：轮询时提示延迟；仍在尝试 WS 时补充说明
  const connectionLabel =
    transport === 'ws'
      ? '实时连接正常'
      : connectionState === 'connecting'
        ? '轮询模式（约 15 秒延迟）· 正在连接实时消息…'
        : '轮询模式（约 15 秒延迟）'

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
      {!actionError && connectionError && (
        <div className="gh-chat-banner gh-chat-banner--error" role="alert">
          <span>{connectionError}</span>
        </div>
      )}

      <div className={`gh-chat-layout ${activeKey !== null ? 'gh-chat-layout--thread' : ''}`}>
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
                {incoming.length > 0 && (
                  <span className="gh-chat-tab-badge">{incoming.length > 99 ? '99+' : incoming.length}</span>
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
            {transport === 'polling' && (
              <span className="gh-chat-mode-chip" title={connectionLabel}>
                轮询模式
              </span>
            )}
            <span
              className={`gh-chat-status ${
                transport === 'polling' ? 'gh-chat-status--polling' : `gh-chat-status--${connectionState}`
              }`}
              title={connectionLabel}
              aria-label={connectionLabel}
            />
          </div>

          <div className="gh-chat-sidebar-body">
            {panelTab === 'conversations' ? (
              <ChatConversationList
                conversations={conversations}
                activeKey={activeKey}
                loading={loading && conversations.length === 0}
                error={!loading && conversations.length === 0 ? connectionError : null}
                onSelect={handleSelectConversation}
              />
            ) : (
              <FriendPanel
                friends={friends}
                incoming={incoming}
                outgoing={outgoing}
                loading={loading && friends.length === 0}
                onAcceptRequest={handleAcceptRequest}
                onRejectRequest={handleRejectRequest}
                onRemoveFriend={handleRemoveFriend}
                onStartDirect={handleStartDirect}
                searchUsers={searchUsers}
                searchDirectory={searchDirectory}
                onAddFriend={handleAddFriend}
                onAddNativeFriend={handleAddNativeFriend}
                onInviteGame={inviteGame}
                onSetRemark={handleSetRemark}
              />
            )}
          </div>
        </aside>

        <ChatThread
          conversation={activeConversation}
          selfNekoId={self?.nekoId ?? null}
          messages={messages}
          peerRead={activeKey ? peerRead[activeKey] ?? 0 : 0}
          loading={messagesLoading && messages.length === 0}
          loadingMore={messagesLoadingMore}
          hasMore={messagesHasMore}
          error={messagesError}
          emptyMessage={emptyMessage}
          forwardTargets={conversations}
          onBack={() => navigate('/chat')}
          onSend={handleSend}
          onPoke={handlePoke}
          onSaveSticker={handleSaveSticker}
          onSetRemark={handleSetRemark}
          onForward={handleForward}
          onSendImage={handleSendImage}
          onSendSticker={(sticker) => {
            if (activeKey) void sendSticker(activeKey, sticker)
          }}
          stickers={stickers}
          onAddSticker={addSticker}
          onRemoveSticker={removeSticker}
          onRecall={handleRecall}
          onLoadMore={() => {
            if (activeKey) loadMore(activeKey)
          }}
          onAddMembers={() => setDialog({ mode: 'add-members' })}
          onRemoveMember={(nekoId) => void handleRemoveMember(nekoId)}
          onRename={handleRename}
          onDissolve={() => void handleDissolve()}
          onLeave={() => void handleLeave()}
        />
      </div>

      <GroupDialog
        open={dialog?.mode === 'create-group' || dialog?.mode === 'add-members'}
        title={dialog?.mode === 'add-members' ? '添加成员' : '新建群聊'}
        submitLabel={dialog?.mode === 'add-members' ? '添加' : '创建群聊'}
        contacts={contacts}
        excludeNekoIds={
          dialog?.mode === 'add-members' && activeConversation
            ? activeConversation.members.map((member) => member.nekoId)
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
        onSubmit={handleGroupSubmit}
      />

      {dialog?.mode === 'contact-remark' && (
        <ContactRemarkDialog
          contact={dialog.contact}
          onClose={() => setDialog(null)}
          onSubmit={(remark) => setContactRemark(dialog.contact.nekoId, remark)}
        />
      )}
    </div>
  )
}
