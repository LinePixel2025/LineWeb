import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import Toolbar from '../Toolbar'
import { DriveProvider } from '../../../contexts/DriveContext'

// Mock the DriveContext
vi.mock('../../../contexts/DriveContext', () => ({
  useDrive: () => ({
    state: { viewMode: 'list' },
    setViewMode: vi.fn(),
  }),
  DriveProvider: ({ children }: { children: React.ReactNode }) => children,
}))

describe('Toolbar', () => {
  it('renders toolbar with action buttons', () => {
    render(
      <DriveProvider>
        <Toolbar />
      </DriveProvider>
    )
    
    expect(screen.getByText('📁 新建')).toBeInTheDocument()
    expect(screen.getByText('⬆ 上传')).toBeInTheDocument()
    expect(screen.getByText('🔄 同步')).toBeInTheDocument()
  })

  it('calls onNewFolder when new folder button is clicked', () => {
    const onNewFolder = vi.fn()
    render(
      <DriveProvider>
        <Toolbar onNewFolder={onNewFolder} />
      </DriveProvider>
    )
    
    fireEvent.click(screen.getByText('📁 新建'))
    expect(onNewFolder).toHaveBeenCalledTimes(1)
  })

  it('calls onUpload when upload button is clicked', () => {
    const onUpload = vi.fn()
    render(
      <DriveProvider>
        <Toolbar onUpload={onUpload} />
      </DriveProvider>
    )
    
    fireEvent.click(screen.getByText('⬆ 上传'))
    expect(onUpload).toHaveBeenCalledTimes(1)
  })

  it('calls onSync when sync button is clicked', () => {
    const onSync = vi.fn()
    render(
      <DriveProvider>
        <Toolbar onSync={onSync} />
      </DriveProvider>
    )
    
    fireEvent.click(screen.getByText('🔄 同步'))
    expect(onSync).toHaveBeenCalledTimes(1)
  })

  it('disables sync button when syncing is true', () => {
    render(
      <DriveProvider>
        <Toolbar syncing={true} />
      </DriveProvider>
    )
    
    const syncButton = screen.getByText('🔄 同步中...')
    expect(syncButton).toBeDisabled()
  })

  it('renders view toggle button', () => {
    render(
      <DriveProvider>
        <Toolbar />
      </DriveProvider>
    )
    
    expect(screen.getByTitle('切换为网格视图')).toBeInTheDocument()
  })
})
