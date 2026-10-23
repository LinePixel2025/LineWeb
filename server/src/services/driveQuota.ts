import prisma from '../lib/prisma.js'
import { roleHasCapability } from '../lib/permissions.js'

/**
 * 网盘空间配额服务
 *
 * 口径：
 *   - 「已用空间」= 本人上传的所有文件大小之和（不含文件夹，文件夹 size 恒为 0）
 *   - 具备 drive:all 能力的角色（目前为 admin）不限空间，quota / remaining 返回 null
 *   - 普通用户的 quota 来自 User.storageQuota（默认 2 GiB）
 *
 * BigInt 说明：DriveFile.size 与 User.storageQuota 都是 Prisma BigInt，
 * 本模块只返回 BigInt，JSON 序列化由路由层显式 String() 完成（BigInt 不能直接 JSON.stringify）。
 */

/** 统计某用户已使用的网盘空间（字节）；无文件时返回 0n */
export async function getDriveUsage(userId: number): Promise<bigint> {
  const result = await prisma.driveFile.aggregate({
    where: { uploadedById: userId, isFolder: false },
    _sum: { size: true },
  })
  return result._sum.size ?? 0n
}

export interface DriveQuotaInfo {
  /** 是否不限空间（drive:all 能力） */
  unlimited: boolean
  /** 空间上限（字节）；不限空间时为 null */
  quota: bigint | null
  /** 已用空间（字节） */
  used: bigint
  /** 剩余空间（字节）；不限空间时为 null，已超限时为 0n */
  remaining: bigint | null
}

/**
 * 取用户当前配额状态。
 * @param user 认证上下文中的 quota 相关字段（storageQuota 由认证中间件逐请求从 DB 解析）
 */
export async function getDriveQuota(user: {
  userId: number
  role: string
  storageQuota: bigint
}): Promise<DriveQuotaInfo> {
  const unlimited = roleHasCapability(user.role, 'drive:all')
  const used = await getDriveUsage(user.userId)

  if (unlimited) {
    return { unlimited: true, quota: null, used, remaining: null }
  }

  const quota = user.storageQuota
  const remaining = quota > used ? quota - used : 0n
  return { unlimited: false, quota, used, remaining }
}

/** 字节数 → 人类可读文案（用于 413 错误消息，如「网盘空间不足（剩余 1.5 GB）」） */
export function formatQuotaSize(bytes: bigint): string {
  if (bytes <= 0n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = Number(bytes)
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}
