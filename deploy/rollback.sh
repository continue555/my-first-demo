#!/usr/bin/env bash
# 回滚：rollback.sh <timestamp>，从 releases/backup-<timestamp> 恢复代码并重启。
set -euo pipefail

cd "$(dirname "$0")/.."
BASE="$(pwd)"

if [ "$#" -ne 1 ]; then
  echo "usage: bash deploy/rollback.sh <timestamp>"
  echo "available backups:"
  ls "$BASE/releases" 2>/dev/null || echo "none"
  exit 1
fi

SRC="$BASE/releases/backup-$1"
if [ ! -d "$SRC" ]; then
  echo "backup not found: $SRC"
  exit 1
fi

echo "[rollback] restoring $1"
tar -C "$SRC" -cf - . | tar -C "$BASE" -xf -

export PATH="$PATH:$(npm config get prefix)/bin"
pm2 restart blowing-machine
sleep 3

if node test-api.js; then
  echo "[rollback] OK"
else
  echo "[rollback] tests failed after restore, please check manually"
  exit 1
fi
