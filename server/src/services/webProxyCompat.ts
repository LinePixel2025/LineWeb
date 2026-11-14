/**
 * 网页反代 — 兼容模式判定（纯函数）
 *
 * 老旧 WebView（Android 4.4 / iOS 9 级别）跑不动站点自身的 ES2017+ bundle，
 * 也没有 fetch / Promise / URL 等 API。legacy 模式下服务端会：
 *   - 用 Babel 把外部 JS 与内联脚本转译成 ES5；
 *   - 注入 polyfill bundle；
 *   - 引导脚本启用无 MSE 原生播放适配。
 *
 * 判定基于「原始客户端 UA」——forceDesktop 只覆盖发往上游的 UA，不影响这里，
 * 否则老设备会被伪装成桌面 Chrome 而漏判。站点可显式 legacy/modern 覆盖自动判定；
 * `?lw_compat=legacy|modern` 为测试钩子，优先级最高。
 */

export type CompatMode = 'auto' | 'legacy' | 'modern'
export type EffectiveCompat = 'legacy' | 'modern'

/** 站点 bundle 普遍要求 ES2017+，这里取一个偏保守的现代引擎下限 */
const MIN_CHROME = 64
const MIN_IOS = 13
const MIN_ANDROID = 7
const MIN_FIREFOX = 60
const MIN_SAFARI = 12

/** 原始客户端 UA 是否属于老旧引擎（无法判定时按现代处理，避免误转译） */
export function isLegacyUserAgent(ua: string | undefined): boolean {
  if (!ua) return false
  const s = ua.toLowerCase()
  // iOS（含 iPadOS 13 以下）：按系统版本判定，优先于 CriOS 等浏览器版本号
  const ios = /(?:iphone|ipad|ipod).*?os (\d+)[._](\d+)/.exec(s)
  if (ios) return Number(ios[1]) < MIN_IOS
  // Android：老系统且无现代 Chrome 内核
  const android = /android (\d+)/.exec(s)
  if (android && Number(android[1]) < MIN_ANDROID) return true
  // Chrome / Chromium / Edge（Edg）
  const chrome = /(?:chrome|chromium|crios|edg)\/(\d+)/.exec(s)
  if (chrome) return Number(chrome[1]) < MIN_CHROME
  // Firefox
  const firefox = /firefox\/(\d+)/.exec(s)
  if (firefox) return Number(firefox[1]) < MIN_FIREFOX
  // macOS Safari
  const safari = /version\/(\d+).*safari/.exec(s)
  if (safari) return Number(safari[1]) < MIN_SAFARI
  return false
}

/** 解析本次请求的有效兼容模式 */
export function resolveCompatMode(
  siteMode: string | undefined,
  ua: string | undefined,
  queryOverride?: string | null,
): EffectiveCompat {
  if (queryOverride === 'legacy') return 'legacy'
  if (queryOverride === 'modern') return 'modern'
  if (siteMode === 'legacy') return 'legacy'
  if (siteMode === 'modern') return 'modern'
  return isLegacyUserAgent(ua) ? 'legacy' : 'modern'
}
