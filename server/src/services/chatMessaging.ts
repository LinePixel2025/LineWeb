import crypto from 'crypto'
import prisma from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import {
  CHAT_BUNDLE_MAX_BYTES,
  CHAT_DOMAIN,
  CHAT_FORWARD_MAX,
  CHAT_GROUP_MEMBER_LIMIT,
  CHAT_HISTORY_LIMIT,
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_MUC_DOMAIN,
  CHAT_RECALL_WINDOW_MS,
  conversationIdOfRoomJid,
  directJidOf,
  linewebIdOf,
  linewebIdOfUsername,
  parseChatJid,
  roomJidOf,
  roomJidWithResource,
  toNekoId,
  toNekoUsername,
} from '../lib/chatIdentity.js'
import {
  childOf,
  elementOf,
  parseFrame,
  sanitizeChatXhtmlNodes,
  serialize,
  xhtmlToNodes,
  type StanzaElement,
} from '../lib/stanzaXml.js'
import { isNodeConnected, sendCommand } from './storageTunnel.js'
import { areFriends } from './chatService.js'
import {
  broadcastPresence,
  removeSession,
  sendToUserSessions,
  sendToUsersSessions,
  sessionsOf,
  type ChatSession,
} from './chatSessions.js'

/**
 * 自建聊天消息核心：XMPP stanza 状态机 + 消息落库 / 投递 / 历史 / 撤回 / 已读
 *
 * 线上协议与 neko 完全兼容（前端 lib/xmpp 零改动）：
 *   - 单聊 `<message type="chat" from to id>`，群聊 from=`room-<id>@muc/<发送者>`；
 *     `mine` 由前端按 from 用户名比对，因此自己的消息必须回投自己的全部会话
 *   - 扩展都在 `urn:wlxx:chat`：reply / forward / mention / read；
 *     图片与拍一拍走 XHTML-IM（实时为真实元素，历史上行同样输出真实元素，
 *     前端 extractImageSrc / extractPoke 对两种形态都能命中）
 *   - 事件走 `<message type="headline">`：msg-recall / read / friend-request /
 *     friend-update / room-update（前端对未知事件统一防抖刷新 state）
 */

const XMLNS_WLXX = 'urn:wlxx:chat'
const XMLNS_SASL = 'urn:ietf:params:xml:ns:xmpp-sasl'
const XMLNS_BIND = 'urn:ietf:params:xml:ns:xmpp-bind'
const XMLNS_STREAMS = 'http://etherx.jabber.org/streams'
const XMLNS_FRAMING = 'urn:ietf:params:xml:ns:xmpp-framing'
const XMLNS_XHTML_IM = 'http://jabber.org/protocol/xhtml-im'
const XMLNS_XHTML_BODY = 'http://www.w3.org/1999/xhtml'
const XMLNS_STANZAS = 'urn:ietf:params:xml:ns:xmpp-stanzas'
const XMLNS_PING = 'urn:xmpp:ping'

/** 非好友单聊的拒绝帧（与原 nekoWsProxy 注入的完全一致，前端静默丢弃） */
const NOT_AUTHORIZED_STANZA =
  '<message type="error"><error type="cancel"><not-authorized xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/></error></message>'

// === 好友校验缓存（原 nekoChatGuard 口径：60 秒 / 512 条 LRU） ===

const FRIEND_CACHE_TTL_MS = 60 * 1000
const FRIEND_CACHE_MAX = 512
const friendCache = new Map<string, { value: boolean; at: number }>()

async function cachedAreFriends(userId: number, targetId: number): Promise<boolean> {
  const key = `${userId}:${targetId}`
  const hit = friendCache.get(key)
  const now = Date.now()
  if (hit && now - hit.at < FRIEND_CACHE_TTL_MS) return hit.value
  const value = await areFriends(userId, targetId)
  if (friendCache.size >= FRIEND_CACHE_MAX) {
    const oldest = friendCache.keys().next().value
    if (oldest !== undefined) friendCache.delete(oldest)
  }
  friendCache.set(key, { value, at: Date.now() })
  return value
}

// === 行类型与公共查询 ===

interface ChatMessageRow {
  id: number
  conversationId: number
  senderId: number
  content: string
  type: string
  xhtml: string | null
  mentions: string | null
  forwardBundle: string | null
  imagePath: string | null
  imageSize: bigint | null
  uploadId: string | null
  recalledAt: Date | null
  recalledBy: number | null
  replyToId: number | null
  createdAt: Date
}

const messageRowSelect = {
  id: true,
  conversationId: true,
  senderId: true,
  content: true,
  type: true,
  xhtml: true,
  mentions: true,
  forwardBundle: true,
  imagePath: true,
  imageSize: true,
  uploadId: true,
  recalledAt: true,
  recalledBy: true,
  replyToId: true,
  createdAt: true,
} as const

function isUniqueConstraintError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: unknown }).code === 'P2002'
}

