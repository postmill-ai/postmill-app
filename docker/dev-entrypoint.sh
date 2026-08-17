#!/usr/bin/env bash
# Live-reload dev entrypoint: wait for infra, install deps (once), push schema,
# then start the watchers SEQUENTIALLY so their cold TS compiles don't all peak at
# once (the Docker VM only has ~7.7 GB).
set -uo pipefail

wait_tcp() {  # host port name
  local host=$1 port=$2 name=$3
  echo "[dev] waiting for ${name} (${host}:${port})..."
  for _ in $(seq 1 240); do
    if (echo > "/dev/tcp/${host}/${port}") 2>/dev/null; then
      echo "[dev] ${name} is up."
      return 0
    fi
    sleep 2
  done
  echo "[dev] WARNING: ${name} not reachable on ${host}:${port}; continuing anyway."
  return 1
}

wait_tcp postmill-postgres 5432 postgres
# Redis is external now (Upstash via REDIS_URL) — nothing local to wait for.

# node_modules lives in a named volume, so install only on first boot.
# Delete /app/node_modules/.docker-deps-installed (or `docker volume rm`) to force a reinstall.
if [ ! -f node_modules/.docker-deps-installed ]; then
  echo "[dev] installing dependencies (first run — this can take several minutes)..."
  pnpm install
  touch node_modules/.docker-deps-installed
else
  echo "[dev] dependencies already installed (rm node_modules/.docker-deps-installed to force reinstall)."
fi

echo "[dev] pushing prisma schema to the database..."
pnpm run prisma-db-push

# Start each watcher in the background, waiting for it to bind its port before
# starting the next — this staggers the heavy cold compiles.
# TSC_WATCHFILE: inotify events don't reliably cross the macOS VirtioFS bind
# mount — without polling, host edits intermittently never trigger a recompile.
echo "[dev] starting backend (:3000)..."
TSC_WATCHFILE=DynamicPriorityPolling NODE_OPTIONS="--max-old-space-size=4096" pnpm run --filter ./apps/backend dev &
wait_tcp 127.0.0.1 3000 backend

# The frontend (Turbopack) is the biggest memory consumer (5-6.5 GB native, not
# bounded by --max-old-space-size). Set START_FRONTEND=false to run it on the
# host instead (pnpm run dev:frontend) and keep the VM to backend + infra.
if [ "${START_FRONTEND:-true}" = "true" ]; then
  echo "[dev] starting frontend (:4200)..."
  NODE_OPTIONS="--max-old-space-size=1536" pnpm run --filter ./apps/frontend dev &
  wait_tcp 127.0.0.1 4200 frontend
else
  echo "[dev] frontend NOT started (START_FRONTEND != true). Run it on the host: pnpm run dev:frontend"
fi

echo "[dev] all watchers started — editing files on the host now hot-reloads."
# Keep the container alive on the background watchers; exit if any of them dies.
wait -n
echo "[dev] a watcher exited — see logs above. Container will stop."
