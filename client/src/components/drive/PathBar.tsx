import { useState, useCallback, memo } from 'react'
import { useDrive } from '../../contexts/DriveContext'
import type { Breadcrumb } from '../../types/drive'

export interface PathBarProps {
  onNavigate?: (path: Breadcrumb[]) => void
}

const PathBar = memo(function PathBar({ onNavigate }: PathBarProps) {
  const { state, navigateToBreadcrumb, navigateTo } = useDrive()
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')

  const handleBreadcrumbClick = useCallback((index: number) => {
    navigateToBreadcrumb(index)
    onNavigate?.(state.currentPath.slice(0, index + 1))
  }, [navigateToBreadcrumb, onNavigate, state.currentPath])

  const handleDoubleClick = useCallback(() => {
    setIsEditing(true)
    setEditValue(state.currentPath.map(p => p.name).join('/'))
  }, [state.currentPath])

  const handleEditSubmit = useCallback(() => {
    setIsEditing(false)
    // TODO: 解析路径并导航
    console.log('Navigate to:', editValue)
  }, [editValue])

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
          onClick={() => window.location.reload()}
          title="刷新"
        >
          ↻
        </button>
      </div>
    </nav>
  )
})

export default PathBar
