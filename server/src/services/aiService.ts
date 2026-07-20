import OpenAI from 'openai'
import prisma from '../lib/prisma.js'

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
 * 构建包含网站内容的 system prompt
 */
async function buildSystemPrompt(basePrompt: string): Promise<string> {
  // 获取所有已发布文章
  const posts = await prisma.post.findMany({
    where: { published: true },
    select: { title: true, summary: true, slug: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })

  // 获取所有 featured 页面
  const pages = await prisma.page.findMany({
    where: { published: true, featured: true },
    select: { title: true, featureDesc: true, slug: true },
  })

  let contextBlock = ''

  if (posts.length > 0) {
    contextBlock += '\n\n## 网站文章列表\n'
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
      if (p.featureDesc) contextBlock += ` — ${p.featureDesc}`
      contextBlock += '\n'
    }
  }

  return basePrompt + contextBlock
}

/**
 * 核心对话函数：向 AI 发送消息并获取回复
 */
export async function chat(
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
): Promise<{ reply: string; model: string }> {
  const config = await getAiConfig()

  if (!config.isEnabled) {
    throw Object.assign(new Error('AI 助手未启用'), { status: 503 })
  }

  if (!config.apiKey) {
    throw Object.assign(new Error('AI 助手未配置 API Key，请联系管理员'), { status: 503 })
  }

  // 构建完整的 system prompt（含网站内容）
  const systemPrompt = await buildSystemPrompt(config.systemPrompt)

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
      throw Object.assign(new Error('AI API Key 无效，请联系管理员检查配置'), { status: 502 })
    }
    if (errMsg.includes('429') || errMsg.includes('Rate limit')) {
      throw Object.assign(new Error('AI 服务请求过于频繁，请稍后再试'), { status: 429 })
    }
    if (errMsg.includes('timeout') || errMsg.includes('ETIMEDOUT')) {
      throw Object.assign(new Error('AI 服务响应超时，请稍后再试'), { status: 504 })
    }

    throw Object.assign(new Error('AI 服务暂时不可用，请稍后再试'), { status: 502 })
  }
}
