import { useEffect, useCallback } from 'react'

export interface KeyboardShortcutsOptions {
  selectedFileIds: number[]
  currentPathLength: number
  onDelete?: () => void
  onRename?: () => void
  onNewFolder?: () => void
  onUpload?: () => void
  onRefresh?: () => void
  onClearSelection?: () => void
  onNavigateBack?: () => void
  onSelectAll?: () => void
}

export function useKeyboardShortcuts(options: KeyboardShortcutsOptions) {
  const {
    selectedFileIds,
    currentPathLength,
    onDelete,
    onRename,
    onNewFolder,
    onUpload,
    onRefresh,
    onClearSelection,
    onNavigateBack,
    onSelectAll,
  } = options

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      const isCtrl = e.ctrlKey || e.metaKey

      if (isCtrl && e.key === 'a') {
        e.preventDefault()
        onSelectAll?.()
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedFileIds.length > 0 && e.key === 'Delete') {
          e.preventDefault()
          onDelete?.()
        }
      }

      if (e.key === 'F2') {
        if (selectedFileIds.length === 1) {
          e.preventDefault()
          onRename?.()
        }
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        onClearSelection?.()
      }

      if (isCtrl && e.key === 'n') {
        e.preventDefault()
        onNewFolder?.()
      }

      if (isCtrl && e.key === 'u') {
        e.preventDefault()
        onUpload?.()
      }

      if (e.key === 'F5' || (isCtrl && e.key === 'r')) {
        e.preventDefault()
        onRefresh?.()
      }

      if (e.key === 'Backspace' && !isCtrl) {
        if (currentPathLength > 1) {
          e.preventDefault()
          onNavigateBack?.()
        }
      }
    },
    [
      selectedFileIds,
      currentPathLength,
      onDelete,
      onRename,
      onNewFolder,
      onUpload,
      onRefresh,
      onClearSelection,
      onNavigateBack,
      onSelectAll,
    ],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
