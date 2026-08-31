import { Link } from 'react-router-dom'

/**
 * 文章列表条目 — HomePage feed 与 PostsPage 共用
 * variant=row：紧凑列表行；variant=featured：首页特色大卡
 */

export interface PostListItemData {
  id: number
  title: string
  slug: string
  summary: string | null
  excerpt?: string
  readingTime?: number
  createdAt: string
  author: { username: string }
}

/** 色相由 postId 派生的圆形头标（与 UserAvatar 同源算法，保证稳定配色） */
export function PostAvatar({ postId, title, size = 36 }: { postId: number; title: string; size?: number }) {
  const hue = (postId * 137.508) % 360
  return (
    <span
      className="gh-post-avatar"
      aria-hidden
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: `hsl(${hue}, 42%, 48%)`,
      }}
    >
      {title.charAt(0).toUpperCase()}
    </span>
  )
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return sameYear ? md : `${d.getFullYear()}年${md}`
}

function Meta({ post }: { post: PostListItemData }) {
  return (
    <div className="gh-list-item-meta">
      <span>{post.author.username}</span>
      <span className="gh-meta-dot" aria-hidden>·</span>
      <span>{formatDate(post.createdAt)}</span>
      {typeof post.readingTime === 'number' && (
        <>
          <span className="gh-meta-dot" aria-hidden>·</span>
          <span>约 {post.readingTime} 分钟</span>
        </>
      )}
    </div>
  )
}

export default function PostListItem({ post }: { post: PostListItemData }) {
  return (
    <Link to={`/posts/${post.slug}`} className="gh-list-item gh-post-row">
      <PostAvatar postId={post.id} title={post.title} />
      <div className="gh-list-item-content">
        <span className="gh-list-item-title">{post.title}</span>
        {post.excerpt && <p className="gh-list-item-excerpt">{post.excerpt}</p>}
        <Meta post={post} />
      </div>
    </Link>
  )
}

/** 首页最新一篇：特色大卡 */
export function PostFeaturedCard({ post }: { post: PostListItemData }) {
  return (
    <Link to={`/posts/${post.slug}`} className="gh-post-featured">
      <div className="gh-post-featured-top">
        <PostAvatar postId={post.id} title={post.title} size={44} />
        <span className="gh-post-featured-badge">最新</span>
      </div>
      <h3 className="gh-post-featured-title">{post.title}</h3>
      {post.excerpt && <p className="gh-post-featured-excerpt">{post.excerpt}</p>}
      <Meta post={post} />
    </Link>
  )
}
