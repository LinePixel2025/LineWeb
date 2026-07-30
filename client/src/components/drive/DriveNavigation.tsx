import { memo, useCallback, useEffect, useState } from 'react'
import { useDrive } from '../../contexts/DriveContext'
import { useResponsive } from '../../hooks/useResponsive'
import TreeView from './TreeView'
import TabList from './TabList'
import { CloseIcon, FolderIcon, PanelIcon, StarIcon } from './DriveIcons'
import api from '../../lib/api'

export interface DriveNavigationProps {
  collapsed?: boolean
  onToggleCollapse?: () => void
}

const DriveNavigation = memo(function DriveNavigation({
  collapsed = false,
  onToggleCollapse,
}: DriveNavigationProps) {
  const { state, navigateToFolder, removeFavorite } = useDrive()
  const { isMobile } = useResponsive()
  const [apiFavorites, setApiFavorites] = useState<{ id: number; folderId: number; folderName: string; order: number }[]>([])

  useEffect(() => {
    api.get<{ id: number; folderId: number; folderName: string; order: number }[]>('/drive/favorites')
      .then(setApiFavorites)
      .catch(() => { /* local favorites remain available */ })
  }, [])

  const handleFavoriteClick = useCallback((folderId: number | null, folderName: string) => {
    navigateToFolder(folderId, folderName)
  }, [navigateToFolder])

  const handleRemoveFavorite = useCallback(async (e: React.MouseEvent, folderId: number) => {
    e.stopPropagation()
    removeFavorite(folderId)
    setApiFavorites(prev => prev.filter(f => f.folderId !== folderId))
    try { await api.delete(`/drive/favorites/${folderId}`) } catch { /* best effort */ }
  }, [removeFavorite])

  const mergedFavorites = apiFavorites.length > 0
    ? apiFavorites
    : state.favorites.map(f => ({ id: 0, folderId: f.folderId, folderName: f.folderName, order: f.order }))

  if (isMobile) return null

  return (
    <aside className={`gh-drive-sidebar ${collapsed ? 'gh-drive-sidebar--collapsed' : ''}`}>
      <div className="gh-drive-sidebar-header">
        <div className="gh-drive-sidebar-heading-wrap">
          <FolderIcon size={16} />
          <h2 className="gh-drive-sidebar-heading">文件</h2>
        </div>
        {onToggleCollapse && (
          <button
            className="gh-drive-sidebar-toggle"
            onClick={onToggleCollapse}
            aria-label={collapsed ? '展开导航' : '收起导航'}
            title={collapsed ? '展开导航' : '收起导航'}
          >
            <PanelIcon size={16} />
          </button>
        )}
      </div>

      {!collapsed ? (
        <>
          <div className="gh-drive-sidebar-section gh-drive-sidebar-section--tree">
            <div className="gh-drive-sidebar-section-label">目录</div>
            <div className="gh-drive-sidebar-tree">
              <TreeView />
            </div>
          </div>

          {state.tabs.length > 1 && (
            <div className="gh-drive-sidebar-section">
              <TabList />
            </div>
          )}

          <div className="gh-drive-sidebar-section">
            <div className="gh-drive-sidebar-section-label">
              <StarIcon size={13} /> 收藏夹
            </div>
            <div className="gh-drive-sidebar-favorites">
              {mergedFavorites.length === 0 ? (
                <p className="gh-drive-sidebar-placeholder">暂无收藏的文件夹</p>
              ) : (
                mergedFavorites.map(fav => (
                  <div key={`${fav.folderId}:${fav.id}`} className="gh-drive-sidebar-favorite-item">
                    <button
                      className="gh-drive-sidebar-favorite-link"
                      onClick={() => handleFavoriteClick(fav.folderId, fav.folderName)}
                      title={fav.folderName}
                    >
                      <FolderIcon size={15} />
                      <span className="gh-drive-sidebar-fav-name">{fav.folderName}</span>
                    </button>
                    <button
                      className="gh-drive-sidebar-fav-remove"
                      onClick={(e) => handleRemoveFavorite(e, fav.folderId)}
                      aria-label={`取消收藏 ${fav.folderName}`}
                      title="取消收藏"
                    >
                      <CloseIcon size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="gh-drive-sidebar-collapsed-mark" title="文件导航">
          <FolderIcon size={18} />
        </div>
      )}
    </aside>
  )
})

export default DriveNavigation
