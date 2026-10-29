#!/bin/sh
# Puts a backup from deploy/backup.sh back in place of the live database.
# Everything written since that backup is lost, so it asks first.
#   sh deploy/restore.sh ~/iem-backups/iem-2026-11-01T0330.sql.gz
# A backup kept only in R2: download it into ~/iem-backups first (README, "Restore").
set -eu
cd "$(dirname "$0")/.."
file="${1:-}"
[ -f "$file" ] || { echo "Usage: sh deploy/restore.sh <backup .sql.gz>"; exit 1; }
gzip -t "$file" || { echo "$file is not a complete gzip file"; exit 1; }

compose="docker compose -f deploy/docker-compose.prod.yml"
echo "This replaces the live database with $file."
echo "Everything written after that backup is lost. Type RESTORE to go on:"
read -r answer
[ "$answer" = "RESTORE" ] || { echo "Stopped. Nothing changed."; exit 1; }

# No writes while it is replaced: the API (and its workers) stop first.
$compose stop api
$compose exec -T postgres psql -U iem -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS iem WITH (FORCE);" -c "CREATE DATABASE iem OWNER iem;"
gunzip -c "$file" | $compose exec -T postgres psql -U iem -d iem -v ON_ERROR_STOP=1 -q
$compose start api
echo "Restored from $file. The API is starting again."
