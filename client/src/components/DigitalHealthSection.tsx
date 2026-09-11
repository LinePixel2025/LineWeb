import { Link } from 'react-router-dom'
import DailyGoalSetter from '@/components/DailyGoalSetter'

/**
 * 数字健康设置
 *
 * 设备同步已统一为账号登录令牌：不再提供独立的屏幕时间密钥，
 * 第三方设备（Time Master 等）登录同一账号后即可推送数据。
 */
export default function DigitalHealthSection() {
  return (
    <div id="digital-health" className="digital-health-settings">
      <div className="digital-health-settings__intro">
        <div className="digital-health-settings__title-mark" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 14.25s-5.5-3.4-5.5-8.1A2.65 2.65 0 0 1 7.1 4.32L8 5.2l.9-.88a2.65 2.65 0 0 1 4.6 1.83c0 4.7-5.5 8.1-5.5 8.1Z" />
          </svg>
        </div>
        <div>
          <h2>数字健康</h2>
          <p>设置今天的屏幕使用边界；设备同步使用 LineWeb 账号登录。</p>
        </div>
      </div>

      <DailyGoalSetter />

      <section className="digital-health-settings__section" aria-labelledby="sync-title">
        <div className="digital-health-settings__section-header">
          <div>
            <h3 id="sync-title">设备同步</h3>
            <p>
              LineWeb 只接受账号登录令牌：设备登录你的账号后，用
              <code> Authorization: Bearer &lt;token&gt;</code> 调用 <code>POST /api/health/push</code> 即可同步屏幕时间。
              登录接口支持 <code>rememberDays</code>（1–90 天）申请长期令牌，无需再单独生成密钥。
            </p>
          </div>
        </div>
        <p className="gh-text-secondary" style={{ marginBottom: 0 }}>
          接入示例与完整端点清单见 <Link to="/admin/api">API 接入</Link> 页面（需管理员账号）。
          修改密码或退出登录会让设备上的旧令牌立即失效，请重新登录。
        </p>
      </section>
    </div>
  )
}
