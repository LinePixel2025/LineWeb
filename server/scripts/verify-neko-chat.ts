/**
 * neko XMPP 聊天自检脚本
 *
 * 用法：
 *   cd server && npm run verify:neko            # 纯函数断言（不联网、不读写数据库）
 *   cd server && npm run verify:neko -- --live  # 额外做真实连通性 + XMPP 握手冒烟
 *
 * 覆盖：
 *   - 身份换算：LineWeb id ↔ neko id（映射区间边界）、`lw_` 用户名（拒绝前导零）、
 *     账号同步载荷（isAdmin 恒 false、enabled 继承）；
 *   - JID：拼装 / 解析（含 resource）、`room-<id>@muc` 反解、非法 JID；
 *   - 会话哈希：长度 32、稳定、不同令牌不同值；
 *   - 状态出口口径（nekoChatView）：大厅过滤、系统/文件助手剔除、非好友 `lw_*` 剔除、
 *     无往来原生账号剔除、好友缺失时按 Prisma 兜底、置顶过滤、群成员换算；
 *   - 目录搜索与陌生来消息反查的可见性规则；
 *   - `--live`：health → ensureAccount → ticket → 自建 RFC 7395 连接（SASL PLAIN）→
 *     presence → 给自己发一条 → fetchHistory 取回 → 停用测试账号。
 *
 * 说明：`--live` 需要真实的 NEKO_CHAT_TOKEN（只从环境变量读，脚本不回显、不落盘）；
 * 测试账号固定为 LineWeb id 999999，结束后停用，避免污染真实用户。
 */

process.env.NODE_ENV ||= 'development'
process.env.DATABASE_URL ||= 'file:./.verify-neko.db'
process.env.JWT_SECRET ||= 'verify-neko-secret'
process.env.NEKO_CHAT_ACCOUNT_BASE ||= '1000000000000'
process.env.NEKO_CHAT_USERNAME_PREFIX ||= 'lw_'
process.env.NEKO_CHAT_ENABLED ||= 'true'

type NekoChat = typeof import('../src/services/nekoChat.js')
type NekoChatView = typeof import('../src/services/nekoChatView.js')
type NekoConfig = typeof import('../src/config/index.js')

let chat: NekoChat
let view: NekoChatView
let config: NekoConfig['config']

let passed = 0

function assert(condition: unknown, label: string): void {
  if (!condition) throw new Error(`断言失败：${label}`)
  passed += 1
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const actualText = JSON.stringify(actual)
  const expectedText = JSON.stringify(expected)
  if (actualText !== expectedText) {
    throw new Error(`断言失败：${label}\n  实际: ${actualText}\n  期望: ${expectedText}`)
  }
  passed += 1
}

// === 测试数据 ===

const BASE = 1000000000000

function stateUser(
  id: number,
  username: string,
  displayName: string,
  lastMessageAt = 0,
  online = false,
): NekoChat['NekoState']['users'][number] {
  return { id, username, displayName, isAdmin: false, avatarVersion: 0, lastMessageAt, online }
}

function makeState(): NekoChat['NekoState'] {
  return {
    domain: 'wlxx',
    mucDomain: 'muc.wlxx',
    systemUsername: 'notice',
    fileHelperUsername: 'file',
    historyLimit: 50,
    friends: [
      {
        id: BASE + 2,
        username: 'lw_2',
        displayName: '好友',
        remark: '老友',
        isAdmin: false,
        enabled: true,
        avatarVersion: 0,
        lastMessageAt: 50,
        online: true,
      },
    ],
    friendRequestsIn: [],
    friendRequestsOut: [],
    stickers: [],
    pinnedChats: [`u${BASE + 2}`, 'r7', `u${BASE + 99}`, 'r1', 'garbage'],
    users: [
      stateUser(BASE + 1, 'lw_1', '我', 100, true), // 自己
      stateUser(BASE + 2, 'lw_2', '好友', 50, true), // 好友
      stateUser(BASE + 3, 'lw_3', '陌生人', 70, true), // 非好友 LineWeb 账号
      stateUser(27, 'fxq', 'Novalee', 30, true), // 有往来的原生账号
      stateUser(31, 'quiet', '潜水', 0, false), // 无往来原生账号
      stateUser(9000000002, 'file', '文件传输助手', 9, true), // 系统
      stateUser(9000000001, 'notice', '系统助理', 9, true), // 系统
    ],
    rooms: [
      {
        id: 1,
        name: '聊天大厅',
        isLobby: true,
        ownerId: 9000000001,
        allMuted: false,
        announcement: '',
        announcementUpdatedAt: 0,
        myRole: 'member',
        mutedUntil: 0,
        notifyMuted: false,
        lastMessageAt: 999,
        members: [],
      },
      {
        id: 7,
        name: '项目组',
        isLobby: false,
        ownerId: BASE + 2,
        allMuted: false,
        announcement: '本周目标',
        announcementUpdatedAt: 0,
        myRole: 'member',
        mutedUntil: 0,
        notifyMuted: false,
        lastMessageAt: 20,
        members: [
          { id: BASE + 2, username: 'lw_2', displayName: '好友', role: 'owner', mutedUntil: 0, online: true },
          { id: 27, username: 'fxq', displayName: 'Novalee', role: 'member', mutedUntil: 0, online: true },
        ],
      },
      {
        id: 8,
        name: '别人的群',
        isLobby: false,
        ownerId: 27,
        allMuted: false,
        announcement: '',
        announcementUpdatedAt: 0,
        myRole: null,
        mutedUntil: 0,
        notifyMuted: false,
        lastMessageAt: 10,
        members: [],
      },
    ],
  }
}

