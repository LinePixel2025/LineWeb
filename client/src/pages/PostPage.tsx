import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import api from '../lib/api'
import LiquidGlass from '../components/glass/LiquidGlass'
import CommentSection from '../components/comments/CommentSection'

interface PostDetail {
  id: number; title: string; content: string; summary: string | null
  slug: string; createdAt: string; updatedAt: string; author: { username: string }
}

export default function PostPage() {
  const { slug } = useParams<{ slug: string }>()
  const [post, setPost] = useState<PostDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    api.get<PostDetail>(`/posts/${slug}`)
      .then(setPost).catch(err => setError(err.message)).finally(() => setLoading(false))
  }, [slug])

  if (loading) return <div className="page container" style={{ display: 'flex', justifyContent: 'center', paddingTop: '120px' }}><div className="spinner" /></div>

  if (error || !post) {
    return (
      <div className="page container" style={{ textAlign: 'center', paddingTop: '120px' }}>
        <h2>文章未找到</h2>
        <p className="text-secondary" style={{ marginTop: '8px' }}>{error || '请检查链接是否正确'}</p>
        <Link to="/posts" className="liquid-btn glass" style={{ marginTop: '20px', display: 'inline-block', padding: '10px 24px', borderRadius: '9999px', background: 'var(--lg-glass-bg)', border: '1px solid var(--lg-glass-border)', textDecoration: 'none', color: 'var(--lg-text-primary)' }}>返回文章列表</Link>
      </div>
    )
  }

  return (
    <article className="page container" style={{ maxWidth: '720px' }}>
      <Link to="/posts" className="post-back-link">&larr; 返回文章列表</Link>

      <LiquidGlass variant="blur" interactive={false} className="post-content-card">
        <h1 className="post-title">{post.title}</h1>
        <div className="post-meta">
          <span className="text-tertiary">{post.author.username}</span>
          <span className="text-tertiary">{new Date(post.createdAt).toLocaleDateString('zh-CN')}</span>
        </div>

        <div className="article-content" dangerouslySetInnerHTML={{ __html: post.content }} />
      </LiquidGlass>

      <div className="post-section-divider" />

      <CommentSection postId={post.id} />
    </article>
  )
}
