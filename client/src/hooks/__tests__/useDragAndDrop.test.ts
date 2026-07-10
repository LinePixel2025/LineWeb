import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDragAndDrop } from '../useDragAndDrop'

function createDragEvent(type: string, items?: DataTransferItem[]): React.DragEvent {
  const dataTransfer = {
    items: items || [],
    files: items ? Object.assign(items.map(i => i.webkitGetAsEntry?.()), { length: items.length }) : [],
    clearData: vi.fn(),
  } as unknown as DataTransfer

  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer,
    type,
  } as unknown as React.DragEvent
}

describe('useDragAndDrop', () => {
  it('初始状态isDragging为false', () => {
    const { result } = renderHook(() => useDragAndDrop())
    expect(result.current.isDragging).toBe(false)
  })

  it('拖拽进入时isDragging变为true', () => {
    const { result } = renderHook(() => useDragAndDrop())

    const item = {} as DataTransferItem
    const enterEvent = createDragEvent('dragenter', [item])

    act(() => {
      result.current.dragProps.onDragEnter(enterEvent)
    })

    expect(result.current.isDragging).toBe(true)
  })

  it('拖拽离开时isDragging变为false', () => {
    const { result } = renderHook(() => useDragAndDrop())

    const item = {} as DataTransferItem
    const enterEvent = createDragEvent('dragenter', [item])
    const leaveEvent = createDragEvent('dragleave')

    act(() => {
      result.current.dragProps.onDragEnter(enterEvent)
    })
    expect(result.current.isDragging).toBe(true)

    act(() => {
      result.current.dragProps.onDragLeave(leaveEvent)
    })
    expect(result.current.isDragging).toBe(false)
  })

  it('放下文件时调用onFilesDropped', () => {
    const onFilesDropped = vi.fn()
    const { result } = renderHook(() => useDragAndDrop({ onFilesDropped }))

    const mockFiles = [new File([''], 'test.txt')] as unknown as FileList
    Object.defineProperty(mockFiles, 'length', { value: 1 })

    const dropEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        files: mockFiles,
        clearData: vi.fn(),
      },
    } as unknown as React.DragEvent

    act(() => {
      result.current.dragProps.onDrop(dropEvent)
    })

    expect(onFilesDropped).toHaveBeenCalledWith(mockFiles)
  })
})
