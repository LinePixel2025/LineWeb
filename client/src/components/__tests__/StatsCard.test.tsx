import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import StatsCard from '../StatsCard'
import api from '../../lib/api'

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
  },
}))

const mockApi = vi.mocked(api)

describe('StatsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('加载时显示骨架屏', () => {
    mockApi.get.mockReturnValue(new Promise(() => {}))
    render(<StatsCard items={['posts', 'users']} layout="horizontal" showLabels={true} />)

    expect(document.querySelectorAll('.skeleton')).toHaveLength(4)
  })

  it('成功加载后显示数据', async () => {
    mockApi.get.mockResolvedValue({ posts: 10, users: 5, comments: 30, pages: 3 })
    render(<StatsCard items={['posts', 'users']} layout="horizontal" showLabels={true} />)

    await waitFor(() => {
      expect(screen.getByText('10')).toBeInTheDocument()
      expect(screen.getByText('5')).toBeInTheDocument()
      expect(screen.getByText('文章')).toBeInTheDocument()
      expect(screen.getByText('用户')).toBeInTheDocument()
    })
  })

  it('请求失败时显示 --', async () => {
    mockApi.get.mockRejectedValue(new Error('fail'))
    render(<StatsCard items={['posts', 'users']} layout="horizontal" showLabels={true} />)

    await waitFor(() => {
      const dashes = screen.getAllByText('--')
      expect(dashes).toHaveLength(2)
    })
  })

  it('showLabels=false 时不显示标签', async () => {
    mockApi.get.mockResolvedValue({ posts: 10, users: 5, comments: 30, pages: 3 })
    render(<StatsCard items={['posts', 'users']} layout="horizontal" showLabels={false} />)

    await waitFor(() => {
      expect(screen.getByText('10')).toBeInTheDocument()
      expect(screen.queryByText('文章')).not.toBeInTheDocument()
    })
  })

  it('grid 布局使用正确的样式', () => {
    mockApi.get.mockReturnValue(new Promise(() => {}))
    const { container } = render(<StatsCard items={['posts']} layout="grid" showLabels={true} />)

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.style.flexWrap).toBe('wrap')
  })

  it('vertical 布局使用列方向', () => {
    mockApi.get.mockReturnValue(new Promise(() => {}))
    const { container } = render(<StatsCard items={['posts']} layout="vertical" showLabels={true} />)

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.style.flexDirection).toBe('column')
  })
})
