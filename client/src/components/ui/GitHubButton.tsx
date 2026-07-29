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

type GitHubButtonProps = ButtonAsButton | ButtonAsLink | ButtonAsAnchor

const GitHubButton = forwardRef<HTMLButtonElement | HTMLAnchorElement, GitHubButtonProps>(
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

GitHubButton.displayName = 'GitHubButton'
export default GitHubButton
