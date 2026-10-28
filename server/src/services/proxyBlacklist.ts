import prisma from '../lib/prisma.js'

/**
 * 网页反代黑名单
 *
 * 管理员在 `/admin/proxy` 里维护域名黑名单，命中后：
 *   - 不允许新建反代站点（创建时 403）
 *   - 已存在的站点在转发前被拒绝（assertPublicHost 内统一校验，HTTP / 媒体 / WS 全覆盖）
 *
 * 实现要点：黑名单是「热路径」检查（每个子资源请求都会走），
 * 因此内存缓存 + 30 秒 TTL，写操作（增删）立刻刷新缓存，无需重启。
 */

const REFRESH_TTL_MS = 30 * 1000
const MAX_PATTERN_LENGTH = 200

interface Cache {
  patterns: string[]
  expires: number
}

let cache: Cache | null = null
let loading: Promise<string[]> | null = null

/**
 * 归一化黑名单条目：
 *  - 允许直接填域名或贴完整 URL（自动去掉协议 / 路径 / 端口）
 *  - `*.example.com` 表示只匹配子域名；`example.com` 匹配自身与所有子域名
 */
export function normalizeBlacklistPattern(input: string): string {
  const raw = String(input || '').trim().toLowerCase()
  if (!raw) throw new Error('请输入要拉黑的域名')
  if (raw.length > MAX_PATTERN_LENGTH) throw new Error('域名过长')

  let value = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  value = value.split(/[/?#]/)[0]
  value = value.replace(/:\d+$/, '')
  const wildcard = value.startsWith('*.')
  if (wildcard) value = value.slice(2)
  value = value.replace(/^\.+|\.+$/g, '')
  if (!value || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(value)) {
    throw new Error('域名格式不正确，请填写形如 example.com 或 *.example.com')
  }
  if (wildcard) return `*.${value}`
  // 裸 IP
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return value
  return value
}

/** 单个条目是否命中主机名（不含端口） */
export function matchBlacklistPattern(pattern: string, hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
  if (!host) return false
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2)
    return host === suffix || host.endsWith(`.${suffix}`)
  }
  return host === pattern || host.endsWith(`.${pattern}`)
}

function matchesAny(patterns: string[], hostname: string): boolean {
  return patterns.some((pattern) => matchBlacklistPattern(pattern, hostname))
}

async function loadPatterns(): Promise<string[]> {
  try {
    const rows = await prisma.proxyBlacklist.findMany({ select: { pattern: true } })
    return rows.map((row) => row.pattern)
  } catch (err) {
    console.warn('[proxy] 读取黑名单失败：', err instanceof Error ? err.message : err)
    return []
  }
}

/** 强制刷新缓存（增删黑名单后调用） */
export async function refreshProxyBlacklist(): Promise<void> {
  if (loading) await loading.catch(() => undefined)
  loading = loadPatterns()
  const patterns = await loading
  cache = { patterns, expires: Date.now() + REFRESH_TTL_MS }
  loading = null
}

/** 主机名是否在黑名单里 */
export async function isProxyHostBlacklisted(hostname: string): Promise<boolean> {
  if (!hostname) return false
  if (!cache || cache.expires <= Date.now()) await refreshProxyBlacklist()
  return matchesAny(cache?.patterns ?? [], hostname)
}

/** 同步版本（缓存为空时按「未命中」处理，仅供无法 await 的场景） */
export function isProxyHostBlacklistedSync(hostname: string): boolean {
  if (!cache) return false
  return matchesAny(cache.patterns, hostname)
}

export async function listProxyBlacklist(): Promise<
  Array<{ id: number; pattern: string; reason: string | null; createdById: number | null; createdAt: Date }>
> {
  return prisma.proxyBlacklist.findMany({ orderBy: { createdAt: 'desc' } })
}

export async function addProxyBlacklistEntry(input: {
  pattern: string
  reason?: string
  createdById?: number
}): Promise<{ id: number; pattern: string; reason: string | null; createdById: number | null; createdAt: Date }> {
  const pattern = normalizeBlacklistPattern(input.pattern)
  const reason = input.reason?.trim() ? input.reason.trim().slice(0, 200) : null
  const created = await prisma.proxyBlacklist.create({
    data: { pattern, reason, createdById: input.createdById ?? null },
  })
  await refreshProxyBlacklist()
  return created
}

export async function removeProxyBlacklistEntry(id: number): Promise<boolean> {
  const deleted = await prisma.proxyBlacklist.deleteMany({ where: { id } })
  if (deleted.count > 0) await refreshProxyBlacklist()
  return deleted.count > 0
}