function buildView(allowNative: boolean, overrides: Partial<NekoChatView['BuildChatViewInput']> = {}) {
  return view.buildChatView({
    me: { id: 1, username: '我' },
    state: makeState(),
    friends: [{ id: 2, username: '好友' }],
    requestsIn: [],
    requestsOut: [],
    allowNative,
    ...overrides,
  })
}

// === 纯函数断言 ===

function checkIdentity(): void {
  assertEqual(chat.toNekoId(1), BASE + 1, '身份：LineWeb 1 → neko BASE+1')
  assertEqual(chat.toNekoId(999999), BASE + 999999, '身份：大 id 线性偏移')
  assertEqual(chat.linewebIdOf(BASE + 1), 1, '身份：neko BASE+1 → LineWeb 1')
  assertEqual(chat.linewebIdOf(BASE), null, '身份：BASE 本身无对应 LineWeb 用户')
  assertEqual(chat.linewebIdOf(BASE - 1), null, '身份：映射区间以下不换算')
  assertEqual(chat.linewebIdOf(27), null, '身份：原生账号不换算（即使数值很大）')
  assertEqual(chat.linewebIdOf(1.5), null, '身份：非整数不换算')

  assertEqual(chat.toNekoUsername(42), 'lw_42', '用户名：固定 lw_ 前缀')
  assertEqual(chat.linewebIdOfUsername('lw_42'), 42, '用户名：反解 LineWeb id')
  assertEqual(chat.linewebIdOfUsername('lw_0'), null, '用户名：lw_0 非法')
  assertEqual(chat.linewebIdOfUsername('lw_01'), null, '用户名：拒绝前导零（防冒充）')
  assertEqual(chat.linewebIdOfUsername('lw_42x'), null, '用户名：非纯数字不换算')
  assertEqual(chat.linewebIdOfUsername('admin'), null, '用户名：无前缀不换算')
  assertEqual(chat.linewebIdOfUsername('xlw_42'), null, '用户名：前缀须在最前')
  assert(chat.isLineWebUsername('lw_7'), '用户名：isLineWebUsername 识别 LineWeb 账号')
  assert(!chat.isLineWebUsername('lw_07'), '用户名：isLineWebUsername 拒绝前导零')

  const payload = chat.accountPayload({ id: 8, username: '阿八', enabled: false, avatarVersion: 3 })
  assertEqual(
    payload,
    {
      id: BASE + 8,
      username: 'lw_8',
      displayName: '阿八',
      isAdmin: false,
      enabled: false,
      avatarVersion: 3,
    },
    '载荷：isAdmin 恒 false / enabled 继承 / 资料同步',
  )
  assertEqual(chat.accountPayload({ id: 8, username: '阿八' }).enabled, true, '载荷：缺省 enabled=true')
  assertEqual(chat.accountPayload({ id: 8, username: '阿八' }).avatarVersion, 0, '载荷：头像版本缺省 0')
}

