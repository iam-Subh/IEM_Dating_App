#!/bin/sh
# Nightly database backup: a compressed pg_dump, kept on the server for 14 days
# and copied to a private Cloudflare R2 bucket (settings in deploy/.env).
# On the server, from the repository root, once a night (crontab -e):
#   30 3 * * * cd ~/iem && sh deploy/backup.sh >> ~/iem-backup.log 2>&1
set -eu
cd "$(dirname "$0")/.."
. deploy/.env

stamp=$(date -u +%Y-%m-%dT%H%M)
dir="$HOME/iem-backups"
file="$dir/iem-$stamp.sql.gz"
mkdir -p "$dir"

# From inside the database container: no password on the command line, no open port.
docker compose -f deploy/docker-compose.prod.yml exec -T postgres pg_dump -U iem -d iem --no-owner | gzip > "$file"
# An empty or tiny file means the dump failed: stop before copying it over a good one.
[ "$(wc -c < "$file")" -gt 1024 ] || { echo "$stamp backup too small, not uploaded"; exit 1; }

docker run --rm -v "$dir:/backups:ro" \
  -e AWS_ACCESS_KEY_ID="$BACKUP_R2_ACCESS_KEY_ID" -e AWS_SECRET_ACCESS_KEY="$BACKUP_R2_SECRET_ACCESS_KEY" \
  -e AWS_DEFAULT_REGION=auto \
  amazon/aws-cli s3 cp "/backups/$(basename "$file")" "s3://$BACKUP_R2_BUCKET/db/$(basename "$file")" \
  --endpoint-url "https://$BACKUP_R2_ACCOUNT_ID.r2.cloudflarestorage.com"

find "$dir" -name 'iem-*.sql.gz' -mtime +14 -delete
echo "$stamp backup ok: $(du -h "$file" | cut -f1)"
