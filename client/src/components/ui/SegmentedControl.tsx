interface Segment {
  value: string
  label: string
  count?: number
}

interface SegmentedControlProps {
  tabs: Segment[]
  active: string
  onChange: (value: string) => void
  className?: string
}

/**
 * iOS 分段控件（替代旧的下划线 TabNav）。
 * 语义仍是「视图切换」，因此保留 nav + button，不伪装成 tablist。
 */
export default function SegmentedControl({ tabs, active, onChange, className = '' }: SegmentedControlProps) {
  return (
    <nav className={`gh-tabnav ${className}`} aria-label="视图切换">
      {tabs.map(tab => (
        <button
          key={tab.value}
          className={`gh-tabnav-item ${tab.value === active ? 'gh-tabnav-item--active' : ''}`}
          onClick={() => onChange(tab.value)}
          type="button"
          aria-pressed={tab.value === active}
        >
          <span>{tab.label}</span>
          {tab.count !== undefined && <span className="gh-tabnav-count">{tab.count}</span>}
        </button>
      ))}
    </nav>
  )
}
