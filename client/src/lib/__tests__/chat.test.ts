import { afterEach, describe, expect, it, vi } from 'vitest'
import { displayName, formatUnread, getChatWsUrl, mergeMessages } from '../chat'
import type { Conversation, Message } from '../../types/chat'

function createMessage(id: number, createdAt: string, extra: Partial<Message> = {}): Message {
  return {
    id,
    conversationId: 1,
    senderId: 2,
    sender: { id: 2, username: 'alice' },
    content: `消息 ${id}`,
    createdAt,
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
