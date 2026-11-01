import prisma from '../lib/prisma.js'
import { roleHasCapability } from '../lib/permissions.js'

/**
 * 网盘空间配额服务
 *
 * 口径（全站统一）：
 *   - 「已用空间」= 网盘文件大小之和 + 聊天图片占用 + 该用户上传的 AI 对话图片大小之和 + 书籍文件之和
 *     · 网盘文件：DriveFile.size（不含文件夹，文件夹 size 恒为 0；公共网盘文件由管理员维护，不计入任何个人配额）
 *     · 聊天图片：ChatUpload.size（自建聊天 2026-10 起按「上传」计费，含表情收藏；
 *       撤回最后一处引用时删除文件并释放）+ 旧存档 Message.imageSize（仅统计
 *       type='image' 且未撤回的存量行，新消息不再写 imageSize 以免与 ChatUpload 重复计费）
 *     · AI 对话图片：AiChatImage.size（含待发送附件，附件清理后自动释放）
 *     · 书籍：Book.size（小说阅读器上传的 EPUB/TXT；封面体积小、不计入）
 *   - 具备 drive:all 能力的角色（目前为 admin）不限空间，quota / remaining 返回 null
 *   - 普通用户的 quota 来自 User.storageQuota（默认 2 GiB）
 *
 * BigInt 说明：DriveFile.size、Message.imageSize 与 User.storageQuota 都是 Prisma BigInt，
 * 本模块只返回 BigInt，JSON 序列化由路由层显式 String() 完成（BigInt 不能直接 JSON.stringify）。
 */

/** 统计某用户已使用的空间（字节）= 网盘文件 + 聊天图片 + AI 对话图片 + 书籍；无记录时返回 0n */
export async function getDriveUsage(userId: number): Promise<bigint> {
  const [fileUsage, chatUploadUsage, legacyChatImageUsage, aiImageUsage, bookUsage] = await Promise.all([
    prisma.driveFile.aggregate({
      where: { uploadedById: userId, isFolder: false, isPublic: false },
      _sum: { size: true },
    }),
    prisma.chatUpload.aggregate({
      where: { ownerId: userId },
      _sum: { size: true },
    }),
    prisma.message.aggregate({
      where: {
        senderId: userId,
        type: 'image',
        recalledAt: null, // 已撤回的图片不再占用配额
        imageSize: { not: null },
      },
      _sum: { imageSize: true },
    }),
    prisma.aiChatImage.aggregate({
      where: { userId },
      _sum: { size: true },
    }),
    prisma.book.aggregate({
      where: { userId },
      _sum: { size: true },
    }),
  ])
  return (fileUsage._sum.size ?? 0n)
    + BigInt(chatUploadUsage._sum.size ?? 0)
    + (legacyChatImageUsage._sum.imageSize ?? 0n)
    + BigInt(aiImageUsage._sum.size ?? 0)
    + BigInt(bookUsage._sum.size ?? 0)
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
