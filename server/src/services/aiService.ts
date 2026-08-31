import OpenAI from 'openai'
import prisma from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface AiConfigData {
  id: number
  provider: string
  model: string
  apiKey: string
  baseUrl: string | null
  systemPrompt: string
  isEnabled: boolean
  updatedAt: Date
}

/**
 * 获取 AI 配置（单例行），不存在时自动创建默认行
 */
export async function getAiConfig(): Promise<AiConfigData> {
  let config = await prisma.aiConfig.findFirst()
  if (!config) {
    config = await prisma.aiConfig.create({ data: {} })
  }
  return config
}

/**
 * 更新 AI 配置
 */
export async function updateAiConfig(data: {
  provider?: string
  model?: string
  apiKey?: string
  baseUrl?: string | null
  systemPrompt?: string
  isEnabled?: boolean
}): Promise<AiConfigData> {
  const config = await getAiConfig()
  return prisma.aiConfig.update({
    where: { id: config.id },
    data,
  })
}

/**
 * 脱敏 API Key（仅显示后 4 位）
 */
export function maskApiKey(key: string): string {
  if (!key || key.length <= 4) return key ? '****' : ''
  return 'sk-…' + key.slice(-4)
}

/**
 * 读取 AI 配置并校验可用性（对话与写作功能共用 AI 设置页填写的 API）
 */
async function assertAiReady(): Promise<AiConfigData> {
  const config = await getAiConfig()
  if (!config.isEnabled) {
    throw new AppError('AI 助手未启用，请先在 AI 设置中开启', 503)
  }
  if (!config.apiKey) {
    throw new AppError('AI 未配置 API Key，请在 AI 设置中填写', 503)
  }
  return config
}

/**
 * 按配置创建 OpenAI 客户端（baseUrl 兼容各家 API 格式）
 */
function createClient(config: AiConfigData, timeoutMs = 30_000): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl || undefined,
    timeout: timeoutMs,
    maxRetries: 1,
  })
}

/**
 * 统一映射上游 AI 服务异常为 AppError
 */
function toAiError(err: unknown, label: string): AppError {
  const errMsg = err instanceof Error ? err.message : 'Unknown error'
  console.error(`[AI ${label}] 调用失败:`, errMsg)
  if (errMsg.includes('401') || errMsg.includes('Incorrect API key')) {
    return new AppError('AI API Key 无效，请联系管理员检查配置', 502)
  }
  if (errMsg.includes('429') || errMsg.includes('Rate limit')) {
    return new AppError('AI 服务请求过于频繁，请稍后再试', 429)
  }
  if (errMsg.includes('timeout') || errMsg.includes('ETIMEDOUT')) {
    return new AppError('AI 服务响应超时，请稍后再试', 504)
  }
  return new AppError('AI 服务暂时不可用，请稍后再试', 502)
}

/**
 * 获取指定日期的日期键（YYYY-MM-DD，Asia/Shanghai UTC+8，无夏令时）
 */
