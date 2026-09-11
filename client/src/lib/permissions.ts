/**
 * 客户端能力常量（与 server/src/lib/permissions.ts 保持一致）
 *
 * LineWeb 只使用账号登录令牌，权限由账号角色的能力清单决定：
 * 后端在每个请求上解析 capabilities，前端用同一套常量做导航过滤与路由守卫。
 */

export const CAPABILITIES = [
  'content:write',
  'comment:moderate',
  'user:manage',
  'stats:view',
  'device:view',
  'ai:configure',
  'drive:all',
] as const

export type Capability = typeof CAPABILITIES[number]

export const CAPABILITY_LABELS: Record<Capability, string> = {
  'content:write': '内容编辑（文章 / 页面）',
  'comment:moderate': '评论管理',
  'user:manage': '用户管理',
  'stats:view': '站点统计',
  'device:view': '设备监控',
  'ai:configure': 'AI 配置',
  'drive:all': '网盘全量访问',
}

export const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
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
