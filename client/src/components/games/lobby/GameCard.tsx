import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { GameCatalogEntry, GameCatalogMode } from '../../../lib/games/catalog'
import GameCover from './GameCover'

/** 模式徽章文案 */
const GAME_MODE_LABELS: Record<GameCatalogMode, string> = {
  single: '单机',
  local: '同屏双人',
  online: '好友联机',
}

/** 大厅卡片形态：精选大卡 / 普通网格卡 / 即将上线占位 */
export type GameCardVariant = 'featured' | 'grid' | 'soon'

export interface GameCardProps {
  game: GameCatalogEntry
  variant: GameCardVariant
  /** 入场动画错峰序号 */
  index: number
  /** 未登录访客：联机入口标注「需登录」 */
  isGuest: boolean
}

export default function GameCard({ game, variant, index, isGuest }: GameCardProps) {
  const soon = variant === 'soon'

  return (
    <article
      className={`gh-games-card gh-games-card--${variant}`}
      data-game={game.id}
      style={{ '--i': index } as CSSProperties}
      aria-disabled={soon || undefined}
    >
      <GameCover game={game} size={variant === 'featured' ? 'lg' : 'md'} />

      <div className="gh-games-card-body">
        {variant === 'featured' && <span className="gh-games-card-flag">主打</span>}

        <h3 className="gh-games-card-title">
          {game.name}
          {soon && (
            <span className="gh-badge gh-badge--warning gh-games-soon-badge">敬请期待</span>
          )}
        </h3>

        <p className="gh-games-card-desc">{game.description}</p>

        <div className="gh-games-card-badges">
          {game.modes.map((mode) => (
            <span key={mode} className="gh-badge">
              {GAME_MODE_LABELS[mode]}
            </span>
          ))}
          {variant === 'featured' && (
            <span className="gh-badge gh-badge--accent">记录保存在本机</span>
          )}
        </div>

        {!soon && (
          <div className="gh-games-card-actions">
            {game.route && (
              <Link className="gh-btn gh-btn--primary gh-btn--lg" to={game.route}>
                单机开始
              </Link>
            )}
            {game.onlineRoute && (
              <Link className="gh-btn gh-btn--secondary gh-btn--lg" to={game.onlineRoute}>
                好友对战
                {isGuest && <span className="gh-games-login-hint">需登录</span>}
              </Link>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
