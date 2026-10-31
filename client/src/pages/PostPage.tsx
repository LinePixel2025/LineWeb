import { useMemo, lazy, Suspense } from 'react'
import { useParams, Link } from 'react-router-dom'
import DOMPurify from 'dompurify'
import { usePost } from '../hooks/useQueries'
import { useFeature } from '../contexts/FeatureContext'
import { Button } from '../components/ui'
import { formatDate } from '../components/PostListItem'

const CommentSection = lazy(() => import('../components/comments/CommentSection'))

interface PostDetail {
  id: number; title: string; content: string; summary: string | null
  slug: string; createdAt: string; updatedAt: string; author: { username: string }
}

export default function PostPage() {
  const { slug } = useParams<{ slug: string }>()
  const { isEnabled } = useFeature()
  const { data: post, isLoading: loading, error } = usePost(slug)

  const sanitizedContent = useMemo(
    () => post ? DOMPurify.sanitize(post.content, { USE_PROFILES: { html: true } }) : '',
    [post?.content],
  )

  if (loading) return (
    <div className="gh-page-container">
      <div className="gh-loading-row"><div className="gh-spinner" /></div>
    </div>
  )

  if (error || !post) {
    return (
      <div className="gh-page-container gh-post-detail">
        <div className="gh-empty-card gh-post-notfound">
          <h2>文章未找到</h2>
          <p className="gh-text-secondary">
            {error instanceof Error ? error.message : (error || '请检查链接是否正确')}
          </p>
          <Button href="/posts" variant="secondary">返回文章列表</Button>
        </div>
      </div>
    )
  }

  return (
    <article className="gh-page-container gh-post-detail">
      <Link to="/posts" className="gh-post-back">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 3.5 5.5 8l4.5 4.5" />
        </svg>
        文章列表
      </Link>

      <header className="gh-post-header">
        <h1 className="gh-post-title">{post.title}</h1>
        <div className="gh-post-meta">
          <span className="gh-post-author-avatar" aria-hidden>{post.author.username.charAt(0).toUpperCase()}</span>
          <span className="gh-post-meta-copy">
            <strong>{post.author.username}</strong>
            <span className="gh-meta-dot" aria-hidden>·</span>
            {formatDate(post.createdAt)}
          </span>
        </div>
      </header>

      <section className="gh-post-content">
        <div className="article-content" dangerouslySetInnerHTML={{ __html: sanitizedContent }} />
      </section>

      {isEnabled('comments') && (
        <section className="gh-post-comments">
          <Suspense fallback={<div className="gh-loading-row"><div className="gh-spinner" /></div>}>
            <CommentSection postId={post.id} />
          </Suspense>
        </section>
      )}
    </article>
  )
}
