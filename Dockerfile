# ============================================================
# LineWeb Docker 镜像 — 多阶段构建
# Stage 1: 构建前端 (Vite → client/dist)
# Stage 2: 运行后端 (Express + WebSocket + 静态文件托管)
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
