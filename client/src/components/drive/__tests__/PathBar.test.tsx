import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode } from 'react'
import PathBar from '../PathBar'
import { DriveProvider } from '../../../contexts/DriveContext'
import api from '../../../lib/api'

const mockGet = vi.fn()

vi.mock('../../../lib/api', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}))

function wrapper({ children }: { children: ReactNode }) {
  return <DriveProvider>{children}</DriveProvider>
}

describe('PathBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockGet.mockReset()
  })

  it('渲染根路径', () => {
    render(<PathBar />, { wrapper })

    expect(screen.getByText('根目录')).toBeInTheDocument()
  })

  it('返回上级按钮在根路径时禁用', () => {
    render(<PathBar />, { wrapper })

    const backButton = screen.getByTitle('返回上级')
    expect(backButton).toBeDisabled()
  })

  it('双击进入编辑模式', async () => {
    const user = userEvent.setup()
    
    render(<PathBar />, { wrapper })

    const nav = screen.getByRole('navigation')
    await user.dblClick(nav)

    const input = screen.getByRole('textbox')
    expect(input).toBeInTheDocument()
    expect(input).toHaveValue('根目录')
  })

  it('Escape键取消编辑', async () => {
    const user = userEvent.setup()
    
    render(<PathBar />, { wrapper })

    const nav = screen.getByRole('navigation')
    await user.dblClick(nav)

    const input = screen.getByRole('textbox')
    await user.keyboard('{Escape}')

    expect(input).not.toBeInTheDocument()
    expect(screen.getByText('根目录')).toBeInTheDocument()
  })

  it('Enter键提交编辑并导航', async () => {
    const user = userEvent.setup()
    mockGet.mockResolvedValueOnce([
      { id: null, name: '根目录' },
      { id: 1, name: 'documents' },
    ])

    render(<PathBar />, { wrapper })

    const nav = screen.getByRole('navigation')
    await user.dblClick(nav)

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, '根目录/documents')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/drive/resolve-path?path=')
      )
    })

    await waitFor(() => {
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })
  })

  it('编辑模式提交失败时保持编辑状态', async () => {
    const user = userEvent.setup()
    mockGet.mockRejectedValueOnce(new Error('Not found'))

    render(<PathBar />, { wrapper })

    const nav = screen.getByRole('navigation')
    await user.dblClick(nav)

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, '根目录/nonexistent')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })
  })

  it('空白输入提交时关闭编辑模式', async () => {
    const user = userEvent.setup()

    render(<PathBar />, { wrapper })

    const nav = screen.getByRole('navigation')
    await user.dblClick(nav)

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })
  })
})
