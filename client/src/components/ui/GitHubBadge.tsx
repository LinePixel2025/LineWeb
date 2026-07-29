import type { ReactNode } from 'react'

type BadgeVariant = 'default' | 'success' | 'danger' | 'warning' | 'accent'

interface GitHubBadgeProps {
  variant?: BadgeVariant
  children: ReactNode
  className?: string
}

export default function GitHubBadge({ variant = 'default', children, className = '' }: GitHubBadgeProps) {
  return <span className={`gh-badge gh-badge--${variant} ${className}`}>{children}</span>
}
