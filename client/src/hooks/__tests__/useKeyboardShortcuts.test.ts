import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useKeyboardShortcuts } from '../useKeyboardShortcuts'

function pressKey(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, ...options })
  window.dispatchEvent(event)
  return event
}

describe('useKeyboardShortcuts', () => {
  let opts: {
    selectedFileIds: number[]
    currentPathLength: number
    onDelete: () => void
    onRename: () => void
    onNewFolder: () => void
    onUpload: () => void
    onRefresh: () => void
    onClearSelection: () => void
    onNavigateBack: () => void
    onSelectAll: () => void
  }

  beforeEach(() => {
    opts = {
      selectedFileIds: [],
      currentPathLength: 1,
      onDelete: vi.fn(),
      onRename: vi.fn(),
      onNewFolder: vi.fn(),
      onUpload: vi.fn(),
      onRefresh: vi.fn(),
      onClearSelection: vi.fn(),
      onNavigateBack: vi.fn(),
      onSelectAll: vi.fn(),
    }
  })

  it('按Delete键且有选中文件时调用onDelete', () => {
    opts.selectedFileIds = [1]
    renderHook(() => useKeyboardShortcuts(opts))
    pressKey('Delete')
    expect(opts.onDelete).toHaveBeenCalledOnce()
  })

  it('按Delete键无选中文件时不调用onDelete', () => {
    opts.selectedFileIds = []
    renderHook(() => useKeyboardShortcuts(opts))
    pressKey('Delete')
    expect(opts.onDelete).not.toHaveBeenCalled()
  })

  it('按F2键且选中一个文件时调用onRename', () => {
    opts.selectedFileIds = [1]
    renderHook(() => useKeyboardShortcuts(opts))
    pressKey('F2')
    expect(opts.onRename).toHaveBeenCalledOnce()
  })

  it('按F2键选中多个文件时不调用onRename', () => {
    opts.selectedFileIds = [1, 2]
    renderHook(() => useKeyboardShortcuts(opts))
    pressKey('F2')
    expect(opts.onRename).not.toHaveBeenCalled()
  })

  it('按Escape键调用onClearSelection', () => {
    renderHook(() => useKeyboardShortcuts(opts))
    pressKey('Escape')
    expect(opts.onClearSelection).toHaveBeenCalledOnce()
  })

  it('按Backspace键且路径深度>1时调用onNavigateBack', () => {
    opts.currentPathLength = 2
    renderHook(() => useKeyboardShortcuts(opts))
    pressKey('Backspace')
    expect(opts.onNavigateBack).toHaveBeenCalledOnce()
  })

  it('按Backspace键在根目录时不调用onNavigateBack', () => {
    opts.currentPathLength = 1
    renderHook(() => useKeyboardShortcuts(opts))
    pressKey('Backspace')
    expect(opts.onNavigateBack).not.toHaveBeenCalled()
  })

  it('按Ctrl+A调用onSelectAll', () => {
    renderHook(() => useKeyboardShortcuts(opts))
    pressKey('a', { ctrlKey: true })
    expect(opts.onSelectAll).toHaveBeenCalledOnce()
  })

  it('按Ctrl+N调用onNewFolder', () => {
    renderHook(() => useKeyboardShortcuts(opts))
    pressKey('n', { ctrlKey: true })
    expect(opts.onNewFolder).toHaveBeenCalledOnce()
  })

  it('输入框中不触发快捷键', () => {
    opts.selectedFileIds = [1]
    renderHook(() => useKeyboardShortcuts(opts))

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })
    input.dispatchEvent(event)

    expect(opts.onDelete).not.toHaveBeenCalled()
    document.body.removeChild(input)
  })

  it('hook卸载后移除事件监听', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(opts))
    unmount()
    pressKey('Escape')
    expect(opts.onClearSelection).not.toHaveBeenCalled()
  })
})
