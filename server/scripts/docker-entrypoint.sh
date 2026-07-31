#!/bin/bash
# ============================================================
# LineWeb Docker 入口脚本（适配 1Panel 外部 PostgreSQL）
# 1. 从 DATABASE_URL 解析 host:port → 等待数据库就绪
# 2. 首次运行: 转换 SQLite schema → PostgreSQL → db push → seed
# 3. 启动 Express 服务器
# ============================================================
set -e

echo "=== LineWeb Docker Entrypoint ==="
echo ""

# ---- 等待数据库就绪 ----
# 用 Node.js 内置 net 模块检测端口，无需额外依赖
echo "⏳ 等待数据库就绪..."
DB_HOST="${DATABASE_URL#*@}"
DB_HOST="${DB_HOST%%:*}"
DB_PORT="${DATABASE_URL##*:}"
DB_PORT="${DB_PORT%%/*}"

until node -e "
  const net = require('net');
  const s = net.createConnection(${DB_PORT:-5432}, '${DB_HOST:-host.docker.internal}');
  s.on('connect', () => { s.end(); process.exit(0); });
  s.on('error', () => { s.destroy(); process.exit(1); });
  setTimeout(() => process.exit(1), 3000);
" 2>/dev/null; do
  sleep 2
done
echo "✅ 数据库已就绪"
echo ""

# ---- Schema 转换（SQLite → PostgreSQL） ----
# PostgreSQL TEXT 类型无长度限制，无需 @db.Text 等额外注解
prepare_pg_schema() {
  node -e "
    const fs = require('fs');
    let s = fs.readFileSync('prisma/schema.prisma', 'utf-8');
    s = s.replace('provider = \"sqlite\"', 'provider = \"postgresql\"');
    fs.writeFileSync('prisma/schema.pg.prisma', s);
    console.log('  📄 PostgreSQL schema 已生成');
  "
  # 删除遗留的 prisma.config.ts（否则 Prisma 会忽略 schema 中的 url）
  rm -f prisma.config.ts
}

# ---- 数据库初始化 ----
INIT_FLAG="/var/lib/lineweb/.db-initialized"
mkdir -p "$(dirname "$INIT_FLAG")"

if [ ! -f "$INIT_FLAG" ]; then
  echo "🔧 首次运行 — 初始化数据库..."

  prepare_pg_schema

  # 首次运行: 空数据库，安全使用 --accept-data-loss
  npx prisma db push --schema=prisma/schema.pg.prisma --accept-data-loss
  echo "  📊 Schema 同步完成"

  # 种子数据（seed.ts 自带去重检查，重复运行安全）
  npx prisma db seed
  echo "  🌱 种子数据已填充"

  touch "$INIT_FLAG"
  echo "✅ 数据库初始化完成"
else
  echo "✅ 数据库已初始化，同步最新 schema..."

  prepare_pg_schema

  # 后续启动: 不带 --accept-data-loss，保护已有数据
  npx prisma db push --schema=prisma/schema.pg.prisma
  echo "  📊 Schema 同步完成"
fi

# 清理临时文件
rm -f prisma/schema.pg.prisma

echo ""
echo "🚀 启动 LineWeb Server (端口 ${PORT:-3001})..."
echo ""

# 启动 Express 服务器（tsx 运行时）
exec npx tsx src/index.ts
