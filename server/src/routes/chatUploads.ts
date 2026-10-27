import { Router, type Request, type Response } from 'express'
import { AppError } from '../middleware/errorHandler.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { authenticate } from '../middleware/auth.js'
import { getUserBrief } from '../services/chatService.js'
import { fetchUpload, sessionHashOf } from '../services/nekoChat.js'

/**
 * 聊天图片字节中继（挂载于 /chat，不在 /api 下）
 *
 * 图片真实存放在 neko 的聊天库里；浏览器只认识 LineWeb 同源地址：
 *   /chat/uploads/<24位hex>?token=<LineWeb 登录令牌>
 * 这里带内部令牌 + 可信代理身份头向 neko 取字节后原样返回。
 *
 * ⚠️ 必须注册在 express.static 与 SPA fallback 之前，否则会命中 index.html。
 */
const router = Router()

/**
 * 认证只加在 /uploads/:id 上。
 * ⚠️ 不能写 `router.use(authenticate)`：本路由挂在 `/chat`，会把 SPA 的 `/chat`、
 * `/chat/u<id>`、`/chat/r<id>` 页面请求一并拦成 401 JSON。
 */
/** 24 位小写 hex（neko 的 upload id 格式） */
const UPLOAD_ID_RE = /^[0-9a-f]{24}$/

function rawToken(req: Request): string {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) return header.slice(7).trim()
  return typeof req.query.token === 'string' ? req.query.token : ''
}

router.get(
  '/uploads/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id || '')
    if (!UPLOAD_ID_RE.test(id)) {
      res.status(404).type('text').send('no image')
      return
    }
    const userId = req.user?.userId
    if (!userId) throw new AppError('未登录', 401)
    const user = await getUserBrief(userId)
    const token = rawToken(req)
    const upload = await fetchUpload(id, user, token ? sessionHashOf(token) : '')
    if (!upload) {
      res.status(404).type('text').send('no image')
      return
    }
    res.setHeader('Content-Type', upload.mime)
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
    res.send(upload.data)
  }),
)

export default router
