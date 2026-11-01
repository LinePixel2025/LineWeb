import { memo } from 'react'
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
  /**
   * full（默认）：完整特效——光环、旋转光晕、8 颗粒子、扫光。
   * compact：聊天列表/成员列表等「同屏可能出现几十个」的位置用——保留配色与
   *          传说渐变底，但只渲染图标 + 文字，不挂任何动画层（详情见 points.css）。
   */
  variant?: 'full' | 'compact'
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
 * `prefers-reduced-motion` / 低性能模式下动画降级，粒子与光环隐藏，静态底色保留。
 *
 * 聊天界面用 variant="compact"：同屏可能有几十个徽章，每个传说徽章原本要跑
 * 7~13 个合成层动画（旋转光晕 + 扫光 + 8 颗粒子），老设备直接掉帧。compact
 * 用同一套静态渐变配色，但只保留图标与文字，零动画、零附加节点。
 * 组件本身 memo（按称号字段比较）：聊天轮询重建 sender 对象时不重复渲染。
 */
function UserTitleBadge({ title, size = 'sm', className = '', variant = 'full' }: Props) {
  if (!title) return null
  const compact = variant === 'compact'
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
    compact ? 'gh-title-badge--compact' : '',
    className,
  ].filter(Boolean).join(' ')
  return (
    <span
      className={classes}
      style={{ color: title.color, borderColor: title.color }}
      title={`称号：${label}`}
      data-rarity={legendary ? 'legendary' : undefined}
      data-variant={compact ? 'compact' : undefined}
    >
      {legendary && !compact && <span className="gh-title-badge-aura" aria-hidden />}
      {legendary && !compact && burst && <span className="gh-title-badge-burst" aria-hidden />}
      {title.icon && <span className="gh-title-badge-icon" aria-hidden>{title.icon}</span>}
      <span className="gh-title-badge-name">{title.name}</span>
      {legendary && !compact && (
        <span className="gh-title-badge-sparks" aria-hidden>
          <i /><i /><i /><i /><i /><i /><i /><i />
        </span>
      )}
    </span>
  )
}

/** 只按「看起来会变」的字段比较：父组件重建同值称号对象时不触发重渲染 */
export default memo(UserTitleBadge, (prev, next) => {
  if (prev.size !== next.size || prev.className !== next.className || prev.variant !== next.variant) {
    return false
  }
  const a = prev.title
  const b = next.title
  if (a === b) return true
  if (!a || !b) return false
  return a.name === b.name
    && a.color === b.color
    && a.icon === b.icon
    && a.rarity === b.rarity
    && ('effect' in a ? a.effect : undefined) === ('effect' in b ? b.effect : undefined)
    && (a as BadgeTitle).gameName === (b as BadgeTitle).gameName
})
