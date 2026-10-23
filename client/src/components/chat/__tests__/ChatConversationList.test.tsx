import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatConversationList from '../ChatConversationList'
import type { Conversation, Message } from '../../../types/chat'

// 组件本身不直接请求 API，但保持与项目其他组件测试一致地隔离 api 通道
vi.mock('../../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

// 头像组件会发起网络请求，测试中替换为轻量占位
vi.mock('../../UserAvatar', () => ({
  default: () => <span data-testid="avatar" />,
}))

function createMessage(id: number, senderId: number, username: string, content: string): Message {
  return {
    id,
    conversationId: 1,
    senderId,
    sender: { id: senderId, username },
    content,
    createdAt: '2026-10-01T10:00:00.000Z',
    type: 'text',
    recalledAt: null,
    image: null,
  }
}

function createConversation(overrides: Partial<Conversation> & { id: number }): Conversation {
  return {
    type: 'direct',
    name: '',
    ownerId: 1,
    members: [
      { id: 1, username: 'me', role: 'member' },
      { id: 2, username: 'alice', role: 'member' },
    ],
    lastMessage: createMessage(overrides.id * 10, 2, 'alice', '你好呀'),
    unreadCount: 0,
    lastMessageAt: '2026-10-01T10:00:00.000Z',
    canSend: true,
    ...overrides,
  }
}

describe('ChatConversationList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('渲染会话名称、最后一条消息与未读数', () => {
    const conversations = [
      createConversation({ id: 1, unreadCount: 3 }),
      createConversation({
        id: 2,
        type: 'group',
        name: '前端小组',
        members: [
          { id: 1, username: 'me', role: 'member' },
          { id: 2, username: 'alice', role: 'owner' },
        ],
        unreadCount: 120,
        lastMessage: createMessage(20, 2, 'alice', '早上好'),
      }),
    ]

    render(<ChatConversationList conversations={conversations} activeId={null} meId={1} onSelect={vi.fn()} />)

    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('前端小组')).toBeInTheDocument()
    expect(screen.getByText('群')).toBeInTheDocument()
    expect(screen.getByLabelText('3 条未读')).toHaveTextContent('3')
    expect(screen.getByLabelText('120 条未读')).toHaveTextContent('99+')
    expect(screen.getByText('alice：早上好')).toBeInTheDocument()
  })

  it('点击会话时回调选中会话并标记当前会话', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const conversation = createConversation({ id: 7 })

    render(
      <ChatConversationList
        conversations={[conversation]}
        activeId={7}
        meId={1}
        onSelect={onSelect}
      />
    )

    const item = screen.getByRole('button', { name: /alice/ })
    expect(item).toHaveAttribute('aria-current', 'true')

    await user.click(item)

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(conversation)
  })

  it('没有会话时展示空状态', () => {
    render(<ChatConversationList conversations={[]} activeId={null} meId={1} onSelect={vi.fn()} />)

    expect(screen.getByText('还没有会话')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '会话列表' })).not.toBeInTheDocument()
  })

  it('加载中展示骨架状态且不渲染列表', () => {
    render(
      <ChatConversationList
        conversations={[createConversation({ id: 1 })]}
        activeId={null}
        meId={1}
        loading
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByText('正在加载会话…')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('图片与已撤回消息的预览使用占位文案', () => {
    const imageConversation = createConversation({
      id: 3,
      type: 'group',
      name: '图片群',
      members: [
        { id: 1, username: 'me', role: 'member' },
        { id: 2, username: 'alice', role: 'owner' },
      ],
      lastMessage: {
        ...createMessage(30, 2, 'alice', ''),
        type: 'image',
        image: { width: 800, height: 600, size: '102400' },
      },
    })
    const recalledConversation = createConversation({
      id: 4,
      lastMessage: { ...createMessage(40, 2, 'alice', ''), recalledAt: '2026-10-01T10:00:30.000Z' },
    })

    render(
      <ChatConversationList
        conversations={[imageConversation, recalledConversation]}
        activeId={null}
        meId={1}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByText('alice：[图片]')).toBeInTheDocument()
    expect(screen.getByText('[已撤回]')).toBeInTheDocument()
  })
})
