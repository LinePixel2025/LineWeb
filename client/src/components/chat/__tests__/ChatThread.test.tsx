import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatThread from '../ChatThread'
import type { NekoConversation, NekoMessage, NekoRoomMember } from '../../../types/chat'

const UPLOAD_ID = '0123456789abcdef01234567'

// 头像组件会发起网络请求，测试中替换为轻量占位
vi.mock('../../UserAvatar', () => ({
  default: () => <span data-testid="avatar" />,
}))

const ALICE: NekoRoomMember = {
  nekoId: 1000000000002,
  linewebId: 2,
  username: 'alice',
  displayName: 'alice',
  role: 'member',
  online: false,
  kind: 'lineweb',
}

function createMessage(overrides: Partial<NekoMessage> & { id: number }): NekoMessage {
  return {
    key: 'u1000000000002',
    from: 'alice@wlxx',
    fromUsername: 'alice',
    fromNekoId: 1000000000002,
    to: 'lw_1@wlxx',
    roomId: null,
    ts: Date.now(),
    body: '你好',
    mine: false,
    recalled: false,
    byAdmin: false,
    image: null,
    ...overrides,
  }
}

function createConversation(overrides: Partial<NekoConversation> = {}): NekoConversation {
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
      username: 'alice',
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
    ...overrides,
  }
}

function baseProps() {
  return {
    selfNekoId: 1000000000001,
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
  window.localStorage.clear()
})

describe('ChatThread', () => {
  it('已撤回消息渲染为居中系统行，不显示气泡', () => {
    const messages: NekoMessage[] = [
      createMessage({ id: 1, mine: true, recalled: true }),
      createMessage({ id: 2, recalled: true }),
    ]

    const { container } = render(
      <ChatThread conversation={createConversation()} messages={messages} {...baseProps()} />
    )

    expect(screen.getByText('你撤回了一条消息')).toBeInTheDocument()
    expect(screen.getByText('alice撤回了一条消息')).toBeInTheDocument()
    expect(container.querySelectorAll('.gh-chat-message-bubble')).toHaveLength(0)
    expect(container.querySelectorAll('.gh-chat-recall-line')).toHaveLength(2)
  })

  it('图片消息渲染带登录令牌的 neko 直链，点击可打开大图预览并用 ESC 关闭', async () => {
    window.localStorage.setItem('lineweb_token', 'tk')
    const user = userEvent.setup()
    const messages: NekoMessage[] = [
      createMessage({ id: 5, body: '[图片]', image: `/chat/uploads/${UPLOAD_ID}` }),
    ]

    render(<ChatThread conversation={createConversation()} messages={messages} {...baseProps()} />)

    const img = screen.getByAltText('图片消息')
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img.getAttribute('src')).toBe(`/chat/uploads/${UPLOAD_ID}?token=tk`)

    await user.click(screen.getByRole('button', { name: '查看大图' }))
    expect(screen.getByRole('dialog', { name: '图片预览' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '图片预览' })).not.toBeInTheDocument()
  })

  it('本人 5 分钟内的消息显示撤回按钮，确认后回调 onRecall', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onRecall = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    const messages: NekoMessage[] = [
      createMessage({ id: 9, mine: true, body: '我自己' }),
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

  it('超过 5 分钟或他人的消息不显示撤回按钮', () => {
    const messages: NekoMessage[] = [
      createMessage({ id: 10, mine: true, ts: Date.now() - 6 * 60 * 1000 }),
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

  it('群成员中标记原生 neko 账号，群主可移出其他成员', async () => {
    const user = userEvent.setup()
    const onRemoveMember = vi.fn()
    const owner = { ...ALICE, role: 'owner' }
    const nativeBob: NekoRoomMember = {
      ...ALICE,
      nekoId: 1000000000003,
      linewebId: null,
      username: 'bob',
      displayName: 'bob',
      kind: 'native',
    }
    const conversation = createConversation({
      key: 'r7',
      kind: 'room',
      title: '前端小组',
      avatarId: -7,
      contact: null,
      isFriend: true,
      room: {
        key: 'r7',
        id: 7,
        name: '前端小组',
        ownerId: 1000000000002,
        myRole: 'owner',
        allMuted: false,
        announcement: '',
        notifyMuted: false,
        lastMessageAt: 0,
        members: [owner, nativeBob],
      },
      members: [owner, nativeBob],
    })

    render(
      <ChatThread
        conversation={conversation}
        messages={[]}
        {...baseProps()}
        onRemoveMember={onRemoveMember}
      />
    )

    await user.click(screen.getByRole('button', { name: '群聊操作' }))
    await user.click(screen.getByRole('menuitem', { name: /群成员/ }))

    expect(screen.getByText('neko')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '移出' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '移出' }))
    expect(onRemoveMember).toHaveBeenCalledWith(1000000000003)
  })

  it('全员禁言的群对自己禁用输入框', () => {
    const conversation = createConversation({
      key: 'r7',
      kind: 'room',
      title: '前端小组',
      avatarId: -7,
      contact: null,
      canSend: false,
      members: [ALICE],
      room: {
        key: 'r7',
        id: 7,
        name: '前端小组',
        ownerId: 1000000000002,
        myRole: 'member',
        allMuted: true,
        announcement: '',
        notifyMuted: false,
        lastMessageAt: 0,
        members: [ALICE],
      },
    })

    render(<ChatThread conversation={conversation} messages={[]} {...baseProps()} />)

    expect(screen.getByText('全员禁言中，只有群主和管理员可以发言')).toBeInTheDocument()
    expect(screen.queryByLabelText('消息输入框')).not.toBeInTheDocument()
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
