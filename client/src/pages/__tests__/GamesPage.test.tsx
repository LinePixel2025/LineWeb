import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import GamesPage from '../GamesPage'
import { COMING_SOON_GAMES, PLAYABLE_GAMES } from '../../lib/games/catalog'

// 大厅页是公开页面，只读取 user 决定是否显示「需登录」，这里模拟未登录访客
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null }),
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

  it('marks the online entry as login-required for guests', () => {
    renderGamesPage()

    // 每个带联机模式的可玩游戏都应有「需登录」提示
    const onlineCount = PLAYABLE_GAMES.filter((game) => game.onlineRoute).length
    expect(screen.getAllByText('需登录')).toHaveLength(onlineCount)
  })

  it('renders coming-soon placeholder cards from the catalog', () => {
    renderGamesPage()

    expect(screen.getByRole('heading', { level: 2, name: '即将上线' })).toBeInTheDocument()
    for (const game of COMING_SOON_GAMES) {
      expect(screen.getByRole('heading', { level: 3, name: new RegExp(game.name) })).toBeInTheDocument()
    }
    expect(screen.getAllByText('敬请期待')).toHaveLength(COMING_SOON_GAMES.length)
  })
})
