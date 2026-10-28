/**
 * 客户端能力常量（与 server/src/lib/permissions.ts 保持一致）
 *
 * LineWeb 只使用账号登录令牌，权限由账号角色的能力清单决定：
 * 后端在每个请求上解析 capabilities，前端用同一套常量做导航过滤与路由守卫。
 */

export const CAPABILITIES = [
  'content:write',
  'content:manage',
  'comment:moderate',
  'user:manage',
  'stats:view',
  'device:view',
  'ai:configure',
  'drive:all',
  'app:manage',
  'proxy:manage',
  'feature:manage',
] as const

export type Capability = typeof CAPABILITIES[number]

export const CAPABILITY_LABELS: Record<Capability, string> = {
  'content:write': '内容编辑（自己的文章）',
  'content:manage': '内容管理（全站文章 / 页面）',
  'comment:moderate': '评论管理',
  'user:manage': '用户管理',
  'stats:view': '站点统计',
  'device:view': '设备监控',
  'ai:configure': 'AI 配置',
  'drive:all': '网盘全量访问',
  'app:manage': '应用授权管理',
  'proxy:manage': '网页反代管理',
  'feature:manage': '功能开关管理',
}

export const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  author: '作者',
  user: '用户',
}

export interface AuthCapableUser {
  role?: string
  capabilities?: string[]
}

/** 当前账号是否具备某项能力（未登录 / 无能力清单时返回 false） */
export function hasCapability(
  user: AuthCapableUser | null | undefined,
  capability: Capability,
): boolean {
  if (!user) return false
  return Array.isArray(user.capabilities) && user.capabilities.includes(capability)
}

/** 当前账号是否具备任意管理能力（用于 /admin 守卫） */
export function hasAnyCapability(user: AuthCapableUser | null | undefined): boolean {
  if (!user) return false
  return Array.isArray(user.capabilities) && user.capabilities.length > 0
}

/** 能力中文名（未知能力回退为原始名） */
export function capabilityLabel(capability: string): string {
  return CAPABILITY_LABELS[capability as Capability] ?? capability
}

/** 角色中文名 */
export function roleLabel(role: string | undefined): string {
  return role ? (ROLE_LABELS[role] ?? role) : '未知'
}

/**
 * 管理区路径 → 所需能力（按最长前缀匹配；`null` 表示管理区账号均可访问）
 *
 * 导航过滤（AdminLayout / GitHubSidebar）与路由守卫（Guards.AdminCapabilityRoute）
 * 共用这一张表，避免「导航隐藏了但路由还能进」或反过来的偏差。
 */
export const ADMIN_ROUTE_CAPABILITIES: { prefix: string; capability: Capability | null }[] = [
  { prefix: '/admin/new', capability: 'content:write' },
  { prefix: '/admin/edit', capability: 'content:write' },
  { prefix: '/admin/pages', capability: 'content:manage' },
  { prefix: '/admin/comments', capability: 'comment:moderate' },
  { prefix: '/admin/users', capability: 'user:manage' },
  { prefix: '/admin/devices', capability: 'device:view' },
  { prefix: '/admin/ai', capability: 'ai:configure' },
  { prefix: '/admin/ai-chat', capability: 'ai:configure' },
  { prefix: '/admin/apps', capability: 'app:manage' },
  { prefix: '/admin/proxy', capability: 'proxy:manage' },
  { prefix: '/admin/features', capability: 'feature:manage' },
  { prefix: '/admin/api', capability: null },        // API 接入指南：任何管理区账号可见
  { prefix: '/admin', capability: 'content:write' }, // 文章管理（含 /admin 首页）
]

/** 取路径所需能力：undefined = 非管理区路径（不做能力判断） */
export function capabilityForAdminPath(pathname: string): Capability | null | undefined {
  let matched: { prefix: string; capability: Capability | null } | undefined
  for (const entry of ADMIN_ROUTE_CAPABILITIES) {
    const isMatch = pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`)
    if (isMatch && (!matched || entry.prefix.length > matched.prefix.length)) matched = entry
  }
  return matched?.capability
}

/** 当前账号能否访问某个管理区路径（非管理区路径一律返回 true） */
export function canAccessAdminPath(user: AuthCapableUser | null | undefined, pathname: string): boolean {
  const capability = capabilityForAdminPath(pathname)
  if (capability === undefined) return true
  if (capability === null) return hasAnyCapability(user)
  return hasCapability(user, capability)
}

/** 当前账号可进入的第一个管理区路径（用作越权访问时的回退落点） */
export function firstAllowedAdminPath(user: AuthCapableUser | null | undefined): string {
  const entry = ADMIN_ROUTE_CAPABILITIES.find((item) => {
    if (item.prefix === '/admin') return false // 优先精确子页面，避免又回到需要 content:write 的首页
    if (item.capability === null) return hasAnyCapability(user)
    return hasCapability(user, item.capability)
  })
  return entry?.prefix ?? '/'
}
