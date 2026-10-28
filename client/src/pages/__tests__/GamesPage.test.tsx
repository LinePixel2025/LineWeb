import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import GamesPage from '../GamesPage'
import { COMING_SOON_GAMES, PLAYABLE_GAMES } from '../../lib/games/catalog'

// 功能开关在测试中全开
vi.mock('../../contexts/FeatureContext', () => ({
  useFeature: () => ({
    isEnabled: () => true,
    features: {},
    ready: true,
    refresh: async () => {},
  }),
}))

function renderGamesPage() {
  return render(
    <MemoryRouter initialEntries={['/games']}>
      <GamesPage />
    </MemoryRouter>
  )
}

describe('GamesPage', () => {
  it('renders the lobby heading and the 2048 card', () => {
    renderGamesPage()

    expect(screen.getByRole('heading', { level: 1, name: '游戏大厅' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: /2048/ })).toBeInTheDocument()
    expect(screen.getByText(/滑动合并数字方块/)).toBeInTheDocument()
  })

  it('目录中每个可玩游戏都渲染了卡片与入口（防止页面写死漏掉新游戏）', () => {
    renderGamesPage()

    for (const game of PLAYABLE_GAMES) {
      expect(screen.getByRole('heading', { level: 3, name: game.name })).toBeInTheDocument()

      if (game.route) {
        const links = screen.getAllByRole('link', { name: '单机开始' })
        expect(links.some((link) => link.getAttribute('href') === game.route)).toBe(true)
      }
      if (game.onlineRoute) {
        const links = screen.getAllByRole('link', { name: /好友对战/ })
        expect(links.some((link) => link.getAttribute('href') === game.onlineRoute)).toBe(true)
      }
    }

    expect(screen.getByText(`${PLAYABLE_GAMES.length} 款`)).toBeInTheDocument()
  })

  it('斗地主已在大厅可玩区展示', () => {
    renderGamesPage()

    expect(screen.getByRole('heading', { level: 3, name: '斗地主' })).toBeInTheDocument()
    expect(screen.getByText(/经典三人扑克/)).toBeInTheDocument()
  })

  it('renders online entries and leaderboard links for logged-in users', () => {
    renderGamesPage()

    expect(screen.queryAllByText('需登录')).toHaveLength(0)
    const onlineCount = PLAYABLE_GAMES.filter((game) => game.onlineRoute).length
    expect(screen.getAllByRole('link', { name: /好友对战/ })).toHaveLength(onlineCount)
    // 我的世界没有排行榜
    const leaderboardCount = PLAYABLE_GAMES.filter((game) => game.id !== 'minecraft').length
    expect(screen.getAllByRole('link', { name: '查看排行' })).toHaveLength(leaderboardCount)
  })

  it('renders coming-soon placeholder cards from the catalog', () => {
    renderGamesPage()

    expect(screen.getByRole('heading', { level: 2, name: '即将上线' })).toBeInTheDocument()
    for (const game of COMING_SOON_GAMES) {
      expect(screen.getByRole('heading', { level: 3, name: new RegExp(game.name) })).toBeInTheDocument()
    }
    // 当前目录可能没有占位游戏：queryAllByText 兼容空列表
    expect(screen.queryAllByText('敬请期待')).toHaveLength(COMING_SOON_GAMES.length)
  })

  it('每张卡片都有游戏化封面，占位卡没有入口链接', () => {
    const { container } = renderGamesPage()

    expect(container.querySelectorAll('.gh-games-cover')).toHaveLength(
      PLAYABLE_GAMES.length + COMING_SOON_GAMES.length,
    )

    const soonCards = container.querySelectorAll('.gh-games-card--soon')
    expect(soonCards).toHaveLength(COMING_SOON_GAMES.length)
    soonCards.forEach((card) => {
      expect(card.querySelectorAll('a')).toHaveLength(0)
    })

    expect(
      container.querySelector('.gh-games-card--featured')?.getAttribute('data-game'),
    ).toBe(PLAYABLE_GAMES[0].id)
  })
})
