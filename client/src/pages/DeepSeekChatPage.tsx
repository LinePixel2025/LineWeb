import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  aiChatImageUrl,
  attachmentPreviewUrl,
  deleteAiChatAttachment,
  deleteAiChatConversation,
  fetchAiChatConversations,
  fetchAiChatMessages,
  fetchAiChatQuota,
  streamAiChatMessage,
  uploadAiChatImage,
  type AiChatAttachment,
  type AiChatMessageDto,
  type AiChatQuota,
  type AiChatQuotaError,
} from '../lib/aiChat'
import { renderMarkdown } from '../lib/markdown'
import { queryKeys } from '../lib/queryKeys'
import ChatCameraDialog from '../components/chat/ChatCameraDialog'

/**
 * DeepSeek 对话页（/deepseek，需登录）
 *
 * 由站内后端统一代理 AI 服务：多会话 + SSE 流式回复 + 图片/拍照提问，
 * 头部展示每日剩余提问次数（管理员可在 /admin/ai-chat 设置）。
 * 消息气泡复用 gh-ai-* 样式（与首页 AI 助手一致），布局用 gh-ds-* 命名空间。
 */

/** 每条消息最多携带的图片数（与服务端一致） */
const MAX_ATTACHMENTS = 4

function AiSparkIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 .5l1.66 5.84L15.5 8l-5.84 1.66L8 15.5l-1.66-5.84L.5 8l5.84-1.66L8 .5z" />
      <circle cx="8" cy="8" r="1.7" fill="var(--gh-canvas)" />
    </svg>
  )
}

/** 思考开关的本地持久化键（跨会话记住用户偏好） */
const THINKING_PREF_KEY = 'lineweb_aichat_thinking'

