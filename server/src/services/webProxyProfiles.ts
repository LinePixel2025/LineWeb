/**
 * 网页反代 — 站点档案（多域名生态）
 *
 * 单一注册域（eTLD+1）的「站点族」不足以覆盖抖音 / B 站这类把页面、接口、
 * 静态资源、视频、风控分散在多个独立注册域上的站点：
 *   - 抖音：douyin.com（页面）+ douyinpic/douyinstatic（静态）+ douyinvod/zjcdn（视频）
 *     + snssdk/amemv/bytedance（接口 / 风控 / ttwid）；
 *   - B 站：bilibili.com（页面 / 接口）+ hdslb/biliimg（静态）+ bilivideo/acgvideo（视频）。
 *
 * 档案把主机后缀分成三类，供 HTML/CSS 重写、引导脚本与路由共同使用：
 *   - page：页面 / 接口 / WebSocket → 内嵌主机反代（带 Cookie 罐、可改写）；
 *   - resource：静态资源 → 同源资源代理（带 Referer 防盗链规则）；
 *   - media：音视频 / 清单 → 同源媒体代理（保留 Range、独立超时）。
 *
 * 通用站点没有档案（profileForOrigin 返回 null），行为与旧版完全一致。
 * 这里只做纯函数；SSRF / 黑名单仍由路由逐跳 assertPublicHost 校验，档案不放松安全边界。
 */

import { hostMatchesSuffix } from './webProxyHosts.js'
import { registrableDomainOf } from './webProxyService.js'

export type ProfileHostClass = 'page' | 'resource' | 'media'

export interface SiteProfile {
  id: string
  /** 触发本档案的站点注册域（siteFamilyOf(origin) 命中其一即启用） */
  families: string[]
  /** 页面 / 接口 / WS 主机后缀 → 内嵌主机反代 */
  pageHosts: string[]
  /** 静态资源主机后缀 → 同源资源代理 */
  resourceHosts: string[]
  /** 音视频 / 清单主机后缀 → 同源媒体代理 */
  mediaHosts: string[]
  /** 同主机「无扩展名」媒体路径（如抖音 /aweme/v1/play/?video_id=…） */
  mediaPathPatterns: RegExp[]
}

const BILIBILI_PROFILE: SiteProfile = {
  id: 'bilibili',
  families: ['bilibili.com', 'bilibili.tv'],
  pageHosts: ['bilibili.com', 'bilibili.tv'],
  resourceHosts: ['hdslb.com', 'biliimg.com'],
  mediaHosts: ['bilivideo.com', 'bilivideo.cn', 'acgvideo.com'],
  mediaPathPatterns: [],
}

const DOUYIN_PROFILE: SiteProfile = {
  id: 'douyin',
  families: ['douyin.com'],
  pageHosts: [
    'douyin.com', 'snssdk.com', 'amemv.com', 'bytedance.com', 'toutiao.com',
    'bytegoofy.com', 'bytedns.net', 'volces.com',
  ],
  resourceHosts: ['douyinpic.com', 'douyinstatic.com', 'bytecdn.cn', 'byteimg.com', 'pstatp.com'],
  mediaHosts: ['douyinvod.com', 'zjcdn.com', 'ixigua.com', 'douyinliving.com', 'douyincdn.com'],
  mediaPathPatterns: [/\/aweme\/v1\/play\//i, /[?&]video_id=/i],
}

const PROFILES: SiteProfile[] = [BILIBILI_PROFILE, DOUYIN_PROFILE]

/** 按注册域取档案；无匹配返回 null（通用站点） */
export function profileForFamily(family: string | null | undefined): SiteProfile | null {
  if (!family) return null
  const value = family.toLowerCase()
  for (const profile of PROFILES) {
    if (profile.families.some((item) => item === value)) return profile
  }
  return null
}

/** 按站点 origin 取档案 */
export function profileForOrigin(origin: string): SiteProfile | null {
  try {
    return profileForFamily(registrableDomainOf(new URL(origin).hostname))
  } catch {
    return null
  }
}

/** 主机后缀属于档案的哪一类；都不命中返回 null */
export function classifyProfileHost(profile: SiteProfile, hostname: string): ProfileHostClass | null {
  const host = String(hostname || '').toLowerCase()
  if (!host) return null
  if (profile.pageHosts.some((suffix) => hostMatchesSuffix(host, suffix))) return 'page'
  if (profile.resourceHosts.some((suffix) => hostMatchesSuffix(host, suffix))) return 'resource'
  if (profile.mediaHosts.some((suffix) => hostMatchesSuffix(host, suffix))) return 'media'
  return null
}

/** 该 URL 是否命中档案的「无扩展名媒体路径」（按 pathname + search 匹配） */
export function isProfileMediaPath(profile: SiteProfile, url: URL): boolean {
  if (profile.mediaPathPatterns.length === 0) return false
  const target = `${url.pathname || ''}${url.search || ''}`
  return profile.mediaPathPatterns.some((re) => re.test(target))
}

/** 档案 page 主机后缀（用于内嵌主机白名单与跨域 Cookie 放松） */
export function profilePageSuffixes(profile: SiteProfile | null | undefined): string[] {
  return profile ? profile.pageHosts : []
}
