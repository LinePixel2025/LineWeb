import type { ReactNode } from 'react'

interface Props {
  title: string
  subtitle?: string
  immersive: boolean
  onToggleImmersive: () => void
  /** 退出沉浸并回到 LineWeb；页面自行决定是否二次确认 */
  onExitSite: () => void
  /** 返回本游戏大厅（不离开 LineWeb） */
  onBack?: () => void
  backLabel?: string
  extra?: ReactNode
}

/**
 * 沉浸模式统一顶栏（2026-11-15）。
 * 左侧永远是「← LineWeb」，即使全屏也可见；右侧是退出沉浸 / 返回大厅。
 */
export default function GameImmersiveBar({
  title,
  subtitle,
  immersive,
  onToggleImmersive,
  onExitSite,
  onBack,
  backLabel = '返回大厅',
  extra,
}: Props) {
  return (
    <div className="gh-immerse-bar" role="toolbar" aria-label="沉浸游戏工具栏">
      <button type="button" className="gh-immerse-home" onClick={onExitSite} title="退出沉浸并回到 LineWeb">
        <span aria-hidden>←</span> LineWeb
      </button>
      <div className="gh-immerse-title">
        <strong>{title}</strong>
        {subtitle && <small>{subtitle}</small>}
      </div>
      <div className="gh-immerse-actions">
        {extra}
        {onBack && (
          <button type="button" className="gh-immerse-btn" onClick={onBack}>
            {backLabel}
          </button>
        )}
        <button type="button" className="gh-immerse-btn is-primary" onClick={onToggleImmersive}>
          {immersive ? '退出沉浸' : '沉浸模式'}
        </button>
      </div>
    </div>
  )
}