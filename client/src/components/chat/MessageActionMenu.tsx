import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface MessageActionItem {
  key: string
  label: string
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

interface Props {
  x: number
  y: number
  items: MessageActionItem[]
  onClose: () => void
}

/** 长按 / 右键消息菜单：portal 渲染，自动收敛到视口内 */
export default function MessageActionMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))
    const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))
    setPosition({ left, top })
  }, [x, y, items.length])

  useEffect(() => {
    const close = (event: Event) => {
      if (event.type === 'mousedown' && ref.current?.contains(event.target as Node)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  if (items.length === 0) return null

  return createPortal(
    <div
      ref={ref}
      className="gh-chat-action-menu"
      role="menu"
      style={{ left: position.left, top: position.top }}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className={`gh-chat-action-menu-item ${item.danger ? 'gh-chat-action-menu-item--danger' : ''}`}
          disabled={item.disabled}
          onClick={() => {
            onClose()
            item.onSelect()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}
