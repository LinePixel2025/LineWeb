interface Tab {
  value: string
  label: string
  count?: number
}

interface GitHubTabNavProps {
  tabs: Tab[]
  active: string
  onChange: (value: string) => void
  className?: string
}

export default function GitHubTabNav({ tabs, active, onChange, className = '' }: GitHubTabNavProps) {
  return (
    <nav className={`gh-tabnav ${className}`}>
      {tabs.map(tab => (
        <button
          key={tab.value}
          className={`gh-tabnav-item ${tab.value === active ? 'gh-tabnav-item--active' : ''}`}
          onClick={() => onChange(tab.value)}
          type="button"
        >
          <span>{tab.label}</span>
          {tab.count !== undefined && <span className="gh-tabnav-count">{tab.count}</span>}
        </button>
      ))}
    </nav>
  )
}
