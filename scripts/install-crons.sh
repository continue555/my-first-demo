#!/usr/bin/env bash
# 安装定时任务：每日备份、每5分钟健康检查、每周恢复演练。
set -euo pipefail

BASE="$(cd "$(dirname "$0")/.." && pwd)"
CRON_FILE="/tmp/blowing-machine-cron"
mkdir -p "$BASE/logs"

crontab -l 2>/dev/null | grep -v 'backup-cron\|health-check\|restore-drill' > "$CRON_FILE" || true
cat >> "$CRON_FILE" <<EOF
0 2 * * * cd $BASE && bash backup-cron.sh >> $BASE/logs/backup.log 2>&1
*/5 * * * * cd $BASE && bash scripts/health-check.sh >> $BASE/logs/health.log 2>&1
0 3 * * 0 cd $BASE && bash scripts/restore-drill.sh >> $BASE/logs/restore-drill.log 2>&1
EOF
crontab "$CRON_FILE"
echo "[install-crons] installed"
crontab -l | tail -5

bash "$BASE/scripts/install-logrotate.sh"
