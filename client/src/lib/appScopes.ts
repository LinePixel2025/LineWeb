/**
 * 第三方应用权限范围（客户端副本）
 *
 * 服务端 `server/src/lib/appScopes.ts` 是唯一真相源，客户端保留一份拷贝
 * 用于授权页与后台应用管理页的渲染；`__tests__/appScopes.test.ts` 会直接读
 * 服务端源码断言两份清单完全一致，服务端改错时测试会失败。
 */

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

export const APP_SCOPE_LABELS: Record<AppScope, string> = {
  'profile:read': '读取你的个人资料',
  'content:read': '读取站点内容与评论',
  'comment:write': '以你的身份发表评论',
  'health:read': '读取你的屏幕时间数据',
  'health:write': '上报你的屏幕时间数据',
  'drive:read': '读取你的网盘文件',
  'drive:write': '管理你的网盘文件',
  'content:write': '管理站点内容（文章与页面）',
  'comment:moderate': '管理全部评论',
}

export const APP_SCOPE_DESCRIPTIONS: Record<AppScope, string> = {
  'profile:read': '读取你的用户名、邮箱、角色与头像',
  'content:read': '读取已发布的文章、页面与评论',
  'comment:write': '以你的账号发表评论',
  'health:read': '读取你的屏幕使用时间与每日目标',
  'health:write': '上报屏幕使用时间、设置每日目标',
  'drive:read': '列出、搜索并下载你自己的网盘文件',
  'drive:write': '上传、新建文件夹、重命名、移动或删除你自己的网盘文件',
  'content:write': '创建、编辑、删除文章与页面，并可调用 AI 写作辅助',
  'comment:moderate': '编辑或删除任意用户的评论',
}

/** 高危权限：会在授权页高亮提示 */
export const HIGH_RISK_APP_SCOPES: readonly AppScope[] = ['content:write', 'comment:moderate']

/** 需账号本身先具备同名能力才能授权的能力派生权限 */
export const CAPABILITY_APP_SCOPES: readonly AppScope[] = ['content:write', 'comment:moderate']

/** 是否为高危权限（未知 scope 一律按非高危处理） */
export function isHighRiskScope(scope: string): boolean {
  return (HIGH_RISK_APP_SCOPES as readonly string[]).includes(scope)
}

/** 是否为已知 scope */
export function isKnownAppScope(scope: string): scope is AppScope {
  return (APP_SCOPES as readonly string[]).includes(scope)
}

/** 权限中文名（未知 scope 回退为原始名，避免显示空白） */
export function appScopeLabel(scope: string): string {
  return isKnownAppScope(scope) ? APP_SCOPE_LABELS[scope] : scope
}

/** 权限详细说明（未知 scope 返回空串） */
export function appScopeDescription(scope: string): string {
  return isKnownAppScope(scope) ? APP_SCOPE_DESCRIPTIONS[scope] : ''
}

/** 授权页展示用排序：常规权限在前，高危权限统一排在最后，避免用户略过 */
export function sortScopesForDisplay(scopes: string[]): string[] {
  return [...scopes].sort((a, b) => Number(isHighRiskScope(a)) - Number(isHighRiskScope(b)))
}
