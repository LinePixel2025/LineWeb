/**
 * 极简 XMPP over WebSocket / HTTP 客户端（RFC 7395 帧协议）
 *
 * 移植自 neko 门户的 `xmpp_client.js`，只保留 LineWeb 聊天页需要的子集：
 * 流开启 → SASL PLAIN → 资源绑定 → message / presence / iq。
 *
 * 与门户版本的差异：
 *   - WS 地址为 LineWeb 同源 `/ws/xmpp?token=<JWT>`（服务端字节级中继），不需要 Origin / CSRF；
 *   - 长轮询降级改走 `/api/chat/xmpp/http-*`（Bearer 头由 api 封装统一附加）；
 *   - `abandon()` 摘掉未完成握手的回调，避免迟到的 onclose 触发多余重连。
 */

import api from '../api'
import { escXml, parseStanza, type XmppElement } from './protocol'

/**
 * WS 连接（含认证 + 绑定）超时。
 * 15s：经 Cloudflare Tunnel 时握手常在 3–8s，页面首屏并发（会话/游戏 sync）时会超过 8s，
 * 过早超时会白白消耗一次性票据并误降级到轮询。
 */
export const XMPP_CONNECT_TIMEOUT_MS = 15_000
/** 长轮询降级握手超时 */
const HTTP_CONNECT_TIMEOUT_MS = 12_000
/** 单次长轮询请求超时（服务端挂 25s，留足余量） */
const HTTP_POLL_TIMEOUT_MS = 50_000

export interface XmppConnectOptions {
  /** 完整 WS 地址（含 token） */
  url: string
  domain: string
  username: string
  /** 一次性 SASL 票据 */
  password: string
}

export interface XmppHistoryResult {
  /** 原始 `<query>` 元素（交给 protocol 解析成 NekoMessage[]） */
  query: XmppElement | null
  rows: XmppElement[]
  /** 单聊对端的已读位置（群聊恒 0） */
  read: number
  /** 不足一页（没有更早的消息了） */
  complete: boolean
}

type IqResolver = (el: XmppElement) => void

function nowId(prefix: string, seq: number): string {
  return `${prefix}${seq}`
}

export class XmppClient extends EventTarget {
  jid: string | null = null
  bound = false
  /** 当前传输方式 */
  mode: 'ws' | 'http' | null = null

  private ws: WebSocket | null = null
  private httpSessionId: string | null = null
  private httpChain: Promise<void> = Promise.resolve()
  private pollAbort: AbortController | null = null
  private pending = new Map<string, IqResolver>()
  private seq = 0
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private resolveConnect: ((client: XmppClient) => void) | null = null
  private rejectConnect: ((err: Error) => void) | null = null
  private domain = ''

