#!/usr/bin/env bash
# Disposable CI resources only. No external network, keys or production DB.
set -euo pipefail
image=${1:?image reference required}
name="postmill-smoke-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-1}"
network="$name-net"
cleanup() {
  docker rm -f "$name-app" "$name-pg" "$name-redis" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
# Pull dependencies before creating the isolated network.
docker pull postgres:17-alpine
docker pull redis:7-alpine
test "$(docker image inspect "$image" --format '{{.Architecture}}')" = amd64
test "$(docker image inspect "$image" --format '{{json .Config.Entrypoint}}')" = '["bash","/app/docker/entrypoint.sh"]'
test "$(docker image inspect "$image" --format '{{.Config.User}}')" = app
docker run --rm --network none --entrypoint bash "$image" -ec '
  bash -n /app/docker/entrypoint.sh
  test -s /app/apps/backend/dist/apps/backend/src/main.js
  test -s /app/apps/frontend/.next/BUILD_ID
  test -x /app/node_modules/.bin/next
  test -x /app/node_modules/.bin/prisma
'
docker network create --internal "$network" >/dev/null
docker run -d --name "$name-pg" --network "$network" --network-alias pg \
  --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=fixture -e POSTGRES_PASSWORD=fixture -e POSTGRES_DB=fixture postgres:17-alpine >/dev/null
docker run -d --name "$name-redis" --network "$network" --network-alias redis redis:7-alpine >/dev/null
ready=0
for _ in {1..60}; do
  if docker exec "$name-pg" pg_isready -U fixture >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
test "$ready" = 1
# Initialize only this tmpfs-backed throwaway schema. This does not execute any
# migration ledger and never sees a production URL. Runtime starts without DDL.
database='postgresql://fixture:fixture@pg:5432/fixture?connection_limit=3'
docker run --rm --network "$network" -e DATABASE_URL="$database" \
  --entrypoint /app/node_modules/.bin/prisma "$image" db push --skip-generate \
  --schema /app/libraries/nestjs-libraries/src/database/prisma/schema.prisma
flags=()
for feature in AI MCP MEDIA SHORTLINKS EMAIL VIDEO AGENT CRON SENTRY OPENTELEMETRY COMMS; do
  flags+=(-e "DEV_DISABLE_${feature}=true")
done
docker run -d --name "$name-app" --network "$network" "${flags[@]}" \
  -e DATABASE_URL="$database" -e REDIS_URL=redis://redis:6379 \
  -e JWT_SECRET=isolated-ci-fixture-not-a-production-secret-0123456789 \
  -e FRONTEND_URL=http://localhost:5000 -e MAIN_URL=http://localhost:5000 \
  -e NEXT_PUBLIC_BACKEND_URL=http://localhost:5000/api -e BACKEND_INTERNAL_URL=http://127.0.0.1:3000 \
  -e UPLOAD_DIRECTORY=/tmp/uploads -e STORAGE_PROVIDER=local \
  -e USE_INNGEST=false -e INNGEST_DEV=1 "$image" >/dev/null
healthy=0
for _ in {1..120}; do
  if [ "$(docker inspect "$name-app" --format '{{.State.Health.Status}}')" = healthy ]; then healthy=1; break; fi
  if [ "$(docker inspect "$name-app" --format '{{.State.Running}}')" != true ]; then break; fi
  sleep 2
done
if [ "$healthy" != 1 ]; then docker logs --tail 100 "$name-app"; exit 1; fi
docker exec "$name-app" curl -fsS http://127.0.0.1:5000/api/health/ready >/dev/null
# Exercise the built Next.js server through nginx as well as the backend probe.
docker exec "$name-app" curl -fsS http://127.0.0.1:5000/auth/login >/dev/null
