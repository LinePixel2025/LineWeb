#!/bin/bash
set -e

cd /opt/lineweb
export NODE_ENV=production

echo "[serve.sh] 构建前端..."
cd client && npx vite build && cd ..

echo "[serve.sh] 同步数据库..."
cd server && npx prisma db push && cd ..

echo "[serve.sh] 启动服务 (端口 ${PORT:-3001})..."
npx tsx server/src/index.ts
