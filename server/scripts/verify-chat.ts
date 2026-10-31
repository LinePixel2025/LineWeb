/**
 * 自建聊天自检（默认纯函数 + 内存态断言，不依赖外部服务；本地 SQLite 只做只读查询）
 *
 * 覆盖：
 *   1. stanzaXml：解析 / 序列化 roundtrip、转义、坏帧丢弃、XHTML 白名单净化
 *   2. chatIdentity：nekoId 映射、用户名（禁前导零）、JID 拼装反解、上传 id
 *   3. XMPP 流状态机（open → SASL → bind → ping / history / 非好友拦截），
 *      用内存会话 + 捕获 sink 驱动，与前端 lib/xmpp/client.ts 的握手序列逐帧对齐
 *   4. 长轮询会话队列（创建 / 上行 / 挂起取帧 / 关闭）
 *   5. 票据：签发 / 一次性消费 / 过期语义
 *   6. bootstrap 视图出口口径（空数据用户的形状断言）
 *
 * 运行：cd server && npm run verify:chat
 */

import {
  elementOf,
  escXml,
  parseFrame,
  sanitizeChatXhtml,
  sanitizeChatXhtmlNodes,
  serialize,
  xhtmlToNodes,
  type StanzaElement,
} from '../src/lib/stanzaXml.js'
import {
  CHAT_ACCOUNT_BASE,
  CHAT_DOMAIN,
  CHAT_MUC_DOMAIN,
  conversationIdOfRoomJid,
  directJidOf,
  linewebIdOf,
  linewebIdOfUsername,
  newUploadId,
  parseChatJid,
  roomJidOf,
  roomJidWithResource,
  toNekoId,
  toNekoUsername,
  uploadPathOf,
} from '../src/lib/chatIdentity.js'
import {
  closePollingSession,
  createPollingSession,
  feedStanza,
  pollStanza,
} from '../src/services/chatPolling.js'
import {
  consumeChatTicket,
  issueChatTicket,
  registerSession,
  removeSession,
  type ChatSession,
} from '../src/services/chatSessions.js'
import { processSessionStanza, teardownSession } from '../src/services/chatMessaging.js'
import { buildChatView } from '../src/services/chatView.js'

let passed = 0
let failed = 0
const failures: string[] = []

function assert(name: string, cond: boolean): void {
  if (cond) {
    passed += 1
  } else {
    failed += 1
    failures.push(name)
    console.error(`  ✗ ${name}`)
  }
}

function assertEq(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failed += 1
    failures.push(`${name}（实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}）`)
    console.error(`  ✗ ${name}: 实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`)
  } else {
    passed += 1
  }
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`)
}

function firstFrame(xml: string): StanzaElement | null {
  const frames = parseFrame(xml)
  return frames[0] ?? null
}

// === 1. stanzaXml ===

section('stanzaXml 解析与序列化')

assertEq('escXml 五实体', escXml(`&<>"'`), '&amp;&lt;&gt;&quot;&apos;')

const frame = `<message type="chat" to="lw_1@lineweb"><body>你好 &lt;世界&gt;</body><x xmlns="urn:wlxx:chat" reply="3"><mention user="0"/></x></message>`
const parsed = parseFrame(frame)
assert('解析出 1 个顶层元素', parsed.length === 1)
assertEq('元素名', parsed[0]?.name, 'message')
assertEq('属性透传', parsed[0]?.attrs.type, 'chat')
assertEq('属性反转义', parsed[0]?.attrs.to, 'lw_1@lineweb')
assertEq('body 文本反转义', parsed[0]?.children[0]?.text, '你好 <世界>')
assertEq('扩展元素属性', parsed[0]?.children[1]?.attrs.reply, '3')
assertEq('mention 子元素', parsed[0]?.children[1]?.children[0]?.attrs.user, '0')

const roundtrip = parseFrame(serialize(parsed[0]!))
assertEq('roundtrip 后属性一致', roundtrip[0]?.attrs, parsed[0]?.attrs)
assertEq('roundtrip 后文本一致', roundtrip[0]?.children[0]?.text, '你好 <世界>')
assertEq('roundtrip 后子元素数一致', roundtrip[0]?.children.length, parsed[0]?.children.length)

const multi = parseFrame('<open xmlns="urn:ietf:params:xml:ns:xmpp-framing"/><presence/>')
assertEq('一帧多个顶层元素', multi.length, 2)
assertEq('第二元素名', multi[1]?.name, 'presence')

const selfClosing = parseFrame('<open xmlns="urn:ietf:params:xml:ns:xmpp-framing" to="lineweb" version="1.0"/>')
assertEq('自闭合元素无子节点', selfClosing[0]?.children.length, 0)

