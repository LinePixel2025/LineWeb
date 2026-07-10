import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import BatchActions from '../BatchActions'

vi.mock('../../../contexts/DriveContext', () => ({
  useDrive: vi.fn(),
}))

import { useDrive } from '../../../contexts/DriveContext'
const mockUseDrive = vi.mocked(useDrive)

function setupDriveState(selectedFiles: number[] = []) {
  mockUseDrive.mockReturnValue({
    state: { selectedFiles },
    clearSelection: vi.fn(),
  } as unknown as ReturnType<typeof useDrive>)
}

describe('BatchActions', () => {
  it('does not render when no files are selected', () => {
    setupDriveState([])
    const { container } = render(<BatchActions />)
    expect(container.firstChild).toBeNull()
  })

  it('renders when files are selected', () => {
    setupDriveState([1, 2])
    render(<BatchActions />)
    expect(screen.getByText('已选择 2 个文件')).toBeInTheDocument()
  })

  it('shows correct count for single selection', () => {
    setupDriveState([42])
    render(<BatchActions />)
    expect(screen.getByText('已选择 1 个文件')).toBeInTheDocument()
  })

  it('calls onClearSelection when clear button is clicked', () => {
    setupDriveState([1])
    const onClearSelection = vi.fn()
    render(<BatchActions onClearSelection={onClearSelection} />)
    fireEvent.click(screen.getByText('取消选择'))
    expect(onClearSelection).toHaveBeenCalledTimes(1)
  })

  it('calls onBatchDownload when download button is clicked', () => {
    setupDriveState([1])
    const onBatchDownload = vi.fn()
    render(<BatchActions onBatchDownload={onBatchDownload} />)
    fireEvent.click(screen.getByText('⬇ 批量下载'))
    expect(onBatchDownload).toHaveBeenCalledTimes(1)
  })

  it('calls onBatchMove when move button is clicked', () => {
    setupDriveState([1])
    const onBatchMove = vi.fn()
    render(<BatchActions onBatchMove={onBatchMove} />)
    fireEvent.click(screen.getByText('📁 移动到'))
    expect(onBatchMove).toHaveBeenCalledTimes(1)
  })

  it('calls onBatchDelete when delete button is clicked', () => {
    setupDriveState([1])
    const onBatchDelete = vi.fn()
    render(<BatchActions onBatchDelete={onBatchDelete} />)
    fireEvent.click(screen.getByText('🗑️ 删除'))
    expect(onBatchDelete).toHaveBeenCalledTimes(1)
  })

  it('calls onBatchFavorite when favorite button is clicked', () => {
    setupDriveState([1])
    const onBatchFavorite = vi.fn()
    render(<BatchActions onBatchFavorite={onBatchFavorite} />)
    fireEvent.click(screen.getByText('⭐ 收藏'))
    expect(onBatchFavorite).toHaveBeenCalledTimes(1)
  })

  it('renders all action buttons', () => {
    setupDriveState([1, 2, 3])
    render(<BatchActions />)
    expect(screen.getByText('⬇ 批量下载')).toBeInTheDocument()
    expect(screen.getByText('📁 移动到')).toBeInTheDocument()
    expect(screen.getByText('⭐ 收藏')).toBeInTheDocument()
    expect(screen.getByText('🗑️ 删除')).toBeInTheDocument()
  })
})
