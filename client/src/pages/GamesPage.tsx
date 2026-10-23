import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  COMING_SOON_GAMES,
  PLAYABLE_GAMES,
} from '../lib/games/catalog'

/**
 * 游戏大厅：可玩游戏卡片 + 即将上线占位卡片。
 *
 * 可玩游戏全部按目录（PLAYABLE_GAMES）动态渲染：目录里第一个游戏用
 * 精选大卡片样式，其余进网格；新增游戏只需在 catalog 里上架即可出现。
 *
 * 公开页面（不依赖登录态即可访问）；联机入口在未登录时标注「需登录」，
 * 真正的登录校验由各游戏 online 路由的 ProtectedRoute 负责。
 */
export default function GamesPage() {
  const { user } = useAuth()
  const [featured, ...restPlayable] = PLAYABLE_GAMES

  const renderActions = (route: string | null, onlineRoute: string | null) => (
    <div className="gh-games-card-actions">
      {route && (
        <Link className="gh-btn gh-btn--primary gh-btn--lg" to={route}>
          单机开始
        </Link>
      )}
      {onlineRoute && (
        <Link className="gh-btn gh-btn--secondary gh-btn--lg" to={onlineRoute}>
          好友对战
          {!user && <span className="gh-games-login-hint">需登录</span>}
        </Link>
      )}
    </div>
  )

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

        {featured && (
          <article className="gh-games-card gh-games-card--featured">
            <div className="gh-games-card-head">
              <span className="gh-games-card-icon" aria-hidden="true">
                {featured.icon}
              </span>
              <div className="gh-games-card-copy">
                <h3 className="gh-games-card-title">{featured.name}</h3>
                <p className="gh-games-card-desc">{featured.description}</p>
                <div className="gh-games-card-badges">
                  {featured.modes.map((mode) => (
                    <span key={mode} className="gh-badge">
                      {mode === 'single' ? '单机' : '好友联机'}
                    </span>
                  ))}
                  <span className="gh-badge gh-badge--accent">记录保存在本机</span>
                </div>
              </div>
            </div>

            {renderActions(featured.route, featured.onlineRoute)}

            <p className="gh-games-card-meta">
              联机对战需要登录，并与对方互为好友；无 WebSocket 时自动降级为轮询（约 2–5 秒延迟）。
            </p>
          </article>
        )}

        {restPlayable.length > 0 && (
          <div className="gh-games-grid">
            {restPlayable.map((game) => (
              <article key={game.id} className="gh-games-card">
                <div className="gh-games-card-head">
                  <span className="gh-games-card-icon" aria-hidden="true">
                    {game.icon}
                  </span>
                  <div className="gh-games-card-copy">
                    <h3 className="gh-games-card-title">{game.name}</h3>
                    <p className="gh-games-card-desc">{game.description}</p>
                    <div className="gh-games-card-badges">
                      {game.modes.map((mode) => (
                        <span key={mode} className="gh-badge">
                          {mode === 'single' ? '单机' : '好友联机'}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {renderActions(game.route, game.onlineRoute)}

                <p className="gh-games-card-meta">
                  联机对战需要登录，并与对方互为好友；无 WebSocket 时自动降级为轮询（约 2–5 秒延迟）。
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="gh-games-section" aria-labelledby="gh-games-soon-title">
        <div className="gh-games-section-head">
          <h2 id="gh-games-soon-title" className="gh-games-section-title">
            即将上线
          </h2>
          <span className="gh-badge gh-badge--warning">{COMING_SOON_GAMES.length} 款筹备中</span>
        </div>

        <div className="gh-games-grid">
          {COMING_SOON_GAMES.map((game) => (
            <article key={game.id} className="gh-games-card gh-games-card--soon" aria-disabled="true">
              <div className="gh-games-card-head">
                <span className="gh-games-card-icon" aria-hidden="true">
                  {game.icon}
                </span>
                <div className="gh-games-card-copy">
                  <h3 className="gh-games-card-title">
                    {game.name}
                    <span className="gh-badge gh-badge--warning gh-games-soon-badge">敬请期待</span>
                  </h3>
                  <p className="gh-games-card-desc">{game.description}</p>
                  <div className="gh-games-card-badges">
                    {game.modes.map((mode) => (
                      <span key={mode} className="gh-badge">
                        {mode === 'single' ? '单机' : '联机'}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
