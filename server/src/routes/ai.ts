import { Router, Request, Response } from 'express'
import { authenticate, requireAdmin, optionalAuthenticate } from '../middleware/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { aiChatSchema, aiConfigUpdateSchema } from '../config/index.js'
import { getAiConfig, updateAiConfig, maskApiKey, chat } from '../services/aiService.js'
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
