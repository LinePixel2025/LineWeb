import { forwardRef, type InputHTMLAttributes } from 'react'

interface GitHubInputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode
  fullWidth?: boolean
}

const GitHubInput = forwardRef<HTMLInputElement, GitHubInputProps>(
  ({ icon, fullWidth, className = '', ...props }, ref) => {
    const cls = `gh-input${fullWidth ? ' gh-input--full' : ''} ${className}`.trim()
    if (icon) {
      return (
        <span className="gh-input-wrap">
          <span className="gh-input-icon">{icon}</span>
          <input ref={ref} className={cls} {...props} />
        </span>
      )
    }
    return <input ref={ref} className={cls} {...props} />
  }
)

GitHubInput.displayName = 'GitHubInput'
export default GitHubInput
