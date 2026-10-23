import {
  DOUDIZHU_RANK_LABELS,
  DOUDIZHU_SUIT_LABELS,
  isDoudizhuRedCard,
  sortDoudizhuCards,
  type DoudizhuCard,
} from '../../../lib/games/doudizhu'

/**
 * 斗地主卡牌展示组件（单机与联机页面共用）：
 * - DoudizhuCardView  单张牌（可选中，手牌用）
 * - DoudizhuMiniCards 小牌行（桌面出牌记录 / 明示底牌）
 * 座位牌背与手牌行由 DoudizhuTable 直接渲染（.gh-ddz-back / .gh-ddz-hand）。
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

export interface DoudizhuMiniCardsProps {
  cards: DoudizhuCard[]
  ariaLabel?: string
}

/** 小牌行：桌面出牌记录、明示底牌等紧凑展示 */
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
