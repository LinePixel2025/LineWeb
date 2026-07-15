import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ContextMenu from '../ContextMenu'
import type { DriveItem } from '../../../types/drive'

vi.mock('../../../contexts/DriveContext', () => ({
  useDrive: vi.fn(),
  DriveProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import { useDrive } from '../../../contexts/DriveContext'
const mockUseDrive = vi.mocked(useDrive)

function setupDriveState() {
  mockUseDrive.mockReturnValue({
    state: { favorites: [], selectedFiles: [] },
    addFavorite: vi.fn(),
    removeFavorite: vi.fn(),
  } as unknown as ReturnType<typeof useDrive>)
}

const mockFileItem: DriveItem = {
  id: 1,
  name: 'test-file.jpg',
  isFolder: false,
  parentId: null,
  size: '1024',
  mimeType: 'image/jpeg',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
}

const mockFolderItem: DriveItem = {
  id: 2,
  name: 'test-folder',
  isFolder: true,
  parentId: null,
  size: '0',
  mimeType: null,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
}

describe('ContextMenu', () => {
  beforeEach(() => {
    setupDriveState()
  })

  it('渲染文件菜单', () => {
    const onClose = vi.fn()
    render(
      <ContextMenu
        item={mockFileItem}
        position={{ x: 100, y: 100 }}
        onClose={onClose}
      />
    )

    expect(screen.getByText('test-file.jpg')).toBeInTheDocument()
    expect(screen.getByText('预览')).toBeInTheDocument()
    expect(screen.getByText('下载')).toBeInTheDocument()
    expect(screen.getByText('重命名')).toBeInTheDocument()
    expect(screen.getByText('删除')).toBeInTheDocument()
  })

  it('渲染文件夹菜单', () => {
    const onClose = vi.fn()
    render(
      <ContextMenu
        item={mockFolderItem}
        position={{ x: 100, y: 100 }}
        onClose={onClose}
      />
    )

    expect(screen.getByText('test-folder')).toBeInTheDocument()
    expect(screen.getByText('打开文件夹')).toBeInTheDocument()
    expect(screen.getByText('重命名')).toBeInTheDocument()
    expect(screen.getByText('删除')).toBeInTheDocument()
    expect(screen.queryByText('下载')).not.toBeInTheDocument()
  })

  it('渲染空白区域菜单', () => {
    const onClose = vi.fn()
    render(
      <ContextMenu
        position={{ x: 100, y: 100 }}
        onClose={onClose}
      />
    )

    expect(screen.getByText('新建文件夹')).toBeInTheDocument()
    expect(screen.getByText('上传文件')).toBeInTheDocument()
    expect(screen.getByText('刷新')).toBeInTheDocument()
    expect(screen.getByText('全选')).toBeInTheDocument()
  })

  it('点击菜单项调用相应函数', () => {
    const onClose = vi.fn()
    const onDownload = vi.fn()
    render(
      <ContextMenu
        item={mockFileItem}
        position={{ x: 100, y: 100 }}
        onClose={onClose}
        onDownload={onDownload}
      />
    )

    fireEvent.click(screen.getByText('下载'))
    expect(onDownload).toHaveBeenCalledWith(mockFileItem)
    expect(onClose).toHaveBeenCalled()
  })

  it('按Escape键关闭菜单', () => {
    const onClose = vi.fn()
    render(
      <ContextMenu
        item={mockFileItem}
        position={{ x: 100, y: 100 }}
        onClose={onClose}
      />
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('点击外部关闭菜单', () => {
    const onClose = vi.fn()
    render(
      <ContextMenu
        item={mockFileItem}
        position={{ x: 100, y: 100 }}
        onClose={onClose}
      />
    )

    fireEvent.click(document)
    expect(onClose).toHaveBeenCalled()
  })

  it('点击空白区域菜单项调用相应函数', () => {
    const onClose = vi.fn()
    const onNewFolder = vi.fn()
    render(
      <ContextMenu
        position={{ x: 100, y: 100 }}
        onClose={onClose}
        onNewFolder={onNewFolder}
      />
    )

    fireEvent.click(screen.getByText('新建文件夹'))
    expect(onNewFolder).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('非预览able文件不显示预览选项', () => {
    const onClose = vi.fn()
    const nonPreviewableFile: DriveItem = {
      ...mockFileItem,
      name: 'test-file.txt',
      mimeType: 'text/plain',
    }
    render(
      <ContextMenu
        item={nonPreviewableFile}
        position={{ x: 100, y: 100 }}
        onClose={onClose}
      />
    )

    expect(screen.queryByText('预览')).not.toBeInTheDocument()
    expect(screen.getByText('下载')).toBeInTheDocument()
  })
})
