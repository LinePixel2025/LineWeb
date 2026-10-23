import {
  DOUDIZHU_RANK_LABELS,
  DOUDIZHU_SUIT_LABELS,
  isDoudizhuRedCard,
  sortDoudizhuCards,
  type DoudizhuCard,
} from '../../../lib/games/doudizhu'

/**
 * 斗地主卡牌展示组件（纯展示，单机与联机页面共用）：
 * - DoudizhuCardView  单张牌（可选中）
 * - DoudizhuHandView  自己的手牌行（点击选牌）
 * - DoudizhuCardBacks 对手手牌（背面 + 剩余张数）
 * - DoudizhuMiniCards 小牌行（出牌记录 / 底牌展示）
 */

export interface DoudizhuCardViewProps {
  card: DoudizhuCard
  selected?: boolean
  selectable?: boolean
  size?: 'md' | 'sm'
  onClick?: (card: DoudizhuCard) => void
}

function isJoker(card: DoudizhuCard): boolean {
  return card.suit === 4
}

export function DoudizhuCardView({ card, selected = false, selectable = false, size = 'md', onClick }: DoudizhuCardViewProps) {
  const clickable = selectable && onClick !== undefined
  const className = [
    'gh-ddz-card',
    `gh-ddz-card--${size}`,
    isDoudizhuRedCard(card) ? 'gh-ddz-card--red' : 'gh-ddz-card--black',
    selected ? 'gh-ddz-card--selected' : '',
    clickable ? 'gh-ddz-card--clickable' : '',
  ].filter(Boolean).join(' ')

  return (
    <button
      type="button"
      className={className}
      aria-pressed={clickable ? selected : undefined}
      aria-label={`${isJoker(card) ? (card.rank === 19 ? '大王' : '小王') : DOUDIZHU_SUIT_LABELS[card.suit] + DOUDIZHU_RANK_LABELS[card.rank]}${selected ? '（已选中）' : ''}`}
      disabled={!clickable}
      onClick={clickable ? () => onClick(card) : undefined}
    >
      {isJoker(card) ? (
        <>
          <span className="gh-ddz-card-joker-mark">{card.rank === 19 ? '大' : '小'}</span>
          <span className="gh-ddz-card-rank">王</span>
        </>
      ) : (
        <>
          <span className="gh-ddz-card-rank">{DOUDIZHU_RANK_LABELS[card.rank]}</span>
          <span className="gh-ddz-card-suit">{DOUDIZHU_SUIT_LABELS[card.suit]}</span>
        </>
      )}
    </button>
  )
}

export interface DoudizhuHandViewProps {
  cards: DoudizhuCard[]
  selectedIds: ReadonlySet<number>
  onToggle?: (card: DoudizhuCard) => void
  disabled?: boolean
}

/** 自己的手牌：升序排列，点击选 / 取消选 */
export function DoudizhuHandView({ cards, selectedIds, onToggle, disabled = false }: DoudizhuHandViewProps) {
  const sorted = sortDoudizhuCards(cards)
  return (
    <div className="gh-ddz-hand" role="group" aria-label="我的手牌">
      {sorted.map((card) => (
        <DoudizhuCardView
          key={card.id}
          card={card}
          selected={selectedIds.has(card.id)}
          selectable={!disabled}
          onClick={onToggle}
        />
      ))}
    </div>
  )
}

export interface DoudizhuCardBacksProps {
  count: number
  label?: string
}

/** 对手手牌：重叠背面 + 剩余张数 */
export function DoudizhuCardBacks({ count, label }: DoudizhuCardBacksProps) {
  if (count <= 0) {
    return <span className="gh-ddz-backs gh-ddz-backs--empty">{label ? `${label} 已出完` : '已出完'}</span>
  }
  const shown = Math.min(count, 10)
  return (
    <span className="gh-ddz-backs" aria-label={`剩余 ${count} 张`}>
      <span className="gh-ddz-backs-row">
        {Array.from({ length: shown }, (_, index) => (
          <span key={index} className="gh-ddz-back" />
        ))}
      </span>
      <span className="gh-ddz-backs-count">{count}</span>
    </span>
  )
}

export interface DoudizhuMiniCardsProps {
  cards: DoudizhuCard[]
  ariaLabel?: string
}

/** 小牌行：出牌记录、底牌等紧凑展示 */
export function DoudizhuMiniCards({ cards, ariaLabel }: DoudizhuMiniCardsProps) {
  const sorted = sortDoudizhuCards(cards)
  return (
    <span className="gh-ddz-mini-cards" role="img" aria-label={ariaLabel}>
      {sorted.map((card) => (
        <span
          key={card.id}
          className={`gh-ddz-mini-card${isDoudizhuRedCard(card) ? ' gh-ddz-mini-card--red' : ''}`}
        >
          {card.suit === 4
            ? card.rank === 19
              ? '大王'
              : '小王'
            : DOUDIZHU_SUIT_LABELS[card.suit] + DOUDIZHU_RANK_LABELS[card.rank]}
        </span>
      ))}
    </span>
  )
}
