import { useState, useCallback, useRef } from 'react'

export interface DragAndDropOptions {
  onFilesDropped?: (files: FileList) => void
  onDragStateChange?: (isDragging: boolean) => void
}

export interface DragAndDropReturn {
  isDragging: boolean
  dragProps: {
    onDragOver: (e: React.DragEvent) => void
    onDragEnter: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
  }
}

export function useDragAndDrop(options: DragAndDropOptions = {}): DragAndDropReturn {
  const { onFilesDropped, onDragStateChange } = options
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    dragCounterRef.current++
    
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true)
      onDragStateChange?.(true)
    }
  }, [onDragStateChange])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    dragCounterRef.current--
    
    if (dragCounterRef.current === 0) {
      setIsDragging(false)
      onDragStateChange?.(false)
    }
  }, [onDragStateChange])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    setIsDragging(false)
    dragCounterRef.current = 0
    onDragStateChange?.(false)
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesDropped?.(e.dataTransfer.files)
      e.dataTransfer.clearData()
    }
  }, [onFilesDropped, onDragStateChange])

  return {
    isDragging,
    dragProps: {
      onDragOver: handleDragOver,
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop
    }
  }
}
