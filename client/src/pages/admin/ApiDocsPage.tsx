import { useState } from 'react'
import { GitHubBadge, GitHubButton, GitHubAlert } from '../../components/ui'
import { useAuth } from '../../contexts/AuthContext'
import { CAPABILITIES, capabilityLabel, roleLabel } from '../../lib/permissions'

const ENDPOINTS = [
  { group: '认证', items: [
    { method: 'POST', path: '/api/auth/login', note: '账号登录，返回访问令牌（可传 rememberDays 1–90 申请长期令牌）' },
    { method: 'GET', path: '/api/auth/me', note: '当前账号信息（含角色与 capabilities）' },
  ] },
  { group: '内容', items: [
    { method: 'GET', path: '/api/posts', note: '公开文章列表' },
    { method: 'GET', path: '/api/posts/admin/all', note: '全部文章（content:write）' },
    { method: 'POST', path: '/api/comments', note: '发表评论（登录即可）' },
  ] },
  { group: '网盘', items: [
    { method: 'GET', path: '/api/drive/files', note: '文件列表（需网盘权限开关或 drive:all）' },
  ] },
  { group: '数字健康', items: [
    { method: 'GET', path: '/api/health/screen-time', note: '今日屏幕时间（仅本人）' },
    { method: 'POST', path: '/api/health/push', note: '设备推送屏幕时间（同一账号令牌）' },
  ] },
  { group: '管理', items: [
    { method: 'GET', path: '/api/users', note: '用户管理（user:manage）' },
    { method: 'GET', path: '/api/stats', note: '站点统计（stats:view）' },
    { method: 'GET', path: '/api/devices', note: '设备监控（device:view）' },
    { method: 'GET', path: '/api/ai/config', note: 'AI 配置（ai:configure）' },
    { method: 'GET', path: '/api', note: 'API 自描述清单（登录后）' },
  ] },
]

const CURL_EXAMPLE = `# 1. 用账号登录换取访问令牌（设备可加 "rememberDays": 90 申请长期令牌）
curl -X POST http://localhost:3001/api/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"identifier":"admin","password":"你的密码"}'

# 2. 后续所有请求携带同一个令牌
curl http://localhost:3001/api/auth/me \\
  -H "Authorization: Bearer <token>"`

const PY_EXAMPLE = `import requests

BASE = "http://localhost:3001"

token = requests.post(f"{BASE}/api/auth/login", json={
    "identifier": "admin",
    "password": "你的密码",
    "rememberDays": 90,           # 可选：设备长期令牌（1–90 天）
}).json()["token"]

# 推送屏幕时间（设备只需账号令牌，无需额外密钥）
requests.post(f"{BASE}/api/health/push",
              json={"totalSeconds": 3600, "date": "2026-01-01"},
              headers={"Authorization": f"Bearer {token}"})`