function checkJid(): void {
  assertEqual(chat.toNekoJid(5, 'wlxx'), 'lw_5@wlxx', 'JID：LineWeb 用户拼装')
  assertEqual(chat.toNekoJid(5, 'wlxx/res'), 'lw_5@wlxx', 'JID：拼装时丢弃 resource')
  assertEqual(chat.toNekoJid(5, ''), 'lw_5@', 'JID：domain 为空按原样拼接（调用方保证非空）')

  assertEqual(chat.parseNekoJid('lw_5@wlxx'), { localpart: 'lw_5', domain: 'wlxx', resource: '' }, 'JID：裸 JID 解析')
  assertEqual(
    chat.parseNekoJid('room-7@muc.wlxx/lw_5'),
    { localpart: 'room-7', domain: 'muc.wlxx', resource: 'lw_5' },
    'JID：带 resource 解析',
  )
  assertEqual(chat.parseNekoJid('  lw_5@wlxx  '), { localpart: 'lw_5', domain: 'wlxx', resource: '' }, 'JID：首尾空白裁剪')
  assertEqual(chat.parseNekoJid('no-at-sign'), null, 'JID：缺 domain 返回 null')
  assertEqual(chat.parseNekoJid('a b@wlxx'), null, 'JID：localpart 含空格返回 null')
  assertEqual(chat.parseNekoJid(''), null, 'JID：空串返回 null')

  assertEqual(chat.roomJid(7, 'muc.wlxx'), 'room-7@muc.wlxx', 'JID：群 JID 拼装')
  assertEqual(chat.roomIdOfJid('room-7@muc.wlxx/lw_2'), 7, 'JID：群 JID 反解（带 resource）')
  assertEqual(chat.roomIdOfJid('room-0@muc.wlxx'), null, 'JID：room-0 非法')
  assertEqual(chat.roomIdOfJid('lw_7@wlxx'), null, 'JID：单聊 JID 不是群')
  assertEqual(chat.roomIdOfJid('room-x@muc.wlxx'), null, 'JID：非数字房间号')

  assertEqual(chat.sessionHashOf('token-a').length, 32, '会话哈希：32 位十六进制')
  assertEqual(chat.sessionHashOf('token-a'), chat.sessionHashOf('token-a'), '会话哈希：同令牌稳定')
  assert(chat.sessionHashOf('token-a') !== chat.sessionHashOf('token-b'), '会话哈希：不同令牌不同值')
}

function checkView(): void {
  const built = buildView(true)

  assertEqual(built.domain, 'wlxx', '状态：透出 domain')
  assertEqual(built.mucDomain, 'muc.wlxx', '状态：透出 mucDomain')
  assertEqual(built.historyLimit, 50, '状态：透出历史上限')
  assertEqual(built.self, { nekoId: BASE + 1, linewebId: 1, username: 'lw_1', displayName: '我' }, '状态：自己')

  assertEqual(built.friends.length, 1, '联系人：好友数量')
  assertEqual(built.friends[0].key, `u${BASE + 2}`, '联系人：会话键 u<nekoId>')
  assertEqual(built.friends[0].remark, '老友', '联系人：备注来自 neko')
  assertEqual(built.friends[0].kind, 'lineweb', '联系人：好友归类 LineWeb')
  assertEqual(built.friends[0].linewebId, 2, '联系人：好友带 LineWeb id')

  assertEqual(
    built.contacts.map((c) => c.username),
    ['lw_2', 'fxq'],
    '联系人：好友 + 有往来原生账号（剔除自己/非好友 lw_*/无往来/系统）',
  )
  assertEqual(built.contacts[1].isFriend, false, '联系人：原生账号不是好友')
  assertEqual(built.contacts[1].kind, 'native', '联系人：原生账号归类 native')
  assertEqual(built.contacts[1].linewebId, null, '联系人：原生账号无 LineWeb id')

  assertEqual(built.rooms.map((r) => r.key), ['r7'], '群：剔除大厅与非成员群')
  assertEqual(built.rooms[0].name, '项目组', '群：名称')
  assertEqual(built.rooms[0].announcement, '本周目标', '群：公告')
  assertEqual(
    built.rooms[0].members.map((m) => `${m.nekoId}:${m.role}:${m.kind}`),
    [`${BASE + 2}:owner:lineweb`, '27:member:native'],
    '群：成员换算（LineWeb / 原生）',
  )

  assertEqual(built.pinnedChats, [`u${BASE + 2}`, 'r7'], '置顶：只保留可见会话键')

  const noNative = buildView(false)
  assertEqual(noNative.contacts.map((c) => c.username), ['lw_2'], '开关：allowNative=false 时剔除原生账号')

  const missingFriend = buildView(true, { friends: [{ id: 5, username: '新朋友' }] })
  assertEqual(missingFriend.friends.length, 1, '兜底：neko 侧缺失的好友仍出现')
  assertEqual(missingFriend.friends[0].username, 'lw_5', '兜底：按 LineWeb id 生成用户名')
  assertEqual(missingFriend.friends[0].displayName, '新朋友', '兜底：显示名取 LineWeb 用户名')
  assertEqual(missingFriend.friends[0].online, false, '兜底：缺失账号视为离线')
  assertEqual(missingFriend.rooms.length, 1, '兜底：好友缺失不影响群列表')
}

