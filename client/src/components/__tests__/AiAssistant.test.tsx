import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AiAssistant from '../AiAssistant'
import api from '../../lib/api'

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)

describe('AiAssistant', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockedApi.get.mockResolvedValue({ enabled: true })
    mockedApi.post.mockResolvedValue({ reply: '这是一个测试回复。', model: 'test-model' })
    Element.prototype.scrollIntoView = vi.fn()
    window.requestAnimationFrame = callback => {
      callback(0)
      return 0
    }
  })

  it('提供建议问题并允许清空对话', async () => {
    const user = userEvent.setup()
    render(<AiAssistant />)

    const openButton = await screen.findByRole('button', { name: '打开 AI 助手' })
    await user.click(openButton)

    const suggestion = screen.getByRole('button', { name: '这个网站有哪些功能？' })
    await user.click(suggestion)

    const input = screen.getByLabelText('向 LineWeb AI 提问')
    expect(input).toHaveValue('这个网站有哪些功能？')

    await user.click(screen.getByRole('button', { name: '发送消息' }))

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith('/ai/chat', {
      message: '这个网站有哪些功能？',
      history: [],
    }))
    expect(await screen.findByText('这是一个测试回复。')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '清空对话' }))
    expect(screen.getByText('想了解 LineWeb 的什么？')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '清空对话' })).not.toBeInTheDocument()
  })

  it('提供新增的信息类建议问题', async () => {
    const user = userEvent.setup()
    render(<AiAssistant />)

    const openButton = await screen.findByRole('button', { name: '打开 AI 助手' })
    await user.click(openButton)

    const suggestion = screen.getByRole('button', { name: '这个网站最近有哪些评论？' })
    await user.click(suggestion)

    const input = screen.getByLabelText('向 LineWeb AI 提问')
    expect(input).toHaveValue('这个网站最近有哪些评论？')

    await user.click(screen.getByRole('button', { name: '发送消息' }))

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith('/ai/chat', {
      message: '这个网站最近有哪些评论？',
      history: [],
    }))
  })

  it('按 Escape 关闭面板并把焦点还给入口', async () => {
    const user = userEvent.setup()
    render(<AiAssistant />)

    const openButton = await screen.findByRole('button', { name: '打开 AI 助手' })
    await user.click(openButton)
    expect(screen.getByRole('dialog', { name: 'LineWeb AI 助手' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'LineWeb AI 助手' })).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: '打开 AI 助手' })).toHaveFocus())
  })
})
