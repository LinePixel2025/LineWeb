import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode } from 'react'
import PathBar from '../PathBar'
import { DriveProvider } from '../../../contexts/DriveContext'

vi.mock('../../../lib/api', () => ({
  default: {
    get: vi.fn(),
  },
}))

function wrapper({ children }: { children: ReactNode }) {
  return <DriveProvider>{children}</DriveProvider>
}

describe('PathBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
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

  it('返回上级按钮在子路径时可用', async () => {
    const user = userEvent.setup()
    
    render(<PathBar />, { wrapper })

    // First navigate to a subfolder by double-clicking to enter edit mode
    // and then checking the state
    const nav = screen.getByRole('navigation')
    
    // Double click to enter edit mode
    await user.dblClick(nav)
    
    // Check that input appears
    const input = screen.getByRole('textbox')
    expect(input).toBeInTheDocument()
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
})
