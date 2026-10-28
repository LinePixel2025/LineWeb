/**
 * 网页反代 — 已知 CDN 的兼容规则
 *
 * 有些站点把图片 / 静态资源挂在独立 CDN 上，并且**按 Referer 防盗链**：
 * 例如 B 站的 `hdslb.com`，Referer 不是 `*.bilibili.com` 时直接回 403
 * （实测：无 Referer → 200，`https://example.com/` → 403，`https://www.bilibili.com/` → 200）。
 * 反代页面本身是 LineWeb 域名，浏览器直连这些 CDN 会全部拿不到图。
 *
 * 这里集中两件事：
 *   1. `refererRuleForHost()`：媒体 / 资源代理请求这类 CDN 时改用它认的 Referer；
 *   2. `RESOURCE_CDN_SUFFIXES`：HTML 懒加载属性（data-src 等）与页面脚本里动态
 *      拼出来的地址也要改写进同源资源代理（否则浏览器仍会直连 CDN）。
 *
 * 仅收录「确认按 Referer 防盗链、且与反代站点可能混用」的公开资源 CDN；
 * 新增规则时同步考虑 XSS 边界（资源代理本身仍然拒绝 HTML / SVG）。
 */

export interface RefererRule {
  /** 该 CDN 认的 Referer（通常是内容站的标准首页） */
  referer: string
  /** 浏览器/上游本来就会带、且 CDN 接受的 Referer 主机后缀；命中时保持原样 */
  acceptedRefererSuffixes: string[]
}

interface HostRule extends RefererRule {
  /** 命中的 CDN 主机后缀（含所有子域） */
  suffixes: string[]
}

const BILIBILI_REFERER = 'https://www.bilibili.com/'
const BILIBILI_ACCEPTED = ['bilibili.com', 'bilibili.tv', 'hdslb.com']

/** 按 Referer 防盗链的资源 CDN 规则表（顺序敏感：先匹配先返回） */
const HOST_RULES: HostRule[] = [
  {
    // B 站图床 / 静态资源 CDN（i0/i1/s1.hdslb.com 等）
    suffixes: ['hdslb.com', 'biliimg.com'],
    referer: BILIBILI_REFERER,
    acceptedRefererSuffixes: BILIBILI_ACCEPTED,
  },
  {
    // B 站视频切片 CDN（upos-*.bilivideo.com 等）
    suffixes: ['bilivideo.com'],
    referer: BILIBILI_REFERER,
    acceptedRefererSuffixes: BILIBILI_ACCEPTED,
  },
]

/**
 * 需要在页面脚本里也改写进资源代理的 CDN 主机后缀。
 * 只放静态资源类 CDN：接口域名（api.*）不改写，避免把 JSON 请求变成同源代理。
 */
export const RESOURCE_CDN_SUFFIXES: string[] = ['hdslb.com', 'biliimg.com']

/** host 是否等于 suffix 或它的子域（大小写不敏感） */
export function hostMatchesSuffix(host: string, suffix: string): boolean {
  const value = String(host || '').toLowerCase().replace(/\.$/, '')
  const tail = String(suffix || '').toLowerCase().replace(/^\./, '')
  if (!value || !tail) return false
  return value === tail || value.endsWith(`.${tail}`)
}

function hostOf(value: string | undefined): string {
  if (!value) return ''
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function refererRuleForHost(hostname: string): RefererRule | null {
  const host = String(hostname || '').toLowerCase()
  if (!host) return null
  for (const rule of HOST_RULES) {
    if (rule.suffixes.some((suffix) => hostMatchesSuffix(host, suffix))) return rule
  }
  return null
}

/** 是否属于「必须走同源资源代理」的已知资源 CDN */
export function isResourceCdnHost(hostname: string): boolean {
  const host = String(hostname || '').toLowerCase()
  if (!host) return false
  return RESOURCE_CDN_SUFFIXES.some((suffix) => hostMatchesSuffix(host, suffix))
}

/**
 * 计算发往该 CDN 的 Referer 覆盖值。
 *
 * 当前 Referer 已经是 CDN 认的来源（如反代的本来就是 B 站）时返回 null，
 * 保持原有「页面地址还原成上游地址」的语义；否则返回该 CDN 的标准 Referer。
 */
export function refererOverrideFor(
  targetHost: string,
  currentReferer: string | undefined,
): { referer: string; origin: string } | null {
  const rule = refererRuleForHost(targetHost)
  if (!rule) return null
  const refererHost = hostOf(currentReferer)
  if (refererHost && rule.acceptedRefererSuffixes.some((suffix) => hostMatchesSuffix(refererHost, suffix))) {
    return null
  }
  let origin = ''
  try {
    origin = new URL(rule.referer).origin
  } catch {
    origin = ''
  }
  return { referer: rule.referer, origin }
}
