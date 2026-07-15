import { PrismaClient } from '@prisma/client'

// Prisma 7+: datasourceUrl 在构造函数中传递
// PostgreSQL 生产环境连接池配置：避免连接耗尽
const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
  ...(process.env.NODE_ENV === 'production' && process.env.DATABASE_URL?.startsWith('postgres') ? {
    datasourceUrl: (() => {
      const url = new URL(process.env.DATABASE_URL!)
      // 追加连接池参数（如果尚未设置）
      if (!url.searchParams.has('connection_limit')) {
        url.searchParams.set('connection_limit', process.env.DATABASE_POOL_SIZE || '10')
      }
      if (!url.searchParams.has('pool_timeout')) {
        url.searchParams.set('pool_timeout', process.env.DATABASE_POOL_TIMEOUT || '30')
      }
      return url.toString()
    })(),
  } : {}),
})

export default prisma
