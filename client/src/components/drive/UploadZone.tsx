import { useState, useRef, memo } from 'react'
import LiquidButton from '../glass/LiquidButton'

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
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const uploadFiles = async (files: FileList | File[]) => {
    setUploading(true)
    const fileArray = Array.from(files)
    setProgress({ current: 0, total: fileArray.length })

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i]
      const formData = new FormData()
      formData.append('file', file)
      if (parentId !== null) {
        formData.append('parentId', String(parentId))
      }

      try {
        const token = localStorage.getItem('lineweb_token')
        const res = await fetch('/api/drive/upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || '上传失败')
        }
      } catch (err: any) {
        alert(`上传失败: ${file.name}\n${err.message}`)
      }
      setProgress({ current: i + 1, total: fileArray.length })
    }

    setUploading(false)
    setProgress(null)
    onUploaded()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files)
    }
  }

  return (
    <div className="upload-zone-wrapper">
      <div className="upload-zone-header">
        <LiquidButton size="sm" variant="primary" onClick={() => fileInputRef.current?.click()}>
          ⬆ 选择文件
        </LiquidButton>
        <LiquidButton size="sm" variant="ghost" onClick={onClose}>
          取消
        </LiquidButton>
      </div>
      {!uploading && (
        <div
          className={`upload-zone-drop ${dragOver ? 'upload-zone-drop--drag' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="upload-zone-drop-icon">📂</span>
          <span className="upload-zone-drop-text">拖拽文件到此处或点击选择</span>
          <span className="upload-zone-drop-hint">支持多文件上传，单个文件最大 500MB</span>
        </div>
      )}
      {uploading && progress && (
        <div className="upload-zone-progress">
          <span className="upload-zone-progress-text">
            ⏳ 上传中... {progress.current}/{progress.total}
          </span>
          <div className="upload-zone-progress-bar">
            <div
              className="upload-zone-progress-fill"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
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