function groupRoleAtLeast(role: string, level: 'admin' | 'owner'): boolean {
  if (level === 'owner') return role === 'owner'
  return role === 'owner' || role === 'admin'
}

// === 会话（direct）定位 ===

function directKeyOf(a: number, b: number): string {
  return `${Math.min(a, b)}:${Math.max(a, b)}`
}

/** 取（或建）两人 direct 会话，返回会话 id 与对方 id */
async function ensureDirectConversation(
  userId: number,
  targetId: number,
): Promise<{ conversationId: number; otherId: number } | null> {
  const directKey = directKeyOf(userId, targetId)
  const existing = await prisma.conversation.findUnique({
    where: { directKey },
    select: { id: true, members: { select: { userId: true } } },
  })
  if (existing) {
    const otherId = existing.members.map((m) => m.userId).find((id) => id !== userId) ?? targetId
    return { conversationId: existing.id, otherId }
  }
  try {
    const created = await prisma.conversation.create({
      data: {
        type: 'direct',
        directKey,
        members: {
          create: [
            { userId, role: 'member' },
            { userId: targetId, role: 'member' },
          ],
        },
      },
      select: { id: true },
    })
    return { conversationId: created.id, otherId: targetId }
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      const found = await prisma.conversation.findUnique({
        where: { directKey },
        select: { id: true, members: { select: { userId: true } } },
      })
      if (found) {
        const otherId = found.members.map((m) => m.userId).find((id) => id !== userId) ?? targetId
        return { conversationId: found.id, otherId }
      }
    }
    return null
  }
}

// === 旧存档图片的懒加载上传映射 ===

/** 旧 imagePath → 稳定 24hex 上传 id（sha1 前 24 位），命中即可经 /chat/uploads/ 直链 */
function legacyUploadIdOf(imagePath: string): string {
  return crypto.createHash('sha1').update(imagePath).digest('hex').slice(0, 24)
}

async function ensureLegacyUpload(row: {
  imagePath: string | null
  imageSize: bigint | null
  senderId: number
}): Promise<string | null> {
  if (!row.imagePath) return null
  const uploadId = legacyUploadIdOf(row.imagePath)
  try {
    const existing = await prisma.chatUpload.findUnique({ where: { id: uploadId }, select: { id: true } })
    if (!existing) {
      await prisma.chatUpload.create({
        data: {
          id: uploadId,
          ownerId: row.senderId,
          path: row.imagePath,
          mime: 'image/webp',
          size: Number(row.imageSize ?? 0),
        },
      })
    }
    return uploadId
  } catch (err) {
    console.warn('[chatMessaging] 旧图片上传映射失败:', err instanceof Error ? err.message : err)
    return null
  }
}

// === 出站帧构建 ===

function bodyChild(content: string): StanzaElement | null {
  return content ? elementOf('body', {}, [], content) : null
}

async function legacyHtmlChild(row: ChatMessageRow): Promise<StanzaElement | null> {
  if (row.xhtml) {
    const nodes = xhtmlToNodes(row.xhtml)
    if (nodes.length > 0) {
      return elementOf('html', { xmlns: XMLNS_XHTML_IM }, [
        elementOf('body', { xmlns: XMLNS_XHTML_BODY }, nodes),
      ])
    }
    return null
  }
  // 旧存档图片消息：懒加载映射成 /chat/uploads/<24hex>，前端按图片消息渲染
  const uploadId = await ensureLegacyUpload(row)
  if (!uploadId) return null
  return elementOf('html', { xmlns: XMLNS_XHTML_IM }, [
    elementOf('body', { xmlns: XMLNS_XHTML_BODY }, [
      elementOf('img', { src: `/chat/uploads/${uploadId}`, alt: '图片' }),
    ]),
  ])
}

function bundleChild(forwardBundle: string | null): StanzaElement | null {
  if (!forwardBundle) return null
  return elementOf('bundle', {}, [], forwardBundle)
}

async function quoteElement(replyToId: number | null, conversationId: number): Promise<StanzaElement | null> {
  if (!replyToId) return null
  const row = await prisma.message.findUnique({
    where: { id: replyToId },
    select: { id: true, conversationId: true, senderId: true, content: true, type: true, recalledAt: true },
  })
  if (!row || row.conversationId !== conversationId) return null
  const text = row.recalledAt
    ? '消息已撤回'
    : (row.content || (row.type === 'image' ? '[图片]' : '')).slice(0, 120)
  return elementOf('quote', {
    id: row.id,
    from: toNekoUsername(row.senderId),
    text,
  })
}

async function messageChildren(row: {
  content: string
  xhtml: string | null
  imagePath: string | null
  imageSize: bigint | null
  senderId: number
  replyToId: number | null
  forwardBundle: string | null
  recalledAt: Date | null
  conversationId: number
  id: number
  type: string
}): Promise<StanzaElement[]> {
  if (row.recalledAt) return []
  const children: StanzaElement[] = []
  const body = bodyChild(row.content)
  if (body) children.push(body)
  const html = await legacyHtmlChild(row as ChatMessageRow)
  if (html) children.push(html)
  const quote = await quoteElement(row.replyToId, row.conversationId)
  if (quote) children.push(quote)
  const bundle = bundleChild(row.forwardBundle)
  if (bundle) children.push(bundle)
  return children
}

