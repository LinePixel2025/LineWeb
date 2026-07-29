import { useState, useEffect } from 'react'
import UserAvatar from '../../components/UserAvatar'
import { GitHubButton, GitHubBadge } from '../../components/ui'
import Pagination from '../../components/Pagination'
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
    <div>
      <div className="gh-page-header">
        <h1>用户管理</h1>
        <p>管理注册用户和权限</p>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--gh-space-7)' }}>
          <div className="gh-spinner" />
        </div>
      ) : users.length === 0 ? (
        <div className="gh-box" style={{ padding: '40px', textAlign: 'center' }}>
          <p className="gh-text-secondary">暂无用户</p>
        </div>
      ) : (
        <div className="gh-box" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="gh-table">
            <thead>
              <tr>
                <th>用户名</th>
                <th style={{ width: '25%' }}>邮箱</th>
                <th>角色</th>
                <th style={{ width: '90px' }}>网盘</th>
                <th>注册时间</th>
                <th style={{ textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isEditing = editingId === u.id
                return (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 500 }}>
                        <UserAvatar userId={u.id} username={u.username} size="sm" />
                        {u.username}
                      </div>
                    </td>
                    <td>
                      <code style={{ fontSize: 'var(--gh-text-xs)', color: 'var(--gh-text-secondary)', fontFamily: 'var(--gh-font-mono)' }}>
                        {u.email}
                      </code>
                    </td>
                    <td>
                      {isEditing ? (
                        <select
                          className="gh-input"
                          value={editRole}
                          onChange={e => setEditRole(e.target.value as 'user' | 'admin')}
                          style={{ padding: '4px 8px', fontSize: 'var(--gh-text-xs)', width: 'auto' }}
                        >
                          <option value="user">用户</option>
                          <option value="admin">管理员</option>
                        </select>
                      ) : (
                        <GitHubBadge variant={u.role === 'admin' ? 'success' : 'default'}>
                          {u.role === 'admin' ? '管理员' : '用户'}
                        </GitHubBadge>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <GitHubButton
                        variant={u.canAccessDrive ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={async () => {
                          try {
                            await api.put(`/users/${u.id}/drive-access`, { canAccessDrive: !u.canAccessDrive })
                            fetchUsers()
                          } catch (err: unknown) {
                            alert(err instanceof Error ? err.message : '操作失败')
                          }
                        }}
                      >
                        {u.canAccessDrive ? '已开启' : '未开启'}
                      </GitHubButton>
                    </td>
                    <td className="gh-text-tertiary">
                      {new Date(u.createdAt).toLocaleString('zh-CN')}
                    </td>
                    <td>
                      {isEditing ? (
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <input
                            className="gh-input"
                            type="password"
                            placeholder="新密码（留空不修改）"
                            value={editPassword}
                            onChange={e => setEditPassword(e.target.value)}
                            style={{ width: '140px', padding: '4px 8px', fontSize: 'var(--gh-text-xs)' }}
                          />
                          <GitHubButton variant="primary" size="sm" onClick={() => handleUpdate(u.id)}>保存</GitHubButton>
                          <GitHubButton variant="ghost" size="sm" onClick={cancelEdit}>取消</GitHubButton>
                        </div>
                      ) : (
                        <div className="gh-actions">
                          <GitHubButton variant="secondary" size="sm" onClick={() => startEdit(u)}>编辑</GitHubButton>
                          {u.id === authUser?.id ? (
                            <GitHubButton variant="secondary" size="sm" disabled>删除</GitHubButton>
                          ) : (
                            <GitHubButton variant="danger" size="sm" onClick={() => handleDelete(u.id, u.username)}>删除</GitHubButton>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      )}
    </div>
  )
}
