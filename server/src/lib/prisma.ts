import { PrismaClient } from '@prisma/client'

// PostgreSQL 生产环境连接池配置：避免连接耗尽
// 使用字符串操作而非 new URL() — 数据库密码可能含 @ : / # 等 URL 特殊字符，
// new URL() 无法正确处理，会导致连接字符串解析错误
function appendConnectionPoolParams(dbUrl: string): string {
  const poolSize = process.env.DATABASE_POOL_SIZE || '10'
  const poolTimeout = process.env.DATABASE_POOL_TIMEOUT || '30'
  const additions: string[] = []

  if (!dbUrl.includes('connection_limit=')) {
    additions.push(`connection_limit=${poolSize}`)
  }
  if (!dbUrl.includes('pool_timeout=')) {
    additions.push(`pool_timeout=${poolTimeout}`)
  }
  if (additions.length === 0) return dbUrl

  const sep = dbUrl.includes('?') ? '&' : '?'
  return `${dbUrl}${sep}${additions.join('&')}`
}

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
  ...(process.env.NODE_ENV === 'production' && process.env.DATABASE_URL?.startsWith('postgres')
    ? { datasourceUrl: appendConnectionPoolParams(process.env.DATABASE_URL!) }
    : {}),
})

export default prisma
