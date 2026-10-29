import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../lib/api'
import { isConversationKey } from '../lib/chat'
import { useXmppChat } from '../contexts/XmppChatContext'
import { useSiteAnnouncements } from '../contexts/SiteAnnouncementContext'
import SiteAnnouncementDialog from '../components/SiteAnnouncementDialog'
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
    realtimeEnabled,
    setRealtimeEnabled,
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
    saveRoomAnnouncement,
    acknowledgeRoomAnnouncement,
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

  const { visible: visibleAnnouncements } = useSiteAnnouncements()

  const [panelTab, setPanelTab] = useState<PanelTab>('conversations')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [dialogLoading, setDialogLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [announcementDialogOpen, setAnnouncementDialogOpen] = useState(false)

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

  // 传输模式文案：默认长轮询（实时性由服务端挂起推送保证）；可在聊天设置里开启 WebSocket
  const connectionLabel =
    transport === 'ws'
      ? '实时连接（WebSocket）正常'
      : realtimeEnabled && connectionState === 'connecting'
        ? '正在连接实时消息…（当前为长轮询）'
        : '长轮询模式（消息由服务端即时推送，无需 WebSocket）'

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
            <button
              type="button"
              className={`gh-chat-head-icon ${visibleAnnouncements.length > 0 ? 'gh-chat-head-icon--dot' : ''}`}
              title="站点公告（LineWeb）"
              aria-label="站点公告"
              onClick={() => setAnnouncementDialogOpen(true)}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2.5 6.5v3l1.5.5 8 3.5V3L4 6.5z" />
                <path d="M4.5 10v2.5a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1V10M14 7v2" />
              </svg>
            </button>
            <div className="gh-chat-head-settings">
              <button
                type="button"
                className={`gh-chat-head-icon ${settingsOpen ? 'gh-chat-head-icon--active' : ''}`}
                title="聊天设置"
                aria-label="聊天设置"
                aria-haspopup="dialog"
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen((open) => !open)}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="8" cy="8" r="2.2" />
                  <path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M12.4 3.6l-1 1M4.6 11.4l-1 1" />
                </svg>
              </button>
              {settingsOpen && (
                <>
                  <div className="gh-chat-settings-backdrop" onClick={() => setSettingsOpen(false)} />
                  <div className="gh-chat-settings" role="dialog" aria-label="聊天设置">
                    <p className="gh-chat-settings-title">聊天设置</p>
                    <label className="gh-chat-settings-row">
                      <span className="gh-chat-settings-copy">
                        <span className="gh-chat-settings-label">聊天消息实时连接（WebSocket）</span>
                        <span className="gh-chat-settings-hint">
                          默认关闭：聊天消息走长轮询，兼容性最好、更省资源。开启后优先使用 WebSocket，失败自动降级；好友申请与游戏事件仍走站内实时通道。
                        </span>
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={realtimeEnabled}
                        aria-label={`实时连接：${realtimeEnabled ? '已开启' : '已关闭'}`}
                        className={`gh-feature-switch ${realtimeEnabled ? 'gh-feature-switch--on' : ''}`}
                        onClick={() => setRealtimeEnabled(!realtimeEnabled)}
                      >
                        <span className="gh-feature-switch-knob" />
                      </button>
                    </label>
                    <p className="gh-chat-settings-foot">
                      当前传输：{transport === 'ws' ? 'WebSocket' : 'HTTP 长轮询'}
                      {realtimeEnabled && transport === 'polling' ? '（正在尝试实时连接）' : ''}
                    </p>
                  </div>
                </>
              )}
            </div>
            <span
              className={`gh-chat-status ${
                transport === 'polling'
                  ? realtimeEnabled ? 'gh-chat-status--polling' : 'gh-chat-status--idle'
                  : `gh-chat-status--${connectionState}`
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
          onSaveAnnouncement={
            activeConversation?.room
              ? (text, ackRequired) => saveRoomAnnouncement(activeConversation.room!.id, text, ackRequired)
              : undefined
          }
          onAckAnnouncement={
            activeConversation?.room
              ? () => acknowledgeRoomAnnouncement(activeConversation.room!.id)
              : undefined
          }
        />
      </div>

      <SiteAnnouncementDialog
        open={announcementDialogOpen}
        onClose={() => setAnnouncementDialogOpen(false)}
      />

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
