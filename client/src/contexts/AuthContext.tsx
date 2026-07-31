import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import api, { setToken, ApiError } from '../lib/api'

const TOKEN_KEY = 'lineweb_token'

interface User {
  id: number
  username: string
  email: string
  role: string
  settings?: string  // JSON: 用户个性化设置
  canAccessDrive?: boolean
}

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (identifier: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<void>
  logout: () => void
  isAdmin: boolean
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
    const data = await api.post<{ token: string; user: User }>('/auth/register', { username, email, password })
    setToken(data.token)
    setUser(data.user)
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
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

  const value = useMemo<AuthContextType>(() => ({
    user,
    loading,
    login,
    register,
    logout,
    isAdmin,
    updateSettings,
    updateProfile,
  }), [user, loading, login, register, logout, isAdmin, updateSettings, updateProfile])

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
