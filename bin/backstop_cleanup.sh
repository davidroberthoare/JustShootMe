#!/usr/bin/env bash
#
# OS-level backstop against runaway disk usage, independent of the app's own
# retention logic (bin/retention_cron.php). This should never fire in normal
# operation — if it deletes something, that's a signal the app-level cron is
# broken and needs investigating.
#
# Deletes archives older than ARCHIVE_MAX_AGE_DAYS (well past the app's
# 7-day archive window) and any per-event photo directories untouched for
# EVENTS_MAX_AGE_DAYS (well past the app's 7-day active window).
#
# Suggested crontab (run after the app-level sweep):
#   30 3 * * * /path/to/photobooth/bin/backstop_cleanup.sh >> /var/log/photobooth-backstop.log 2>&1

set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVES_DIR="${APP_ROOT}/storage/archives"
EVENTS_DIR="${APP_ROOT}/storage/events"

ARCHIVE_MAX_AGE_DAYS="${ARCHIVE_MAX_AGE_DAYS:-21}"
EVENTS_MAX_AGE_DAYS="${EVENTS_MAX_AGE_DAYS:-14}"

echo "[$(date -Is)] Backstop cleanup starting."

if [ -d "$ARCHIVES_DIR" ]; then
  find "$ARCHIVES_DIR" -maxdepth 1 -type f -name '*.zip' -mtime "+${ARCHIVE_MAX_AGE_DAYS}" -print -delete
fi

if [ -d "$EVENTS_DIR" ]; then
  find "$EVENTS_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+${EVENTS_MAX_AGE_DAYS}" -print -exec rm -rf {} \;
fi

echo "[$(date -Is)] Backstop cleanup complete."
