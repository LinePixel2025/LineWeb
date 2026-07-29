import type { ReactNode } from 'react'

interface GitHubAlertProps {
  variant: 'info' | 'success' | 'warning' | 'danger'
  title?: string
  children: ReactNode
  className?: string
}

export default function GitHubAlert({ variant, title, children, className = '' }: GitHubAlertProps) {
  return (
    <div className={`gh-alert gh-alert--${variant} ${className}`} role="alert">
      {title && <p className="gh-alert-title">{title}</p>}
      <div className="gh-alert-body">{children}</div>
    </div>
  )
}