function checkDirectory(): void {
  const state = makeState()
  const selfId = BASE + 1
  const friendIds = new Set([2])

  const byDisplay = view.searchDirectory(state, selfId, friendIds, 'nova', true)
  assertEqual(byDisplay.map((u) => u.username), ['fxq'], '目录：按显示名（大小写不敏感）搜索原生账号')
  const byName = view.searchDirectory(state, selfId, friendIds, 'FXQ', true)
  assertEqual(byName.map((u) => u.username), ['fxq'], '目录：按用户名搜索（大小写不敏感）')

  assertEqual(
    view.searchDirectory(state, selfId, friendIds, '好友', true).map((u) => u.username),
    ['lw_2'],
    '目录：好友可搜到',
  )
  assertEqual(
    view.searchDirectory(state, selfId, friendIds, '陌生', true).map((u) => u.username),
    [],
    '目录：非好友 LineWeb 账号不可搜',
  )
  assertEqual(view.searchDirectory(state, selfId, friendIds, 'nova', false), [], '目录：关闭互通后原生账号不可搜')
  assertEqual(view.searchDirectory(state, selfId, friendIds, '我', true), [], '目录：自己不出现')
  assertEqual(view.searchDirectory(state, selfId, friendIds, '文件', true), [], '目录：文件助手不出现')
  assertEqual(view.searchDirectory(state, selfId, friendIds, '系统', true), [], '目录：系统助理不出现')
  assertEqual(view.searchDirectory(state, selfId, friendIds, '   ', true), [], '目录：空查询不返回')
  assertEqual(
    view.searchDirectory(state, selfId, friendIds, 'lw_', true).map((u) => u.username),
    ['lw_2'],
    '目录：lw_ 只回好友',
  )

  assertEqual(
    view.resolveUsers(state, selfId, friendIds, ['fxq', 'lw_3', 'notice', 'file', 'lw_2'], true).map((u) => u.username),
    ['lw_2', 'fxq'],
    '反查：陌生来信只回好友与允许的原生账号',
  )
  assertEqual(view.resolveUsers(state, selfId, friendIds, ['fxq'], false), [], '反查：关闭互通后原生账号不可见')
}

// === --live：真实连通性与 XMPP 握手 ===

function escXml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

interface LiveHandshakeResult {
  rows: number
  echoed: boolean
}

