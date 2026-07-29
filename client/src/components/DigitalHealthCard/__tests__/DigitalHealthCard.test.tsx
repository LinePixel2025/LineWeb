import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DigitalHealthCard from '../DigitalHealthCard'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  useAuth: vi.fn().mockReturnValue({ user: { id: 1, username: 'test', email: 'test@example.com', role: 'user' } }),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mocks.useAuth(),
}))

vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => mocks.get(...args),
  },
}))

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('DigitalHealthCard', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.useAuth.mockReturnValue({ user: { id: 1, username: 'test', email: 'test@example.com', role: 'user' } })
  })

  it('未登录时不渲染', () => {
    mocks.useAuth.mockReturnValue({ user: null })
    const { container } = renderWithRouter(<DigitalHealthCard />)
    // 未登录时返回 null，不渲染任何内容
    expect(screen.queryByText('数字健康')).not.toBeInTheDocument()
  })

  it('显示今日屏幕时间', async () => {
    mocks.get.mockResolvedValue({ totalSeconds: 3665, date: '2026-07-14', reportedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    renderWithRouter(<DigitalHealthCard />)
    await waitFor(() => expect(screen.getByText(/1 小时 1 分钟/)).toBeInTheDocument())
  })

  it('无数据时显示连接引导', async () => {
    mocks.get.mockResolvedValue({ totalSeconds: 0, date: '2026-07-14', reportedAt: null, updatedAt: null })
    renderWithRouter(<DigitalHealthCard />)
    await waitFor(() => expect(screen.getByText('去连接')).toBeInTheDocument())
  })
})
