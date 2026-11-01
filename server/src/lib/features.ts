/**
 * 站点功能开关定义（服务端唯一定义，客户端有同拷贝）。
 *
 * 开关是模块级全局开关；管理员不受开关限制（前端与后端都放行）。
 * gamesSingle / gamesOnline 是 games 的子开关，redpacket 是 chat 的子开关，
 * 生效值需同时满足总开关。
 */

export const FEATURE_KEYS = [
  'posts',
  'comments',
  'pages',
  'drive',
  'chat',
  'redpacket',
  'games',
  'gamesSingle',
  'gamesOnline',
  'farm',
  'pet',
  'aiAssistant',
  'aiChat',
  'webProxy',
  'calculator',
  'stock',
  'reader',
  'music',
  'lottery',
  'theme',
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
  { key: 'redpacket', label: '红包', description: '聊天内积分红包（发送 / 领取 / 过期退回，依赖聊天开关）', group: '聊天' },
  { key: 'games', label: '游戏（总开关）', description: '游戏大厅、单机与联机游戏', group: '游戏' },
  { key: 'gamesSingle', label: '单机游戏', description: '单机小游戏（依赖游戏总开关）', group: '游戏' },
  { key: 'gamesOnline', label: '联机游戏', description: '好友联机与联机战绩（依赖游戏总开关）', group: '游戏' },
  { key: 'farm', label: '开心农场', description: '种菜、偷菜与农场扩建（依赖游戏总开关）', group: '游戏' },
  { key: 'pet', label: '宠物', description: '花积分召唤并照顾一只 2D 小宠物：六种物种可随时更换、喂食洗澡换装升级，还能去别人的宠物之家串门撸宠', group: '游戏' },
  { key: 'aiAssistant', label: '首页 AI 助手', description: '首页站点问答助手与 AI 写作', group: 'AI' },
  { key: 'aiChat', label: 'AI 对话（DeepSeek）', description: '多会话 AI 对话与联网搜索', group: 'AI' },
  { key: 'webProxy', label: '网页反代', description: '网页代理浏览与站点管理', group: '系统' },
  { key: 'calculator', label: '科学计算器', description: '纯前端科学计算器页面', group: '系统' },
  { key: 'stock', label: '模拟股市', description: '实时模拟行情（3 秒一跳）+ 积分投资：每日分红、新闻事件与盘中趋势，玩家交易也会影响价格', group: '工具' },
  { key: 'reader', label: '小说阅读器', description: '上传 EPUB/TXT 在线阅读，书架与阅读进度多端同步', group: '内容' },
  { key: 'music', label: '网易云音乐', description: '搜索并播放网易云音乐（扫码绑定个人账号，仅不解灰的接口代理）', group: '工具' },
  { key: 'lottery', label: '积分抽奖', description: '花积分抽奖：种子、肥料、积分与稀有装扮，10 抽保底史诗奖励', group: '游戏' },
  { key: 'theme', label: 'LineWeb 主题', description: '用积分兑换全站主题（极光 / 樱花 / 赛博朋克等），支持全站试穿与一键佩戴', group: '外观' },
  { key: 'oauthApps', label: '第三方应用授权', description: '授权第三方应用访问账号（已签发令牌不受影响）', group: '系统' },
  { key: 'registration', label: '新用户注册', description: '允许提交新注册申请（登录不受影响）', group: '系统' },
]

export const DEFAULT_FEATURE_MAP = Object.fromEntries(
  FEATURE_KEYS.map((key) => [key, true]),
) as Record<FeatureKey, boolean>

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === 'string' && (FEATURE_KEYS as readonly string[]).includes(value)
}

/** 计算某个开关的生效值（gamesSingle / gamesOnline / farm 需要 games 总开关也开启；redpacket 需要 chat 总开关） */
export function effectiveFeatureEnabled(
  map: Readonly<Record<FeatureKey, boolean>>,
  key: FeatureKey,
): boolean {
  if (key === 'gamesSingle' || key === 'gamesOnline' || key === 'farm') {
    return map.games !== false && map[key] !== false
  }
  if (key === 'redpacket') {
    return map.chat !== false && map[key] !== false
  }
  return map[key] !== false
}
