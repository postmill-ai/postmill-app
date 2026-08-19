# Upgrading

## v1.0.0 — repository paths moved

If you build from source, or you have scripts or CI that reference files in this repository by path,
note that the Docker files were consolidated in v1.0.0. **Nothing about a normal image-tag upgrade
changes** — the production `docker-compose.yaml` and `Dockerfile` are still at the repository root,
volume names are unchanged, and no env var moved.

| Was | Now |
|---|---|
| `docker-compose.dev.yaml` | `docker/docker-compose.dev.yaml` |
| `docker-compose.dev-app.yaml` | `docker/docker-compose.dev-app.yaml` |
| `Dockerfile.dev`, `Dockerfile.dev-live` | `docker/Dockerfile.dev`, `docker/Dockerfile.dev-live` |
| `Containerfile.render` | `docker/Containerfile.render` |
| `./var/docker/docker-build.sh`, `docker-create.sh` | `./docker/docker-build.sh`, `./docker/docker-create.sh` |
| `scripts/postmill-migrate.sh` | `tools/db/postmill-migrate.sh` |

`docker-compose.yaml`, `Dockerfile`, and `.dockerignore` deliberately stay at the root.

The two dev compose files now declare `name: postmill-app`. Compose otherwise derives the project
name — and therefore the volume prefix — from the directory holding the compose file, so without
this the move would have renamed your `postmill-app_*` volumes. If you run the dev stack from a
clone directory **not** named `postmill-app`, your existing dev volumes were prefixed with that
directory name and the pin will point Compose at differently-named volumes. Either rename them or
re-create the dev stack:

```bash
docker volume ls | grep postgres-volume      # find <yourdir>_postgres-volume
```

This affects the **development** stack only; production volumes are untouched.

`pnpm run docker-build` also works again — it had been failing since before the fork, passing
`--target` stage names that the Dockerfile it builds does not define.

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
- **Deprecations** — removed env vars that must be migrated to in-app settings

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

## Migrating from a pre-rebrand install (volume & Postgres role rename)

A fresh install needs no action here. If your install predates the Postmill rename, its Docker
volumes and Postgres role/database use the previous names, while the current
`docker-compose.yaml` mounts the renamed `postmill-*` volumes and expects the
`postmill-user`/`postmill-db-local` Postgres role and database. Bringing the new compose file up
without migrating starts against **empty storage** — the old volumes are not mounted, and the
renamed Postgres role/db does not exist on the already-initialized volume.

Migrate by moving the data across:

1. Dump the database from the **old** Postgres container before switching compose files (see the
   backup step in the clean upgrade path above).
2. Bring the new stack up, then restore the dump into the new database (see the restore command
   under Rollback below).
3. Copy the contents of the old uploads and config volumes into the new `postmill-uploads` and
   `postmill-config` volumes. Find the old names with `docker volume ls`, then copy with a
   throwaway container, e.g.
   `docker run --rm -v <old-uploads-volume>:/from -v $(basename "$PWD")_postmill-uploads:/to alpine sh -c 'cp -a /from/. /to/'`.

## Migrating from a pre-release build

Versions 3.x/4.x were pre-release internal development; **v1.0.0 is the first public release.** If
you run a pre-release build, upgrade straight to v1.0.0 — the notes below condense every breaking
change from the pre-release line.

**Take a database snapshot before applying migrations.** The v1.0.0 schema includes a destructive
push that drops dead tables and migrated columns. This is not optional:

```bash
docker exec postmill-postgres pg_dump -U postmill-user postmill-db-local > pre_upgrade_$(date +%Y%m%d).sql
# Then run migrate deploy (or db push in local dev)
docker exec postmill pnpm dlx prisma@6.5.0 migrate deploy \
  --schema ./libraries/nestjs-libraries/src/database/prisma/schema.prisma
```

**Dropped tables** (dead marketplace/GitHub-stars subsystems, no reachable entrypoints):
`SocialMediaAgency`, `SocialMediaAgencyNiche`, `MessagesGroup`, `Messages`, `Orders`,
`OrderItems`, `PayoutProblems`, `ItemUser`, `GitHub`, `Star`, `Trending`, `TrendingLog`.

**Dropped columns/enums:**

- `User` profile/notification columns (`name`, `lastName`, `bio`, `pictureId`, `timezone`,
  `sendSuccessEmails`, `sendFailureEmails`, `sendStreakEmails`) — moved to the new `UserProfile`
  table (1:1), backfilled automatically.
- `User` marketplace columns (`audience`, `account`, `connectedAccount`) and `Post` marketplace
  fields (`submittedForOrderId`, `submittedForOrganizationId`, `approvedSubmitForOrder`).
