import { memo, useCallback, useEffect, useState } from 'react'
import { useDrive } from '../../contexts/DriveContext'
import { useResponsive } from '../../hooks/useResponsive'
import TreeView from './TreeView'
import TabList from './TabList'
import { FolderIcon, StarIcon } from './DriveIcons'
import api from '../../lib/api'

export interface DriveNavigationProps {
  collapsed?: boolean
  onToggleCollapse?: () => void
}

const DriveNavigation = memo(function DriveNavigation({
  collapsed = false,
  onToggleCollapse,
}: DriveNavigationProps) {
  const { state, navigateToFolder, removeFavorite, addFavorite } = useDrive()
  const { isMobile } = useResponsive()
  const [apiFavorites, setApiFavorites] = useState<{ id: number; folderId: number; folderName: string; order: number }[]>([])

  useEffect(() => {
    api.get<{ id: number; folderId: number; folderName: string; order: number }[]>('/drive/favorites')
      .then(setApiFavorites)
      .catch(() => { /* fallback to localStorage */ })
  }, [])

  const handleFavoriteClick = useCallback((folderId: number | null, folderName: string) => {
    navigateToFolder(folderId, folderName)
  }, [navigateToFolder])

  const handleRemoveFavorite = useCallback(async (e: React.MouseEvent, folderId: number) => {
    e.stopPropagation()
    removeFavorite(folderId)
    setApiFavorites(prev => prev.filter(f => f.folderId !== folderId))
    try { await api.delete(`/drive/favorites/${folderId}`) } catch { /* ignore */ }
  }, [removeFavorite])

  const mergedFavorites = apiFavorites.length > 0
    ? apiFavorites
    : state.favorites.map(f => ({ id: 0, folderId: f.folderId, folderName: f.folderName, order: f.order }))

  if (isMobile) {
    return null
  }

  return (
    <aside className={`gh-drive-sidebar ${collapsed ? 'gh-drive-sidebar--collapsed' : ''}`}>
      <div className="gh-drive-sidebar-section">
        <div className="gh-drive-sidebar-header">
          <h3 className="gh-drive-sidebar-heading">导航</h3>
          {onToggleCollapse && (
            <button
              className="gh-drive-sidebar-toggle"
              onClick={onToggleCollapse}
              aria-label={collapsed ? '展开导航' : '折叠导航'}
            >
              {collapsed ? '→' : '←'}
            </button>
          )}
        </div>

        <div className="gh-drive-sidebar-tree">
          <TreeView />
        </div>
      </div>

      {!collapsed && (
        <>
          {state.tabs.length > 1 && (
            <div className="gh-drive-sidebar-section">
              <TabList />
            </div>
          )}

          <div className="gh-drive-sidebar-section">
            <h3 className="gh-drive-sidebar-heading">收藏夹</h3>
            <div className="gh-drive-sidebar-favorites">
              {mergedFavorites.length === 0 ? (
                <p className="gh-drive-sidebar-placeholder">暂无收藏</p>
              ) : (
                mergedFavorites.map(fav => (
                  <div
                    key={`${fav.folderId}:${fav.id}`}
                    className="gh-drive-sidebar-favorite-item"
                    onClick={() => handleFavoriteClick(fav.folderId, fav.folderName)}
                  >
                    <FolderIcon size={16} />
                    <span className="gh-drive-sidebar-fav-name">{fav.folderName}</span>
                    <button
                      className="gh-drive-sidebar-fav-remove"
                      onClick={(e) => handleRemoveFavorite(e, fav.folderId)}
                      aria-label="取消收藏"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </aside>
  )
})

export default DriveNavigation
