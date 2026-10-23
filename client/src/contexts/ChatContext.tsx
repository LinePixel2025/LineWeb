import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import api, { getToken } from '../lib/api'
import { getChatWsUrl } from '../lib/chat'
import { useAuth } from './AuthContext'
import type {
  ChatConnectionState,
  ChatEvent,
  ChatEventListener,
  ChatServerEvent,
  ChatSummary,
} from '../types/chat'

interface ChatContextValue {
  /** 实时连接状态：connecting（连接/重连中）、open（已认证）、closed（已断开） */
  connectionState: ChatConnectionState
  /** 全部会话的未读消息总数（侧边栏角标） */
  unreadTotal: number
  /** 待处理的好友申请数 */
  pendingFriendRequests: number
  /** 认证失败等需要展示给用户的错误 */
  error: string | null
  /** 当前正在查看的会话 id —— 用于判断 message:new 是否需要增加未读 */
  setActiveConversationId: (conversationId: number | null) => void
  /** 订阅服务端推送事件，返回取消订阅函数 */
  subscribe: (listener: ChatEventListener) => () => void
  /** 主动刷新摘要（登录后、事件驱动时调用） */
  refreshSummary: () => Promise<void>
}

const ChatContext = createContext<ChatContextValue | null>(null)

const INITIAL_RECONNECT_DELAY = 1_000
const MAX_RECONNECT_DELAY = 30_000
/** 服务端以 4001 关闭表示认证失败，重连无意义 */
const AUTH_FAILED_CODE = 4001

export function ChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null

  const [connectionState, setConnectionState] = useState<ChatConnectionState>('closed')
  const [unreadTotal, setUnreadTotal] = useState(0)
  const [pendingFriendRequests, setPendingFriendRequests] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const listenersRef = useRef<Set<ChatEventListener>>(new Set())
  const activeConversationIdRef = useRef<number | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptsRef = useRef(0)

  const setActiveConversationId = useCallback((conversationId: number | null) => {
    activeConversationIdRef.current = conversationId
  }, [])

  const subscribe = useCallback((listener: ChatEventListener) => {
    listenersRef.current.add(listener)
    return () => {
      listenersRef.current.delete(listener)
    }
  }, [])

  const refreshSummary = useCallback(async () => {
    if (!userId) return
    try {
      const data = await api.get<ChatSummary>('/chat/summary')
      if (typeof data?.unreadTotal === 'number') setUnreadTotal(data.unreadTotal)
      if (typeof data?.pendingFriendRequests === 'number') {
        setPendingFriendRequests(data.pendingFriendRequests)
      }
    } catch {
      // 摘要拉取失败不影响聊天主流程（连接建立后会再次刷新）
    }
  }, [userId])

  useEffect(() => {
    // 未登录：清空状态，不建立连接
    if (!userId) {
      setConnectionState('closed')
      setUnreadTotal(0)
      setPendingFriendRequests(0)
      setError(null)
      return
    }

    let disposed = false
    let authFailed = false

    const emit = (event: ChatEvent) => {
      for (const listener of listenersRef.current) {
        try {
          listener(event)
        } catch {
          // 单个订阅者异常不应影响其他订阅者
        }
      }
    }

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }

    const scheduleReconnect = () => {
      if (disposed || authFailed) return
      clearReconnectTimer()
      const delay = Math.min(
        INITIAL_RECONNECT_DELAY * 2 ** reconnectAttemptsRef.current,
        MAX_RECONNECT_DELAY
      )
      reconnectAttemptsRef.current += 1
      setConnectionState('connecting')
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null
        connect()
      }, delay)
    }

    const connect = () => {
      if (disposed || authFailed) return
      const token = getToken()
      if (!token) {
        setConnectionState('closed')
        return
      }

      setConnectionState('connecting')
      let socket: WebSocket
      try {
        socket = new WebSocket(getChatWsUrl())
      } catch {
        scheduleReconnect()
        return
      }
      socketRef.current = socket

      socket.onopen = () => {
        if (disposed) return
        try {
          socket.send(JSON.stringify({ type: 'auth', token }))
        } catch {
          // 发送失败由 onclose 统一触发重连
        }
      }

      socket.onmessage = (event) => {
        if (disposed) return
        let payload: ChatServerEvent
        try {
          payload = JSON.parse(String(event.data)) as ChatServerEvent
        } catch {
          return
        }
        if (!payload || typeof payload.type !== 'string') return

        // 心跳：回 pong，不向页面转发
        if (payload.type === 'ping') {
          try {
            socket.send(JSON.stringify({ type: 'pong' }))
          } catch {
            // ignore
          }
          return
        }
        if (payload.type === 'pong') return

        if (payload.type === 'auth_ok') {
          reconnectAttemptsRef.current = 0
          setConnectionState('open')
          setError(null)
          void refreshSummary()
          return
        }

        emit(payload as ChatEvent)

        switch (payload.type) {
          case 'message:new': {
            // 自己的消息不增加未读；当前正在查看的会话也不增加
            if (
              payload.message.senderId !== userId &&
              payload.conversationId !== activeConversationIdRef.current
            ) {
              void refreshSummary()
            }
            break
          }
          case 'friend:request':
          case 'friend:accepted':
          case 'friend:rejected':
          case 'friend:removed':
            void refreshSummary()
            break
          case 'conversation:removed':
            // 被移出/群解散后，未读总数需要同步下降
            void refreshSummary()
            break
          default:
            break
        }
      }

      socket.onclose = (event) => {
        if (socketRef.current === socket) socketRef.current = null
        if (disposed) return
        setConnectionState('closed')
        if (event.code === AUTH_FAILED_CODE) {
          authFailed = true
          clearReconnectTimer()
          setError('聊天连接认证失败，请重新登录')
          return
        }
        scheduleReconnect()
      }

      socket.onerror = () => {
        // 浏览器随后会触发 onclose，由 onclose 统一处理重连
      }
    }

    connect()
    void refreshSummary()

    return () => {
      disposed = true
      clearReconnectTimer()
      const socket = socketRef.current
      socketRef.current = null
      if (socket) {
        socket.onopen = null
        socket.onmessage = null
        socket.onclose = null
        socket.onerror = null
        try {
          socket.close()
        } catch {
          // ignore
        }
      }
    }
  }, [userId, refreshSummary])

  const value = useMemo<ChatContextValue>(
    () => ({
      connectionState,
      unreadTotal,
      pendingFriendRequests,
      error,
      setActiveConversationId,
      subscribe,
      refreshSummary,
    }),
    [
      connectionState,
      unreadTotal,
      pendingFriendRequests,
      error,
      setActiveConversationId,
      subscribe,
      refreshSummary,
    ]
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used within ChatProvider')
  return ctx
}
