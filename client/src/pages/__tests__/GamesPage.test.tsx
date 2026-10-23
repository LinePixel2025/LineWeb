import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import GamesPage from '../GamesPage'
import { COMING_SOON_GAMES } from '../../lib/games/catalog'

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

  it('links to the single-player and online 2048 routes', () => {
    renderGamesPage()

    expect(screen.getByRole('link', { name: '单机开始' })).toHaveAttribute('href', '/games/2048')
    expect(screen.getByRole('link', { name: /好友对战/ })).toHaveAttribute(
      'href',
      '/games/2048/online'
    )
  })

  it('marks the online entry as login-required for guests', () => {
    renderGamesPage()

    expect(screen.getByText('需登录')).toBeInTheDocument()
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
