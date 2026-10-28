import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import api, { setToken, ApiError } from '../lib/api'
import { hasCapability, hasAnyCapability, type Capability } from '../lib/permissions'

const TOKEN_KEY = 'lineweb_token'

interface User {
  id: number
  username: string
  email: string
  role: string
  /** pending | active | rejected（注册审核状态） */
  status?: 'pending' | 'active' | 'rejected'
  /** 角色能力清单（服务端按角色解析），权限判断唯一依据 */
  capabilities?: string[]
  settings?: string  // JSON: 用户个性化设置
  canAccessDrive?: boolean
}

interface RegisterResult {
  message: string
}

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (identifier: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<RegisterResult>
  logout: () => Promise<void>
  isAdmin: boolean
  hasAdminAccess: boolean
  can: (capability: Capability) => boolean
  updateSettings: (settings: string) => Promise<void>
  updateProfile: (input: { username?: string; currentPassword?: string; newPassword?: string }) => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) {
      setLoading(false)
      return
    }
    // 首次加载时把 token 写入 api 模块缓存
    setToken(token)
    api.get<User>('/auth/me')
      .then(setUser)
      .catch((err) => {
        // 只在 token 无效（401）时清除；速率限制等其他错误保留 token
        if (err instanceof ApiError && err.status === 401) {
          setToken(null)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (identifier: string, password: string) => {
    const data = await api.post<{ token: string; user: User }>('/auth/login', { identifier, password })
    setToken(data.token)
    setUser(data.user)
  }, [])

  const register = useCallback(async (username: string, email: string, password: string) => {
    // 注册只提交审核申请，不签发 token；管理员通过后才能登录
    const data = await api.post<{ user: User; message?: string }>('/auth/register', { username, email, password })
    return { message: data.message || '注册成功，等待管理员审核' }
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', undefined, { noRedirect: true })
    } catch {
      // 本地会话必须在服务端失败时也能退出
    } finally {
      setToken(null)
      setUser(null)
    }
  }, [])

  const updateSettings = useCallback(async (settings: string) => {
    const data = await api.put<{ user: User }>('/auth/settings', { settings })
    setUser(data.user)
  }, [])

  const updateProfile = useCallback(async (input: { username?: string; currentPassword?: string; newPassword?: string }) => {
    const data = await api.put<{ user: User; token?: string }>('/auth/profile', input)
    if (data.token) setToken(data.token)
    setUser(data.user)
  }, [])

  const isAdmin = user?.role === 'admin'
  // 是否可进入 /admin：具备任意管理能力即可（为未来新增角色留出扩展点）
  const hasAdminAccess = hasAnyCapability(user)
  const can = useCallback((capability: Capability) => hasCapability(user, capability), [user])

  const value = useMemo<AuthContextType>(() => ({
    user,
    loading,
    login,
    register,
    logout,
    isAdmin,
    hasAdminAccess,
    can,
    updateSettings,
    updateProfile,
  }), [user, loading, login, register, logout, isAdmin, hasAdminAccess, can, updateSettings, updateProfile])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
