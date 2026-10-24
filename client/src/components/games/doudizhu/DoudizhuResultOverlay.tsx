import { useEffect, useId, useRef, type ReactNode } from 'react'

export type DoudizhuOutcome = 'win' | 'lose' | 'draw'

export interface DoudizhuScoreEntry {
  key: string | number
  name: string
  /** 本局积分变化；null 表示未结算 */
  delta: number | null
}

export interface DoudizhuResultOverlayProps {
  open: boolean
  outcome: DoudizhuOutcome
  /** 覆盖默认标题（默认按 outcome 取「恭喜获胜！/本局告负/本局结束」） */
  title?: string
  detail?: ReactNode
  scores: DoudizhuScoreEntry[]
  actions: ReactNode
  footnote?: ReactNode
}

const OUTCOME_TITLES: Record<DoudizhuOutcome, string> = {
  win: '恭喜获胜！',
  lose: '本局告负',
  draw: '本局结束',
}

export default function DoudizhuResultOverlay({
  open,
  outcome,
  title,
  detail,
  scores,
  actions,
  footnote,
}: DoudizhuResultOverlayProps) {
  const titleId = useId()
  const actionsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    actionsRef.current?.querySelector<HTMLElement>('button, a')?.focus({ preventScroll: true })
  }, [open])

  if (!open) return null

  return (
    <div className="gh-ddz-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="gh-ddz-overlay-card">
        <h2
          id={titleId}
          className={`gh-ddz-overlay-title gh-ddz-overlay-title--${outcome}`}
        >
          {title ?? OUTCOME_TITLES[outcome]}
        </h2>

        {detail != null && <p className="gh-ddz-overlay-detail">{detail}</p>}

        <div className="gh-ddz-scores">
          {scores.map((score) => (
            <span key={score.key} className="gh-ddz-score">
              <span className="gh-ddz-score-name">{score.name}</span>
              <span
                className={`gh-ddz-score-value${
                  score.delta === null
                    ? ''
                    : score.delta >= 0
                      ? ' gh-ddz-score-value--up'
                      : ' gh-ddz-score-value--down'
                }`}
              >
                {score.delta === null ? '—' : `${score.delta >= 0 ? '+' : ''}${score.delta}`}
              </span>
            </span>
          ))}
        </div>

        <div className="gh-ddz-overlay-actions" ref={actionsRef}>
          {actions}
        </div>

        {footnote != null && <p className="gh-ddz-overlay-detail">{footnote}</p>}
      </div>
    </div>
  )
}
