import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { type ReactNode } from 'react'
import { DriveProvider, useDrive } from '../DriveContext'

function wrapper({ children }: { children: ReactNode }) {
  return <DriveProvider>{children}</DriveProvider>
}

describe('DriveContext', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('初始化默认状态', () => {
    const { result } = renderHook(() => useDrive(), { wrapper })

    expect(result.current.state.currentPath).toEqual([{ id: null, name: '根目录' }])
    expect(result.current.state.tabs).toHaveLength(1)
    expect(result.current.state.tabs[0].folderName).toBe('根目录')
    expect(result.current.state.activeTabId).toBe(result.current.state.tabs[0].id)
    expect(result.current.state.selectedFiles).toEqual([])
    expect(result.current.state.favorites).toEqual([])
    expect(result.current.state.viewMode).toBe('list')
    expect(result.current.state.sort).toEqual({ field: 'name', direction: 'asc' })
    expect(result.current.state.categoryFilter).toBe('all')
    expect(result.current.state.searchQuery).toBe('')
    expect(result.current.state.searchResults).toBeNull()
    expect(result.current.state.searching).toBe(false)
  })

  it('导航到文件夹', () => {
    const { result } = renderHook(() => useDrive(), { wrapper })

    act(() => {
      result.current.navigateToFolder(42, '我的文档')
    })

    expect(result.current.state.currentPath).toEqual([
      { id: null, name: '根目录' },
      { id: 42, name: '我的文档' },
    ])
    expect(result.current.state.selectedFiles).toEqual([])
  })

  it('导航到面包屑', () => {
    const { result } = renderHook(() => useDrive(), { wrapper })

    act(() => {
      result.current.navigateToFolder(42, '我的文档')
    })
    act(() => {
      result.current.navigateToFolder(99, '子文件夹')
    })

    expect(result.current.state.currentPath).toHaveLength(3)

    act(() => {
      result.current.navigateToBreadcrumb(0)
    })

    expect(result.current.state.currentPath).toEqual([{ id: null, name: '根目录' }])
  })

  it('打开新标签页', () => {
    const { result } = renderHook(() => useDrive(), { wrapper })

    act(() => {
      result.current.openTab(10, '项目文件')
    })

    expect(result.current.state.tabs).toHaveLength(2)
    expect(result.current.state.tabs[1].folderName).toBe('项目文件')
    expect(result.current.state.tabs[1].folderId).toBe(10)
    expect(result.current.state.activeTabId).toBe(result.current.state.tabs[1].id)
    expect(result.current.state.currentPath).toEqual([
      { id: null, name: '根目录' },
      { id: 10, name: '项目文件' },
    ])
  })

  it('关闭标签页', () => {
    const { result } = renderHook(() => useDrive(), { wrapper })

    act(() => {
      result.current.openTab(10, '项目文件')
    })

    const tabToClose = result.current.state.tabs[1].id

    act(() => {
      result.current.closeTab(tabToClose)
    })

    expect(result.current.state.tabs).toHaveLength(1)
    expect(result.current.state.tabs[0].folderName).toBe('根目录')
  })

  it('关闭所有标签页时自动创建默认标签', () => {
    const { result } = renderHook(() => useDrive(), { wrapper })

    const firstTabId = result.current.state.tabs[0].id

    act(() => {
      result.current.closeTab(firstTabId)
    })

    expect(result.current.state.tabs).toHaveLength(1)
    expect(result.current.state.tabs[0].folderName).toBe('根目录')
  })

  it('切换活动标签', () => {
    const { result } = renderHook(() => useDrive(), { wrapper })

    act(() => {
      result.current.openTab(10, '项目文件')
    })

    const firstTabId = result.current.state.tabs[0].id

    act(() => {
      result.current.setActiveTab(firstTabId)
    })

    expect(result.current.state.activeTabId).toBe(firstTabId)
    expect(result.current.state.currentPath).toEqual([{ id: null, name: '根目录' }])
  })

  it('多选文件', () => {
    const { result } = renderHook(() => useDrive(), { wrapper })

    act(() => {
      result.current.selectFile(1)
    })

    expect(result.current.state.selectedFiles).toEqual([1])

    act(() => {
      result.current.selectFile(2, true)
    })

    expect(result.current.state.selectedFiles).toEqual([1, 2])

    act(() => {
      result.current.selectFile(1, true)
    })

    expect(result.current.state.selectedFiles).toEqual([2])
  })

  it('全选和清除选择', () => {
    const { result } = renderHook(() => useDrive(), { wrapper })

    act(() => {
      result.current.selectAll([1, 2, 3, 4, 5])
    })

    expect(result.current.state.selectedFiles).toEqual([1, 2, 3, 4, 5])

    act(() => {
      result.current.clearSelection()
    })

    expect(result.current.state.selectedFiles).toEqual([])
  })

  it('添加收藏', () => {
    const { result } = renderHook(() => useDrive(), { wrapper })

    act(() => {
      result.current.addFavorite(42, '重要文件夹')
    })

    expect(result.current.state.favorites).toHaveLength(1)
    expect(result.current.state.favorites[0].folderId).toBe(42)
    expect(result.current.state.favorites[0].folderName).toBe('重要文件夹')

    const stored = JSON.parse(localStorage.getItem('lineweb_favorites')!)
    expect(stored).toHaveLength(1)
    expect(stored[0].folderId).toBe(42)
  })

  it('重复添加收藏不生效', () => {
    const { result } = renderHook(() => useDrive(), { wrapper })

    act(() => {
      result.current.addFavorite(42, '重要文件夹')
    })
    act(() => {
      result.current.addFavorite(42, '重要文件夹')
    })

    expect(result.current.state.favorites).toHaveLength(1)
  })

  it('删除收藏', () => {
    const { result } = renderHook(() => useDrive(), { wrapper })

    act(() => {
      result.current.addFavorite(42, '重要文件夹')
    })
    act(() => {
      result.current.addFavorite(99, '另一个文件夹')
    })

    expect(result.current.state.favorites).toHaveLength(2)

    act(() => {
      result.current.removeFavorite(42)
    })

    expect(result.current.state.favorites).toHaveLength(1)
    expect(result.current.state.favorites[0].folderId).toBe(99)

    const stored = JSON.parse(localStorage.getItem('lineweb_favorites')!)
    expect(stored).toHaveLength(1)
  })

  it('重排收藏', () => {
    const { result } = renderHook(() => useDrive(), { wrapper })

    act(() => {
      result.current.addFavorite(42, '文件夹A')
    })
    act(() => {
      result.current.addFavorite(99, '文件夹B')
    })

    const reordered = [
      { ...result.current.state.favorites[1], order: 1 },
      { ...result.current.state.favorites[0], order: 2 },
    ]

    act(() => {
      result.current.reorderFavorites(reordered)
    })

    expect(result.current.state.favorites[0].folderId).toBe(99)
    expect(result.current.state.favorites[1].folderId).toBe(42)
  })

  it('设置视图模式', () => {
    const { result } = renderHook(() => useDrive(), { wrapper })

    act(() => {
      result.current.setViewMode('grid')
    })

    expect(result.current.state.viewMode).toBe('grid')
  })

  it('设置排序', () => {
    const { result } = renderHook(() => useDrive(), { wrapper })

    act(() => {
      result.current.setSort({ field: 'size', direction: 'desc' })
    })

    expect(result.current.state.sort).toEqual({ field: 'size', direction: 'desc' })
  })

  it('设置分类过滤', () => {
    const { result } = renderHook(() => useDrive(), { wrapper })

    act(() => {
      result.current.setCategoryFilter('images')
    })

    expect(result.current.state.categoryFilter).toBe('images')
  })

  it('导航时清除选择和搜索', () => {
    const { result } = renderHook(() => useDrive(), { wrapper })

    act(() => {
      result.current.selectFile(1)
    })

    act(() => {
      result.current.navigateToFolder(42, '新文件夹')
    })

    expect(result.current.state.selectedFiles).toEqual([])
    expect(result.current.state.searchResults).toBeNull()
    expect(result.current.state.searchQuery).toBe('')
  })
})
