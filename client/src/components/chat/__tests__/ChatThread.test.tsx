import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatThread from '../ChatThread'
import type { Conversation, Message } from '../../../types/chat'

// 头像组件会发起网络请求，测试中替换为轻量占位
vi.mock('../../UserAvatar', () => ({
  default: () => <span data-testid="avatar" />,
}))

function createMessage(overrides: Partial<Message> & { id: number }): Message {
  return {
    conversationId: 1,
    senderId: 2,
    sender: { id: 2, username: 'alice' },
    content: '你好',
    createdAt: new Date().toISOString(),
    type: 'text',
    recalledAt: null,
    image: null,
    ...overrides,
  }
}

function createConversation(overrides: Partial<Conversation> = {}): Conversation {
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
    lastMessageAt: '2026-10-01T10:00:00.000Z',
    canSend: true,
    ...overrides,
  }
}

function baseProps() {
  return {
    meId: 1,
    onBack: vi.fn(),
    onSend: vi.fn(),
    onLoadMore: vi.fn(),
    onAddMembers: vi.fn(),
    onRemoveMember: vi.fn(),
    onRename: vi.fn(),
    onDissolve: vi.fn(),
    onLeave: vi.fn(),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ChatThread', () => {
  it('已撤回消息渲染为居中系统行，不显示气泡', () => {
    const messages: Message[] = [
      createMessage({
        id: 1,
        senderId: 1,
        sender: { id: 1, username: 'me' },
        recalledAt: '2026-10-01T10:00:30.000Z',
      }),
      createMessage({ id: 2, recalledAt: '2026-10-01T10:00:30.000Z' }),
    ]

    const { container } = render(
      <ChatThread conversation={createConversation()} messages={messages} {...baseProps()} />
    )

    expect(screen.getByText('你撤回了一条消息')).toBeInTheDocument()
    expect(screen.getByText('alice 撤回了一条消息')).toBeInTheDocument()
    expect(container.querySelectorAll('.gh-chat-message-bubble')).toHaveLength(0)
    expect(container.querySelectorAll('.gh-chat-recall-line')).toHaveLength(2)
  })

  it('图片消息渲染 img（带宽高与 alt），点击可打开大图预览并用 ESC 关闭', async () => {
    const user = userEvent.setup()
    const messages: Message[] = [
      createMessage({
        id: 5,
        type: 'image',
        content: '',
        image: { width: 800, height: 600, size: '102400' },
      }),
    ]

    render(<ChatThread conversation={createConversation()} messages={messages} {...baseProps()} />)

    const img = screen.getByAltText('图片消息')
    expect(img).toHaveAttribute('width', '800')
    expect(img).toHaveAttribute('height', '600')
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img.getAttribute('src')).toContain('/chat/messages/5/image?token=')

    await user.click(screen.getByRole('button', { name: '查看大图' }))
    expect(screen.getByRole('dialog', { name: '图片预览' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '图片预览' })).not.toBeInTheDocument()
  })

  it('本人 2 分钟内的消息显示撤回按钮，确认后回调 onRecall', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onRecall = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    const messages: Message[] = [
      createMessage({ id: 9, senderId: 1, sender: { id: 1, username: 'me' }, content: '我自己' }),
    ]

    render(
      <ChatThread
        conversation={createConversation()}
        messages={messages}
        onRecall={onRecall}
        {...baseProps()}
      />
    )

    const button = screen.getByRole('button', { name: '撤回' })
    await user.click(button)

    expect(confirmSpy).toHaveBeenCalledWith('确定撤回这条消息吗？')
    expect(onRecall).toHaveBeenCalledWith(9)
  })

  it('超过 2 分钟或他人的消息不显示撤回按钮', () => {
    const messages: Message[] = [
      createMessage({
        id: 10,
        senderId: 1,
        sender: { id: 1, username: 'me' },
        createdAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
      }),
      createMessage({ id: 11 }),
    ]

    render(
      <ChatThread
        conversation={createConversation()}
        messages={messages}
        onRecall={vi.fn()}
        {...baseProps()}
      />
    )

    expect(screen.queryByRole('button', { name: '撤回' })).not.toBeInTheDocument()
  })

  it('正在输入中的中文输入法组合不会触发发送', async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()

    render(<ChatThread conversation={createConversation()} messages={[]} {...baseProps()} onSend={onSend} />)

    const textarea = screen.getByLabelText('消息输入框')
    await user.type(textarea, '你好')
    // isComposing 为 true 时按 Enter 不应发送（中文输入法确认候选词）
    fireEvent(
      textarea,
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true })
    )

    expect(onSend).not.toHaveBeenCalled()
  })
})
