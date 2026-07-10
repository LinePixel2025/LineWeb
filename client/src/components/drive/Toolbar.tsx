import { memo, useCallback } from 'react'
import LiquidButton from '../glass/LiquidButton'
import { useDrive } from '../../contexts/DriveContext'

export interface ToolbarProps {
  onNewFolder?: () => void
  onUpload?: () => void
  onSync?: () => void
  syncing?: boolean
}

const Toolbar = memo(function Toolbar({ 
  onNewFolder, 
  onUpload, 
  onSync, 
  syncing = false 
}: ToolbarProps) {
  const { state, setViewMode } = useDrive()

  const handleViewToggle = useCallback(() => {
    setViewMode(state.viewMode === 'list' ? 'grid' : 'list')
  }, [state.viewMode, setViewMode])

  return (
    <div className="toolbar">
      <div className="toolbar-actions">
        <LiquidButton size="sm" variant="glass" onClick={onNewFolder}>
          📁 新建
        </LiquidButton>
        <LiquidButton size="sm" variant="primary" onClick={onUpload}>
          ⬆ 上传
        </LiquidButton>
        <LiquidButton size="sm" variant="ghost" onClick={onSync} disabled={syncing}>
          {syncing ? '🔄 同步中...' : '🔄 同步'}
        </LiquidButton>
      </div>

      <div className="toolbar-controls">
        <button
          className={`toolbar-view-toggle ${state.viewMode === 'grid' ? 'toolbar-view-toggle--active' : ''}`}
          onClick={handleViewToggle}
          title={state.viewMode === 'list' ? '切换为网格视图' : '切换为列表视图'}
        >
          {state.viewMode === 'list' ? '☰' : '▦'}
        </button>
      </div>
    </div>
  )
})

export default Toolbar
