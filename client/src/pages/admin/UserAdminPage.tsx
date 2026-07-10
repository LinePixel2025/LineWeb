import { useState, useEffect } from 'react'
import UserAvatar from '../../components/UserAvatar'
import LiquidButton from '../../components/glass/LiquidButton'
import LiquidGlass from '../../components/glass/LiquidGlass'
import api from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'

/* ---------- types ---------- */

interface UserItem {
  id: number
  username: string
  email: string
  role: string
  canAccessDrive?: boolean
  createdAt: string
}

/* ---------- main component ---------- */

export default function UserAdminPage() {
  const { user: authUser } = useAuth()

  const [users, setUsers] = useState<UserItem[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  // 编辑状态
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editRole, setEditRole] = useState<'user' | 'admin'>('user')
  const [editPassword, setEditPassword] = useState('')

  const fetchUsers = () => {
    setLoading(true)
    api.get<{ users: UserItem[]; total: number; page: number; totalPages: number }>(`/users?page=${page}&limit=20`)
      .then(d => { setUsers(d.users); setTotalPages(d.totalPages) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchUsers() }, [page])

  const startEdit = (u: UserItem) => {
    setEditingId(u.id)
    setEditRole(u.role as 'user' | 'admin')
    setEditPassword('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditPassword('')
  }

  const handleUpdate = async (id: number) => {
    const body: { role?: string; password?: string } = {}
    if (editRole) body.role = editRole
    if (editPassword.trim()) body.password = editPassword
    try {
      await api.put(`/users/${id}`, body)
      setEditingId(null)
      setEditPassword('')
      fetchUsers()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '更新失败')
    }
  }

  const handleDelete = async (id: number, username: string) => {
    if (!confirm(`确定要删除用户 ${username} 吗？`)) return
    try { await api.delete(`/users/${id}`); fetchUsers() }
    catch { alert('删除失败') }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1 className="admin-page-title">用户管理</h1>
      </div>

      {loading ? (
        <div className="admin-spinner"><div className="spinner" /></div>
      ) : users.length === 0 ? (
        <LiquidGlass variant="blur" style={{ padding: '40px', textAlign: 'center' }}>
          <p style={{ color: 'var(--lg-text-tertiary)' }}>暂无用户</p>
        </LiquidGlass>
      ) : (
        <LiquidGlass variant="blur" className="admin-page-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th className="admin-th admin-th--title">用户名</th>
                <th className="admin-th" style={{ width: '25%' }}>邮箱</th>
                <th className="admin-th admin-th--status">角色</th>
                <th className="admin-th" style={{ width: '90px' }}>网盘</th>
                <th className="admin-th admin-cell--date">注册时间</th>
                <th className="admin-th admin-th--actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => {
                const isEditing = editingId === u.id
                return (
                  <tr key={u.id} className="admin-row fade-in" style={{ animationDelay: `${i * 0.04}s` }}>
                    <td className="admin-cell admin-cell--title" data-label="用户名">
                      <div className="admin-post-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <UserAvatar userId={u.id} username={u.username} size="sm" />
                        {u.username}
                      </div>
                    </td>
                    <td className="admin-cell" data-label="邮箱">
                      <code style={{ fontSize: '0.8125rem', color: 'var(--lg-text-secondary)' }}>{u.email}</code>
                    </td>
                    <td className="admin-cell admin-cell--status" data-label="角色">
                      {isEditing ? (
                        <select
                          className="lg-input"
                          value={editRole}
                          onChange={e => setEditRole(e.target.value as 'user' | 'admin')}
                          style={{ padding: '4px 8px', fontSize: '0.8125rem' }}
                        >
                          <option value="user">用户</option>
                          <option value="admin">管理员</option>
                        </select>
                      ) : (
                        <span className={`admin-badge ${u.role === 'admin' ? 'admin-badge--published' : 'admin-badge--draft'}`}>
                          {u.role === 'admin' ? '管理员' : '用户'}
                        </span>
                      )}
                    </td>
                    <td className="admin-cell" data-label="网盘" style={{ textAlign: 'center' }}>
                      <button
                        onClick={async () => {
                          try {
                            await api.put(`/users/${u.id}/drive-access`, { canAccessDrive: !u.canAccessDrive })
                            fetchUsers()
                          } catch (err: unknown) {
                            alert(err instanceof Error ? err.message : '操作失败')
                          }
                        }}
                        className={`drive-toggle ${u.canAccessDrive ? 'drive-toggle--on' : ''}`}
                        title={u.canAccessDrive ? '点击关闭网盘访问' : '点击开启网盘访问'}
                      >
                        {u.canAccessDrive ? '✅' : '❌'}
                      </button>
                    </td>
                    <td className="admin-cell admin-cell--date" data-label="注册时间">
                      {new Date(u.createdAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="admin-cell admin-cell--actions" data-label="操作">
                      {isEditing ? (
                        <div className="admin-actions" style={{ flexWrap: 'wrap', gap: '6px' }}>
                          <input
                            className="lg-input"
                            type="password"
                            placeholder="新密码（留空不修改）"
                            value={editPassword}
                            onChange={e => setEditPassword(e.target.value)}
                            style={{ width: '140px', padding: '4px 8px', fontSize: '0.8125rem' }}
                          />
                          <LiquidButton size="sm" variant="primary" onClick={() => handleUpdate(u.id)}>保存</LiquidButton>
                          <LiquidButton size="sm" variant="ghost" onClick={cancelEdit}>取消</LiquidButton>
                        </div>
                      ) : (
                        <div className="admin-actions">
                          <LiquidButton size="sm" variant="glass" onClick={() => startEdit(u)}>编辑</LiquidButton>
                          {u.id === authUser?.id ? (
                            <span className="liquid-btn glass sm" style={{ opacity: 0.5, cursor: 'not-allowed' }} title="不能删除自己">删除</span>
                          ) : (
                            <LiquidButton size="sm" variant="danger" onClick={() => handleDelete(u.id, u.username)}>删除</LiquidButton>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </LiquidGlass>
      )}

      {totalPages > 1 && (
        <div className="admin-pagination">
          {(() => {
            const total = totalPages
            const current = page
            const pages: (number | 0)[] = []
            const start = Math.max(1, current - 2)
            const end = Math.min(total, current + 2)
            if (start > 1) pages.push(1)
            if (start > 2) pages.push(0)
            for (let i = start; i <= end; i++) pages.push(i)
            if (end < total - 1) pages.push(0)
            if (end < total) pages.push(total)
            return pages.map((p, i) =>
              p === 0 ? (
                <span key={`ellipsis-${i}`} className="admin-ellipsis">...</span>
              ) : (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`admin-page-btn ${p === page ? 'admin-page-btn--active' : ''}`}
                >
                  {p}
                </button>
              )
            )
          })()}
        </div>
      )}
    </div>
  )
}
