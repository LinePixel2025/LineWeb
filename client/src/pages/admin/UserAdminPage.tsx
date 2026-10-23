import { useState, useEffect } from 'react'
import UserAvatar from '../../components/UserAvatar'
import { GitHubButton, GitHubBadge } from '../../components/ui'
import Pagination from '../../components/Pagination'
import api from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import { roleLabel } from '../../lib/permissions'

/* ---------- types ---------- */

interface UserItem {
  id: number
  username: string
  email: string
  role: string
  canAccessDrive?: boolean
  /** 网盘空间上限（字节数，字符串以避免 BigInt 精度问题；'0' 表示不限） */
  storageQuota?: string
  /** 已用网盘空间（字节数） */
  storageUsed?: string
  createdAt: string
}

type EditableRole = 'user' | 'author' | 'admin'

const ROLE_OPTIONS: { value: EditableRole; label: string }[] = [
  { value: 'user', label: '用户' },
  { value: 'author', label: '作者' },
  { value: 'admin', label: '管理员' },
]

/* ---------- role → capability 说明（与 server/src/lib/permissions.ts 一致） ---------- */

const ROLE_HINTS: Record<string, string> = {
  admin: '拥有全部能力：内容管理（全站文章与页面）、评论管理、用户管理、站点统计、设备监控、AI 配置、网盘全量访问（自动通过网盘开关，且不受空间配额限制）',
  author: '内容编辑（content:write）：可创建、编辑、发布、删除自己的文章，并使用 AI 写作辅助；没有页面 / 评论 / 用户管理权限；网盘受「网盘权限」开关与空间配额约束',
  user: '无管理能力：可浏览内容、发表评论、使用个人功能（数字健康、个人资料）；网盘受「网盘权限」开关与空间配额约束',
}

/** 列表里的角色能力概览（角色徽章下方的小字） */
const ROLE_SUMMARIES: Record<string, string> = {
  admin: '全部能力（9 项）',
  author: '内容编辑（自己的文章）',
  user: '仅基础访问',
}

function roleBadgeVariant(role: string): 'accent' | 'success' | 'default' {
  if (role === 'admin') return 'accent'
  if (role === 'author') return 'success'
  return 'default'
}

/* ---------- 空间配额展示 ---------- */

const BYTES_PER_GB = 1024 ** 3

/** 与后端 users.ts 一致：单用户配额上限 10 TiB（换算成 GB） */
const MAX_QUOTA_GB = 10240