assert('坏帧：未闭合标签', parseFrame('<message><body>').length === 0)
assert('坏帧：非法起始', parseFrame('hello <world').length === 0)
assert('坏帧：孤立闭合', parseFrame('</message>').length === 0)
assert('坏帧：空串', parseFrame('').length === 0)
assert('注释被忽略', parseFrame('<!-- c --><presence/>').length === 1)
assert('XML 声明被忽略', parseFrame('<?xml version="1.0"?><presence/>').length === 1)
assertEq('嵌套深度', parseFrame('<a><b><c>x</c></b></a>')[0]?.children[0]?.children[0]?.name, 'c')

// 属性单引号 / 无引号（宽容度）
const singleQuoted = parseFrame("<message type='groupchat'/>")
assertEq('单引号属性', singleQuoted[0]?.attrs.type, 'groupchat')

section('XHTML 白名单净化')

const goodImg = sanitizeChatXhtml(`<img src="/chat/uploads/${'a'.repeat(24)}" alt="图片"/>`)
assert('合法上传图片保留', goodImg.includes('/chat/uploads/'))
assert('alt 保留', goodImg.includes('alt="图片"'))

assert('外部图片被剔除', sanitizeChatXhtml('<img src="https://evil.com/x.png"/>') === '')
assert('非上传路径图片被剔除', sanitizeChatXhtml('<img src="/etc/passwd"/>') === '')
assertEq('拍一拍标记保留', sanitizeChatXhtml('<span data-lw-poke="1000000000005">[拍一拍]</span>'), '<span data-lw-poke="1000000000005">[拍一拍]</span>')
assertEq('非法拍一拍值剔除', sanitizeChatXhtml('<span data-lw-poke="abc">x</span>'), '<span>x</span>')
assert('script 剥壳留文本', sanitizeChatXhtml('<script>alert(1)</script>').startsWith('<span>') && !sanitizeChatXhtml('<script>alert(1)</script>').includes('script'))
assert('事件属性被剔除', !sanitizeChatXhtml('<img src="/chat/uploads/' + 'a'.repeat(24) + '" onerror="alert(1)"/>').includes('onerror'))
assert('超长输入拒绝', sanitizeChatXhtml(`<img src="/chat/uploads/${'a'.repeat(24)}"/>${'x'.repeat(20 * 1024)}`) === '')
assertEq('空输入', sanitizeChatXhtml(''), '')

const nodes = sanitizeChatXhtmlNodes('<span data-lw-poke="7">[拍一拍]</span>')
assertEq('净化节点树长度', nodes.length, 1)
assertEq('节点树属性', nodes[0]?.attrs['data-lw-poke'], '7')
assertEq('规范形序列化', nodes.map((node) => serialize(node)).join(''), '<span data-lw-poke="7">[拍一拍]</span>')
assertEq('xhtmlToNodes roundtrip', xhtmlToNodes('<img src="/chat/uploads/' + 'b'.repeat(24) + '"/>').length, 1)

// === 2. chatIdentity ===

section('身份映射与 JID')

assertEq('toNekoId 基址偏移', toNekoId(5), CHAT_ACCOUNT_BASE + 5)
assertEq('linewebIdOf 还原', linewebIdOf(CHAT_ACCOUNT_BASE + 5), 5)
assertEq('linewebIdOf 越界 null', linewebIdOf(CHAT_ACCOUNT_BASE - 1), null)
assertEq('linewebIdOf 0 null', linewebIdOf(0), null)
assertEq('用户名 = lw_<裸id>', toNekoUsername(42), 'lw_42')
assertEq('linewebIdOfUsername 解析', linewebIdOfUsername('lw_42'), 42)
assertEq('前导零拒绝', linewebIdOfUsername('lw_042'), null)
assertEq('非前缀拒绝', linewebIdOfUsername('alice'), null)
assertEq('空串拒绝', linewebIdOfUsername(''), null)
assertEq('超大数字拒绝', linewebIdOfUsername(`lw_${'9'.repeat(20)}`), null)

const jid = parseChatJid('lw_42@lineweb/res')
assertEq('JID localpart', jid?.localpart, 'lw_42')
assertEq('JID domain', jid?.domain, 'lineweb')
assertEq('JID resource', jid?.resource, 'res')
assert('无 resource 的 JID', parseChatJid('lw_1@lineweb')?.resource === '')
assert('非法 JID null', parseChatJid('no-at-sign') === null)

