/**
 * 第三方应用授权 —— 权限范围（scope）与端点白名单（唯一真相源）
 *
 * 第三方应用通过 OAuth 2.0 授权码 + PKCE 流程拿到「应用令牌」，而不是用户的登录密码。
 * 应用令牌的能力被两道闸门收口：
 *   1. scope：应用能申请哪些权限（本文件 APP_SCOPES），由同意的用户在授权页逐条确认；
 *   2. 端点白名单：应用令牌只能访问 APP_ENDPOINT_RULES 里列出的端点。
 *
 * 设计原则：默认拒绝。没有出现在白名单里的端点，应用令牌一律 403，
 * 因此用户管理、设备监控、站点统计、AI 配置、网盘同步等管理能力
 * 永远不可能被第三方应用触达。
 */

import { capabilitiesForRole, type Capability } from './permissions.js'

export const APP_SCOPES = [
  'profile:read',
  'content:read',
  'comment:write',
  'health:read',
  'health:write',
  'drive:read',
  'drive:write',
  'content:write',
  'comment:moderate',
] as const

export type AppScope = typeof APP_SCOPES[number]

/** 判断字符串是否为已知 scope */
export function isAppScope(value: unknown): value is AppScope {
  return typeof value === 'string' && (APP_SCOPES as readonly string[]).includes(value)
}

/** 短标签 —— 用于授权页的权限列表标题 */
export const APP_SCOPE_LABELS: Record<AppScope, string> = {
  'profile:read': '读取你的个人资料',
  'content:read': '读取站点内容与评论',
  'comment:write': '以你的身份发表评论',
  'health:read': '读取你的屏幕时间数据',
  'health:write': '上报你的屏幕时间数据',
  'drive:read': '读取你的网盘文件',
  'drive:write': '管理你的网盘文件',
  'content:write': '管理自己的文章',
  'comment:moderate': '管理全部评论',
}

/** 详细说明 —— 授权页每条权限的副文案 */
export const APP_SCOPE_DESCRIPTIONS: Record<AppScope, string> = {
  'profile:read': '读取你的用户名、邮箱、角色与头像',
  'content:read': '读取已发布的文章、页面与评论',
  'comment:write': '以你的账号发表评论',
  'health:read': '读取你的屏幕使用时间与每日目标',
  'health:write': '上报屏幕使用时间、设置每日目标',
  'drive:read': '列出、搜索并下载你自己的网盘文件',
  'drive:write': '上传、新建文件夹、重命名、移动或删除你自己的网盘文件',
  'content:write': '创建、编辑、删除自己的文章，并可调用 AI 写作辅助',
  'comment:moderate': '编辑或删除任意用户的评论',
}

/** 高危权限 —— 授权页会高亮提示，需用户明确确认 */
export const HIGH_RISK_APP_SCOPES: readonly AppScope[] = ['content:write', 'comment:moderate']

/**
 * 能力派生 scope —— 这两项要求「账号本身先具备同名能力」才能授权：
 * 普通用户无法把 content:write 授予应用，只有具备该能力的账号（如作者、管理员）可以。
 */
export const CAPABILITY_SCOPES: readonly AppScope[] = ['content:write', 'comment:moderate']

/** 取 scope 对应的账号能力（非能力派生 scope 返回 null） */
export function scopeRequiresCapability(scope: AppScope): Capability | null {
  if (scope === 'content:write' || scope === 'comment:moderate') return scope
  return null
}

/**
 * 网盘 scope —— 除 scope 本身外还受账号 canAccessDrive 开关约束，
 * 且始终只能访问本人上传的文件（应用令牌不具备 drive:all，不享受越权豁免）。
 */
export const DRIVE_SCOPES: readonly AppScope[] = ['drive:read', 'drive:write']

/** 账号当前能力所能支撑的能力派生 scope */
export function scopesFromCapabilities(capabilities: Capability[]): AppScope[] {
  return CAPABILITY_SCOPES.filter((scope) => {
    const required = scopeRequiresCapability(scope)
    return required !== null && capabilities.includes(required)
  })
}

/** 请求的 scope 中，账号目前并不具备对应能力的那部分（用于授权时拒绝） */
export function scopesRequiringUnmetCapabilities(
  scopes: AppScope[],
  capabilities: Capability[],
): AppScope[] {
  const capabilitySet = new Set(capabilities)
  return scopes.filter((scope) => {
    const required = scopeRequiresCapability(scope)
    return required !== null && !capabilitySet.has(required)
  })
}

/** 安全解析数据库里存的 scope JSON 数组，非法内容一律丢弃且不抛错 */
export function parseStoredScopes(raw: string): AppScope[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isAppScope)
  } catch {
    return []
  }
}

/** 带 role 的实际能力（供中间件做能力派生 scope 的实时交集） */
export function scopesForRole(role: string): AppScope[] {
  return scopesFromCapabilities(capabilitiesForRole(role))
}

export interface AppEndpointRule {
  method: string
  pattern: RegExp
  scope: AppScope
}

