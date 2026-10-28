import api from './api'

/**
 * 网页反代（/api/proxy）客户端封装
 *
 * 站点与登录态（Cookie 罐）都保存在账号下；浏览器只拿到 httpOnly 的
 * `lw_proxy` 会话 Cookie，真正的站点登录 Cookie 始终留在服务端。
 */

export interface ProxySite {
  id: number
  name: string
  /** 上游源站，形如 https://example.com */
  origin: string
  host: string
  /** 服务端保存的 Cookie 条数（仅用于展示） */
  cookieCount: number
  /** 是否强制使用桌面浏览器 UA 打开上游站点 */
  forceDesktop: boolean
  lastVisitedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ProxySiteListResponse {
  sites: ProxySite[]
}

export interface ProxyOpenResponse {
  /** iframe 地址：/proxy/<siteId>/ */
  url: string
  site: ProxySite
}

export const webProxyApi = {
  list: () => api.get<ProxySiteListResponse>('/proxy/sites'),
  create: (url: string, name?: string, forceDesktop?: boolean) =>
    api.post<{ site: ProxySite }>('/proxy/sites', {
      url,
      name: name?.trim() || undefined,
      forceDesktop: forceDesktop ? true : undefined,
    }),
  rename: (siteId: number, name: string) =>
    api.patch<{ site: ProxySite }>(`/proxy/sites/${siteId}`, { name }),
  setDesktop: (siteId: number, forceDesktop: boolean) =>
    api.patch<{ site: ProxySite }>(`/proxy/sites/${siteId}`, { forceDesktop }),
  remove: (siteId: number) => api.delete<void>(`/proxy/sites/${siteId}`),
  clearCookies: (siteId: number) => api.delete<{ ok: boolean }>(`/proxy/sites/${siteId}/cookies`),
  open: (siteId: number) => api.post<ProxyOpenResponse>(`/proxy/sites/${siteId}/open`),
}

/**
 * 清掉页面在浏览器本地为某个反代站点留下的数据
 * （bootstrap 把 localStorage / sessionStorage 键名加了 `__lw<siteId>__` 前缀）
 */
export function clearProxyLocalData(siteId: number): void {
  const prefix = `__lw${siteId}__`
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key && key.startsWith(prefix)) keys.push(key)
    }
    keys.forEach((key) => localStorage.removeItem(key))
    const sessionKeys: string[] = []
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i)
      if (key && key.startsWith(prefix)) sessionKeys.push(key)
    }
    sessionKeys.forEach((key) => sessionStorage.removeItem(key))
  } catch {
    /* 隐私模式下 storage 可能不可用 */
  }
}

/** 规范化用户输入：缺协议时补 https://；仅用于前端展示与校验，服务端仍会复核 */
export function normalizeProxyInput(input: string): string {
  const raw = input.trim()
  if (!raw) return ''
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return `https://${raw}`
  return raw
}
