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
  const config = await getAiConfig()

  if (!config.isEnabled) {
    throw new AppError('AI 助手未启用', 503)
  }

  if (!config.apiKey) {
    throw new AppError('AI 助手未配置 API Key，请联系管理员', 503)
  }

  // 构建完整的 system prompt（含网站内容）
  const systemPrompt = await buildSystemPrompt(config.systemPrompt, message, userId)

  // 初始化 OpenAI 客户端
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl || undefined,
    timeout: 30_000,
    maxRetries: 1,
  })

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
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[AI Chat] 调用失败:', errMsg)

    // 区分常见错误类型
    if (errMsg.includes('401') || errMsg.includes('Incorrect API key')) {
      throw new AppError('AI API Key 无效，请联系管理员检查配置', 502)
    }
    if (errMsg.includes('429') || errMsg.includes('Rate limit')) {
      throw new AppError('AI 服务请求过于频繁，请稍后再试', 429)
    }
    if (errMsg.includes('timeout') || errMsg.includes('ETIMEDOUT')) {
      throw new AppError('AI 服务响应超时，请稍后再试', 504)
    }

    throw new AppError('AI 服务暂时不可用，请稍后再试', 502)
  }
}
