import OpenAI from 'openai'
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions.js'
import prisma from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { getDateKey, toAiError } from './aiService.js'
import { isNodeConnected } from './storageTunnel.js'
import { readAiImageBase64 } from './aiChatImageService.js'
import {
  buildSearchContext,
  isWebSearchConfigured,
  normalizeSearchQuery,
  searchWeb,
  toSearchSources,
  type WebSearchSource,
} from './webSearch.js'

/**
 * AI 对话（DeepSeek）服务
 *
 * 与首页 AI 助手（aiService）的关系：
 *   - 配置独立（AiChatConfig 单行），模型/Key/每日上限单独管理，互不影响
 *   - 复用 aiService 的时区口径（getDateKey，Asia/Shanghai）与上游错误映射（toAiError）
 *   - 这是通用对话，不注入站点统计上下文
 *
 * 每日配额口径：
 *   - 计数 = 当日（Asia/Shanghai 0 点起）counted=true 的 user 消息数
 *   - 上游调用失败时该条 user 消息置 counted=false，即失败不消耗提问次数
 *   - dailyLimit = 0 表示不限次数
 */

export interface AiChatConfigData {
  id: number
  provider: string
  model: string
  apiKey: string
  baseUrl: string | null
  systemPrompt: string
  dailyLimit: number
  isEnabled: boolean
  /** 联网搜索：管理员开关 + provider（bocha | tavily）+ 第三方搜索 Key */
  searchEnabled: boolean
  searchProvider: string
  searchApiKey: string
  updatedAt: Date
}

/** 获取 AI 对话配置（单例行），不存在时自动创建默认行 */
export async function getAiChatConfig(): Promise<AiChatConfigData> {
  let config = await prisma.aiChatConfig.findFirst()
  if (!config) {
    config = await prisma.aiChatConfig.create({ data: {} })
  }
  return config
}

/** 更新 AI 对话配置 */
export async function updateAiChatConfig(data: {
  provider?: string
  model?: string
  apiKey?: string
  baseUrl?: string | null
  systemPrompt?: string
  dailyLimit?: number
  isEnabled?: boolean
  searchEnabled?: boolean
  searchProvider?: string
  searchApiKey?: string
}): Promise<AiChatConfigData> {
  const config = await getAiChatConfig()
  return prisma.aiChatConfig.update({
    where: { id: config.id },
    data,
  })
}

/** 读取配置并校验可用性（未启用 / 未配置 Key 时 503，由路由在 SSE 头之前返回 JSON） */
export async function assertAiChatReady(): Promise<AiChatConfigData> {
  const config = await getAiChatConfig()
  if (!config.isEnabled) {
    throw new AppError('AI 对话未开启，请联系管理员', 503)
  }
  if (!config.apiKey) {
    throw new AppError('AI 对话未配置 API Key，请联系管理员', 503)
  }
  return config
}

/* ============================================================
   日期 / 配额（纯函数，verify:aichat 覆盖）
   ============================================================ */

/**
 * 今天的日期键（YYYY-MM-DD，Asia/Shanghai UTC+8，无夏令时）。
 * @param now 可注入的时间戳（毫秒），便于测试跨日边界
 */
