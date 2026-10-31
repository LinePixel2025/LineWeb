import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { clearProxyLocalData, webProxyApi, type ProxySite } from '../../lib/webProxy'
import Icon from '../ui/Icon'

const BADGE_OPEN_KEY = 'lineweb_proxy_badge_open'

function readBadgeOpen(): boolean {
  try {
    const saved = localStorage.getItem(BADGE_OPEN_KEY)
    if (saved === '0') return false
    if (saved === '1') return true
  } catch {
    /* 隐私模式下 localStorage 不可用 */
  }
  // 手机屏幕窄，默认收起，避免遮挡站点内容
  return !window.matchMedia('(max-width: 767px)').matches
}

function LineWebMark({ size = 18 }: { size?: number }) {
  return <Icon name="logo" size={size} />
}

interface Props {
  site: ProxySite
  /** 服务端签发过 lw_proxy 会话 Cookie 后的 iframe 地址 */
  embedUrl: string
}

/**
 * 反代查看器：iframe 铺满内容区，左下角常驻可折叠的 LineWeb 标识。
 *
 * 标识不会被站点内容覆盖（iframe 在独立文档里），收起后仍保留 LineWeb 字标，
 * 点击即可展开「返回站点列表 / 刷新 / 打开原站 / 清除登录」。
 */
export default function ProxyViewer({ site, embedUrl }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [open, setOpen] = useState(readBadgeOpen)
  const [reloadKey, setReloadKey] = useState(0)
  const [currentPath, setCurrentPath] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(BADGE_OPEN_KEY, open ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [open])

  const readPath = useCallback(() => {
    const win = iframeRef.current?.contentWindow
    if (!win) return
    try {
      const pathname = win.location.pathname || '/'
      // 初始 about:blank 的 pathname 是 'blank'，避免闪一下这个假路径
      if (!pathname.startsWith('/')) return
      const prefix = `/proxy/${site.id}`
      const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname
      const search = win.location.search || ''
      setCurrentPath(`${rest || '/'}${search}`)
    } catch {
      /* 跨域时忽略 */
    }
  }, [site.id])

  // 上游站点的部分子资源可能长时间挂起，iframe 的 load 事件不一定触发，
  // 而站内跳转（含 pushState）也不会重建文档，所以用轮询兜底刷新当前路径。
  useEffect(() => {
    readPath()
    const timer = window.setInterval(readPath, 1000)
    return () => window.clearInterval(timer)
  }, [readPath, reloadKey])

  const reload = useCallback(() => {
    setReloadKey((key) => key + 1)
  }, [])

  const handleClearLogin = useCallback(async () => {
    if (!window.confirm(`清除「${site.name}」在本账号下保存的全部登录状态？清除后需要重新登录该网站。`)) return
    setBusy(true)
    try {
      await webProxyApi.clearCookies(site.id)
      clearProxyLocalData(site.id)
      reload()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '清除失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }, [site.id, site.name, reload])

  const openOriginal = useCallback(() => {
    window.open(site.origin, '_blank', 'noopener,noreferrer')
  }, [site.origin])

  return (
    <div className="gh-proxy-viewer">
      <iframe
        key={reloadKey}
        ref={iframeRef}
        className="gh-proxy-viewer-frame"
        src={embedUrl}
        title={`${site.name}（经 LineWeb 反代）`}
        onLoad={readPath}
        allow="clipboard-read; clipboard-write; fullscreen; microphone; camera; geolocation"
      />

      <div className={`gh-proxy-badge ${open ? 'gh-proxy-badge--open' : ''}`}>
        {open ? (
          <>
            <div className="gh-proxy-badge-head">
              <span className="gh-proxy-badge-brand">
                <LineWebMark />
                <span>LineWeb</span>
              </span>
              <span className="gh-proxy-badge-divider" aria-hidden="true" />
              <span className="gh-proxy-badge-site" title={site.origin}>
                {site.host}
              </span>
              {site.forceDesktop && <span className="gh-proxy-badge-mode">桌面版</span>}
              <button
                type="button"
                className="gh-proxy-badge-collapse"
                onClick={() => setOpen(false)}
                title="收起 LineWeb 工具条"
                aria-label="收起 LineWeb 工具条"
              >
                <Icon name="chevron-up" size={14} />
              </button>
            </div>

            {currentPath && (
              <div className="gh-proxy-badge-path" title={currentPath}>{currentPath}</div>
            )}

            <div className="gh-proxy-badge-actions">
              <Link to="/webproxy" className="gh-proxy-badge-action">
                <Icon name="arrow-left" size={14} />
                站点列表
              </Link>
              <button type="button" className="gh-proxy-badge-action" onClick={reload} disabled={busy}>
                <Icon name="refresh" size={14} />
                刷新
              </button>
              <button type="button" className="gh-proxy-badge-action" onClick={openOriginal}>
                <Icon name="link" size={14} />
                原站
              </button>
              <button
                type="button"
                className="gh-proxy-badge-action gh-proxy-badge-action--danger"
                onClick={handleClearLogin}
                disabled={busy}
              >
                <Icon name="trash" size={14} />
                {busy ? '清除中…' : '清除登录'}
              </button>
            </div>

            <p className="gh-proxy-badge-hint">
              登录状态保存在你的账号，换设备后仍然有效。
            </p>
          </>
        ) : (
          <button
            type="button"
            className="gh-proxy-badge-collapsed"
            onClick={() => setOpen(true)}
            title="展开 LineWeb 工具条（返回站点列表 / 刷新 / 清除登录）"
            aria-label="展开 LineWeb 工具条"
          >
            <LineWebMark size={16} />
            <span>LineWeb</span>
          </button>
        )}
      </div>
    </div>
  )
}
