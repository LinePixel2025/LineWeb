import { useState, useEffect, useCallback } from 'react'
import LiquidGlass from '../../components/glass/LiquidGlass'
import api from '../../lib/api'

interface DeviceInfo {
  id: number
  ip: string
  userAgent: string
  os: string
  browser: string
  deviceType: string
  firstSeen: string
  lastSeen: string
  requestCount: number
  pathsAccessed: string[]
}

interface DevicesResponse {
  online: DeviceInfo[]
  onlineCount: number
  totalCount: number
  allTime: DeviceInfo[]
}

export default function ApiAdminPage() {
  const [data, setData] = useState<DevicesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const fetchData = useCallback(() => {
    api.get<DevicesResponse>('/devices')
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    if (!autoRefresh) return
    const timer = setInterval(fetchData, 10000)
    return () => clearInterval(timer)
  }, [autoRefresh, fetchData])

  const stats = [
    { label: '当前在线', value: data?.onlineCount ?? 0, color: '#4ade80' },
    { label: '总记录数', value: data?.totalCount ?? 0, color: '#60a5fa' },
    { label: '总请求接口', value: data?.allTime.reduce((s, d) => s + d.requestCount, 0) ?? 0, color: '#f59e0b' },
  ]

  const renderDeviceRow = (device: DeviceInfo, index: number) => (
    <tr key={device.id} className="admin-row fade-in" style={{ animationDelay: `${index * 0.03}s` }}>
      <td className="admin-cell" data-label="IP 地址">
        <code className="api-cell-ip">{device.ip}</code>
      </td>
      <td className="admin-cell" data-label="设备类型">
        <span className="api-device-badge">{device.deviceType}</span>
      </td>
      <td className="admin-cell" data-label="操作系统">
        {device.os}
      </td>
      <td className="admin-cell" data-label="浏览器">
        {device.browser}
      </td>
      <td className="admin-cell admin-cell--date" data-label="首次访问">
        {new Date(device.firstSeen).toLocaleString('zh-CN')}
      </td>
      <td className="admin-cell admin-cell--date" data-label="最后访问">
        {new Date(device.lastSeen).toLocaleString('zh-CN')}
      </td>
      <td className="admin-cell" data-label="请求次数" style={{ textAlign: 'center' }}>
        <span className="api-request-count">{device.requestCount}</span>
      </td>
    </tr>
  )

  const activeDevices = data?.online ?? []
  const historyDevices = data?.allTime?.filter(d => !activeDevices.some(a => a.id === d.id)) ?? []

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1 className="admin-page-title">API 管理</h1>
        <div className="api-header-controls">
          <label className="api-auto-refresh-label">
            <input
              type="checkbox"
              className="api-auto-refresh-checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
            />
            自动刷新 (10s)
          </label>
          <button className="api-refresh-btn" onClick={() => { setLoading(true); fetchData() }}>
            刷新
          </button>
        </div>
      </div>

      {loading ? (
        <div className="admin-spinner"><div className="spinner" /></div>
      ) : (
        <>
          <div className="api-stat-cards">
            {stats.map(s => (
              <LiquidGlass key={s.label} variant="blur" className="api-stat-card">
                <div className="api-stat-card-value" style={{ color: s.color }}>{s.value}</div>
                <div className="api-stat-card-label">{s.label}</div>
              </LiquidGlass>
            ))}
          </div>

          <LiquidGlass variant="blur" className="admin-page-table-wrap" style={{ marginTop: '24px' }}>
            <div className="api-section-title">
              <span>在线设备</span>
              <span className="api-section-badge">{activeDevices.length}</span>
            </div>
            {activeDevices.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--lg-text-tertiary)' }}>
                暂无在线设备
              </div>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th className="admin-th" style={{ width: '15%' }}>IP 地址</th>
                    <th className="admin-th" style={{ width: '12%' }}>设备类型</th>
                    <th className="admin-th" style={{ width: '10%' }}>操作系统</th>
                    <th className="admin-th" style={{ width: '10%' }}>浏览器</th>
                    <th className="admin-th admin-cell--date" style={{ width: '16%' }}>首次访问</th>
                    <th className="admin-th admin-cell--date" style={{ width: '16%' }}>最后访问</th>
                    <th className="admin-th" style={{ width: '8%', textAlign: 'center' }}>请求次数</th>
                  </tr>
                </thead>
                <tbody>
                  {activeDevices.map(renderDeviceRow)}
                </tbody>
              </table>
            )}
          </LiquidGlass>

          {historyDevices.length > 0 && (
            <LiquidGlass variant="blur" className="admin-page-table-wrap" style={{ marginTop: '20px' }}>
              <div className="api-section-title">
                <span>离线历史</span>
                <span className="api-section-badge api-section-badge--offline">{historyDevices.length}</span>
              </div>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th className="admin-th" style={{ width: '15%' }}>IP 地址</th>
                    <th className="admin-th" style={{ width: '12%' }}>设备类型</th>
                    <th className="admin-th" style={{ width: '10%' }}>操作系统</th>
                    <th className="admin-th" style={{ width: '10%' }}>浏览器</th>
                    <th className="admin-th admin-cell--date" style={{ width: '16%' }}>首次访问</th>
                    <th className="admin-th admin-cell--date" style={{ width: '16%' }}>最后访问</th>
                    <th className="admin-th" style={{ width: '8%', textAlign: 'center' }}>请求次数</th>
                  </tr>
                </thead>
                <tbody>
                  {historyDevices.map(renderDeviceRow)}
                </tbody>
              </table>
            </LiquidGlass>
          )}

          <div style={{ marginTop: '12px', textAlign: 'right', fontSize: '0.75rem', color: 'var(--lg-text-tertiary)', opacity: 0.6 }}>
            30 分钟无活动自动标记为离线 · 每 10 秒自动刷新
          </div>
        </>
      )}
    </div>
  )
}
