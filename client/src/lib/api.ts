const API_BASE = import.meta.env.VITE_API_URL || '/api'
const TOKEN_KEY = 'lineweb_token'
const DEFAULT_TIMEOUT_MS = 30_000
/** 图片上传需要更长的超时（服务端还会处理图片，30s 不够） */
const UPLOAD_TIMEOUT_MS = 120_000

interface RequestOptions {
  method?: string
  body?: unknown
  /** multipart/form-data 表单；与 body 互斥，设置后不写 Content-Type（交给浏览器补 boundary） */
  form?: FormData
  /** 原始二进制请求体（图片上传用；与 form/body 互斥，Content-Type 由调用方指定） */
  raw?: Blob
  headers?: Record<string, string>
  signal?: AbortSignal
  noRedirect?: boolean
  timeoutMs?: number
}

class ApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

// === Token 缓存 — 避免每请求读 localStorage ===
let cachedToken: string | null = null

/** 读取当前 token（复用模块内缓存，供 WebSocket 等非 api 通道使用） */
export function getToken(): string | null {
  if (cachedToken !== null) return cachedToken
  cachedToken = localStorage.getItem(TOKEN_KEY)
  return cachedToken
}

/** 写入 token（同步更新缓存与 localStorage） */
export function setToken(token: string | null): void {
  cachedToken = token
  if (token) {
    localStorage.setItem(TOKEN_KEY, token)
    unauthorizedHandled = false
  } else {
    localStorage.removeItem(TOKEN_KEY)
  }
}

/** 并发 401 只跳一次，避免多个 React Query 同时触发整页刷新 */
let unauthorizedHandled = false

/** 401 自动登出：清 token 并跳转登录页（除非请求方明确禁用） */
function handleUnauthorized(noRedirect: boolean): void {
  setToken(null)
  if (noRedirect || unauthorizedHandled) return
  const { pathname, search, hash } = window.location
  if (pathname === '/login' || pathname === '/register') return
  unauthorizedHandled = true
  const returnTo = encodeURIComponent(`${pathname}${search}${hash}`)
  window.location.replace(`/login?returnTo=${returnTo}`)
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

  if (options.body && !options.form && !options.raw && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  // multipart 表单不设置 Content-Type：浏览器会自动补上带 boundary 的值

  // 默认 30s 超时；上传等长耗时场景可通过 timeoutMs 放宽
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
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
      body: options.form ?? options.raw ?? (options.body ? JSON.stringify(options.body) : undefined),
      signal: controller.signal,
    })

    if (!res.ok) {
      // 401 自动登出
      if (res.status === 401) {
        handleUnauthorized(noRedirect)
      }
      const data = await res.json().catch(() => ({}))
      throw new ApiError(data.error || `请求失败 (${res.status})`, res.status, data.code)
    }

    // 204 No Content（如 XMPP 长轮询的 stanza 上报）没有响应体
    if (res.status === 204) return undefined as T

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
    throw new ApiError(data.error || `请求失败 (${res.status})`, res.status, data.code)
  }
  return res.text()
}

export const api = {
  get: <T>(path: string, opts?: { signal?: AbortSignal; noRedirect?: boolean; timeoutMs?: number }) =>
    request<T>(path, { signal: opts?.signal, noRedirect: opts?.noRedirect, timeoutMs: opts?.timeoutMs }),
  post: <T>(path: string, body?: unknown, opts?: { noRedirect?: boolean }) =>
    request<T>(path, { method: 'POST', body, noRedirect: opts?.noRedirect }),
  /** multipart/form-data 上传（图片等）：不设置 Content-Type，超时放宽到 120s */
  postForm: <T>(path: string, form: FormData, opts?: { signal?: AbortSignal; noRedirect?: boolean }) =>
    request<T>(path, {
      method: 'POST',
      form,
      signal: opts?.signal,
      noRedirect: opts?.noRedirect,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    }),
  /**
   * 原始二进制上传（与 neko 的 `/chat/uploads` 同构）：
   * 请求体即图片字节，类型由 Content-Type 声明，服务端按魔数复核。
   */
  postBinary: <T>(
    path: string,
    blob: Blob,
    contentType: string,
    opts?: { signal?: AbortSignal; noRedirect?: boolean },
  ) =>
    request<T>(path, {
      method: 'POST',
      raw: blob,
      headers: { 'Content-Type': contentType },
      signal: opts?.signal,
      noRedirect: opts?.noRedirect,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  text: (path: string) => requestText(path),
}

export { ApiError }
export default api
