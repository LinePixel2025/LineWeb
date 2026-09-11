import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom'
import { AdminRoute, AdminCapabilityRoute } from '../Guards'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mocks.useAuth(),
}))

function renderAdmin(initialPath = '/admin') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/admin" element={<AdminRoute><div>管理外壳</div></AdminRoute>} />
        <Route path="/" element={<div>首页</div>} />
        <Route path="/login" element={<div>登录页</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

/** 模拟真实结构：AdminRoute(入口) → AdminCapabilityRoute + Outlet（AdminLayout 的落点） */
function renderAdminPage(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          element={
            <AdminRoute>
              <AdminCapabilityRoute>
                <Outlet />
              </AdminCapabilityRoute>
            </AdminRoute>
          }
        >
          <Route path="/admin" element={<div>文章管理页</div>} />
          <Route path="/admin/users" element={<div>用户管理页</div>} />
          <Route path="/admin/devices" element={<div>设备监控页</div>} />
          <Route path="/admin/api" element={<div>API 接入页</div>} />
        </Route>
        <Route path="/" element={<div>首页</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const adminUser = { id: 1, username: 'admin', role: 'admin', capabilities: ['content:write', 'user:manage', 'device:view'] }
const deviceOnlyUser = { id: 5, username: 'ops', role: 'user', capabilities: ['device:view'] }
const plainUser = { id: 3, username: 'testuser', role: 'user', capabilities: [] }

describe('AdminRoute 能力守卫（管理区入口）', () => {
  it('未登录跳转登录页', () => {
    mocks.useAuth.mockReturnValue({ user: null, loading: false, hasAdminAccess: false })
    renderAdmin()
    expect(screen.getByText('登录页')).toBeInTheDocument()
  })

  it('无能力的普通账号被挡回首页', () => {
    mocks.useAuth.mockReturnValue({ user: plainUser, loading: false, hasAdminAccess: false })
    renderAdmin()
    expect(screen.getByText('首页')).toBeInTheDocument()
  })

  it('具备管理能力的账号可进入管理区', () => {
    mocks.useAuth.mockReturnValue({ user: adminUser, loading: false, hasAdminAccess: true })
    renderAdmin()
    expect(screen.getByText('管理外壳')).toBeInTheDocument()
  })
})

describe('AdminCapabilityRoute 按路径能力守卫', () => {
  it('admin 可访问任意管理页', () => {
    mocks.useAuth.mockReturnValue({ user: adminUser, loading: false, hasAdminAccess: true })
    renderAdminPage('/admin/users')
    expect(screen.getByText('用户管理页')).toBeInTheDocument()
  })

  it('只有 device:view 的账号直达 /admin（文章管理）会被送到有权的页面', () => {
    mocks.useAuth.mockReturnValue({ user: deviceOnlyUser, loading: false, hasAdminAccess: true })
    renderAdminPage('/admin')
    expect(screen.getByText('设备监控页')).toBeInTheDocument()
    expect(screen.queryByText('文章管理页')).not.toBeInTheDocument()
  })

  it('只有 device:view 的账号直达 /admin/users 同样被送回有权的页面', () => {
    mocks.useAuth.mockReturnValue({ user: deviceOnlyUser, loading: false, hasAdminAccess: true })
    renderAdminPage('/admin/users')
    expect(screen.getByText('设备监控页')).toBeInTheDocument()
  })

  it('无能力项的 /admin/api 对任何管理区账号开放', () => {
    mocks.useAuth.mockReturnValue({ user: deviceOnlyUser, loading: false, hasAdminAccess: true })
    renderAdminPage('/admin/api')
    expect(screen.getByText('API 接入页')).toBeInTheDocument()
  })

  it('没有任何可用管理页时不会死循环，回落主站', () => {
    mocks.useAuth.mockReturnValue({ user: plainUser, loading: false, hasAdminAccess: false })
    renderAdminPage('/admin/users')
    expect(screen.getByText('首页')).toBeInTheDocument()
  })
})
