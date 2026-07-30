import { memo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDownload } from '../../contexts/DownloadContext'
import { formatFileSize, formatSpeed, formatETA } from '../../lib/format'
import { CheckIcon, CloseIcon, DownloadIcon } from './DriveIcons'

const portalRoot = document.body

const DownloadToast = memo(function DownloadToast() {
  const { tasks, cancelDownload } = useDownload()
  const [expanded, setExpanded] = useState(false)

  if (tasks.length === 0) return null

  const activeTasks = tasks.filter(task => task.status === 'downloading')
  const activeCount = activeTasks.length
  const completedCount = tasks.filter(task => task.status === 'complete').length
  const currentTask = activeTasks[0] || tasks[tasks.length - 1]
  const recentHistory = tasks.filter(task => task.status !== 'downloading').slice(-3).reverse()
  const visibleTasks = [...activeTasks, ...recentHistory].slice(0, 4)
  const currentProgress = currentTask.total > 0
    ? Math.min(100, (currentTask.loaded / currentTask.total) * 100)
    : 0

  return createPortal(
    <section className={`gh-drive-download-toast${expanded ? ' gh-drive-download-toast--expanded' : ''}`} aria-live="polite">
      <div className="gh-drive-download-toast-header">
        <div className="gh-drive-download-toast-summary">
          <span className="gh-drive-download-toast-icon"><DownloadIcon size={15} /></span>
          <div className="gh-drive-download-toast-summary-copy">
            <strong>{activeCount > 0 ? `正在下载 ${activeCount} 个文件` : `下载完成 ${completedCount} 个文件`}</strong>
            {!expanded && <span title={currentTask.fileName}>{currentTask.fileName}</span>}
          </div>
        </div>
        <div className="gh-drive-download-toast-header-actions">
          <button
            className="gh-drive-download-toast-toggle"
            onClick={() => setExpanded(value => !value)}
            aria-expanded={expanded}
            aria-label={expanded ? '收起下载详情' : '展开下载详情'}
          >
            {expanded ? '收起' : `${tasks.length} 项`}
          </button>
          {activeCount > 0 && <span className="gh-drive-download-toast-count">{activeCount} 进行中</span>}
        </div>
      </div>
      {currentTask.status === 'downloading' && (
        <div className="gh-drive-download-toast-progress-bar" aria-label={`当前下载进度 ${Math.round(currentProgress)}%`}>
          <div className="gh-drive-download-toast-progress-fill" style={{ width: `${currentProgress}%` }} />
        </div>
      )}
      {expanded && (
        <div className="gh-drive-download-toast-list">
          {visibleTasks.map(task => (
            <div key={task.id} className={`gh-drive-download-toast-item gh-drive-download-toast-item--${task.status}`}>
              <div className="gh-drive-download-toast-item-top">
                <span className="gh-drive-download-toast-item-name" title={task.fileName}>{task.fileName}</span>
                {task.status === 'downloading' && (
                  <button className="gh-drive-download-toast-cancel" onClick={() => cancelDownload(task.id)} aria-label={`取消下载 ${task.fileName}`}>
                    <CloseIcon size={14} />
                  </button>
                )}
                {task.status === 'complete' && <span className="gh-drive-download-toast-badge"><CheckIcon size={14} /></span>}
                {task.status === 'error' && <span className="gh-drive-download-toast-badge"><CloseIcon size={14} /></span>}
              </div>
              {task.status === 'downloading' && task.total > 0 && (
                <div className="gh-drive-download-toast-progress-bar" aria-label={`下载进度 ${Math.round((task.loaded / task.total) * 100)}%`}>
                  <div className="gh-drive-download-toast-progress-fill" style={{ width: `${Math.min(100, (task.loaded / task.total) * 100)}%` }} />
                </div>
              )}
              {task.status === 'downloading' && task.total > 0 && (
                <div className="gh-drive-download-toast-stats">
                  <span>{formatSpeed(task.speed)}</span>
                  <span>{formatFileSize(task.loaded)} / {formatFileSize(task.total)}</span>
                  <span>剩余 {formatETA((task.total - task.loaded) / (task.speed || 1))}</span>
                </div>
              )}
              {task.status === 'complete' && <div className="gh-drive-download-toast-done-text">下载完成</div>}
              {task.status === 'error' && <div className="gh-drive-download-toast-error-text">{task.error || '下载失败'}</div>}
            </div>
          ))}
        </div>
      )}
    </section>,
    portalRoot
  )
})

export default DownloadToast
