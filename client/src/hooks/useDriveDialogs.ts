import { useState, useCallback } from 'react'
import type { DriveItem } from '../types/drive'

export interface DriveDialogState {
  showUpload: boolean
  showNewFolder: boolean
  previewItem: DriveItem | null
  renameItem: DriveItem | null
  deleteItem: DriveItem | null
}

export function useDriveDialogs() {
  const [showUpload, setShowUpload] = useState(false)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [previewItem, setPreviewItem] = useState<DriveItem | null>(null)
  const [renameItem, setRenameItem] = useState<DriveItem | null>(null)
  const [deleteItem, setDeleteItem] = useState<DriveItem | null>(null)

  const openUpload = useCallback(() => setShowUpload(true), [])
  const closeUpload = useCallback(() => setShowUpload(false), [])

  const openNewFolder = useCallback(() => setShowNewFolder(true), [])
  const closeNewFolder = useCallback(() => setShowNewFolder(false), [])

  const openPreview = useCallback((item: DriveItem) => setPreviewItem(item), [])
  const closePreview = useCallback(() => setPreviewItem(null), [])

  const openRename = useCallback((item: DriveItem) => setRenameItem(item), [])
  const closeRename = useCallback(() => setRenameItem(null), [])

  const openDelete = useCallback((item: DriveItem) => setDeleteItem(item), [])
  const closeDelete = useCallback(() => setDeleteItem(null), [])

  const closeAll = useCallback(() => {
    setShowUpload(false)
    setShowNewFolder(false)
    setPreviewItem(null)
    setRenameItem(null)
    setDeleteItem(null)
  }, [])

  return {
    showUpload, showNewFolder, previewItem, renameItem, deleteItem,
    openUpload, closeUpload,
    openNewFolder, closeNewFolder,
    openPreview, closePreview,
    openRename, closeRename,
    openDelete, closeDelete,
    closeAll,
  }
}
