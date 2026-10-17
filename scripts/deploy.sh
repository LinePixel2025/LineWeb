#!/bin/bash
# 阿里云 ECS 部署参考脚本（**待按新环境调整**，逻辑暂未改动）。
#
# 生产形态：ECS（Ubuntu）上 1Panel + Docker Compose 跑 Express(:3001) 容器
#   + PostgreSQL 16 容器（lineweb-postgres），client/dist 打进镜像；
#   代码目录 /opt/lineweb，公网入口 https://web.linetech.online（Cloudflare Tunnel）。
#   生产更新命令是 `docker compose up -d --build`（见 README），本脚本不是生产链路。
#
# ⚠️ 本脚本有三处与新环境不符，采用前必须调整：
#   1. 路径：`/www/wwwroot/lineweb` 是旧宝塔路径，应改为 /opt/lineweb。
#   2. 数据库：`generate-mysql-schema.js` 生成 MySQL schema，
#      而仓库现行数据库是 SQLite（约定只用 `prisma db push`），应改为
#      `npx prisma db push`（server/prisma/schema.prisma）。
#   3. 启动：末尾的 `docker compose up -d --build` 仅在改用容器时适用；
#      若改为 systemd 直接跑 Node/tsx，则不需要这一步，应改为重启服务单元。
set -e

LOG_FILE="/www/wwwroot/lineweb/deploy.log"   # TODO: 改为 /opt/lineweb/deploy.log
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
cd server && node scripts/generate-mysql-schema.js   # TODO: 与 SQLite 约定不符，应改为 npx prisma db push

# seed 仅首次执行（seed.ts 自带去重，不会重复插入）
npx prisma db seed --schema prisma/schema.mysql.generated.prisma 2>/dev/null || true

rm -f prisma/schema.mysql.generated.prisma
rm -f prisma.config.ts
cd ..

echo "[deploy] 重新构建并启动 Docker 容器..."
# TODO: 仅当 ECS 采用容器方式时保留；若 systemd 直接跑 Node/tsx 则改为重启服务单元，不需要此步
docker compose up -d --build

echo "[deploy] 部署完成"
