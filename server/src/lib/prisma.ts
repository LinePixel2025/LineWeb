import { PrismaClient } from '@prisma/client'

// Prisma 7+: datasourceUrl 在构造函数中传递
const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
})

export default prisma
