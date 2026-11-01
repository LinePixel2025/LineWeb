/**
 * 小说阅读器类型（与服务端 /api/reader 契约保持一致，见 docs/reader-api.md）
 */

/** 书籍格式（服务端 detectBookFormat 白名单） */
export type BookFormat = 'epub' | 'txt'

/** 阅读进度（epub 的 location 为 foliate CFI；txt 为 {chapter,offset} JSON 字符串） */
export interface BookProgressDto {
  /** 位置标识：epub CFI 或 txt {chapter,offset} JSON */
  location: string
  /** 全书进度 0–1 */
  percent: number
  updatedAt: string
}

/** 书架条目（GET /api/reader/books） */
export interface BookDto {
  id: number
  title: string
  author: string
  format: BookFormat
  /** 文件字节数 */
  size: number
  /** 是否有封面（GET /api/reader/books/:id/cover） */
  hasCover: boolean
  createdAt: string
  updatedAt: string
  progress: BookProgressDto | null
}

export interface ReaderBooksResponse {
  books: BookDto[]
}

export interface BookUploadResponse {
  book: BookDto
}

/** TXT 进度在 location 字段里的载体 */
export interface TxtLocation {
  chapter: number
  /** 章节内滚动偏移 0–1 */
  offset: number
}
