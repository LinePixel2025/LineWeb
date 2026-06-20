import React from 'react'
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
export default function LiquidButton({
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
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    border: 'none',
    borderRadius: '9999px',
    fontFamily: 'var(--lg-font)',
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'all 0.25s cubic-bezier(0.25, 0.1, 0.25, 1)',
    userSelect: 'none',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    opacity: disabled ? 0.5 : 1,
    position: 'relative',
    overflow: 'hidden',
    ...style,
  }

  // Size
  const sizeStyles: Record<string, React.CSSProperties> = {
    sm: { padding: '6px 16px', fontSize: '0.82rem' },
    md: { padding: '10px 24px', fontSize: '0.9rem' },
    lg: { padding: '14px 32px', fontSize: '1rem' },
  }

  // Variant
  const variantStyles: Record<string, React.CSSProperties> = {
    primary: {
      background: 'linear-gradient(135deg, var(--lg-accent), #40a9ff)',
      color: 'white',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3), 0 4px 12px rgba(0,113,227,0.3)',
    },
    glass: {
      background: 'rgba(255,255,255,0.08)',
      backdropFilter: 'blur(12px) saturate(180%)',
      WebkitBackdropFilter: 'blur(12px) saturate(180%)',
      border: '1px solid rgba(255,255,255,0.18)',
      boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.2), 0 2px 8px rgba(0,0,0,0.15)',
      color: 'var(--lg-text-primary)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--lg-text-primary)',
    },
    danger: {
      background: 'linear-gradient(135deg, #ff3b30, #ff6b6b)',
      color: 'white',
      boxShadow: '0 4px 12px rgba(255,59,48,0.3)',
    },
  }

  const combinedStyle: React.CSSProperties = {
    ...base,
    ...sizeStyles[size],
    ...variantStyles[variant],
  }

  // Glossy highlight overlay (for primary/glass variants)
  if (variant === 'primary' || variant === 'glass') {
    combinedStyle.backgroundImage = `
      linear-gradient(180deg, rgba(255,255,255,0.10) 0%, transparent 50%),
      ${combinedStyle.background || variantStyles[variant].background || 'none'}
    `
  }

  // Hover effects
  const hoverStyle = {
    primary: { transform: 'translateY(-1px) scale(1.02)', boxShadow: '0 6px 20px rgba(0,113,227,0.4)' },
    glass: { transform: 'translateY(-1px)', background: 'rgba(255,255,255,0.14)' },
    ghost: { background: 'var(--lg-accent-soft)' },
    danger: { transform: 'translateY(-1px) scale(1.02)' },
  }

  if (to) {
    return (
      <Link
        to={to}
        className={`liquid-btn ${variant} ${className}`}
        style={combinedStyle}
        onMouseEnter={e => Object.assign(e.currentTarget.style, hoverStyle[variant])}
        onMouseLeave={e => Object.assign(e.currentTarget.style, { transform: 'none', boxShadow: variantStyles[variant].boxShadow || 'none', background: '' })}
      >
        {children}
      </Link>
    )
  }

  if (href) {
    return (
      <a
        href={href}
        className={`liquid-btn ${variant} ${className}`}
        style={combinedStyle}
        target="_blank"
        rel="noopener noreferrer"
        onMouseEnter={e => Object.assign(e.currentTarget.style, hoverStyle[variant])}
        onMouseLeave={e => Object.assign(e.currentTarget.style, { transform: 'none', boxShadow: variantStyles[variant].boxShadow || 'none', background: '' })}
      >
        {children}
      </a>
    )
  }

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`liquid-btn ${variant} ${className}`}
      style={combinedStyle}
      onMouseEnter={e => Object.assign(e.currentTarget.style, hoverStyle[variant])}
      onMouseLeave={e => Object.assign(e.currentTarget.style, { transform: 'none', boxShadow: variantStyles[variant].boxShadow || 'none', background: '' })}
    >
      <span style={{ position: 'relative', zIndex: 1 }}>{children}</span>
      {/* Hover flare */}
      <span
        className="btn-flare"
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 'inherit',
          background: variant === 'primary'
            ? 'radial-gradient(circle at 50% 0%, rgba(255,255,255,0.2) 0%, transparent 60%)'
            : 'radial-gradient(circle at 50% 0%, rgba(255,255,255,0.1) 0%, transparent 60%)',
          opacity: 0,
          transition: 'opacity 0.3s',
          pointerEvents: 'none',
        }}
        onMouseEnter={e => { e.currentTarget.style.opacity = '1' }}
        onMouseLeave={e => { e.currentTarget.style.opacity = '0' }}
      />
    </button>
  )
}
