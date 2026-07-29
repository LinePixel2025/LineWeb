import { memo, useCallback } from 'react'
import { useDrive } from '../../contexts/DriveContext'

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

  if (state.tabs.length <= 1) {
    return null
  }

  return (
    <div className="gh-drive-tab-list">
      <h4 className="gh-drive-tab-list-heading">打开的标签</h4>
      <div>
        {state.tabs.map(tab => (
          <div
            key={tab.id}
            className={`gh-drive-tab-item ${tab.id === state.activeTabId ? 'gh-drive-tab-item--active' : ''}`}
            onClick={() => handleTabClick(tab.id)}
          >
            <span className="gh-drive-tab-item-icon">📁</span>
            <span className="gh-drive-tab-item-name">{tab.folderName}</span>
            {state.tabs.length > 1 && (
              <button
                className="gh-drive-tab-item-close"
                onClick={(e) => handleCloseClick(e, tab.id)}
                aria-label={`关闭${tab.folderName}标签`}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
})

export default TabList
