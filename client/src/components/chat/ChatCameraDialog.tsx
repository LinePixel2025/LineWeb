import { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  /** 拍照完成（已生成 JPEG File），由调用方负责上传 */
  onCapture: (file: File) => Promise<void> | void
  /** 「改用文件选择」兜底：由 Composer 触发带 capture 的文件输入 */
  onFallback: () => void
}

type CameraStatus = 'idle' | 'requesting' | 'ready' | 'error'

/** 把 getUserMedia / 播放失败翻译成用户能理解的中文提示 */
function describeCameraError(error: unknown): string {
  if (!navigator.mediaDevices?.getUserMedia) {
    return '当前浏览器或页面环境不支持调用相机（相机需要 HTTPS 或 localhost 环境）'
  }
  const name = error instanceof DOMException ? error.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return '相机权限被拒绝，请在浏览器设置中允许访问摄像头'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return '未找到可用的摄像头'
    case 'NotReadableError':
    case 'TrackStartError':
      return '摄像头被其他应用占用，暂时无法使用'
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return '摄像头不支持所需参数，请改用文件选择'
    case 'SecurityError':
      return '当前页面不是安全上下文（需要 HTTPS），无法调用相机'
    default:
      return error instanceof Error && error.message ? `打开相机失败：${error.message}` : '打开相机失败，请重试'
  }
}

/** canvas.toBlob 的 Promise 包装 */
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('图片生成失败，请重试'))
      },
      'image/jpeg',
      0.9
    )
  })
}

/**
 * 相机拍照弹窗：getUserMedia 实时预览 → canvas 截帧 → JPEG File。
 *
 * 免摄像头 / 权限被拒 / 非安全上下文时进入错误分支，提供「改用文件选择」兜底。
 * 关闭、卸载、拍照完成后都会 stop 所有 MediaStreamTrack。
 */
