// server/scripts/generate-pg-schema.js
// Railway 部署时从 schema.prisma 生成 PostgreSQL 版本的 schema
// 保持 schema.prisma 为唯一真相来源（本地 SQLite + 部署 PG）
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const src = path.join(__dirname, '../prisma/schema.prisma')
const dst = path.join(__dirname, '../prisma/schema.generated.prisma')

let content = fs.readFileSync(src, 'utf-8')
content = content.replace('provider = "sqlite"', 'provider = "postgresql"')
fs.writeFileSync(dst, content)
console.log('✓ Generated schema.generated.prisma (PostgreSQL)')

const cwd = path.join(__dirname, '..')
const env = { ...process.env, NODE_ENV: 'production' }

// db push 自动触发 generate，无需单独调用
execSync(`npx prisma db push --schema prisma/schema.generated.prisma --accept-data-loss`, { cwd, env, stdio: 'inherit' })
execSync(`npx prisma db seed --schema prisma/schema.generated.prisma`, { cwd, env, stdio: 'inherit' })

// 清理临时文件
try { fs.unlinkSync(dst) } catch {}
console.log('✓ Database setup complete')
