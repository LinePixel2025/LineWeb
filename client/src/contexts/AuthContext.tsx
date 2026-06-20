import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import api from '../lib/api'

interface User {
  id: number
  username: string
  email: string
  role: string
}

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<void>
  logout: () => void
  isAdmin: boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchUser = useCallback(async () => {
    const token = localStorage.getItem('lineweb_token')
    if (!token) {
      setLoading(false)
      return
    }
    try {
      const data = await api.get<User>('/auth/me')
      setUser(data)
    } catch {
      localStorage.removeItem('lineweb_token')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchUser() }, [fetchUser])

  const login = async (email: string, password: string) => {
    const data = await api.post<{ token: string; user: User }>('/auth/login', { email, password })
    localStorage.setItem('lineweb_token', data.token)
    setUser(data.user)
  }

  const register = async (username: string, email: string, password: string) => {
    const data = await api.post<{ token: string; user: User }>('/auth/register', { username, email, password })
    localStorage.setItem('lineweb_token', data.token)
    setUser(data.user)
  }

  const logout = () => {
    localStorage.removeItem('lineweb_token')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, isAdmin: user?.role === 'admin' }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
