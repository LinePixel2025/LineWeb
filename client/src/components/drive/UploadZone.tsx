import { useState, useRef, useCallback, memo } from 'react'
import { formatSpeed, formatMB, formatETA } from '../../lib/format'
import { useDragAndDrop } from '../../hooks/useDragAndDrop'
import type { TransferProgress } from '../../types/drive'
import { CloseIcon, FileIcon, UploadIcon } from './DriveIcons'

export interface UploadZoneProps {
  parentId: number | null
  onUploaded: () => void
  onClose: () => void
}

const UploadZone = memo(function UploadZone({
  parentId,
  onUploaded,
  onClose,
}: UploadZoneProps) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<TransferProgress | null>(null)
  const [failedFiles, setFailedFiles] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef(false)
  const xhrRef = useRef<XMLHttpRequest | null>(null)

  const uploadFileViaXHR = useCallback(
    (file: File, idx: number, total: number): Promise<boolean> => {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhrRef.current = xhr
        const formData = new FormData()
        if (parentId !== null) formData.append('parentId', String(parentId))
        formData.append('file', file)

        const startTime = Date.now()
        const speedLog: { time: number; loaded: number }[] = []

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const now = Date.now()
            speedLog.push({ time: now, loaded: e.loaded })
            while (speedLog.length > 1 && speedLog[0].time < now - 2000) {
              speedLog.shift()
            }
            const first = speedLog[0]
            const last = speedLog[speedLog.length - 1]
            const dt = (last.time - first.time) / 1000
            const speed = dt > 0.1 ? (last.loaded - first.loaded) / dt : 0

            if (!abortRef.current) {
              setProgress({
                loaded: e.loaded,
                total: e.total,
                speed,
                eta: speed > 0 ? (e.total - e.loaded) / speed : Infinity,
                fileName: file.name,
                fileIndex: idx,
                totalFiles: total,
              })
            }
          }
        }

        xhr.onload = () => {
          xhrRef.current = null
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(true)
          } else {
            try {
              const err = JSON.parse(xhr.responseText)
              reject(new Error(err.error || `HTTP ${xhr.status}`))
            } catch {
              reject(new Error(`HTTP ${xhr.status}`))
            }
          }
        }

        xhr.onerror = () => {
          xhrRef.current = null
          reject(new Error('网络错误'))
        }

        xhr.onabort = () => {
          xhrRef.current = null
          resolve(false)
        }

        const token = localStorage.getItem('lineweb_token')
        xhr.open('POST', '/api/drive/upload')
        xhr.setRequestHeader('Authorization', `Bearer ${token}`)
        xhr.send(formData)
      })
    },
    [parentId],
  )

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files)
      setUploading(true)
      setFailedFiles([])
      abortRef.current = false
      const failed: string[] = []

      for (let i = 0; i < fileArray.length; i++) {
        if (abortRef.current) break
        const file = fileArray[i]
        try {
          const success = await uploadFileViaXHR(file, i + 1, fileArray.length)
          if (!success) break
        } catch {
          failed.push(file.name)
          console.error(`上传失败: ${file.name}`)
        }
      }

      setUploading(false)

      if (failed.length > 0) {
        setFailedFiles(failed)
      } else if (!abortRef.current) {
        setProgress(null)
        onUploaded()
      } else {
        setProgress(null)
      }
    },
    [uploadFileViaXHR, onUploaded],
  )

  const { isDragging, dragProps } = useDragAndDrop({
    onFilesDropped: uploadFiles,
  })

  const handleCancel = useCallback(() => {
    abortRef.current = true
    xhrRef.current?.abort()
  }, [])

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        uploadFiles(e.target.files)
      }
    },
    [uploadFiles],
  )

  return (
    <div className="gh-drive-upload-zone-wrapper">
      <div className="gh-drive-upload-zone-header">
        <button
          className="gh-btn gh-btn--sm gh-btn--primary"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          <UploadIcon size={14} /> 选择文件
        </button>
        {uploading ? (
          <button className="gh-btn gh-btn--sm gh-btn--danger" onClick={handleCancel}>
            <CloseIcon size={14} /> 取消
          </button>
        ) : (
          <button className="gh-btn gh-btn--sm gh-btn--ghost" onClick={onClose}>
            取消
          </button>
        )}
      </div>

      {!uploading && failedFiles.length === 0 && (
        <div
          className={`gh-drive-upload-zone-drop ${isDragging ? 'gh-drive-upload-zone-drop--drag' : ''}`}
          {...dragProps}
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="gh-drive-upload-zone-drop-icon"><UploadIcon size={28} /></span>
          <span className="gh-drive-upload-zone-drop-text">拖拽文件到此处或点击选择</span>
          <span className="gh-drive-upload-zone-drop-hint">支持多文件上传</span>
        </div>
      )}

      {uploading && progress && (
        <div className="gh-drive-upload-zone-progress" style={{ padding: '16px', background: 'var(--gh-canvas)', borderRadius: 'var(--gh-radius)', border: '1px solid var(--gh-border)' }}>
          <div className="gh-drive-upload-zone-progress-info">
            <span><FileIcon size={14} /> {progress.fileName}</span>
            <span className="gh-drive-upload-zone-progress-stats" style={{ fontSize: 'var(--gh-text-xs)' }}>
              {progress.fileIndex}/{progress.totalFiles}
            </span>
          </div>
          <div className="gh-drive-upload-zone-progress-stats" style={{ marginBottom: '8px' }}>
            <span>{formatSpeed(progress.speed)}</span>
            <span>剩余 {formatETA(progress.eta)}</span>
            <span>{formatMB(progress.loaded)} / {formatMB(progress.total)}</span>
          </div>
          <div className="gh-drive-upload-zone-progress-bar">
            <div
              className="gh-drive-upload-zone-progress-fill"
              style={{ width: `${(progress.loaded / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {failedFiles.length > 0 && (
        <div className="gh-drive-upload-zone-failed" style={{ padding: '16px', background: 'var(--gh-canvas)', borderRadius: 'var(--gh-radius)', border: '1px solid var(--gh-border)' }}>
          <p>以下文件上传失败：</p>
          <ul>
            {failedFiles.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
          <button
            className="gh-btn gh-btn--sm gh-btn--secondary"
            onClick={() => {
              setFailedFiles([])
              onUploaded()
            }}
          >
            关闭
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="gh-drive-upload-zone-hidden-input"
        onChange={handleFileSelect}
      />
    </div>
  )
})

export default UploadZone
