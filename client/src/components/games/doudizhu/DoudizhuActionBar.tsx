/**
 * 叫分 / 出牌操作按钮组（单机与联机共用）。
 * `stage` 为 null 时表示当前不轮到我，不渲染任何按钮。
 */
export interface DoudizhuActionBarProps {
  stage: 'bidding' | 'playing' | null
  /** 当前已叫到的最高分，低分按钮禁用 */
  highestBid?: number
  canHint: boolean
  canPass: boolean
  canPlay: boolean
  onBid: (bid: number) => void
  onHint: () => void
  onPass: () => void
  onPlay: () => void
}

const BID_VALUES = [1, 2, 3] as const

export default function DoudizhuActionBar({
  stage,
  highestBid = 0,
  canHint,
  canPass,
  canPlay,
  onBid,
  onHint,
  onPass,
  onPlay,
}: DoudizhuActionBarProps) {
  if (stage === 'bidding') {
    return (
      <>
        <button
          type="button"
          className="gh-btn gh-btn--secondary gh-btn--md"
          onClick={() => onBid(0)}
        >
          不叫
        </button>
        {BID_VALUES.map((bid) => (
          <button
            key={bid}
            type="button"
            className="gh-btn gh-btn--primary gh-btn--md"
            disabled={bid <= highestBid}
            onClick={() => onBid(bid)}
          >
            {bid} 分
          </button>
        ))}
      </>
    )
  }

  if (stage === 'playing') {
    return (
      <>
        <button
          type="button"
          className="gh-btn gh-btn--secondary gh-btn--md"
          disabled={!canHint}
          onClick={onHint}
        >
          提示
        </button>
        <button
          type="button"
          className="gh-btn gh-btn--secondary gh-btn--md"
          disabled={!canPass}
          onClick={onPass}
        >
          不出
        </button>
        <button
          type="button"
          className="gh-btn gh-btn--primary gh-btn--md gh-ddz-play-btn"
          disabled={!canPlay}
          onClick={onPlay}
        >
          出牌
        </button>
      </>
    )
  }

  return null
}