export default function ApiDocsPage() {
  const { user, can, isAdmin } = useAuth()
  const [copied, setCopied] = useState<'curl' | 'python' | null>(null)

  const copy = async (text: string, which: 'curl' | 'python') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      alert('复制失败，请手动选择文本复制')
    }
  }

  const codeStyle: React.CSSProperties = {
    display: 'block',
    padding: 'var(--gh-space-3)',
    borderRadius: 'var(--gh-radius)',
    background: 'var(--gh-canvas-inset)',
    border: '1px solid var(--gh-border)',
    fontFamily: 'var(--gh-font-mono)',
    fontSize: 'var(--gh-text-xs)',
    lineHeight: 1.6,
    whiteSpace: 'pre',
    overflowX: 'auto',
    margin: 0,
  }

  return (
    <div>
      <div className="gh-page-header">
        <h1>API 接入</h1>
        <p>LineWeb 只使用账号登录令牌：登录一次，即可访问全部 API；权限由账号角色自动决定。</p>
      </div>

      <GitHubAlert variant="info">
        自 2026-09 起 API Key 与屏幕时间 Token 已移除。所有请求统一使用
        <code> Authorization: Bearer &lt;登录令牌&gt;</code>，第三方设备（如 Time Master）请改为账号登录。
      </GitHubAlert>

      <div style={{ display: 'grid', gap: 'var(--gh-space-4)', marginTop: 'var(--gh-space-4)' }}>
        <div className="gh-box" style={{ padding: 'var(--gh-space-4)' }}>
          <h2 style={{ marginTop: 0, fontSize: 'var(--gh-text-lg)' }}>当前账号权限</h2>
          <p className="gh-text-secondary" style={{ marginTop: 0 }}>
            角色：<strong>{roleLabel(user?.role)}</strong>
            {isAdmin && ' — 自动拥有全部能力'}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--gh-space-2)' }}>
            {CAPABILITIES.map(cap => (
              <GitHubBadge key={cap} variant={can(cap) ? 'success' : 'default'}>
                {can(cap) ? '✓ ' : '— '}{capabilityLabel(cap)}
              </GitHubBadge>
            ))}
          </div>
        </div>

        <div className="gh-box" style={{ padding: 'var(--gh-space-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--gh-space-3)' }}>
            <h2 style={{ margin: 0, fontSize: 'var(--gh-text-lg)' }}>1. 登录换取令牌（curl）</h2>
            <GitHubButton variant="secondary" size="sm" onClick={() => copy(CURL_EXAMPLE, 'curl')}>
              {copied === 'curl' ? '✓ 已复制' : '复制'}
            </GitHubButton>
          </div>
          <pre style={{ ...codeStyle, marginTop: 'var(--gh-space-3)' }}>{CURL_EXAMPLE}</pre>
        </div>

        <div className="gh-box" style={{ padding: 'var(--gh-space-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--gh-space-3)' }}>
            <h2 style={{ margin: 0, fontSize: 'var(--gh-text-lg)' }}>2. 设备推送示例（Python）</h2>
            <GitHubButton variant="secondary" size="sm" onClick={() => copy(PY_EXAMPLE, 'python')}>
              {copied === 'python' ? '✓ 已复制' : '复制'}
            </GitHubButton>
          </div>
          <pre style={{ ...codeStyle, marginTop: 'var(--gh-space-3)' }}>{PY_EXAMPLE}</pre>
        </div>

        <div className="gh-box" style={{ padding: 'var(--gh-space-4)' }}>
          <h2 style={{ marginTop: 0, fontSize: 'var(--gh-text-lg)' }}>3. 常用端点</h2>
          <div className="gh-table-wrap">
            <table className="gh-table">
              <thead>
                <tr>
                  <th style={{ width: '12%' }}>方法</th>
                  <th style={{ width: '42%' }}>路径</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {ENDPOINTS.flatMap(group => [
                  <tr key={`g-${group.group}`}>
                    <td colSpan={3} style={{ fontWeight: 600, background: 'var(--gh-canvas-subtle)' }}>{group.group}</td>
                  </tr>,
                  ...group.items.map(item => (
                    <tr key={item.path + item.method}>
                      <td><code>{item.method}</code></td>
                      <td><code style={{ fontFamily: 'var(--gh-font-mono)' }}>{item.path}</code></td>
                      <td className="gh-text-secondary">{item.note}</td>
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
          <p className="gh-text-tertiary" style={{ marginBottom: 0 }}>
            完整清单可在登录后请求 <code>GET /api</code> 获取，或查阅仓库 <code>docs/api.md</code>。
          </p>
        </div>

        <div className="gh-box" style={{ padding: 'var(--gh-space-4)' }}>
          <h2 style={{ marginTop: 0, fontSize: 'var(--gh-text-lg)' }}>注意事项</h2>
          <ul className="gh-text-secondary" style={{ margin: 0, paddingLeft: '1.2em', lineHeight: 1.9 }}>
            <li>令牌默认有效期 7 天；登录时传 <code>rememberDays</code>（1–90）可申请更长的设备令牌。</li>
            <li>退出登录或修改密码会让该账号的<strong>所有</strong>旧令牌立即失效。</li>
            <li>角色变更即时生效，无需重新登录；管理员自动获得全部能力（含网盘访问）。</li>
            <li>登录接口限流 20 次 / 15 分钟（按 IP），设备请缓存令牌并处理 401 重登。</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
