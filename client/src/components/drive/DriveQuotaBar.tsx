import type { CSSProperties } from 'react'
import { useDriveQuota, type DriveQuota } from '../../hooks/useDriveQuota'
import { formatStorageSize } from '../../lib/format'

export interface DriveQuotaBarProps {
  /** 自增该值即触发重新拉取（组件自行请求 /api/drive/quota） */
  refreshToken?: number
  /** 父组件已拉取的数据；传入时组件不再自行请求（避免重复请求） */
  quota?: DriveQuota | null
  /** 父组件的加载状态（仅在传入 quota 时使用） */
  loading?: boolean
  /** 紧凑模式（移动端 header / 更多操作面板用） */
  compact?: boolean
}

/** 用量超过该比例时进度条转为警示色 */
const WARNING_THRESHOLD_PERCENT = 90

function quotaTextStyle(compact: boolean): CSSProperties {
  return {
    fontSize: 'var(--gh-text-xs)',
    color: 'var(--gh-text-secondary)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: compact ? '100%' : '260px',
  }
}

/** 纯展示组件：根据配额数据渲染文字与进度条 */
function QuotaBarView({
  quota,
  loading,
  compact,
}: {
  quota: DriveQuota | null
  loading?: boolean
  compact: boolean
}) {
  if (!quota) {
    return (
      <div
        className="gh-drive-quota-bar gh-drive-quota-bar--loading"
        style={quotaTextStyle(compact)}
        aria-live="polite"
      >
        {loading ? '正在读取空间用量…' : '空间用量暂不可用'}
      </div>
    )
  }

  const used = Number(quota.used)
  const quotaBytes = quota.quota === null ? null : Number(quota.quota)
  const limited = !quota.unlimited && quotaBytes !== null

  // 不限空间：只展示已用；普通用户：已用 / 上限 + 进度条
  const full = limited && quotaBytes !== null && used >= quotaBytes
  const percent = !limited || quotaBytes === null
    ? 0
    : quotaBytes > 0
      ? Math.min(100, (used / quotaBytes) * 100)
      : 100
  const warning = limited && (full || percent > WARNING_THRESHOLD_PERCENT)

  let text: string
  if (quota.unlimited) {
    text = `管理员不限空间 · 已用 ${formatStorageSize(quota.used)}`
  } else if (full) {
    text = `已用 ${formatStorageSize(quota.used)} / 上限 ${formatStorageSize(quotaBytes ?? 0)} · 空间已用满，请删除文件`
  } else {
    text = `已用 ${formatStorageSize(quota.used)} / 上限 ${formatStorageSize(quotaBytes ?? 0)}`
  }

  return (
    <div
      className={`gh-drive-quota-bar${compact ? ' gh-drive-quota-bar--compact' : ''}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        minWidth: compact ? '0' : '180px',
        maxWidth: compact ? '100%' : '280px',
      }}
    >
      <span
        className="gh-drive-quota-bar-text"
        style={{
          ...quotaTextStyle(compact),
          color: warning ? 'var(--gh-danger)' : 'var(--gh-text-secondary)',
        }}
        title={text}
        aria-live="polite"
      >
        {text}
      </span>
      {limited && (
        <div
          className="gh-drive-upload-zone-progress-bar gh-drive-quota-bar-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          aria-label="网盘空间使用率"
        >
          <div
            className="gh-drive-upload-zone-progress-fill"
            style={{
              width: `${percent}%`,
              ...(warning ? { background: 'var(--gh-danger)' } : {}),
            }}
          />
        </div>
      )}
    </div>
  )
}

/** 自身拉取数据（refreshToken 变化时刷新） */
function SelfFetchingQuotaBar({ refreshToken, compact }: { refreshToken: number; compact: boolean }) {
  const { data, loading } = useDriveQuota(refreshToken)
  return <QuotaBarView quota={data} loading={loading} compact={compact} />
}

/**
 * 网盘空间配额条
 *
 * - 展示「已用 X / 上限 Y」与进度条（>90% 转警示色）
 * - 管理员（drive:all）显示「管理员不限空间 · 已用 X」，不显示进度条
 * - 空间用满时提示「空间已用满，请删除文件」
 *
 * 两种用法：
 *   1. `<DriveQuotaBar refreshToken={n} />` —— 组件自行请求（推荐用于独立位置）
 *   2. `<DriveQuotaBar quota={data} loading={loading} />` —— 父组件统一请求后传入，避免重复请求
 */
export default function DriveQuotaBar({
  refreshToken = 0,
  quota,
  loading,
  compact = false,
}: DriveQuotaBarProps) {
  if (quota !== undefined) {
    return <QuotaBarView quota={quota} loading={loading} compact={compact} />
  }
  return <SelfFetchingQuotaBar refreshToken={refreshToken} compact={compact} />
}
