#!/bin/bash
# 阿里云 ECS 上以 tsx 直接启动服务端的参考脚本（非容器方式）。
# 代码目录默认 /opt/lineweb，可用环境变量 LINEWEB_ROOT 覆盖。
# 注意：ECS 上的最终运行方式（systemd 直接跑 vs Docker Compose）待确定，本脚本仅为参考。
set -e

cd "${LINEWEB_ROOT:-/opt/lineweb}"
export NODE_ENV=production

echo "[serve.sh] 启动服务 (端口 ${PORT:-3001})..."
npx tsx server/src/index.ts
