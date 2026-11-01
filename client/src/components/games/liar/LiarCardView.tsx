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
  /**
   * 当前目标牌面下的真假：true=目标牌，false=非目标牌，joker=鬼牌（万能）。
   * 只在玩家自己的手牌上显示——这是玩家已经掌握的信息，标出来能大幅降低理解成本。
   */
  truth?: boolean | 'joker' | null
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
  truth = null,
}: LiarCardViewProps) {
  const kind = faceDown ? null : liarCardKind(card)
  const className = [
    'gh-liar-card',
    `gh-liar-card--${size}`,
    faceDown ? 'gh-liar-card--back' : `gh-liar-card--${(kind ?? 'back').toLowerCase()}`,
    selected ? 'gh-liar-card--selected' : '',
    onClick && !disabled ? 'gh-liar-card--clickable' : '',
    disabled ? 'gh-liar-card--disabled' : '',
    truth === true ? 'gh-liar-card--truth' : '',
    truth === false ? 'gh-liar-card--lie' : '',
    truth === 'joker' ? 'gh-liar-card--joker' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const label = faceDown ? '背面' : `${KIND_LABEL[kind ?? 'K']}${kind === 'JOKER' ? '（万能）' : ''}`
  const truthMark = truth === 'joker' ? '万能' : truth === true ? '真' : truth === false ? '假' : ''
  const truthClass = truth === 'joker' ? 'wild' : truth === true ? 'true' : 'false'
  const accessibleLabel = title
    ?? `牌 ${label}${truthMark ? `，当前目标下是${truthMark}牌` : ''}${selected ? '，已选中' : ''}`

  const face = (
    <>
      <span className="gh-liar-card-corner gh-liar-card-corner--tl">{faceDown ? '' : KIND_LABEL[kind ?? 'K']}</span>
      <span className="gh-liar-card-main">{faceDown ? '' : KIND_LABEL[kind ?? 'K']}</span>
      <span className="gh-liar-card-corner gh-liar-card-corner--br">{faceDown ? '' : KIND_LABEL[kind ?? 'K']}</span>
      {!faceDown && truthMark && (
        <span className={`gh-liar-card-truth gh-liar-card-truth--${truthClass}`}>{truthMark}</span>
      )}
      {!faceDown && selected && <span className="gh-liar-card-check" aria-hidden="true">✓</span>}
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        className={className}
        onClick={onClick}
        disabled={disabled}
        aria-pressed={selected}
        aria-label={accessibleLabel}
      >
        {face}
      </button>
    )
  }

  return (
    <span className={className} title={title ?? accessibleLabel} aria-label={accessibleLabel}>
      {face}
    </span>
  )
}
