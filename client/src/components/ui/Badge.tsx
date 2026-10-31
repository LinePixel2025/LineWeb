import type { ReactNode } from 'react'

type BadgeVariant = 'default' | 'success' | 'danger' | 'warning' | 'accent'

interface BadgeProps {
  variant?: BadgeVariant
  children: ReactNode
  className?: string
}

/** 胶囊状态徽章。 */
export default function Badge({ variant = 'default', children, className = '' }: BadgeProps) {
  return <span className={`gh-badge gh-badge--${variant} ${className}`}>{children}</span>
}
