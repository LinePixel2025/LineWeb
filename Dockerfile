# ============================================================
# LineWeb Docker 镜像 — 多阶段构建
# Stage 1: 构建前端 (Vite → client/dist)
# Stage 2: 运行后端 (Express + WebSocket + 静态文件托管)
#
# 用途：阿里云 ECS（Ubuntu）生产部署（**生产使用**）。
#   线上由 1Panel v2.3.2 + Docker Compose 编排本镜像（见 docker-compose.yml）：
#   Express 容器 lineweb-server-1 (:3001) + PostgreSQL 16 容器 lineweb-postgres，
#   代码位于 /opt/lineweb，端口 3001:3001，restart: unless-stopped，自带健康检查。
#
# 数据库：生产是 PostgreSQL 16。server/scripts/docker-entrypoint.sh 会在容器启动时
#   把 SQLite schema 改写为 PostgreSQL（prisma/schema.pg.prisma），随后执行
#   prisma db push（首次带 --accept-data-loss）与 prisma db seed —— 这是生产链路
#   的一部分，不是备选机制；生产 .env 的 DATABASE_URL 指向 lineweb-postgres:5432。
#
# 注意：该 ECS 直连 Docker Hub 会超时，构建前需在 /etc/docker/daemon.json 配置
#   国内镜像加速（docker.1panel.live、docker.m.daocloud.io、docker.1ms.run）。
# ============================================================

# ---- Stage 1: 构建前端 ----
FROM node:22-alpine AS client-build
WORKDIR /app/client

# 利用 Docker 层缓存：先安装依赖
COPY client/package.json client/package-lock.json ./
RUN npm ci && npm cache clean --force

# 复制源码并构建
COPY client/ ./
RUN npx vite build


# ---- Stage 2: 最终运行镜像 ----
FROM node:22-alpine
WORKDIR /app/server

# bash: entrypoint 脚本依赖
RUN apk add --no-cache bash

# 安装 server 生产依赖（tsx + prisma CLI 均在 dependencies 中）
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 复制 server 源码、Prisma schema、脚本
COPY server/ ./

# 复制前端构建产物（供 Express 在生产模式下 serve）
COPY --from=client-build /app/client/dist /app/client/dist

# 入口脚本
COPY server/scripts/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3001

ENTRYPOINT ["docker-entrypoint.sh"]
