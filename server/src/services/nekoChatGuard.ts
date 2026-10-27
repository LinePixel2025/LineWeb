import { config } from '../config/index.js'
import { areFriends } from './chatService.js'
import { linewebIdOfUsername, parseNekoJid } from './nekoChat.js'

/**
 * 出站单聊好友校验 —— `/ws/xmpp` 中继与 `/api/chat/xmpp/http-stanza`（轮询降级）
 * 共用同一份口径，避免后者成为绕过好友关系的后门。
 *
 * 规则：
 *   - 只看 `<message type="chat|normal" to="…">`；群聊（groupchat）与 IQ/Presence 不校验
 *   - 目标 `lw_<id>@domain`：必须是自己或 Prisma 好友；好友结果缓存 60 秒
 *   - 目标其它 localpart（neko 原生账号）：受 NEKO_CHAT_ALLOW_NATIVE 开关控制
 */

const FRIEND_CACHE_TTL_MS = 60 * 1000
const FRIEND_CACHE_MAX = 512

/** 好友校验结果缓存（userId + 目标 LineWeb id → 是否好友） */
const friendCache = new Map<string, { value: boolean; at: number }>()

function cachedAreFriends(userId: number, targetId: number): Promise<boolean> {
  const key = `${userId}:${targetId}`
  const hit = friendCache.get(key)
  const now = Date.now()
  if (hit && now - hit.at < FRIEND_CACHE_TTL_MS) return Promise.resolve(hit.value)
  return areFriends(userId, targetId).then((value) => {
    if (friendCache.size >= FRIEND_CACHE_MAX) {
      // 简单淘汰：删除最早插入的一条（Map 保持插入顺序）
      const oldest = friendCache.keys().next().value
      if (oldest !== undefined) friendCache.delete(oldest)
    }
    friendCache.set(key, { value, at: Date.now() })
    return value
  })
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = re.exec(raw))) attrs[match[1]] = match[2]
  return attrs
}

export interface OutboundVerdict {
  allowed: boolean
  /** 被校验的目标 localpart（日志用，不含域名） */
  peer: string
}

/** 校验一条出站 stanza 是否允许发送；非消息帧一律放行 */
export async function isAllowedOutboundStanza(
  userId: number,
  text: string,
): Promise<OutboundVerdict> {
  const head = /<message\b([^>]*)>/i.exec(text)
  if (!head) return { allowed: true, peer: '' }
  const attrs = parseAttrs(head[1])
  const type = attrs.type || 'chat'
  if (type !== 'chat' && type !== 'normal') return { allowed: true, peer: '' }
  const to = attrs.to || ''
  if (!to) return { allowed: true, peer: '' }
  const parsed = parseNekoJid(to)
  if (!parsed) return { allowed: true, peer: '' }
  const targetLinewebId = linewebIdOfUsername(parsed.localpart)
  if (targetLinewebId === null) {
    // 原生账号：受 allowNative 开关控制（关闭后只允许 LineWeb 好友互聊）
    return { allowed: config.nekoChatAllowNative, peer: parsed.localpart }
  }
  if (targetLinewebId === userId) return { allowed: true, peer: parsed.localpart }
  const allowed = await cachedAreFriends(userId, targetLinewebId)
  return { allowed, peer: parsed.localpart }
}
