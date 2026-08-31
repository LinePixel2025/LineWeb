import prisma from '../lib/prisma.js'
import { parsePagination, parseId } from '../lib/utils.js'
import { buildExcerpt, calcReadingTime } from '../lib/textStats.js'
import type { Prisma } from '@prisma/client'

export interface PostCreateInput {
  title: string
  content: string
  summary?: string
  slug: string
  published?: boolean
}

export interface PostUpdateInput {
  title?: string
  content?: string
  summary?: string
  slug?: string
  published?: boolean
}

export interface PaginatedPosts {
  posts: unknown[]
  total: number
  page: number
  limit: number
  totalPages: number
}

// 列表查询：content 仅用于服务端计算 excerpt/readingTime，不返回给客户端
const postSelectPublic = {
  id: true,
  title: true,
  summary: true,
  slug: true,
  createdAt: true,
  updatedAt: true,
  content: true,
  author: { select: { username: true } },
} satisfies Prisma.PostSelect

const postSelectFull = {
  id: true,
  title: true,
  content: true,
  summary: true,
  slug: true,
  published: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PostSelect

/**
 * 获取已发布的文章列表（公开）
 */
export async function getPublishedPosts(
  page: number,
  limit: number,
  skip: number,
  sort: 'asc' | 'desc' = 'desc',
  search?: string,
): Promise<PaginatedPosts> {
  const where: Prisma.PostWhereInput = {
    published: true,
    ...(search ? { title: { contains: search } } : {}),
  }

  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      where,
      select: postSelectPublic,
      orderBy: { createdAt: sort },
      skip,
      take: limit,
    }),
    prisma.post.count({ where }),
  ])

  const mapped = posts.map(({ content, ...rest }) => ({
    ...rest,
    excerpt: buildExcerpt(rest.summary, content),
    readingTime: calcReadingTime(content),
  }))

  return { posts: mapped, total, page, limit, totalPages: Math.ceil(total / limit) }
}

/**
 * 按 slug 获取已发布文章
 */
export async function getPublishedPostBySlug(slug: string) {
  return prisma.post.findUnique({
    where: { slug, published: true },
    select: {
      id: true,
      title: true,
      content: true,
      summary: true,
      slug: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { username: true } },
    },
  })
}

/**
 * 获取所有文章（管理员，含草稿）
 */
export async function getAllPosts(
  page: number,
  limit: number,
  skip: number,
): Promise<PaginatedPosts> {
  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      select: {
        id: true, title: true, summary: true, slug: true,
        published: true, createdAt: true, updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.post.count(),
  ])

  return { posts, total, page, limit, totalPages: Math.ceil(total / limit) }
}

/**
 * 按 ID 获取文章（管理员视图）
 */
export async function getPostById(id: number) {
  return prisma.post.findUnique({
    where: { id },
    select: postSelectFull,
  })
}

/**
 * 创建文章
 */
export async function createPost(data: PostCreateInput, authorId: number) {
  return prisma.post.create({
    data: { ...data, authorId },
  })
}

/**
 * 更新文章
 */
export async function updatePost(id: number, data: PostUpdateInput) {
  return prisma.post.update({
    where: { id },
    data,
  })
}

/**
 * 删除文章
 */
export async function deletePost(id: number) {
  await prisma.post.delete({ where: { id } })
}

/**
 * 检查 slug 是否已被使用
 */
export async function isSlugTaken(slug: string, excludeId?: number): Promise<boolean> {
  const existing = await prisma.post.findFirst({
    where: excludeId ? { slug, NOT: { id: excludeId } } : { slug },
  })
  return !!existing
}
