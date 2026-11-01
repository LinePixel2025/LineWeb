import prisma from '../lib/prisma.js'

const FTS_TABLE = 'drive_files_fts'

/**
 * 当前数据库是否支持 FTS5（只有 SQLite 有）。
 *
 * PostgreSQL 下所有 FTS 语句（`INSERT OR REPLACE`、`MATCH`、`rank`）都是非法 SQL，
 * 早期每次上传都会在 syncFTSIndex 里打一条 `syntax error at or near "OR"` 的报错，
 * 搜索也要先失败一次再回退 LIKE。因此这里在模块加载时判定一次，非 SQLite 一律跳过。
 */
const ftsSupported = (() => {
  const url = process.env.DATABASE_URL ?? ''
  return url.startsWith('file:') || url === '' || url.includes('sqlite')
})()

/**
 * 创建或确保 FTS5 虚拟表存在（SQLite only）
 * PostgreSQL 下自动跳过
 */
export async function ensureFTSTable(): Promise<boolean> {
  if (!ftsSupported) {
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
  if (!ftsSupported) return
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
  if (!ftsSupported) return
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

/** 搜索范围：private=我的网盘（默认），public=公共网盘 */
export type DriveSearchScope = 'private' | 'public'

/**
 * FTS5 搜索 — 使用 MATCH 语法，回退到 LIKE 查询
 * @param scope 过滤范围：public 只搜公共文件；private 只搜私有文件（管理员=全部私有，普通用户=仅本人）
 */
export async function searchFTS(
  query: string,
  isAdmin: boolean,
  userId: number,
  limit = 50,
  scope: DriveSearchScope = 'private',
): Promise<{ id: number; name: string; storagePath: string }[]> {
  if (ftsSupported) {
    try {
      // 先尝试 FTS5 搜索
      // SQLite 布尔列存 0/1；scope 决定 is_public 过滤，private 再叠加所有权过滤
      const results = await prisma.$queryRawUnsafe<
        { id: number; name: string; storagePath: string }[]
      >(
        `SELECT f.id, f.name, f.storagePath
         FROM ${FTS_TABLE} fts
         JOIN drive_files f ON f.id = fts.rowid
         WHERE ${FTS_TABLE} MATCH ?
         ${scope === 'public' ? 'AND f.is_public = 1' : 'AND f.is_public = 0'}
         ${!isAdmin && scope === 'private' ? 'AND f.uploaded_by_id = ?' : ''}
         ORDER BY rank
         LIMIT ?`,
        query,
        ...(!isAdmin && scope === 'private' ? [userId, limit] as const : [limit] as const)
      )
      return results
    } catch {
      // FTS5 失败（表不存在 / 语法错误等），回退到 LIKE 查询
      console.warn('[FTS] FTS5 search failed, falling back to LIKE')
    }
  }

  // LIKE 回退（PostgreSQL 或 FTS5 不可用时的唯一路径）
  const where: { name: { contains: string }; uploadedById?: number; isPublic: boolean } = {
    name: { contains: query },
    isPublic: scope === 'public',
  }
  if (!isAdmin && scope === 'private') where.uploadedById = userId
  const files = await prisma.driveFile.findMany({
    where,
    select: { id: true, name: true, storagePath: true },
    take: limit,
  })
  return files
}
