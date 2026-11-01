/**
 * 头像内存缓存
 *
 * 头像接口返回二进制且带 `Cache-Control: no-store`（换头像要立即生效），
 * 因此浏览器不会缓存；聊天页同一条消息流里同一发送者会出现几十次，
 * 如果每个 <UserAvatar> 挂载都 fetch 一次，低端设备打开会话会看到几十个
 * 并行请求 + blob 分配。这里按 userId 做模块级缓存：
 *   - 成功 → 共享 blob URL（页面生命周期内复用，卸载不清）；
 *   - 明确无头像（204 / 非 2xx）→ 缓存 null，避免反复请求；
 *   - 网络异常 → 不写缓存，允许下次重试；
 *   - 同一 userId 的并发请求合并为一个 Promise。
 */

const MAX_CACHE_ENTRIES = 300

const cache = new Map<number, string | null>()
const inflight = new Map<number, Promise<string | null>>()

/** 只读缓存：undefined = 尚未加载；null = 确定没有头像 */
export function peekAvatar(userId: number): string | null | undefined {
  return cache.get(userId)
}

function store(userId: number, url: string | null): void {
  cache.delete(userId)
  cache.set(userId, url)
  if (cache.size <= MAX_CACHE_ENTRIES) return
  const oldest = cache.keys().next().value
  if (oldest === undefined) return
  const evicted = cache.get(oldest)
  cache.delete(oldest)
  if (evicted) URL.revokeObjectURL(evicted)
}

export function loadAvatar(userId: number): Promise<string | null> {
  if (cache.has(userId)) return Promise.resolve(cache.get(userId) ?? null)
  const running = inflight.get(userId)
  if (running) return running

  const token = window.localStorage.getItem('lineweb_token')
  if (!token) return Promise.resolve(null)

  const promise = fetch(`/api/auth/avatar/${userId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
    .then(async (res) => {
      if (res.ok && res.status !== 204) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        store(userId, url)
        return url
      }
      store(userId, null)
      return null
    })
    .catch(() => {
      // 网络错误不写入负缓存，下一次挂载仍可重试
      return null
    })
    .finally(() => {
      inflight.delete(userId)
    })

  inflight.set(userId, promise)
  return promise
}

/** 换号 / 换头像后清空，避免显示上一个账号的缓存 */
export function clearAvatarCache(): void {
  for (const url of cache.values()) {
    if (url) URL.revokeObjectURL(url)
  }
  cache.clear()
  inflight.clear()
}

/** 单个用户头像变化（如管理员代改头像）后失效 */
export function invalidateAvatar(userId: number): void {
  const url = cache.get(userId)
  if (url) URL.revokeObjectURL(url)
  cache.delete(userId)
  inflight.delete(userId)
}
