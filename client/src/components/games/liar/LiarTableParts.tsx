import type { CSSProperties, ReactNode } from 'react'
import LiarCardView from './LiarCardView'
import { liarCardKind, liarCardIsTruthy, type LiarTarget } from '../../../lib/games/liar'

/** 对手座位（单机 / 联机共用）：名称、存活、手牌数、是否轮到、UNO 式危险提示 */
export function LiarSeat({
  name,
  handCount,
  isTurn,
  isMe = false,
  isHost = false,
  online = true,
  alive = true,
  avatar,
}: {
  name: string
  handCount: number
  isTurn: boolean
  isMe?: boolean
  isHost?: boolean
  online?: boolean
  alive?: boolean
  avatar?: ReactNode
}) {
  const classes = [
    'gh-l2-seat',
    isTurn ? 'gh-l2-seat--turn' : '',
    isMe ? 'gh-l2-seat--me' : '',
    alive ? '' : 'gh-l2-seat--dead',
  ].filter(Boolean).join(' ')
  return (
    <article className={classes} aria-current={isTurn ? 'true' : undefined}>
      <div className="gh-l2-seat-avatar" aria-hidden="true">
        {avatar ?? <span className="gh-l2-seat-robot">{isMe ? '你' : 'AI'}</span>}
        {!online && alive && <span className="gh-l2-seat-offline" title="离线" />}
        {isTurn && <span className="gh-l2-seat-turn-dot" />}
      </div>
      <div className="gh-l2-seat-copy">
        <p className="gh-l2-seat-name">
          <span className="gh-l2-seat-name-text">{name}</span>
          {isMe && name !== '你' && <span className="gh-l2-badge gh-l2-badge--me">你</span>}
          {isHost && <span className="gh-l2-badge">房主</span>}
          {!alive && <span className="gh-l2-badge gh-l2-badge--dead">出局</span>}
        </p>
        <p className="gh-l2-seat-meta">
          {alive
            ? (isTurn ? (isMe ? '你的回合' : '正在决策…') : `手牌 ${handCount} 张`)
            : '已中弹出局'}
        </p>
      </div>
      <div className="gh-l2-seat-stack" aria-hidden="true">
        {Array.from({ length: Math.min(Math.max(handCount, 0), 4) }, (_, index) => (
          <span key={index} className="gh-l2-seat-back" style={{ '--i': index } as CSSProperties} />
        ))}
        {handCount > 4 && <span className="gh-l2-seat-more">+{handCount - 4}</span>}
      </div>
    </article>
  )
}

/** 顶部信息：第几局 / 目标牌面 / 左轮弹巢 */
export function LiarRoundBar({
  round,
  target,
  bullets,
  chambers = 6,
}: {
  round: number
  target: LiarTarget | null
  bullets: number
  chambers?: number
}) {
  const targetLabel = target ?? '—'
  return (
    <div className="gh-l2-roundbar">
      <span className="gh-l2-round-chip">第 {round} 局</span>

      <div className="gh-l2-target" aria-label={`本局目标牌面 ${targetLabel}`}>
        <span className="gh-l2-target-copy">
          <span className="gh-l2-target-label">本局目标</span>
          <span className="gh-l2-target-hint">出这个牌面，或出鬼牌</span>
        </span>
        <span className={`gh-l2-target-card${target ? ` gh-l2-target-card--${target.toLowerCase()}` : ''}`}>
          {targetLabel}
        </span>
      </div>

      <div className={`gh-l2-gun${bullets >= 4 ? ' gh-l2-gun--danger' : ''}`} title={`左轮 ${bullets}/${chambers} 有子弹`}>
        <span className="gh-l2-gun-copy">
          <span className="gh-l2-gun-label">左轮</span>
          <span className="gh-l2-gun-value">{bullets}/{chambers}</span>
        </span>
        <span className="gh-l2-gun-dots" aria-hidden="true">
          {Array.from({ length: chambers }, (_, index) => (
            <span key={index} className={`gh-l2-gun-dot${index < bullets ? ' gh-l2-gun-dot--loaded' : ''}`} />
          ))}
        </span>
        {bullets >= 4 && <span className="gh-l2-gun-warn">危险</span>}
      </div>
    </div>
  )
}

