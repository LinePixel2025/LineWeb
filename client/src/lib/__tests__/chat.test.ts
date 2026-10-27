import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canRecall,
  chatImageUrl,
  contactLabel,
  conversationPreview,
  formatUnread,
  getChatWsUrl,
  getXmppWsUrl,
  isConversationKey,
  mergeNekoMessages,
  messagePreview,
  parseConversationKey,
  RECALL_WINDOW_MS,
  senderLabel,
  sortNekoConversations,
  totalUnread,
} from '../chat'
import { setToken } from '../api'
import type { NekoConversation, NekoMessage } from '../../types/chat'

const UPLOAD_ID = '0123456789abcdef01234567'

function createMessage(id: number, ts: number, extra: Partial<NekoMessage> = {}): NekoMessage {
  return {
    id,
    key: 'u1000000000002',
    from: 'lw_2@wlxx',
    fromUsername: 'lw_2',
    fromNekoId: 1000000000002,
    to: 'lw_1@wlxx',
    roomId: null,
    ts,
    body: `消息 ${id}`,
    mine: false,
    recalled: false,
    byAdmin: false,
    image: null,
    ...extra,
  }
}

function createConversation(extra: Partial<NekoConversation> = {}): NekoConversation {
  return {
    key: 'u1000000000002',
    kind: 'direct',
    title: 'alice',
    avatarId: 2,
    avatarName: 'alice',
    contact: {
      key: 'u1000000000002',
      nekoId: 1000000000002,
      linewebId: 2,
      username: 'lw_2',
      displayName: 'alice',
      kind: 'lineweb',
      online: false,
      lastMessageAt: 0,
      isFriend: true,
      remark: '',
    },
    room: null,
    lastMessage: null,
    lastMessageAt: 0,
    unread: 0,
    pinned: false,
    online: false,
    members: [],
    isFriend: true,
    canSend: true,
    ...extra,
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('getChatWsUrl', () => {
  it('VITE_API_URL 为绝对 https 地址时转为 wss 并去掉 /api 后缀', () => {
    vi.stubEnv('VITE_API_URL', 'https://web.example.com/api')

    expect(getChatWsUrl()).toBe('wss://web.example.com/ws/chat')
  })

  it('VITE_API_URL 为绝对 http 地址时转为 ws，并容忍末尾斜杠', () => {
    vi.stubEnv('VITE_API_URL', 'http://192.168.1.10:3001/api/')

    expect(getChatWsUrl()).toBe('ws://192.168.1.10:3001/ws/chat')
  })

  it('未配置绝对地址时回退到同源 ws 地址', () => {
    vi.stubEnv('VITE_API_URL', '')

    // jsdom 默认地址为 http://localhost:3000/
    expect(getChatWsUrl()).toBe('ws://localhost:3000/ws/chat')
  })

  it('相对地址 /api 时同样回退到同源', () => {
    vi.stubEnv('VITE_API_URL', '/api')

    expect(getChatWsUrl()).toBe('ws://localhost:3000/ws/chat')
  })
})

describe('getXmppWsUrl', () => {
  it('绝对 HTTPS 地址换成 wss 并附带编码后的令牌', () => {
    vi.stubEnv('VITE_API_URL', 'https://web.example.com/api')

    expect(getXmppWsUrl('a b&c')).toBe('wss://web.example.com/ws/xmpp?token=a%20b%26c')
  })

  it('绝对 HTTP 地址换成 ws', () => {
    vi.stubEnv('VITE_API_URL', 'http://192.168.1.10:3001/api/')

    expect(getXmppWsUrl('ticket')).toBe('ws://192.168.1.10:3001/ws/xmpp?token=ticket')
  })

  it('未配置绝对地址时使用同源地址', () => {
    vi.stubEnv('VITE_API_URL', '')

    expect(getXmppWsUrl('abc')).toBe('ws://localhost:3000/ws/xmpp?token=abc')
  })

  it('没有令牌时也拼出 url（token 为空）', () => {
    vi.stubEnv('VITE_API_URL', '/api')

    expect(getXmppWsUrl('')).toBe('ws://localhost:3000/ws/xmpp?token=')
  })
})

describe('mergeNekoMessages', () => {
  it('按 id 去重，后到的消息覆盖先到的', () => {
    const existing = [createMessage(1, 1000), createMessage(2, 2000)]
    const incoming = [createMessage(2, 2000, { body: '更新后的内容' }), createMessage(3, 3000)]

    const merged = mergeNekoMessages(existing, incoming)

    expect(merged).toHaveLength(3)
    expect(merged.map((message) => message.id)).toEqual([1, 2, 3])
    expect(merged[1].body).toBe('更新后的内容')
  })

  it('乱序传入时按时间正序排序', () => {
    const merged = mergeNekoMessages([createMessage(3, 3000)], [createMessage(1, 1000), createMessage(2, 2000)])

    expect(merged.map((message) => message.id)).toEqual([1, 2, 3])
  })

  it('时间相同则按 id 升序', () => {
    const merged = mergeNekoMessages([], [createMessage(5, 1000), createMessage(2, 1000)])

    expect(merged.map((message) => message.id)).toEqual([2, 5])
  })

  it('丢弃 id 非正数的占位消息（实时 stanza 尚未落库）', () => {
    const merged = mergeNekoMessages([createMessage(1, 1000)], [createMessage(0, 2000)])

    expect(merged.map((message) => message.id)).toEqual([1])
  })

  it('接受单条消息，不修改原数组', () => {
    const existing = [createMessage(1, 1000)]
    const merged = mergeNekoMessages(existing, createMessage(2, 2000))

    expect(merged).toHaveLength(2)
    expect(existing).toHaveLength(1)
  })
})

describe('parseConversationKey / isConversationKey', () => {
  it('u 前缀解析为单聊 nekoId', () => {
    expect(parseConversationKey('u1000000000002')).toEqual({ kind: 'direct', nekoId: 1000000000002 })
  })

  it('r 前缀解析为群聊 roomId', () => {
    expect(parseConversationKey('r7')).toEqual({ kind: 'room', roomId: 7 })
  })

  it('非法键返回 null', () => {
    expect(parseConversationKey('')).toBeNull()
    expect(parseConversationKey('u0')).toBeNull()
    expect(parseConversationKey('u-1')).toBeNull()
    expect(parseConversationKey('r')).toBeNull()
    expect(parseConversationKey('x9')).toBeNull()
    expect(isConversationKey('u1')).toBe(true)
    expect(isConversationKey('folder/1')).toBe(false)
  })
})

describe('formatUnread', () => {
  it('0 或负数返回空字符串', () => {
    expect(formatUnread(0)).toBe('')
    expect(formatUnread(-1)).toBe('')
  })

  it('1-99 返回数字字符串', () => {
    expect(formatUnread(1)).toBe('1')
    expect(formatUnread(99)).toBe('99')
  })

  it('超过 99 返回 99+', () => {
    expect(formatUnread(100)).toBe('99+')
    expect(formatUnread(1234)).toBe('99+')
  })
})

describe('chatImageUrl', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setToken(null)
  })

  it('给 neko 上传地址追加登录令牌', () => {
    setToken('abc123')

    expect(chatImageUrl(`/chat/uploads/${UPLOAD_ID}`)).toBe(`/chat/uploads/${UPLOAD_ID}?token=abc123`)
  })

  it('编码 token，且接受带查询串的原始地址', () => {
    setToken('a b&c')

    expect(chatImageUrl(`/chat/uploads/${UPLOAD_ID}?v=1`)).toBe(
      `/chat/uploads/${UPLOAD_ID}?token=a%20b%26c`,
    )
  })

  it('没有 token 时仍拼出地址（token 为空）', () => {
    expect(chatImageUrl(`/chat/uploads/${UPLOAD_ID}`)).toBe(`/chat/uploads/${UPLOAD_ID}?token=`)
  })

  it('非上传地址原样返回（防止把外链拼上令牌）', () => {
    setToken('abc')

    expect(chatImageUrl('https://example.com/a.png')).toBe('https://example.com/a.png')
  })

  it('空值返回空字符串', () => {
    expect(chatImageUrl(null)).toBe('')
    expect(chatImageUrl('')).toBe('')
  })
})

