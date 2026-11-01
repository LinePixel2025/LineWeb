import type { CSSProperties, ReactNode } from 'react'
import UnoCardView from './UnoCardView'
import {
  UNO_COLOR_LABELS,
  unoCardLabel,
  type UnoColor,
} from '../../../lib/games/uno'
import type { UnoCardDto } from '../../../types/game'

/** 四色语义顺序：用于颜色图例、万能牌颜色选择 */
export const UNO_ORDERED_COLORS: UnoColor[] = ['red', 'yellow', 'green', 'blue']

const COLOR_ICON: Record<UnoColor, string> = {
  red: '●',
  yellow: '●',
  green: '●',
  blue: '●',
}

/**
 * 对手座位：一张卡片里同时给出「谁 / 剩几张 / 是不是他的回合 / 是否出局」。
 * 单机与联机共用，头像由调用方传入（AI 用座位标记，联机用 UserAvatar）。
 */
export function UnoSeat({
  name,
  handCount,
  isTurn,
  isMe = false,
  isHost = false,
  online = true,
  status = 'playing',
  avatar,
  compact = false,
}: {
  name: string
  handCount: number
  isTurn: boolean
  isMe?: boolean
  isHost?: boolean
  online?: boolean
  status?: 'playing' | 'won' | 'lost'
  avatar?: ReactNode
  compact?: boolean
}) {
  const out = status === 'lost'
  const classes = [
    'gh-u2-seat',
    isTurn ? 'gh-u2-seat--turn' : '',
    isMe ? 'gh-u2-seat--me' : '',
    out ? 'gh-u2-seat--out' : '',
    compact ? 'gh-u2-seat--compact' : '',
  ].filter(Boolean).join(' ')
  const faceCount = Math.min(Math.max(handCount, 0), compact ? 3 : 4)

  return (
    <article className={classes} aria-current={isTurn ? 'true' : undefined}>
      <div className="gh-u2-seat-avatar" aria-hidden="true">
        {avatar ?? <span className="gh-u2-seat-robot">{isMe ? '你' : 'AI'}</span>}
        {!online && <span className="gh-u2-seat-offline" title="离线" />}
        {isTurn && <span className="gh-u2-seat-turn-dot" />}
      </div>
      <div className="gh-u2-seat-copy">
        <p className="gh-u2-seat-name">
          <span className="gh-u2-seat-name-text">{name}</span>
          {isMe && <span className="gh-u2-badge gh-u2-badge--me">你</span>}
          {isHost && <span className="gh-u2-badge">房主</span>}
          {status === 'won' && <span className="gh-u2-badge gh-u2-badge--win">获胜</span>}
          {out && <span className="gh-u2-badge gh-u2-badge--out">出局</span>}
          {!out && status === 'playing' && handCount === 1 && <span className="gh-u2-badge gh-u2-badge--uno">UNO!</span>}
        </p>
        <p className="gh-u2-seat-meta">
          {isTurn
            ? (isMe ? '你的回合' : '出牌中…')
            : `${handCount} 张手牌`}
        </p>
      </div>
      <div className="gh-u2-seat-stack" aria-hidden="true">
        {Array.from({ length: faceCount }, (_, index) => (
          <span key={index} className="gh-u2-seat-back" style={{ '--i': index } as CSSProperties} />
        ))}
        {handCount > faceCount && <span className="gh-u2-seat-more">+{handCount - faceCount}</span>}
      </div>
    </article>
  )
}