/** 解析 mentions JSON → { everyone, ids }；无 mentions 返回 null */
function parseMentions(raw: string | null): { everyone: boolean; ids: Set<number> } | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const ids = new Set<number>()
    let everyone = false
    for (const value of parsed) {
      const id = Number(value)
      if (id === 0) everyone = true
      else if (Number.isInteger(id) && id > 0) ids.add(id)
    }
    if (!everyone && ids.size === 0) return null
    return { everyone, ids }
  } catch {
    return null
  }
}

// === 落库 + 投递 ===

interface PersistParams {
  senderId: number
  conversationId: number
  kind: 'direct' | 'group'
  /** direct：对方 id；group：忽略 */
  otherId?: number
  body: string
  xhtmlNodes: StanzaElement[]
  replyId: number
  /** 仅 group；nekoId 集合（0 = 所有人） */
  mentions?: number[]
  forwardIds?: number[]
  /** 仅 group：发送者在群内的角色（mention=0 校验用） */
  senderRole?: string
}

async function buildForwardBundle(senderId: number, ids: number[]): Promise<string | null> {
  const uniqueIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))].slice(0, CHAT_FORWARD_MAX)
  if (uniqueIds.length === 0) return null
  const rows = await prisma.message.findMany({
    where: { id: { in: uniqueIds } },
    select: {
      id: true,
      conversationId: true,
      senderId: true,
      content: true,
      type: true,
      xhtml: true,
      imagePath: true,
      imageSize: true,
      recalledAt: true,
      createdAt: true,
    },
  })
  const byId = new Map(rows.map((row) => [row.id, row]))
  const memberships = await prisma.conversationMember.findMany({
    where: { userId: senderId, conversationId: { in: [...new Set(rows.map((row) => row.conversationId))] } },
    select: { conversationId: true },
  })
  const readable = new Set(memberships.map((row) => row.conversationId))

  const items: Array<Record<string, unknown>> = []
  for (const id of uniqueIds) {
    const row = byId.get(id)
    if (!row || !readable.has(row.conversationId)) continue
    const recalled = row.recalledAt !== null
    const body = recalled ? '' : (row.content || (row.type === 'image' ? '[图片]' : ''))
    let html = recalled ? '' : (row.xhtml || '')
    if (!recalled && !html && row.imagePath) {
      const uploadId = await ensureLegacyUpload(row)
      if (uploadId) html = `<img src="/chat/uploads/${uploadId}" alt="图片"/>`
    }
    if (!html && !body) continue
    items.push({
      u: toNekoId(row.senderId),
      n: toNekoUsername(row.senderId),
      t: row.createdAt.getTime(),
      b: body,
      h: html,
      r: recalled ? 1 : 0,
    })
  }
  if (items.length === 0) return null
  let json = JSON.stringify(items)
  while (Buffer.byteLength(json) > CHAT_BUNDLE_MAX_BYTES && items.length > 1) {
    items.pop()
    json = JSON.stringify(items)
  }
  return Buffer.byteLength(json) <= CHAT_BUNDLE_MAX_BYTES ? json : null
}

function firstUploadIdOf(nodes: StanzaElement[]): string | null {
  for (const node of nodes) {
    if (node.name !== 'img') continue
    const src = node.attrs.src || ''
    const match = /^\/chat\/uploads\/([0-9a-f]{24})$/.exec(src)
    if (match) return match[1]
  }
  return null
}

