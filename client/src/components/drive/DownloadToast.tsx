import { memo } from 'react'
import { createPortal } from 'react-dom'
import { useDownload } from '../../contexts/DownloadContext'
import { formatFileSize } from '../../types/drive'

const portalRoot = document.body

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '—'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let i = 0
  let speed = bytesPerSec
  while (speed >= 1024 && i < units.length - 1) { speed /= 1024; i++ }
  return `${speed.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatETA(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '—'
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}

const DownloadToast = memo(function DownloadToast() {
  const { tasks, cancelDownload } = useDownload()

  if (tasks.length === 0) return null

  // 只显示进行中的任务
  const activeTasks = tasks.filter(t => t.status === 'downloading')
  const activeCount = activeTasks.length
  const displayTasks = activeTasks.length > 0 ? activeTasks : tasks.slice(-3)
  const visibleTasks = displayTasks.slice(0, 3)
  const overflow = displayTasks.length - 3

  return createPortal(
    <div className="download-toast">
      <div className="download-toast-header">
        <span className="download-toast-title">
          ⬇ 下载 {activeCount > 0 ? `${activeCount} 个文件` : '已完成'}
        </span>
        {activeCount > 0 && (
          <span className="download-toast-hint">点击 × 取消单个</span>
        )}
      </div>
      <div className="download-toast-list">
        {visibleTasks.map(task => (
          <div key={task.id} className={`download-toast-item download-toast-item--${task.status}`}>
            <div className="download-toast-item-top">
              <span className="download-toast-item-name" title={task.fileName}>
                {task.fileName}
              </span>
              {task.status === 'downloading' && (
                <button
                  className="download-toast-cancel"
                  onClick={() => cancelDownload(task.id)}
                  aria-label="取消下载"
                >
                  ✕
                </button>
              )}
              {task.status === 'complete' && <span className="download-toast-badge">✅</span>}
              {task.status === 'error' && <span className="download-toast-badge">❌</span>}
            </div>
            {task.status === 'downloading' && task.total > 0 && (
              <>
                <div className="download-toast-progress-bar">
                  <div
                    className="download-toast-progress-fill"
                    style={{ width: `${(task.loaded / task.total) * 100}%` }}
                  />
                </div>
                <div className="download-toast-stats">
                  <span>⬇ {formatSpeed(task.speed)}</span>
                  <span>
                    {formatFileSize(task.loaded)} / {formatFileSize(task.total)}
                  </span>
                  <span>⏱ {formatETA((task.total - task.loaded) / (task.speed || 1))}</span>
                </div>
              </>
            )}
            {task.status === 'complete' && (
              <div className="download-toast-done-text">下载完成</div>
            )}
            {task.status === 'error' && (
              <div className="download-toast-error-text">{task.error || '下载失败'}</div>
            )}
          </div>
        ))}
        {overflow > 0 && (
          <div className="download-toast-overflow">还有 {overflow} 个文件...</div>
        )}
      </div>
    </div>,
    portalRoot
  )
})

export default DownloadToast
