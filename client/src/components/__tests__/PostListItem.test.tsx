import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PostListItem, { PostFeaturedCard, PostAvatar, type PostListItemData } from '../PostListItem'

const post: PostListItemData = {
  id: 7,
  title: '测试文章',
  slug: 'test-post',
  summary: '原始摘要',
  excerpt: '这是列表展示用的摘要文本',
  readingTime: 3,
  createdAt: '2026-08-30T00:00:00.000Z',
  author: { username: 'tester' },
}

function wrap(node: React.ReactNode) {
  return <MemoryRouter initialEntries={['/']}>{node}</MemoryRouter>
}

describe('PostAvatar', () => {
  it('展示标题首字并带色相背景', () => {
    const { container } = render(<PostAvatar postId={7} title="测试文章" />)
    const el = container.querySelector('.gh-post-avatar')
    expect(el).not.toBeNull()
    expect(el!.textContent).toBe('测')
    // jsdom 会把 hsl() 归一化为 rgb()，只需断言非空且两次渲染稳定
    const bg = (el! as HTMLElement).style.background
    expect(bg).not.toBe('')
    const { container: c2 } = render(<PostAvatar postId={7} title="测试文章" />)
    expect((c2.querySelector('.gh-post-avatar') as HTMLElement).style.background).toBe(bg)
  })
})

describe('PostListItem', () => {
  it('渲染标题、摘要与阅读时长', () => {
    render(wrap(<PostListItem post={post} />))
    expect(screen.getByText('测试文章')).toBeInTheDocument()
    expect(screen.getByText('这是列表展示用的摘要文本')).toBeInTheDocument()
    expect(screen.getByText('约 3 分钟')).toBeInTheDocument()
    expect(screen.getByText('tester')).toBeInTheDocument()
  })

  it('链接指向文章详情', () => {
    render(wrap(<PostListItem post={post} />))
    const link = screen.getByText('测试文章').closest('a')
    expect(link).toHaveAttribute('href', '/posts/test-post')
  })
})

describe('PostFeaturedCard', () => {
  it('带「最新」徽标渲染', () => {
    render(wrap(<PostFeaturedCard post={post} />))
    expect(screen.getByText('最新')).toBeInTheDocument()
    expect(screen.getByText('测试文章')).toBeInTheDocument()
  })
})
