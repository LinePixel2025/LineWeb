import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import GameCard from '../components/games/lobby/GameCard'
import { useFeature } from '../contexts/FeatureContext'
import api from '../lib/api'
import { COMING_SOON_GAMES, PLAYABLE_GAMES } from '../lib/games/catalog'

/**
 * 游戏大厅：可玩游戏按目录动态渲染（第一款为精选大卡），其余卡片进网格，
 * 即将上线为占位卡。需登录；单机/联机入口按功能开关过滤。
 *
 * 「清除联机状态」用于客户端与服务端失步（已经离开页面，但服务端仍认为在
 * 房间/对局中）时手动复位：等待房间离开/解散，进行中的对局按认输处理。
 */
export default function GamesPage() {
  const { isEnabled } = useFeature()
  const showSingle = isEnabled('gamesSingle')
  const showOnline = isEnabled('gamesOnline')
  const playableGames = PLAYABLE_GAMES.filter((game) =>
    (showSingle && !!game.route) || (showOnline && !!game.onlineRoute)
  )
  const [resetting, setResetting] = useState(false)
  const [resetNote, setResetNote] = useState<string | null>(null)

  const handleForceReset = useCallback(async () => {
    if (!window.confirm('这会清除你在所有游戏里的房间 / 对局状态：等待房间会被解散，进行中的对局按认输处理。确定继续吗？')) {
      return
    }
    setResetting(true)
    setResetNote(null)
    try {
      const data = await api.post<{ ok: boolean; cleared: number }>('/games/force-reset')
      setResetNote(
        data.cleared > 0
          ? `已清理 ${data.cleared} 个房间 / 对局`
          : '当前没有进行中的房间或对局'
      )
    } catch (err) {
      setResetNote(err instanceof Error && err.message ? err.message : '清理失败，请稍后重试')
    } finally {
      setResetting(false)
    }
  }, [])

  return (
    <div className="gh-page-container gh-games-page">
      <header className="gh-games-header">
        <div className="gh-games-header-copy">
          <p className="gh-games-eyebrow">GAMES</p>
          <h1 className="gh-games-title">游戏大厅</h1>
          <p className="gh-games-subtitle">放松一下：单机挑战最高分，或邀请好友实时对战。</p>
        </div>
        <div className="gh-games-tools">
          <Link className="gh-btn gh-btn--secondary gh-btn--md" to="/games/leaderboard">
            排行榜
          </Link>
          <button
            type="button"
            className="gh-btn gh-btn--secondary gh-btn--md"
            onClick={() => void handleForceReset()}
            disabled={resetting}
          >
            {resetting ? '清理中…' : '清除联机状态'}
          </button>
          {resetNote && (
            <p className="gh-games-tools-note" role="status">
              {resetNote}
            </p>
          )}
        </div>
      </header>

      <section className="gh-games-section" aria-labelledby="gh-games-playable-title">
        <div className="gh-games-section-head">
          <h2 id="gh-games-playable-title" className="gh-games-section-title">
            可玩游戏
          </h2>
          <span className="gh-badge gh-badge--success">{playableGames.length} 款</span>
        </div>

        {playableGames.length === 0 ? (
          <div className="gh-box" style={{ padding: '32px', textAlign: 'center' }}>
            <p className="gh-text-secondary">单机与联机游戏当前都已关闭。</p>
          </div>
        ) : (
          <div className="gh-games-grid">
            {playableGames.map((game, index) => (
              <GameCard
                key={game.id}
                game={game}
                variant={index === 0 ? 'featured' : 'grid'}
                index={index}
                showSingle={showSingle}
                showOnline={showOnline}
              />
            ))}
          </div>
        )}

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
              showSingle={showSingle}
              showOnline={showOnline}
            />
          ))}
        </div>
      </section>
    </div>
  )
}