async function persistMessage(params: PersistParams): Promise<ChatMessageRow | null> {
  const { senderId, conversationId, kind, body } = params
  const xhtml = params.xhtmlNodes.length > 0 ? params.xhtmlNodes.map((node) => serialize(node)).join('') : null
  if (xhtml && xhtml.length > 16 * 1024) return null

  // 上传校验：正文引用的上传必须真实存在（不校验属主：转发他人图片是合法路径）
  let uploadId: string | null = null
  const referencedUpload = firstUploadIdOf(params.xhtmlNodes)
  if (referencedUpload) {
    const upload = await prisma.chatUpload.findUnique({ where: { id: referencedUpload }, select: { id: true } })
    uploadId = upload ? referencedUpload : null
  }

  // 引用校验：被引用消息必须同会话
  let replyToId: number | null = null
  if (params.replyId > 0) {
    const reply = await prisma.message.findUnique({
      where: { id: params.replyId },
      select: { conversationId: true },
    })
    if (reply && reply.conversationId === conversationId) replyToId = params.replyId
  }

  // 合并转发快照
  let forwardBundle: string | null = null
  if (params.forwardIds && params.forwardIds.length > 0) {
    forwardBundle = await buildForwardBundle(senderId, params.forwardIds)
  }

  // @：0=所有人仅群主/管理员；其余必须是群成员
  let mentionsJson: string | null = null
  if (kind === 'group' && params.mentions && params.mentions.length > 0) {
    const memberRows = await prisma.conversationMember.findMany({
      where: { conversationId },
      select: { userId: true },
    })
    const memberNekoIds = new Set(memberRows.map((row) => toNekoId(row.userId)))
    const valid = params.mentions.filter((id) => id === 0 || memberNekoIds.has(id))
    const canEveryone = groupRoleAtLeast(params.senderRole ?? 'member', 'admin')
    const filtered = valid.filter((id) => id !== 0 || canEveryone)
    if (filtered.length > 0) mentionsJson = JSON.stringify(filtered.slice(0, 20))
  }

  const type = params.xhtmlNodes.some((node) => node.name === 'img') ? 'image' : 'text'
  const created = await prisma.message.create({
    data: {
      conversationId,
      senderId,
      content: body,
      type,
      xhtml,
      replyToId,
      mentions: mentionsJson,
      forwardBundle,
      uploadId,
    },
    select: messageRowSelect,
  })
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
  })
  return created as ChatMessageRow
}

async function deliverMessage(
  row: ChatMessageRow,
  params: Pick<PersistParams, 'kind' | 'otherId'>,
): Promise<void> {
  const children = await messageChildren(row)
  if (children.length === 0) return

  if (params.kind === 'direct') {
    const otherId = params.otherId
    if (!otherId) return
    const xml = serialize(
      elementOf(
        'message',
        { type: 'chat', from: directJidOf(row.senderId), to: directJidOf(otherId), id: row.id },
        children,
      ),
    )
    sendToUsersSessions([row.senderId, otherId], xml)
    return
  }

  const baseAttrs = {
    type: 'groupchat',
    from: roomJidWithResource(row.conversationId, row.senderId),
    id: row.id,
  }
  const mentions = parseMentions(row.mentions)
  const memberIds = (
    await prisma.conversationMember.findMany({
      where: { conversationId: row.conversationId },
      select: { userId: true },
    })
  ).map((member) => member.userId)

  const withMention: number[] = []
  const withoutMention: number[] = []
  for (const memberId of memberIds) {
    const mentioned =
      memberId !== row.senderId
      && (mentions?.everyone
        || (mentions ? mentions.ids.has(toNekoId(memberId)) : false))
    ;(mentioned ? withMention : withoutMention).push(memberId)
  }
  const mentionedXml = serialize(
    elementOf('message', { ...baseAttrs, mention: '1' }, children),
  )
  const plainXml = serialize(elementOf('message', baseAttrs, children))
  if (withMention.length > 0) sendToUsersSessions(withMention, mentionedXml)
  if (withoutMention.length > 0) sendToUsersSessions(withoutMention, plainXml)
}

// === 入站：单聊 / 群聊消息 ===

function extractXhtmlNodes(el: StanzaElement): StanzaElement[] {
  const html = childOf(el, 'html')
  if (!html) return []
  const body = childOf(html, 'body')
  if (!body) return []
  // 重组 body 内部标记再过一遍白名单净化（文本已经由解析器反转义）
  const inner = `${body.text}${body.children.map((node) => serialize(node)).join('')}`
  return sanitizeChatXhtmlNodes(inner)
}

async function handleDirectMessage(session: ChatSession, el: StanzaElement): Promise<void> {
  const to = el.attrs.to || ''
  const parsed = parseChatJid(to)
  const targetId = parsed ? linewebIdOfUsername(parsed.localpart) : null
  if (!targetId || targetId === session.userId) return

  if (!(await cachedAreFriends(session.userId, targetId))) {
    try {
      session.sink.send(NOT_AUTHORIZED_STANZA)
    } catch { /* ignore */ }
    return
  }

  const bodyEl = childOf(el, 'body')
  const body = (bodyEl?.text ?? '').trim()
  if (!body || body.length > CHAT_MESSAGE_MAX_LENGTH) return

  const ensured = await ensureDirectConversation(session.userId, targetId)
  if (!ensured) return

  const xEl = childOf(el, 'x')
  const replyId = Number.parseInt(xEl?.attrs.reply || '0', 10) || 0
  const forwardRaw = String(xEl?.attrs.forward || '')
  const forwardIds = forwardRaw
    ? forwardRaw.split(',').map((value) => Number.parseInt(value, 10)).filter((id) => Number.isInteger(id) && id > 0)
    : []

  const row = await persistMessage({
    senderId: session.userId,
    conversationId: ensured.conversationId,
    kind: 'direct',
    otherId: ensured.otherId,
    body,
    xhtmlNodes: extractXhtmlNodes(el),
    replyId,
    forwardIds,
  })
  if (row) await deliverMessage(row, { kind: 'direct', otherId: ensured.otherId })
}

