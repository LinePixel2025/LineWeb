import { useState, useEffect, useCallback } from 'react'
import { GitHubButton } from '../../components/ui'
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

export default function DeviceMonitorPage() {
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
    { label: '当前在线', value: data?.onlineCount ?? 0, color: 'var(--gh-success)' },
    { label: '总记录数', value: data?.totalCount ?? 0, color: 'var(--gh-accent)' },
    { label: '总请求接口', value: data?.allTime.reduce((s, d) => s + d.requestCount, 0) ?? 0, color: 'var(--gh-warning)' },
  ]

  const renderDeviceRow = (device: DeviceInfo, index: number) => (
    <tr key={device.id}>
      <td>
        <code style={{
          padding: '2px 8px', borderRadius: 'var(--gh-radius)',
          background: 'var(--gh-canvas-inset)', fontSize: 'var(--gh-text-xs)',
          color: 'var(--gh-text-secondary)', fontFamily: 'var(--gh-font-mono)',
        }}>
          {device.ip}
        </code>
      </td>
      <td>
        <span style={{
          display: 'inline-flex', alignItems: 'center', padding: '2px 8px',
          fontSize: 'var(--gh-text-xs)', fontWeight: 500,
          borderRadius: 'var(--gh-radius)',
          background: 'var(--gh-canvas-inset)', color: 'var(--gh-text-secondary)',
        }}>
          {device.deviceType}
        </span>
      </td>
      <td>{device.os}</td>
      <td>{device.browser}</td>
      <td className="gh-text-tertiary">
        {new Date(device.firstSeen).toLocaleString('zh-CN')}
      </td>
      <td className="gh-text-tertiary">
        {new Date(device.lastSeen).toLocaleString('zh-CN')}
      </td>
      <td style={{ textAlign: 'center' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          minWidth: '32px', height: '22px', padding: '0 6px',
          fontSize: 'var(--gh-text-xs)', fontWeight: 600,
          borderRadius: 'var(--gh-radius)',
          background: 'var(--gh-accent-soft)', color: 'var(--gh-accent)',
        }}>
          {device.requestCount}
        </span>
      </td>
    </tr>
  )

  const activeDevices = data?.online ?? []
  const historyDevices = data?.allTime?.filter(d => !activeDevices.some(a => a.id === d.id)) ?? []

  return (
    <div>
      <div className="gh-page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1>设备监控</h1>
          <p>实时监控网站访问设备</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gh-space-3)' }}>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 'var(--gh-space-2)',
            fontSize: 'var(--gh-text-sm)', color: 'var(--gh-text-secondary)', cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              style={{ accentColor: 'var(--gh-accent)' }}
            />
            自动刷新 (10s)
          </label>
          <GitHubButton variant="secondary" size="sm" onClick={() => { setLoading(true); fetchData() }}>
            刷新
          </GitHubButton>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--gh-space-7)' }}>
          <div className="gh-spinner" />
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--gh-space-3)', marginBottom: 'var(--gh-space-5)' }}>
            {stats.map(s => (
              <div key={s.label} className="gh-box" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 'var(--gh-text-2xl)', fontWeight: 700, color: s.color }}>
                  {s.value}
                </div>
                <div className="gh-text-tertiary" style={{ marginTop: '4px' }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          <div className="gh-box gh-table-wrap" style={{ padding: 0, marginBottom: 'var(--gh-space-4)' }}>
            <div style={{
              padding: 'var(--gh-space-3) var(--gh-space-4)',
              fontWeight: 600, fontSize: 'var(--gh-text-sm)',
              borderBottom: '1px solid var(--gh-border)',
              display: 'flex', alignItems: 'center', gap: 'var(--gh-space-2)',
            }}>
              <span>在线设备</span>
              <span style={{
                fontSize: 'var(--gh-text-xs)', fontWeight: 500,
                background: 'var(--gh-canvas-inset)', color: 'var(--gh-text-secondary)',
                padding: '1px 8px', borderRadius: 'var(--gh-radius)',
              }}>
                {activeDevices.length}
              </span>
            </div>
            {activeDevices.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center' }} className="gh-text-tertiary">
                暂无在线设备
              </div>
            ) : (
              <table className="gh-table">
                <thead>
                  <tr>
                    <th style={{ width: '15%' }}>IP 地址</th>
                    <th style={{ width: '12%' }}>设备类型</th>
                    <th style={{ width: '10%' }}>操作系统</th>
                    <th style={{ width: '10%' }}>浏览器</th>
                    <th style={{ width: '16%' }}>首次访问</th>
                    <th style={{ width: '16%' }}>最后访问</th>
                    <th style={{ width: '8%', textAlign: 'center' }}>请求次数</th>
                  </tr>
                </thead>
                <tbody>
                  {activeDevices.map(renderDeviceRow)}
                </tbody>
              </table>
            )}
          </div>

          {historyDevices.length > 0 && (
            <div className="gh-box gh-table-wrap" style={{ padding: 0 }}>
              <div style={{
                padding: 'var(--gh-space-3) var(--gh-space-4)',
                fontWeight: 600, fontSize: 'var(--gh-text-sm)',
                borderBottom: '1px solid var(--gh-border)',
                display: 'flex', alignItems: 'center', gap: 'var(--gh-space-2)',
              }}>
                <span>离线历史</span>
                <span style={{
                  fontSize: 'var(--gh-text-xs)', fontWeight: 500,
                  background: 'var(--gh-danger-soft)', color: 'var(--gh-danger)',
                  padding: '1px 8px', borderRadius: 'var(--gh-radius)',
                }}>
                  {historyDevices.length}
                </span>
              </div>
              <table className="gh-table">
                <thead>
                  <tr>
                    <th style={{ width: '15%' }}>IP 地址</th>
                    <th style={{ width: '12%' }}>设备类型</th>
                    <th style={{ width: '10%' }}>操作系统</th>
                    <th style={{ width: '10%' }}>浏览器</th>
                    <th style={{ width: '16%' }}>首次访问</th>
                    <th style={{ width: '16%' }}>最后访问</th>
                    <th style={{ width: '8%', textAlign: 'center' }}>请求次数</th>
                  </tr>
                </thead>
                <tbody>
                  {historyDevices.map(renderDeviceRow)}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 'var(--gh-space-3)', textAlign: 'right', fontSize: 'var(--gh-text-xs)', color: 'var(--gh-text-tertiary)' }}>
            30 分钟无活动自动标记为离线 · 每 10 秒自动刷新
          </div>
        </>
      )}
    </div>
  )
}
