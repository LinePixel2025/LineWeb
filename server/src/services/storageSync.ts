import prisma from '../lib/prisma.js'
import { listDirRecursive, sendCommand, isNodeConnected } from './storageTunnel.js'

export interface SyncReport {
  scanned: number
  dbRecords: number
  orphansRemoved: number
  missingCreated: number
  errors: string[]
  durationMs: number
}

/**
 * 执行一次网盘文件同步：
 * 1. 检查存储节点连接
 * 2. 递归列出节点上的所有路径（文件 + 文件夹）
 * 3. 对比数据库记录
 * 4. 清理孤立的数据库记录（节点上已不存在的文件或文件夹）
 * 5. 为节点上存在但数据库缺失的路径创建记录（upsert 幂等）
 */
export async function syncDriveFiles(): Promise<SyncReport> {
  const start = Date.now()
  const report: SyncReport = {
    scanned: 0,
    dbRecords: 0,
    orphansRemoved: 0,
    missingCreated: 0,
    errors: [],
    durationMs: 0,
  }

  if (!isNodeConnected()) {
    report.errors.push('存储节点未连接，跳过同步')
    report.durationMs = Date.now() - start
    return report
  }

  try {
    // 1. 递归列出存储节点所有路径（文件 + 文件夹）
    const nodePaths = await listDirRecursive('')
    // 排除隐藏的系统目录（如 _avatars/），这些不应出现在网盘中
    const filteredPaths = nodePaths.filter(p => p !== '_avatars' && !p.startsWith('_avatars/'))
    report.scanned = filteredPaths.length

    // 2. 获取数据库全部记录
    const dbRecords = await prisma.driveFile.findMany({
      select: { id: true, storagePath: true, name: true, isFolder: true },
    })
    report.dbRecords = dbRecords.length

    // 建立 storagePath → dbRecord 映射
    const dbPathMap = new Map(dbRecords.map(f => [f.storagePath, f]))

    // 3. 节点上的路径集合
    const nodePathSet = new Set(filteredPaths)

    // 4. 清理孤立记录：DB 有但节点上已经不存在的
    //    只有在 unique 约束下，每个 storagePath 才保证只有一条记录
    const orphans = dbRecords.filter(f => !nodePathSet.has(f.storagePath))
    if (orphans.length > 0) {
      const orphanIds = orphans.map(o => o.id)
      try {
        const deleteResult = await prisma.driveFile.deleteMany({
          where: { id: { in: orphanIds } }
        })
        report.orphansRemoved = deleteResult.count
        console.log(`[Sync] 批量删除 ${deleteResult.count} 条孤立记录`)
      } catch (err: unknown) {
        report.errors.push(`批量删除孤立记录失败: ${err instanceof Error ? err.message : String(err)}`)
        // 回退到逐条删除
        for (const orphan of orphans) {
          try {
            await prisma.driveFile.delete({ where: { id: orphan.id } })
            report.orphansRemoved++
            console.log(`[Sync] 删除孤立记录: ${orphan.name} (${orphan.storagePath})`)
          } catch (deleteErr: unknown) {
            report.errors.push(`删除孤立记录失败: ${orphan.storagePath} — ${deleteErr instanceof Error ? deleteErr.message : String(deleteErr)}`)
          }
        }
      }
    }

    // 5. 修复缺失记录：节点上有但 DB 中没有的路径（文件或文件夹）
    for (const nodePath of filteredPaths) {
      if (dbPathMap.has(nodePath)) continue

      try {
        const statResp = await sendCommand({ type: 'stat', path: nodePath })
        if (!statResp.success || !statResp.data) continue

        const info = statResp.data as { isFolder?: boolean; size?: number } | undefined
        if (!info) continue

        const parts = nodePath.split('/')
        const entryName = parts.pop() || nodePath
        const isFolder = !!info.isFolder

        // 查找父文件夹
        let parentId: number | null = null
        if (parts.length > 0) {
          const parentPath = parts.join('/')
          const parentFolder = await prisma.driveFile.findFirst({
            where: { storagePath: parentPath, isFolder: true },
          })
          if (parentFolder) {
            parentId = parentFolder.id
          } else {
            report.errors.push(`跳过 ${nodePath}: 父文件夹在数据库中不存在`)
            continue
          }
        }

        const uploader = await prisma.user.findFirst({
          where: { canAccessDrive: true },
          orderBy: { id: 'asc' },
          select: { id: true },
        })
        if (!uploader) {
          report.errors.push(`跳过 ${nodePath}: 未找到可用的上传者`)
          continue
        }

        // 使用 upsert 保证幂等：即使并发重复调用也不会创建重复记录
        // 由于 storagePath 已加 @unique 约束，create 本身也会在冲突时抛错
        // upsert 比 try-create + catch 更优雅
        await prisma.driveFile.upsert({
          where: { storagePath: nodePath },
          update: {
            // 节点上已有的文件，更新大小和类型（名称不变）
            size: BigInt(info.size || 0),
            mimeType: isFolder ? null : guessMimeType(entryName),
            isFolder,
            // 不更新 parentId — 可能在同步时已手工修复
          },
          create: {
            name: entryName,
            isFolder,
            parentId,
            size: BigInt(info.size || 0),
            mimeType: isFolder ? null : guessMimeType(entryName),
            storagePath: nodePath,
            uploadedById: uploader.id,
          },
        })
        report.missingCreated++
        console.log(`[Sync] 创建/更新缺失记录: ${entryName} (${nodePath})`)
      } catch (err: unknown) {
        report.errors.push(`修复缺失记录失败: ${nodePath} — ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } catch (err: unknown) {
    report.errors.push(`同步失败: ${err instanceof Error ? err.message : String(err)}`)
  }

  report.durationMs = Date.now() - start
  console.log(`[Sync] 完成: 扫描 ${report.scanned} 项, `
    + `删除 ${report.orphansRemoved} 孤立记录, `
    + `创建 ${report.missingCreated} 缺失记录, `
    + `${report.errors.length} 错误, 耗时 ${report.durationMs}ms`)

  return report
}

function guessMimeType(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    bmp: 'image/bmp', mp4: 'video/mp4', webm: 'video/webm',
    avi: 'video/x-msvideo', mov: 'video/quicktime', mkv: 'video/x-matroska',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    flac: 'audio/flac', pdf: 'application/pdf',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    zip: 'application/zip', rar: 'application/vnd.rar',
    '7z': 'application/x-7z-compressed', tar: 'application/x-tar',
    gz: 'application/gzip', js: 'text/javascript',
    ts: 'text/typescript', py: 'text/x-python',
    html: 'text/html', css: 'text/css',
    json: 'application/json', txt: 'text/plain',
    md: 'text/markdown',
  }
  return mimeMap[ext] || 'application/octet-stream'
}
