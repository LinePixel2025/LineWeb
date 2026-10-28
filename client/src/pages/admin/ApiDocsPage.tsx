import { useState } from 'react'
import { Link } from 'react-router-dom'
import { GitHubBadge, GitHubButton, GitHubAlert } from '../../components/ui'
import { useAuth } from '../../contexts/AuthContext'
import { CAPABILITIES, capabilityLabel, roleLabel } from '../../lib/permissions'

const ENDPOINTS = [
  { group: '认证', items: [
    { method: 'POST', path: '/api/auth/login', note: '账号登录，返回访问令牌（可传 rememberDays 1–90 申请长期令牌）' },
    { method: 'GET', path: '/api/auth/me', note: '当前账号信息（含角色与 capabilities）' },
  ] },
  { group: '文章', items: [
    { method: 'GET', path: '/api/posts', note: '公开文章列表（仅已发布）' },
    { method: 'GET', path: '/api/posts/admin/all', note: '全部文章（content:write；作者只返回自己的文章，content:manage 看全站含草稿）' },
    { method: 'GET', path: '/api/posts/admin/:id', note: '管理视图单篇文章（作者本人或 content:manage，否则 404）' },
    { method: 'POST', path: '/api/posts', note: '创建文章（content:write，创建者即作者）' },
    { method: 'PUT', path: '/api/posts/:id', note: '更新文章（content:write；仅作者本人，content:manage 可改全部）' },
    { method: 'DELETE', path: '/api/posts/:id', note: '删除文章（content:write；仅作者本人，content:manage 可删全部）' },
    { method: 'POST', path: '/api/comments', note: '发表评论（登录即可）' },
  ] },
  { group: '页面', items: [
    { method: 'GET', path: '/api/pages', note: '页面管理列表（content:manage）' },
    { method: 'GET', path: '/api/pages/:id', note: '页面详情 / 控件树（content:manage）' },
    { method: 'POST', path: '/api/pages', note: '创建页面（content:manage）' },
    { method: 'PUT', path: '/api/pages/:id', note: '更新页面（content:manage）' },
    { method: 'DELETE', path: '/api/pages/:id', note: '删除页面（content:manage）' },
  ] },
  { group: '网盘', items: [
    { method: 'GET', path: '/api/drive/files', note: '文件列表（需网盘权限开关或 drive:all；普通账号默认 2 GB 空间配额）' },
    { method: 'GET', path: '/api/drive/quota', note: '空间配额与已用空间（drive:all 返回不限；超出配额上传返回 413 QUOTA_EXCEEDED）' },
  ] },
  { group: '聊天（XMPP · neko）', items: [
    { method: 'GET', path: '/api/chat/friends', note: '好友列表（LineWeb Prisma 仍为唯一真相源）' },
    { method: 'GET', path: '/api/chat/friend-requests', note: '好友申请（收到 / 发出）' },
    { method: 'GET', path: '/api/chat/xmpp/bootstrap', note: '一次性票据 + 过滤后的聊天状态（好友 / 有往来的原生联系人 / 群）' },
    { method: 'GET', path: '/api/chat/xmpp/state', note: '刷新聊天状态（轮询降级时使用）' },
    { method: 'GET', path: '/api/chat/xmpp/directory', note: '搜索 neko 用户（?q=，lw_* 只回好友）' },
    { method: 'POST', path: '/api/chat/xmpp/rooms', note: '建群 { name, memberIds }（groupchat 走 neko rooms）' },
    { method: 'POST', path: '/api/chat/xmpp/messages/recall', note: '撤回消息（5 分钟内，仅本人）' },
    { method: 'POST', path: '/api/chat/xmpp/uploads', note: '图片消息上传（raw 二进制，Content-Type 图片类型）→ /chat/uploads/<id>?token=' },
    { method: 'WS', path: '/ws/xmpp?token=', note: 'XMPP over WebSocket 中继：SASL/bind 由浏览器侧客户端完成；不可用时降级为 /api/chat/xmpp/http-* 长轮询' },
    { method: 'WS', path: '/ws/chat', note: '游戏与好友事件推送：连接后先发 {type:"auth",token}，推送 game:* 与 friend:*（聊天消息不再经过这里）' },
    { method: 'GET', path: '/api/chat/conversations', note: '已废弃：返回 410 CHAT_MIGRATED（旧聊天表仅作只读存档）' },
  ] },
  { group: '数字健康', items: [
    { method: 'GET', path: '/api/health/screen-time', note: '今日屏幕时间（仅本人）' },
    { method: 'POST', path: '/api/health/push', note: '设备推送屏幕时间（同一账号令牌）' },
  ] },
  { group: '管理', items: [
    { method: 'GET', path: '/api/users', note: '用户管理（user:manage），返回角色、网盘开关、storageQuota / storageUsed（字节数字符串）' },
    { method: 'PUT', path: '/api/users/:id', note: '修改用户角色（user / author / admin）或密码（user:manage）' },
    { method: 'PUT', path: '/api/users/:id/quota', note: '设置空间配额，body { "storageQuotaBytes": "2147483648" }（纯数字字符串；0 = 不限；user:manage）' },
    { method: 'PUT', path: '/api/users/:id/drive-access', note: '开关用户网盘权限（user:manage）' },
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
            完整清单可在登录后请求 <code>GET /api</code> 获取；认证与权限细节见仓库 <code>docs/auth-api.md</code>，
            全部端点详解见 <code>docs/api.md</code>。
          </p>
        </div>

        <div className="gh-box" style={{ padding: 'var(--gh-space-4)' }}>
          <h2 style={{ marginTop: 0, fontSize: 'var(--gh-text-lg)' }}>第三方应用接入</h2>
          <p className="gh-text-secondary" style={{ lineHeight: 1.9 }}>
            第三方应用<strong>不应保存用户密码</strong>，而应使用 OAuth 2.0 授权码 + PKCE 流程：
            用户在你的应用中点击登录后，跳转到本站的{' '}
            <code>/authorize?client_id=&amp;redirect_uri=&amp;scope=&amp;state=&amp;code_challenge=&amp;code_challenge_method=S256</code>
            ，用户在<strong>账户验证页</strong>确认授权；应用随后用服务端返回的一次性授权码调用{' '}
            <code>POST /api/oauth/token</code> 换取访问令牌与刷新令牌。
          </p>
          <ul className="gh-text-secondary" style={{ margin: '12px 0 0', paddingLeft: '1.2em', lineHeight: 1.9 }}>
            <li>应用需先在 <Link to="/admin/apps">应用授权</Link> 页面注册，取得 <code>client_id</code>（机密客户端还有 <code>client_secret</code>）。</li>
            <li>访问令牌有效期 1 小时，刷新令牌 30 天且每次刷新都会轮换；重复使用旧刷新令牌会吊销整条授权。</li>
            <li>应用令牌是<strong>作用域令牌</strong>（<code>role=app</code>）：只能访问白名单端点，且无法获得用户管理、设备监控、站点统计、AI 配置等任何管理能力。</li>
            <li>用户可以随时在「个人资料 → 已授权的应用」中撤销授权，撤销后令牌立即失效。</li>
            <li>完整接入说明（端点、PKCE 示例、scope 清单、错误码、自检清单）见仓库 <code>docs/app-auth-api.md</code>。</li>
          </ul>
        </div>

        <div className="gh-box" style={{ padding: 'var(--gh-space-4)' }}>
          <h2 style={{ marginTop: 0, fontSize: 'var(--gh-text-lg)' }}>注意事项</h2>
          <ul className="gh-text-secondary" style={{ margin: 0, paddingLeft: '1.2em', lineHeight: 1.9 }}>
            <li>令牌默认有效期 7 天；登录时传 <code>rememberDays</code>（1–90）可申请更长的设备令牌。</li>
            <li>退出登录或修改密码会让该账号的<strong>所有</strong>旧令牌（含已授权的应用令牌）立即失效。</li>
            <li>角色变更即时生效，无需重新登录；管理员自动获得全部能力（含网盘访问）。</li>
            <li>登录接口限流 20 次 / 15 分钟（按 IP），设备请缓存令牌并处理 401 重登。</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
