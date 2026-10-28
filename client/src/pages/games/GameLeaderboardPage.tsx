import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import UserAvatar from '../../components/UserAvatar'
import { useFeature } from '../../contexts/FeatureContext'
import { useLeaderboard } from '../../hooks/useLeaderboard'
import {
  LEADERBOARD_GAMES,
  entrySecondaryText,
  formatLeaderboardValue,
  leaderboardGame,
} from '../../lib/games/leaderboard'
import type { LeaderboardEntry } from '../../types/gameStats'

function PodiumCard({ entry, data }: { entry: LeaderboardEntry; data: ReturnType<typeof useLeaderboard>['data'] }) {
  if (!data) return null
  return (
    <div className={`gh-games-leaderboard-podium-card gh-games-leaderboard-podium-card--r${entry.rank}`}>
      <span className="gh-games-leaderboard-podium-rank">{entry.rank === 1 ? '👑' : entry.rank}</span>
      <UserAvatar userId={entry.userId} username={entry.username} size="lg" />
      <strong className="gh-games-leaderboard-podium-name">{entry.username}</strong>
      <span className="gh-games-leaderboard-podium-value">
        {formatLeaderboardValue(entry.value, data.unit)}
      </span>
      <span className="gh-games-leaderboard-podium-sub">{entrySecondaryText(data, entry)}</span>
    </div>
  )
}

export default function GameLeaderboardPage() {
  const [params, setParams] = useSearchParams()
  const { isEnabled } = useFeature()
  const selected = leaderboardGame(params.get('game'))

  const variants = useMemo(() => selected.variants.filter((variant) =>
    variant.key === 'online' ? isEnabled('gamesOnline') : isEnabled('gamesSingle')
  ), [selected, isEnabled])

  const variant = variants.find((item) => item.key === params.get('variant')) ?? variants[0]
  const query = useLeaderboard(selected.id, variant?.key ?? 'solo')
  const data = query.data
  const entries = data?.entries ?? []
  const top = entries.slice(0, 3)
  const rest = entries.slice(3)
  const meInList = entries.some((entry) => entry.isMe)

  const chooseGame = (id: string) => {
    const next = leaderboardGame(id)
    const nextVariant = next.variants.find((item) =>
      item.key === 'online' ? isEnabled('gamesOnline') : isEnabled('gamesSingle')
    )
    setParams({ game: id, ...(nextVariant ? { variant: nextVariant.key } : {}) })
  }

  const chooseVariant = (key: string) => {
    setParams({ game: selected.id, variant: key })
  }

  return (
    <div className="gh-page-container gh-games-page gh-games-leaderboard">
      <header className="gh-games-header">
        <div className="gh-games-header-copy">
          <p className="gh-games-eyebrow"><Link to="/games">← 游戏大厅</Link></p>
          <h1 className="gh-games-title">游戏排行榜</h1>
          <p className="gh-games-subtitle">全站总榜：单机与联机分开统计；单机成绩由客户端上报，仅供娱乐。</p>
        </div>
        <div className="gh-games-tools">
          <span className="gh-badge gh-badge--accent">{data?.total ?? 0} 人上榜</span>
        </div>
      </header>

      <div className="gh-games-leaderboard-games" role="tablist" aria-label="选择游戏">
        {LEADERBOARD_GAMES.map((game) => (
          <button
            key={game.id}
            type="button"
            role="tab"
            aria-selected={game.id === selected.id}
            className={`gh-games-leaderboard-chip ${game.id === selected.id ? 'gh-games-leaderboard-chip--active' : ''}`}
            onClick={() => chooseGame(game.id)}
          >
            {game.name}
          </button>
        ))}
      </div>

      {variants.length === 0 || !variant ? (
        <div className="gh-box" style={{ padding: '32px', textAlign: 'center' }}>
          <p className="gh-text-secondary">该游戏的排行榜当前已关闭。</p>
        </div>
      ) : (
        <>
          <div className="gh-games-leaderboard-tabs" role="tablist" aria-label="选择榜单类型">
            {variants.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={item.key === variant.key}
                className={`gh-games-leaderboard-tab ${item.key === variant.key ? 'gh-games-leaderboard-tab--active' : ''}`}
                onClick={() => chooseVariant(item.key)}
              >
                {item.label}
                <span className="gh-text-tertiary">{item.metricLabel}</span>
              </button>
            ))}
          </div>

          {query.isLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}>
              <div className="gh-spinner" />
            </div>
          ) : query.error ? (
            <div className="gh-alert gh-alert--danger" role="alert">
              {query.error instanceof Error ? query.error.message : '加载排行榜失败'}
            </div>
          ) : entries.length === 0 ? (
            <div className="gh-box" style={{ padding: '40px', textAlign: 'center' }}>
              <p className="gh-text-secondary">暂无战绩，去玩一局吧。</p>
              <Link className="gh-btn gh-btn--primary gh-btn--md" to="/games" style={{ marginTop: '12px' }}>
                返回游戏大厅
              </Link>
            </div>
          ) : (
            <>
              {variant.key === 'online' ? (
                <p className="gh-games-footnote">联机榜由服务端结算，可信度更高。</p>
              ) : (
                <p className="gh-games-footnote">单机榜由客户端上报，仅供娱乐。</p>
              )}

              <div className="gh-games-leaderboard-podium">
                {top.map((entry) => <PodiumCard key={entry.userId} entry={entry} data={data} />)}
              </div>

              {data?.me && !meInList && (
                <div className="gh-games-leaderboard-me">
                  <span>我的名次</span>
                  <strong>#{data.me.rank}</strong>
                  <span>{data.me.username}</span>
                  <strong>{formatLeaderboardValue(data.me.value, data.unit)}</strong>
                  <span>{entrySecondaryText(data, data.me)}</span>
                </div>
              )}

              <div className="gh-box gh-games-leaderboard-list">
                {rest.length === 0 ? (
                  <p className="gh-text-tertiary" style={{ padding: '16px', margin: 0 }}>暂无更多上榜玩家。</p>
                ) : rest.map((entry) => (
                  <div
                    key={entry.userId}
                    className={`gh-games-leaderboard-row ${entry.isMe ? 'gh-games-leaderboard-row--me' : ''}`}
                  >
                    <span className="gh-games-leaderboard-rank">#{entry.rank}</span>
                    <UserAvatar userId={entry.userId} username={entry.username} size="sm" />
                    <span className="gh-games-leaderboard-name">
                      {entry.username}
                      {entry.isMe && <span className="gh-badge gh-badge--success">我</span>}
                    </span>
                    <span className="gh-games-leaderboard-secondary">{entrySecondaryText(data!, entry)}</span>
                    <strong className="gh-games-leaderboard-value">
                      {formatLeaderboardValue(entry.value, data!.unit)}
                    </strong>
                  </div>
                ))}
              </div>

              {data?.me && meInList && (
                <p className="gh-text-tertiary" style={{ marginTop: '12px' }}>
                  你当前排名 #{data.me.rank}。
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
