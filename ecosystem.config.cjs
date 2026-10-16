// PM2 生产常驻配置
// 用法：pm2 start ecosystem.config.cjs   （或 pm2 restart ecosystem.config.cjs 重启）
// 说明：本项目为单体内置生产服务（node dist/server.js），由 scripts/start.sh 启动。
// 必须先执行 pnpm build 生成 dist，再 pm2 启动。

module.exports = {
  apps: [
    {
      name: 'imageToolbox',
      cwd: __dirname,
      script: './dist/server.js',
      // 锁定当前 PATH 中实际使用的 node（避免 PM2 守护进程使用系统旧版 Node，要求 Node >= 20）
      interpreter: process.env.NODE_BIN || 'node',
      instances: 1,
      autorestart: true,          // 崩溃自动重启
      max_memory_restart: '600M', // 内存超限自动重启
      watch: false,               // 生产不监听文件，避免误重启
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 5000,
        DEPLOY_RUN_PORT: process.env.PORT || 5000,
      },
    },
  ],
};