describe('canRecall', () => {
  const ts = Date.parse('2026-10-01T10:00:00.000Z')

  it('本人 5 分钟内的消息可以撤回', () => {
    expect(canRecall(createMessage(1, ts, { mine: true }), ts + 30_000)).toBe(true)
  })

  it('他人的消息不能撤回', () => {
    expect(canRecall(createMessage(1, ts, { mine: false }), ts + 1000)).toBe(false)
  })

  it('刚好 5 分钟仍可撤回，超过 5 分钟不可撤回', () => {
    const message = createMessage(1, ts, { mine: true })

    expect(canRecall(message, ts + RECALL_WINDOW_MS)).toBe(true)
    expect(canRecall(message, ts + RECALL_WINDOW_MS + 1)).toBe(false)
  })

  it('已撤回的消息不能再撤回', () => {
    expect(canRecall(createMessage(1, ts, { mine: true, recalled: true }), ts + 30_000)).toBe(false)
  })

  it('时间戳缺失时不可撤回', () => {
    expect(canRecall(createMessage(1, 0, { mine: true }), ts)).toBe(false)
  })
})

describe('messagePreview', () => {
  it('文本消息返回正文', () => {
    expect(messagePreview(createMessage(1, 1000))).toBe('消息 1')
  })

  it('图片消息返回 [图片]', () => {
    const message = createMessage(1, 1000, {
      body: '[图片]',
      image: `/chat/uploads/${UPLOAD_ID}`,
    })

    expect(messagePreview(message)).toBe('[图片]')
  })

  it('已撤回消息返回 [已撤回]（图片消息同理）', () => {
    expect(messagePreview(createMessage(1, 1000, { recalled: true }))).toBe('[已撤回]')
    expect(
      messagePreview(
        createMessage(2, 1000, { recalled: true, image: `/chat/uploads/${UPLOAD_ID}` }),
      ),
    ).toBe('[已撤回]')
  })
})

