import { unoCardLabel } from '../../../lib/games/uno'
import type { UnoCardDto } from '../../../types/game'

export type UnoCardSize = 'sm' | 'md' | 'lg'

export interface UnoCardViewProps {
  card: UnoCardDto
  size?: UnoCardSize
  selected?: boolean
  playable?: boolean
  disabled?: boolean
  onClick?: () => void
  /** 只显示卡背（对手手牌堆叠） */
  faceDown?: boolean
}

const TONE_CLASS: Record<string, string> = {
  red: 'gh-uno-card--red',
  yellow: 'gh-uno-card--yellow',
  green: 'gh-uno-card--green',
  blue: 'gh-uno-card--blue',
  wild: 'gh-uno-card--wild',
}

/**
 * UNO 牌面（程序化绘制，无图片素材）：
 * 红 / 黄 / 绿 / 蓝四色 + 万能牌四色渐变；数字与功能牌使用引擎文案。
 */
export default function UnoCardView({
  card,
  size = 'md',
  selected = false,
  playable = false,
  disabled = false,
  onClick,
  faceDown = false,
}: UnoCardViewProps) {
  const label = faceDown ? '' : unoCardLabel(card)
  // 牌面主字：万能+4 用 +4 显示，避免四字撑出 64px 手牌
  const displayLabel = card.kind === 'wild4' ? '+4' : label
  const compact = displayLabel.length > 2
  const tone = faceDown ? 'back' : TONE_CLASS[card.color] ?? 'gh-uno-card--wild'
  const className = [
    'gh-uno-card',
    `gh-uno-card--${size}`,
    `gh-uno-card--tone-${card.color}`,
    tone,
    faceDown ? 'gh-uno-card--back' : '',
    selected ? 'gh-uno-card--selected' : '',
    playable ? 'gh-uno-card--playable' : '',
    disabled ? 'gh-uno-card--disabled' : '',
    onClick && !disabled ? 'gh-uno-card--clickable' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const content = faceDown ? null : (
    <>
      <span className="gh-uno-card-corner gh-uno-card-corner--tl">{displayLabel}</span>
      <span className="gh-uno-card-oval" aria-hidden="true" />
      <span className={`gh-uno-card-main${compact ? ' gh-uno-card-main--compact' : ''}`}>{displayLabel}</span>
      <span className="gh-uno-card-corner gh-uno-card-corner--br">{displayLabel}</span>
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
        aria-label={faceDown ? '对手手牌' : `UNO 牌 ${label}`}
      >
        {content}
      </button>
    )
  }

  return (
    <span className={className} aria-label={faceDown ? '对手手牌' : `UNO 牌 ${label}`}>
      {content}
    </span>
  )
}
