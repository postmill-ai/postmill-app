#!/usr/bin/env bash
# Run a Prisma schema sync inside the live Postmill container.
#
#   ./scripts/postmill-migrate.sh                     # safe additive sync (refuses data loss)
#   ./scripts/postmill-migrate.sh --accept-data-loss  # allow drops/retypes (DESTRUCTIVE — back up first!)
#
# This pushes whatever schema.prisma is baked into the RUNNING image. For anything
# permanent, the clean path is: edit schema.prisma -> commit -> tag -> CI builds the
# image -> bump the tag in Coolify -> redeploy (the container runs prisma-db-push on
# boot). Use this only for a manual, in-place sync.
set -euo pipefail
CONTAINER="${POSTMILL_CONTAINER:-postiz-l4le990xi7me2e4pma11lzma}"
SCHEMA="./libraries/nestjs-libraries/src/database/prisma/schema.prisma"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "ERROR: container '$CONTAINER' not running. Set POSTMILL_CONTAINER=<name>." >&2
  exit 1
fi

echo ">> Reminder: take a backup first if passing --accept-data-loss."
echo ">> prisma db push in $CONTAINER $*"
docker exec -w /app "$CONTAINER" pnpm dlx prisma@6.5.0 db push --schema "$SCHEMA" "$@"
echo ">> done."
