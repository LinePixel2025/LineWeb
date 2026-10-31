import type { ReactNode } from 'react'

interface AlertProps {
  variant: 'info' | 'success' | 'warning' | 'danger'
  title?: string
  children: ReactNode
  className?: string
}

/** 淡底提示条（Apple 表单/设置页风格），不参与布局压缩。 */
export default function Alert({ variant, title, children, className = '' }: AlertProps) {
  return (
    <div className={`gh-alert gh-alert--${variant} ${className}`} role="alert">
      {title && <p className="gh-alert-title">{title}</p>}
      <div className="gh-alert-body">{children}</div>
    </div>
  )
}
