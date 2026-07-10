import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode } from 'react'
import TreeView from '../TreeView'
import { DriveProvider } from '../../../contexts/DriveContext'

vi.mock('../../../lib/api', () => ({
  default: {
    get: vi.fn(),
  },
}))

import api from '../../../lib/api'

function wrapper({ children }: { children: ReactNode }) {
  return <DriveProvider>{children}</DriveProvider>
}

describe('TreeView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('渲染根节点', () => {
    render(<TreeView />, { wrapper })

    expect(screen.getByText('根目录')).toBeInTheDocument()
    expect(screen.getByText('📁')).toBeInTheDocument()
  })

  it('点击展开按钮加载子节点', async () => {
    const user = userEvent.setup()
    const mockFolders = [
      { id: 1, name: '文档', isFolder: true, parentId: null, size: '0', mimeType: null, createdAt: '', updatedAt: '' },
      { id: 2, name: '图片', isFolder: true, parentId: null, size: '0', mimeType: null, createdAt: '', updatedAt: '' },
      { id: 3, name: 'file.txt', isFolder: false, parentId: null, size: '100', mimeType: 'text/plain', createdAt: '', updatedAt: '' },
    ]

    vi.mocked(api.get).mockResolvedValueOnce({ data: mockFolders })

    render(<TreeView />, { wrapper })

    const expandButton = screen.getByText('▼')
    await user.click(expandButton)

    await waitFor(() => {
      expect(screen.getByText('文档')).toBeInTheDocument()
      expect(screen.getByText('图片')).toBeInTheDocument()
    })

    expect(api.get).toHaveBeenCalledWith('/drive/files?limit=100')
  })

  it('点击文件夹调用onFolderSelect', async () => {
    const user = userEvent.setup()
    const onFolderSelect = vi.fn()
    const mockFolders = [
      { id: 1, name: '文档', isFolder: true, parentId: null, size: '0', mimeType: null, createdAt: '', updatedAt: '' },
    ]

    vi.mocked(api.get).mockResolvedValueOnce({ data: mockFolders })

    render(<TreeView onFolderSelect={onFolderSelect} />, { wrapper })

    const expandButton = screen.getByText('▼')
    await user.click(expandButton)

    await waitFor(() => {
      expect(screen.getByText('文档')).toBeInTheDocument()
    })

    const folderLabel = screen.getByText('文档').closest('.tree-node-label')!
    await user.click(folderLabel)

    expect(onFolderSelect).toHaveBeenCalledWith(1, '文档')
  })
})
