// PM2 备选方案 —— 在阿里云 ECS 上「不用容器、直接跑 Node/tsx」时可用。
// 生产主线是 1Panel + Docker Compose（Express 容器 + PostgreSQL 16 容器，见 docker-compose.yml）；
// 本文件与 systemd 直跑 tsx 都只是备选路径，生产不使用。
// 项目根目录：ECS 上为 /opt/lineweb（旧宝塔路径 /www/wwwroot/lineweb 已废弃）。

module.exports = {
  apps: [
    {
      name: 'lineweb',
      script: 'npx',
      args: 'tsx server/src/index.ts',
      cwd: '/opt/lineweb',  // ECS 上的代码目录（旧宝塔路径 /www/wwwroot/lineweb 已废弃）
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        DATABASE_URL: '<从 server/.env 复制>',
        JWT_SECRET: '<从 server/.env 复制>',
        CORS_ORIGIN: '',
        STORAGE_NODE_TOKEN: '<从 server/.env 复制>',
        MAX_FILE_SIZE_MB: '10240',
      },
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '500M',
      restart_delay: 5000,
      max_restarts: 10,
    },
    {
      name: 'lineweb-webhook',
      script: 'scripts/webhook-server.mjs',
      cwd: '/opt/lineweb',  // ECS 上的代码目录（旧宝塔路径 /www/wwwroot/lineweb 已废弃）
      env: {
        WEBHOOK_PORT: '9000',
        WEBHOOK_SECRET: '<替换为你的 Webhook Secret>',
      },
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
    },
  ],
}
