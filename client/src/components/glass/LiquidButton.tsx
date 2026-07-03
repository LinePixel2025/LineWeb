import React, { memo, useState } from 'react'
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
  const [touchScale, setTouchScale] = useState(1)

  const mergedStyle: React.CSSProperties = {
    ...style,
    transform: `scale(${touchScale})`,
    transition: 'transform 0.15s ease, box-shadow 0.25s ease, background 0.25s ease, color 0.25s ease',
  }

  const touchHandlers = disabled ? {} : {
    onTouchStart: () => setTouchScale(0.96),
    onTouchEnd: () => setTouchScale(1),
  }

  const content = (
    <>
      {children}
      <span className="btn-flare" />
    </>
  )

  if (to) {
    return (
      <Link to={to} className={cls} style={mergedStyle} {...touchHandlers}>
        {content}
      </Link>
    )
  }

  if (href) {
    return (
      <a href={href} className={cls} style={mergedStyle} target="_blank" rel="noopener noreferrer" {...touchHandlers}>
        {content}
      </a>
    )
  }

  return (
    <button type={type} disabled={disabled} onClick={onClick} className={cls} style={mergedStyle} {...touchHandlers}>
      {content}
    </button>
  )
})

export default LiquidButton
