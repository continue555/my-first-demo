#!/usr/bin/env bash
# 健康检查：API、PM2、磁盘；失败时可选推送 webhook。
set -uo pipefail

BASE="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$BASE/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/health.log"
ts() { date '+%Y-%m-%d %H:%M:%S'; }
fail=0

if ! curl -fs --max-time 5 "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null 2>&1; then
  echo "[$(ts)] ERROR api health check failed" >> "$LOG"
  fail=1
fi

if ! pm2 status blowing-machine 2>/dev/null | grep -q online; then
  echo "[$(ts)] ERROR pm2 status not online" >> "$LOG"
  fail=1
fi

disk="$(df -P /opt 2>/dev/null | awk 'NR==2{print $5}' | tr -d '%')"
if [ -n "$disk" ] && [ "$disk" -gt 85 ]; then
  echo "[$(ts)] WARN disk usage ${disk}%" >> "$LOG"
  fail=1
fi

if [ "$fail" -eq 1 ] && [ -n "${MONITOR_WEBHOOK:-}" ]; then
  curl -fs --max-time 5 -H 'Content-Type: application/json' \
    -d "{\"msg\":\"[blowing-machine] health check failed at $(ts)\"}" \
    "$MONITOR_WEBHOOK" >/dev/null 2>&1 || true
fi

exit "$fail"
