#!/usr/bin/env bash
set -euo pipefail

LOG="${1:-memory-smoke-$(date +%Y%m%d-%H%M%S).csv}"
INTERVAL="${2:-10}"
DURATION="${3:-600}"

echo "timestamp,pid,comm,rss_kb,vsz_kb" > "$LOG"

DEV_DISABLE_AI=true \
DEV_DISABLE_MCP=true \
DEV_DISABLE_MEDIA=true \
DEV_DISABLE_SHORTLINKS=true \
DEV_DISABLE_EMAIL=true \
DEV_DISABLE_VIDEO=true \
DEV_DISABLE_AGENT=true \
  pnpm run dev:minimal &
DEV_PID=$!

cleanup() { kill "$DEV_PID" 2>/dev/null || true; }
trap cleanup EXIT

# Wait for backend/frontend processes to spawn
sleep 20

echo "Sampling into $LOG for ${DURATION}s (interval ${INTERVAL}s)"
END=$((SECONDS + DURATION))
while [ $SECONDS -lt $END ]; do
  TS=$(date -Iseconds)
  for PID in $(pgrep -f "next dev|nest start" || true); do
    read -r RSS VSZ COMM < <(ps -o rss=,vsz=,comm= -p "$PID" 2>/dev/null || true)
    if [ -n "${RSS:-}" ]; then
      echo "$TS,$PID,$COMM,$RSS,$VSZ" >> "$LOG"
    fi
  done
  sleep "$INTERVAL"
done

echo "Sampling complete. Log: $LOG"
