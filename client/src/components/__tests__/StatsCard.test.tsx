import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { type ReactNode } from 'react'
import StatsCard from '../StatsCard'
import api from '../../lib/api'
import { AuthProvider } from '../../contexts/AuthContext'

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn() },
}))

const mockApi = vi.mocked(api)

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      {children}
    </AuthProvider>
  )
}

describe('StatsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.get.mockImplementation((path: unknown) => {
      if (path === '/auth/me') return Promise.resolve({ id: 1, username: 'test', email: 't@t.com', role: 'user' })
      return undefined as any
    })
  })

  it('加载时显示骨架屏', () => {
    mockApi.get.mockReturnValue(new Promise(() => {}))
    render(<StatsCard items={['posts', 'users']} layout="horizontal" showLabels={true} />, { wrapper: Wrapper })
    expect(document.querySelectorAll('.skeleton')).toHaveLength(4)
  })

  it('成功加载后显示数据', async () => {
    mockApi.get.mockImplementation((path: unknown) => {
      if (path === '/auth/me') return Promise.resolve({ id: 1, username: 'test', email: 't@t.com', role: 'user' })
      return Promise.resolve({ posts: 10, users: 5, comments: 30, pages: 3 })
    })
    render(<StatsCard items={['posts', 'users']} layout="horizontal" showLabels={true} />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(screen.getByText('10')).toBeInTheDocument()
      expect(screen.getByText('5')).toBeInTheDocument()
      expect(screen.getByText('文章')).toBeInTheDocument()
      expect(screen.getByText('用户')).toBeInTheDocument()
    })
  })

  it('请求失败时显示 --', async () => {
    mockApi.get.mockImplementation((path: unknown) => {
      if (path === '/auth/me') return Promise.resolve({ id: 1, username: 'test', email: 't@t.com', role: 'user' })
      return Promise.reject(new Error('fail'))
    })
    render(<StatsCard items={['posts', 'users']} layout="horizontal" showLabels={true} />, { wrapper: Wrapper })

    await waitFor(() => {
      const dashes = screen.getAllByText('--')
      expect(dashes).toHaveLength(2)
    })
  })

  it('showLabels=false 时不显示标签', async () => {
    mockApi.get.mockImplementation((path: unknown) => {
      if (path === '/auth/me') return Promise.resolve({ id: 1, username: 'test', email: 't@t.com', role: 'user' })
      return Promise.resolve({ posts: 10, users: 5, comments: 30, pages: 3 })
    })
    render(<StatsCard items={['posts', 'users']} layout="horizontal" showLabels={false} />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(screen.getByText('10')).toBeInTheDocument()
      expect(screen.queryByText('文章')).not.toBeInTheDocument()
    })
  })

  it('grid 布局使用正确的样式', () => {
    mockApi.get.mockReturnValue(new Promise(() => {}))
    const { container } = render(<StatsCard items={['posts']} layout="grid" showLabels={true} />, { wrapper: Wrapper })

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.style.flexWrap).toBe('wrap')
  })

  it('vertical 布局使用列方向', () => {
    mockApi.get.mockReturnValue(new Promise(() => {}))
    const { container } = render(<StatsCard items={['posts']} layout="vertical" showLabels={true} />, { wrapper: Wrapper })

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.style.flexDirection).toBe('column')
  })
})