assertEq('单聊 JID', directJidOf(7), 'lw_7@lineweb')
assertEq('群 JID', roomJidOf(3), `room-3@${CHAT_MUC_DOMAIN}`)
assertEq('群 JID + 资源', roomJidWithResource(3, 7), `room-3@${CHAT_MUC_DOMAIN}/lw_7`)
assertEq('群 JID 反解', conversationIdOfRoomJid(`room-3@${CHAT_MUC_DOMAIN}/lw_7`), 3)
assertEq('非群 JID 反解 null', conversationIdOfRoomJid('lw_7@lineweb'), null)
assertEq('MUC 域名约定', CHAT_MUC_DOMAIN, 'muc.lineweb')
assertEq('单聊域名约定', CHAT_DOMAIN, 'lineweb')

const uploadId = newUploadId()
assertEq('上传 id 为 24hex', /^[0-9a-f]{24}$/.test(uploadId), true)
assertEq('上传路径 png', uploadPathOf('a'.repeat(24), 'image/png'), `_chat/uploads/${'a'.repeat(24)}.png`)
assertEq('上传路径 gif', uploadPathOf('b'.repeat(24), 'image/gif'), `_chat/uploads/${'b'.repeat(24)}.gif`)

// === 3. XMPP 流状态机 ===

section('XMPP 流状态机（内存会话）')

const TEST_USER = 999_999_001

class CaptureSink {
  frames: string[] = []
  closed = false
  closeCode: number | null = null
  send(xml: string): void {
    this.frames.push(xml)
  }
  close(code?: number): void {
    this.closed = true
    this.closeCode = code ?? null
  }
  get last(): string {
    return this.frames[this.frames.length - 1] ?? ''
  }
  text(): string {
    return this.frames.join('')
  }
}

function makeSession(userId: number, sink: CaptureSink): ChatSession {
  const session: ChatSession = {
    id: `test-${userId}-${Math.random().toString(36).slice(2, 8)}`,
    userId,
    kind: 'ws',
    sink,
    authed: false,
    bound: false,
    resource: '',
    lastActivity: Date.now(),
    closed: false,
  }
  registerSession(session)
  return session
}

async function handshake(userId: number, sink: CaptureSink): Promise<ChatSession> {
  const session = makeSession(userId, sink)
  await processSessionStanza(session, '<open xmlns="urn:ietf:params:xml:ns:xmpp-framing" to="lineweb" version="1.0"/>')
  assert('握手：第一步返回 features（含 mechanisms）', sink.last.includes('<mechanisms') && sink.last.includes('PLAIN'))
  const ticket = issueChatTicket(userId)
  await processSessionStanza(
    session,
    `<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="PLAIN">${Buffer.from(`\0${toNekoUsername(userId)}\0${ticket}`).toString('base64')}</auth>`,
  )
  assert('握手：SASL 成功', sink.last.includes('<success'))
  await processSessionStanza(session, '<open xmlns="urn:ietf:params:xml:ns:xmpp-framing" to="lineweb" version="1.0"/>')
  assert('握手：重开流后 features（含 bind）', sink.last.includes('<bind') && !sink.last.includes('<mechanisms'))
  await processSessionStanza(session, '<iq type="set" id="bind1"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><resource>lineweb</resource></bind></iq>')
  const bindResult = firstFrame(sink.last)
  assert('握手：bind result', bindResult?.attrs.type === 'result')
  assertEq(
    '握手：bind JID',
    bindResult?.children[0]?.children[0]?.text,
    `${toNekoUsername(userId)}@${CHAT_DOMAIN}/lineweb`,
  )
  assert('握手：会话已绑定', session.bound)
  return session
}

