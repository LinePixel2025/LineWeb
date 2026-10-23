import {
  type ReactNode,
} from 'react'
import type { DoudizhuCard } from '../../../lib/games/doudizhu'
import { DoudizhuCardView, DoudizhuMiniCards } from './DoudizhuCards'

/**
 * 斗地主经典牌桌（单机 / 联机共用，纯展示）：
 *
 *   ┌────────────────────────────────────────┐
 *   │  [上家 头像/身份/牌背]  [底牌 倍率]  [下家 …] │
 *   │        (上家出牌)    中央提示    (下家出牌)   │
 *   │              [提示][不出][出牌]            │
 *   │            (我最近一手 / 不要)             │
 *   │           我的手牌（扇形重叠可选中）          │
 *   └────────────────────────────────────────┘
 *
 * 数据逻辑由两个页面各自维护，本组件只接收视图数据与回调。
 */

/** 对手座位信息 */
export interface DoudizhuSeatInfo {
  name: string
  role: 'landlord' | 'farmer' | null
  cardCount: number
  /** 联机在线状态；单机为 undefined（不显示圆点） */
  online?: boolean
  isTurn: boolean
  /** 叫分阶段当前已叫分数（null = 尚未应叫） */
  bid: number | null
  /** 桌面最近一手：'pass' | 出的牌 | null */
  lastAction: 'pass' | { cards: DoudizhuCard[] } | null
}

export interface DoudizhuTableProps {
  /** 叫分阶段 / 出牌阶段 / 已结束（决定底牌是否翻开） */
  phase: 'bidding' | 'playing' | 'finished'
  /** 上家（左侧座位） */
  leftSeat: DoudizhuSeatInfo
  /** 下家（右侧座位） */
  rightSeat: DoudizhuSeatInfo
  /** 我 */
  me: {
    name: string
    role: 'landlord' | 'farmer' | null
    bid: number | null
    isTurn: boolean
    hand: DoudizhuCard[]
    /** 我在桌面最近一手（气泡显示在手牌上方） */
    lastAction: 'pass' | { cards: DoudizhuCard[] } | null
  }
  /** 底牌（bidding 阶段显示背面） */
  bottomCards: DoudizhuCard[]
  multiplier: number
  /** 中央提示文案（轮到谁 / 压住什么 / 阶段说明） */
  centerHint: ReactNode
  /** 当前回合剩余秒数（null 不显示） */
  remainingSeconds?: number | null
  /** 手牌选择 */
  selectedIds: ReadonlySet<number>
  onToggleCard?: (card: DoudizhuCard) => void
  handDisabled: boolean
  /** 操作按钮组（叫分按钮 / 出牌·不出·提示），由页面注入 */
  actions: ReactNode
  /** 结果弹层（全屏覆盖） */
  overlay?: ReactNode
}

function bidLabel(bid: number | null): string | null {
  if (bid === null) return null
  return bid === 0 ? '不叫' : `${bid} 分`
}

