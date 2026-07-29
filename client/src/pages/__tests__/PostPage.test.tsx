import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { type ReactNode } from 'react'
import PostPage from '../PostPage'
import { usePost } from '../../hooks/useQueries'
import { AuthProvider } from '../../contexts/AuthContext'

vi.mock('../../hooks/useQueries', () => ({
  usePost: vi.fn(),
}))

vi.mock('../../components/comments/CommentSection', () => ({
  default: () => <div data-testid="comment-section">评论区</div>,
}))

vi.mock('dompurify', () => ({
  default: {
    sanitize: (html: string) => html,
  },
}))

const mockUsePost = vi.mocked(usePost)

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={['/posts/fsgf']}>
      <AuthProvider>
          <Routes>
            <Route path="/posts/:slug" element={children} />
          </Routes>
      </AuthProvider>
    </MemoryRouter>
  )
}

const mockPost = {
  id: 4,
  title: 'fsgf顺丰',
  content: '<p>哥哥</p>',
  summary: 'fsgf顺丰',
  slug: 'fsgf',
  createdAt: '2026-07-15T17:20:53.907Z',
  updatedAt: '2026-07-15T17:20:53.907Z',
  author: { username: 'Line' },
}

describe('PostPage', () => {
  it('加载时显示 spinner', () => {
    mockUsePost.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      isError: false,
      isSuccess: false,
      status: 'pending',
      fetchStatus: 'fetching',
    } as ReturnType<typeof usePost>)

    render(<PostPage />, { wrapper: Wrapper })

    expect(document.querySelector('.gh-spinner')).toBeInTheDocument()
  })

  it('错误时显示 文章未找到', () => {
    mockUsePost.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('请求失败 (404)'),
      isError: true,
      isSuccess: false,
      status: 'error',
      fetchStatus: 'idle',
    } as ReturnType<typeof usePost>)

    render(<PostPage />, { wrapper: Wrapper })

    expect(screen.getByText('文章未找到')).toBeInTheDocument()
  })

  it('成功时渲染文章标题、作者和正文（无 React hooks 错误）', async () => {
    mockUsePost.mockReturnValue({
      data: mockPost,
      isLoading: false,
      error: null,
      isError: false,
      isSuccess: true,
      status: 'success',
      fetchStatus: 'idle',
    } as ReturnType<typeof usePost>)

    render(<PostPage />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(screen.getByText('fsgf顺丰')).toBeInTheDocument()
      expect(screen.getByText('Line', { selector: '.gh-text-secondary' })).toBeInTheDocument()
      expect(screen.getByText('哥哥')).toBeInTheDocument()
    })
  })

  it('slug 未定义时 query 被禁用，但组件正常显示未找到', () => {
    mockUsePost.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      isError: false,
      isSuccess: false,
      status: 'pending',
      fetchStatus: 'idle',
    } as ReturnType<typeof usePost>)

    render(
      <MemoryRouter initialEntries={['/posts/']}>
        <AuthProvider>
            <Routes>
              <Route path="/posts/:slug" element={<PostPage />} />
              <Route path="*" element={<div>文章未找到</div>} />
            </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

    expect(screen.getByText('文章未找到')).toBeInTheDocument()
  })
})
