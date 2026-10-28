import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import ChatCameraDialog from './ChatCameraDialog'
import type { NekoRoomMember } from '../../types/chat'

const DEFAULT_MAX_LENGTH = 2000
/** 与 neko `PHOTO_ACCEPT` 一致：只列服务端按魔数支持的四种 */
const PHOTO_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

export interface ComposerReply {
  /** 被引用消息 id */
  id: number
  /** 被引用消息的发送者显示名 */
  name: string
  /** 预览文本 */
  text: string
}

interface Props {
  onSend: (content: string, mentions?: number[]) => Promise<void> | void
  /** 群成员（传入才启用 @ 选择器） */
  members?: NekoRoomMember[]
  selfNekoId?: number | null
  /** 群主/管理员才能 @所有人 */
  canMentionAll?: boolean
  /** 发送图片：页面负责上传并在失败时展示错误 */
  onSendImage?: (file: File) => Promise<void> | void
  /** 当前引用（显示在输入框上方） */
  replyTo?: ComposerReply | null
  onCancelReply?: () => void
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
  members = [],
  selfNekoId = null,
  canMentionAll = false,
  onSendImage,
  replyTo = null,
  onCancelReply,
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
  const [dragOver, setDragOver] = useState(false)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionStart, setMentionStart] = useState(-1)
  const [mentionIds, setMentionIds] = useState<number[]>([])
  const [pickerIndex, setPickerIndex] = useState(0)

  // 相册选择（普通文件选择）
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  // 相机兜底：capture=environment 直接调起手机相机
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const mentionCandidates = useMemo(() => {
    if (members.length === 0) return []
    const keyword = (mentionQuery ?? '').trim().toLowerCase()
    const list = members
      .filter((member) => member.nekoId !== selfNekoId)
      .map((member) => ({
        id: member.nekoId,
        label: member.displayName || member.username,
        username: member.username,
        role: member.role,
      }))
    const filtered = keyword
      ? list.filter((item) => item.label.toLowerCase().includes(keyword) || item.username.toLowerCase().includes(keyword))
      : list
    if (canMentionAll && (!keyword || '所有人'.includes(keyword))) {
      filtered.unshift({ id: 0, label: '所有人', username: '', role: 'all' })
    }
    return filtered.slice(0, 8)
  }, [members, mentionQuery, selfNekoId, canMentionAll])

  const pruneMentions = (next: string, ids: number[]) => {
    return ids.filter((id) => {
      if (id === 0) return next.includes('@所有人')
      const member = members.find((item) => item.nekoId === id)
      if (!member) return false
      return next.includes(`@${member.displayName || member.username}`)
    })
  }

  const handleValueChange = (next: string) => {
    setValue(next)
    setMentionIds((prev) => pruneMentions(next, prev))
    const textarea = textareaRef.current
    const cursor = textarea?.selectionStart ?? next.length
    const before = next.slice(0, cursor)
    const match = /(?:^|\s)@([^\s@]*)$/.exec(before)
    if (match && members.length > 0) {
      setMentionQuery(match[1])
      setMentionStart(cursor - match[1].length - 1)
      setPickerIndex(0)
    } else {
      setMentionQuery(null)
      setMentionStart(-1)
    }
  }

  const chooseMention = (id: number, label: string) => {
    const textarea = textareaRef.current
    const cursor = textarea?.selectionStart ?? value.length
    const start = mentionStart >= 0 ? mentionStart : cursor
    const head = value.slice(0, start)
    const tail = value.slice(cursor)
    const inserted = `@${label} `
    const next = `${head}${inserted}${tail}`.slice(0, maxLength)
    setValue(next)
    setMentionIds((prev) => [...new Set([...prev, id])])
    setMentionQuery(null)
    setMentionStart(-1)
    window.requestAnimationFrame(() => {
      const position = Math.min((head + inserted).length, next.length)
      textarea?.focus()
      textarea?.setSelectionRange(position, position)
    })
  }

  const canAttach = !disabled && !sending && !uploading
  const canSubmit = canAttach && value.trim().length > 0

  const submit = async () => {
    if (!canSubmit) return
    const content = value.trim()
    const mentions = pruneMentions(content, mentionIds).slice(0, 20)
    if (mentionQuery !== null && mentionCandidates[pickerIndex]) {
      const picked = mentionCandidates[pickerIndex]
      chooseMention(picked.id, picked.label)
      return
    }
    setSending(true)
    try {
      await onSend(content, mentions.length ? mentions : undefined)
      setValue('')
      setMentionIds([])
      setMentionQuery(null)
    } catch {
      // 发送失败保留草稿，由页面展示错误
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && mentionCandidates.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setPickerIndex((prev) => (prev + 1) % mentionCandidates.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setPickerIndex((prev) => (prev - 1 + mentionCandidates.length) % mentionCandidates.length)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMentionQuery(null)
        return
      }
    }
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

  /**
   * 与 neko `uploadPhotos` 一致：一次可多选，逐张上传（每张各发一条图片消息）。
   * 单张失败不阻塞后续文件，错误由页面 banner 展示。
   */
  const uploadImages = async (files: File[]) => {
    if (!onSendImage || uploading) return
    const images = files.filter((file) => file.type.startsWith('image/'))
    if (images.length === 0) return
    setUploading(true)
    try {
      for (const file of images) {
        try {
          await onSendImage(file)
        } catch {
          // 继续上传剩余图片
        }
      }
    } finally {
      setUploading(false)
    }
  }

  /** 读取文件输入并立即重置 value，保证连续选择同一文件也能触发 change */
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length > 0) void uploadImages(files)
  }

  /** 粘贴图片（与 neko 的 paste 处理一致：剪贴板里有图片就直接上传） */
  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onSendImage || !canAttach) return
    const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
      file.type.startsWith('image/'),
    )
    if (files.length === 0) return
    event.preventDefault()
    void uploadImages(files)
  }

  /** 拖入图片（与 neko 的 drop 处理一致） */
  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!onSendImage || !canAttach) return
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    setDragOver(true)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!onSendImage || !canAttach) return
    const files = Array.from(event.dataTransfer.files ?? []).filter((file) =>
      file.type.startsWith('image/'),
    )
    if (files.length === 0) return
    event.preventDefault()
    setDragOver(false)
    void uploadImages(files)
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
    <div
      className={`gh-chat-composer ${dragOver ? 'gh-chat-composer--dragover' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {replyTo && (
        <div className="gh-chat-reply-bar">
          <span className="gh-chat-reply-copy">
            <span className="gh-chat-reply-label">引用 {replyTo.name}</span>
            <span className="gh-chat-reply-text">{replyTo.text || '[消息]'}</span>
          </span>
          <button
            type="button"
            className="gh-chat-reply-close"
            aria-label="取消引用"
            onClick={onCancelReply}
          >
            ×
          </button>
        </div>
      )}
      {mentionQuery !== null && mentionCandidates.length > 0 && (
        <div className="gh-chat-mention-picker" role="listbox" aria-label="选择要提醒的成员">
          {mentionCandidates.map((candidate, index) => (
            <button
              key={`${candidate.id}-${candidate.username}`}
              type="button"
              role="option"
              aria-selected={index === pickerIndex}
              className={`gh-chat-mention-option ${index === pickerIndex ? 'gh-chat-mention-option--active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseMention(candidate.id, candidate.label)}
            >
              <span>{candidate.label}</span>
              {candidate.id === 0
                ? <span className="gh-text-tertiary">提醒所有人</span>
                : <span className="gh-text-tertiary">@{candidate.username}</span>}
            </button>
          ))}
        </div>
      )}
      {mentionIds.length > 0 && (
        <div className="gh-chat-mention-hint">
          将提醒 {mentionIds.length} 人
          <button type="button" className="gh-chat-mention-clear" onClick={() => setMentionIds([])}>清除</button>
        </div>
      )}
      <textarea
        ref={textareaRef}
        className="gh-chat-composer-input"
        value={value}
        rows={2}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label="消息输入框"
        onChange={(event) => handleValueChange(event.target.value.slice(0, maxLength))}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
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
            accept={PHOTO_ACCEPT}
            multiple
            className="gh-chat-visually-hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={handleFileChange}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept={PHOTO_ACCEPT}
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
