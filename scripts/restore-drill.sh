#!/usr/bin/env bash
# 备份恢复演练：把生产库 dump 后恢复到临时库，核对关键表行数一致后自动清理。
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

SRC_DB="${PG_DATABASE:-blowing_machine}"
TMP_DB="${SRC_DB}_restore_check"
PGPORT="${PG_PORT:-5432}"
export PGPASSWORD="${PG_PASSWORD}"
DUMP_FILE="/tmp/${SRC_DB}.dump"

echo "[restore-drill] source=${SRC_DB} temp=${TMP_DB}"

sudo -u postgres psql -c "DROP DATABASE IF EXISTS ${TMP_DB}" >/dev/null
sudo -u postgres psql -c "CREATE DATABASE ${TMP_DB} OWNER ${PG_USER}" >/dev/null

pg_dump -h "$PG_HOST" -p "$PGPORT" -U "$PG_USER" -d "$SRC_DB" -F c -f "$DUMP_FILE"
pg_restore -h "$PG_HOST" -p "$PGPORT" -U "$PG_USER" -d "$TMP_DB" --no-owner --no-privileges "$DUMP_FILE"

TABLES="orders users departments process_stages order_files notifications"
for t in $TABLES; do
  a=$(psql -h "$PG_HOST" -p "$PGPORT" -U "$PG_USER" -d "$SRC_DB" -tAc "SELECT COUNT(*) FROM $t")
  b=$(psql -h "$PG_HOST" -p "$PGPORT" -U "$PG_USER" -d "$TMP_DB" -tAc "SELECT COUNT(*) FROM $t")
  echo "[restore-drill] $t source=$a restored=$b"
  if [ "$a" != "$b" ]; then
    echo "[restore-drill] MISMATCH table=$t"
    exit 1
  fi
done

rm -f "$DUMP_FILE"
sudo -u postgres psql -c "DROP DATABASE IF EXISTS ${TMP_DB}" >/dev/null
echo "[restore-drill] OK"
