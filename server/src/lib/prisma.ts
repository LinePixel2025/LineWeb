import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export default prisma

/* ---------- BigInt 序列化 ----------
 * Prisma 返回的 size (BigInt) 需要被 res.json 序列化。
 * 放在这里确保所有路由共享此序列化器。
 * 对于超过 Number.MAX_SAFE_INTEGER (≈9PB) 的大文件，
 * 先将 BigInt 转为字符串以避免精度丢失。*/
const BIGINT_SAFE = BigInt(Number.MAX_SAFE_INTEGER)
const BIGINT_MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER)
BigInt.prototype.toJSON = function (this: bigint) {
  if (this > BIGINT_SAFE || this < BIGINT_MIN_SAFE) {
    return String(this)
  }
  return Number(this)
}

declare global {
  interface BigInt {
    toJSON(): number | string
  }
}

export {} // 确保 BigInt.prototype 扩展生效