async function handleGroupMessage(session: ChatSession, el: StanzaElement): Promise<void> {
  const conversationId = conversationIdOfRoomJid(el.attrs.to || '')
  if (!conversationId) return
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: session.userId } },
    include: { conversation: { select: { allMuted: true } } },
  })
  if (!membership) return
  const now = Date.now()
  if (membership.conversation.allMuted && !groupRoleAtLeast(membership.role, 'admin')) return
  if (membership.mutedUntil && membership.mutedUntil.getTime() > now) return

  const bodyEl = childOf(el, 'body')
  const body = (bodyEl?.text ?? '').trim()
  if (!body || body.length > CHAT_MESSAGE_MAX_LENGTH) return

  const xEl = childOf(el, 'x')
  const replyId = Number.parseInt(xEl?.attrs.reply || '0', 10) || 0
  const forwardRaw = String(xEl?.attrs.forward || '')
  const forwardIds = forwardRaw
    ? forwardRaw.split(',').map((value) => Number.parseInt(value, 10)).filter((id) => Number.isInteger(id) && id > 0)
    : []
  const mentions = (xEl?.children ?? [])
    .filter((child) => child.name === 'mention')
    .map((child) => Number.parseInt(child.attrs.user || '0', 10))
    .filter((id) => Number.isInteger(id) && id >= 0)

  const row = await persistMessage({
    senderId: session.userId,
    conversationId,
    kind: 'group',
    body,
    xhtmlNodes: extractXhtmlNodes(el),
    replyId,
    forwardIds,
    mentions,
    senderRole: membership.role,
  })
  if (row) await deliverMessage(row, { kind: 'group' })
}

/** 无 body 的 read 标记：推进已读水位并向对端发 headline read */
async function handleReadMarker(session: ChatSession, el: StanzaElement): Promise<void> {
  const xEl = childOf(el, 'x')
  const watermark = Number.parseInt(xEl?.attrs.read || '0', 10) || 0
  if (watermark <= 0) return
  const parsed = parseChatJid(el.attrs.to || '')
  const targetId = parsed ? linewebIdOfUsername(parsed.localpart) : null
  if (!targetId || targetId === session.userId) return

  const conversation = await prisma.conversation.findUnique({
    where: { directKey: directKeyOf(session.userId, targetId) },
    select: { id: true },
  })
  if (!conversation) return
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: conversation.id, userId: session.userId } },
    select: { id: true, lastReadMessageId: true },
  })
  if (!membership) return
  const latest = await prisma.message.findFirst({
    where: { conversationId: conversation.id },
    orderBy: { id: 'desc' },
    select: { id: true },
  })
  const target = Math.max(membership.lastReadMessageId, Math.min(watermark, latest?.id ?? 0))
  if (target <= membership.lastReadMessageId) return

  await prisma.conversationMember.update({
    where: { id: membership.id },
    data: { lastReadMessageId: target },
  })
  const headline = serialize(
    elementOf('message', { type: 'headline', from: directJidOf(session.userId) }, [
      elementOf('x', { xmlns: XMLNS_WLXX, event: 'read', msgId: target }),
    ]),
  )
  sendToUserSessions(targetId, headline)
}

// === 入站：历史查询 ===

interface HistoryContext {
  isRoom: boolean
  conversationId: number
  otherId: number | null
}

async function historyContext(
  session: ChatSession,
  query: StanzaElement,
): Promise<{ context: HistoryContext; max: number; before: number | null } | null> {
  const max = Math.min(Math.max(Number.parseInt(query.attrs.max || '30', 10) || CHAT_HISTORY_LIMIT, 1), 50)
  const before = Number.parseInt(query.attrs.before || '0', 10) || null
  const roomJid = String(query.attrs.room || '')
  const withJid = String(query.attrs.with || '')

  if (roomJid) {
    const conversationId = conversationIdOfRoomJid(roomJid)
    if (!conversationId) return null
    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: session.userId } },
      select: { id: true },
    })
    if (!membership) return null
    return { context: { isRoom: true, conversationId, otherId: null }, max, before }
  }

  if (withJid) {
    const parsed = parseChatJid(withJid)
    const targetId = parsed ? linewebIdOfUsername(parsed.localpart) : null
    if (!targetId || targetId === session.userId) return null
    const conversation = await prisma.conversation.findUnique({
      where: { directKey: directKeyOf(session.userId, targetId) },
      select: { id: true },
    })
    if (!conversation) return null
    return { context: { isRoom: false, conversationId: conversation.id, otherId: targetId }, max, before }
  }
  return null
}

