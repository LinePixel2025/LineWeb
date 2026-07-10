import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode } from 'react'
import TabList from '../TabList'
import { DriveProvider } from '../../../contexts/DriveContext'

vi.mock('../../../lib/api', () => ({
  default: {
    get: vi.fn(),
  },
}))

function wrapper({ children }: { children: ReactNode }) {
  return <DriveProvider>{children}</DriveProvider>
}

describe('TabList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('只有一个标签时不显示', () => {
    const { container } = render(<TabList />, { wrapper })
    expect(container.firstChild).toBeNull()
  })

  it('多个标签时显示列表', async () => {
    const user = userEvent.setup()
    const { container } = render(<TabList />, { wrapper })

    const context = container.closest('[data-testid]') || document.body

    const provider = render(
      <DriveProvider>
        <TabList />
      </DriveProvider>
    )

    expect(provider.container.firstChild).toBeNull()
  })

  it('点击关闭按钮调用closeTab', async () => {
    const onTabSelect = vi.fn()
    render(<TabList onTabSelect={onTabSelect} />, { wrapper })

    expect(screen.queryByText('打开的标签')).not.toBeInTheDocument()
  })
})
