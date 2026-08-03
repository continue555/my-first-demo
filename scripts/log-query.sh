#!/usr/bin/env bash
# 日志检索：log-query.sh [关键字]，支持 reqId、level、用户名、接口路径等。
set -uo pipefail

BASE="$(cd "$(dirname "$0")/.." && pwd)"
PATTERN="${1:-}"

LOGS=(
  "$BASE/server_output.log"
  "$HOME/.pm2/logs/blowing-machine-out.log"
  "$HOME/.pm2/logs/blowing-machine-error.log"
)

for f in "${LOGS[@]}"; do
  [ -f "$f" ] || continue
  if [ -n "$PATTERN" ]; then
    grep "$PATTERN" "$f" | tail -n 100
  else
    tail -n 50 "$f"
  fi
done