function historyMsgElement(
  row: ChatMessageRow,
  viewerId: number,
  context: HistoryContext,
): StanzaElement {
  const isRoom = context.isRoom
  const mine = row.senderId === viewerId
  const recalled = row.recalledAt !== null
  const byAdmin = recalled && row.recalledBy !== null && row.recalledBy !== row.senderId
  const mentions = parseMentions(row.mentions)
  const mentionedMe = !mine
    && (mentions?.everyone
      || (mentions ? mentions.ids.has(toNekoId(viewerId)) : false))

  const attrs: Record<string, string | number> = {
    id: row.id,
    ts: row.createdAt.getTime(),
    from: isRoom
      ? roomJidWithResource(row.conversationId, row.senderId)
      : directJidOf(row.senderId),
  }
  if (isRoom) attrs.room = '1'
  else if (context.otherId) attrs.to = directJidOf(mine ? context.otherId : viewerId)
  if (mine) attrs.mine = '1'
  if (recalled) attrs.recalled = '1'
  if (byAdmin) attrs.byAdmin = '1'
  if (mentionedMe) attrs.mention = '1'

  const children: StanzaElement[] = []
  const body = bodyChild(recalled ? '' : row.content)
  if (body) children.push(body)
  return elementOf('msg', attrs, children)
}

async function handleHistoryIq(session: ChatSession, iqId: string, query: StanzaElement): Promise<void> {
  const resolved = await historyContext(session, query)
  if (!resolved) {
    sendEmptyHistory(session, iqId)
    return
  }
  const { context, max, before } = resolved
  const rows = (await prisma.message.findMany({
    where: {
      conversationId: context.conversationId,
      ...(before ? { id: { lt: before } } : {}),
    },
    orderBy: { id: 'desc' },
    take: max,
    select: messageRowSelect,
  })) as ChatMessageRow[]
  rows.reverse()

  // 引用快照批量解析 + 旧存档图片映射
  const replyIds = [...new Set(rows.map((row) => row.replyToId).filter((id): id is number => !!id))]
  const replyRows = replyIds.length > 0
    ? await prisma.message.findMany({
        where: { id: { in: replyIds }, conversationId: context.conversationId },
        select: { id: true, senderId: true, content: true, type: true, recalledAt: true },
      })
    : []
  const replyById = new Map(replyRows.map((row) => [row.id, row]))

  const msgElements: StanzaElement[] = []
  for (const row of rows) {
    const children: StanzaElement[] = []
    const recalled = row.recalledAt !== null
    const body = bodyChild(recalled ? '' : row.content)
    if (body) children.push(body)
    if (!recalled) {
      if (row.xhtml) {
        const nodes = xhtmlToNodes(row.xhtml)
        if (nodes.length > 0) {
          children.push(
            elementOf('html', { xmlns: XMLNS_XHTML_IM }, [
              elementOf('body', { xmlns: XMLNS_XHTML_BODY }, nodes),
            ]),
          )
        }
      } else if (row.imagePath) {
        const uploadId = await ensureLegacyUpload(row)
        if (uploadId) {
          children.push(
            elementOf('html', { xmlns: XMLNS_XHTML_IM }, [
              elementOf('body', { xmlns: XMLNS_XHTML_BODY }, [
                elementOf('img', { src: `/chat/uploads/${uploadId}`, alt: '图片' }),
              ]),
            ]),
          )
        }
      }
    }
    const replyRow = row.replyToId ? replyById.get(row.replyToId) : undefined
    if (replyRow && !recalled) {
      const text = replyRow.recalledAt
        ? '消息已撤回'
        : (replyRow.content || (replyRow.type === 'image' ? '[图片]' : '')).slice(0, 120)
      children.push(
        elementOf('quote', {
          id: replyRow.id,
          from: toNekoUsername(replyRow.senderId),
          text,
        }),
      )
    }
    const bundle = bundleChild(recalled ? null : row.forwardBundle)
    if (bundle) children.push(bundle)

    const element = historyMsgElement(row, session.userId, context)
    element.children = children
    msgElements.push(element)
  }

  // query 的 read 属性：单聊为对方的已读水位
  let peerRead = 0
  if (!context.isRoom && context.otherId) {
    const peer = await prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: { conversationId: context.conversationId, userId: context.otherId },
      },
      select: { lastReadMessageId: true },
    })
    peerRead = peer?.lastReadMessageId ?? 0
  }

  const queryElement = elementOf(
    'query',
    {
      xmlns: XMLNS_WLXX,
      complete: rows.length < max ? '1' : '0',
      ...(peerRead > 0 ? { read: peerRead } : {}),
    },
    msgElements,
  )
  const reply = serialize(elementOf('iq', { type: 'result', id: iqId }, [queryElement]))
  try {
    session.sink.send(reply)
  } catch { /* ignore */ }
}

function sendEmptyHistory(session: ChatSession, iqId: string): void {
  const reply = serialize(
    elementOf('iq', { type: 'result', id: iqId }, [
      elementOf('query', { xmlns: XMLNS_WLXX, complete: '1' }),
    ]),
  )
  try {
    session.sink.send(reply)
  } catch { /* ignore */ }
}

// === headline（REST 侧复用） ===

