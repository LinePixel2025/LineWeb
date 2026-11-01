import type { LeaderTitleDto, TitleEffectStyle, UserTitleDto } from '../types/points'
import { TITLE_EFFECTS } from '../types/points'

type BadgeTitle = Pick<UserTitleDto, 'name' | 'color' | 'icon' | 'rarity'> & {
  id?: number
  /** 传说称号（单机榜一自动授予 / 商店传说品质）会带炸裂特效 */
  rarity?: string | null
  gameName?: string | null
  /** 传说特效 key（服务端 TITLE_EFFECT_STYLES 白名单，非法/缺省回退 classic） */
  effect?: string | null
}

interface Props {
  title: BadgeTitle | LeaderTitleDto | null | undefined
  /** sm 用于排行榜 / 会话行，md 用于个人主页 */
  size?: 'sm' | 'md'
  className?: string
}

/** 传说特效落到 CSS 类后缀：classic 即默认金色流光，不加 fx 类 */
function legendaryEffectOf(title: BadgeTitle | LeaderTitleDto): TitleEffectStyle {
  const raw = 'effect' in title ? title.effect : undefined
  return (TITLE_EFFECTS as readonly string[]).includes(raw ?? '')
    ? (raw as TitleEffectStyle)
    : 'classic'
}

/**
 * 需要「爆发层」的炸裂特效：冲击环 / 吸积盘 / 闪光切面画在 .gh-title-badge-burst 的
 * 两个伪元素上，避免往徽章里塞更多节点。其余特效（含 classic）不渲染该层。
 */
const BURST_EFFECTS: ReadonlySet<TitleEffectStyle> = new Set<TitleEffectStyle>(['nova', 'prism', 'void'])

/**
 * 站内称号徽章：颜色取自商品 payload（服务端已消毒），只在 LineWeb 页面内展示。
 * 聊天里通过 LineWeb 自己的接口（bootstrap / directory）附带的 title 字段渲染，
 * 不写入 neko 聊天账号，因此不会出现在 neko 原生客户端。
 *
 * 传说品质（rarity === 'legendary'，含商店传说称号与榜一称号）统一挂
 * `gh-title-badge--legendary`：金色流光 + 旋转光晕 + 8 颗火花粒子；
 * `effect` 非 classic 时追加 `gh-title-badge--fx-<key>` 切换星尘 / 烈焰 /
 * 极光 / 雷霆 / 超新星 / 棱镜 / 虚空等动态特效（样式见 points.css）；
 * nova/prism/void 额外渲染 `.gh-title-badge-burst` 爆发层。非法或缺省回退 classic，
 * `prefers-reduced-motion` 下所有动画统一关闭，粒子与光环隐藏，静态底色保留。
 */
export default function UserTitleBadge({ title, size = 'sm', className = '' }: Props) {
  if (!title) return null
  const legendary = title.rarity === 'legendary'
  const gameName = (title as BadgeTitle).gameName
  const label = gameName ? `${title.name}（${gameName}单机榜一）` : title.name
  const effect = legendary ? legendaryEffectOf(title) : null
  const burst = legendary && effect !== null && BURST_EFFECTS.has(effect)
  const classes = [
    'gh-title-badge',
    `gh-title-badge--${size}`,
    legendary ? 'gh-title-badge--legendary' : '',
    legendary && effect !== 'classic' ? `gh-title-badge--fx-${effect}` : '',
    className,
  ].filter(Boolean).join(' ')
  return (
    <span
      className={classes}
      style={{ color: title.color, borderColor: title.color }}
      title={`称号：${label}`}
      data-rarity={legendary ? 'legendary' : undefined}
    >
      {legendary && <span className="gh-title-badge-aura" aria-hidden />}
      {legendary && burst && <span className="gh-title-badge-burst" aria-hidden />}
      {title.icon && <span className="gh-title-badge-icon" aria-hidden>{title.icon}</span>}
      <span className="gh-title-badge-name">{title.name}</span>
      {legendary && (
        <span className="gh-title-badge-sparks" aria-hidden>
          <i /><i /><i /><i /><i /><i /><i /><i />
        </span>
      )}
    </span>
  )
}