export default function ChatCameraDialog({ open, onClose, onCapture, onFallback }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const currentDeviceIdRef = useRef<string | null>(null)
  /** 请求令牌：关闭/重新申请时递增，让仍在途的 getUserMedia 结果失效并立刻止损 */
  const requestIdRef = useRef(0)

  const [status, setStatus] = useState<CameraStatus>('idle')
  const [errorText, setErrorText] = useState<string | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [capturing, setCapturing] = useState(false)
  const [switching, setSwitching] = useState(false)

  /** 停止所有轨道并解绑预览（幂等；同时让在途的 getUserMedia 请求失效） */
  const stopStream = useCallback(() => {
    requestIdRef.current += 1
    const stream = streamRef.current
    streamRef.current = null
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop()
        } catch {
          // 单个轨道停止失败不影响其他轨道
        }
      }
    }
    const video = videoRef.current
    if (video) video.srcObject = null
  }, [])

  const startCamera = useCallback(
    async (deviceId?: string) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('error')
        setErrorText(describeCameraError(null))
        return
      }

      // 先释放旧流（浏览器会缓存当前 facingMode，不释放可能切不过去），再发起新请求
      stopStream()
      const requestId = ++requestIdRef.current
      setStatus('requesting')
      setErrorText(null)
      setDevices([])

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // 不用 exact：没有 environment 摄像头的设备上 exact 会直接 OverconstrainedError
          video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } },
          audio: false,
        })

        // 等待期间弹窗已被关闭/重新发起请求：立刻停掉这条新流，避免摄像头一直亮着
        if (requestId !== requestIdRef.current) {
          for (const track of stream.getTracks()) {
            try {
              track.stop()
            } catch {
              // ignore
            }
          }
          return
        }

        streamRef.current = stream
        currentDeviceIdRef.current = stream.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId ?? null

        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          // 自动播放被拦截时仍显示预览帧，用户可点击画面重试
          try {
            await video.play()
          } catch {
            // 忽略自动播放失败
          }
        }

        // 有多个 videoinput 时展示「切换摄像头」
        try {
          const all = await navigator.mediaDevices.enumerateDevices()
          if (requestId === requestIdRef.current) {
            setDevices(all.filter((device) => device.kind === 'videoinput'))
          }
        } catch {
          if (requestId === requestIdRef.current) setDevices([])
        }

        if (requestId === requestIdRef.current) setStatus('ready')
      } catch (error) {
        if (requestId !== requestIdRef.current) return
        stopStream()
        setStatus('error')
        setErrorText(describeCameraError(error))
      }
    },
    [stopStream]
  )

  // 打开时申请摄像头；关闭/卸载时停止轨道
  useEffect(() => {
    if (!open) {
      stopStream()
      setStatus('idle')
      setErrorText(null)
      setDevices([])
      setCapturing(false)
      setSwitching(false)
      return
    }
    void startCamera()
    return () => stopStream()
  }, [open, startCamera, stopStream])

  // ESC 关闭
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  const handleClose = () => {
    stopStream()
    onClose()
  }

  const handleSwitch = () => {
    if (devices.length < 2 || switching) return
    const currentIndex = devices.findIndex((device) => device.deviceId === currentDeviceIdRef.current)
    const next = devices[(currentIndex + 1) % devices.length]
    if (!next?.deviceId) return
    setSwitching(true)
    void startCamera(next.deviceId).finally(() => setSwitching(false))
  }

  const handleCapture = async () => {
    const video = videoRef.current
    if (!video || capturing) return
    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) {
      setErrorText('相机画面尚未就绪，请稍候再试')
      return
    }

    setCapturing(true)
    let file: File
    try {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('当前浏览器不支持 canvas 截图')
      context.drawImage(video, 0, 0, width, height)
      const blob = await canvasToBlob(canvas)
      file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' })
    } catch (error) {
      setErrorText(error instanceof Error && error.message ? error.message : '拍照失败，请重试')
      setCapturing(false)
      return
    }

    // 拍照完成立即释放摄像头，再交给上传方处理
    setCapturing(false)
    stopStream()
    onClose()
    try {
      await onCapture(file)
    } catch {
      // 上传失败由页面 actionError banner 展示
    }
  }

  const handleFallback = () => {
    stopStream()
    onClose()
    onFallback()
  }

  if (!open) return null

  return (
    <div className="gh-chat-camera-overlay" role="presentation" onClick={handleClose}>
      <div
        className="gh-chat-camera-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="拍照"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="gh-chat-camera-header">
          <h2 className="gh-chat-camera-title">拍照</h2>
          <button type="button" className="gh-chat-camera-close" aria-label="关闭相机" onClick={handleClose}>
            ×
          </button>
        </header>

        <div className="gh-chat-camera-stage">
          {status === 'error' ? (
            <div className="gh-chat-camera-error" role="alert">
              <p className="gh-chat-camera-error-text">{errorText}</p>
              <button
                type="button"
                className="gh-btn gh-btn--secondary gh-btn--sm"
                onClick={() => void startCamera(currentDeviceIdRef.current ?? undefined)}
              >
                重试
              </button>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                className="gh-chat-camera-video"
                autoPlay
                playsInline
                muted
                aria-label="相机预览"
              />
              {status !== 'ready' && (
                <div className="gh-chat-camera-status">
                  <div className="gh-spinner" />
                  <span>正在打开相机…</span>
                </div>
              )}
              {errorText && <p className="gh-chat-camera-hint">{errorText}</p>}
            </>
          )}
        </div>

        <footer className="gh-chat-camera-bar">
          <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={handleFallback}>
            改用文件选择
          </button>
          {devices.length > 1 && (
            <button
              type="button"
              className="gh-btn gh-btn--secondary gh-btn--sm"
              disabled={switching || status !== 'ready'}
              onClick={handleSwitch}
            >
              {switching ? '切换中…' : '切换摄像头'}
            </button>
          )}
          <button
            type="button"
            className="gh-btn gh-btn--primary gh-btn--sm"
            disabled={status !== 'ready' || capturing}
            onClick={() => void handleCapture()}
          >
            {capturing ? '拍摄中…' : '拍照'}
          </button>
        </footer>
      </div>
    </div>
  )
}
