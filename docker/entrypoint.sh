#!/usr/bin/env bash
# All-in-one image entrypoint: substitutes the runtime NEXT_PUBLIC_BACKEND_URL
# into the prebuilt frontend, then runs nginx (:5000) in front of the NestJS
# backend (:3000) and the Next.js frontend prod server (:4200).
#
# No PM2, no supervisor: three background children + `wait -n`. If any child
# dies the entrypoint exits non-zero and the container restart policy takes
# over; SIGTERM/SIGINT are forwarded to all children.

set -u

export NEXT_PUBLIC_BACKEND_URL="${NEXT_PUBLIC_BACKEND_URL:-http://localhost:4007/api}"

# --- Runtime substitution of the build-time backend-URL placeholder ---------
# The frontend build bakes NEXT_PUBLIC_BACKEND_URL into client chunks and the
# CSP connect-src baked into .next/routes-manifest.json (see the CSP guard in
# apps/frontend/next.config.ts). The image is install-agnostic, so it ships a
# placeholder absolute URL and we rewrite it here, on every boot, before any
# process serves traffic. A container RESTART keeps the already-substituted
# files (only a recreate re-runs on the pristine image), so we record the last
# substituted values in a state file under .next and rewrite FROM those — a
# restart with a changed NEXT_PUBLIC_BACKEND_URL now re-substitutes correctly.
NEXT_DIR=/app/apps/frontend/.next
STATE_FILE="$NEXT_DIR/.backend-url-state"
PLACEHOLDER_URL='https://backend-url-not-set.postmill.invalid/api'
PLACEHOLDER_ORIGIN='https://backend-url-not-set.postmill.invalid'

# Escape sed replacement specials (& | \) in runtime values.
esc() { printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'; }

# connect-src holds the bare ORIGIN (no /api path) — compute it the same way
# apps/frontend/next.config.ts does. Empty when the URL is unparseable.
BACKEND_ORIGIN="$(node -e 'try { console.log(new URL(process.env.NEXT_PUBLIC_BACKEND_URL).origin); } catch {}')"

# What is currently baked into .next: the placeholder on first boot, else the
# values from the previous run's state file.
PREV_URL="$PLACEHOLDER_URL"
PREV_ORIGIN="$PLACEHOLDER_ORIGIN"
if [ -f "$STATE_FILE" ]; then
  PREV_URL="$(sed -n '1p' "$STATE_FILE")"
  PREV_ORIGIN="$(sed -n '2p' "$STATE_FILE")"
fi

if [ "$PREV_URL" != "$NEXT_PUBLIC_BACKEND_URL" ] && [ -n "$PREV_ORIGIN" ] && grep -rlqF -- "$PREV_ORIGIN" "$NEXT_DIR" 2>/dev/null; then
  url_esc="$(esc "$NEXT_PUBLIC_BACKEND_URL")"
  origin_esc="$(esc "$BACKEND_ORIGIN")"
  # Full URL first (its occurrences also contain the origin string), then the
  # bare origin that remains in the baked CSP.
  grep -rlF -- "$PREV_URL" "$NEXT_DIR" 2>/dev/null | xargs -r sed -i "s|$(esc "$PREV_URL")|$url_esc|g"
  if [ -n "$BACKEND_ORIGIN" ]; then
    grep -rlF -- "$PREV_ORIGIN" "$NEXT_DIR" 2>/dev/null | xargs -r sed -i "s|$(esc "$PREV_ORIGIN")|$origin_esc|g"
  fi
fi

# Record what is baked in now, for the next boot (also on the no-op path, so a
# crash between sed and state-write can't wedge the container — worst case the
# next boot re-runs the same substitution, which then no-ops).
printf '%s\n%s\n' "$NEXT_PUBLIC_BACKEND_URL" "$BACKEND_ORIGIN" > "$STATE_FILE"

mkdir -p /tmp/nginx

pids=()

node --experimental-require-module /app/apps/backend/dist/apps/backend/src/main.js &
pids+=($!)

# `pnpm prune --prod` empties the per-workspace node_modules; all production
# deps (incl. `next`) resolve from the root /app/node_modules instead.
(cd /app/apps/frontend && /app/node_modules/.bin/next start -H 127.0.0.1 -p 4200) &
pids+=($!)

nginx -c /app/docker/nginx.prod.conf &
pids+=($!)

shutdown() {
  kill "${pids[@]}" 2>/dev/null
  wait "${pids[@]}" 2>/dev/null
  exit 0
}
trap shutdown TERM INT

# Wait for the FIRST child to exit; then bring the rest down and propagate the
# status so `restart: always` can recreate a fully-healthy stack.
wait -n "${pids[@]}"
status=$?
kill "${pids[@]}" 2>/dev/null
wait "${pids[@]}" 2>/dev/null
exit "$status"
