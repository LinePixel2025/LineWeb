import { Router, type Request, type Response } from 'express'
import prisma from '../lib/prisma.js'
import { config } from '../config/index.js'
import { AppError } from '../middleware/errorHandler.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { authenticate } from '../middleware/auth.js'
import { requireFeature } from '../middleware/featureGuard.js'
import { requireChatNotBanned } from '../middleware/chatBanGuard.js'
import { linewebIdOf } from '../lib/chatIdentity.js'
import { isNodeConnected, streamRead } from '../services/storageTunnel.js'
import { fetchAvatar, fetchUpload, sessionHashOf } from '../services/nekoChat.js'
import { getUserBrief } from '../services/chatService.js'

/**
 * 聊天图片 / 头像直链（挂载于 /chat，不在 /api 下）
 *
 * 聊天双后端（2026-10-31 起）：
 *   - /chat/uploads/<24hex>?token= → 先查 ChatUpload（自建，存储节点 _chat/uploads/；
 *     旧存档 imagePath 由 chatMessaging 懒映射成同格式稳定 id），未命中且配置了
 *     neko 时回退 neko 中继（用户切回 XMPP 后，其 neko 时代的图片仍可显示）
 *   - /chat/avatars/<nekoId>?v=&token= → nekoId 可反解 LineWeb id 时读本地
 *     `_avatars/<id>.webp`；原生账号 id（仅 XMPP 后端会出现）回退 neko 头像
 *
 * ⚠️ 必须注册在 express.static 与 SPA fallback 之前，否则会命中 index.html。
 * ⚠️ 认证只加在具体资源上（不能 router.use(authenticate)，会拦下 SPA 的 /chat 页面路由）。
 */
const router = Router()

/** 24 位小写 hex 上传 id */
const UPLOAD_ID_RE = /^[0-9a-f]{24}$/

function rawToken(req: Request): string {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) return header.slice(7).trim()
  return typeof req.query.token === 'string' ? req.query.token : ''
}

async function readNodeFile(path: string): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of streamRead(path)) chunks.push(chunk)
  return Buffer.concat(chunks)
}

function sendNotFound(res: Response, what = 'no image'): void {
  res.status(404).type('text').send(what)
}

router.get(
  '/uploads/:id',
  authenticate,
  requireFeature('chat'),
  requireChatNotBanned(),
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id || '')
    if (!UPLOAD_ID_RE.test(id)) {
      sendNotFound(res)
      return
    }
    const userId = req.user?.userId
    if (!userId) throw new AppError('未登录', 401)

    // 1) 自建：ChatUpload 直查存储节点
    const upload = await prisma.chatUpload.findUnique({ where: { id }, select: { path: true, mime: true } })
    if (upload && isNodeConnected()) {
      let data: Buffer
      try {
        data = await readNodeFile(upload.path)
      } catch {
        sendNotFound(res)
        return
      }
      res.setHeader('Content-Type', upload.mime || 'application/octet-stream')
      res.setHeader('Content-Length', String(data.length))
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
      res.send(data)
      return
    }

    // 2) 回退：neko 上的图片（XMPP 后端时代的消息）
    if (config.nekoChatEnabled) {
      const user = await getUserBrief(userId)
      const token = rawToken(req)
      const relayed = await fetchUpload(id, user, token ? sessionHashOf(token) : '').catch(() => null)
      if (relayed) {
        res.setHeader('Content-Type', relayed.mime)
        res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
        res.send(relayed.data)
        return
      }
    }
    sendNotFound(res)
  }),
)

/**
 * 聊天头像：`/chat/avatars/<nekoId>?v=<avatarVersion>&token=<登录令牌>`
 * nekoId 可反解 LineWeb id → 本地 `_avatars/<id>.webp`；
 * 原生账号 id（仅 XMPP 后端）→ neko accounts.avatar 中继。
 */
router.get(
  '/avatars/:id',
  authenticate,
  requireFeature('chat'),
  requireChatNotBanned(),
  asyncHandler(async (req: Request, res: Response) => {
    const nekoId = Number.parseInt(String(req.params.id || ''), 10)
    if (!Number.isInteger(nekoId) || nekoId <= 0) {
      sendNotFound(res, 'no avatar')
      return
    }
    const userId = req.user?.userId
    if (!userId) throw new AppError('未登录', 401)

    // 1) LineWeb 用户：本地存储节点
    const linewebId = linewebIdOf(nekoId)
    if (linewebId && isNodeConnected()) {
      const user = await prisma.user.findUnique({
        where: { id: linewebId },
        select: { avatarPath: true },
      })
      if (user?.avatarPath) {
        try {
          const data = await readNodeFile(user.avatarPath)
          res.setHeader('Content-Type', 'image/webp')
          res.setHeader('Content-Length', String(data.length))
          res.setHeader('Cache-Control', 'private, max-age=300')
          res.send(data)
          return
        } catch {
          sendNotFound(res, 'no avatar')
          return
        }
      }
      sendNotFound(res, 'no avatar')
      return
    }

    // 2) 原生账号 / LineWeb 用户本地无头像且配置了 neko：neko 头像中继
    if (config.nekoChatEnabled) {
      const user = await getUserBrief(userId)
      const token = rawToken(req)
      const avatar = await fetchAvatar(nekoId, user, token ? sessionHashOf(token) : '').catch(() => null)
      if (avatar) {
        res.setHeader('Content-Type', avatar.mime)
        res.setHeader('Cache-Control', 'private, max-age=300')
        res.send(avatar.data)
        return
      }
    }
    sendNotFound(res, 'no avatar')
  }),
)

export default router
