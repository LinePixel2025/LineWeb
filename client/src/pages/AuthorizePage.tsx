import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { GitHubAlert, GitHubBadge, GitHubButton } from '../components/ui'
import api from '../lib/api'
import { appScopeDescription, appScopeLabel } from '../lib/appScopes'

/**
 * 账户验证（第三方应用授权）页
 *
 * 第三方应用跳转到 /authorize?client_id=&redirect_uri=&scope=&state=&code_challenge=&code_challenge_method=，
 * 用户在此确认是否把自己的 LineWeb 账号授权给该应用。
 *
 * 两条安全约定：
 *   1. 参数合法性由服务端校验（client_id 是否注册、redirect_uri 是否精确匹配、
 *      scope 是否在应用允许范围内、账号是否具备对应能力）；
 *   2. 跳转地址一律由服务端拼装返回，前端绝不自行拼接 —— 任何校验失败都只渲染
 *      错误提示，不做任何跳转（防开放重定向）。
 */

interface AuthorizeContext {
  client: {
    name: string
    description?: string | null
    homepage?: string | null
  }
  scopes: {
    scope: string
    label: string
    description: string
    highRisk: boolean
  }[]
  state?: string | null
}

/** 仅接受 http/https 的主页地址，其余按纯文本展示 */
function safeHomepage(homepage?: string | null): string | null {
  if (!homepage) return null
  try {
    const url = new URL(homepage)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export default function AuthorizePage() {
  const [searchParams] = useSearchParams()
  const { user, loading: authLoading } = useAuth()

  const [context, setContext] = useState<AuthorizeContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [decisionError, setDecisionError] = useState('')

  const clientId = searchParams.get('client_id') ?? ''
  const redirectUri = searchParams.get('redirect_uri') ?? ''
  const scope = searchParams.get('scope') ?? ''
  const state = searchParams.get('state') ?? ''
  const codeChallenge = searchParams.get('code_challenge') ?? ''
  const codeChallengeMethod = searchParams.get('code_challenge_method') ?? 'S256'

  const missingParams = !clientId || !redirectUri || !scope
  const unsupportedPkce = !!codeChallenge && codeChallengeMethod !== 'S256'

  const loadContext = useCallback(async () => {
    if (missingParams) {
      setError('授权请求缺少必要参数（client_id、redirect_uri、scope）')
      setLoading(false)
      return
    }
    if (unsupportedPkce) {
      setError('该应用使用了不支持的 PKCE 校验方式（仅支持 S256）')
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')
    try {
      const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, scope })
      if (state) query.set('state', state)
      const data = await api.get<AuthorizeContext>(`/oauth/authorize-context?${query.toString()}`, { noRedirect: true })
      setContext(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '无法读取授权请求')
    } finally {
      setLoading(false)
    }
  }, [clientId, redirectUri, scope, state, missingParams, unsupportedPkce])

  useEffect(() => { loadContext() }, [loadContext])

  const handleDecision = async (decision: 'approve' | 'deny') => {
    setDecisionError('')
    setSubmitting(true)
    try {
      const data = await api.post<{ redirect: string }>('/oauth/authorize', {
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod,
        decision,
      }, { noRedirect: true })
      // 跳转地址由服务端拼装（回调地址已与注册值精确比对），此处只负责导航；
      // 目标是外部应用域，因此必须用 window.location 而不是 React Router
      window.location.href = data.redirect
    } catch (err: unknown) {
      setDecisionError(err instanceof Error ? err.message : '操作失败，请重试')
      setSubmitting(false)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="gh-page-container gh-auth-page">
        <div className="gh-spinner" />
      </div>
    )
  }

  // 参数非法 / 应用不可用：只展示错误，绝不跳转
  if (error || !context) {
    return (
      <div className="gh-page-container gh-auth-page">
        <div className="gh-box gh-auth-card">
          <h2 style={{ textAlign: 'center', marginBottom: '4px' }}>账户验证</h2>
          <p className="gh-text-secondary" style={{ textAlign: 'center', marginBottom: '24px', fontSize: '0.88rem' }}>
            无法完成授权请求
          </p>
          <GitHubAlert variant="danger" title="请求被拒绝">
            {error || '授权请求无效'}
          </GitHubAlert>
          <p className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)', marginTop: '16px' }}>
            出于安全考虑，LineWeb 不会向未注册的回调地址跳转。请确认应用提供的授权链接是否正确，或联系应用开发者。
          </p>
          <p className="gh-text-tertiary" style={{ textAlign: 'center', marginTop: '20px' }}>
            <Link to="/">返回首页</Link>
          </p>
        </div>
      </div>
    )
  }

  const homepage = safeHomepage(context.client.homepage)

  return (
    <div className="gh-page-container gh-auth-page">
      <div className="gh-box gh-auth-card" style={{ width: 'min(100%, 480px)' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '4px' }}>账户验证</h2>
        <p className="gh-text-secondary" style={{ textAlign: 'center', marginBottom: '24px', fontSize: '0.88rem' }}>
          以下应用请求访问你的 LineWeb 账号
        </p>

        {/* 应用信息 */}
        <div className="gh-consent-app">
          <div className="gh-consent-app-name">{context.client.name}</div>
          {context.client.description && (
            <p className="gh-consent-app-desc">{context.client.description}</p>
          )}
          {homepage && (
            <a
              className="gh-consent-app-link"
              href={homepage}
              target="_blank"
              rel="noopener noreferrer"
            >
              {homepage}
            </a>
          )}
        </div>

        {/* 权限清单 */}
        <div className="gh-consent-section-title">该应用将获得以下权限</div>
        <ul className="gh-consent-scopes">
          {context.scopes.map((item) => (
            <li key={item.scope} className="gh-consent-scope">
              <div className="gh-consent-scope-head">
                <span className="gh-consent-scope-label">{item.label || appScopeLabel(item.scope)}</span>
                {item.highRisk && <GitHubBadge variant="warning">高危权限</GitHubBadge>}
              </div>
              <p className="gh-consent-scope-desc">
                {item.description || appScopeDescription(item.scope)}
              </p>
            </li>
          ))}
        </ul>

        {context.scopes.some((item) => item.highRisk) && (
          <GitHubAlert variant="warning" title="请注意高危权限">
            该应用可以代表你创建、编辑或删除站点内容与评论。请仅在你信任该应用时授权。
          </GitHubAlert>
        )}

        {decisionError && (
          <div style={{ marginTop: '16px' }}>
            <GitHubAlert variant="danger">{decisionError}</GitHubAlert>
          </div>
        )}

        {/* 授权账号 */}
        <div className="gh-consent-account">
          将以 <strong>{user?.username}</strong>
          {user?.email ? `（${user.email}）` : ''} 的身份授权
        </div>

        <div className="gh-consent-actions">
          <GitHubButton
            type="button"
            variant="secondary"
            size="lg"
            fullWidth
            disabled={submitting}
            onClick={() => handleDecision('deny')}
          >
            拒绝
          </GitHubButton>
          <GitHubButton
            type="button"
            variant="primary"
            size="lg"
            fullWidth
            disabled={submitting}
            onClick={() => handleDecision('approve')}
          >
            {submitting ? '处理中…' : '同意授权'}
          </GitHubButton>
        </div>

        <p className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)', marginTop: '20px', textAlign: 'center' }}>
          授权后可在「个人资料 → 已授权的应用」中随时撤销
        </p>
      </div>
    </div>
  )
}
