#!/usr/bin/env bash
# 服务器端部署：备份当前版本 -> 构建 -> 重启 -> 测试，失败自动回滚。
set -euo pipefail

cd "$(dirname "$0")/.."
BASE="$(pwd)"
TS="$(date +%Y%m%d%H%M%S)"
RELEASE_DIR="$BASE/releases"
BACKUP="$RELEASE_DIR/backup-$TS"

mkdir -p "$RELEASE_DIR"
echo "[server-deploy] backup -> $BACKUP"
tar --exclude=node_modules --exclude=uploads --exclude=releases --exclude=.env \
  --exclude=.git --exclude=.npm-cache --exclude=server_output.log \
  -cf - . | (mkdir -p "$BACKUP" && tar -xf - -C "$BACKUP")

if [ "${1:-}" = "--install" ]; then
  echo "[server-deploy] install dependencies"
  npm ci --omit=dev
  (cd frontend && npm ci)
fi

echo "[server-deploy] build frontend"
(cd frontend && npm run build)

echo "[server-deploy] restart"
export PATH="$PATH:$(npm config get prefix)/bin"
pm2 restart blowing-machine

echo "[server-deploy] wait for health"
for i in $(seq 1 30); do
  if curl -fs --max-time 3 "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "[server-deploy] tests"
if ! node test-api.js; then
  echo "[server-deploy] tests failed, rolling back"
  tar -C "$BACKUP" -cf - . | tar -C "$BASE" -xf -
  pm2 restart blowing-machine
  exit 1
fi

echo "[server-deploy] OK (backup: $BACKUP)"
