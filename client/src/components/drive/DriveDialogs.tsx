import { useState, memo } from 'react'
import { createPortal } from 'react-dom'
import LiquidGlass from '../glass/LiquidGlass'
import LiquidButton from '../glass/LiquidButton'
import api from '../../lib/api'
import type { DriveItem } from '../../types/drive'

/* ---------- New Folder Dialog ---------- */

export interface NewFolderDialogProps {
  parentId: number | null
  onCreated: () => void
  onClose: () => void
}

export const NewFolderDialog = memo(function NewFolderDialog({
  parentId,
  onCreated,
  onClose,
}: NewFolderDialogProps) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleCreate = async () => {
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      await api.post('/drive/folders', { name: name.trim(), parentId })
      onCreated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '创建失败')
      setLoading(false)
    }
  }

  return createPortal(
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <LiquidGlass variant="strong" chromatic={false} className="dialog-inner">
          <h3 className="dialog-title">新建文件夹</h3>
          {error && <p className="dialog-error">{error}</p>}
          <input
            className="lg-input dialog-input"
            type="text"
            placeholder="文件夹名称"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            autoFocus
          />
          <div className="dialog-actions">
            <LiquidButton size="sm" variant="ghost" onClick={onClose}>取消</LiquidButton>
            <LiquidButton size="sm" variant="primary" onClick={handleCreate} disabled={loading || !name.trim()}>
              {loading ? '创建中...' : '创建'}
            </LiquidButton>
          </div>
        </LiquidGlass>
      </div>
    </div>,
    document.body
  )
})

/* ---------- Rename Dialog ---------- */

export interface RenameDialogProps {
  item: DriveItem
  onRenamed: () => void
  onClose: () => void
}

export const RenameDialog = memo(function RenameDialog({
  item,
  onRenamed,
  onClose,
}: RenameDialogProps) {
  const [name, setName] = useState(item.name)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleRename = async () => {
    if (!name.trim() || name.trim() === item.name) {
      onClose()
      return
    }
    setLoading(true)
    setError('')
    try {
      await api.put(`/drive/files/${item.id}`, { name: name.trim() })
      onRenamed()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '重命名失败')
      setLoading(false)
    }
  }

  return createPortal(
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <LiquidGlass variant="strong" chromatic={false} className="dialog-inner">
          <h3 className="dialog-title">重命名</h3>
          {error && <p className="dialog-error">{error}</p>}
          <input
            className="lg-input dialog-input"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleRename()}
            autoFocus
          />
          <div className="dialog-actions">
            <LiquidButton size="sm" variant="ghost" onClick={onClose}>取消</LiquidButton>
            <LiquidButton size="sm" variant="primary" onClick={handleRename} disabled={loading || !name.trim()}>
              {loading ? '保存中...' : '保存'}
            </LiquidButton>
          </div>
        </LiquidGlass>
      </div>
    </div>,
    document.body
  )
})

/* ---------- Delete Dialog ---------- */

export interface DeleteDialogProps {
  item: DriveItem
  onDeleted: () => void
  onClose: () => void
}

export const DeleteDialog = memo(function DeleteDialog({
  item,
  onDeleted,
  onClose,
}: DeleteDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleDelete = async () => {
    setLoading(true)
    setError('')
    try {
      await api.delete(`/drive/files/${item.id}`)
      onDeleted()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '删除失败')
      setLoading(false)
    }
  }

  return createPortal(
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <LiquidGlass variant="strong" chromatic={false} className="dialog-inner">
          <h3 className="dialog-title">确认删除</h3>
          {error && <p className="dialog-error">{error}</p>}
          <p className="dialog-desc">
            确定要删除 {item.isFolder ? '文件夹' : '文件'} <strong>{item.name}</strong> 吗？
            {item.isFolder && <><br/>文件夹内的所有内容将一并删除。</>}
          </p>
          <p className="dialog-warn">此操作不可撤销。</p>
          <div className="dialog-actions">
            <LiquidButton size="sm" variant="ghost" onClick={onClose}>取消</LiquidButton>
            <LiquidButton size="sm" variant="danger" onClick={handleDelete} disabled={loading}>
              {loading ? '删除中...' : '确认删除'}
            </LiquidButton>
          </div>
        </LiquidGlass>
      </div>
    </div>,
    document.body
  )
})
