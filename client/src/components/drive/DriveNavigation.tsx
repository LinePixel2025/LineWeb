import { memo } from 'react'
import LiquidGlass from '../glass/LiquidGlass'
import { useDrive } from '../../contexts/DriveContext'
import { useResponsive } from '../../hooks/useResponsive'
import TreeView from './TreeView'

export interface DriveNavigationProps {
  collapsed?: boolean
  onToggleCollapse?: () => void
}

const DriveNavigation = memo(function DriveNavigation({
  collapsed = false,
  onToggleCollapse,
}: DriveNavigationProps) {
  const { state } = useDrive()
  const { isMobile } = useResponsive()

  if (isMobile) {
    return null
  }

  return (
    <aside className={`drive-sidebar ${collapsed ? 'drive-sidebar--collapsed' : ''}`}>
      <LiquidGlass variant="blur" chromatic={false} className="drive-sidebar-section">
        <div className="drive-sidebar-header">
          <h3 className="drive-sidebar-heading">导航</h3>
          {onToggleCollapse && (
            <button
              className="drive-sidebar-toggle"
              onClick={onToggleCollapse}
              aria-label={collapsed ? '展开导航' : '折叠导航'}
            >
              {collapsed ? '→' : '←'}
            </button>
          )}
        </div>

        <div className="drive-sidebar-tree">
          <TreeView />
        </div>
      </LiquidGlass>

      {!collapsed && (
        <>
          <LiquidGlass variant="blur" chromatic={false} className="drive-sidebar-section">
            <h3 className="drive-sidebar-heading">收藏夹</h3>
            <div className="drive-sidebar-favorites">
              {state.favorites.length === 0 ? (
                <p className="drive-sidebar-placeholder">暂无收藏</p>
              ) : (
                state.favorites.map(fav => (
                  <div key={fav.id} className="drive-sidebar-favorite-item">
                    <span>📁</span>
                    <span>{fav.folderName}</span>
                  </div>
                ))
              )}
            </div>
          </LiquidGlass>

          <LiquidGlass variant="blur" chromatic={false} className="drive-sidebar-section drive-sidebar-storage">
            <h3 className="drive-sidebar-heading">存储空间</h3>
            <div className="drive-storage-bar">
              <div className="drive-storage-bar-track">
                <div className="drive-storage-bar-fill" style={{ width: '25%' }} />
              </div>
              <div className="drive-storage-bar-text">
                <span>2.5 GB</span>
                <span className="drive-storage-bar-sep">/</span>
                <span>10 GB</span>
              </div>
            </div>
          </LiquidGlass>
        </>
      )}
    </aside>
  )
})

export default DriveNavigation
