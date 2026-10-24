import type { GameCatalogEntry } from '../../../lib/games/catalog'

/**
 * 大厅卡片封面：纯 CSS 渐变 + 大号符号 + 游戏名字标。
 * 配色由 CSS 里的 `[data-game]` 规则决定，亮/暗主题通用。
 */
export interface GameCoverProps {
  game: GameCatalogEntry
  size?: 'md' | 'lg'
}

export default function GameCover({ game, size = 'md' }: GameCoverProps) {
  return (
    <div
      className={`gh-games-cover gh-games-cover--${size}`}
      data-game={game.id}
      aria-hidden="true"
    >
      <span className="gh-games-cover-wordmark">{game.name}</span>
      <span className="gh-games-cover-symbol">{game.icon}</span>
      {!game.playable && <span className="gh-games-cover-soon">COMING SOON</span>}
    </div>
  )
}