- `UserOrganization.role` and the `Role` enum — replaced by `roleId` → `AppRole` (RBAC).
- `AIOrgProviderConfig.imageModel` / `AIProviderConfig.imageModel` — image generation moved to
  the Media provider system.
- `StorageProviderConfig.isDefault` — LOCAL is the always-on base storage; the
  `POST /settings/storage/:id/set-default` API route is deleted. Remove any scripts or tooling
  that call it.
- Enums `OrderStatus`, `From`.
- The old `OrgShortLinkConfig` `@@unique([organizationId, identifier])` constraint (replaced by
  the per-account unique, enabling multiple accounts per provider).

**Automatic seed + backfill:** on first boot the backend idempotently seeds the RBAC catalog
(5 system roles, 90 permissions) and backfills `UserProfile` rows, `UserOrganization.roleId`
(legacy `SUPERADMIN → owner`, `ADMIN → admin`, `USER → member`), one default brand per org,
storage/short-link account fingerprints, and media provider configs from the old
`ragSettings.mediaProviders` blob. No manual data migration is required.

**Env vars removed — reconfigure in-app.** Stale pre-release env vars are silently ignored. Keep
`ENCRYPTION_KEY` (or `JWT_SECRET`, if you never set `ENCRYPTION_KEY`) **stable** across the
upgrade — stored secrets are encrypted with it and won't decrypt if it changes.

- **Channel & AI credentials** are read only from the database (Settings → Channels, Settings →
  AI), encrypted at rest. The per-provider OAuth env vars (`LINKEDIN_CLIENT_ID`,
  `FACEBOOK_APP_ID`, etc.) and any `OPENAI_API_KEY` are no longer read — configure providers
  in-app.
- **Google My Business** no longer falls back to `YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET`.
  Enter GMB credentials explicitly under Settings → Channels (you can reuse the same Google Cloud
  OAuth client you used for YouTube).
- **Email:** `RESEND_API_KEY` and `EMAIL_HOST`/`EMAIL_PORT`/`EMAIL_SECURE`/`EMAIL_USER`/
  `EMAIL_PASS` are removed. Set `EMAIL_PROVIDER=resend` with `EMAIL_API_KEY`, or
  `EMAIL_PROVIDER=smtp` with the `EMAIL_SMTP_*` vars. With no recognized `EMAIL_PROVIDER`, the
  `EmptyAdapter` activates and activation/reset/invite/billing emails **stop sending**.
  `EMAIL_WEBHOOK_SECRET` is required for delivery tracking on webhook-capable providers (Resend,
  SendGrid, Mailgun, Postmark, SES).
- **Storage:** the global `STORAGE_PROVIDER` and `CLOUDFLARE_*` vars
  (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ACCESS_KEY`, `CLOUDFLARE_SECRET_ACCESS_KEY`,
  `CLOUDFLARE_BUCKETNAME`, `CLOUDFLARE_BUCKET_URL`, `CLOUDFLARE_REGION`) are removed — configure
  cloud storage per-org in Settings → Storage. Ensure `UPLOAD_DIRECTORY` is set and writable.
  Avatars and app-internal image writes always use LOCAL storage; old avatar URLs pointing at
  `CLOUDFLARE_BUCKET_URL` are left as-is and re-fetched on the next token refresh/reconnect.
- **Short links:** all 10 short-link env vars (`DUB_*`, `SHORT_IO_*`, `KUTT_*`, `LINK_DRIP_*`)
  are removed — reconfigure in Settings → Shortlinks. The Kutt and LinkDrip providers no longer
  exist; choose one of the remaining supported providers. Already-generated short URLs in post
  content keep working as opaque links.

**New env vars:**

- `LOCAL_STORAGE_QUOTA_GB` (default `5`) — default soft quota for each org's local storage.
- `MEDIA_UPLOAD_MAX_BYTES` (default 1 GB) — large media uploads stream through
  `/files/upload-server` (formerly `/media/upload-server`); the presigned multipart Cloudflare R2
  path is removed.

**Behaviour changes to verify after upgrading:**

- Login providers are managed by the **separate administration app** (a distinct repo); this repo
  reads `AuthProviderConfig` DB-first and ships no `/admin` frontend — env vars remain the
  bootstrap fallback, so existing env-configured logins keep working.
- Login issues a refresh token backed by the `Session` table, with a per-user device list and
  per-session revoke under Profile → Security. Existing JWTs keep verifying (no forced re-auth).
- The post composer lives at `/schedule/post` and `/schedule/post/<id>` (was a modal).
- Local uploads are partitioned per tenant under `<UPLOAD_DIRECTORY>/<tenantId>/`; existing files
  remain readable at their recorded paths.

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
