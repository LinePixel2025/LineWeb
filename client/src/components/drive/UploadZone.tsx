import { useState, useRef, useCallback, memo } from 'react'
import LiquidButton from '../glass/LiquidButton'
import { formatSpeed, formatMB } from '../../lib/format'
import type { TransferProgress } from '../../types/drive'

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
  const [dragOver, setDragOver] = useState(false)
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
        formData.append('file', file)
        if (parentId !== null) formData.append('parentId', String(parentId))

        const startTime = Date.now()
        let lastUpdate = startTime
        let lastLoaded = 0

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const now = Date.now()
            const elapsed = (now - startTime) / 1000
            const windowElapsed = (now - lastUpdate) / 1000
            let speed = 0
            if (windowElapsed > 0.15) {
              speed = (e.loaded - lastLoaded) / windowElapsed
              lastUpdate = now
              lastLoaded = e.loaded
            } else {
              speed = elapsed > 0 ? e.loaded / elapsed : 0
            }

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

  const handleCancel = useCallback(() => {
    abortRef.current = true
    xhrRef.current?.abort()
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      if (e.dataTransfer.files.length > 0) {
        uploadFiles(e.dataTransfer.files)
      }
    },
    [uploadFiles],
  )

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        uploadFiles(e.target.files)
      }
    },
    [uploadFiles],
  )

  return (
    <div className="upload-zone-wrapper">
      <div className="upload-zone-header">
        <LiquidButton
          size="sm"
          variant="primary"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          ⬆ 选择文件
        </LiquidButton>
        {uploading ? (
          <LiquidButton size="sm" variant="danger" onClick={handleCancel}>
            ⏹ 取消
          </LiquidButton>
        ) : (
          <LiquidButton size="sm" variant="ghost" onClick={onClose}>
            取消
          </LiquidButton>
        )}
      </div>

      {!uploading && failedFiles.length === 0 && (
        <div
          className={`upload-zone-drop ${dragOver ? 'upload-zone-drop--drag' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="upload-zone-drop-icon">📂</span>
          <span className="upload-zone-drop-text">拖拽文件到此处或点击选择</span>
          <span className="upload-zone-drop-hint">支持多文件上传，单个文件最大 10GB</span>
        </div>
      )}

      {uploading && progress && (
        <div className="upload-zone-progress">
          <div className="upload-zone-progress-info">
            <span>📄 {progress.fileName}</span>
            <span className="upload-zone-progress-count">
              {progress.fileIndex}/{progress.totalFiles}
            </span>
          </div>
          <div className="upload-zone-progress-stats">
            <span>⬆ {formatSpeed(progress.speed)}</span>
            <span>⏱ {formatETA(progress.eta)}</span>
            <span>{formatMB(progress.loaded)} / {formatMB(progress.total)}</span>
          </div>
          <div className="upload-zone-progress-bar">
            <div
              className="upload-zone-progress-fill"
              style={{ width: `${(progress.loaded / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {failedFiles.length > 0 && (
        <div className="upload-zone-failed">
          <p>⚠️ 以下文件上传失败：</p>
          <ul>
            {failedFiles.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
          <LiquidButton
            size="sm"
            variant="glass"
            onClick={() => {
              setFailedFiles([])
              onUploaded()
            }}
          >
            关闭
          </LiquidButton>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="upload-zone-hidden-input"
        onChange={handleFileSelect}
      />
    </div>
  )
})

export default UploadZone