function readThinkingPref(): boolean {
  try {
    return localStorage.getItem(THINKING_PREF_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * 思考过程折叠块：流式生成中默认展开并自动滚动，正文开始后自动收起；
 * 历史消息默认收起，点击可展开查看。
 */
function ReasoningBlock({ text, live = false }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(live)
  const bodyRef = useRef<HTMLDivElement>(null)

  // live 状态翻转（思考开始/正文开始）时跟随展开或收起；期间的手动开合不被覆盖
  useEffect(() => {
    setOpen(live)
  }, [live])

  // 生成中保持滚动到底部，模拟"正在打出思考过程"
  useEffect(() => {
    if (open && live && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [text, open, live])

  return (
    <div className={`gh-ds-reasoning${live ? ' gh-ds-reasoning--live' : ''}`}>
      <button
        type="button"
        className="gh-ds-reasoning-toggle"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span className="gh-ds-reasoning-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
        {live ? '深度思考中…' : '已深度思考（点击可查看思考过程）'}
      </button>
      {open && (
        <div ref={bodyRef} className="gh-ds-reasoning-body">{text}</div>
      )}
    </div>
  )
}

export default function DeepSeekChatPage() {
  const queryClient = useQueryClient()

  // === 服务端数据 ===
  const quotaQuery = useQuery({
    queryKey: queryKeys.aiChat.quota,
    queryFn: fetchAiChatQuota,
    staleTime: 0,
    refetchOnMount: 'always',
  })
  const conversationsQuery = useQuery({
    queryKey: queryKeys.aiChat.conversations,
    queryFn: fetchAiChatConversations,
  })
  const quota = quotaQuery.data
  const conversations = conversationsQuery.data?.conversations ?? []

  // === 本地状态 ===
  const [activeId, setActiveId] = useState<number | null>(null)
  const [messages, setMessages] = useState<AiChatMessageDto[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<AiChatAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [streamWaiting, setStreamWaiting] = useState(false)
  /** 当前流式回复的思考过程（仅思考模式且上游支持时非空；先于正文输出） */
  const [streamReasoning, setStreamReasoning] = useState('')
  const [thinking, setThinking] = useState(readThinkingPref)
  const [error, setError] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const streamTextRef = useRef('')
  const streamReasoningRef = useRef('')
  const endRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)

  const featureEnabled = quota ? quota.enabled : true // 加载中先按可用渲染，避免闪烁

  // === 切换会话时加载历史 ===
  useEffect(() => {
    if (activeId === null) {
      setMessages([])
      setHasMore(false)
      return
    }
    let cancelled = false
    setLoadingHistory(true)
    setError('')
    fetchAiChatMessages(activeId)
      .then(page => {
        if (cancelled) return
        setMessages(page.messages)
        setHasMore(page.hasMore)
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载历史消息失败')
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false)
      })
    return () => { cancelled = true }
  }, [activeId])

  // === 新消息 / 流式输出（含思考过程）时滚到底部 ===
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, streamText, streamReasoning, streamWaiting])

  /** 用服务端真实状态覆盖本地消息列表（中断 / 出错后对齐） */
  const refreshMessages = useCallback((conversationId: number) => {
    fetchAiChatMessages(conversationId)
      .then(page => {
        setMessages(page.messages)
        setHasMore(page.hasMore)
      })
      .catch(() => {})
  }, [])

  /** 更新额度缓存（流式 meta / 429 响应都会携带最新剩余） */
  const patchQuota = useCallback((patch: Partial<AiChatQuota>) => {
    queryClient.setQueryData<AiChatQuota>(queryKeys.aiChat.quota, prev =>
      prev ? { ...prev, ...patch } : prev,
    )
  }, [queryClient])

  // === 发送 ===
  const handleSend = async () => {
    const content = input.trim()
    if (streaming || uploading) return
    if (!content && attachments.length === 0) return
    if (!featureEnabled) return

    const imageIds = attachments.map(a => a.id)
    const sentAttachments = attachments

    // 乐观插入 user 消息（负数临时 id；onMeta 到达后替换为真实 id）
    const optimisticId = -Date.now()
    const optimistic: AiChatMessageDto = {
      id: optimisticId,
      role: 'user',
      content,
      reasoningContent: null,
      model: null,
      createdAt: new Date().toISOString(),
      images: sentAttachments.map(a => ({ id: a.id, width: a.width, height: a.height, size: a.size })),
    }
    setMessages(prev => [...prev, optimistic])
    // 失败时恢复草稿
    const draftInput = input
    const draftAttachments = attachments
    setInput('')
    setAttachments([])
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    setStreaming(true)
    setStreamText('')
    setStreamReasoning('')
    setStreamWaiting(true)
    setError('')
    streamTextRef.current = ''
    streamReasoningRef.current = ''

    const controller = new AbortController()
    abortRef.current = controller
    let conversationIdForServer = activeId
    let completed = false

    try {
      await streamAiChatMessage(
        { conversationId: activeId ?? undefined, content, imageIds, thinking },
        {
          onMeta: (meta) => {
            conversationIdForServer = meta.conversationId
            if (activeId === null) setActiveId(meta.conversationId)
            patchQuota({ remaining: meta.remaining, unlimited: meta.unlimited })
            // 用服务端返回的真实 id 替换乐观消息
            setMessages(prev => prev.map(m =>
              m.id === optimisticId
                ? { ...m, id: meta.userMessageId }
                : m,
            ))
          },
          onReasoning: (delta) => {
            // 思考内容开始即视为有输出，替换"正在思考"点点点
            setStreamWaiting(false)
            streamReasoningRef.current += delta
            setStreamReasoning(streamReasoningRef.current)
          },
          onDelta: (delta) => {
            setStreamWaiting(false)
            streamTextRef.current += delta
            setStreamText(streamTextRef.current)
          },
          onDone: (done) => {
            completed = true
            const text = streamTextRef.current.trim()
            if (text) {
              setMessages(prev => [...prev, {
                id: done.assistantMessageId ?? -Date.now(),
                role: 'assistant',
                content: text,
                reasoningContent: streamReasoningRef.current.trim() || null,
                model: done.model,
                createdAt: new Date().toISOString(),
                images: [],
              }])
            } else {
              setError('AI 没有返回内容，请重试')
            }
            setStreamText('')
            setStreamReasoning('')
            setStreamWaiting(false)
            // 新会话出现在列表；额度已由 meta 更新，这里再兜底刷新
            void queryClient.invalidateQueries({ queryKey: queryKeys.aiChat.conversations })
            void queryClient.invalidateQueries({ queryKey: queryKeys.aiChat.quota })
          },
          onError: (message) => {
            setError(message)
            setStreamText('')
            setStreamWaiting(false)
          },
        },
        controller.signal,
      )
    } catch (err) {
      // SSE 建立前的 JSON 错误（400 / 429 / 503）
      if (controller.signal.aborted) return
      const quotaErr = err as AiChatQuotaError
      if (quotaErr.quota) {
        patchQuota({
          dailyLimit: quotaErr.quota.dailyLimit,
          used: quotaErr.quota.used,
          remaining: quotaErr.quota.remaining,
          unlimited: quotaErr.quota.unlimited,
        })
      }
      setError(err instanceof Error ? err.message : '发送失败')
      // 恢复草稿，避免用户重打一遍
      setInput(draftInput)
      setAttachments(draftAttachments)
      setMessages(prev => prev.filter(m => m.id !== optimisticId))
    } finally {
      abortRef.current = null
      setStreaming(false)
      setStreamText('')
      setStreamReasoning('')
      setStreamWaiting(false)
      // 未正常完成（中断 / 上游失败）时对齐服务端真实状态：
      // 上游失败该条消息不计入配额，中断则服务端已落库部分回复
      if (!completed && conversationIdForServer !== null) {
        refreshMessages(conversationIdForServer)
      }
    }
  }

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    // 中文输入法组合中按 Enter 是确认候选词，不应发送
    if (event.nativeEvent.isComposing) return
    event.preventDefault()
    void handleSend()
  }

  // === 附件 ===
  const uploadFile = async (file: File) => {
    if (uploading) return
    if (attachments.length >= MAX_ATTACHMENTS) {
      setError(`每条消息最多 ${MAX_ATTACHMENTS} 张图片`)
      return
    }
    setUploading(true)
    setError('')
    try {
      const dto = await uploadAiChatImage(file)
      setAttachments(prev => [...prev, { ...dto, previewUrl: attachmentPreviewUrl(dto.id) }])
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片上传失败')
    } finally {
      setUploading(false)
    }
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void uploadFile(file)
  }

  const handleCameraClick = () => {
    // 非安全上下文（如 http://<IP>）下 navigator.mediaDevices 可能为 undefined
    if (typeof navigator.mediaDevices?.getUserMedia === 'function') {
      setCameraOpen(true)
      return
    }
    cameraInputRef.current?.click()
  }

  const removeAttachment = async (imageId: number) => {
    setAttachments(prev => prev.filter(a => a.id !== imageId))
    try {
      await deleteAiChatAttachment(imageId)
    } catch {
      // 删除失败不影响本地移除（服务端孤儿附件会被定时清理）
    }
  }

  // === 会话 ===
  const startNewConversation = () => {
    if (streaming) return
    setActiveId(null)
    setMessages([])
    setHasMore(false)
    setError('')
    setListOpen(false)
  }

  const removeConversation = async (conversationId: number) => {
    if (!window.confirm('确定删除这个会话吗？历史消息将一并删除。')) return
    try {
      await deleteAiChatConversation(conversationId)
      void queryClient.invalidateQueries({ queryKey: queryKeys.aiChat.conversations })
      if (activeId === conversationId) startNewConversation()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除会话失败')
    }
  }

  const loadOlder = async () => {
    if (activeId === null || loadingHistory) return
    const oldest = messages.find(m => m.id > 0)
    if (!oldest) return
    setLoadingHistory(true)
    try {
      const page = await fetchAiChatMessages(activeId, oldest.id)
      setMessages(prev => [...page.messages, ...prev])
      setHasMore(page.hasMore)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载更早消息失败')
    } finally {
      setLoadingHistory(false)
    }
  }

  // === 渲染 ===
  const canSubmit = featureEnabled && !streaming && !uploading && (input.trim().length > 0 || attachments.length > 0)

  const quotaChip = quota ? (
    <span className={`gh-ds-quota ${!quota.unlimited && quota.remaining === 0 ? 'gh-ds-quota--out' : ''}`}>
      {!quota.enabled
        ? '未开启'
        : quota.unlimited
          ? '不限次数'
          : `今日剩余 ${quota.remaining ?? 0} 次`}
      {!quota.unlimited && quota.enabled && quota.remaining !== null && quota.remaining > 0 && ` / 上限 ${quota.dailyLimit}`}
    </span>
  ) : null

  const renderMessage = (message: AiChatMessageDto) => (
    <div key={message.id} className={`gh-ai-message gh-ai-message--${message.role}`}>
      {message.role === 'assistant' && (
        <span className="gh-ai-message-avatar" aria-hidden="true"><AiSparkIcon size={13} /></span>
      )}
      <div className="gh-ds-message-body">
        {message.images.length > 0 && (
          <div className="gh-ds-images">
            {message.images.map(img => (
              <img
                key={img.id}
                className="gh-ds-image"
                src={aiChatImageUrl(img.id)}
                width={img.width}
                height={img.height}
                loading="lazy"
                alt="提问附件"
                onClick={() => window.open(aiChatImageUrl(img.id), '_blank', 'noopener')}
              />
            ))}
          </div>
        )}
        {message.role === 'assistant' && message.reasoningContent && (
          <ReasoningBlock text={message.reasoningContent} />
        )}
        {(message.content || message.images.length === 0) && (
          <div className="gh-ai-bubble">
            {message.role === 'assistant'
              ? <div dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
              : message.content}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="gh-page-container gh-ds-page">
      <header className="gh-games-header">
        <div className="gh-games-header-copy">
          <p className="gh-g2048-eyebrow"><Link to="/features">← 功能页面</Link></p>
          <h1 className="gh-games-title">DeepSeek 对话</h1>
          <p className="gh-games-subtitle">
            与站内 AI 多轮对话，支持图片提问；每天有提问次数上限，由站内服务统一代理。
            {quota && quota.enabled ? <span className="gh-ds-model"> 当前模型：{quota.model}</span> : null}
          </p>
        </div>
        <div className="gh-ds-header-actions">
          {quotaChip}
          <button
            type="button"
            className="gh-ds-list-toggle gh-btn gh-btn--secondary gh-btn--sm"
            onClick={() => setListOpen(open => !open)}
            aria-expanded={listOpen}
          >
            {listOpen ? '收起会话' : '历史会话'}
          </button>
        </div>
      </header>

      {error && (
        <div className="gh-ds-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="关闭错误提示">×</button>
        </div>
      )}

      {!featureEnabled ? (
        <div className="gh-box gh-ds-notice">
          <h2>AI 对话暂未开启</h2>
          <p>管理员尚未开启此功能。开启后即可在这里与 AI 对话，支持图片提问。</p>
        </div>
      ) : (
        <div className={`gh-ds-layout ${listOpen ? 'gh-ds-layout--list-open' : ''}`}>
          {/* 会话列表 */}
          <aside className="gh-ds-list" aria-label="历史会话">
            <button
              type="button"
              className="gh-btn gh-btn--primary gh-btn--sm gh-ds-new-btn"
              onClick={startNewConversation}
              disabled={streaming}
            >
              ＋ 新对话
            </button>
            <div className="gh-ds-list-items">
              {conversations.length === 0 && (
                <p className="gh-ds-list-empty">还没有会话，发第一条消息开始吧</p>
              )}
              {conversations.map(conversation => (
                <div
                  key={conversation.id}
                  className={`gh-ds-list-item ${conversation.id === activeId ? 'gh-ds-list-item--active' : ''}`}
                >
                  <button
                    type="button"
                    className="gh-ds-list-title"
                    onClick={() => { setActiveId(conversation.id); setListOpen(false) }}
                    title={conversation.title}
                  >
                    {conversation.title || '新对话'}
                  </button>
                  <button
                    type="button"
                    className="gh-ds-list-delete"
                    aria-label={`删除会话 ${conversation.title}`}
                    title="删除会话"
                    onClick={() => void removeConversation(conversation.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </aside>

          {/* 对话区 */}
          <section className="gh-ds-main">
            <div className="gh-ds-thread" role="log" aria-live="polite">
              {loadingHistory && messages.length === 0 && (
                <div className="gh-ds-thread-loading"><span className="gh-spinner" /></div>
              )}
              {hasMore && messages.length > 0 && (
                <button type="button" className="gh-ds-load-older" onClick={() => void loadOlder()} disabled={loadingHistory}>
                  {loadingHistory ? '加载中…' : '加载更早消息'}
                </button>
              )}
              {messages.length === 0 && !loadingHistory && !streaming && (
                <div className="gh-ds-empty">
                  <span className="gh-ds-empty-icon" aria-hidden="true"><AiSparkIcon size={26} /></span>
                  <h2>开始新的对话</h2>
                  <p>输入问题，或点击「图片 / 拍照」附上截图一起提问。</p>
                </div>
              )}
              {messages.map(renderMessage)}
              {streaming && (
                <div className="gh-ai-message gh-ai-message--assistant">
                  <span className="gh-ai-message-avatar" aria-hidden="true"><AiSparkIcon size={13} /></span>
                  <div className="gh-ds-message-body">
                    {streamWaiting ? (
                      <div className="gh-ai-bubble gh-ai-typing">
                        <span className="gh-ai-typing-label">正在思考</span>
                        <span className="gh-ai-dot" />
                        <span className="gh-ai-dot" />
                        <span className="gh-ai-dot" />
                      </div>
                    ) : (
                      <>
                        {streamReasoning && (
                          <ReasoningBlock
                            text={streamReasoning}
                            live={streamText === ''}
                          />
                        )}
                        {streamText && (
                          <div className="gh-ai-bubble">
                            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(streamText) }} />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            {/* 附件条 */}
            {attachments.length > 0 && (
              <div className="gh-ds-attachments">
                {attachments.map(attachment => (
                  <div key={attachment.id} className="gh-ds-attachment">
                    <img src={attachment.previewUrl} alt="待发送附件" />
                    <button
                      type="button"
                      className="gh-ds-attachment-remove"
                      aria-label="移除附件"
                      onClick={() => void removeAttachment(attachment.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 输入区 */}
            <div className="gh-ds-composer">
              <div className="gh-ds-composer-tools">
                <button
                  type="button"
                  className={`gh-ds-tool${thinking ? ' gh-ds-tool--active' : ''}`}
                  aria-pressed={thinking}
                  aria-label="深度思考开关"
                  title={thinking ? '深度思考已开启：回复前会先输出思考过程' : '开启深度思考：回复前会先输出思考过程'}
                  disabled={!featureEnabled || streaming || uploading}
                  onClick={() => setThinking(t => {
                    const next = !t
                    try { localStorage.setItem(THINKING_PREF_KEY, next ? '1' : '0') } catch { /* 存不下也不阻断 */ }
                    return next
                  })}
                >
                  深度思考{thinking ? ' · 开' : ''}
                </button>
                <button
                  type="button"
                  className="gh-ds-tool"
                  aria-label="上传图片"
                  title="上传图片"
                  disabled={!featureEnabled || streaming || uploading}
                  onClick={() => imageInputRef.current?.click()}
                >
                  图片
                </button>
                <button
                  type="button"
                  className="gh-ds-tool"
                  aria-label="拍照"
                  title="拍照"
                  disabled={!featureEnabled || streaming || uploading}
                  onClick={handleCameraClick}
                >
                  拍照
                </button>
                {uploading && <span className="gh-ds-tool-hint">图片上传中…</span>}
                <span className="gh-ds-composer-tip">Enter 发送 · Shift+Enter 换行 · 最多 {MAX_ATTACHMENTS} 张图</span>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="gh-ds-visually-hidden"
                  aria-hidden="true"
                  tabIndex={-1}
                  onChange={handleFileChange}
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="gh-ds-visually-hidden"
                  aria-hidden="true"
                  tabIndex={-1}
                  onChange={handleFileChange}
                />
              </div>
              <div className="gh-ds-composer-row">
                <textarea
                  ref={textareaRef}
                  className="gh-ai-input gh-ds-input"
                  value={input}
                  rows={1}
                  maxLength={4000}
                  placeholder={featureEnabled ? '输入你的问题…' : '功能未开启'}
                  aria-label="消息输入框"
                  disabled={!featureEnabled || streaming}
                  onChange={event => {
                    setInput(event.target.value.slice(0, 4000))
                    const el = event.currentTarget
                    el.style.height = 'auto'
                    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
                  }}
                  onKeyDown={handleKeyDown}
                />
                {streaming ? (
                  <button
                    type="button"
                    className="gh-btn gh-btn--sm gh-ds-stop"
                    onClick={handleStop}
                    aria-label="停止生成"
                  >
                    停止
                  </button>
                ) : (
                  <button
                    type="button"
                    className="gh-btn gh-btn--primary gh-btn--sm"
                    disabled={!canSubmit}
                    onClick={() => void handleSend()}
                    aria-label="发送消息"
                  >
                    发送
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      <ChatCameraDialog
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={file => void uploadFile(file)}
        onFallback={() => cameraInputRef.current?.click()}
      />
    </div>
  )
}
