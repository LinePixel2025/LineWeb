import React, { memo } from 'react'
import { Link } from 'react-router-dom'

export interface LiquidButtonProps {
  children: React.ReactNode
  variant?: 'primary' | 'glass' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  to?: string
  href?: string
  onClick?: () => void
  type?: 'button' | 'submit'
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
}

/**
 * Liquid Glass Button
 * Apple-inspired capsule button with glass refraction effects
 */
const LiquidButton = memo(function LiquidButton({
  children,
  variant = 'glass',
  size = 'md',
  to,
  href,
  onClick,
  type = 'button',
  disabled = false,
  className = '',
  style,
}: LiquidButtonProps) {
  const cls = `liquid-btn ${variant} ${size} ${className}`

  const content = (
    <>
      {children}
      <span className="btn-flare" />
    </>
  )

  if (to) {
    return (
      <Link to={to} className={cls} style={style}>
        {content}
      </Link>
    )
  }

  if (href) {
    return (
      <a href={href} className={cls} style={style} target="_blank" rel="noopener noreferrer">
        {content}
      </a>
    )
  }

  return (
    <button type={type} disabled={disabled} onClick={onClick} className={cls} style={style}>
      {content}
    </button>
  )
})

export default LiquidButton
