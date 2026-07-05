import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import api, { setToken } from '../lib/api'

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
  login: (email: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<void>
  logout: () => void
  isAdmin: boolean
  updateSettings: (settings: string) => Promise<void>
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
      .catch(() => setToken(null))
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ token: string; user: User }>('/auth/login', { email, password })
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

  const isAdmin = user?.role === 'admin'

  const value = useMemo<AuthContextType>(() => ({
    user,
    loading,
    login,
    register,
    logout,
    isAdmin,
    updateSettings,
  }), [user, loading, login, register, logout, isAdmin, updateSettings])

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