describe('conversationPreview', () => {
  it('没有消息时提示暂无消息', () => {
    expect(conversationPreview(createConversation())).toBe('暂无消息')
  })

  it('单聊直接展示消息预览', () => {
    const conversation = createConversation({
      lastMessage: createMessage(1, 1000, { body: '你好' }),
      lastMessageAt: 1000,
    })

    expect(conversationPreview(conversation)).toBe('你好')
  })

  it('群聊非本人消息带发送者前缀，本人消息不加前缀', () => {
    const base = createConversation({
      key: 'r7',
      kind: 'room',
      title: '前端小组',
      avatarId: -7,
    })
    const others = {
      ...base,
      lastMessage: createMessage(1, 1000, { roomId: 7, fromUsername: 'lw_2', body: '在吗' }),
    }
    const mine = {
      ...base,
      lastMessage: createMessage(2, 2000, { roomId: 7, fromUsername: 'lw_1', body: '在', mine: true }),
    }

    expect(conversationPreview(others)).toBe('lw_2：在吗')
    expect(conversationPreview(mine)).toBe('在')
  })
})

describe('senderLabel', () => {
  it('自己的消息显示「你」', () => {
    expect(senderLabel(createMessage(1, 1000, { mine: true }), createConversation())).toBe('你')
  })

  it('群成员优先使用 displayName', () => {
    const conversation = createConversation({
      kind: 'room',
      key: 'r7',
      members: [
        {
          nekoId: 1000000000002,
          linewebId: 2,
          username: 'lw_2',
          displayName: '爱丽丝',
          role: 'member',
          online: true,
          kind: 'lineweb',
        },
      ],
    })

    expect(senderLabel(createMessage(1, 1000, { roomId: 7 }), conversation)).toBe('爱丽丝')
  })

  it('找不到成员时退回用户名', () => {
    expect(
      senderLabel(createMessage(1, 1000, { fromUsername: 'nobody', from: 'nobody@wlxx' }), createConversation()),
    ).toBe('nobody')
  })
})

describe('contactLabel', () => {
  it('displayName 与用户名相同时只显示用户名', () => {
    expect(contactLabel({ username: 'alice', displayName: 'alice' })).toBe('alice')
  })

  it('原生账号 displayName 不同时补上 @用户名', () => {
    expect(contactLabel({ username: 'admin', displayName: 'senlinjun', kind: 'native' })).toBe(
      'senlinjun (@admin)',
    )
    expect(contactLabel({ username: 'admin', displayName: 'senlinjun', isLineWeb: false })).toBe(
      'senlinjun (@admin)',
    )
  })

  it('LineWeb 账号不暴露内部 lw_ 用户名', () => {
    expect(contactLabel({ username: 'lw_2', displayName: '爱丽丝', kind: 'lineweb' })).toBe('爱丽丝')
  })

  it('空值返回空字符串', () => {
    expect(contactLabel(null)).toBe('')
  })
})

describe('sortNekoConversations', () => {
  it('置顶会话按 pinnedChats 顺序排在最前', () => {
    const a = createConversation({ key: 'u1', title: 'A', lastMessageAt: 1000 })
    const b = createConversation({ key: 'u2', title: 'B', lastMessageAt: 3000 })
    const c = createConversation({ key: 'u3', title: 'C', lastMessageAt: 2000, pinned: true })

    const sorted = sortNekoConversations([a, b, c], ['u3'])

    expect(sorted.map((item) => item.key)).toEqual(['u3', 'u2', 'u1'])
  })

  it('未置顶的按最近消息时间倒序，再按标题', () => {
    const a = createConversation({ key: 'u1', title: 'A', lastMessageAt: 1000 })
    const b = createConversation({ key: 'u2', title: 'B', lastMessageAt: 3000 })
    const c = createConversation({ key: 'u3', title: 'C', lastMessageAt: 3000 })

    const sorted = sortNekoConversations([a, b, c])

    expect(sorted.map((item) => item.title)).toEqual(['B', 'C', 'A'])
  })
})

describe('totalUnread', () => {
  it('累加各会话未读数并忽略负数', () => {
    const list = [
      createConversation({ key: 'u1', unread: 2 }),
      createConversation({ key: 'u2', unread: 0 }),
      createConversation({ key: 'u3', unread: -3 }),
    ]

    expect(totalUnread(list)).toBe(2)
    expect(totalUnread([])).toBe(0)
  })
})
