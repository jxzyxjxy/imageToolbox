#!/bin/bash
# 图片工具箱：生产构建 + PM2 常驻 一键部署脚本
# 用法：bash deploy.sh   （可选：PORT=3000 bash deploy.sh 指定端口）
set -Eeuo pipefail

APP_NAME="imageToolbox"
cd "$(dirname "$0")"
export COZE_WORKSPACE_PATH="$(pwd)"
PORT="${PORT:-5000}"
export PORT
export DEPLOY_RUN_PORT="${PORT}"

echo "==> 1/3 安装依赖 (pnpm)"
pnpm install

echo "==> 2/3 生产构建 (pnpm build)"
pnpm build

echo "==> 3/3 PM2 常驻重启"
pm2 delete "${APP_NAME}" >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs  # 端口与环境经 ecosystem env 块注入，勿加 --env（该参数需带值）

echo "==> 保存 PM2 进程表（断电/重启后可用 pm2 resurrect 恢复）"
pm2 save || true

# 探活
sleep 3
URL="http://localhost:${PORT}"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "${URL}" || echo 'failed')"
echo "==> 探活 ${URL} -> HTTP ${CODE}"
pm2 status "${APP_NAME}"
if [[ "${CODE}" == "200" ]]; then
  echo "✅ 部署完成，访问：${URL}"
else
  echo "⚠️ 探活未返回 200（${CODE}），请检查 pm2 logs ${APP_NAME}"
fi