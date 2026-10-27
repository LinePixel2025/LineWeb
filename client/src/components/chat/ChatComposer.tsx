import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import ChatCameraDialog from './ChatCameraDialog'

const DEFAULT_MAX_LENGTH = 2000

interface Props {
  onSend: (content: string) => Promise<void> | void
  /** 发送图片：页面负责上传并在失败时展示错误 */
  onSendImage?: (file: File) => Promise<void> | void
  /** 打开/收起表情包面板（传入才渲染「表情」按钮） */
  onToggleStickers?: () => void
  stickersOpen?: boolean
  /** 禁用输入（如对方已不是好友） */
  disabled?: boolean
  disabledHint?: string
  placeholder?: string
  maxLength?: number
}

export default function ChatComposer({
  onSend,
  onSendImage,
  onToggleStickers,
  stickersOpen = false,
  disabled = false,
  disabledHint,
  placeholder = '输入消息…',
  maxLength = DEFAULT_MAX_LENGTH,
}: Props) {
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)

  // 相册选择（普通文件选择）
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  // 相机兜底：capture=environment 直接调起手机相机
  const cameraInputRef = useRef<HTMLInputElement | null>(null)

  const canAttach = !disabled && !sending && !uploading
  const canSubmit = canAttach && value.trim().length > 0

  const submit = async () => {
    if (!canSubmit) return
    const content = value.trim()
    setSending(true)
    try {
      await onSend(content)
      setValue('')
    } catch {
      // 发送失败保留草稿，由页面展示错误
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    // 中文输入法组合中按 Enter 是确认候选词，不应发送
    if (event.nativeEvent.isComposing) return
    event.preventDefault()
    void submit()
  }

  const uploadImage = async (file: File) => {
    if (!onSendImage || uploading) return
    setUploading(true)
    try {
      await onSendImage(file)
    } catch {
      // 上传失败不清理草稿，错误由页面的 actionError banner 展示
    } finally {
      setUploading(false)
    }
  }

  /** 读取文件输入并立即重置 value，保证连续选择同一文件也能触发 change */
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void uploadImage(file)
  }

  /** 拍照：支持 getUserMedia 时用实时预览弹窗，否则退回 capture 文件输入 */
  const handleCameraClick = () => {
    if (!onSendImage || !canAttach) return
    // 非安全上下文（如 http://<IP>）下 navigator.mediaDevices 可能为 undefined
    if (typeof navigator.mediaDevices?.getUserMedia === 'function') {
      setCameraOpen(true)
      return
    }
    cameraInputRef.current?.click()
  }

  if (disabled) {
    return (
      <div className="gh-chat-composer gh-chat-composer--disabled">
        <p className="gh-chat-composer-hint">{disabledHint || '当前无法发送消息'}</p>
      </div>
    )
  }

  return (
    <div className="gh-chat-composer">
      <textarea
        className="gh-chat-composer-input"
        value={value}
        rows={2}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label="消息输入框"
        onChange={(event) => setValue(event.target.value.slice(0, maxLength))}
        onKeyDown={handleKeyDown}
      />
      <div className="gh-chat-composer-bar">
        {(onSendImage || onToggleStickers) && (
          <div className="gh-chat-composer-tools">
            {onToggleStickers && (
              <button
                type="button"
                className={`gh-chat-composer-tool ${stickersOpen ? 'gh-chat-composer-tool--active' : ''}`}
                aria-label="表情包"
                aria-expanded={stickersOpen}
                title="表情包"
                disabled={!canAttach}
                onClick={onToggleStickers}
              >
                表情
              </button>
            )}
            {onSendImage && (
              <>
                <button
                  type="button"
                  className="gh-chat-composer-tool"
                  aria-label="发送图片"
                  title="发送图片"
                  disabled={!canAttach}
                  onClick={() => imageInputRef.current?.click()}
                >
                  {uploading ? '发送中…' : '图片'}
                </button>
                <button
                  type="button"
                  className="gh-chat-composer-tool"
                  aria-label="拍照"
                  title="拍照"
                  disabled={!canAttach}
                  onClick={handleCameraClick}
                >
                  拍照
                </button>
              </>
            )}
          </div>
        )}
        <span className={`gh-chat-composer-count ${value.length > maxLength - 200 ? 'gh-chat-composer-count--warn' : ''}`}>
          {value.length}/{maxLength}
        </span>
        <span className="gh-chat-composer-tip">Enter 发送 · Shift+Enter 换行</span>
        <button
          type="button"
          className="gh-btn gh-btn--primary gh-btn--sm"
          aria-label="发送消息"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          {sending ? '发送中…' : '发送'}
        </button>
      </div>

      {onSendImage && (
        <>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="gh-chat-visually-hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={handleFileChange}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="gh-chat-visually-hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={handleFileChange}
          />
          <ChatCameraDialog
            open={cameraOpen}
            onClose={() => setCameraOpen(false)}
            onCapture={uploadImage}
            onFallback={() => cameraInputRef.current?.click()}
          />
        </>
      )}
    </div>
  )
}
