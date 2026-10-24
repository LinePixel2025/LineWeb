import GameCard from '../components/games/lobby/GameCard'
import { useAuth } from '../contexts/AuthContext'
import { COMING_SOON_GAMES, PLAYABLE_GAMES } from '../lib/games/catalog'

/**
 * 游戏大厅：可玩游戏按目录动态渲染（第一款为精选大卡），其余卡片进网格，
 * 即将上线为占位卡。公开页面，联机入口在未登录时标注「需登录」。
 */
export default function GamesPage() {
  const { user } = useAuth()
  const isGuest = !user

  return (
    <div className="gh-page-container gh-games-page">
      <header className="gh-games-header">
        <div className="gh-games-header-copy">
          <p className="gh-games-eyebrow">GAMES</p>
          <h1 className="gh-games-title">游戏大厅</h1>
          <p className="gh-games-subtitle">放松一下：单机挑战最高分，或邀请好友实时对战。</p>
        </div>
      </header>

      <section className="gh-games-section" aria-labelledby="gh-games-playable-title">
        <div className="gh-games-section-head">
          <h2 id="gh-games-playable-title" className="gh-games-section-title">
            可玩游戏
          </h2>
          <span className="gh-badge gh-badge--success">{PLAYABLE_GAMES.length} 款</span>
        </div>

        <div className="gh-games-grid">
          {PLAYABLE_GAMES.map((game, index) => (
            <GameCard
              key={game.id}
              game={game}
              variant={index === 0 ? 'featured' : 'grid'}
              index={index}
              isGuest={isGuest}
            />
          ))}
        </div>

        <p className="gh-games-footnote">
          联机对战需要登录，并与对方互为好友；无 WebSocket 时自动降级为轮询（约 2–5 秒延迟）。
        </p>
      </section>

      <section className="gh-games-section" aria-labelledby="gh-games-soon-title">
        <div className="gh-games-section-head">
          <h2 id="gh-games-soon-title" className="gh-games-section-title">
            即将上线
          </h2>
          <span className="gh-badge gh-badge--warning">{COMING_SOON_GAMES.length} 款筹备中</span>
        </div>

        <div className="gh-games-grid">
          {COMING_SOON_GAMES.map((game, index) => (
            <GameCard
              key={game.id}
              game={game}
              variant="soon"
              index={index}
              isGuest={isGuest}
            />
          ))}
        </div>
      </section>
    </div>
  )
}
