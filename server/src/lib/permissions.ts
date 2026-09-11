/**
 * 角色 → 能力矩阵（认证授权唯一真相源）
 *
 * 设计目标：LineWeb 只使用「账号登录令牌」一种凭证，
 * 令牌能访问哪些端点完全由账号角色的能力决定。
 * 新增角色（如 editor）只需在 ROLE_CAPABILITIES 增加一行 + 在 USER_ROLES 登记，
 * 路由与前端守卫都通过能力判断，不需要再散落 `role === 'admin'` 之类的硬编码。
 */

export const USER_ROLES = ['user', 'admin'] as const

export type UserRole = typeof USER_ROLES[number]

export const CAPABILITIES = [
  'content:write',    // 文章 / 页面 增删改 + AI 写作辅助
  'comment:moderate', // 评论审核 / 编辑 / 删除
  'user:manage',      // 用户管理（角色、网盘开关、头像）
  'stats:view',       // Dashboard 统计
  'device:view',      // 设备监控
  'ai:configure',     // AI 配置读写
  'drive:all',        // 网盘：豁免 canAccessDrive + 可操作他人文件
] as const

export type Capability = typeof CAPABILITIES[number]

/** 角色拥有全部能力的写法：admin 自动全权 */
const ALL_CAPABILITIES: readonly Capability[] = CAPABILITIES

const ROLE_CAPABILITIES: Record<UserRole, readonly Capability[]> = {
  user: [],
  admin: ALL_CAPABILITIES,
}

/** 判断字符串是否为已知角色 */
export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value)
}

/** 取某角色的能力清单（未知角色返回空数组，即只有登录态、无额外权限） */
export function capabilitiesForRole(role: string): Capability[] {
  if (!isUserRole(role)) return []
  return [...ROLE_CAPABILITIES[role]]
}

/** 角色是否具备指定能力（热路径：避免每次调用都复制数组） */
export function roleHasCapability(role: string, capability: Capability): boolean {
  if (!isUserRole(role)) return false
  return ROLE_CAPABILITIES[role].includes(capability)
}
