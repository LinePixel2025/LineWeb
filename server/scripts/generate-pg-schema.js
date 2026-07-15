// server/scripts/generate-pg-schema.js
// Railway 部署时从 schema.prisma 生成 PostgreSQL 版本的 schema
// 保持 schema.prisma 为唯一真相来源（本地 SQLite + 部署 PG）
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const src = path.join(__dirname, '../prisma/schema.prisma')
const dst = path.join(__dirname, '../prisma/schema.generated.prisma')
const cfg = path.join(__dirname, '../prisma.config.ts')
const dedupSql = path.join(__dirname, '../prisma/dedup-storage-path.sql')
const cwd = path.join(__dirname, '..')
const env = { ...process.env, NODE_ENV: 'production' }
const baseSchema = fs.readFileSync(src, 'utf-8')

// 生成 prisma.config.ts（Prisma 7+ 要求）
const configTs = `
import { defineConfig } from 'prisma/config'

export default defineConfig({
  datasource: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
})
`
fs.writeFileSync(cfg, configTs)

// 步骤 1: 生成不含 @unique 的 PG schema → 先确保表结构和已存在数据没问题
let schemaNoUnique = baseSchema
  .replace('provider = "sqlite"', 'provider = "postgresql"')
  .replace(/\n\s*url\s*=\s*env\("DATABASE_URL"\)/g, '')
  .replace('storagePath  String   @unique', 'storagePath  String')
fs.writeFileSync(dst, schemaNoUnique)
console.log('✓ Step 1: Generated PG schema without unique constraint')

// 步骤 1.5: 预清理 api_keys 表
// 原因：新增 key_hash 字段为 @unique 必填，旧数据无此值无法保留
// 旧 API Key 仅存掩码（lw_xxx），无法反推原文计算 sha256，必须删除重建
const cleanupApiKeysSql = path.join(__dirname, '../prisma/cleanup-api-keys.sql')
fs.writeFileSync(cleanupApiKeysSql, 'DELETE FROM api_keys;')
try {
  execSync(`npx prisma db execute --schema prisma/schema.generated.prisma --file prisma/cleanup-api-keys.sql`, { cwd, env, stdio: 'inherit' })
  console.log('✓ Step 1.5: Cleared api_keys table (keyHash migration — old keys are invalid, users must recreate)')
} catch (_) {
  console.log('(api_keys table does not exist yet — fresh deploy, skipping cleanup)')
}
try { fs.unlinkSync(cleanupApiKeysSql) } catch {}

execSync(`npx prisma db push --schema prisma/schema.generated.prisma --accept-data-loss`, { cwd, env, stdio: 'inherit' })
console.log('✓ Step 1: Schema applied')

// 步骤 2: 清理重复 storagePath 记录
fs.writeFileSync(dedupSql, `DELETE FROM drive_files WHERE id NOT IN (SELECT MIN(id) FROM drive_files GROUP BY "storagePath");`)
try {
  execSync(`npx prisma db execute --schema prisma/schema.generated.prisma --file prisma/dedup-storage-path.sql`, { cwd, env, stdio: 'inherit' })
  console.log('✓ Step 2: Duplicate storagePath records cleaned')
} catch (_) {
  // 表不存在或列名可能为小写，尝试小写版本
  fs.writeFileSync(dedupSql, `DELETE FROM drive_files WHERE id NOT IN (SELECT MIN(id) FROM drive_files GROUP BY storagepath);`)
  try {
    execSync(`npx prisma db execute --schema prisma/schema.generated.prisma --file prisma/dedup-storage-path.sql`, { cwd, env, stdio: 'inherit' })
    console.log('✓ Step 2: Duplicate storagePath records cleaned (lowercase column)')
  } catch (_2) {
    console.log('(no duplicates or table empty)')
  }
}
try { fs.unlinkSync(dedupSql) } catch {}

// 步骤 3: 重新生成带 @unique 约束的 schema → db push 添加约束
let schemaWithUnique = baseSchema
  .replace('provider = "sqlite"', 'provider = "postgresql"')
  .replace(/\n\s*url\s*=\s*env\("DATABASE_URL"\)/g, '')
fs.writeFileSync(dst, schemaWithUnique)
console.log('✓ Step 3: Regenerated PG schema with unique constraint')

execSync(`npx prisma db push --schema prisma/schema.generated.prisma --accept-data-loss`, { cwd, env, stdio: 'inherit' })
console.log('✓ Step 3: Unique constraint applied')

// 步骤 4: 种子数据
execSync(`npx prisma db seed --schema prisma/schema.generated.prisma`, { cwd, env, stdio: 'inherit' })

// 清理临时文件
try { fs.unlinkSync(dst) } catch {}
try { fs.unlinkSync(cfg) } catch {}
console.log('✓ Database setup complete')