function headlineXml(from: string, attrs: Record<string, string | number>): string {
  return serialize(
    elementOf('message', { type: 'headline', from }, [elementOf('x', { xmlns: XMLNS_WLXX, ...attrs })]),
  )
}

/** 好友申请 / 关系变更：驱动聊天面板刷新申请列表 */
export function emitFriendHeadline(userIds: number[], event: 'friend-request' | 'friend-update', peerId?: number): void {
  const from = peerId ? directJidOf(peerId) : `anon@${CHAT_DOMAIN}`
  const xml = headlineXml(from, { event })
  sendToUsersSessions(userIds, xml)
}

/** 群变更（改名 / 成员 / 公告 / 解散等）：前端防抖刷新 state */
export async function emitRoomUpdate(conversationId: number): Promise<void> {
  const members = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true },
  })
  sendToUsersSessions(members.map((member) => member.userId), roomHeadlineXml(conversationId))
}

/** 群 headline 帧（解散后成员行已删，无法再按会话查收件人，单独导出） */
export function roomHeadlineXml(conversationId: number, event = 'room-update'): string {
  return headlineXml(roomJidOf(conversationId), { event })
}

// === 撤回（REST 入口） ===

export async function recallMessageRest(userId: number, messageId: number, admin: boolean): Promise<void> {
  const row = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      ...messageRowSelect,
      conversation: { select: { type: true, members: { select: { userId: true } } } },
    },
  })
  if (!row) throw new AppError('消息不存在', 404)
  const memberIds = row.conversation.members.map((member) => member.userId)
  if (!memberIds.includes(userId)) throw new AppError('消息不存在', 404)
  if (row.recalledAt) throw new AppError('消息已撤回', 409)

  if (admin) {
    if (row.conversation.type !== 'group') throw new AppError('仅群聊支持管理员撤回', 403)
    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: row.conversationId, userId } },
      select: { role: true },
    })
    if (!membership || !groupRoleAtLeast(membership.role, 'admin')) {
      throw new AppError('只有群主或管理员可以撤回成员消息', 403)
    }
  } else {
    if (row.senderId !== userId) throw new AppError('只能撤回自己发送的消息', 403)
    if (Date.now() - row.createdAt.getTime() > CHAT_RECALL_WINDOW_MS) {
      throw new AppError('超过撤回时限（5 分钟）', 400)
    }
  }

  const now = new Date()
  const result = await prisma.message.updateMany({
    where: { id: row.id, recalledAt: null },
    data: {
      recalledAt: now,
      content: '',
      xhtml: null,
      imageSize: null,
      ...(admin ? { recalledBy: userId } : {}),
    },
  })
  if (result.count === 0) throw new AppError('消息已撤回', 409)

  // 释放文件：图片最后一次被撤回时删除节点文件（best-effort）
  if (row.uploadId || row.imagePath) {
    const stillReferenced = row.uploadId
      ? await prisma.message.count({
          where: { uploadId: row.uploadId, id: { not: row.id }, recalledAt: null },
        })
      : 0
    if (!stillReferenced) {
      const path = row.uploadId
        ? (await prisma.chatUpload.findUnique({ where: { id: row.uploadId }, select: { path: true } }))?.path
        : row.imagePath
      if (path && isNodeConnected()) {
        await sendCommand({ type: 'delete_file', path }).catch(() => {})
      }
      if (row.uploadId) {
        await prisma.chatUpload.deleteMany({ where: { id: row.uploadId } }).catch(() => {})
      }
    }
  }

  // headline msg-recall：单聊 from/peer = 撤回者；群聊 from = 房间
  const isRoom = row.conversation.type === 'group'
  const xml = isRoom
    ? headlineXml(roomJidOf(row.conversationId), {
        event: 'msg-recall',
        msgId: row.id,
        ...(admin ? { byAdmin: '1' } : {}),
      })
    : headlineXml(directJidOf(row.senderId), { event: 'msg-recall', msgId: row.id, peer: toNekoUsername(row.senderId) })
  sendToUsersSessions(memberIds, xml)
}

// === XMPP 流状态机 ===

function streamFeatures(session: ChatSession): string {
  const features = session.authed
    ? elementOf('features', { xmlns: XMLNS_STREAMS }, [elementOf('bind', { xmlns: XMLNS_BIND })])
    : elementOf('features', { xmlns: XMLNS_STREAMS }, [
        elementOf('mechanisms', { xmlns: XMLNS_SASL }, [elementOf('mechanism', {}, [], 'PLAIN')]),
      ])
  return `${serialize(elementOf('open', { xmlns: XMLNS_FRAMING, from: CHAT_DOMAIN, version: '1.0' }))}${serialize(features)}`
}

function decodeSaslPlain(payload: string): { username: string; password: string } | null {
  try {
    const decoded = Buffer.from(payload, 'base64').toString('utf8')
    const parts = decoded.split('\u0000')
    if (parts.length !== 3) return null
    return { username: parts[1], password: parts[2] }
  } catch {
    return null
  }
}