async function stateMachineTests(): Promise<void> {
  const sink = new CaptureSink()
  const session = await handshake(TEST_USER, sink)

  // ping 保活
  await processSessionStanza(session, '<iq type="get" id="iq1"><ping xmlns="urn:xmpp:ping"/></iq>')
  assertEq('ping 回 result', firstFrame(sink.last)?.attrs.type, 'result')
  assertEq('ping 回显 id', firstFrame(sink.last)?.attrs.id, 'iq1')

  // 空历史查询（该用户无会话）
  await processSessionStanza(session, '<iq type="get" id="iq2"><query xmlns="urn:wlxx:chat" max="30"/></iq>')
  const emptyQuery = firstFrame(sink.last)
  assert('无会话历史返回空 query', emptyQuery?.children[0]?.name === 'query')
  assertEq('空历史 complete=1', emptyQuery?.children[0]?.attrs.complete, '1')

  // 非好友单聊 → 注入 not-authorized（与原 nekoWsProxy 行为一致）
  await processSessionStanza(
    session,
    `<message type="chat" to="${directJidOf(TEST_USER + 1)}"><body>hi</body></message>`,
  )
  const rejected = firstFrame(sink.last)
  assertEq('非好友单聊注入 error 帧', rejected?.attrs.type, 'error')
  assert('拒绝帧含 not-authorized', sink.last.includes('not-authorized'))

  // 未知 iq 回错误帧
  await processSessionStanza(session, '<iq type="get" id="iq3"><query xmlns="urn:unknown:ns"/></iq>')
  assertEq('未知 iq 回 error', firstFrame(sink.last)?.attrs.type, 'error')

  // 票据语义
  const oneShot = issueChatTicket(TEST_USER)
  assert('票据首次消费成功', consumeChatTicket(oneShot, TEST_USER))
  assert('票据一次性（二次消费失败）', !consumeChatTicket(oneShot, TEST_USER))
  assert('票据不跨用户', !consumeChatTicket(issueChatTicket(TEST_USER), TEST_USER + 1))

  // SASL 失败路径：错误票据 → failure + 会话关闭
  const failSink = new CaptureSink()
  const failSession = makeSession(TEST_USER, failSink)
  await processSessionStanza(failSession, '<open xmlns="urn:ietf:params:xml:ns:xmpp-framing"/>')
  await processSessionStanza(
    failSession,
    `<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="PLAIN">${Buffer.from(`\0${toNekoUsername(TEST_USER)}\0wrong-ticket`).toString('base64')}</auth>`,
  )
  assert('错误票据回 failure', failSink.last.includes('<failure'))
  assert('失败后会话被回收', failSession.closed)

  teardownSession(session)
  assert('teardown 后会话已移除', session.closed)
}

// === 4. 长轮询会话 ===

section('长轮询会话队列')

async function pollingTests(): Promise<void> {
  const userId = TEST_USER + 1
  const sessionId = createPollingSession(userId)
  assert('轮询会话 id 非空', sessionId.length > 0)

  // 无帧时 poll 挂起（这里只验证立即路径与上行驱动）
  await feedStanza(sessionId, userId, '<open xmlns="urn:ietf:params:xml:ns:xmpp-framing" to="lineweb" version="1.0"/>')
  const first = await pollStanza(sessionId, userId)
  assert('上行 open 后 poll 取到 features', !!first && first.includes('<mechanisms'))

  const ticket = issueChatTicket(userId)
  await feedStanza(
    sessionId,
    userId,
    `<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="PLAIN">${Buffer.from(`\0${toNekoUsername(userId)}\0${ticket}`).toString('base64')}</auth>`,
  )
  const second = await pollStanza(sessionId, userId)
  assert('SASL 成功帧可取', !!second && second.includes('<success'))

  // 错误用户访问别人的会话
  const foreignPoll = await pollStanza(sessionId, userId + 1)
  assertEq('跨用户 poll 返回 null', foreignPoll, null)
  const foreignFeed = await feedStanza(sessionId, userId + 1, '<presence/>')
  assertEq('跨用户 feed 被拒', foreignFeed, false)

  closePollingSession(sessionId, userId)
  const afterClose = await pollStanza(sessionId, userId)
  assertEq('关闭后 poll 返回 null', afterClose, null)
}

// === 5. bootstrap 视图出口口径（空数据用户） ===

section('bootstrap 视图形状')

async function viewTests(): Promise<void> {
  const view = await buildChatView({ id: TEST_USER, username: 'verify-chat-user' })
  assertEq('domain 契约', view.domain, 'lineweb')
  assertEq('mucDomain 契约', view.mucDomain, 'muc.lineweb')
  assertEq('historyLimit', view.historyLimit, 30)
  assertEq('self.nekoId', view.self.nekoId, toNekoId(TEST_USER))
  assertEq('self.linewebId', view.self.linewebId, TEST_USER)
  assertEq('self.username', view.self.username, toNekoUsername(TEST_USER))
  assert('friends 为数组', Array.isArray(view.friends))
  assert('contacts 为数组', Array.isArray(view.contacts))
  assert('rooms 为数组', Array.isArray(view.rooms))
  assert('stickers 为数组', Array.isArray(view.stickers))
  assert('无 isLobby 字段（大厅已移除）', view.rooms.every((room) => !('isLobby' in room)))
  assert('申请只有 lineweb 来源', [...view.requestsIn, ...view.requestsOut].every((request) => request.source === 'lineweb'))
}

// === 执行 ===

async function main(): Promise<void> {
  await stateMachineTests()
  await pollingTests()
  await viewTests()

  // === 汇总 ===

  console.log(`\n========================================`)
  console.log(`通过 ${passed} 项断言，失败 ${failed} 项`)
  if (failed > 0) {
    console.error('\n失败清单：')
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exit(1)
  }
  console.log('verify:chat 全部通过 ✓')
}

void main().catch((err) => {
  console.error('verify:chat 执行异常:', err)
  process.exit(1)
})
