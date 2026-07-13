// server/scripts/generate-mysql-schema.js
// 从 schema.prisma 生成 MySQL 版本的 schema 并 push
// 本地开发用 SQLite，服务器部署用 MySQL
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const src = path.join(__dirname, '../prisma/schema.prisma')
const dst = path.join(__dirname, '../prisma/schema.mysql.generated.prisma')
const cwd = path.join(__dirname, '..')
const env = { ...process.env, NODE_ENV: 'production' }

let schema = fs.readFileSync(src, 'utf-8')

// 替换 provider: SQLite → MySQL
schema = schema.replace('provider = "sqlite"', 'provider = "mysql"')

// MySQL String 默认 VARCHAR(191)，长文本列需要显式指定 @db.Text
schema = schema.replace(/(content\s+String)/g, '$1 @db.Text')
schema = schema.replace(/(schema\s+String)/g, '$1 @db.Text')
schema = schema.replace(/(settings\s+String\?)/g, '$1 @db.Text')

fs.writeFileSync(dst, schema)
console.log('[mysql-schema] 已生成 MySQL schema')

try {
  execSync(`npx prisma db push --schema prisma/schema.mysql.generated.prisma --accept-data-loss`, { cwd, env, stdio: 'inherit' })
  console.log('[mysql-schema] Schema 同步完成')
} finally {
  try { fs.unlinkSync(dst) } catch {}
}

console.log('[mysql-schema] 完成')
