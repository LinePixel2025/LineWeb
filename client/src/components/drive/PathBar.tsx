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
    <nav className="gh-drive-path-bar" onDoubleClick={handleDoubleClick}>
      {isEditing ? (
        <div className="gh-drive-path-bar-edit">
          <input
            type="text"
            className="gh-drive-path-bar-input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleEditSubmit}
            autoFocus
          />
        </div>
      ) : (
        <div className="gh-drive-path-bar-breadcrumbs">
          {state.currentPath.map((crumb, index) => (
            <span key={crumb.id ?? 'root'} className="gh-drive-path-bar-item">
              {index > 0 && <span className="gh-drive-path-bar-separator">/</span>}
              {index === state.currentPath.length - 1 ? (
                <span className="gh-drive-path-bar-current">{crumb.name}</span>
              ) : (
                <button
                  className="gh-drive-path-bar-link"
                  onClick={() => handleBreadcrumbClick(index)}
                >
                  {crumb.name}
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      
      <div className="gh-drive-path-bar-actions">
        <button
          className="gh-drive-path-bar-action"
          onClick={() => handleBreadcrumbClick(state.currentPath.length - 2)}
          disabled={state.currentPath.length <= 1}
          title="返回上级"
        >
          ←
        </button>
        <button
          className="gh-drive-path-bar-action"
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
