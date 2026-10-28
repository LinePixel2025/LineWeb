/**
 * 功能开关定义（与 server/src/lib/features.ts 保持一致；一致性由测试兜底）。
 */

export const FEATURE_KEYS = [
  'posts',
  'comments',
  'pages',
  'drive',
  'chat',
  'games',
  'gamesSingle',
  'gamesOnline',
  'aiAssistant',
  'aiChat',
  'webProxy',
  'calculator',
  'oauthApps',
  'registration',
] as const

export type FeatureKey = typeof FEATURE_KEYS[number]

export interface FeatureDefinition {
  key: FeatureKey
  label: string
  description: string
  group: string
}

export const FEATURE_DEFINITIONS: readonly FeatureDefinition[] = [
  { key: 'posts', label: '文章', description: '文章列表、详情、发布与编辑', group: '内容' },
  { key: 'comments', label: '评论', description: '评论树、发表评论与评论管理', group: '内容' },
  { key: 'pages', label: '功能页/自定义页', description: '功能页与动态页面', group: '内容' },
  { key: 'drive', label: '网盘', description: '文件、收藏、上传与下载', group: '内容' },
  { key: 'chat', label: '聊天', description: '私信、群聊、好友、表情与聊天图片', group: '聊天' },
  { key: 'games', label: '游戏（总开关）', description: '游戏大厅、单机与联机游戏', group: '游戏' },
  { key: 'gamesSingle', label: '单机游戏', description: '单机小游戏（依赖游戏总开关）', group: '游戏' },
  { key: 'gamesOnline', label: '联机游戏', description: '好友联机与联机战绩（依赖游戏总开关）', group: '游戏' },
  { key: 'aiAssistant', label: '首页 AI 助手', description: '首页站点问答助手与 AI 写作', group: 'AI' },
  { key: 'aiChat', label: 'AI 对话（DeepSeek）', description: '多会话 AI 对话与联网搜索', group: 'AI' },
  { key: 'webProxy', label: '网页反代', description: '网页代理浏览与站点管理', group: '系统' },
  { key: 'calculator', label: '科学计算器', description: '纯前端科学计算器页面', group: '系统' },
  { key: 'oauthApps', label: '第三方应用授权', description: '授权第三方应用访问账号（已签发令牌不受影响）', group: '系统' },
  { key: 'registration', label: '新用户注册', description: '允许提交新注册申请（登录不受影响）', group: '系统' },
]

export const DEFAULT_FEATURE_MAP = Object.fromEntries(
  FEATURE_KEYS.map((key) => [key, true]),
) as Record<FeatureKey, boolean>

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === 'string' && (FEATURE_KEYS as readonly string[]).includes(value)
}

export function effectiveFeatureEnabled(
  map: Readonly<Record<FeatureKey, boolean>>,
  key: FeatureKey,
): boolean {
  if (key === 'gamesSingle' || key === 'gamesOnline') {
    return map.games !== false && map[key] !== false
  }
  return map[key] !== false
}
