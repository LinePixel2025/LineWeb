// server/scripts/generate-pg-schema.js
// Railway 部署时从 schema.prisma 生成 PostgreSQL 版本的 schema
// 保持 schema.prisma 为唯一真相来源（本地 SQLite + 部署 PG）
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const src = path.join(__dirname, '../prisma/schema.prisma')
const dst = path.join(__dirname, '../prisma/schema.generated.prisma')
const dedupSql = path.join(__dirname, '../prisma/dedup-storage-path.sql')
const cwd = path.join(__dirname, '..')
const env = { ...process.env, NODE_ENV: 'production' }
const baseSchema = fs.readFileSync(src, 'utf-8')

// 步骤 1: 生成不含 @unique 的 PG schema → 先确保表结构和已存在数据没问题
let schemaNoUnique = baseSchema
  .replace('provider = "sqlite"', 'provider = "postgresql"')
  .replace('storagePath  String   @unique', 'storagePath  String')
fs.writeFileSync(dst, schemaNoUnique)
console.log('✓ Step 1: Generated PG schema without unique constraint')

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
fs.writeFileSync(dst, schemaWithUnique)
console.log('✓ Step 3: Regenerated PG schema with unique constraint')

execSync(`npx prisma db push --schema prisma/schema.generated.prisma --accept-data-loss`, { cwd, env, stdio: 'inherit' })
console.log('✓ Step 3: Unique constraint applied')

// 步骤 4: 种子数据
execSync(`npx prisma db seed --schema prisma/schema.generated.prisma`, { cwd, env, stdio: 'inherit' })

// 清理临时文件
try { fs.unlinkSync(dst) } catch {}
console.log('✓ Database setup complete')
