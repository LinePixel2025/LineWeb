#!/bin/bash
set -e

cd /opt/lineweb
export NODE_ENV=production

echo "[serve.sh] 启动服务 (端口 ${PORT:-3001})..."
npx tsx server/src/index.ts
