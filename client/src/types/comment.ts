export interface CommentAuthor {
  id: number
  username: string
}

/** 树状评论（用于公开端点和管理端点） */
export interface CommentData {
  id: number
  content: string
  createdAt: string
  updatedAt?: string
  parentId: number | null
  author: CommentAuthor
  replies: CommentData[]
}
