import prisma from '../lib/prisma.js'

/**
 * 清理 DriveFile 表中的重复记录（按 storagePath 去重）
 * 保留最早创建的记录，删除其他重复项
 * 启动时运行，确保在添加 unique 约束前数据干净
 */
export async function deduplicateDriveFiles(): Promise<number> {
  const duplicates = await prisma.$queryRawUnsafe<Array<{ storagePath: string; cnt: bigint }>>(
    `SELECT "storagePath" AS "storagePath", COUNT(*) AS cnt
     FROM drive_files
     GROUP BY "storagePath"
     HAVING COUNT(*) > 1`
  )

  if (duplicates.length === 0) return 0

  let totalRemoved = 0
  for (const dup of duplicates) {
    const records = await prisma.driveFile.findMany({
      where: { storagePath: dup.storagePath },
      orderBy: { id: 'asc' },
      select: { id: true, isFolder: true },
    })
    if (records.length <= 1) continue

    const [keeper, ...toDelete] = records

    for (const record of toDelete) {
      // 如果是文件夹且有子文件，先将子文件转移到保留记录
      if (record.isFolder) {
        await prisma.driveFile.updateMany({
          where: { parentId: record.id },
          data: { parentId: keeper.id },
        })
      }
      await prisma.driveFile.delete({ where: { id: record.id } })
      totalRemoved++
    }
  }

  return totalRemoved
}
