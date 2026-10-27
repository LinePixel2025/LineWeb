import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatConversationList from '../ChatConversationList'
import type { NekoConversation, NekoMessage, NekoRoomMember } from '../../../types/chat'

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

const ALICE: NekoRoomMember = {
  nekoId: 1000000000002,
  linewebId: 2,
  username: 'lw_2',
  displayName: 'alice',
  role: 'member',
  online: false,
  kind: 'lineweb',
}

function createMessage(
  id: number,
  body: string,
  extra: Partial<NekoMessage> = {},
): NekoMessage {
  return {
    id,
    key: 'u1000000000002',
    from: 'lw_2@wlxx',
    fromUsername: 'lw_2',
    fromNekoId: 1000000000002,
    to: 'lw_1@wlxx',
    roomId: null,
    ts: Date.parse('2026-10-01T10:00:00.000Z'),
    body,
    mine: false,
    recalled: false,
    byAdmin: false,
    image: null,
    ...extra,
  }
}

function createConversation(overrides: Partial<NekoConversation> & { key: string }): NekoConversation {
  return {
    kind: 'direct',
    title: 'alice',
    avatarId: 2,
    avatarName: 'alice',
    contact: null,
    room: null,
    lastMessage: createMessage(Number.parseInt(overrides.key.replace(/\D/g, ''), 10) * 10, '你好呀'),
    lastMessageAt: Date.parse('2026-10-01T10:00:00.000Z'),
    unread: 0,
    pinned: false,
    online: false,
    members: [],
    isFriend: true,
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
      createConversation({ key: 'u1000000000002', unread: 3 }),
      createConversation({
        key: 'r7',
        kind: 'room',
        title: '前端小组',
        avatarId: -7,
        members: [ALICE],
        unread: 120,
        lastMessage: createMessage(20, '早上好', { roomId: 7 }),
      }),
    ]

    render(<ChatConversationList conversations={conversations} activeKey={null} onSelect={vi.fn()} />)

    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('前端小组')).toBeInTheDocument()
    expect(screen.getByText('群')).toBeInTheDocument()
    expect(screen.getByLabelText('3 条未读')).toHaveTextContent('3')
    expect(screen.getByLabelText('120 条未读')).toHaveTextContent('99+')
    expect(screen.getByText('alice：早上好')).toBeInTheDocument()
  })

  it('在线私聊渲染在线小圆点', () => {
    render(
      <ChatConversationList
        conversations={[createConversation({ key: 'u1000000000002', online: true })]}
        activeKey={null}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByLabelText('在线')).toBeInTheDocument()
  })

  it('点击会话时回调选中会话并标记当前会话', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const conversation = createConversation({ key: 'u1000000000007' })

    render(
      <ChatConversationList
        conversations={[conversation]}
        activeKey="u1000000000007"
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
    render(<ChatConversationList conversations={[]} activeKey={null} onSelect={vi.fn()} />)

    expect(screen.getByText('还没有会话')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '会话列表' })).not.toBeInTheDocument()
  })

  it('加载中展示骨架状态且不渲染列表', () => {
    render(
      <ChatConversationList
        conversations={[createConversation({ key: 'u1000000000002' })]}
        activeKey={null}
        loading
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByText('正在加载会话…')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('错误状态优先于空列表', () => {
    render(
      <ChatConversationList conversations={[]} activeKey={null} error="聊天服务暂时不可用" onSelect={vi.fn()} />
    )

    expect(screen.getByText('聊天服务暂时不可用')).toBeInTheDocument()
  })

  it('图片与已撤回消息的预览使用占位文案', () => {
    const imageConversation = createConversation({
      key: 'r8',
      kind: 'room',
      title: '图片群',
      avatarId: -8,
      members: [ALICE],
      lastMessage: createMessage(30, '[图片]', { roomId: 8, image: '/chat/uploads/0123456789abcdef01234567' }),
    })
    const recalledConversation = createConversation({
      key: 'u1000000000004',
      lastMessage: createMessage(40, '', { recalled: true }),
    })

    render(
      <ChatConversationList
        conversations={[imageConversation, recalledConversation]}
        activeKey={null}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByText('alice：[图片]')).toBeInTheDocument()
    expect(screen.getByText('[已撤回]')).toBeInTheDocument()
  })
})
