import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ApiDocsPage from '../ApiDocsPage'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
}))

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => mocks.useAuth(),
}))

describe('ApiDocsPage（API 接入指南）', () => {
  it('展示当前账号角色、能力清单与登录示例', () => {
    mocks.useAuth.mockReturnValue({
      user: { id: 1, username: 'admin', role: 'admin', capabilities: ['user:manage', 'content:write'] },
      isAdmin: true,
      can: (cap: string) => ['user:manage', 'content:write'].includes(cap),
    })

    render(
      <MemoryRouter>
        <ApiDocsPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('API 接入')).toBeInTheDocument()
    expect(screen.getByText('管理员')).toBeInTheDocument()
    // 已移除旧凭证的说明必须存在
    expect(screen.getByText(/API Key 与屏幕时间 Token 已移除/)).toBeInTheDocument()
    // 有能力的项显示 ✓，没有的显示 —
    expect(screen.getByText(/✓ 用户管理/)).toBeInTheDocument()
    expect(screen.getByText(/— 设备监控/)).toBeInTheDocument()
    // 登录示例包含 rememberDays
    expect(screen.getAllByText(/rememberDays/).length).toBeGreaterThan(0)
  })

  it('普通账号无任何能力时全部显示未授权', () => {
    mocks.useAuth.mockReturnValue({
      user: { id: 3, username: 'testuser', role: 'user', capabilities: [] },
      isAdmin: false,
      can: () => false,
    })

    render(
      <MemoryRouter>
        <ApiDocsPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('用户')).toBeInTheDocument()
    expect(screen.getByText(/— 用户管理/)).toBeInTheDocument()
  })
})
