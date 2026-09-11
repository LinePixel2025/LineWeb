import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AdminRoute } from '../Guards'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mocks.useAuth(),
}))

function renderAdmin() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<AdminRoute><div>管理内容</div></AdminRoute>} />
        <Route path="/" element={<div>首页</div>} />
        <Route path="/login" element={<div>登录页</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AdminRoute 能力守卫', () => {
  it('未登录跳转登录页', () => {
    mocks.useAuth.mockReturnValue({ user: null, loading: false, hasAdminAccess: false })
    renderAdmin()
    expect(screen.getByText('登录页')).toBeInTheDocument()
  })

  it('无能力的普通账号被挡回首页', () => {
    mocks.useAuth.mockReturnValue({
      user: { id: 3, username: 'testuser', role: 'user', capabilities: [] },
      loading: false,
      hasAdminAccess: false,
    })
    renderAdmin()
    expect(screen.getByText('首页')).toBeInTheDocument()
  })

  it('具备管理能力的账号可进入管理区', () => {
    mocks.useAuth.mockReturnValue({
      user: { id: 1, username: 'admin', role: 'admin', capabilities: ['user:manage'] },
      loading: false,
      hasAdminAccess: true,
    })
    renderAdmin()
    expect(screen.getByText('管理内容')).toBeInTheDocument()
  })
})
