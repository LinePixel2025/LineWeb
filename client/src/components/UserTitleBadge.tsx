import type { LeaderTitleDto, UserTitleDto } from '../types/points'

type BadgeTitle = Pick<UserTitleDto, 'name' | 'color' | 'icon'> & {
  id?: number
  /** 传说称号（单机榜一自动授予）会带流光特效 */
  rarity?: string | null
  gameName?: string | null
}

interface Props {
  title: BadgeTitle | LeaderTitleDto | null | undefined
  /** sm 用于排行榜 / 会话行，md 用于个人主页 */
  size?: 'sm' | 'md'
  className?: string
}

/**
 * 站内称号徽章：颜色取自商品 payload（服务端已消毒），只在 LineWeb 页面内展示。
 * 聊天里通过 LineWeb 自己的接口（bootstrap / directory）附带的 title 字段渲染，
 * 不写入 neko 聊天账号，因此不会出现在 neko 原生客户端。
 *
 * 传说称号（rarity === 'legendary'）额外挂 `gh-title-badge--legendary`，
 * 由 CSS 提供金色渐变 + 流光动画（`prefers-reduced-motion` 下自动关闭）。
 */
export default function UserTitleBadge({ title, size = 'sm', className = '' }: Props) {
  if (!title) return null
  const legendary = (title as BadgeTitle).rarity === 'legendary'
  const gameName = (title as BadgeTitle).gameName
  const label = gameName ? `${title.name}（${gameName}单机榜一）` : title.name
  return (
    <span
      className={`gh-title-badge gh-title-badge--${size} ${legendary ? 'gh-title-badge--legendary' : ''} ${className}`.trim()}
      style={{ color: title.color, borderColor: title.color }}
      title={`称号：${label}`}
      data-rarity={legendary ? 'legendary' : undefined}
    >
      {title.icon && <span className="gh-title-badge-icon" aria-hidden>{title.icon}</span>}
      <span className="gh-title-badge-name">{title.name}</span>
    </span>
  )
}
