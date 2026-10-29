import type { UserTitleDto } from '../types/points'

interface Props {
  title: UserTitleDto | null | undefined
  /** sm 用于排行榜 / 会话行，md 用于个人主页 */
  size?: 'sm' | 'md'
  className?: string
}

/**
 * 站内称号徽章：颜色取自商品 payload（服务端已消毒），只在 LineWeb 页面内展示。
 * 聊天里通过 LineWeb 自己的接口（bootstrap / directory）附带的 title 字段渲染，
 * 不写入 neko 聊天账号，因此不会出现在 neko 原生客户端。
 */
export default function UserTitleBadge({ title, size = 'sm', className = '' }: Props) {
  if (!title) return null
  return (
    <span
      className={`gh-title-badge gh-title-badge--${size} ${className}`.trim()}
      style={{ color: title.color, borderColor: title.color }}
      title={`称号：${title.name}`}
    >
      {title.icon && <span className="gh-title-badge-icon" aria-hidden>{title.icon}</span>}
      <span className="gh-title-badge-name">{title.name}</span>
    </span>
  )
}
