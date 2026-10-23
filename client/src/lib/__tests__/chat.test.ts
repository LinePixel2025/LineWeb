import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canRecall,
  chatImageUrl,
  displayName,
  formatUnread,
  getChatWsUrl,
  mergeMessages,
  messagePreview,
  RECALL_WINDOW_MS,
} from '../chat'
import { setToken } from '../api'
import type { Conversation, Message } from '../../types/chat'

function createMessage(id: number, createdAt: string, extra: Partial<Message> = {}): Message {
  return {
    id,
    conversationId: 1,
    senderId: 2,
    sender: { id: 2, username: 'alice' },
    content: `消息 ${id}`,
    createdAt,
    type: 'text',
    recalledAt: null,
    image: null,
    ...extra,
  }
}

function createConversation(extra: Partial<Conversation> = {}): Conversation {
  return {
    id: 1,
    type: 'direct',
    name: '',
    ownerId: 1,
    members: [
      { id: 1, username: 'me', role: 'member' },
      { id: 2, username: 'alice', role: 'member' },
    ],
    lastMessage: null,
    unreadCount: 0,
    lastMessageAt: '2026-10-01T00:00:00.000Z',
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

describe('mergeMessages', () => {
  it('按 id 去重，后到的消息覆盖先到的', () => {
    const existing = [createMessage(1, '2026-10-01T00:00:00.000Z'), createMessage(2, '2026-10-01T00:01:00.000Z')]
    const incoming = [createMessage(2, '2026-10-01T00:01:00.000Z', { content: '更新后的内容' }), createMessage(3, '2026-10-01T00:02:00.000Z')]

    const merged = mergeMessages(existing, incoming)

    expect(merged).toHaveLength(3)
    expect(merged.map((message) => message.id)).toEqual([1, 2, 3])
    expect(merged[1].content).toBe('更新后的内容')
  })

  it('乱序传入时按 createdAt 正序排序', () => {
    const merged = mergeMessages(
      [createMessage(3, '2026-10-01T00:02:00.000Z')],
      [
        createMessage(1, '2026-10-01T00:00:00.000Z'),
        createMessage(2, '2026-10-01T00:01:00.000Z'),
      ]
    )

    expect(merged.map((message) => message.id)).toEqual([1, 2, 3])
  })

  it('时间相同则按 id 升序', () => {
    const sameTime = '2026-10-01T00:00:00.000Z'
    const merged = mergeMessages([], [createMessage(5, sameTime), createMessage(2, sameTime)])

    expect(merged.map((message) => message.id)).toEqual([2, 5])
  })

  it('接受单条消息，不修改原数组', () => {
    const existing = [createMessage(1, '2026-10-01T00:00:00.000Z')]
    const merged = mergeMessages(existing, createMessage(2, '2026-10-01T00:01:00.000Z'))

    expect(merged).toHaveLength(2)
    expect(existing).toHaveLength(1)
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

describe('displayName', () => {
  it('群聊使用群名', () => {
    const conversation = createConversation({ type: 'group', name: '前端小组' })

    expect(displayName(conversation, 1)).toBe('前端小组')
  })

  it('私聊使用对方用户名', () => {
    const conversation = createConversation()

    expect(displayName(conversation, 1)).toBe('alice')
    expect(displayName(conversation, 2)).toBe('me')
  })

  it('群名缺失时使用兜底文案', () => {
    const conversation = createConversation({ type: 'group', name: '' })

    expect(displayName(conversation, 1)).toBe('群聊')
  })
})

describe('chatImageUrl', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setToken(null)
  })

  it('默认使用相对 API 基址并带上登录令牌', () => {
    vi.stubEnv('VITE_API_URL', '')
    setToken('abc123')

    expect(chatImageUrl(42)).toBe('/api/chat/messages/42/image?token=abc123')
  })

  it('绝对 API 基址去掉末尾斜杠，并编码 token', () => {
    vi.stubEnv('VITE_API_URL', 'https://web.example.com/api/')
    setToken('a b&c')

    expect(chatImageUrl(7)).toBe('https://web.example.com/api/chat/messages/7/image?token=a%20b%26c')
  })

  it('没有 token 时也能拼出 URL', () => {
    vi.stubEnv('VITE_API_URL', '/api')
    setToken(null)

    expect(chatImageUrl(1)).toBe('/api/chat/messages/1/image?token=')
  })
})

describe('canRecall', () => {
  const createdAt = '2026-10-01T10:00:00.000Z'
  const base = Date.parse(createdAt)
  const meId = 2

  it('本人 2 分钟内的消息可以撤回', () => {
    const message = createMessage(1, createdAt)

    expect(canRecall(message, meId, base + 30_000)).toBe(true)
  })

  it('他人的消息不能撤回', () => {
    const message = createMessage(1, createdAt)

    expect(canRecall(message, 99, base + 1000)).toBe(false)
  })

  it('刚好 2 分钟仍可撤回，超过 2 分钟不可撤回', () => {
    const message = createMessage(1, createdAt)

    expect(canRecall(message, meId, base + RECALL_WINDOW_MS)).toBe(true)
    expect(canRecall(message, meId, base + RECALL_WINDOW_MS + 1)).toBe(false)
  })

  it('已撤回的消息不能再撤回', () => {
    const message = createMessage(1, createdAt, { recalledAt: '2026-10-01T10:00:30.000Z' })

    expect(canRecall(message, meId, base + 30_000)).toBe(false)
  })

  it('创建时间非法时不可撤回', () => {
    const message = createMessage(1, '不是时间')

    expect(canRecall(message, meId, base)).toBe(false)
  })
})

describe('messagePreview', () => {
  it('文本消息返回正文', () => {
    expect(messagePreview(createMessage(1, '2026-10-01T10:00:00.000Z'))).toBe('消息 1')
  })

  it('图片消息返回 [图片]', () => {
    const message = createMessage(1, '2026-10-01T10:00:00.000Z', {
      content: '',
      type: 'image',
      image: { width: 800, height: 600, size: '102400' },
    })

    expect(messagePreview(message)).toBe('[图片]')
  })

  it('已撤回消息返回 [已撤回]（图片消息同理）', () => {
    const recalledText = createMessage(1, '2026-10-01T10:00:00.000Z', {
      recalledAt: '2026-10-01T10:00:30.000Z',
    })
    const recalledImage = createMessage(2, '2026-10-01T10:00:00.000Z', {
      content: '',
      type: 'image',
      recalledAt: '2026-10-01T10:00:30.000Z',
      image: { width: 800, height: 600, size: '102400' },
    })

    expect(messagePreview(recalledText)).toBe('[已撤回]')
    expect(messagePreview(recalledImage)).toBe('[已撤回]')
  })
})
