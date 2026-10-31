import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

interface BaseProps {
  variant?: Variant
  size?: Size
  fullWidth?: boolean
}

type ButtonAsButton = BaseProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined; external?: undefined }
type ButtonAsLink = BaseProps & { href: string; external?: boolean; children?: React.ReactNode; className?: string }
type ButtonAsAnchor = BaseProps & { href: string; external: true; children?: React.ReactNode; className?: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>

type ButtonProps = ButtonAsButton | ButtonAsLink | ButtonAsAnchor

/**
 * 全站按钮（Apple 胶囊 / 填充）。
 * variant: primary=强调填充 / secondary=灰底填充 / ghost=纯文字 / danger=红淡底
 */
const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', fullWidth, className = '', children, ...props }, ref) => {
    const cls = `gh-btn gh-btn--${variant} gh-btn--${size}${fullWidth ? ' gh-btn--full' : ''} ${className}`.trim()

    if ('href' in props && props.href) {
      const { href, external, ...rest } = props as ButtonAsLink | ButtonAsAnchor
      if (external || href.startsWith('http')) {
        return <a href={href} className={cls} target="_blank" rel="noopener noreferrer" ref={ref as any} {...(rest as any)}>{children}</a>
      }
      return <Link to={href} className={cls} {...(rest as any)}>{children}</Link>
    }

    return (
      <button className={cls} ref={ref as any} {...(props as ButtonHTMLAttributes<HTMLButtonElement>)}>
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
export default Button
