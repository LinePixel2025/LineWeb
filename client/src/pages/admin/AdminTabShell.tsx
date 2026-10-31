import { useSearchParams } from 'react-router-dom'
import { GitHubTabNav } from '../../components/ui'
import { useAuth } from '../../contexts/AuthContext'
import type { Capability } from '../../lib/permissions'

/**
 * 管理面板合并页的通用 Tab 壳：
 * - Tab 按能力过滤（capability 缺省 = 仅靠路由守卫）；
 * - 当前 tab 持久化到 URL 查询参数 ?tab=（刷新/分享保持）；
 * - 仅渲染激活 Tab 的内容组件，切换即卸载重挂（各 Panel 自带加载逻辑）。
 */
export interface AdminTabDef {
  value: string
  label: string
  /** 可见所需能力；缺省表示路由守卫已足够 */
  capability?: Capability
  content: React.ReactNode
}

export default function AdminTabShell({ tabs }: { tabs: AdminTabDef[] }) {
  const { can } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  const visible = tabs.filter(t => !t.capability || can(t.capability))
  const raw = searchParams.get('tab')
  const active = visible.some(t => t.value === raw) ? (raw as string) : (visible[0]?.value ?? '')

  return (
    <div>
      {visible.length > 1 && (
        <GitHubTabNav
          tabs={visible.map(t => ({ value: t.value, label: t.label }))}
          active={active}
          onChange={value => setSearchParams({ tab: value })}
        />
      )}
      {visible.map(t => (t.value === active ? <div key={t.value}>{t.content}</div> : null))}
    </div>
  )
}
