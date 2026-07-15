#!/bin/bash
set -e

LOG_FILE="/www/wwwroot/lineweb/deploy.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "========================================"
echo "[deploy] $(date '+%Y-%m-%d %H:%M:%S')"
echo "[deploy] 开始自动部署..."

cd /www/wwwroot/lineweb

echo "[deploy] 拉取最新代码..."
git fetch origin master
git reset --hard origin/master

echo "[deploy] 安装依赖..."
npm install

echo "[deploy] 构建前端..."
npm run build

echo "[deploy] 同步数据库..."
cd server && node scripts/generate-mysql-schema.js

# seed 仅首次执行（seed.ts 自带去重，不会重复插入）
npx prisma db seed --schema prisma/schema.mysql.generated.prisma 2>/dev/null || true

rm -f prisma/schema.mysql.generated.prisma
rm -f prisma.config.ts
cd ..

echo "[deploy] 重新构建并启动 Docker 容器..."
docker compose up -d --build

echo "[deploy] 部署完成"