function getDateKey(offsetDays: number): string {
  const now = Date.now() + offsetDays * 24 * 60 * 60 * 1000
  const shanghai = new Date(now + 8 * 60 * 60 * 1000)
  const y = shanghai.getUTCFullYear()
  const m = String(shanghai.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shanghai.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 将 "YYYY-MM-DD" 格式化为 "M月D日" */
function formatDateDisplay(dateKey: string): string {
  const [, m, d] = dateKey.split('-')
  return `${parseInt(m, 10)}月${parseInt(d, 10)}日`
}

/** 将秒数格式化为可读时长（如 2小时30分 / 45分钟） */
function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const mins = Math.floor((totalSeconds % 3600) / 60)
  if (hours > 0 && mins > 0) return `${hours}小时${mins}分`
  if (hours > 0) return `${hours}小时`
  return `${mins}分钟`
}

/**
 * 构建包含网站内容的 system prompt
 * @param message 用户当前消息（用于按需检索文章正文）
 * @param userId 登录用户 ID（可选，注入该用户屏幕使用时间）
 */
async function buildSystemPrompt(basePrompt: string, message: string, userId?: number): Promise<string> {
  // 获取所有已发布文章
  const posts = await prisma.post.findMany({
    where: { published: true },
    select: { title: true, summary: true, slug: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })

  // 获取所有已发布页面（含非精选，精选加标记）
  const pages = await prisma.page.findMany({
    where: { published: true },
    select: { title: true, featureDesc: true, slug: true, featured: true },
  })

  let contextBlock = ''

  // 站点统计（仅公开数据，不含用户数）
  const [publishedPosts, publishedPages, commentCount] = await Promise.all([
    prisma.post.count({ where: { published: true } }),
    prisma.page.count({ where: { published: true } }),
    prisma.comment.count(),
  ])
  contextBlock += '\n\n## 站点统计\n'
  contextBlock += `- 已发布文章: ${publishedPosts} 篇\n`
  contextBlock += `- 功能页面: ${publishedPages} 个\n`
  contextBlock += `- 评论: ${commentCount} 条\n`

  if (posts.length > 0) {
    contextBlock += '\n## 网站文章列表\n'
    for (const p of posts) {
      const date = new Date(p.createdAt).toLocaleDateString('zh-CN')
      contextBlock += `- 《${p.title}》(/${p.slug}) [${date}]`
      if (p.summary) contextBlock += ` — ${p.summary}`
      contextBlock += '\n'
    }
  }

  if (pages.length > 0) {
    contextBlock += '\n## 网站功能页面\n'
    for (const p of pages) {
      contextBlock += `- ${p.title}(/page/${p.slug})`
      if (p.featured) contextBlock += ' [精选]'
      if (p.featureDesc) contextBlock += ` — ${p.featureDesc}`
      contextBlock += '\n'
    }
  }

  // 最新评论（顶层评论，内容截断 80 字）
  const recentComments = await prisma.comment.findMany({
    where: { parentId: null },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      content: true,
      createdAt: true,
      post: { select: { title: true } },
      author: { select: { username: true } },
    },
  })
  if (recentComments.length > 0) {
    contextBlock += '\n## 最近评论\n'
    for (const c of recentComments) {
      const date = new Date(c.createdAt).toLocaleDateString('zh-CN')
      const content = c.content.length > 80 ? c.content.slice(0, 80) + '…' : c.content
      contextBlock += `- 《${c.post.title}》 by ${c.author?.username ?? '匿名'} [${date}]: ${content}\n`
    }
  }

  // 文章正文按需检索：用户消息中提到文章标题或 /slug 时注入全文（最多 2 篇，每篇截断 1500 字）
  if (message.trim()) {
    const matched = posts.filter(p => message.includes(p.title) || message.includes(p.slug))
    if (matched.length > 0) {
      const picked = matched.slice(0, 2)
      const fullPosts = await prisma.post.findMany({
        where: { slug: { in: picked.map(p => p.slug) } },
        select: { title: true, slug: true, content: true },
      })
      contextBlock += '\n## 文章正文（按需检索）\n'
      for (const fp of fullPosts) {
        const content = fp.content.length > 1500 ? fp.content.slice(0, 1500) + '…' : fp.content
        contextBlock += `\n### 《${fp.title}》(/${fp.slug})\n${content}\n`
      }
    }
  }

  // 屏幕使用时间（仅登录用户可见；游客不注入，AI 会如实告知无法查询）
  if (userId) {
    const logs = await prisma.screenTimeLog.findMany({
      where: { userId, date: { gte: getDateKey(-13) } },
      orderBy: { date: 'asc' },
      select: { date: true, totalSeconds: true },
    })
    if (logs.length > 0) {
      contextBlock += '\n## 屏幕使用时间（近 14 天，仅当前登录用户可见）\n'
      for (const log of logs) {
        contextBlock += `- ${formatDateDisplay(log.date)}: ${formatDuration(log.totalSeconds)}\n`
      }
    } else {
      contextBlock += '\n## 屏幕使用时间\n近 14 天没有屏幕使用数据。\n'
    }
  }

  return basePrompt + contextBlock
}

/**
 * 核心对话函数：向 AI 发送消息并获取回复
 * @param userId 登录用户 ID（可选，用于注入该用户的屏幕使用时间上下文）
 */
export async function chat(
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
  userId?: number,
): Promise<{ reply: string; model: string }> {
  const config = await assertAiReady()

  // 构建完整的 system prompt（含网站内容）
  const systemPrompt = await buildSystemPrompt(config.systemPrompt, message, userId)

  const client = createClient(config)

  // 组装消息
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-20), // 最多保留最近 20 条历史
    { role: 'user', content: message },
  ]

  try {
    const completion = await client.chat.completions.create({
      model: config.model,
      messages,
      max_tokens: 2000,
      temperature: 0.7,
    })

    const reply = completion.choices[0]?.message?.content?.trim() || '抱歉，我没有生成回复。'

    return {
      reply,
      model: config.model,
    }
  } catch (err: unknown) {
    throw toAiError(err, 'Chat')
  }
}

/* ============================================================
   写作 AI — 辅助文章创作（摘要 / 润色 / 标题 / 起稿）
   复用 AI 设置页配置的 API；system prompt 为写作专用，
   不注入站点问答上下文（文章列表、评论、屏幕时间等）。
   ============================================================ */

export type PolishAction = 'polish' | 'expand' | 'fix'

const POLISH_INSTRUCTIONS: Record<PolishAction, string> = {
  polish: '在保持原意的前提下润色这段文字：提升流畅度与文采，消除口语化和冗余表达。',
  expand: '对这段文字进行扩写：补充细节、例证或解释，使内容更充实，篇幅约为原文的 1.5-2 倍。',
  fix: '修正这段文字中的错别字、标点和语法错误，不改变原有表达风格和用词习惯。',
}

async function completeForWriting(
  systemPrompt: string,
  userPrompt: string,
  opts: { maxTokens: number; temperature: number; label: string },
): Promise<{ text: string; model: string }> {
  const config = await assertAiReady()
  const client = createClient(config)
  try {
    const completion = await client.chat.completions.create({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
    })
    return { text: completion.choices[0]?.message?.content?.trim() || '', model: config.model }
  } catch (err: unknown) {
    throw toAiError(err, opts.label)
  }
}