function Seat({ seat, phase }: { seat: DoudizhuSeatInfo; phase: DoudizhuTableProps['phase'] }) {
  const bidText = phase === 'bidding' ? bidLabel(seat.bid) : null
  return (
    <div className={`gh-ddz-seat${seat.isTurn ? ' gh-ddz-seat--active' : ''}`}>
      <div className="gh-ddz-seat-head">
        <span className="gh-ddz-seat-avatar" aria-hidden="true">
          {seat.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="gh-ddz-seat-copy">
          <span className="gh-ddz-seat-name">
            {seat.role === 'landlord' && <span className="gh-ddz-crown" title="地主">👑</span>}
            {seat.name}
          </span>
          <span className="gh-ddz-seat-meta">
            {seat.role && (
              <span className={`gh-ddz-role-badge gh-ddz-role-badge--${seat.role}`}>
                {seat.role === 'landlord' ? '地主' : '农民'}
              </span>
            )}
            {seat.online !== undefined && (
              <span className={`gh-ddz-presence-dot${seat.online ? ' gh-ddz-presence-dot--online' : ''}`} />
            )}
          </span>
        </span>
        <span className="gh-ddz-seat-count" aria-label={`剩余 ${seat.cardCount} 张`}>
          {seat.cardCount}
        </span>
      </div>
      <div className="gh-ddz-seat-backs" aria-hidden="true">
        {Array.from({ length: Math.min(seat.cardCount, 8) }, (_, index) => (
          <span key={index} className="gh-ddz-back" />
        ))}
      </div>
    </div>
  )
}

function PlaySlot({ action, bid }: { action: DoudizhuSeatInfo['lastAction']; bid: string | null }) {
  return (
    <div className="gh-ddz-play-slot">
      {bid !== null && <span className="gh-ddz-bubble gh-ddz-bubble--bid">{bid}</span>}
      {action === 'pass' && <span className="gh-ddz-bubble">不要</span>}
      {action && action !== 'pass' && (
        <DoudizhuMiniCards cards={action.cards} ariaLabel="出牌" />
      )}
    </div>
  )
}

export default function DoudizhuTable({
  phase,
  leftSeat,
  rightSeat,
  me,
  bottomCards,
  multiplier,
  centerHint,
  remainingSeconds,
  selectedIds,
  onToggleCard,
  handDisabled,
  actions,
  overlay,
}: DoudizhuTableProps) {
  const meBidText = phase === 'bidding' ? bidLabel(me.bid) : null

  return (
    <div className="gh-ddz-felt">
      {/* 顶行：上家 · 底牌与倍率 · 下家 */}
      <div className="gh-ddz-felt-top">
        <Seat seat={leftSeat} phase={phase} />
        <div className="gh-ddz-pot">
          <span className="gh-ddz-pot-label">底牌</span>
          <span className="gh-ddz-pot-cards">
            {phase === 'bidding'
              ? bottomCards.map((card) => <span key={card.id} className="gh-ddz-back gh-ddz-back--sm" />)
              : <DoudizhuMiniCards cards={bottomCards} ariaLabel="底牌" />}
          </span>
          <span className="gh-ddz-multiplier">×{multiplier}</span>
        </div>
        <Seat seat={rightSeat} phase={phase} />
      </div>

      {/* 中央：各家最近一手 + 提示 + 计时 */}
      <div className="gh-ddz-felt-mid">
        <PlaySlot action={leftSeat.lastAction} bid={phase === 'bidding' ? bidLabel(leftSeat.bid) : null} />
        <div className="gh-ddz-felt-center">
          <p className="gh-ddz-center-hint">{centerHint}</p>
          {typeof remainingSeconds === 'number' && remainingSeconds >= 0 && (
            <span className={`gh-ddz-countdown${remainingSeconds <= 15 ? ' gh-ddz-countdown--urgent' : ''}`}>
              <strong>{remainingSeconds}s</strong>
            </span>
          )}
        </div>
        <PlaySlot action={rightSeat.lastAction} bid={phase === 'bidding' ? bidLabel(rightSeat.bid) : null} />
      </div>

      {/* 我的一侧：操作按钮 → 我最近一手 → 手牌 */}
      <div className="gh-ddz-felt-me">
        <div className="gh-ddz-me-row">
          <span className="gh-ddz-me-name">
            {me.role === 'landlord' && <span className="gh-ddz-crown" title="地主">👑</span>}
            {me.name}
            {me.role && (
              <span className={`gh-ddz-role-badge gh-ddz-role-badge--${me.role}`}>
                {me.role === 'landlord' ? '地主' : '农民'}
              </span>
            )}
            {me.isTurn && <span className="gh-ddz-turn-tag">轮到你</span>}
          </span>
          <div className="gh-ddz-actions">{actions}</div>
        </div>
        <div className="gh-ddz-me-play">
          <PlaySlot action={me.lastAction} bid={meBidText} />
        </div>
        <div className="gh-ddz-hand" role="group" aria-label="我的手牌">
          {me.hand.map((card) => (
            <DoudizhuCardView
              key={card.id}
              card={card}
              selected={selectedIds.has(card.id)}
              selectable={!handDisabled}
              onClick={onToggleCard}
            />
          ))}
        </div>
      </div>

      {overlay}
    </div>
  )
}
