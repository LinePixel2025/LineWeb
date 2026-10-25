import { api, ApiError, getToken } from './api'

/**
 * AI 对话（DeepSeek）前端封装
 *
 * 常规 REST 走 lib/api（自动带 Authorization）；
 * 发消息是 SSE 流式响应，api 封装只支持 JSON，这里用原生 fetch 手动解析
 * `data: {...}\n\n` 帧（token 手动携带；429/503 等 SSE 建立前的错误仍为 JSON）。
 */

// === DTO 类型（与服务端 aiChatService 的响应一致） ===

export interface AiChatQuota {
  enabled: boolean
  model: string
  dailyLimit: number
  used: number
  remaining: number | null
  unlimited: boolean
  /** 配额重置日期（Asia/Shanghai，YYYY-MM-DD，即明天） */
  resetDate: string
}

export interface AiConversationDto {
  id: number
  title: string
  createdAt: string
  updatedAt: string
}

export interface AiChatImageDto {
  id: number
  width: number
  height: number
  size: number
}

export interface AiChatMessageDto {
  id: number
  role: 'user' | 'assistant'
  content: string
  model: string | null
  createdAt: string
  images: AiChatImageDto[]
}

export interface AiChatMessagesPage {
  messages: AiChatMessageDto[]
  hasMore: boolean
}

/** 上传成功的附件（待发送，挂到 composer） */
export interface AiChatAttachment {
  id: number
  width: number
  height: number
  size: number
  /** 预览地址（?token= 直链） */
  previewUrl: string
}

// === REST 封装 ===

export function fetchAiChatQuota(): Promise<AiChatQuota> {
  return api.get<AiChatQuota>('/ai-chat/quota')
}

export function fetchAiChatConversations(): Promise<{ conversations: AiConversationDto[] }> {
  return api.get<{ conversations: AiConversationDto[] }>('/ai-chat/conversations')
}

export function fetchAiChatMessages(conversationId: number, before?: number): Promise<AiChatMessagesPage> {
  const query = before ? `?before=${before}` : ''
  return api.get<AiChatMessagesPage>(`/ai-chat/conversations/${conversationId}/messages${query}`)
}

export function deleteAiChatConversation(conversationId: number): Promise<{ ok: boolean }> {
  return api.delete<{ ok: boolean }>(`/ai-chat/conversations/${conversationId}`)
}

export function uploadAiChatImage(file: File): Promise<AiChatImageDto> {
  const form = new FormData()
  form.append('file', file)
  return api.postForm<{ id: number; width: number; height: number; size: number }>('/ai-chat/images', form)
}

export function deleteAiChatAttachment(imageId: number): Promise<{ ok: boolean }> {
  return api.delete<{ ok: boolean }>(`/ai-chat/images/${imageId}`)
}

/**
 * AI 对话图片的访问地址。
 *
 * `<img src>` 无法携带 Authorization 头，服务端允许 `?token=` 登录令牌鉴权
 * （与 lib/chat.ts 的 chatImageUrl 同一套机制）。
 */
export function aiChatImageUrl(imageId: number): string {
  const trailing = /\/+$/
  const base = (import.meta.env.VITE_API_URL || '/api').replace(trailing, '')
  const token = getToken() ?? ''
  return `${base}/ai-chat/images/${imageId}/image?token=${encodeURIComponent(token)}`
}

/** 附件预览地址（已带 token，可直接放 <img src>） */
export function attachmentPreviewUrl(imageId: number): string {
  return aiChatImageUrl(imageId)
}

// === SSE 流式发消息 ===

export interface AiChatMeta {
  conversationId: number
  userMessageId: number
  remaining: number | null
  unlimited: boolean
}

export interface AiChatDone {
  assistantMessageId: number | null
  model: string
  partial: boolean
  conversationId: number
  remaining: number | null
  unlimited: boolean
}

export interface AiChatStreamHandlers {
  onMeta: (meta: AiChatMeta) => void
  onDelta: (text: string) => void
  onDone: (done: AiChatDone) => void
  onError: (message: string) => void
}

export interface AiChatSendBody {
  conversationId?: number
  content: string
  imageIds?: number[]
}

/** 429 配额错误的响应体（SSE 建立前返回 JSON） */
export interface AiChatQuotaError extends ApiError {
  quota?: { dailyLimit: number; used: number; remaining: number; unlimited: boolean }
}

/**
 * 发送消息并流式接收回复。
 *
 * 事件序列：{meta} → {delta}* → {done,…} | {error}。
 * SSE 建立前的错误（401/400/429/503）是普通 JSON，统一转成带 status 的
 * ApiError 抛出（429 时额外携带 quota 字段）；建立后的错误走 onError。
 */
export async function streamAiChatMessage(
  body: AiChatSendBody,
  handlers: AiChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const trailing = /\/+$/
  const base = (import.meta.env.VITE_API_URL || '/api').replace(trailing, '')
  const token = getToken() ?? ''

  const res = await fetch(`${base}/ai-chat/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}) as Record<string, unknown>)
    const err = new ApiError(
      typeof data.error === 'string' ? data.error : `请求失败 (${res.status})`,
      res.status,
    ) as AiChatQuotaError
    if (data.quota && typeof data.quota === 'object') {
      err.quota = data.quota as AiChatQuotaError['quota']
    }
    throw err
  }

  const reader = res.body?.getReader()
  if (!reader) {
    handlers.onError('浏览器不支持流式响应')
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''

  const dispatch = (frame: string) => {
    const line = frame.trim()
    if (!line.startsWith('data:')) return
    const payloadText = line.slice(5).trim()
    if (!payloadText) return
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(payloadText) as Record<string, unknown>
    } catch {
      return
    }
    if (typeof payload.meta === 'object' && payload.meta !== null) {
      handlers.onMeta(payload.meta as unknown as AiChatMeta)
    } else if (typeof payload.delta === 'string') {
      handlers.onDelta(payload.delta)
    } else if (payload.error !== undefined) {
      handlers.onError(typeof payload.error === 'string' ? payload.error : 'AI 回复失败')
    } else if (payload.done === true) {
      handlers.onDone(payload as unknown as AiChatDone)
    }
  }

  try {
    // SSE 帧以空行分隔；缓冲到完整帧再分发
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let separator = buffer.indexOf('\n\n')
      while (separator !== -1) {
        dispatch(buffer.slice(0, separator))
        buffer = buffer.slice(separator + 2)
        separator = buffer.indexOf('\n\n')
      }
    }
    // 尾部残留帧
    if (buffer.trim()) dispatch(buffer)
  } catch (err) {
    // 主动停止（AbortController）不视为错误，由调用方处理中断收尾
    if (signal?.aborted) return
    if (err instanceof DOMException && err.name === 'AbortError') return
    handlers.onError(err instanceof Error ? err.message : '连接中断，请稍后重试')
  }
}
