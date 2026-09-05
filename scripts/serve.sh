#!/bin/bash
# ⚠️ 已废弃（2026-09）：旧云服务器（宝塔 /www/wwwroot）部署脚本，仅存档。
# 现部署方式：本地 Windows + Cloudflare Tunnel，见 README「部署」章节。
set -e

cd /www/wwwroot/lineweb
export NODE_ENV=production

echo "[serve.sh] 启动服务 (端口 ${PORT:-3001})..."
npx tsx server/src/index.ts
