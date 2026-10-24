import type { ReactNode } from 'react'

/** 牌桌顶部信息条（返回 / 标题 / 右侧操作），单机与联机共用。 */
export interface DoudizhuGamebarProps {
  backLabel: string
  onBack: () => void
  title: ReactNode
  children?: ReactNode
}

export default function DoudizhuGamebar({
  backLabel,
  onBack,
  title,
  children,
}: DoudizhuGamebarProps) {
  return (
    <header className="gh-ddz-gamebar">
      <button type="button" className="gh-ddz-gamebar-back" onClick={onBack}>
        {backLabel}
      </button>
      <span className="gh-ddz-gamebar-title">{title}</span>
      {children != null && <div className="gh-ddz-gamebar-actions">{children}</div>}
    </header>
  )
}