function liveHandshake(
  WebSocketImpl: typeof import('ws').WebSocket,
  url: string,
  options: { domain: string; username: string; ticket: string; selfJid: string; marker: string },
): Promise<LiveHandshakeResult> {
  return new Promise<LiveHandshakeResult>((resolve, reject) => {
    const ws = new WebSocketImpl(url, { handshakeTimeout: 8000 })
    let stage: 'sasl' | 'bind' | 'ready' = 'sasl'
    let settled = false
    let rows = 0
    let echoed = false

    const fail = (err: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws.close()
      } catch {
        // ignore
      }
      reject(err)
    }

    const timer = setTimeout(() => fail(new Error('XMPP 握手超时（15s）')), 15000)

    const send = (xml: string) => {
      ws.send(xml)
    }
    const openStream = () => {
      send(
        `<open xmlns="urn:ietf:params:xml:ns:xmpp-framing" to="${escXml(options.domain)}" version="1.0"/>`,
      )
    }

    ws.on('open', openStream)
    ws.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))))

    ws.on('message', (raw) => {
      const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)
      if (settled) return

      if (text.includes('<failure') || text.includes(':failure')) {
        fail(new Error('SASL 认证失败（票据无效或账号未开放聊天）'))
        return
      }

      if (stage === 'sasl' && /<(?:[\w-]+:)?features[\s>]/.test(text) && text.includes('mechanisms')) {
        stage = 'bind'
        const payload = Buffer.from(`\0${options.username}\0${options.ticket}`, 'utf8').toString('base64')
        send(`<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="PLAIN">${payload}</auth>`)
        return
      }

      if (text.includes('<success') || text.includes(':success')) {
        stage = 'bind'
        openStream()
        return
      }

      if (stage === 'bind' && /<(?:[\w-]+:)?features[\s>]/.test(text) && text.includes('bind')) {
        send('<iq type="set" id="bind1"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><resource>verify</resource></bind></iq>')
        return
      }

      if (text.includes('id="bind1"') && (text.includes('type="result"') || text.includes("type='result'"))) {
        stage = 'ready'
        send('<presence/>')
        send(
          `<message type="chat" to="${escXml(options.selfJid)}"><body>${escXml(options.marker)}</body></message>`,
        )
        send(
          `<iq type="get" id="hist1"><query xmlns="urn:wlxx:chat" with="${escXml(options.selfJid)}" max="5"/></iq>`,
        )
        return
      }

      if (stage === 'ready') {
        if (text.includes(options.marker)) echoed = true
        if (text.includes('id="hist1"')) {
          rows = (text.match(/<(?:[\w-]+:)?msg[\s>]/g) || []).length
          settled = true
          clearTimeout(timer)
          try {
            send('<close xmlns="urn:ietf:params:xml:ns:xmpp-framing"/>')
          } catch {
            // ignore
          }
          ws.close()
          resolve({ rows, echoed })
        }
      }
    })

    ws.on('close', () => {
      if (!settled) fail(new Error('XMPP 连接在完成握手前关闭'))
    })
  })
}

async function checkLive(): Promise<void> {
  const token = String(process.env.NEKO_CHAT_TOKEN || '').trim()
  if (!token) {
    throw new Error('--live 需要真实 NEKO_CHAT_TOKEN 环境变量（不要写进仓库）')
  }
  assert(config.nekoChatEnabled, '在线：配置已启用（NEKO_CHAT_ENABLED + 令牌）')

  const health = await chat.health()
  assert(health.ok === true, '在线：/internal/health 返回 ok')
  console.log(`   [live] health ok domain=${health.domain} online=${health.online}`)

  const testUser = { id: 999999, username: 'lineweb-verify' }
  const testNekoId = chat.toNekoId(testUser.id)
  try {
    const account = await chat.ensureAccount(testUser)
    assert(account.id === testNekoId, '在线：ensureAccount 账号 id 符合映射')
    console.log(`   [live] account ${account.id} username=${account.username}`)

    const ticket = await chat.issueTicket(testUser)
    assert(ticket.length > 0, '在线：票据签发成功')
    console.log(`   [live] ticket length=${ticket.length}`)

    const state = await chat.fetchState(testUser)
    assert(state.domain === health.domain, '在线：state.domain 与 health 一致')
    assert(state.mucDomain.length > 0, '在线：state.mucDomain 非空')
    console.log(`   [live] state domain=${state.domain} muc=${state.mucDomain} users=${state.users.length}`)

    const wsUrl = `${config.nekoChatInternalUrl.replace(/^http/, 'ws')}${config.nekoChatWsPath}`
    const marker = `lineweb-verify-${Date.now()}`
    const { WebSocket: WebSocketImpl } = await import('ws')
    const result = await liveHandshake(WebSocketImpl, wsUrl, {
      domain: state.domain,
      username: chat.toNekoUsername(testUser.id),
      ticket,
      selfJid: chat.toNekoJid(testUser.id, state.domain),
      marker,
    })
    assert(result.rows > 0, '在线：fetchHistory 能取回历史消息')
    console.log(`   [live] xmpp ok rows=${result.rows} selfEcho=${result.echoed}`)
  } finally {
    await chat.removeAccount(testNekoId).catch(() => {})
    console.log('   [live] 测试账号已停用')
  }
}

async function main(): Promise<void> {
  chat = await import('../src/services/nekoChat.js')
  view = await import('../src/services/nekoChatView.js')
  config = (await import('../src/config/index.js')).config

  checkIdentity()
  checkJid()
  checkView()
  checkDirectory()

  const live = process.argv.includes('--live')
  if (live) await checkLive()

  console.log(`\n✅ neko 聊天自检通过：${passed} 条断言${live ? '（含在线冒烟）' : ''}`)
}

main().catch((err) => {
  console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
