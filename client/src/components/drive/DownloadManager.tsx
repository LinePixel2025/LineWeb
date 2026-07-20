import { memo } from 'react'
import LiquidGlass from '../glass/LiquidGlass'
import { useDownload } from '../../contexts/DownloadContext'
import { formatFileSize, formatSpeed } from '../../lib/format'

const STATUS_LABEL: Record<string, string> = {
  downloading: '下载中',
  complete: '已完成',
  cancelled: '已取消',
  error: '下载失败',
}

const DownloadManager = memo(function DownloadManager() {
  const { tasks, cancelDownload } = useDownload()

  if (tasks.length === 0) return null

  return (
    <div className="download-manager">
      <LiquidGlass variant="strong" chromatic={false} className="download-manager-inner">
        <div className="download-manager-header">
          <span className="download-manager-title">下载任务</span>
          <span className="download-manager-count">{tasks.length}</span>
        </div>
        <div className="download-manager-list">
          {tasks.map(task => (
            <div key={task.id} className={`download-manager-item download-manager-item--${task.status}`}>
              <div className="download-manager-item-info">
                <span className="download-manager-item-name" title={task.fileName}>
                  {task.fileName.length > 30
                    ? task.fileName.slice(0, 27) + '...'
                    : task.fileName}
                </span>
                <span className="download-manager-item-status">
                  {STATUS_LABEL[task.status] || task.status}
                  {task.status === 'downloading' && task.speed > 0 && ` · ${formatSpeed(task.speed)}`}
                </span>
              </div>
              {task.status === 'downloading' && task.total > 0 && (
                <div className="download-manager-item-progress">
                  <div className="download-manager-progress-bar">
                    <div
                      className="download-manager-progress-fill"
                      style={{ width: `${(task.loaded / task.total) * 100}%` }}
                    />
                  </div>
                  <span className="download-manager-item-size">
                    {formatFileSize(task.loaded)} / {formatFileSize(task.total)}
                  </span>
                </div>
              )}
              {task.status === 'downloading' && (
                <button
                  className="download-manager-item-cancel"
                  onClick={() => cancelDownload(task.id)}
                  aria-label="取消"
                >
                  ✕
                </button>
              )}
              {task.status === 'error' && task.error && (
                <div className="download-manager-item-error">{task.error}</div>
              )}
            </div>
          ))}
        </div>
      </LiquidGlass>
    </div>
  )
})

export default DownloadManager
