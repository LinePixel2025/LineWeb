import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ProxyViewer from '../components/proxy/ProxyViewer'
import { webProxyApi, type ProxySite } from '../lib/webProxy'

type Status = 'loading' | 'ready' | 'error'

/**
 * 反代查看页：进入时先调用 /sites/:id/open 换取 httpOnly 的 lw_proxy 会话 Cookie，
 * 再挂载 iframe。真正的站点 Cookie 保存在服务端，浏览器只持有 LineWeb 自己的会话票据。
 */
export default function WebProxyViewPage() {
  const { siteId } = useParams<{ siteId: string }>()
  const id = Number(siteId)
  const [status, setStatus] = useState<Status>('loading')
  const [site, setSite] = useState<ProxySite | null>(null)
  const [embedUrl, setEmbedUrl] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setSite(null)
    setEmbedUrl('')
    setError('')

    if (!Number.isInteger(id) || id <= 0) {
      setStatus('error')
      setError('反代站点不存在或已被删除。')
      return
    }

    void (async () => {
      try {
        const { sites } = await webProxyApi.list()
        if (cancelled) return
        const found = sites.find((item) => item.id === id)
        if (!found) {
          setStatus('error')
          setError('反代站点不存在或已被删除。')
          return
        }
        const opened = await webProxyApi.open(id)
        if (cancelled) return
        setSite(opened.site)
        setEmbedUrl(opened.url)
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        setStatus('error')
        setError(err instanceof Error ? err.message : '反代站点打开失败，请稍后再试。')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    if (!site) return
    const previous = document.title
    document.title = `${site.name} — LineWeb 反代`
    return () => {
      document.title = previous
    }
  }, [site])

  if (status === 'ready' && site && embedUrl) {
    return (
      <div className="gh-proxy-viewer-page">
        <ProxyViewer site={site} embedUrl={embedUrl} />
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className="gh-proxy-viewer-page gh-proxy-viewer-page--state">
        <div className="gh-spinner" />
        <p className="gh-text-secondary">正在连接反代站点…</p>
      </div>
    )
  }

  return (
    <div className="gh-proxy-viewer-page gh-proxy-viewer-page--state">
      <div className="gh-proxy-error-card" role="alert">
        <h1 className="gh-proxy-error-title">无法打开这个反代站点</h1>
        <p className="gh-text-secondary">{error}</p>
        <div className="gh-proxy-error-actions">
          <Link to="/webproxy" className="gh-btn gh-btn--primary gh-btn--md">返回站点列表</Link>
          <Link to="/features" className="gh-btn gh-btn--md">返回功能页</Link>
        </div>
      </div>
    </div>
  )
}
