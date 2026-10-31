import { forwardRef, type InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode
  fullWidth?: boolean
}

/** 填充式文本输入（Apple 表单风格）。 */
const Input = forwardRef<HTMLInputElement, InputProps>(
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

Input.displayName = 'Input'
export default Input
