import { liarCardKind } from '../../../lib/games/liar'

export interface LiarCardViewProps {
  card: number
  /** sm = 牌堆 / 开牌展示，md = 手牌 */
  size?: 'sm' | 'md'
  selected?: boolean
  disabled?: boolean
  /** 可点击时传入；否则渲染为静态卡片 */
  onClick?: () => void
  /** 不显示真实牌面（盖牌） */
  faceDown?: boolean
  title?: string
}

const KIND_LABEL: Record<string, string> = {
  K: 'K',
  Q: 'Q',
  A: 'A',
  JOKER: '鬼',
}

/**
 * 骗子酒馆的牌面：K / Q / A / 鬼牌。盖牌时显示统一背面。
 * 只做展示与点击，不参与规则判定（规则在 lib/games/liar.ts）。
 */
export default function LiarCardView({
  card,
  size = 'md',
  selected = false,
  disabled = false,
  onClick,
  faceDown = false,
  title,
}: LiarCardViewProps) {
  const kind = faceDown ? null : liarCardKind(card)
  const className = [
    'gh-liar-card',
    `gh-liar-card--${size}`,
    faceDown ? 'gh-liar-card--back' : `gh-liar-card--${(kind ?? 'back').toLowerCase()}`,
    selected ? 'gh-liar-card--selected' : '',
    onClick && !disabled ? 'gh-liar-card--clickable' : '',
    disabled ? 'gh-liar-card--disabled' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const label = faceDown ? '背面' : `${KIND_LABEL[kind ?? 'K']}${kind === 'JOKER' ? '（万能）' : ''}`

  if (onClick) {
    return (
      <button
        type="button"
        className={className}
        onClick={onClick}
        disabled={disabled}
        aria-pressed={selected}
        aria-label={title ?? `牌 ${label}${selected ? '，已选中' : ''}`}
      >
        <span className="gh-liar-card-corner gh-liar-card-corner--tl">{faceDown ? '' : KIND_LABEL[kind ?? 'K']}</span>
        <span className="gh-liar-card-main">{faceDown ? '' : KIND_LABEL[kind ?? 'K']}</span>
        <span className="gh-liar-card-corner gh-liar-card-corner--br">{faceDown ? '' : KIND_LABEL[kind ?? 'K']}</span>
      </button>
    )
  }

  return (
    <span className={className} title={title ?? label} aria-label={title ?? label}>
      <span className="gh-liar-card-corner gh-liar-card-corner--tl">{faceDown ? '' : KIND_LABEL[kind ?? 'K']}</span>
      <span className="gh-liar-card-main">{faceDown ? '' : KIND_LABEL[kind ?? 'K']}</span>
      <span className="gh-liar-card-corner gh-liar-card-corner--br">{faceDown ? '' : KIND_LABEL[kind ?? 'K']}</span>
    </span>
  )
}
