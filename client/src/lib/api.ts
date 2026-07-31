const API_BASE = import.meta.env.VITE_API_URL || '/api'
const TOKEN_KEY = 'lineweb_token'
const DEFAULT_TIMEOUT_MS = 30_000

interface RequestOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
  noRedirect?: boolean
}

class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// === Token 缓存 — 避免每请求读 localStorage ===
let cachedToken: string | null = null

function getToken(): string | null {
  if (cachedToken !== null) return cachedToken
  cachedToken = localStorage.getItem(TOKEN_KEY)
  return cachedToken
}

/** 写入 token（同步更新缓存与 localStorage） */
export function setToken(token: string | null): void {
  cachedToken = token
  if (token) {
    localStorage.setItem(TOKEN_KEY, token)
  } else {
    localStorage.removeItem(TOKEN_KEY)
  }
}

/** 401 自动登出：清 token 并跳转登录页（除非请求方明确禁用） */
function handleUnauthorized(noRedirect: boolean): void {
  setToken(null)
  if (noRedirect) return
  // 避免登录页自身 401 死循环：仅当当前不在登录/注册页时跳转
  const path = window.location.pathname
  if (path !== '/login' && path !== '/register') {
    window.location.href = '/login'
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...options.headers,
  }

  const token = getToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
    // 禁止浏览器缓存认证 API 的响应（配合服务端 Cache-Control: no-store）
    headers['Cache-Control'] = 'no-cache'
  }

  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  // 默认 30s 超时
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  // 链接外部 signal（调用方主动取消时同步触发内部 controller）
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort()
    } else {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true })
    }
  }

  // /auth/login、/auth/register、/auth/me 三个端点的 401 不跳转，由调用方处理
  const noRedirect = options.noRedirect || /^\/auth\/(login|register|me)(\/|$)/.test(path)

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    })

    if (!res.ok) {
      // 401 自动登出
      if (res.status === 401) {
        handleUnauthorized(noRedirect)
      }
      const data = await res.json().catch(() => ({}))
      throw new ApiError(data.error || `请求失败 (${res.status})`, res.status)
    }

    return res.json()
  } catch (err) {
    // 超时/取消 — 包装为可识别错误
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError('请求超时或已取消', 408)
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

async function requestText(path: string): Promise<string> {
  const token = getToken()
  const headers: Record<string, string> = token
    ? { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' }
    : {}
  const res = await fetch(`${API_BASE}${path}`, { headers })
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(false)
    const data = await res.json().catch(() => ({}))
    throw new ApiError(data.error || `请求失败 (${res.status})`, res.status)
  }
  return res.text()
}

export const api = {
  get: <T>(path: string, opts?: { signal?: AbortSignal; noRedirect?: boolean }) =>
    request<T>(path, { signal: opts?.signal, noRedirect: opts?.noRedirect }),
  post: <T>(path: string, body?: unknown, opts?: { noRedirect?: boolean }) =>
    request<T>(path, { method: 'POST', body, noRedirect: opts?.noRedirect }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  text: (path: string) => requestText(path),
}

export { ApiError }
export default api