/** 大号回合条：一眼看清轮到自己还是对手、还剩几秒、桌面上是什么颜色 */
export function UnoTurnStrip({
  turnLabel,
  subLabel,
  countdown,
  currentColor,
  direction,
  deckCount,
  isMyTurn,
  transport,
}: {
  turnLabel: string
  subLabel?: string
  countdown: number | null
  currentColor: UnoColor | null
  direction: 1 | -1
  deckCount: number
  isMyTurn: boolean
  transport?: 'ws' | 'polling'
}) {
  return (
    <div className={`gh-u2-turn-strip${isMyTurn ? ' gh-u2-turn-strip--me' : ''}`} aria-live="polite">
      <div className="gh-u2-turn-main">
        <span className="gh-u2-turn-kicker">{isMyTurn ? '轮到你出牌' : '当前回合'}</span>
        <strong className="gh-u2-turn-name">{turnLabel}</strong>
        {subLabel && <span className="gh-u2-turn-sub">{subLabel}</span>}
      </div>
      <div className="gh-u2-turn-facts">
        {countdown !== null && (
          <span className={`gh-u2-countdown${countdown <= 10 ? ' gh-u2-countdown--low' : ''}`} role="timer">
            <span className="gh-u2-countdown-value">{countdown}</span>
            <span className="gh-u2-countdown-unit">秒</span>
          </span>
        )}
        <span className={`gh-u2-color-pill gh-u2-color-pill--${currentColor ?? 'none'}`}>
          <span className={`gh-u2-color-dot gh-u2-color-dot--${currentColor ?? 'none'}`} />
          {currentColor ? UNO_COLOR_LABELS[currentColor] : '待定'}
        </span>
        <span className="gh-u2-direction" title={direction === 1 ? '顺时针出牌' : '逆时针出牌'}>
          <span aria-hidden="true">{direction === 1 ? '↻' : '↺'}</span>
          {direction === 1 ? '顺时针' : '逆时针'}
        </span>
        <span className="gh-u2-deck-fact" title="牌堆剩余张数">
          牌堆 <strong>{deckCount}</strong>
        </span>
        {transport && (
          <span className={`gh-u2-transport gh-u2-transport--${transport}`}>
            {transport === 'ws' ? '实时' : '轮询'}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * 桌面中心：牌堆 + 弃牌堆 + 当前颜色大标识。
 * 「摸一张」是桌面上的主操作，不再藏在角落。
 */
export function UnoCardsCenter({
  topCard,
  deckCount,
  discardCount,
  currentColor,
  canDraw,
  drawDisabledReason,
  onDraw,
  hint,
  pulseDraw,
}: {
  topCard: UnoCardDto | null
  deckCount: number
  discardCount: number
  currentColor: UnoColor | null
  canDraw: boolean
  drawDisabledReason?: string
  onDraw: () => void
  hint: string
  pulseDraw: boolean
}) {
  return (
    <div className="gh-u2-center">
      <div className="gh-u2-pile gh-u2-pile--deck">
        <span className="gh-u2-pile-label">牌堆</span>
        <button
          type="button"
          className={`gh-u2-deck${pulseDraw ? ' gh-u2-deck--pulse' : ''}`}
          onClick={onDraw}
          disabled={!canDraw}
          title={canDraw ? '摸一张牌' : drawDisabledReason}
          aria-label={`摸一张牌，牌堆剩余 ${deckCount} 张`}
        >
          <span className="gh-u2-deck-cards" aria-hidden="true">
            <span /><span /><span />
          </span>
          <span className="gh-u2-deck-count">{deckCount}</span>
          <span className="gh-u2-deck-action">摸牌</span>
        </button>
        <span className="gh-u2-pile-caption">{canDraw ? '点击摸一张' : drawDisabledReason ?? '等待回合'}</span>
      </div>

      <div className={`gh-u2-pile gh-u2-pile--discard gh-u2-pile--${currentColor ?? 'none'}`}>
        <span className="gh-u2-pile-label">弃牌堆 · 当前颜色</span>
        <div className="gh-u2-discard">
          <span className="gh-u2-discard-shadow" aria-hidden="true" />
          {topCard ? <UnoCardView card={topCard} size="lg" /> : <span className="gh-u2-discard-empty">—</span>}
        </div>
        <span className="gh-u2-pile-caption">
          {currentColor ? (
            <span className={`gh-u2-color-inline gh-u2-color-inline--${currentColor}`}>
              <span className={`gh-u2-color-dot gh-u2-color-dot--${currentColor}`} />
              {UNO_COLOR_LABELS[currentColor]}
            </span>
          ) : '—'}
          <span className="gh-u2-discard-count">共 {discardCount} 张</span>
        </span>
      </div>

      <p className="gh-u2-center-hint">{hint}</p>
    </div>
  )
}

/**
 * 手牌区：可出的牌抬起、非可出的牌压暗；摸牌后只亮刚摸到的那张。
 * 手牌用横向滚动而不是换行，手机上也不会把牌桌撑到第二屏。
 */
export function UnoHand({
  cards,
  playableIds,
  myTurn,
  actionPending,
  drawnCardId,
  onCardClick,
}: {
  cards: UnoCardDto[]
  playableIds: Set<number>
  myTurn: boolean
  actionPending: boolean
  drawnCardId: number | null
  onCardClick: (card: UnoCardDto) => void
}) {
  const playableCount = myTurn ? cards.filter((card) => playableIds.has(card.id)).length : 0
  return (
    <section className="gh-u2-hand" aria-label={`你的手牌，${cards.length} 张`}>
      <div className="gh-u2-hand-head">
        <span className="gh-u2-hand-title">你的手牌</span>
        <span className="gh-u2-hand-count">{cards.length} 张</span>
        {cards.length === 1 && <span className="gh-u2-badge gh-u2-badge--uno">UNO!</span>}
        {myTurn && (
          <span className={`gh-u2-hand-tip${playableCount === 0 ? ' gh-u2-hand-tip--empty' : ''}`}>
            {playableCount === 0 ? '没有可出的牌，点左边牌堆摸一张' : `可出 ${playableCount} 张（已抬起高亮）`}
          </span>
        )}
        {drawnCardId !== null && <span className="gh-u2-hand-tip gh-u2-hand-tip--drawn">刚摸到的牌已亮起</span>}
        {cards.length > 5 && <span className="gh-u2-hand-scroll-hint">左右滑动看全部</span>}
      </div>
      <div className="gh-u2-hand-scroll">
        <div className="gh-u2-hand-fan">
          {cards.map((card) => {
            const playable = myTurn && playableIds.has(card.id)
            return (
              <UnoCardView
                key={card.id}
                card={card}
                size="md"
                playable={playable}
                disabled={!myTurn || actionPending}
                onClick={() => onCardClick(card)}
              />
            )
          })}
          {cards.length === 0 && <span className="gh-u2-hand-empty">手牌已出完</span>}
        </div>
      </div>
    </section>
  )
}

/** 万能牌颜色选择：桌面中央浮层，四个大色块，手机上为底部抽屉 */
export function UnoColorChooser({
  open,
  card,
  onPick,
  onCancel,
}: {
  open: boolean
  card: UnoCardDto | null
  onPick: (color: UnoColor) => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <div className="gh-u2-modal" role="dialog" aria-modal="true" aria-label="选择万能牌颜色">
      <div className="gh-u2-color-sheet">
        <p className="gh-u2-color-kicker">万能牌</p>
        <h3 className="gh-u2-color-title">选择新的颜色</h3>
        {card && <p className="gh-u2-color-sub">{unoCardLabel(card)} · 出牌后由你指定桌面颜色</p>}
        <div className="gh-u2-color-grid">
          {UNO_ORDERED_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`gh-u2-color-choice gh-u2-color-choice--${color}`}
              onClick={() => onPick(color)}
            >
              <span className="gh-u2-color-choice-icon" aria-hidden="true">{COLOR_ICON[color]}</span>
              <span>{UNO_COLOR_LABELS[color]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="gh-u2-color-cancel" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  )
}

/** 右栏：操作提示 / 规则 / 对局记录，统一成可折叠信息卡 */
export function UnoInfoPanel({
  turnHint,
  lastActionText,
  recentLog,
  rules,
}: {
  turnHint: string
  lastActionText: string
  recentLog: string[]
  rules: string[]
}) {
  return (
    <aside className="gh-u2-side">
      <section className="gh-u2-side-card gh-u2-side-card--hint">
        <h2 className="gh-u2-side-title">现在该做什么</h2>
        <p className="gh-u2-side-hint">{turnHint}</p>
        <p className="gh-u2-side-last">{lastActionText}</p>
      </section>
      <section className="gh-u2-side-card">
        <h2 className="gh-u2-side-title">对局记录</h2>
        <ol className="gh-u2-log">
          {recentLog.length === 0 && <li className="gh-u2-log-empty">打出第一张牌后，这里会显示每一步。</li>}
          {recentLog.map((line, index) => (
            <li key={`${index}-${line}`} className="gh-u2-log-item">{line}</li>
          ))}
        </ol>
      </section>
      <details className="gh-u2-side-card gh-u2-rules">
        <summary className="gh-u2-side-title">玩法说明</summary>
        <ul className="gh-u2-rules-list">
          {rules.map((rule) => <li key={rule}>{rule}</li>)}
        </ul>
      </details>
    </aside>
  )
}
