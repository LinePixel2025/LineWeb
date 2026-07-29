import { useMemo, lazy, Suspense } from 'react'
import { useParams, Link } from 'react-router-dom'
import DOMPurify from 'dompurify'
import { usePost } from '../hooks/useQueries'
import { GitHubButton } from '../components/ui'

const CommentSection = lazy(() => import('../components/comments/CommentSection'))

interface PostDetail {
  id: number; title: string; content: string; summary: string | null
  slug: string; createdAt: string; updatedAt: string; author: { username: string }
}

export default function PostPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: post, isLoading: loading, error } = usePost(slug)

  const sanitizedContent = useMemo(
    () => post ? DOMPurify.sanitize(post.content, { USE_PROFILES: { html: true } }) : '',
    [post?.content],
  )

  if (loading) return (
    <div className="gh-page-container" style={{ display: 'flex', justifyContent: 'center', paddingTop: '120px' }}>
      <div className="gh-spinner" />
    </div>
  )

  if (error || !post) {
    return (
      <div className="gh-page-container" style={{ textAlign: 'center', paddingTop: '120px', maxWidth: '760px' }}>
        <h2>文章未找到</h2>
        <p className="gh-text-secondary" style={{ marginTop: '8px' }}>{error instanceof Error ? error.message : (error || '请检查链接是否正确')}</p>
        <div style={{ marginTop: '20px' }}>
          <GitHubButton href="/posts" variant="secondary">返回文章列表</GitHubButton>
        </div>
      </div>
    )
  }

  return (
    <article className="gh-page-container" style={{ maxWidth: '760px' }}>
      <Link to="/posts" className="gh-text-secondary" style={{ fontSize: '0.85rem', display: 'inline-block', marginBottom: '16px' }}>&larr; 返回文章列表</Link>

      <div className="gh-page-header">
        <h1 className="gh-page-title">{post.title}</h1>
        <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
          <span className="gh-text-secondary">{post.author.username}</span>
          <span className="gh-text-tertiary">{new Date(post.createdAt).toLocaleDateString('zh-CN')}</span>
        </div>
      </div>

      <div className="gh-post-layout">
        <div className="gh-post-author">
          <div className="gh-post-author-avatar">
            {post.author.username.charAt(0).toUpperCase()}
          </div>
          <div className="gh-post-author-info">
            <span className="gh-post-author-name">{post.author.username}</span>
            <span className="gh-text-tertiary" style={{ fontSize: '0.78rem' }}>作者</span>
          </div>
        </div>
        <div className="gh-post-body">
          <div className="gh-box" style={{ padding: '24px' }}>
            <div className="article-content" dangerouslySetInnerHTML={{ __html: sanitizedContent }} />
          </div>
        </div>
      </div>

      <div style={{ marginTop: '32px', borderTop: '1px solid var(--gh-color-border-default)', paddingTop: '24px' }}>
        <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}><div className="gh-spinner" /></div>}>
          <CommentSection postId={post.id} />
        </Suspense>
      </div>
    </article>
  )
}
