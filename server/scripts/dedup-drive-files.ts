/**
 * 一次性去重脚本：清理 DriveFile 中重复的 storagePath 记录
 * 在 prisma db push 添加 @unique 约束前运行
 *
 * 用法: cd server && npx tsx scripts/dedup-drive-files.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('正在检查 DriveFile 重复记录...')

  const duplicates = await prisma.$queryRawUnsafe<Array<{ storagePath: string; cnt: bigint }>>(
    `SELECT "storagePath", COUNT(*) AS cnt
     FROM drive_files
     GROUP BY "storagePath"
     HAVING COUNT(*) > 1`
  )

  if (duplicates.length === 0) {
    console.log('✓ 未发现重复记录')
    return
  }

  console.log(`发现 ${duplicates.length} 组重复记录，正在清理...`)

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

  console.log(`✓ 已清理 ${totalRemoved} 条重复记录`)
}

main()
  .catch(e => console.error('去重失败:', e))
  .finally(() => prisma.$disconnect())
