#!/usr/bin/env bash
# 安装日志轮转：logs 目录下所有日志每日轮转、压缩、保留 14 天。
set -euo pipefail

BASE="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$BASE/deploy/logrotate.conf"

if [ ! -f "$SRC" ]; then
  echo "[install-logrotate] config not found: $SRC"
  exit 1
fi

mkdir -p "$BASE/logs"
sudo cp "$SRC" /etc/logrotate.d/blowing-machine
sudo logrotate -d /etc/logrotate.d/blowing-machine >/dev/null
echo "[install-logrotate] installed /etc/logrotate.d/blowing-machine (daily, 14 days, compressed)"