export interface LiarPileItem {
  key: string
  name: string
  count: number
}

/** 牌堆：只强调「上一手」——质疑只针对这一手；更早的牌按顺序弱化展示 */
export function LiarPileLane({ items }: { items: LiarPileItem[] }) {
  const recent = items.slice(-4)
  return (
    <section className="gh-l2-pile" aria-label="牌堆">
      <div className="gh-l2-pile-head">
        <span className="gh-l2-pile-title">牌堆</span>
        <span className="gh-l2-pile-note">
          {items.length === 0 ? '本局还没有人出牌' : `共 ${items.length} 手 · 质疑只翻开最后一手`}
        </span>
      </div>
      <div className="gh-l2-pile-lane">
        {recent.length === 0 && <span className="gh-l2-pile-empty">轮到你时，选 1–3 张盖牌出牌</span>}
        {recent.map((item, index) => {
          const isLast = index === recent.length - 1 && items.length > 0
          return (
            <span key={item.key} className={`gh-l2-pile-item${isLast ? ' gh-l2-pile-item--last' : ''}`}>
              <span className="gh-l2-pile-backs" aria-hidden="true">
                {Array.from({ length: Math.min(item.count, 3) }, (_, cardIndex) => (
                  <span key={cardIndex} className="gh-l2-pile-back" style={{ '--i': cardIndex } as CSSProperties} />
                ))}
              </span>
              <span className="gh-l2-pile-item-copy">
                <strong>{item.name}</strong>
                <span>{item.count} 张</span>
              </span>
              {isLast && <span className="gh-l2-pile-last-tag">上一手</span>}
            </span>
          )
        })}
      </div>
    </section>
  )
}

/** 手牌：直接标出「真 / 假 / 万能」，选中后抬起并给勾 */
export function LiarHand({
  hand,
  target,
  selected,
  canSelect,
  onToggle,
}: {
  hand: number[]
  target: LiarTarget | null
  selected: Set<number>
  canSelect: boolean
  onToggle: (card: number) => void
}) {
  return (
    <section className="gh-l2-hand" aria-label={`你的手牌，${hand.length} 张`}>
      <div className="gh-l2-hand-head">
        <span className="gh-l2-hand-title">你的手牌</span>
        <span className="gh-l2-hand-count">{hand.length} 张</span>
        {target && (
          <span className="gh-l2-hand-legend">
            真 = {target} / 鬼牌，假 = 其他牌面
          </span>
        )}
        {selected.size > 0 && <span className="gh-l2-hand-picked">已选 {selected.size}/3 张</span>}
      </div>
      <div className="gh-l2-hand-scroll">
        <div className="gh-l2-hand-cards">
          {hand.length === 0 && <span className="gh-l2-hand-empty">本局手牌已出完</span>}
          {hand.map((card) => {
            const kind = liarCardKind(card)
            const truth = !target
              ? null
              : kind === 'JOKER'
                ? 'joker' as const
                : liarCardIsTruthy(card, target)
                  ? true
                  : false
            return (
              <LiarCardView
                key={card}
                card={card}
                size="md"
                truth={truth}
                selected={selected.has(card)}
                disabled={!canSelect && !selected.has(card)}
                onClick={canSelect ? () => onToggle(card) : undefined}
              />
            )
          })}
        </div>
      </div>
    </section>
  )
}

