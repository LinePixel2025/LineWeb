import { Router, Request, Response } from 'express'
import { authenticate, requireAdmin, optionalAuthenticate } from '../middleware/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import {
  aiChatSchema,
  aiConfigUpdateSchema,
  aiWriteSummarySchema,
  aiWritePolishSchema,
  aiWriteTitlesSchema,
  aiWriteDraftSchema,
} from '../config/index.js'
import {
  getAiConfig,
  updateAiConfig,
  maskApiKey,
  chat,
  aiSummarize,
  aiPolish,
  aiTitles,
  streamDraft,
} from '../services/aiService.js'
import { AppError } from '../middleware/errorHandler.js'

const router = Router()

/**
 * GET /api/ai/chat/public
 * 公开接口：返回 AI 助手是否启用（供前端判断是否显示聊天按钮）
 */
router.get('/chat/public', asyncHandler(async (_req: Request, res: Response) => {
  try {
    const config = await getAiConfig()
    res.json({ enabled: config.isEnabled })
  } catch {
    // 兜底：数据库异常时返回 false
    res.json({ enabled: false })
  }
}))

/**
 * POST /api/ai/chat
 * 公开接口：发送消息给 AI 并获取回复（可选认证——登录用户携带 JWT 时，
 * 可注入其屏幕使用时间上下文；游客无额外上下文）
 * 请求体: { message: string, history?: { role: 'user'|'assistant', content: string }[] }
 * 响应: { reply: string, model: string }
 */
router.post('/chat', optionalAuthenticate, asyncHandler(async (req: Request, res: Response) => {
  const parsed = aiChatSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError('请求参数无效: ' + parsed.error.errors.map(e => e.message).join('; '), 400)
  }

  const { message, history } = parsed.data
  const result = await chat(message, history as { role: 'user' | 'assistant'; content: string }[], req.user?.userId)
  res.json(result)
}))

/**
 * POST /api/ai/write/summary
 * 管理员接口：AI 根据文章正文生成摘要
 * 请求体: { content: string }  响应: { summary, model }
 */
router.post('/write/summary', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const parsed = aiWriteSummarySchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError('请求参数无效: ' + parsed.error.errors.map(e => e.message).join('; '), 400)
  }
  res.json(await aiSummarize(parsed.data.content))
}))

/**
 * POST /api/ai/write/polish
 * 管理员接口：AI 润色/扩写/纠错选中文字
 * 请求体: { text, action }  响应: { text, model }
 */
router.post('/write/polish', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const parsed = aiWritePolishSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError('请求参数无效: ' + parsed.error.errors.map(e => e.message).join('; '), 400)
  }
  res.json(await aiPolish(parsed.data.text, parsed.data.action))
}))

/**
 * POST /api/ai/write/titles
 * 管理员接口：AI 根据正文生成标题建议
 * 请求体: { content, summary? }  响应: { titles: string[], model }
 */
router.post('/write/titles', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const parsed = aiWriteTitlesSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError('请求参数无效: ' + parsed.error.errors.map(e => e.message).join('; '), 400)
  }
  res.json(await aiTitles(parsed.data.content, parsed.data.summary))
}))

/**
 * POST /api/ai/write/draft
 * 管理员接口：AI 流式起稿（SSE）
 * 请求体: { prompt, outline?, tone?, length? }
 * 响应: text/event-stream，事件 data 为 { delta } | { done, model } | { error }
 */
router.post('/write/draft', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const parsed = aiWriteDraftSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError('请求参数无效: ' + parsed.error.errors.map(e => e.message).join('; '), 400)
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // 禁用 nginx 缓冲
  res.flushHeaders()

  const send = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
  }

  await streamDraft(parsed.data, {
    onChunk: delta => send({ delta }),
    onDone: model => {
      send({ done: true, model })
      res.end()
    },
    onError: message => {
      send({ error: message })
      res.end()
    },
  })
}))

/**
 * GET /api/ai/config
 * 管理员接口：获取 AI 配置（API Key 脱敏处理）
 */
router.get('/config', authenticate, requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  const config = await getAiConfig()
  res.json({
    id: config.id,
    provider: config.provider,
    model: config.model,
    apiKey: maskApiKey(config.apiKey),
    baseUrl: config.baseUrl,
    systemPrompt: config.systemPrompt,
    isEnabled: config.isEnabled,
    updatedAt: config.updatedAt,
  })
}))

/**
 * PUT /api/ai/config
 * 管理员接口：更新 AI 配置
 * 请求体: { provider?, model?, apiKey?, baseUrl?, systemPrompt?, isEnabled? }
 */
router.put('/config', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const parsed = aiConfigUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError('请求参数无效: ' + parsed.error.errors.map(e => e.message).join('; '), 400)
  }

  // 如果 apiKey 传入的是脱敏后的值（sk-…xxxx），说明未修改，剔除该字段
  const data = { ...parsed.data }
  if (data.apiKey && data.apiKey.startsWith('sk-…')) {
    delete data.apiKey
  }

  const config = await updateAiConfig(data)
  res.json({
    id: config.id,
    provider: config.provider,
    model: config.model,
    apiKey: maskApiKey(config.apiKey),
    baseUrl: config.baseUrl,
    systemPrompt: config.systemPrompt,
    isEnabled: config.isEnabled,
    updatedAt: config.updatedAt,
  })
}))

export default router
