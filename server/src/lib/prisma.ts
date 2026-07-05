import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export default prisma

// 注：BigInt 序列化由各路由显式转换（drive.ts 的 transformSize），
// 不再全局污染 BigInt.prototype.toJSON。
