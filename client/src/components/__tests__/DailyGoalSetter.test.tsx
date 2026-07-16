import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import DailyGoalSetter from '../DailyGoalSetter'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => mocks.get(...args),
    put: (...args: unknown[]) => mocks.put(...args),
  },
}))

describe('DailyGoalSetter', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.put.mockReset()
  })

  it('加载中显示加载文本', async () => {
    mocks.get.mockImplementation(() => new Promise(() => {})) // 永不 resolve
    render(<DailyGoalSetter />)
    expect(screen.getByText('加载中…')).toBeInTheDocument()
  })

  it('未设置目标时显示输入框和保存按钮', async () => {
    mocks.get.mockResolvedValue({ dailyGoalSeconds: null, date: '2026-07-17' })
    render(<DailyGoalSetter />)
    await waitFor(() => {
      expect(screen.getByText('今日使用目标')).toBeInTheDocument()
      expect(screen.getByText('小时')).toBeInTheDocument()
      expect(screen.getByText('分钟')).toBeInTheDocument()
      expect(screen.getByText('保存目标')).toBeInTheDocument()
    })
    // 清除按钮不应出现
    expect(screen.queryByText('清除目标')).not.toBeInTheDocument()
  })

  it('已设置目标时显示当前目标和清除按钮', async () => {
    mocks.get.mockResolvedValue({ dailyGoalSeconds: 7200, date: '2026-07-17' })
    render(<DailyGoalSetter />)
    await waitFor(() => {
      expect(screen.getByText('当前目标：2 小时')).toBeInTheDocument()
      expect(screen.getByText('清除目标')).toBeInTheDocument()
    })
  })

  it('保存按钮调用 PUT 并显示成功', async () => {
    mocks.get.mockResolvedValue({ dailyGoalSeconds: null, date: '2026-07-17' })
    mocks.put.mockResolvedValue({ dailyGoalSeconds: 3600, date: '2026-07-17' })
    render(<DailyGoalSetter />)

    await waitFor(() => expect(screen.getByText('保存目标')).toBeInTheDocument())

    // 小时和分钟输入初始值都是 0，使用 getAllByDisplayValue 获取第一个（小时）
    const [hourInput] = screen.getAllByDisplayValue('0')
    fireEvent.change(hourInput, { target: { value: '1' } })

    fireEvent.click(screen.getByText('保存目标'))

    await waitFor(() => {
      expect(mocks.put).toHaveBeenCalledWith('/health/daily-goal', { goalSeconds: 3600 })
      expect(screen.getByText('✓ 已保存')).toBeInTheDocument()
    })
  })

  it('清除按钮调用 PUT 并清除目标', async () => {
    mocks.get.mockResolvedValue({ dailyGoalSeconds: 3600, date: '2026-07-17' })
    mocks.put.mockResolvedValue({ dailyGoalSeconds: null, date: '2026-07-17' })
    render(<DailyGoalSetter />)

    await waitFor(() => expect(screen.getByText('清除目标')).toBeInTheDocument())

    fireEvent.click(screen.getByText('清除目标'))

    await waitFor(() => {
      expect(mocks.put).toHaveBeenCalledWith('/health/daily-goal', { goalSeconds: null })
      expect(screen.getByText('✓ 已保存')).toBeInTheDocument()
    })
  })

  it('加载失败时显示错误', async () => {
    mocks.get.mockRejectedValue(new Error('网络错误'))
    render(<DailyGoalSetter />)
    await waitFor(() => {
      expect(screen.getByText('网络错误')).toBeInTheDocument()
    })
  })
})
