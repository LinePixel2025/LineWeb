import { useRef, useState, type ChangeEvent } from 'react'
import { chatImageUrl } from '../../lib/chat'
import type { NekoSticker } from '../../types/chat'

interface Props {
  open: boolean
  stickers: NekoSticker[]
  onSend: (sticker: NekoSticker) => void
  /** 收藏本地图片为表情（页面负责上传与错误提示） */
  onAdd: (file: File) => Promise<void> | void
  onRemove: (id: number) => Promise<void> | void
  onClose: () => void
}

/**
 * 表情包面板：neko 的个人表情包（收藏的聊天图片）。
 *
 * 发送口径与 neko 原生客户端一致：正文 `[表情]` + XHTML-IM 图片。
 */
export default function ChatStickerPanel({
  open,
  stickers,
  onSend,
  onAdd,
  onRemove,
  onClose,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)

  if (!open) return null

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || uploading) return
    setUploading(true)
    try {
      await onAdd(file)
    } catch {
      // 失败由页面 banner 展示
    } finally {
      setUploading(false)
    }
  }

  const handleRemove = async (sticker: NekoSticker) => {
    if (busyId !== null) return
    if (!window.confirm('把这个表情从表情包移除？')) return
    setBusyId(sticker.id)
    try {
      await onRemove(sticker.id)
    } catch {
      // 同上
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="gh-chat-sticker-panel" role="dialog" aria-label="表情包">
      <div className="gh-chat-sticker-head">
        <span className="gh-chat-sticker-title">表情包</span>
        <span className="gh-chat-sticker-actions">
          <button
            type="button"
            className="gh-chat-composer-tool"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? '上传中…' : '收藏表情'}
          </button>
          <button type="button" className="gh-chat-sticker-close" aria-label="关闭表情包" onClick={onClose}>
            ×
          </button>
        </span>
      </div>

      {stickers.length === 0 ? (
        <p className="gh-chat-sticker-empty">还没有表情，点「收藏表情」添加。</p>
      ) : (
        <div className="gh-chat-sticker-grid">
          {stickers.map((sticker) => (
            <div key={sticker.id} className="gh-chat-sticker-item">
              <button
                type="button"
                className="gh-chat-sticker-send"
                aria-label="发送表情"
                title="发送表情"
                onClick={() => onSend(sticker)}
              >
                <img src={chatImageUrl(sticker.url)} alt="表情" loading="lazy" />
              </button>
              <button
                type="button"
                className="gh-chat-sticker-remove"
                aria-label="移出表情包"
                title="移出表情包"
                disabled={busyId === sticker.id}
                onClick={() => void handleRemove(sticker)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="gh-chat-visually-hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleFile}
      />
    </div>
  )
}
