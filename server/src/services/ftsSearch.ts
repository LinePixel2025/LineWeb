import prisma from '../lib/prisma.js'

const FTS_TABLE = 'drive_files_fts'

/**
 * 创建或确保 FTS5 虚拟表存在（SQLite only）
 * PostgreSQL 下自动跳过
 */
export async function ensureFTSTable(): Promise<boolean> {
  // 检测数据库类型 — 仅 SQLite 支持 FTS5
  const isSQLite = process.env.DATABASE_URL?.startsWith('file:') ||
    process.env.DATABASE_URL === '' ||
    !process.env.DATABASE_URL ||
    process.env.DATABASE_URL?.includes('sqlite')

  if (!isSQLite) {
    console.log('[FTS] PostgreSQL detected, skipping FTS5 setup')
    return false
  }

  try {
    // 检查 FTS5 表是否已存在
    const checkResult = await prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      FTS_TABLE
    )
    if (checkResult.length > 0) return true

    // 创建 FTS5 虚拟表（content 表引用 drive_files）
    await prisma.$executeRawUnsafe(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE} USING fts5(
        name, storagePath,
        content='drive_files',
        content_rowid='id',
        tokenize='unicode61'
      )`
    )

    // 初始同步：从 drive_files 插入现有数据
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${FTS_TABLE}(rowid, name, storagePath)
       SELECT id, name, storagePath FROM drive_files`
    )

    console.log('[FTS] FTS5 table created and populated')
    return true
  } catch (err) {
    console.error('[FTS] Failed to create FTS5 table:', err)
    return false
  }
}

/**
 * 增量同步：为指定文件更新 FTS 索引
 */
export async function syncFTSIndex(fileIds: number[]): Promise<void> {
  try {
    const files = await prisma.driveFile.findMany({
      where: { id: { in: fileIds } },
      select: { id: true, name: true, storagePath: true },
    })
    for (const file of files) {
      await prisma.$executeRawUnsafe(
        `INSERT OR REPLACE INTO ${FTS_TABLE}(rowid, name, storagePath)
         VALUES (?, ?, ?)`,
        file.id, file.name, file.storagePath
      )
    }
  } catch (err) {
    console.error('[FTS] Sync failed:', err)
  }
}

/**
 * 删除 FTS 索引条目
 */
export async function deleteFTSIndex(fileIds: number[]): Promise<void> {
  try {
    for (const id of fileIds) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM ${FTS_TABLE} WHERE rowid = ?`, id
      )
    }
  } catch (err) {
    console.error('[FTS] Delete failed:', err)
  }
}

/**
 * FTS5 搜索 — 使用 MATCH 语法，回退到 LIKE 查询
 */
export async function searchFTS(
  query: string,
  isAdmin: boolean,
  userId: number,
  limit = 50,
): Promise<{ id: number; name: string; storagePath: string }[]> {
  try {
    // 先尝试 FTS5 搜索
    const results = await prisma.$queryRawUnsafe<
      { id: number; name: string; storagePath: string }[]
    >(
      `SELECT f.id, f.name, f.storagePath
       FROM ${FTS_TABLE} fts
       JOIN drive_files f ON f.id = fts.rowid
       WHERE ${FTS_TABLE} MATCH ?
       ${isAdmin ? '' : 'AND f.uploaded_by_id = ?'}
       ORDER BY rank
       LIMIT ?`,
      query,
      ...(isAdmin ? [limit] as const : [userId, limit] as const)
    )
    return results
  } catch {
    // FTS5 失败（表不存在 / 语法错误等），回退到 LIKE 查询
    console.warn('[FTS] FTS5 search failed, falling back to LIKE')
    const where: { name: { contains: string }; uploadedById?: number } = {
      name: { contains: query },
    }
    if (!isAdmin) where.uploadedById = userId
    const files = await prisma.driveFile.findMany({
      where,
      select: { id: true, name: true, storagePath: true },
      take: limit,
    })
    return files
  }
}
