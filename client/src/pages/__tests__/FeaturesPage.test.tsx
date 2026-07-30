import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, expect, it } from 'vitest'
import FeaturesPage from '../FeaturesPage'

vi.mock('../../hooks/useQueries', () => ({
  useFeaturedPages: () => ({
    data: {
      pages: [{
        id: 1,
        title: '自定义工具',
        slug: 'custom-tool',
        featureEmoji: null,
        featureDesc: '自定义页面描述',
      }],
    },
    isSuccess: true,
  }),
}))

describe('FeaturesPage', () => {
  it('renders custom pages in a separate section below built-in features', () => {
    const { container } = render(
      <MemoryRouter>
        <FeaturesPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: '自定义页面' })).toBeInTheDocument()

    const grids = container.querySelectorAll('.gh-feature-grid')
    expect(grids).toHaveLength(2)
    expect(grids[0].querySelectorAll('a')).toHaveLength(3)
    expect(grids[1].querySelectorAll('a')).toHaveLength(1)
    expect(grids[1].querySelector('a')?.getAttribute('href')).toBe('/page/custom-tool')
  })
})
