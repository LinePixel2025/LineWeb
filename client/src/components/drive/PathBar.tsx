import { useState, useCallback, memo } from 'react'
import { useDrive } from '../../contexts/DriveContext'
import api from '../../lib/api'
import type { Breadcrumb } from '../../types/drive'

const PathBar = memo(function PathBar() {
  const { state, navigateToBreadcrumb, navigateTo, refreshFiles } = useDrive()
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')

  const handleBreadcrumbClick = useCallback((index: number) => {
    navigateToBreadcrumb(index)
  }, [navigateToBreadcrumb])

  const handleDoubleClick = useCallback(() => {
    setIsEditing(true)
    setEditValue(state.currentPath.map(p => p.name).join('/'))
  }, [state.currentPath])

  const handleEditSubmit = useCallback(async () => {
    const trimmed = editValue.trim()
    if (!trimmed) {
      setIsEditing(false)
      return
    }

    try {
      const breadcrumbs = await api.get<Breadcrumb[]>(`/drive/resolve-path?path=${encodeURIComponent(trimmed)}`)
      navigateTo(breadcrumbs)
    } catch {
      // Path resolution failed, stay in edit mode
      return
    }
    setIsEditing(false)
  }, [editValue, navigateTo])

  const handleEditCancel = useCallback(() => {
    setIsEditing(false)
    setEditValue('')
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleEditSubmit()
    } else if (e.key === 'Escape') {
      handleEditCancel()
    }
  }, [handleEditSubmit, handleEditCancel])

  return (
    <nav className="path-bar" onDoubleClick={handleDoubleClick}>
      {isEditing ? (
        <div className="path-bar-edit">
          <input
            type="text"
            className="path-bar-input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleEditSubmit}
            autoFocus
          />
        </div>
      ) : (
        <div className="path-bar-breadcrumbs">
          {state.currentPath.map((crumb, index) => (
            <span key={crumb.id ?? 'root'} className="path-bar-item">
              {index > 0 && <span className="path-bar-separator">/</span>}
              {index === state.currentPath.length - 1 ? (
                <span className="path-bar-current">{crumb.name}</span>
              ) : (
                <button
                  className="path-bar-link"
                  onClick={() => handleBreadcrumbClick(index)}
                >
                  {crumb.name}
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      
      <div className="path-bar-actions">
        <button
          className="path-bar-action"
          onClick={() => handleBreadcrumbClick(state.currentPath.length - 2)}
          disabled={state.currentPath.length <= 1}
          title="返回上级"
        >
          ←
        </button>
        <button
          className="path-bar-action"
          onClick={refreshFiles}
          title="刷新"
        >
          ↻
        </button>
      </div>
    </nav>
  )
})

export default PathBar