/**
 * 应用令牌端点白名单 —— 第三方应用唯一可达的 API 面。
 *
 * pattern 匹配的是完整路径 `${req.baseUrl}${req.path}`（如 /api/drive/files），
 * 与 middleware/auth.ts 中下载票据的判断方式一致。
 *
 * 未列入此表的端点对应用令牌一律拒绝，包括（但不限于）：
 *   /api/users、/api/devices、/api/stats、/api/ai/config、
 *   /api/pages/*（页面管理 = content:manage，应用永远不可达）、
 *   /api/drive/sync、/api/drive/resolve-path、/api/drive/download-ticket/*、
 *   /api/drive/favorites/*、/api/oauth/*（应用不能自我提权）、
 *   /api/auth/profile、/api/auth/settings、/api/auth/logout（应用不能改密或把你登出）、
 *   POST/DELETE /api/auth/avatar，以及 /api 自描述端点。
 */
export const APP_ENDPOINT_RULES: readonly AppEndpointRule[] = [
  // === GET ===
  { method: 'GET', pattern: /^\/api\/auth\/me$/, scope: 'profile:read' },
  { method: 'GET', pattern: /^\/api\/auth\/avatar(\/\d+)?$/, scope: 'profile:read' },
  { method: 'GET', pattern: /^\/api\/comments$/, scope: 'content:read' },
  { method: 'GET', pattern: /^\/api\/comments\/post\/\d+$/, scope: 'content:read' },
  { method: 'GET', pattern: /^\/api\/posts$/, scope: 'content:read' },
  // 详情：排除管理路径 /api/posts/admin*
  { method: 'GET', pattern: /^\/api\/posts\/(?!admin(?:\/|$))[^/]+$/, scope: 'content:read' },
  { method: 'GET', pattern: /^\/api\/pages\/featured$/, scope: 'content:read' },
  { method: 'GET', pattern: /^\/api\/pages\/slug\/[^/]+$/, scope: 'content:read' },
  { method: 'GET', pattern: /^\/api\/posts\/admin(\/all|\/\d+)?$/, scope: 'content:write' },
  { method: 'GET', pattern: /^\/api\/comments\/admin\/.+$/, scope: 'comment:moderate' },
  { method: 'GET', pattern: /^\/api\/health\/screen-time(\/range)?$/, scope: 'health:read' },
  { method: 'GET', pattern: /^\/api\/health\/daily-goal$/, scope: 'health:read' },
  { method: 'GET', pattern: /^\/api\/drive\/files$/, scope: 'drive:read' },
  { method: 'GET', pattern: /^\/api\/drive\/files\/\d+$/, scope: 'drive:read' },
  { method: 'GET', pattern: /^\/api\/drive\/search$/, scope: 'drive:read' },
  { method: 'GET', pattern: /^\/api\/drive\/fts-search$/, scope: 'drive:read' },
  { method: 'GET', pattern: /^\/api\/drive\/files\/\d+\/download$/, scope: 'drive:read' },
  { method: 'GET', pattern: /^\/api\/drive\/download\/\d+$/, scope: 'drive:read' },

  // === POST ===
  { method: 'POST', pattern: /^\/api\/posts$/, scope: 'content:write' },
  { method: 'POST', pattern: /^\/api\/ai\/write\/(summary|polish|titles|draft)$/, scope: 'content:write' },
  { method: 'POST', pattern: /^\/api\/comments$/, scope: 'comment:write' },
  { method: 'POST', pattern: /^\/api\/health\/push$/, scope: 'health:write' },
  { method: 'POST', pattern: /^\/api\/drive\/folders$/, scope: 'drive:write' },
  { method: 'POST', pattern: /^\/api\/drive\/files$/, scope: 'drive:write' },
  { method: 'POST', pattern: /^\/api\/drive\/upload$/, scope: 'drive:write' },

  // === PUT ===
  { method: 'PUT', pattern: /^\/api\/posts\/\d+$/, scope: 'content:write' },
  { method: 'PUT', pattern: /^\/api\/comments\/\d+$/, scope: 'comment:moderate' },
  { method: 'PUT', pattern: /^\/api\/health\/daily-goal$/, scope: 'health:write' },
  { method: 'PUT', pattern: /^\/api\/drive\/files\/\d+$/, scope: 'drive:write' },

  // === DELETE ===
  { method: 'DELETE', pattern: /^\/api\/posts\/\d+$/, scope: 'content:write' },
  { method: 'DELETE', pattern: /^\/api\/comments\/\d+$/, scope: 'comment:moderate' },
  { method: 'DELETE', pattern: /^\/api\/drive\/files\/\d+$/, scope: 'drive:write' },
]

/**
 * 应用令牌访问该端点所需的 scope；null 表示该端点不允许应用访问
 *
 * 末尾斜杠容错：路由挂在 /api/posts 时，POST /api/posts 在路由内看到的
 * 路径是 '/'，拼接后为 '/api/posts/'，需与 '/api/posts' 等同处理。
 */
export function requiredScopeForEndpoint(method: string, fullPath: string): AppScope | null {
  const upperMethod = method.toUpperCase()
  const normalized = fullPath.length > 1 && fullPath.endsWith('/')
    ? fullPath.slice(0, -1)
    : fullPath
  for (const rule of APP_ENDPOINT_RULES) {
    if (rule.method !== upperMethod) continue
    if (rule.pattern.test(normalized)) return rule.scope
  }
  return null
}