export function getTodayDateKey(now: number = Date.now()): string {
  const shanghai = new Date(now + 8 * 60 * 60 * 1000)
  const y = shanghai.getUTCFullYear()
  const m = String(shanghai.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shanghai.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 日期键 → 当日 0 点（Asia/Shanghai）对应的绝对时间，用作配额计数的 createdAt 下界 */
export function getShanghaiDayStart(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00+08:00`)
}

/** 计算剩余提问次数：不限时为 null，超扣时为 0 */
export function computeRemaining(unlimited: boolean, limit: number, used: number): number | null {
  if (unlimited) return null
  return Math.max(limit - used, 0)
}

/** 会话标题：首条消息内容前 20 字；纯图片消息固定标题 */
export function deriveConversationTitle(content: string, hasImages: boolean): string {
  const text = content.trim()
  if (text) return text.slice(0, 20)
  if (hasImages) return '图片提问'
  return '新对话'
}

export interface DailyUsage {
  enabled: boolean
  model: string
  dailyLimit: number
  used: number
  remaining: number | null
  unlimited: boolean
  /** 联网搜索是否可用（管理员开启且已配置搜索 Key） */
  searchAvailable: boolean
  /** 配额重置日期（Asia/Shanghai，YYYY-MM-DD，即明天） */
  resetDate: string
}

/** 统计某用户今日（Asia/Shanghai）已使用的提问次数与剩余额度 */
export async function getDailyUsage(userId: number): Promise<DailyUsage> {
  const config = await getAiChatConfig()
  const unlimited = config.dailyLimit === 0
  const dayStart = getShanghaiDayStart(getTodayDateKey())
  const used = await prisma.aiMessage.count({
    where: {
      conversation: { userId },
      role: 'user',
      counted: true,
      createdAt: { gte: dayStart },
    },
  })
  return {
    enabled: config.isEnabled,
    model: config.model,
    dailyLimit: config.dailyLimit,
    used,
    remaining: computeRemaining(unlimited, config.dailyLimit, used),
    unlimited,
    searchAvailable: isWebSearchConfigured(config),
    resetDate: getDateKey(1),
  }
}

/* ============================================================
   消息 DTO 与 API 消息组装
   ============================================================ */

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
  /** 思考模型的思维链（仅 assistant 且思考模式；非思考为 null） */
  reasoningContent: string | null
  model: string | null
  createdAt: Date
  images: AiChatImageDto[]
}

/** 消息行 → 前端 DTO（images 按 id 升序，与上传顺序一致） */
export function toMessageDto(msg: {
  id: number
  role: string
  content: string
  reasoningContent: string | null
  model: string | null
  createdAt: Date
  images: { id: number; width: number; height: number; size: number }[]
}): AiChatMessageDto {
  return {
    id: msg.id,
    role: msg.role === 'assistant' ? 'assistant' : 'user',
    content: msg.content,
    reasoningContent: msg.role === 'assistant' ? msg.reasoningContent : null,
    model: msg.model,
    createdAt: msg.createdAt,
    images: [...msg.images].sort((a, b) => a.id - b.id).map(i => ({ id: i.id, width: i.width, height: i.height, size: i.size })),
  }
}

/** 历史消息里的图片标注（多模态只对当前消息生效，历史以文字占位） */
export function annotateHistoryContent(content: string, hasImages: boolean): string {
  if (!hasImages) return content
  return content.trim() ? `${content}（附图）` : '（图片）'
}

/** 当前消息送给模型的文本（纯图片时给默认指令） */
export function getUserTextForModel(content: string, hasImages: boolean): string {
  const text = content.trim()
  if (hasImages) return text || '请看这张图片'
  return text
}

/** 取会话中当前消息之前的最近 20 条作为上下文（升序返回） */
export async function buildHistoryMessages(
  conversationId: number,
  beforeMessageId: number,
): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const rows = await prisma.aiMessage.findMany({
    where: { conversationId, id: { lt: beforeMessageId } },
    orderBy: { id: 'desc' },
    take: 20,
    include: { images: { select: { id: true } } },
  })
  rows.reverse()
  return rows.map(r => ({
    role: r.role === 'assistant' ? 'assistant' : 'user',
    content: annotateHistoryContent(r.content, r.images.length > 0),
  }))
}

/* ============================================================
   流式对话（SSE）
   ============================================================ */

// OpenAI SDK 的多模态 content 部件（结构化最小子集，与 SDK 类型兼容）
interface ApiContentTextPart { type: 'text'; text: string }
interface ApiContentImagePart { type: 'image_url'; image_url: { url: string } }
type ApiContentPart = ApiContentTextPart | ApiContentImagePart

// 按 role 分成员定义，保证每个成员都能结构化赋值给 SDK 的 ChatCompletionMessageParam 联合
type ApiMessage =
  | { role: 'system'; content: string }
  | { role: 'user' | 'assistant'; content: string }
  | { role: 'user'; content: ApiContentPart[] }

export interface AiChatStreamParams {
  config: AiChatConfigData
  conversationId: number
  userMessageId: number
  userContent: string
  userImageRows: { id: number; imagePath: string }[]
  /** 思考模式：true 时向上游传 thinking:{type:'enabled'}，回复含思维链 */
  thinking: boolean
  /** 联网搜索：true 时先调用搜索服务，把网页资料注入本轮上下文 */
  search: boolean
}

export interface AiChatSearchEvent {
  status: 'start' | 'done'
  query: string
  /** done 时返回结果数 */
  results?: number
  /** done 时返回来源（用于前端展示；回答正文由模型按 Markdown 链接引用） */
  sources?: WebSearchSource[]
}

export interface AiChatStreamHandlers {
  onChunk: (delta: string) => void
  /** 思考内容增量（thinking=true 且上游支持时才有） */
  onReasoning: (delta: string) => void
  /** 联网搜索进度（仅在 search=true 时出现，先于 reasoning / delta） */
  onSearch?: (event: AiChatSearchEvent) => void
  onDone: (result: { assistantMessageId: number | null; model: string; partial: boolean }) => void
  onError: (message: string) => void
  /** 客户端是否已断开（路由传 !res.writableEnded）；中断时把已生成的部分落库 */
  isAborted?: () => boolean
}

/**
 * 上游 thinking 参数（DeepSeek 官方 API 的思考开关）。
 * 开与关都显式传：当前 DeepSeek 模型默认 enabled，关闭时必须显式 disabled 才能压过默认值。
 */
export function buildThinkingParam(thinking: boolean): { type: 'enabled' | 'disabled' } {
  return { type: thinking ? 'enabled' : 'disabled' }
}

/**
 * 流式生成 AI 回复并落库。
 *
 * 语义约定：
 *   - 上游失败：该 user 消息 counted 置 false（退还当日提问次数），不落 assistant 消息
 *   - 客户端中断：已生成的非空部分文本照常落库为 assistant 消息（partial=true）
 *   - 中断且尚无输出：不落 assistant 消息
 */
export async function streamAiChatReply(
  params: AiChatStreamParams,
  handlers: AiChatStreamHandlers,
): Promise<void> {
  const { config, conversationId, userMessageId, userContent, userImageRows, thinking, search } = params

  try {
    // === 联网搜索（可选）：先检索，再把资料作为额外 system 上下文注入 ===
    let searchContext: string | null = null
    if (search) {
      const query = normalizeSearchQuery(userContent)
      handlers.onSearch?.({ status: 'start', query })
      const results = await searchWeb(query, config)
      searchContext = buildSearchContext(query, results, Date.now())
      handlers.onSearch?.({
        status: 'done',
        query,
        results: results.length,
        sources: toSearchSources(results),
      })
      if (handlers.isAborted?.()) return
    }

    // === 组装上下文 ===
    const history = await buildHistoryMessages(conversationId, userMessageId)
    const hasImages = userImageRows.length > 0

    let currentMessage: ApiMessage
    if (hasImages) {
      if (!isNodeConnected()) {
        throw new AppError('存储节点未接入，暂时无法读取图片附件', 503)
      }
      // 图片并行转 base64 data URL（WebP，每张 ≤4 MiB，4 张上限）
      const base64List = await Promise.all(userImageRows.map(row => readAiImageBase64(row.imagePath)))
      const parts: ApiContentPart[] = [{ type: 'text', text: getUserTextForModel(userContent, true) }]
      for (const base64 of base64List) {
        parts.push({ type: 'image_url', image_url: { url: `data:image/webp;base64,${base64}` } })
      }
      currentMessage = { role: 'user', content: parts }
    } else {
      currentMessage = { role: 'user', content: getUserTextForModel(userContent, false) }
    }

    const messages: ApiMessage[] = [
      // 联网资料并入同一条 system，兼容只接受单条 system 的 OpenAI 兼容上游
      {
        role: 'system',
        content: searchContext ? `${config.systemPrompt}\n\n${searchContext}` : config.systemPrompt,
      },
      ...history,
      currentMessage,
    ]

    // === 调用上游（流式） ===
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || undefined,
      timeout: 120_000,
      maxRetries: 1,
    })

    // thinking 是 DeepSeek 扩展参数（OpenAI SDK 类型未收录），仅此一处断言放宽；
    // 断言到 Streaming 变体以保住 Stream 返回类型（asyncIterator / controller）
    const upstreamBody = {
      model: config.model,
      messages,
      max_tokens: 4000,
      temperature: 0.7,
      stream: true,
      thinking: buildThinkingParam(thinking),
    }
    const stream = await client.chat.completions.create(
      upstreamBody as unknown as ChatCompletionCreateParamsStreaming,
    )

    let fullText = ''
    let fullReasoning = ''
    let aborted = false
    for await (const part of stream) {
      // reasoning_content 是 DeepSeek 扩展字段（思维链，先于正文输出）
      const delta = part.choices[0]?.delta as { content?: string | null; reasoning_content?: string | null } | undefined
      if (delta?.reasoning_content) {
        fullReasoning += delta.reasoning_content
        handlers.onReasoning(delta.reasoning_content)
      }
      if (delta?.content) {
        fullText += delta.content
        handlers.onChunk(delta.content)
      }
      if (handlers.isAborted?.()) {
        aborted = true
        // 中断上游流，释放底层连接
        stream.controller?.abort()
        break
      }
    }

    // === 落库 assistant 消息（无任何输出时不落） ===
    const text = fullText.trim()
    if (!text) {
      handlers.onDone({ assistantMessageId: null, model: config.model, partial: aborted })
      return
    }

    const assistant = await prisma.aiMessage.create({
      data: {
        conversationId,
        role: 'assistant',
        content: text,
        reasoningContent: fullReasoning.trim() || null,
        model: config.model,
      },
    })
    // 触碰会话 updatedAt，让会话列表按最近活跃排序
    await prisma.aiConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    })

    handlers.onDone({ assistantMessageId: assistant.id, model: config.model, partial: aborted })
  } catch (err) {
    // 上游失败：退还配额（counted=false），不落 assistant 消息
    await prisma.aiMessage.update({
      where: { id: userMessageId },
      data: { counted: false },
    }).catch(() => {})
    // 搜索/存储等本地 AppError 保留明确文案；上游错误仍走统一映射
    handlers.onError(err instanceof AppError ? err.message : toAiError(err, 'AiChat').message)
  }
}
