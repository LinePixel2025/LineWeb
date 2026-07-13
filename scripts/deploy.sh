#!/bin/bash
set -e

LOG_FILE="/opt/lineweb/deploy.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "========================================"
echo "[deploy] $(date '+%Y-%m-%d %H:%M:%S')"
echo "[deploy] 开始自动部署..."

cd /opt/lineweb

echo "[deploy] 拉取最新代码..."
git pull origin master

echo "[deploy] 安装依赖..."
npm install

echo "[deploy] 同步数据库..."
cd server && npx prisma db push && cd ..

echo "[deploy] 重启服务..."
systemctl restart lineweb.service

echo "[deploy] 部署完成"