async function handleBind(session: ChatSession, iqId: string, iq: StanzaElement): Promise<void> {
  const bind = childOf(iq, 'bind')
  const resource = childOf(bind ?? undefined, 'resource')?.text?.trim() || 'lineweb'
  session.resource = resource.slice(0, 64) || 'lineweb'
  const wasOnline = sessionsOf(session.userId).some((item) => item.id !== session.id && item.bound)
  session.bound = true
  const reply = serialize(
    elementOf('iq', { type: 'result', id: iqId }, [
      elementOf('bind', { xmlns: XMLNS_BIND }, [
        elementOf('jid', {}, [], `${toNekoUsername(session.userId)}@${CHAT_DOMAIN}/${session.resource}`),
      ]),
    ]),
  )
  try {
    session.sink.send(reply)
  } catch { /* ignore */ }
  if (!wasOnline) void broadcastPresence(session.userId, true)
}

async function handleIq(session: ChatSession, iq: StanzaElement): Promise<void> {
  const iqId = String(iq.attrs.id || '')
  const type = iq.attrs.type || 'get'
  if (type === 'set' && childOf(iq, 'bind')) {
    await handleBind(session, iqId || 'bind', iq)
    return
  }
  if (type === 'get') {
    const ping = childOf(iq, 'ping')
    if (ping && ping.attrs.xmlns === XMLNS_PING) {
      try {
        session.sink.send(serialize(elementOf('iq', { type: 'result', id: iqId })))
      } catch { /* ignore */ }
      return
    }
    const query = childOf(iq, 'query')
    if (query && query.attrs.xmlns === XMLNS_WLXX) {
      await handleHistoryIq(session, iqId, query)
      return
    }
  }
  // 未知 iq：回错误帧（fetchHistory 拿不到 query 会当空结果处理）
  try {
    session.sink.send(
      serialize(
        elementOf('iq', { type: 'error', id: iqId }, [
          elementOf('service-unavailable', { xmlns: XMLNS_STANZAS }),
        ]),
      ),
    )
  } catch { /* ignore */ }
}

async function handleElement(session: ChatSession, el: StanzaElement): Promise<void> {
  switch (el.name) {
    case 'open':
      try {
        session.sink.send(streamFeatures(session))
      } catch { /* ignore */ }
      return
    case 'auth': {
      if (session.authed) return
      const credentials = decodeSaslPlain(el.text)
      const usernameOk = credentials?.username === toNekoUsername(session.userId)
      const passwordOk = credentials
        ? consumeTicket(credentials.password, session.userId)
        : false
      if (el.attrs.mechanism === 'PLAIN' && usernameOk && passwordOk) {
        session.authed = true
        try {
          session.sink.send(serialize(elementOf('success', { xmlns: XMLNS_SASL })))
        } catch { /* ignore */ }
      } else {
        try {
          session.sink.send(
            serialize(elementOf('failure', { xmlns: XMLNS_SASL }, [elementOf('not-authorized')])),
          )
        } catch { /* ignore */ }
        removeSession(session)
        try {
          session.sink.close(4002, 'auth failed')
        } catch { /* ignore */ }
      }
      return
    }
    case 'iq':
      await handleIq(session, el)
      return
    case 'message': {
      const type = el.attrs.type || 'chat'
      if (type === 'chat' || type === 'normal') {
        const bodyEl = childOf(el, 'body')
        const xEl = childOf(el, 'x')
        if (!bodyEl?.text && xEl?.attrs.read) {
          await handleReadMarker(session, el)
          return
        }
        await handleDirectMessage(session, el)
        return
      }
      if (type === 'groupchat') {
        await handleGroupMessage(session, el)
      }
      return
    }
    default:
      // presence / 未知帧：绑定后已广播过 presence，这里忽略
      return
  }
}

// 票据校验的本地别名（避免循环依赖：chatSessions 不依赖本模块）
import { consumeChatTicket as consumeTicket } from './chatSessions.js'

/**
 * 会话入站帧处理入口（WS 网关与长轮询共用）。
 * 一帧内可能包含多个顶层元素；单元素异常不影响其它元素。
 */
export async function processSessionStanza(session: ChatSession, xml: string): Promise<void> {
  session.lastActivity = Date.now()
  for (const el of parseFrame(xml)) {
    try {
      await handleElement(session, el)
    } catch (err) {
      console.warn(
        `[chatMessaging] stanza 处理失败 (${toNekoUsername(session.userId)}):`,
        err instanceof Error ? err.message : err,
      )
    }
  }
}

/** 会话结束（WS 关闭 / 轮询作废）：末个绑定会话关闭时广播下线 */
export function teardownSession(session: ChatSession): void {
  const wasBound = session.bound
  const othersBoundBefore = sessionsOf(session.userId).filter(
    (item) => item.id !== session.id && item.bound,
  ).length
  removeSession(session)
  if (wasBound && othersBoundBefore === 0) {
    void broadcastPresence(session.userId, false)
  }
}
