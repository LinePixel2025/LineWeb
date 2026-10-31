import { useCallback, useEffect, useState } from 'react'
import api from '../../lib/api'
import { Alert, Badge, Button } from '../../components/ui'
import { roleLabel } from '../../lib/permissions'

interface ChatBanRow {
  userId: number
  username: string
  reason: string
  bannedBy: number | null
  createdAt: string
  active: boolean
  liftedAt: string | null
}

interface ChatUserResult {
  id: number
  username: string
  email: string
  role: string
  status: string
  chatBanned: boolean
  chatBanReason: string
}

const STATUS_LABELS: Record<string, string> = {
  pending: '待审核',
  active: '已通过',
  rejected: '已拒绝',
}

function formatTime(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN')
}

/**
 * 聊天治理（需 chat:manage）
 *
 * 封禁的含义是「禁止使用 LineWeb 的聊天入口」：/api/chat*、聊天图片/头像中继
 * 与 /ws/xmpp 握手会被拒绝，已建立的连接在封禁时立即断开；neko 账号本身不受影响，
 * 解封后立刻恢复。管理员账号不可被封禁。
 */
export default function ChatAdminPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ChatUserResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)

  const [bans, setBans] = useState<ChatBanRow[]>([])
  const [includeLifted, setIncludeLifted] = useState(false)
  const [loadingBans, setLoadingBans] = useState(true)

  const [banTarget, setBanTarget] = useState<ChatUserResult | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadBans = useCallback(async (withLifted: boolean) => {
    setLoadingBans(true)
    setError('')
    try {
      const data = await api.get<{ bans: ChatBanRow[] }>(
        `/admin/chat/bans${withLifted ? '?includeLifted=1' : ''}`,
      )
      setBans(Array.isArray(data?.bans) ? data.bans : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载封禁列表失败')
    } finally {
      setLoadingBans(false)
    }
  }, [])

  useEffect(() => {
    void loadBans(includeLifted)
  }, [loadBans, includeLifted])

  const search = async () => {
    const q = query.trim()
    if (!q) {
      setResults([])
      setSearched(false)
      return
    }
    setSearching(true)
    setError('')
    setNotice('')
    try {
      const data = await api.get<{ users: ChatUserResult[] }>(
        `/admin/chat/users?q=${encodeURIComponent(q)}`,
      )
      setResults(Array.isArray(data?.users) ? data.users : [])
      setSearched(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索用户失败')
    } finally {
      setSearching(false)
    }
  }

  const startBan = (user: ChatUserResult) => {
    setBanTarget(user)
    setReason('')
    setError('')
    setNotice('')
  }

  const submitBan = async () => {
    if (!banTarget) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const data = await api.post<{ created: boolean; kicked: number }>('/admin/chat/bans', {
        userId: banTarget.id,
        reason: reason.trim(),
      })
      const kicked = Number(data?.kicked ?? 0)
      setNotice(
        `${data?.created ? '已封禁' : '已更新封禁原因'}：${banTarget.username}${kicked > 0 ? `（已断开 ${kicked} 条在线聊天连接）` : ''}`,
      )
      setBanTarget(null)
      setReason('')
      setResults((prev) =>
        prev.map((item) =>
          item.id === banTarget.id ? { ...item, chatBanned: true, chatBanReason: reason.trim() } : item,
        ),
      )
      await loadBans(includeLifted)
    } catch (err) {
      setError(err instanceof Error ? err.message : '封禁失败')
    } finally {
      setBusy(false)
    }
  }

  const unban = async (row: ChatBanRow) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api.delete(`/admin/chat/bans/${row.userId}`)
      setNotice(`已解封：${row.username}`)
      setResults((prev) =>
        prev.map((item) =>
          item.id === row.userId ? { ...item, chatBanned: false, chatBanReason: '' } : item,
        ),
      )
      await loadBans(includeLifted)
    } catch (err) {
      setError(err instanceof Error ? err.message : '解封失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="gh-page-container">
      <div className="gh-page-header">
        <div>
          <h1 className="gh-page-title">聊天治理</h1>
          <p className="gh-page-subtitle">
            禁止账号使用 LineWeb 的聊天入口（会话、图片、WebSocket / 长轮询全部拒绝），已建立的连接会立即断开；
            不影响 neko 账号本身，解封后立刻恢复。管理员账号不受封禁影响。
          </p>
        </div>
        <Button variant="secondary" size="md" onClick={() => void loadBans(includeLifted)}>
          刷新
        </Button>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <section className="gh-box gh-chatadmin-section" aria-label="封禁账号">
        <h2 className="gh-chatadmin-title">封禁账号</h2>
        <form
          className="gh-chatadmin-search"
          onSubmit={(event) => {
            event.preventDefault()
            void search()
          }}
        >
          <input
            className="gh-input"
            value={query}
            placeholder="输入用户名或邮箱搜索"
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button variant="primary" size="md" type="submit" disabled={searching}>
            {searching ? '搜索中…' : '搜索'}
          </Button>
        </form>

        {searched && results.length === 0 && (
          <p className="gh-chatadmin-hint">没有匹配的账号。</p>
        )}

        {results.length > 0 && (
          <ul className="gh-chatadmin-users">
            {results.map((user) => {
              const isAdmin = user.role === 'admin'
              const editing = banTarget?.id === user.id
              return (
                <li key={user.id} className="gh-chatadmin-user">
                  <div className="gh-chatadmin-user-main">
                    <strong>{user.username}</strong>
                    <span className="gh-chatadmin-muted">{user.email}</span>
                    <Badge variant={user.role === 'admin' ? 'danger' : 'default'}>
                      {roleLabel(user.role)}
                    </Badge>
                    <span className="gh-chatadmin-muted">
                      {STATUS_LABELS[user.status] ?? user.status}
                    </span>
                    {user.chatBanned && <Badge variant="warning">聊天已封禁</Badge>}
                  </div>
                  <div className="gh-chatadmin-user-actions">
                    {user.chatBanned ? (
                      <button
                        type="button"
                        className="gh-btn gh-btn--secondary gh-btn--sm"
                        disabled={busy}
                        onClick={() =>
                          void unban({
                            userId: user.id,
                            username: user.username,
                            reason: user.chatBanReason,
                            bannedBy: null,
                            createdAt: '',
                            active: true,
                            liftedAt: null,
                          })
                        }
                      >
                        解封
                      </button>
                    ) : editing ? (
                      <span className="gh-chatadmin-hint">在下方填写原因</span>
                    ) : (
                      <button
                        type="button"
                        className="gh-btn gh-btn--danger gh-btn--sm"
                        disabled={busy || isAdmin}
                        title={isAdmin ? '不能封禁管理员账号' : undefined}
                        onClick={() => startBan(user)}
                      >
                        封禁
                      </button>
                    )}
                  </div>
                  {editing && (
                    <div className="gh-chatadmin-ban-form">
                      <input
                        className="gh-input"
                        value={reason}
                        maxLength={200}
                        autoFocus
                        placeholder="封禁原因（可选，会展示给被封禁的账号）"
                        onChange={(event) => setReason(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            void submitBan()
                          }
                          if (event.key === 'Escape') setBanTarget(null)
                        }}
                        disabled={busy}
                      />
                      <Button
                        variant="danger"
                        size="md"
                        disabled={busy}
                        onClick={() => void submitBan()}
                      >
                        {busy ? '处理中…' : `确认封禁 ${user.username}`}
                      </Button>
                      <button
                        type="button"
                        className="gh-btn gh-btn--secondary gh-btn--sm"
                        disabled={busy}
                        onClick={() => setBanTarget(null)}
                      >
                        取消
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="gh-box gh-chatadmin-section" aria-label="封禁列表">
        <div className="gh-chatadmin-section-head">
          <h2 className="gh-chatadmin-title">封禁列表</h2>
          <label className="gh-check">
            <input
              type="checkbox"
              checked={includeLifted}
              onChange={(event) => setIncludeLifted(event.target.checked)}
            />
            显示已解封
          </label>
        </div>

        {loadingBans ? (
          <p className="gh-chatadmin-hint">正在加载…</p>
        ) : bans.length === 0 ? (
          <p className="gh-chatadmin-hint">
            {includeLifted ? '还没有任何封禁记录。' : '当前没有被封禁的账号。'}
          </p>
        ) : (
          <div className="gh-table-wrap">
            <table className="gh-table">
              <thead>
                <tr>
                  <th>账号</th>
                  <th>状态</th>
                  <th>原因</th>
                  <th>封禁时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {bans.map((row) => (
                  <tr key={`${row.userId}-${row.createdAt}`}>
                    <td>
                      {row.username}
                      <span className="gh-chatadmin-muted"> #{row.userId}</span>
                    </td>
                    <td>
                      {row.active ? (
                        <Badge variant="danger">封禁中</Badge>
                      ) : (
                        <span className="gh-chatadmin-muted">
                          已解封{row.liftedAt ? ` · ${formatTime(row.liftedAt)}` : ''}
                        </span>
                      )}
                    </td>
                    <td>{row.reason || <span className="gh-chatadmin-muted">未填写</span>}</td>
                    <td className="gh-chatadmin-muted">{formatTime(row.createdAt)}</td>
                    <td>
                      {row.active ? (
                        <button
                          type="button"
                          className="gh-btn gh-btn--secondary gh-btn--sm"
                          disabled={busy}
                          onClick={() => void unban(row)}
                        >
                          解封
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