/** 字节数（字符串）→ 可读大小；空值 / 非法值回退 '—' */
function formatBytes(bytes?: string): string {
  if (bytes === undefined || bytes === '') return '—'
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return '—'
  if (value === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

/**
 * 空间上限文案：管理员（drive:all）不受配额限制，显示「不限」；
 * 普通用户按字节数显示（'0' 表示禁止上传，不是不限）。
 */
function quotaLimitLabel(user: UserItem): string {
  if (user.role === 'admin') return '不限'
  if (user.storageQuota === undefined || user.storageQuota === '') return '—'
  return formatBytes(user.storageQuota)
}

/** 「已用 / 上限」文案；后端未返回配额字段时降级显示 '—' */
function quotaDisplay(user: UserItem): string {
  if (user.storageQuota === undefined && user.storageUsed === undefined) return '—'
  return `${formatBytes(user.storageUsed)} / ${quotaLimitLabel(user)}`
}

/* ---------- main component ---------- */

export default function UserAdminPage() {
  const { user: authUser } = useAuth()

  const [users, setUsers] = useState<UserItem[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editRole, setEditRole] = useState<EditableRole>('user')
  const [editPassword, setEditPassword] = useState('')
  // 空间上限输入（GB，支持小数）；留空表示不修改
  const [editQuotaGb, setEditQuotaGb] = useState('')

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
    setEditRole(u.role as EditableRole)
    setEditPassword('')
    setEditQuotaGb('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditPassword('')
    setEditQuotaGb('')
  }

  const handleUpdate = async (u: UserItem) => {
    // 配额：留空不修改；填写时按 GB → 字节（字符串）传给配额接口
    const quotaInput = editQuotaGb.trim()
    let quotaBytes: string | null = null
    if (quotaInput) {
      const gb = Number(quotaInput)
      if (!Number.isFinite(gb) || gb < 0) {
        alert('空间上限请填写不小于 0 的 GB 数字（支持小数，留空表示不修改）')
        return
      }
      // 与后端一致：配额上限 10 TiB
      if (gb > MAX_QUOTA_GB) {
        alert(`空间上限不能超过 ${MAX_QUOTA_GB} GB（10 TiB）`)
        return
      }
      quotaBytes = String(Math.round(gb * BYTES_PER_GB))
    }

    try {
      // 角色 / 密码仍走 PUT /api/users/:id；只在确有变化时才提交，避免触发「不能修改自己的角色」之类无谓错误
      const body: { role?: string; password?: string } = {}
      if (editRole !== u.role) body.role = editRole
      if (editPassword.trim()) body.password = editPassword
      if (body.role || body.password) {
        await api.put(`/users/${u.id}`, body)
      }

      // 配额改动走独立接口（字节数用纯数字字符串传输，避免 JS number 精度问题）
      if (quotaBytes !== null) {
        await api.put(`/users/${u.id}/quota`, { storageQuotaBytes: quotaBytes })
      }

      setEditingId(null)
      setEditPassword('')
      setEditQuotaGb('')
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
        <p>管理注册用户的角色、网盘权限与空间配额</p>
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
        <div className="gh-box gh-table-wrap" style={{ padding: 0 }}>
          <table className="gh-table">
            <thead>
              <tr>
                <th>用户名</th>
                <th style={{ width: '22%' }}>邮箱</th>
                <th>角色</th>
                <th style={{ width: '90px' }}>网盘</th>
                <th style={{ width: '160px' }}>空间</th>
                <th>注册时间</th>
                <th style={{ textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isEditing = editingId === u.id
                const hasChanges = isEditing && (
                  editRole !== u.role || editPassword.trim() !== '' || editQuotaGb.trim() !== ''
                )
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
                          onChange={e => setEditRole(e.target.value as EditableRole)}
                          style={{ padding: '4px 8px', fontSize: 'var(--gh-text-xs)', width: 'auto' }}
                        >
                          {ROLE_OPTIONS.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      ) : (
                        <GitHubBadge variant={roleBadgeVariant(u.role)}>
                          {roleLabel(u.role)}
                        </GitHubBadge>
                      )}
                      {isEditing ? (
                        <p className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)', margin: '6px 0 0', maxWidth: 260 }}>
                          {ROLE_HINTS[editRole]}
                        </p>
                      ) : (
                        <p className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)', margin: '6px 0 0', maxWidth: 260 }}>
                          {ROLE_SUMMARIES[u.role] ?? '未知角色'}
                        </p>
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
                    <td>
                      {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <input
                            className="gh-input"
                            type="number"
                            min="0"
                            step="0.1"
                            placeholder="留空不修改"
                            value={editQuotaGb}
                            onChange={e => setEditQuotaGb(e.target.value)}
                            style={{ width: '110px', padding: '4px 8px', fontSize: 'var(--gh-text-xs)' }}
                            aria-label={`${u.username} 的空间上限（GB）`}
                          />
                          <span className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)' }}>
                            上限（GB），当前 {quotaLimitLabel(u)}
                          </span>
                        </div>
                      ) : (
                        <div style={{ fontSize: 'var(--gh-text-xs)' }}>
                          <div>{quotaDisplay(u)}</div>
                          {u.role === 'admin' && (
                            <span className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)' }}>
                              管理员不受配额限制
                            </span>
                          )}
                        </div>
                      )}
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
                          <GitHubButton
                            variant="primary"
                            size="sm"
                            disabled={!hasChanges}
                            onClick={() => handleUpdate(u)}
                          >
                            保存
                          </GitHubButton>
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
