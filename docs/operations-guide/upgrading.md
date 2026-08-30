# Upgrading

## Clean upgrade path

The recommended upgrade process follows the immutable-infrastructure model: new container image,
same data volumes.

```
1. Read CHANGELOG → 2. Back up → 3. Bump image tag → 4. Redeploy → 5. Apply migrations → 6. Set new env vars
```

### 1. Read the CHANGELOG

Before every upgrade, read `CHANGELOG.md` at the new version tag. Note:

- **Breaking changes** — env var renames, Docker identifier changes, config relocation
- **New required env vars** — boot will fail if missing
- **Schema changes** — additive columns are safe; renames/drops need a manual plan

### 2. Back up

Take a full backup before every upgrade. See [Backup & Retention](./backup-and-retention.md).

```bash
docker exec postmill-postgres pg_dump -U postmill-user postmill-db-local > pre_upgrade_$(date +%Y%m%d).sql
```

### 3. Bump the image tag

```yaml
# docker-compose.yaml or your deployment config
services:
  postmill:
    image: ghcr.io/postmill-ai/postmill-app:v1.0.0  # pin a specific tag, not :latest
```

Pinning specific tags gives you a known rollback target. Using `:latest` means every restart may
pull an untested version.

### 4. Redeploy

```bash
# Docker Compose
docker compose pull postmill
docker compose up -d postmill

# Coolify / Portainer / Kubernetes
# Trigger a redeploy of the postmill service with the new image tag
```

### 5. Apply migrations

The container runs `prisma-generate` on boot (via `postinstall`), regenerating the Prisma client to
match the schema baked into the new image. It does **not** apply committed migrations automatically.

Postmill ships committed Prisma migrations under
`libraries/nestjs-libraries/src/database/prisma/migrations/`. The canonical apply path is
`prisma migrate deploy`:

```bash
# Run inside the running container
docker exec postmill pnpm dlx prisma@6.5.0 migrate deploy \
  --schema ./libraries/nestjs-libraries/src/database/prisma/schema.prisma
```

For a quick local reset only, you can use `pnpm run prisma-db-push` / `pnpm run prisma-reset`. Never
use `db push` against a shared or production database.

If a release includes destructive changes (column/table drops, in-place renames), read the
CHANGELOG carefully, take a backup, and follow the expand-contract path documented in
[Database](../developer-docs/database.md).

### 6. Set new env vars

Check the CHANGELOG for any new env vars required by the release. Add them to your `.env` file,
Docker Compose environment, or deployment config, then redeploy if needed.

## Manual schema sync

If you need an in-place schema sync outside the normal migration flow, use the helper script:

```bash
# Safe additive sync (refuses data loss)
./tools/db/postmill-migrate.sh

# Destructive — back up first!
./tools/db/postmill-migrate.sh --accept-data-loss
```

Or run directly in the container:

```bash
docker exec postmill pnpm dlx prisma@6.5.0 db push \
  --schema ./libraries/nestjs-libraries/src/database/prisma/schema.prisma
```

> **Always back up before `--accept-data-loss`.** See [Backup & Retention](./backup-and-retention.md)
> and [Database schema safety](../developer-docs/database.md).

### Schema change rules

Releases follow additive-schema-only rules so `migrate deploy` against a live database usually
works without data loss:

- New tables are always safe
- New columns are nullable or defaulted — safe
- Renames/drops are destructive and uncommon — noted prominently in the CHANGELOG when they occur

### Renames and drops — expand-contract

A destructive migration drops or renames a column/table and loses data. Never rename or drop a
column or table in the same release that stops using it. Instead, spread the change across releases:

1. **Expand** — add the new nullable column alongside the old one and deploy.
2. **Backfill** — copy data from the old column to the new one (add a one-time step to
   `BackfillService`, `libraries/nestjs-libraries/src/database/seeds/backfill.service.ts`).
3. **Switch** — point all reads and writes at the new column and deploy.
4. **Contract** — only once nothing references the old column (prove it with a grep) drop it in a
   later release, after taking the pre-migration `pg_dump`.

### Rollback

Migrations are forward-only. To roll back a destructive change, restore the pre-upgrade `pg_dump`:

```bash
# Stop the app first so nothing writes during the restore
cat pre_push_YYYYMMDD_HHMMSS.sql | docker exec -i postmill-postgres \
  psql -U postmill-user -d postmill-db-local
```

Then redeploy the previous image tag.

### Drift check

After deploying, confirm the live database matches the committed schema. `prisma migrate diff`
exits `2` when there is a difference, `0` when there is none:

```bash
pnpm exec prisma migrate diff \
  --from-schema-datamodel libraries/nestjs-libraries/src/database/prisma/schema.prisma \
  --to-url "$DATABASE_URL" \
  --exit-code
```

The `mastra_*` tables are created at runtime by the Mastra chat agent, outside the Prisma schema,
so they always appear as out-of-schema drift — that is **expected noise**, not a real diff.

## Building from source

If you prefer to build the container image locally:

```bash
# Build the image
./docker/docker-build.sh

# Or with the dev compose stack for local development
docker compose -f docker/docker-compose.dev.yaml up -d

# Build all apps from source
pnpm run build
```

## Rollback

If an upgrade causes issues:

1. Set the image tag back to the previous version.
2. Redeploy.
3. Restore the database from the pre-upgrade backup if the upgrade applied destructive schema
   changes.

## Related

- [Backup & Retention](./backup-and-retention.md) — backup before upgrade
- [Developer Docs: Database](../developer-docs/database.md) — schema management and safety

> Verified against v1.0.0