  /** 当前连接是否可用（WS OPEN 或 HTTP 会话有效） */
  get isOpen(): boolean {
    if (this.httpSessionId) return true
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  send(xml: string): void {
    if (this.httpSessionId) {
      const sessionId = this.httpSessionId
      this.httpChain = this.httpChain
        .then(async () => {
          await api.post('/chat/xmpp/http-stanza', { sessionId, stanza: xml })
        })
        .catch(() => {
          if (this.httpSessionId === sessionId) this.httpClosed()
        })
      return
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(xml)
    }
  }

  /** 连接并完成认证 + 绑定；resolve 后即可收发 stanza */
  connect(options: XmppConnectOptions): Promise<XmppClient> {
    this.domain = options.domain
    this.username = options.username
    this.password = options.password
    this.mode = 'ws'
    return new Promise<XmppClient>((resolve, reject) => {
      let ws: WebSocket
      try {
        ws = new WebSocket(options.url)
      } catch (err) {
        reject(err instanceof Error ? err : new Error('WebSocket 构造失败'))
        return
      }
      this.ws = ws
      this.resolveConnect = resolve
      this.rejectConnect = reject

      ws.onopen = () => {
        this.openStream(options.domain)
      }
      ws.onmessage = (event) => this.handle(String(event.data))
      ws.onerror = () => {
        this.failConnect(new Error('连接失败'))
      }
      ws.onclose = () => {
        this.clearConnectTimer()
        if (this.ws === ws) this.ws = null
        this.failConnect(new Error('WebSocket 在连接前关闭'))
        this.bound = false
        this.dispatchEvent(new CustomEvent('close'))
      }

      this.connectTimer = setTimeout(() => {
        this.failConnect(new Error('WebSocket 连接超时'))
        this.abandon()
        this.dispatchEvent(new CustomEvent('close'))
      }, XMPP_CONNECT_TIMEOUT_MS)
    })
  }

  /** 放弃尚未完成握手的 WebSocket（避免迟到的 onclose 冒充真实断线） */
  private abandon(): void {
    const ws = this.ws
    this.ws = null
    if (!ws) return
    ws.onopen = null
    ws.onmessage = null
    ws.onclose = null
    ws.onerror = null
    try {
      ws.close()
    } catch {
      // ignore
    }
  }

  /**
   * HTTP 长轮询降级
   *
   * 会话由服务端以可信代理身份创建（不需要 SASL 票据）；仍保留 username/password，
   * 万一上游要求认证也能应答。
   */
  async connectHttp(
    domain: string,
    credentials?: { username: string; password: string },
  ): Promise<XmppClient> {
    this.domain = domain
    if (credentials) {
      this.username = credentials.username
      this.password = credentials.password
    }
    this.mode = 'http'
    this.clearConnectTimer()

    const created = await api.post<{ sessionId: string }>('/chat/xmpp/http-session', {})
    if (!created?.sessionId) throw new Error('HTTP 聊天会话创建失败')
    this.httpSessionId = created.sessionId
    this.httpChain = Promise.resolve()
    this.pollAbort = new AbortController()
    void this.pollLoop(created.sessionId)

    return new Promise<XmppClient>((resolve, reject) => {
      this.resolveConnect = resolve
      this.rejectConnect = reject
      this.connectTimer = setTimeout(() => {
        this.failConnect(new Error('HTTP 聊天连接超时'))
        this.httpClosed()
      }, HTTP_CONNECT_TIMEOUT_MS)
      this.openStream(domain)
    })
  }

  private async pollLoop(sessionId: string): Promise<void> {
    const abort = this.pollAbort
    while (this.httpSessionId === sessionId && !abort?.signal.aborted) {
      try {
        const result = await api.get<{ stanza?: string }>(
          `/chat/xmpp/http-poll?sessionId=${encodeURIComponent(sessionId)}`,
          { timeoutMs: HTTP_POLL_TIMEOUT_MS, signal: abort?.signal },
        )
        if (this.httpSessionId !== sessionId) return
        if (result?.stanza) this.handle(result.stanza)
      } catch (err) {
        if (this.httpSessionId !== sessionId) return
        const status = (err as { status?: number } | null)?.status
        // 只有 401 才是登录失效；403 多为上游会话已被回收（换票据/切网/另一标签），
        // 交给 onClose 走指数退避重连即可，否则会把可恢复的断线误判成「认证失败」。
        if (status === 401) {
          this.dispatchEvent(new CustomEvent('auth-error'))
        }
        this.httpClosed()
        return
      }
    }
  }

  private httpClosed(): void {
    const closingId = this.httpSessionId
    if (!closingId) return
    this.httpSessionId = null
    const abort = this.pollAbort
    this.pollAbort = null
    abort?.abort()
    void api.post('/chat/xmpp/http-close', { sessionId: closingId }).catch(() => {})
    this.failConnect(new Error('HTTP 聊天连接失败'))
    this.bound = false
    this.dispatchEvent(new CustomEvent('close'))
  }

  private openStream(domain: string): void {
    this.send(`<open xmlns="urn:ietf:params:xml:ns:xmpp-framing" to="${escXml(domain)}" version="1.0"/>`)
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
  }

  private failConnect(err: Error): void {
    const reject = this.rejectConnect
    this.rejectConnect = null
    this.resolveConnect = null
    if (reject) reject(err)
  }

  private handle(text: string): void {
    for (const element of parseStanza(text)) this.onElement(element)
  }

  private onElement(el: XmppElement): void {
    switch (el.name) {
      case 'open':
        return
      case 'features': {
        const hasMechanisms = el.children.some((child) => child.name === 'mechanisms')
        const hasBind = el.children.some((child) => child.name === 'bind')
        if (!this.bound && hasMechanisms) {
          // SASL PLAIN：\0username\0ticket
          const payload = btoa(`\0${escXml(this.username)}\0${this.password}`)
          this.send(
            `<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="PLAIN">${payload}</auth>`,
          )
        } else if (hasBind) {
          this.send(
            '<iq type="set" id="bind1"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><resource>lineweb</resource></bind></iq>',
          )
        }
        return
      }
      case 'success':
        // SASL 成功后重新开流
        this.openStream(this.domain)
        return
      case 'failure': {
        this.failConnect(new Error('聊天认证失败'))
        this.dispatchEvent(new CustomEvent('auth-error'))
        this.close()
        return
      }
      case 'iq': {
        const id = el.attrs.id
        if (el.attrs.type === 'result' || el.attrs.type === 'error') {
          const pending = this.pending.get(id)
          if (pending) {
            this.pending.delete(id)
            pending(el)
            return
          }
        }
        if (!this.bound && el.attrs.type === 'result') {
          const bind = el.children.find((child) => child.name === 'bind')
          if (bind) {
            const jid = bind.children.find((child) => child.name === 'jid')
            this.jid = jid ? jid.text : null
            this.bound = true
            this.clearConnectTimer()
            this.send('<presence/>')
            const resolve = this.resolveConnect
            this.resolveConnect = null
            this.rejectConnect = null
            if (resolve) resolve(this)
            return
          }
        }
        return
      }
      default:
        break
    }
    this.dispatchEvent(new CustomEvent('stanza', { detail: el }))
  }

  private username = ''
  private password = ''

  /**
   * 发送消息；xhtml 为已净化的 HTML 片段（可空）。
   *
   * urn:wlxx:chat 扩展（三者可同时出现，由 neko 统一解析）：
   *   - reply：引用消息 id（0 表示不引用）
   *   - forward：合并转发的源会话消息 id（1–30 条，服务端生成快照）
   *   - mentions：被 @ 的 neko 用户 id（0 = @所有人，仅群聊且管理员生效）
   */
  sendMessage(options: {
    to: string
    type?: 'chat' | 'groupchat'
    body: string
    xhtml?: string
    reply?: number
    mentions?: number[]
    forward?: number[]
  }): void {
    const type = options.type || 'chat'
    const reply = Math.max(0, Math.trunc(options.reply || 0))
    const mentions = Array.from(
      new Set(
        (options.mentions ?? [])
          .map((id) => Math.trunc(id))
          .filter((id) => Number.isInteger(id) && id >= 0),
      ),
    ).slice(0, 20)
    const forward = Array.from(
      new Set(
        (options.forward ?? [])
          .map((id) => Math.trunc(id))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ).slice(0, 30)

    let xml = `<message type="${type}" to="${escXml(options.to)}"><body>${escXml(options.body)}</body>`
    if (options.xhtml) {
      xml += `<html xmlns="http://jabber.org/protocol/xhtml-im"><body xmlns="http://www.w3.org/1999/xhtml">${options.xhtml}</body></html>`
    }
    if (reply > 0 || mentions.length > 0 || forward.length > 0) {
      let ext = `<x xmlns="urn:wlxx:chat"`
      if (reply > 0) ext += ` reply="${reply}"`
      if (forward.length > 0) ext += ` forward="${forward.join(',')}"`
      if (mentions.length === 0) {
        ext += '/>'
      } else {
        ext += `>${mentions.map((id) => `<mention user="${id}"/>`).join('')}</x>`
      }
      xml += ext
    }
    this.send(`${xml}</message>`)
  }

  sendPresence(available = true): void {
    this.send(available ? '<presence/>' : '<presence type="unavailable"/>')
  }

  /** 发出 iq get 并等待 result（超时 reject） */
  iq(childXml: string, to?: string, timeoutMs = 8_000): Promise<XmppElement> {
    const id = nowId('iq', ++this.seq)
    return new Promise<XmppElement>((resolve, reject) => {
      this.pending.set(id, resolve)
      const toAttr = to ? ` to="${escXml(to)}"` : ''
      this.send(`<iq type="get" id="${escXml(id)}"${toAttr}>${childXml}</iq>`)
      setTimeout(() => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        reject(new Error('iq 超时'))
      }, timeoutMs)
    })
  }

  /** 查询历史：with=对方裸 JID（单聊）或 room=房间 JID（群聊）；before=消息 id 取更早一页 */
  fetchHistory(options: {
    withJid?: string
    roomJid?: string
    max?: number
    before?: number
  }): Promise<XmppHistoryResult> {
    let query = '<query xmlns="urn:wlxx:chat"'
    if (options.withJid) query += ` with="${escXml(options.withJid)}"`
    if (options.roomJid) query += ` room="${escXml(options.roomJid)}"`
    query += ` max="${Number(options.max) || 30}"`
    if (options.before) query += ` before="${Number(options.before)}"`
    query += '/>'
    return this.iq(query).then((el) => {
      const queryEl = el.children.find((child) => child.name === 'query') ?? null
      if (!queryEl) return { query: null, rows: [], read: 0, complete: true }
      return {
        query: queryEl,
        rows: queryEl.children.filter((child) => child.name === 'msg'),
        read: Math.max(Number.parseInt(queryEl.attrs.read || '0', 10) || 0, 0),
        complete: queryEl.attrs.complete === '1',
      }
    })
  }

  /** 上报单聊已读位置（无 body 的 urn:wlxx:chat read 标记，不产生消息） */
  sendRead(to: string, messageId: number): void {
    this.send(
      `<message type="chat" to="${escXml(to)}"><x xmlns="urn:wlxx:chat" read="${Math.max(0, Math.trunc(messageId))}"/></message>`,
    )
  }

  /** 保活 ping（neko 不主动发心跳，长时间静默会被中继按空闲关闭） */
  ping(): void {
    this.iq('<ping xmlns="urn:xmpp:ping"/>', undefined, 10_000).catch(() => {
      // ping 失败交给 onclose / 轮询兜底
    })
  }

  close(): void {
    if (this.httpSessionId) {
      this.httpClosed()
      return
    }
    const ws = this.ws
    this.ws = null
    this.bound = false
    if (!ws) return
    ws.onopen = null
    ws.onmessage = null
    ws.onclose = null
    ws.onerror = null
    try {
      ws.close()
    } catch {
      // ignore
    }
  }
}
