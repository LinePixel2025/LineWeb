import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

// === API 响应类型 ===

interface PostsListItem {
  id: number
  title: string
  summary: string | null
  slug: string
  createdAt: string
  author: { username: string }
}

interface PostsListResponse {
  posts: PostsListItem[]
  total: number
  page: number
  totalPages: number
}

interface PostDetail {
  id: number
  title: string
  content: string
  summary: string | null
  slug: string
  createdAt: string
  updatedAt: string
  author: { username: string }
}

interface FeaturedPageItem {
  id: number
  title: string
  slug: string
  featureEmoji: string | null
  featureDesc: string | null
}

interface FeaturedPagesResponse {
  pages: FeaturedPageItem[]
}

interface PageSchema {
  id: number
  title: string
  slug: string
  schema: string
}

interface PublicStats {
  posts: number
  users: number
  comments: number
  pages: number
}

// === Hooks ===

export function usePostsList(page: number, sort?: string, search?: string, limit?: number) {
  return useQuery({
    queryKey: queryKeys.posts.list(page, sort, search, limit),
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page) })
      if (sort) params.set('sort', sort)
      if (search) params.set('search', search)
      if (limit) params.set('limit', String(limit))
      return api.get<PostsListResponse>(`/posts?${params}`)
    },
  })
}

export function usePost(slug: string | undefined) {
  return useQuery({
    queryKey: queryKeys.posts.detail(slug ?? ''),
    queryFn: () => api.get<PostDetail>(`/posts/${slug}`),
    enabled: !!slug,
  })
}

export function useComments(postId: number) {
  return useQuery({
    queryKey: queryKeys.comments.byPost(postId),
    queryFn: () => api.get<unknown[]>(`/comments/post/${postId}`),
  })
}

export function useFeaturedPages() {
  return useQuery({
    queryKey: queryKeys.pages.featured,
    queryFn: () => api.get<FeaturedPagesResponse>('/pages/featured'),
  })
}

export function usePageBySlug(slug: string | undefined) {
  return useQuery({
    queryKey: queryKeys.pages.bySlug(slug ?? ''),
    queryFn: () => api.get<PageSchema>(`/pages/slug/${slug}`),
    enabled: !!slug,
  })
}

export function usePublicStats() {
  return useQuery({
    queryKey: queryKeys.stats.public,
    queryFn: () => api.get<PublicStats>('/stats/public'),
    staleTime: 60_000,
  })
}

export function useWallpaperQuery() {
  return useQuery({
    queryKey: queryKeys.wallpaper,
    queryFn: () => api.get<unknown>('/bing-wallpaper'),
    staleTime: 60 * 60 * 1000,
  })
}

export function useScreenTime() {
  return useQuery({
    queryKey: queryKeys.health.screenTime,
    queryFn: () => api.get<unknown>('/health/screen-time'),
  })
}

export function useDriveFiles(parentId: number | null, page: number) {
  return useQuery({
    queryKey: queryKeys.drive.files(parentId, page),
    queryFn: () => api.get<unknown>(`/drive/files?parentId=${parentId ?? ''}&page=${page}`),
  })
}