/** AI 生成文章摘要（120 字以内） */
export async function aiSummarize(contentHtml: string): Promise<{ summary: string; model: string }> {
  const text = stripHtmlForWriting(contentHtml)
  if (!text) throw new AppError('文章正文为空，无法生成摘要', 400)
  const { text: summary, model } = await completeForWriting(
    '你是一名专业的中文编辑。请为用户提供的文章正文生成一段摘要：不超过 120 字，准确概括主题与核心观点，不要照抄开头句子，不要加任何前缀或引号，直接输出摘要文本。',
    `文章正文：\n\n${text}`,
    { maxTokens: 300, temperature: 0.5, label: 'Write/Summary' },
  )
  if (!summary) throw new AppError('AI 未返回摘要，请重试', 502)
  return { summary: summary.slice(0, 500), model }
}

/** AI 润色/扩写/纠错选中文字 */
export async function aiPolish(text: string, action: PolishAction): Promise<{ text: string; model: string }> {
  const { text: result, model } = await completeForWriting(
    `你是一名专业的中文写作助手。${POLISH_INSTRUCTIONS[action]}只输出处理后的文本本身，不要解释、不要加引号或前后缀。如果输入是 HTML 片段，请保持相同的 HTML 标签结构输出。`,
    `待处理文本：\n\n${text}`,
    { maxTokens: 1500, temperature: 0.6, label: 'Write/Polish' },
  )
  if (!result) throw new AppError('AI 未返回结果，请重试', 502)
  return { text: result, model }
}

/** AI 生成标题建议（3-5 个） */
export async function aiTitles(contentHtml: string, summary?: string): Promise<{ titles: string[]; model: string }> {
  const text = stripHtmlForWriting(contentHtml)
  if (!text) throw new AppError('文章正文为空，无法生成标题', 400)
  const { text: raw, model } = await completeForWriting(
    '你是一名擅长起标题的中文编辑。根据文章内容生成 5 个风格各异、吸引人的文章标题：每行一个，不加编号、引号、书名号或解释。',
    (summary ? `摘要：${summary}\n\n` : '') + `文章正文：\n\n${text}`,
    { maxTokens: 400, temperature: 0.9, label: 'Write/Titles' },
  )
  const titles = raw
    .split('\n')
    .map(line => line.replace(/^[\d\-.•]+\s*/, '').replace(/^《|》$/g, '').trim())
    .filter(Boolean)
    .slice(0, 5)
  if (titles.length === 0) throw new AppError('AI 未返回标题，请重试', 502)
  return { titles, model }
}

/** AI 起稿（流式）：根据主题/提纲生成 Markdown 文章草稿 */
export async function streamDraft(
  input: { prompt: string; outline?: string; tone?: string; length?: string },
  handlers: { onChunk: (delta: string) => void; onDone: (model: string) => void; onError: (message: string) => void },
): Promise<void> {
  let config: AiConfigData
  try {
    config = await assertAiReady()
  } catch (err) {
    handlers.onError(err instanceof AppError ? err.message : 'AI 服务暂不可用')
    return
  }

  const TONES: Record<string, string> = {
    formal: '正式、严谨',
    casual: '轻松、口语化',
    tech: '技术向、准确、多用代码示例',
    story: '叙事性强、生动',
  }
  const LENGTHS: Record<string, string> = {
    short: '600-900 字',
    medium: '1200-1800 字',
    long: '2500-3500 字',
  }

  const systemPrompt = [
    '你是一名专业的中文文章作者。根据用户提供的主题与要求撰写一篇结构完整的文章。',
    '使用 Markdown 格式输出：用 ## 划分小节标题，正文用段落组织，可适当使用列表、引用和代码块。',
    '只输出文章本身（Markdown），不要输出任何与文章无关的说明、前言或总结性客套。',
    input.tone && TONES[input.tone] ? `文风要求：${TONES[input.tone]}。` : '',
    input.length && LENGTHS[input.length] ? `篇幅要求：约${LENGTHS[input.length]}。` : '',
  ].filter(Boolean).join('\n')

  const userPrompt = [
    `主题与要求：${input.prompt}`,
    input.outline ? `大纲（供参考，可酌情调整）：\n${input.outline}` : '',
  ].filter(Boolean).join('\n\n')

  const client = createClient(config, 120_000)

  try {
    const stream = await client.chat.completions.create({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 4000,
      temperature: 0.7,
      stream: true,
    })

    for await (const part of stream) {
      const delta = part.choices[0]?.delta?.content
      if (delta) handlers.onChunk(delta)
    }
    handlers.onDone(config.model)
  } catch (err: unknown) {
    handlers.onError(toAiError(err, 'Write/Draft').message)
  }
}

/** 去 HTML 标签用于送入写作模型（限制长度防止 token 浪费） */
function stripHtmlForWriting(html: string, maxChars = 6000): string {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > maxChars ? text.slice(0, maxChars) + '…' : text
}
