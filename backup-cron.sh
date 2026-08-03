#!/bin/bash
set -euo pipefail

APP_DIR="/opt/blowing-machine"
BACKUP_DIR="$APP_DIR/backups"
mkdir -p "$BACKUP_DIR"

set -a
source "$APP_DIR/.env"
set +a

DATE=$(date +%Y%m%d_%H%M%S)
PGPASSWORD="$PG_PASSWORD" pg_dump -h "$PG_HOST" -p "${PG_PORT:-5432}" -U "$PG_USER" -d "$PG_DATABASE" -F c -f "$BACKUP_DIR/db_$DATE.dump"
tar -czf "$BACKUP_DIR/uploads_$DATE.tar.gz" -C "$APP_DIR" uploads

find "$BACKUP_DIR" -maxdepth 1 -name 'db_*.dump' -mtime +7 -delete
find "$BACKUP_DIR" -maxdepth 1 -name 'uploads_*.tar.gz' -mtime +7 -delete

echo "backup done $DATE"
