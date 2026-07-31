import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

function dateStr(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() - offset)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function mockScreenTime(overrides: { today?: Partial<{ totalSeconds: number; reportedAt: string | null }>; logs?: Array<{ offset: number; totalSeconds: number }> } = {}) {
  const { today = {}, logs = [] } = overrides
  mocks.get.mockImplementation((url: string) =>
    String(url).includes('/screen-time/range')
      ? Promise.resolve({
          logs: logs.map(({ offset, totalSeconds }) => ({
            date: dateStr(offset),
            totalSeconds,
            dailyGoalSeconds: null,
          })),
        })
      : Promise.resolve({
          totalSeconds: 3665,
          date: dateStr(0),
          reportedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...today,
        }),
  )
}

function rangeParams(): URLSearchParams | null {
  const calls = mocks.get.mock.calls
  for (let i = calls.length - 1; i >= 0; i--) {
    const url = String(calls[i][0])
    if (url.includes('/screen-time/range')) {
      const query = url.split('?')[1]
      return query ? new URLSearchParams(query) : null
    }
  }
  return null
}

function heatmapCells(container: HTMLElement): NodeListOf<Element> {
  return container.querySelectorAll('.digital-health-heatmap__grid .digital-health-heatmap__cell')
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
    mockScreenTime()
    renderWithRouter(<DigitalHealthCard />)
    await waitFor(() => expect(screen.getByText(/1 小时 1 分钟/)).toBeInTheDocument())
  })

  it('无数据时显示连接引导', async () => {
    mockScreenTime({ today: { totalSeconds: 0, reportedAt: null } })
    renderWithRouter(<DigitalHealthCard />)
    await waitFor(() => expect(screen.getByText('去连接')).toBeInTheDocument())
  })

  it('默认显示月热力图并请求近 30 天数据', async () => {
    mockScreenTime()
    const { container } = renderWithRouter(<DigitalHealthCard />)
    await waitFor(() => expect(heatmapCells(container)).toHaveLength(30))

    const params = rangeParams()
    expect(params).not.toBeNull()
    expect(params!.get('to')).toBe(dateStr(0))
    expect(params!.get('from')).toBe(dateStr(29))
    expect(screen.getByRole('button', { name: '月' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '周' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('使用热力图')).toBeInTheDocument()
    expect(screen.getByText(/近 30 天电脑使用情况/)).toBeInTheDocument()
  })

  it('切换到周视图请求近 7 天数据', async () => {
    mockScreenTime()
    const { container } = renderWithRouter(<DigitalHealthCard />)
    await waitFor(() => expect(heatmapCells(container)).toHaveLength(30))

    await userEvent.click(screen.getByRole('button', { name: '周' }))
    await waitFor(() => expect(heatmapCells(container)).toHaveLength(7))

    const params = rangeParams()
    expect(params).not.toBeNull()
    expect(params!.get('to')).toBe(dateStr(0))
    expect(params!.get('from')).toBe(dateStr(6))
    expect(screen.getByRole('button', { name: '周' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/近 7 天电脑使用情况/)).toBeInTheDocument()
  })

  it('按固定阈值渲染热力图分级', async () => {
    mockScreenTime({
      logs: [
        { offset: 0, totalSeconds: 7 * 3600 },   // l4
        { offset: 1, totalSeconds: 4 * 3600 },   // l3
        { offset: 2, totalSeconds: 2 * 3600 },   // l2
        { offset: 3, totalSeconds: 1800 },       // l1
      ],
    })
    const { container } = renderWithRouter(<DigitalHealthCard />)
    await waitFor(() => expect(heatmapCells(container)).toHaveLength(30))

    const grid = container.querySelector('.digital-health-heatmap__grid')!
    expect(grid.querySelectorAll('.digital-health-heatmap__cell--l4')).toHaveLength(1)
    expect(grid.querySelectorAll('.digital-health-heatmap__cell--l3')).toHaveLength(1)
    expect(grid.querySelectorAll('.digital-health-heatmap__cell--l2')).toHaveLength(1)
    expect(grid.querySelectorAll('.digital-health-heatmap__cell--l1')).toHaveLength(1)
    expect(grid.querySelectorAll('.digital-health-heatmap__cell--l0')).toHaveLength(26)
    expect(screen.getByText(/累计 13 小时 30 分钟/)).toBeInTheDocument()
    const todayCell = grid.querySelector('.digital-health-heatmap__cell--today')!
    expect(todayCell).toHaveAttribute('title', expect.stringContaining('7 小时'))
  })

  it('无历史记录时显示累积提示', async () => {
    mockScreenTime({ today: { totalSeconds: 0, reportedAt: null } })
    const { container } = renderWithRouter(<DigitalHealthCard />)
    await waitFor(() => expect(heatmapCells(container)).toHaveLength(30))
    expect(screen.getByText(/暂无使用记录，数据将从 Time Master 首次同步起累积/)).toBeInTheDocument()
  })
})
