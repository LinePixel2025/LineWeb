import { useEffect } from 'react'

interface Props {
  src: string
  alt?: string
  onClose: () => void
}

/**
 * 图片大图预览：全屏遮罩 + 居中图片，ESC / 点击遮罩关闭。
 */
export default function ChatImageLightbox({ src, alt = '图片预览', onClose }: Props) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className="gh-chat-image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onClick={onClose}
    >
      <button
        type="button"
        className="gh-chat-image-lightbox-close"
        aria-label="关闭图片预览"
        onClick={onClose}
      >
        ×
      </button>
      <img
        className="gh-chat-image-lightbox-img"
        src={src}
        alt={alt}
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  )
}
