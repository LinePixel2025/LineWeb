export const queryKeys = {
  posts: {
    all: ['posts'] as const,
    list: (page: number, sort?: string, search?: string, limit?: number) => ['posts', 'list', page, sort, search, limit] as const,
    detail: (slug: string) => ['posts', 'detail', slug] as const,
  },
  comments: {
    byPost: (postId: number) => ['comments', 'post', postId] as const,
  },
  pages: {
    featured: ['pages', 'featured'] as const,
    bySlug: (slug: string) => ['pages', 'slug', slug] as const,
  },
  stats: {
    public: ['stats', 'public'] as const,
  },
  drive: {
    files: (parentId: number | null, page: number) => ['drive', 'files', parentId, page] as const,
  },
  health: {
    screenTime: ['health', 'screenTime'] as const,
  },
}
