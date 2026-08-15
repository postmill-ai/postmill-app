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

## Per-release notes

### v3.8.10 and later

v3.8.10 restructures identity, roles, and the provider-surface settings, and includes a
**destructive schema push** that drops dead tables and migrated columns.

**Take a database snapshot before applying the migration.** This is not optional:

```bash
docker exec postmill-postgres pg_dump -U postmill-user postmill-db-local > pre_3810_$(date +%Y%m%d).sql
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
- Enums `OrderStatus`, `From`.
- The old `OrgShortLinkConfig` `@@unique([organizationId, identifier])` constraint (replaced by
  the per-account unique, enabling multiple accounts per provider).

**Automatic seed + backfill:** on first boot the backend idempotently seeds the RBAC catalog
(5 system roles, 80 permissions) and backfills `UserProfile` rows, `UserOrganization.roleId`
(legacy `SUPERADMIN → owner`, `ADMIN → admin`, `USER → member`), one default brand per org,
storage/short-link account fingerprints, and media provider configs from the old
`ragSettings.mediaProviders` blob. No manual data migration is required.

**New env vars:**

- `LOCAL_STORAGE_QUOTA_GB` (default `5`) — default soft quota for each org's local storage.

**Behaviour changes to verify after upgrading:**

- Login providers are now managed by the **separate administration app** (a distinct repo); this
  repo reads `AuthProviderConfig` DB-first and ships no `/admin` frontend — env vars remain the
  bootstrap fallback, so existing env-configured logins keep working.
- Login now issues a refresh token backed by the `Session` table; users get a device list with
  per-session revoke under Profile → Security. Existing JWTs keep verifying (no forced re-auth).
- The post composer moved to `/schedule/post` and `/schedule/post/<id>` (was a modal).
- Local uploads are partitioned per tenant under `<UPLOAD_DIRECTORY>/<tenantId>/`; existing files
  remain readable at their recorded paths.

### v3.8.3 → v3.8.4

**No schema changes.** v3.8.4 is a remediation release addressing bugs introduced in v3.8.3.

**If you use Amazon SES for email:** Re-test webhook delivery. SNS subscription confirmation
and bounce/complaint/delivery event processing were fixed in this release.

**No env var or config changes required.** A simple redeploy with the new image tag is sufficient.

### v3.8.2 → v3.8.3

**Destructive schema change:** The `StorageProviderConfig.isDefault` column was dropped
(`prisma migrate deploy` or `db push --accept-data-loss` required). The `POST /settings/storage/:id/set-default`
API route was deleted. LOCAL is now the implicit always-on base storage; all other providers
(S3/R2/B2/IDriveE2) mount onto it.

**Required actions:**

1. Apply the migration. If using `db push`, pass `--accept-data-loss` to apply the column drop.
2. Remove any scripts or tooling that call the deleted `set-default` endpoint.
3. All other changes (Schedule rename, settings sort, profile in avatar menu) are additive
   — no env var changes needed.

**No env var changes.** Calendar → Schedule routing is a permanent redirect; no config needed.

### v3.8.1 → v3.8.2

Avatars and all app-internal image writes now always use the org's LOCAL storage (not Cloudflare R2
via env vars). The global-env `STORAGE_PROVIDER` and `CLOUDFLARE_*` vars are **removed**.
Large media uploads stream through `/files/upload-server` (formerly `/media/upload-server`) with a
configurable limit (`MEDIA_UPLOAD_MAX_BYTES`, default 1 GB). The presigned multipart Cloudflare R2
path is removed.

Cloud providers (S3/R2/B2/IDrive e2) remain configurable per-organization in Settings → Storage,
but they are **write-inert** for avatars and app-internal writes. Media-library uploads also go
through local storage.

**Required actions:**

1. Remove the following env vars from your `.env` and `docker-compose.yaml`:
   - `STORAGE_PROVIDER`
   - `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ACCESS_KEY`, `CLOUDFLARE_SECRET_ACCESS_KEY`
   - `CLOUDFLARE_BUCKETNAME`, `CLOUDFLARE_BUCKET_URL`, `CLOUDFLARE_REGION`
2. Ensure `UPLOAD_DIRECTORY` is set and writable.
3. Optionally set `MEDIA_UPLOAD_MAX_BYTES` (default 1 GB).
4. The configuration checker still prints deprecation warnings for these vars if they remain in
   the environment — that is intentional and harmless; clean them up at your convenience.

**No data migration needed.** Existing `Integration.picture` URLs that point at the old
`CLOUDFLARE_BUCKET_URL` are left as-is; avatars are re-fetched and stored locally on the next token
refresh / reconnect.

### v3.8.0 → v3.8.1

Email configuration moves from the old 2-provider env scheme (Resend / nodemailer) to a
standardized 6-provider system.

**Breaking changes:**

- **`RESEND_API_KEY` is removed.** Set `EMAIL_PROVIDER=resend` and `EMAIL_API_KEY` with your
  Resend API key.
- **`EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_USER`, `EMAIL_PASS` are removed.**
  Set `EMAIL_PROVIDER=smtp` and use `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_SMTP_SECURE`,
  `EMAIL_SMTP_USER`, `EMAIL_SMTP_PASS`.
- **New `EMAIL_WEBHOOK_SECRET`** — required for delivery tracking on webhook-capable providers
  (Resend, SendGrid, Mailgun, Postmark, SES). See the Configuration reference for per-provider
  signing-secret locations.

**Impact:** Stale pre-v3.8.1 env vars (`RESEND_API_KEY`, `EMAIL_HOST`, etc.) are silently ignored.
The `EmptyAdapter` activates when no recognized `EMAIL_PROVIDER` is set, which means
activation/reset/invite/billing emails **stop sending**. After upgrading, verify `EMAIL_PROVIDER`
and the corresponding API key are configured.

**No schema migration required.** The new `EmailLog` Prisma model is additive.

### v3.7.1 → v3.8.0

Short-link provider configuration moves from environment variables to per-org in-app settings.

**Breaking changes:**

- **Short-link env vars removed.** All 10 short-link env vars (`DUB_TOKEN`, `DUB_API_ENDPOINT`, `DUB_SHORT_LINK_DOMAIN`, `SHORT_IO_SECRET_KEY`, `KUTT_API_KEY`, `KUTT_API_ENDPOINT`, `KUTT_SHORT_LINK_DOMAIN`, `LINK_DRIP_API_KEY`, `LINK_DRIP_API_ENDPOINT`, `LINK_DRIP_SHORT_LINK_DOMAIN`) are no longer read. Admins must reconfigure their provider in **Settings → Shortlinks** after upgrading.
- **Existing short links in scheduled/published posts** are not migrated. Already-generated short link URLs in post content continue to work as opaque URLs — they will not break. New short links will be generated by the newly configured provider.
- **Kutt and LinkDrip providers are no longer available.** These two providers have been removed from the 19-provider adapter set. If you were using Kutt or LinkDrip, choose one of the remaining supported providers.

**No schema migration required.** The three new Prisma models (`OrgShortLinkConfig`, `ShortLink`, `ShortLinkSnapshot`) are additive with nullable/defaulted columns.

### v3.7.0 → v3.7.1

v3.7.1 removes the last `process.env` credential fallbacks and the env-migration services. All
channel and AI credentials now come **only** from the database (Settings → Channels, Settings →
AI), encrypted at rest.

**Seed-then-upgrade (if you still rely on channel/AI env vars).** On v3.7.0 the env-migration
services seed each org's database config from your env vars on every boot. So the safe path is:

1. Boot **once on v3.7.0** with your existing channel/AI env vars set — this seeds them into the
   database for every org.
2. Upgrade to v3.7.1. It reads only the database; the env vars are now ignored.
3. Remove the deprecated channel/AI env vars from your deployment config.

> Keep `ENCRYPTION_KEY` (or `JWT_SECRET`, if you never set `ENCRYPTION_KEY`) **stable** across the
> two boots — the seeded secrets are encrypted with it and won't decrypt if it changes.

**Google My Business credential change.** Before v3.7.1, GMB fell back to `YOUTUBE_CLIENT_ID` /
`YOUTUBE_CLIENT_SECRET` when `GOOGLE_GMB_CLIENT_ID` was not set. That implicit fallback is **gone** —
GMB now resolves only its own `gmb` channel config. If you ran GMB off the YouTube credentials
(without ever setting `GOOGLE_GMB_CLIENT_ID`), the seed step above won't create a `gmb` row, and GMB
connect/publish will return a "provider not configured" error after upgrade. Fix: enter Google My
Business credentials explicitly under Settings → Channels (you can reuse the same Google Cloud
OAuth client you used for YouTube).

### Pre-v3.6.0 → v3.6.0

- `OPENAI_API_KEY` is no longer read by the AI layer; configure AI providers in Settings → AI.
- Per-provider OAuth env vars (`LINKEDIN_CLIENT_ID`, `FACEBOOK_APP_ID`, etc.) are deprecated;
  migrate to Settings → Channels.
- Per-tenant storage replaces global `STORAGE_PROVIDER`/`CLOUDFLARE_*` vars; migrate to Settings
  → Storage.

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
