// PM2 配置文件
// 宝塔面板: 软件商店 → PM2管理器 → 添加项目 → 选择此文件

module.exports = {
  apps: [
    {
      name: 'lineweb',
      script: 'npx',
      args: 'tsx server/src/index.ts',
      cwd: '/www/wwwroot/lineweb',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
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
      cwd: '/www/wwwroot/lineweb',
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
