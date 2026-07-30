import { memo, useCallback } from 'react'
import { useDrive } from '../../contexts/DriveContext'
import { CloseIcon, FolderIcon } from './DriveIcons'

export interface TabListProps {
  onTabSelect?: (tabId: string) => void
}

const TabList = memo(function TabList({ onTabSelect }: TabListProps) {
  const { state, setActiveTab, closeTab } = useDrive()

  const handleTabClick = useCallback((tabId: string) => {
    setActiveTab(tabId)
    onTabSelect?.(tabId)
  }, [setActiveTab, onTabSelect])

  const handleCloseClick = useCallback((e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    closeTab(tabId)
  }, [closeTab])

  if (state.tabs.length <= 1) return null

  return (
    <div className="gh-drive-tab-list">
      <div className="gh-drive-sidebar-section-label">打开的目录</div>
      <div>
        {state.tabs.map(tab => (
          <div
            key={tab.id}
            className={`gh-drive-tab-item${tab.id === state.activeTabId ? ' gh-drive-tab-item--active' : ''}`}
            onClick={() => handleTabClick(tab.id)}
          >
            <button className="gh-drive-tab-item-button" title={tab.folderName}>
              <FolderIcon size={14} />
              <span className="gh-drive-tab-item-name">{tab.folderName}</span>
            </button>
            {state.tabs.length > 1 && (
              <button
                className="gh-drive-tab-item-close"
                onClick={(e) => handleCloseClick(e, tab.id)}
                aria-label={`关闭${tab.folderName}标签`}
                title="关闭目录"
              >
                <CloseIcon size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
})

export default TabList
