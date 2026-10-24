import type { CSSProperties } from 'react'
import {
  DOUDIZHU_RANK_LABELS,
  DOUDIZHU_SUIT_LABELS,
  doudizhuCardLabel,
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
  /** 发牌动画的逐张延迟序号 */
  dealIndex?: number
  onClick?: (card: DoudizhuCard) => void
}

function isJoker(card: DoudizhuCard): boolean {
  return card.suit === 4
}

function cornerContent(card: DoudizhuCard): { rank: string; suit: string } {
  if (isJoker(card)) return { rank: card.rank === 19 ? '大' : '小', suit: '王' }
  return { rank: DOUDIZHU_RANK_LABELS[card.rank], suit: DOUDIZHU_SUIT_LABELS[card.suit] }
}

export function DoudizhuCardView({
  card,
  selected = false,
  selectable = false,
  size = 'md',
  dealIndex,
  onClick,
}: DoudizhuCardViewProps) {
  const clickable = selectable && onClick !== undefined
  const joker = isJoker(card)
  const { rank, suit } = cornerContent(card)
  const className = [
    'gh-ddz-card',
    `gh-ddz-card--${size}`,
    isDoudizhuRedCard(card) ? 'gh-ddz-card--red' : 'gh-ddz-card--black',
    joker ? 'gh-ddz-card--joker' : '',
    selected ? 'gh-ddz-card--selected' : '',
    clickable ? 'gh-ddz-card--clickable' : '',
  ].filter(Boolean).join(' ')

  const style = dealIndex === undefined
    ? undefined
    : ({ '--i': dealIndex } as CSSProperties)

  return (
    <button
      type="button"
      className={className}
      style={style}
      aria-pressed={clickable ? selected : undefined}
      aria-label={`${doudizhuCardLabel(card)}${selected ? '（已选中）' : ''}`}
      disabled={!clickable}
      onClick={clickable ? () => onClick(card) : undefined}
    >
      <span className="gh-ddz-card-corner gh-ddz-card-corner--tl" aria-hidden="true">
        <span className="gh-ddz-card-rank">{rank}</span>
        <span className="gh-ddz-card-suit">{suit}</span>
      </span>
      <span
        className={`gh-ddz-card-pip${joker ? ' gh-ddz-card-pip--joker' : ''}`}
        aria-hidden="true"
      >
        {joker ? '✦' : suit}
      </span>
      <span className="gh-ddz-card-corner gh-ddz-card-corner--br" aria-hidden="true">
        <span className="gh-ddz-card-rank">{rank}</span>
        <span className="gh-ddz-card-suit">{suit}</span>
      </span>
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
  const label = ariaLabel
    ? `${ariaLabel}：${sorted.map(doudizhuCardLabel).join(' ')}`
    : sorted.map(doudizhuCardLabel).join(' ')

  return (
    <span className="gh-ddz-mini-cards" role="img" aria-label={label}>
      {sorted.map((card) => {
        const joker = isJoker(card)
        const { rank, suit } = cornerContent(card)
        return (
          <span
            key={card.id}
            className={[
              'gh-ddz-mini-card',
              isDoudizhuRedCard(card) ? 'gh-ddz-mini-card--red' : '',
              joker ? 'gh-ddz-mini-card--joker' : '',
            ].filter(Boolean).join(' ')}
          >
            <span className="gh-ddz-mini-card-corner" aria-hidden="true">
              <span className="gh-ddz-mini-card-rank">{rank}</span>
              <span className="gh-ddz-mini-card-suit">{suit}</span>
            </span>
            <span className="gh-ddz-mini-card-pip" aria-hidden="true">
              {joker ? '✦' : suit}
            </span>
          </span>
        )
      })}
    </span>
  )
}