/** 行动区：把「出牌」和「质疑」的后果写在按钮上，避免玩家猜规则 */
export function LiarActionBar({
  myTurn,
  selectedCount,
  canPlay,
  canChallenge,
  challengeLabel,
  onPlay,
  onChallenge,
  actionPending,
  hint,
}: {
  myTurn: boolean
  selectedCount: number
  canPlay: boolean
  canChallenge: boolean
  challengeLabel: string
  onPlay: () => void
  onChallenge: () => void
  actionPending: boolean
  hint: string
}) {
  return (
    <div className={`gh-l2-actions${myTurn ? ' gh-l2-actions--me' : ''}`}>
      <p className="gh-l2-actions-hint">{hint}</p>
      <div className="gh-l2-actions-buttons">
        <button
          type="button"
          className="gh-btn gh-btn--primary gh-btn--md gh-l2-play-btn"
          onClick={onPlay}
          disabled={!canPlay || actionPending}
        >
          {selectedCount > 0 ? `盖牌出牌（${selectedCount} 张）` : '盖牌出牌'}
          <span className="gh-l2-btn-sub">声称是目标牌面</span>
        </button>
        <button
          type="button"
          className="gh-btn gh-btn--danger gh-btn--md gh-l2-challenge-btn"
          onClick={onChallenge}
          disabled={!canChallenge || actionPending}
          title={canChallenge ? challengeLabel : '当前没有可质疑的上一手'}
        >
          质疑上一手
          <span className="gh-l2-btn-sub">{challengeLabel}</span>
        </button>
        {actionPending && <span className="gh-l2-action-pending">提交中…</span>}
      </div>
    </div>
  )
}

/** 最近一次开牌结果：真/假 + 具体牌面 + 谁扣扳机 */
export function LiarRevealBanner({
  cards,
  truthful,
  title,
  verdict,
}: {
  cards: number[]
  truthful: boolean
  title: string
  verdict: string
}) {
  return (
    <div className={`gh-l2-reveal${truthful ? ' gh-l2-reveal--true' : ' gh-l2-reveal--lie'}`}>
      <span className="gh-l2-reveal-stamp" aria-hidden="true">{truthful ? '真' : '假'}</span>
      <div className="gh-l2-reveal-copy">
        <span className="gh-l2-reveal-title">{title}</span>
        <span className="gh-l2-reveal-verdict">{verdict}</span>
      </div>
      <div className="gh-l2-reveal-cards">
        {cards.map((card) => <LiarCardView key={card} card={card} size="sm" />)}
      </div>
    </div>
  )
}

/** 当前回合：和 UNO 的回合条同构，一眼看出是自己还是对手 */
export function LiarTurnBanner({
  isMyTurn,
  turnName,
  hint,
  countdown,
}: {
  isMyTurn: boolean
  turnName: string
  hint: string
  countdown: number | null
}) {
  return (
    <div className={`gh-l2-turn${isMyTurn ? ' gh-l2-turn--me' : ''}`} aria-live="polite">
      <div className="gh-l2-turn-copy">
        <span className="gh-l2-turn-kicker">{isMyTurn ? '轮到你行动' : '当前回合'}</span>
        <strong className="gh-l2-turn-name">{turnName}</strong>
        <span className="gh-l2-turn-hint">{hint}</span>
      </div>
      {countdown !== null && (
        <span className={`gh-l2-countdown${countdown <= 10 ? ' gh-l2-countdown--low' : ''}`} role="timer">
          {countdown}<small>秒</small>
        </span>
      )}
    </div>
  )
}

/** 右栏：当前该做什么 / 对局记录 / 规则 */
export function LiarInfoPanel({
  turnHint,
  logLines,
  rules,
}: {
  turnHint: string
  logLines: string[]
  rules: string[]
}) {
  return (
    <aside className="gh-l2-side">
      <section className="gh-l2-side-card gh-l2-side-card--hint">
        <h2 className="gh-l2-side-title">现在该做什么</h2>
        <p className="gh-l2-side-hint">{turnHint}</p>
      </section>
      <section className="gh-l2-side-card">
        <h2 className="gh-l2-side-title">对局记录</h2>
        <ol className="gh-l2-log">
          {logLines.length === 0 && <li className="gh-l2-log-empty">第一局开始后，这里会记录每一步。</li>}
          {logLines.map((line, index) => (
            <li key={`${index}-${line}`} className="gh-l2-log-item">{line}</li>
          ))}
        </ol>
      </section>
      <details className="gh-l2-side-card gh-l2-rules">
        <summary className="gh-l2-side-title">玩法说明</summary>
        <ul className="gh-l2-rules-list">
          {rules.map((rule) => <li key={rule}>{rule}</li>)}
        </ul>
      </details>
    </aside>
  )
}
