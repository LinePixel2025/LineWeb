import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import Cropper from 'react-easy-crop'
import type { Area } from 'react-easy-crop'
import { getCroppedImg } from '../lib/cropImage'

interface AvatarCropDialogProps {
  file: File
  onClose: () => void
}

type DialogStep = 'crop' | 'upload' | 'error'

export default function AvatarCropDialog({ file, onClose }: AvatarCropDialogProps) {
  const [step, setStep] = useState<DialogStep>('crop')
  const [imageSrc, setImageSrc] = useState('')
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [progress, setProgress] = useState({ loaded: 0, total: 0 })
  const [uploadError, setUploadError] = useState('')
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  const cropBlobRef = useRef<Blob | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    setImageSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && step !== 'upload') onClose()
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleEscape)
    }
  }, [onClose, step])

  const handleCropComplete = (_croppedArea: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels)
  }

  const handleConfirmCrop = async () => {
    if (!croppedAreaPixels) return
    setConfirmLoading(true)
    setConfirmError('')
    try {
      const blob = await getCroppedImg(imageSrc, croppedAreaPixels)
      cropBlobRef.current = blob
      setStep('upload')
      // Start upload on next render after state transition
    } catch (err: unknown) {
      setConfirmError(err instanceof Error ? err.message : '裁剪失败')
      setConfirmLoading(false)
    }
  }

  const doUpload = (blob: Blob) => {
    const xhr = new XMLHttpRequest()
    const formData = new FormData()
    formData.append('avatar', new File([blob], 'avatar.jpg', { type: 'image/jpeg' }))

    const token = localStorage.getItem('lineweb_token')

    xhr.upload.onprogress = (e: ProgressEvent) => {
      if (e.lengthComputable) {
        setProgress({ loaded: e.loaded, total: e.total })
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        window.location.reload()
        return
      }
      try {
        const err = JSON.parse(xhr.responseText)
        setUploadError(err.error || `上传失败 (${xhr.status})`)
      } catch {
        setUploadError(`上传失败 (${xhr.status})`)
      }
      setStep('error')
    }

    xhr.onerror = () => {
      setUploadError('网络错误，请检查连接后重试')
      setStep('error')
    }

    xhr.open('POST', '/api/auth/avatar')
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.send(formData)
  }

  // Kick off upload when step changes to 'upload'
  useEffect(() => {
    if (step === 'upload' && cropBlobRef.current) {
      doUpload(cropBlobRef.current)
    }
  }, [step])

  const handleRetry = () => {
    setProgress({ loaded: 0, total: 0 })
    setStep('upload')
  }

  const canClose = step !== 'upload'

  return createPortal(
    <div className="gh-dialog-overlay" onClick={canClose ? onClose : undefined}>
      <div className="gh-dialog gh-dialog--crop" onClick={e => e.stopPropagation()}>
        {step === 'crop' && (
          <>
            <h3 className="gh-dialog-title">裁剪头像</h3>
            <p className="gh-text-secondary" style={{ fontSize: 'var(--gh-text-sm)', marginBottom: 'var(--gh-space-3)' }}>
              拖动或缩放以调整裁剪区域
            </p>

            <div className="gh-crop-container">
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={handleCropComplete}
              />
            </div>

            <div className="gh-crop-zoom-slider">
              <label>缩放</label>
              <input
                type="range"
                className="gh-range-input"
                min={1}
                max={3}
                step={0.1}
                value={zoom}
                onChange={e => setZoom(Number(e.target.value))}
              />
              <span style={{ fontSize: 'var(--gh-text-xs)', color: 'var(--gh-text-tertiary)', minWidth: '2em', textAlign: 'right' }}>
                {zoom.toFixed(1)}x
              </span>
            </div>

            {confirmError && (
              <p className="gh-alert gh-alert--danger" style={{ marginBottom: 'var(--gh-space-3)' }}>
                {confirmError}
              </p>
            )}

            <div className="gh-dialog-actions">
              <button className="gh-btn gh-btn--sm gh-btn--secondary" onClick={onClose} disabled={confirmLoading}>
                取消
              </button>
              <button
                className="gh-btn gh-btn--sm gh-btn--primary"
                onClick={handleConfirmCrop}
                disabled={confirmLoading || !croppedAreaPixels}
              >
                {confirmLoading ? '处理中...' : '确认裁剪'}
              </button>
            </div>
          </>
        )}

        {step === 'upload' && (
          <>
            <h3 className="gh-dialog-title">上传头像</h3>
            <div className="gh-crop-upload-progress">
              <p className="gh-crop-upload-progress-text">正在上传...</p>
              <div className="gh-drive-upload-zone-progress-bar">
                <div
                  className="gh-drive-upload-zone-progress-fill"
                  style={{ width: `${progress.total > 0 ? (progress.loaded / progress.total) * 100 : 0}%` }}
                />
              </div>
              <p className="gh-crop-upload-progress-pct">
                {progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0}%
              </p>
            </div>
          </>
        )}

        {step === 'error' && (
          <>
            <h3 className="gh-dialog-title">上传失败</h3>
            {uploadError && (
              <p className="gh-alert gh-alert--danger" style={{ marginBottom: 'var(--gh-space-3)' }}>
                {uploadError}
              </p>
            )}
            <div className="gh-dialog-actions">
              <button className="gh-btn gh-btn--sm gh-btn--secondary" onClick={onClose}>
                关闭
              </button>
              <button className="gh-btn gh-btn--sm gh-btn--primary" onClick={handleRetry}>
                重试
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
