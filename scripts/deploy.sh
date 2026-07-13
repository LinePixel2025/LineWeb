#!/bin/bash
set -e

LOG_FILE="/www/wwwroot/lineweb/deploy.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "========================================"
echo "[deploy] $(date '+%Y-%m-%d %H:%M:%S')"
echo "[deploy] 开始自动部署..."

cd /www/wwwroot/lineweb

echo "[deploy] 拉取最新代码..."
git pull

echo "[deploy] 安装依赖..."
npm install

echo "[deploy] 构建前端..."
npm run build

echo "[deploy] 同步数据库..."
cd server && node scripts/generate-mysql-schema.js && cd ..

echo "[deploy] 重启服务..."
pm2 restart lineweb

echo "[deploy] 部署完成"
